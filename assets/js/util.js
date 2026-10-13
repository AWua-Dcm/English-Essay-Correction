/**
 * util.js — 四六级作文 AI 批改台 通用工具
 * 无第三方依赖；UMD-lite：浏览器挂 window.EEC.util，Node 下 module.exports（供 node --test 直接单测）。
 */
(function (root) {
  'use strict';

  /** HTML 转义：先 & 后其余，覆盖属性上下文所需全部字符 */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 词数统计：设计文档 §8 正则——字母词；缩写（' ’）与连字符（-）计入同一词；数字/破折号不计 */
  function wordCount(text) {
    const m = String(text == null ? '' : text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g);
    return m ? m.length : 0;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDateShort(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return formatDateShort(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s);
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + '…';
  }

  function debounce(fn, ms) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, ms);
    };
  }

  function isWeChatOrQQ(ua) {
    return /MicroMessenger|QQ\//.test(String(ua || ''));
  }

  /** HEIC/HEIF 预检：扩展名或 MIME（iOS 上 File.type 常为空串，不能只靠 MIME） */
  function isHeic(file) {
    const name = String((file && file.name) || '').toLowerCase();
    const type = String((file && file.type) || '').toLowerCase();
    return /\.(heic|heif)$/.test(name) || type.indexOf('heic') !== -1 || type.indexOf('heif') !== -1;
  }

  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 解码前上限；宽进严出（先解码压缩再校验产物）

  /**
   * 图片准入判定。优先级：heic > size > type；type 为空串放行（iOS 相册常见）。
   * @returns {{accept: boolean, reason?: 'heic'|'size'|'type'}}
   */
  function imagePolicy(file) {
    if (isHeic(file)) return { accept: false, reason: 'heic' };
    if (file && file.size > MAX_SOURCE_BYTES) return { accept: false, reason: 'size' };
    const type = String((file && file.type) || '').toLowerCase();
    if (type !== '' && ALLOWED_TYPES.indexOf(type) === -1) return { accept: false, reason: 'type' };
    return { accept: true };
  }

  /**
   * 剪贴板写入降级链（绝不假成功）：
   * 一级 navigator.clipboard.writeText → 二级 隐藏 textarea + execCommand → 失败返回 false，由调用方走人工选中。
   */
  async function copyText(text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 落入下一级 */ }
    try {
      if (typeof document === 'undefined') return false;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  /** 浏览器端下载文本文件；不支持时静默交给调用方兜底 */
  function downloadFile(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* 由调用方提示"可改用打印或复制" */ }
  }

  /**
   * 词数徽章文案（设计文档 §5.1.3 三态）
   * @param {{level: 'cet4'|'cet6'|'auto', count: number, imageCount: number}} opts
   * @returns {{text: string, status: 'ok'|'low'|'high'|'info'}}
   */
  function wordBadge(opts) {
    opts = opts || {};
    var level = opts.level || 'auto';
    var count = opts.count || 0;
    var imageCount = opts.imageCount || 0;
    if (count === 0 && imageCount > 0) {
      return { text: '图片作文 ' + imageCount + ' 张 · 词数以识别结果为准', status: 'info' };
    }
    if (count === 0) return { text: '0 词', status: 'info' };
    if (level === 'cet4' || level === 'cet6') {
      var lo = (level === 'cet4') ? 120 : 150;
      var hi = (level === 'cet4') ? 180 : 200;
      if (count < lo) return { text: count + ' 词 · 偏少 ' + (lo - count) + ' 词', status: 'low' };
      if (count > hi) return { text: count + ' 词 · 偏多 ' + (count - hi) + ' 词', status: 'high' };
      return { text: count + ' 词 · 达标', status: 'ok' };
    }
    return { text: count + ' 词 · 四级 120–180 / 六级 150–200', status: 'info' };
  }

  const api = {
    escapeHtml: escapeHtml,
    wordCount: wordCount,
    formatDate: formatDate,
    formatDateShort: formatDateShort,
    truncate: truncate,
    debounce: debounce,
    isWeChatOrQQ: isWeChatOrQQ,
    downloadFile: downloadFile,
    copyText: copyText,
    isHeic: isHeic,
    imagePolicy: imagePolicy,
    wordBadge: wordBadge,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).util = api;
})(typeof self !== 'undefined' ? self : globalThis);
