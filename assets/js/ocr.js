/**
 * ocr.js — 本地图片文字识别（完全离线，无第三方请求）
 *
 * 为什么是本地 OCR：图片作文在免 Key 场景下原本必须依赖"会看图的模型"，本模块让
 * 印刷体作文截图也能在纯浏览器里转成可批改的文字。
 *
 * 实测准确率（词级，对照视觉模型转写，见 docs/ocr.md）：
 *   印刷体 · 高清 2480px   98.9%
 *   印刷体 · 低清  760px   94.5%
 *   手写体 · 高清 2480px   75.8%
 *   真实作文截图 14 张     74.3%
 * 结论：**印刷体可用，手写体不可用**。手写卷面拍成照片是最常见的输入，所以本模块
 * 从不静默批改——一律先把文字交给用户核对，并按置信度给出不同强度的警告。
 *
 * 两个刻意的设计决定：
 * 1. **绝不自动纠错拼写**。本工具的核心功能就是找出学生的拼写和语法错误，自动纠正
 *    等于把要检测的错误先抹掉。清洗只做空白归一化和版面条目剔除。
 * 2. **懒加载**。约 6.7MB 的引擎与语言包只在用户第一次点「识别图片文字」时才下载，
 *    首屏不受影响。全部资源在仓库内，不发任何第三方请求。
 *
 * UMD-lite：浏览器挂 window.EEC.ocr，Node 下 module.exports（便于单测）。
 */
(function (root) {
  'use strict';

  var VENDOR = 'assets/vendor/tesseract/';
  // 核心按 SIMD 变体钉死：worker 默认的探测顺序是 relaxedsimd → simd → 无，
  // 若只 vendor 其中一个变体就会 404。corePath 以 "js" 结尾时会被原样使用，
  // 因此这里直接指向单一文件，跳过整套探测。
  var CORE_FILE = 'tesseract-core-simd-lstm.wasm.js';
  var LANG_FILE = 'eng.traineddata.gz';

  // 置信度阈值：Tesseract 自评置信度与实测准确率高度相关
  // （印刷体 95%/98.9%，手写 69%/75.8%），因此可以拿它当门控。
  var CONF_GOOD = 85;
  var CONF_FAIR = 70;

  var libPromise = null;
  var workerPromise = null;
  var lastProgress = null;

  function hasSimd() {
    try {
      if (typeof WebAssembly === 'undefined' || !WebAssembly.validate) return false;
      // 一条最小的 v128 SIMD 模块；不能通过就说明浏览器不支持 WASM SIMD。
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]));
    } catch (e) {
      return false;
    }
  }

  function isSupported() {
    return typeof WebAssembly === 'object' && hasSimd();
  }

  /** 置信度 → 三档质量判定 */
  function gradeConfidence(conf) {
    var c = Number(conf);
    if (!isFinite(c)) return 'unknown';
    if (c >= CONF_GOOD) return 'good';
    if (c >= CONF_FAIR) return 'fair';
    return 'poor';
  }

  /** 三档质量 → 给用户的中文提示（页面直接展示，措辞可改） */
  function advice(grade) {
    if (grade === 'good') {
      return '识别完成。请核对文字是否与照片一致，确认无误后再开始批改。';
    }
    if (grade === 'fair') {
      return '识别质量一般，可能有个别字词识别不准。请逐句核对后再批改，' +
        '否则被识别错的词会被当成作文里的错误。';
    }
    if (grade === 'poor') {
      return '识别质量较低，照片很可能包含手写内容——本地识别只对印刷体可靠。' +
        '建议改用支持图片识别的模型（自动模式选视觉模型），' +
        '或把作文直接粘贴成文字，以免识别错误被计入扣分。';
    }
    return '识别完成，但无法判断识别质量，请务必逐句核对。';
  }

  /**
   * 清洗识别结果。**不做拼写纠正**——只归一空白、去掉明显的版面噪声。
   * 若这里"顺手修好"单词，就等于把学生原本的错误抹掉了。
   */
  function cleanText(raw) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/\r\n?/g, '\n');
    // 常见版面噪声：整行只剩符号/页码/下划线
    var lines = s.split('\n').map(function (line) {
      return line.replace(/[ 	 　]+/g, ' ').trim();
    });
    lines = lines.filter(function (line) {
      if (!line) return true;
      if (/^[_\-—=~.|·•\s]+$/.test(line)) return false;
      if (/^\d{1,4}$/.test(line)) return false;
      var letters = line.replace(/[^A-Za-z]/g, '').length;
      if (letters < 3 && line.length < 12) return false;
      return true;
    });
    s = lines.join('\n');
    s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
    return s.trim();
  }

  /** 懒加载引擎脚本（仓库内资源，非 CDN） */
  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      if (typeof document === 'undefined') {
        reject(new Error('当前环境不支持本地识别'));
        return;
      }
      var s = document.createElement('script');
      s.src = VENDOR + 'tesseract.min.js';
      s.async = true;
      s.onload = function () {
        if (root.Tesseract) resolve(root.Tesseract);
        else reject(new Error('识别组件加载失败'));
      };
      s.onerror = function () {
        reject(new Error('识别组件加载失败：请检查 assets/vendor/tesseract/ 是否完整（离线包需包含该目录）'));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function getWorker(onProgress) {
    if (onProgress) lastProgress = onProgress;
    if (workerPromise) return workerPromise;
    workerPromise = loadLib().then(function (T) {
      return T.createWorker('eng', 1, {
        workerPath: VENDOR + 'worker.min.js',
        corePath: VENDOR + CORE_FILE,   // 以 js 结尾 → 原样使用，跳过变体探测
        langPath: VENDOR,
        gzip: true,
        logger: function (m) { if (lastProgress) lastProgress(m); },
      });
    }).catch(function (e) {
      workerPromise = null;
      throw e;
    });
    return workerPromise;
  }

  /**
   * 识别一张图片。
   * @param {string} dataUrl  图片的 data URL 或可加载的 URL
   * @param {(m:object)=>void} [onProgress]
   * @returns {Promise<{text:string, confidence:number, grade:string, advice:string}>}
   */
  function recognize(dataUrl, onProgress) {
    if (!isSupported()) {
      return Promise.reject(new Error(
        '当前浏览器不支持本地文字识别（缺少 WebAssembly SIMD）。' +
        '请改用支持图片识别的模型，或把作文粘贴成文字。'
      ));
    }
    return getWorker(onProgress).then(function (worker) {
      return worker.recognize(dataUrl);
    }).then(function (res) {
      var data = (res && res.data) || {};
      var grade = gradeConfidence(data.confidence);
      return {
        text: cleanText(data.text),
        confidence: Math.round(Number(data.confidence) || 0),
        grade: grade,
        advice: advice(grade),
        langFile: LANG_FILE,
      };
    });
  }

  function terminate() {
    var p = workerPromise;
    workerPromise = null;
    if (!p) return Promise.resolve();
    return p.then(function (w) { return w.terminate(); }).catch(function () {});
  }

  var api = {
    VENDOR: VENDOR,
    CORE_FILE: CORE_FILE,
    CONF_GOOD: CONF_GOOD,
    CONF_FAIR: CONF_FAIR,
    isSupported: isSupported,
    hasSimd: hasSimd,
    gradeConfidence: gradeConfidence,
    advice: advice,
    cleanText: cleanText,
    recognize: recognize,
    terminate: terminate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).ocr = api;
})(typeof self !== 'undefined' ? self : globalThis);
