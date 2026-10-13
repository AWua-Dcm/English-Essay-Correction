/**
 * app.js — 页面编排（第一部分：输入区、视图状态、草稿恢复、横幅）
 * 依赖加载顺序：util → render → providers → prompt → api → store → exporter → demo → app
 * UMD-lite：浏览器挂 window.EEC.app 并启动；Node/jsdom 测试环境下仅导出（由 helpers 驱动）。
 */
(function (root) {
  'use strict';

  var EEC = root.EEC || {};
  var util = EEC.util, providers = EEC.providers, prompt = EEC.prompt,
      api = EEC.api, store = EEC.store, exporter = EEC.exporter, demo = EEC.demo, render = EEC.render;

  var MAX_IMAGES = 3;
  var IMG_MAX_LONG_EDGE = 2048;
  var IMG_MAX_TOTAL = 6 * 1024 * 1024;   // 压缩后 base64 总量上限（近似字节）

  var state = {
    level: 'auto',            // 'cet4' | 'cet6' | 'auto'
    title: '',
    text: '',
    images: [],               // [{dataUrl, name}]
    pasteBox: '',
    settings: null,
    streaming: null,
    lastEntry: null,
    reportRendered: false,
    booted: false,
  };

  var _timing = {
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    clearTimeout: function (t) { clearTimeout(t); },
  };

  function $(sel) { return document.querySelector(sel); }

  /* ---------- Toast / 无障碍播报 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    var live = $('#live-status');
    if (live) live.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function announce(msg) {
    var live = $('#live-status');
    if (live) live.textContent = msg;
  }

  /* ---------- 级别 / 徽章 / 模式条 ---------- */
  function levelArg() {
    return state.level === 'cet4' ? '四级' : (state.level === 'cet6' ? '六级' : 'auto');
  }

  function syncLevelPills() {
    var pills = document.querySelectorAll('.level-pill');
    for (var i = 0; i < pills.length; i++) {
      pills[i].classList.toggle('is-active', pills[i].getAttribute('data-level') === state.level);
    }
  }

  function updateWordBadge() {
    var el = $('#word-badge');
    if (!el) return;
    var wb = util.wordBadge({
      level: state.level,
      count: util.wordCount(state.text),
      imageCount: state.images.length,
    });
    el.textContent = wb.text;
    el.className = 'word-badge' + (wb.status !== 'info' ? ' is-' + wb.status : '');
    el.setAttribute('data-status', wb.status);
  }

  function updateModeStrip() {
    var el = $('#mode-strip');
    if (!el) return;
    if (state.settings && state.settings.apiKey) {
      var p = providers.byId(state.settings.providerId) || providers.byId(providers.DEFAULT_PROVIDER_ID);
      el.textContent = '自动批改 · ' + p.name;
    } else {
      el.textContent = '复制模式（未配置 Key）';
    }
  }

  /* ---------- 草稿 ---------- */
  var saveDraftSoon = util.debounce(function () {
    store.saveDraft({
      level: state.level,
      title: state.title,
      text: state.text,
      pasteBox: state.pasteBox,
      imageCount: state.images.length,
      ts: Date.now(),
    });
  }, 500);

  /* ---------- 图片管线 ---------- */
  function renderThumbs() {
    var box = $('#image-thumbs');
    if (!box) return;
    box.innerHTML = '';
    state.images.forEach(function (img, idx) {
      var div = document.createElement('div');
      div.className = 'thumb';
      var im = document.createElement('img');
      im.src = img.dataUrl;
      im.alt = img.name || ('图片 ' + (idx + 1));
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.textContent = '✕';
      del.setAttribute('aria-label', '删除图片 ' + (idx + 1));
      del.addEventListener('click', function () {
        state.images.splice(idx, 1);
        renderThumbs();
        updateWordBadge();
        saveDraftSoon();
      });
      div.appendChild(im);
      div.appendChild(del);
      box.appendChild(div);
    });
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var canvasOk = (function () {
        try { return document.createElement('canvas').getContext('2d') != null; } catch (e) { return false; }
      })();
      if (!canvasOk) return reject(new Error('no-canvas'));
      function finish(bmp) {
        try {
          var w = bmp.width, h = bmp.height;
          var scale = Math.min(1, IMG_MAX_LONG_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(bmp, 0, 0, cw, ch);
          // 空白检测：四角与中心采样近似同色 → 视为解码异常
          var pts = [[2, 2], [cw - 3, 2], [2, ch - 3], [cw - 3, ch - 3], [cw >> 1, ch >> 1]];
          var first = null, same = true;
          for (var i = 0; i < pts.length; i++) {
            var d = ctx.getImageData(pts[i][0], pts[i][1], 1, 1).data;
            var key = d[0] + ',' + d[1] + ',' + d[2];
            if (first === null) first = key; else if (key !== first) same = false;
          }
          if (same) return reject(new Error('blank'));
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) { reject(e); }
      }
      var fallback = function () {
        try {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () { URL.revokeObjectURL(url); finish(img); };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
          img.src = url;
        } catch (e) { reject(e); }
      };
      if (typeof createImageBitmap === 'function') {
        try {
          createImageBitmap(file, { imageOrientation: 'from-image' }).then(finish).catch(fallback);
        } catch (e) { fallback(); }
      } else {
        fallback();
      }
    });
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var remaining = MAX_IMAGES - state.images.length;
    if (remaining <= 0) { toast('最多 ' + MAX_IMAGES + ' 张图片'); return; }
    files.slice(0, remaining).forEach(function (file) {
      var policy = util.imagePolicy({ name: file.name, type: file.type, size: file.size });
      if (!policy.accept) {
        if (policy.reason === 'heic') toast('暂不支持 HEIC 格式：请在相册导出为 JPG，或直接改用复制模式把照片发到 AI 对话');
        else if (policy.reason === 'size') toast('图片太大（超过 25MB），请压缩后重试');
        else toast('仅支持 JPG / PNG / WebP 格式');
        return;
      }
      toast('正在处理图片…');
      compressImage(file).then(function (dataUrl) {
        var total = 0;
        for (var i = 0; i < state.images.length; i++) total += state.images[i].dataUrl.length;
        if (total + dataUrl.length > IMG_MAX_TOTAL) { toast('图片总量超过上限，请减少张数'); return; }
        state.images.push({ dataUrl: dataUrl, name: file.name || ('图片 ' + (state.images.length + 1)) });
        renderThumbs();
        updateWordBadge();
        saveDraftSoon();
        announce('已添加图片 ' + state.images.length + ' 张');
      }).catch(function (err) {
        if (err && err.message === 'blank') toast('无法读取该图片（内容异常），请重新拍照或换一张');
        else toast('无法读取该图片（可能是 HEIC/HEIF 格式）：请在相册中导出或截图成 JPG 后重试');
      });
    });
  }

  /* ---------- 抽屉机制（内容接线见后续部分） ---------- */
  var lastFocus = null;
  function openDrawer(id) {
    lastFocus = document.activeElement;
    $('#drawer-backdrop').hidden = false;
    var d = $('#' + id);
    d.hidden = false;
    var first = d.querySelector('input, select, button');
    if (first) first.focus();
  }
  function closeDrawers() {
    $('#settings-drawer').hidden = true;
    $('#history-drawer').hidden = true;
    $('#drawer-backdrop').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openSettings() { openDrawer('settings-drawer'); }
  function openHistory() { openDrawer('history-drawer'); }

  /* ---------- 复制模式面板（逻辑接线在后续部分） ---------- */
  function openCopyPanel() {
    var panel = $('#copy-panel');
    if (panel) panel.hidden = false;
  }
  function closeCopyPanel() {
    var panel = $('#copy-panel');
    if (panel) panel.hidden = true;
  }

  /* ---------- 横幅与首次引导 ---------- */
  function updateBanners() {
    try {
      if (location.protocol === 'file:') $('#file-banner').hidden = false;
    } catch (e) { /* 忽略 */ }
    if (util.isWeChatOrQQ(navigator.userAgent || '')) $('#wechat-banner').hidden = false;
  }

  function firstRunDismissed() {
    try { return localStorage.getItem('eec.firstrun.v1') === 'done'; } catch (e) { return false; }
  }

  function updateFirstRun() {
    var card = $('#first-run-card');
    if (!card) return;
    if (firstRunDismissed() || (state.settings && state.settings.apiKey)) card.hidden = true;
    else card.hidden = false;
  }

  /* ---------- 自动模式：提交、流式、报告渲染、错误 ---------- */
  function currentPreset() {
    return providers.byId(state.settings.providerId) || providers.byId(providers.DEFAULT_PROVIDER_ID);
  }
  function currentModel() {
    return state.settings.model || currentPreset().defaultModel;
  }
  function setGradeDisabled(disabled) {
    var b = $('#btn-grade');
    if (b) b.disabled = disabled;
  }
  function setToolbarEnabled(enabled) {
    ['#btn-print', '#btn-export-md', '#btn-export-html'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.disabled = !enabled;
    });
  }
  function entryLevelFor(parse) {
    if (parse && parse.level) return parse.level;
    if (state.level === 'cet4') return '四级';
    if (state.level === 'cet6') return '六级';
    return '自动推断';
  }
  function followScroll() {
    var doc = document.documentElement;
    var nearBottom = (window.innerHeight + window.scrollY) >= ((doc.scrollHeight || 0) - 120);
    var btn = $('#btn-back-latest');
    if (btn) btn.hidden = nearBottom;
    if (nearBottom && window.scrollTo) window.scrollTo(0, doc.scrollHeight || 0);
  }

  /** 两模式共用的报告渲染（设计文档 §7）。返回历史 entry；渲染状态写入 state。 */
  function _renderReport(fullText, opts) {
    opts = opts || {};
    var parse = prompt.extractScoreBlock(fullText);
    var display = parse.textWithout;
    $('#report-area').hidden = false;
    $('#scorecard').innerHTML = '';
    var body = $('#report-body');
    body.innerHTML = '';
    var note = $('#parse-note');
    note.hidden = true;
    note.textContent = '';
    $('#truncation-banner').hidden = true;
    state.lastEntry = null;
    state.reportRendered = false;

    var optWords = null;
    var noteParts = [];
    if (opts.aborted) noteParts.push('已停止：内容不完整，可导出已生成部分或重新批改。');
    else if (opts.interrupted) noteParts.push('生成中断：已保留已生成内容，可重新批改。');

    if (parse.status === 'unreadable') {
      var ucard = document.createElement('div');
      ucard.className = 'unreadable-card';
      ucard.textContent = '图片无法辨认：' + (parse.note || '图片模糊或文字无法看清') + '。请补充文字版或重新拍照后重试。';
      body.appendChild(ucard);
      var uentry = buildEntry(parse, display, opts, null);
      note.hidden = false;
      note.textContent = noteParts.join(' ');
      state.lastEntry = uentry;
      state.reportRendered = true;
      return uentry;
    }

    if (parse.scores) {
      $('#scorecard').innerHTML = exporter.scorecardHtml({
        scores: parse.scores,
        tier: prompt.tierFor(parse.scores.total),
        annotations: parse.annotations,
      });
    } else {
      noteParts.push(parse.parseMode === 'none'
        ? '未解析到结构化分数：报告已完整展示。'
        : '未解析到结构化分数。');
    }

    var split = prompt.splitReport(display);
    if (split.found === 0) {
      var plain = document.createElement('div');
      plain.className = 'report-plain';
      plain.appendChild(render.toFragment(display));
      body.appendChild(plain);
      noteParts.push('未识别到步骤①-④标题，报告按整段展示。');
    } else {
      split.steps.forEach(function (step) {
        var card = document.createElement('section');
        card.className = 'step-card';
        card.id = 'step-' + step.index;
        var h2 = document.createElement('h2');
        h2.textContent = step.title;
        card.appendChild(h2);
        var content = document.createElement('div');
        content.className = 'step-content';
        content.appendChild(render.toFragment(step.body));
        card.appendChild(content);
        if (step.index === 4) {
          var opt = prompt.extractOptimizedBody(step.body);
          if (opt) {
            optWords = util.wordCount(opt);
            var lvl = entryLevelFor(parse);
            var chip = document.createElement('span');
            chip.className = 'opt-chip';
            var ranges = { '四级': [120, 180], '六级': [150, 200] };
            var rg = ranges[lvl];
            if (rg) {
              var lo = rg[0], hi = rg[1];
              var st, cls = '';
              if (optWords < lo) { st = '偏少 ' + (lo - optWords) + ' 词'; cls = 'is-low'; }
              else if (optWords > hi) { st = '偏多 ' + (optWords - hi) + ' 词'; cls = 'is-high'; }
              else st = '达标';
              if (cls) chip.className += ' ' + cls;
              chip.textContent = '优化版 ' + optWords + ' 词 · ' + st + '（' + lvl + '要求 ' + lo + '–' + hi + ' 词）';
            } else {
              chip.textContent = '优化版 ' + optWords + ' 词（级别未确定，未做达标判定）';
            }
            card.appendChild(chip);
          }
        }
        body.appendChild(card);
      });
      if (split.found < 4) noteParts.push('只识别到 ' + split.found + ' 个步骤标题。');
    }

    if (noteParts.length) {
      note.hidden = false;
      note.textContent = noteParts.join(' ');
    }

    var entry = buildEntry(parse, display, opts, optWords);
    state.lastEntry = entry;
    state.reportRendered = true;
    return entry;
  }

  function buildEntry(parse, display, opts, optWords) {
    return {
      ts: Date.now(),
      level: entryLevelFor(parse),
      title: state.title,
      words: util.wordCount(state.text),
      optimizedWords: optWords,
      scores: parse.scores || null,
      source: opts.source || 'auto',
      status: opts.aborted ? 'stopped' : 'complete',
      essay: state.text,
      reportMd: display,
    };
  }

  function renderErrorCard(err) {
    $('#report-area').hidden = false;
    $('#scorecard').innerHTML = '';
    var body = $('#report-body');
    body.innerHTML = '';
    $('#parse-note').hidden = true;
    state.lastEntry = null;
    state.reportRendered = false;
    setToolbarEnabled(false);

    var card = document.createElement('div');
    card.className = 'error-card';
    var p = document.createElement('p');
    p.textContent = (err && err.message) || '批改失败';
    card.appendChild(p);
    var kind = err && err.kind;
    if (err && err.raw) {
      var raw = document.createElement('p');
      raw.className = 'raw';
      raw.textContent = '原始错误：' + err.raw;
      card.appendChild(raw);
    }
    var actions = document.createElement('div');
    actions.className = 'actions';
    function mkBtn(label, fn, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (cls || 'ghost');
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }
    if (kind === 'auth' || kind === 'params' || kind === 'network') {
      mkBtn('检查 Key / 测试连接', function () { openSettings(); });
    }
    if (kind === 'balance') mkBtn('去充值', function () { toast('请打开服务商控制台充值后重试'); });
    if (kind === 'rate') mkBtn('稍后重试', onGradeClick, 'secondary');
    if (kind === 'server' || kind === 'stream_error') mkBtn('重试', onGradeClick, 'secondary');
    if (kind === 'server' || kind === 'params') mkBtn('更换服务商', function () { openSettings(); });
    mkBtn('改用复制模式', function () { openCopyPanel(); }, 'secondary');
    card.appendChild(actions);
    body.appendChild(card);
    announce('批改失败：' + ((err && err.message) || ''));
  }

  function finishReport(fullText, opts) {
    opts = opts || {};
    var entry = _renderReport(fullText, opts);
    if (opts.autoStore && entry) {
      var r = store.addEntry(entry);
      if (!r.saved) toast('本地保存失败（存储空间不足），请导出重要报告');
    }
    setToolbarEnabled(state.reportRendered);
    if (opts.finishReason === 'length' || opts.maxTokensDropped) {
      var tb = $('#truncation-banner');
      tb.hidden = false;
      tb.textContent = (opts.finishReason === 'length')
        ? '输出被截断（达到模型输出上限）：报告可能不完整，建议重试或更换模型。'
        : '已移除输出上限参数（模型不支持），输出可能被截断：建议重试或更换模型。';
    }
  }

  async function runStream(ctx) {
    var ctrl = new AbortController();
    state.streaming = { abort: ctrl, full: '', maxTokensDropped: false };
    setGradeDisabled(true);
    var streamStatus = $('#stream-status');
    streamStatus.hidden = false;
    var elapsedEl = $('#stream-elapsed');
    var waited = 0;
    elapsedEl.textContent = '批改中… 已等待 0 秒';
    var elapsedTimer = setInterval(function () {
      waited += 1;
      elapsedEl.textContent = '批改中… 已等待 ' + waited + ' 秒' + (waited >= 15 ? '（模型思考中）' : '');
    }, 1000);
    $('#report-area').hidden = false;
    $('#truncation-banner').hidden = true;
    $('#parse-note').hidden = true;
    $('#scorecard').innerHTML = '';
    setToolbarEnabled(false);
    state.lastEntry = null;
    state.reportRendered = false;
    announce('开始批改');

    var renderer = render.createStreamRenderer($('#report-body'));
    var lastRenderAt = 0;
    function throttledRender() {
      var now = Date.now();
      if (now - lastRenderAt < 100) return;
      lastRenderAt = now;
      renderer.update(prompt.displayText(state.streaming.full));
      followScroll();
    }

    function send(extra) {
      return api.streamChat({
        preset: ctx.preset,
        apiKey: state.settings.apiKey,
        model: ctx.model,
        baseURL: state.settings.baseURL || ctx.preset.baseURL,
        messages: [
          { role: 'system', content: prompt.buildSystemPrompt() },
          { role: 'user', content: ctx.userContent },
        ],
        extra: extra,
        signal: ctrl.signal,
        onDelta: function (t) {
          if (!state.streaming) return;
          state.streaming.full += t;
          throttledRender();
        },
      });
    }

    try {
      var extra = { temperature: 0.6, max_tokens: ctx.maxTokens };
      var res;
      try {
        res = await send(extra);
      } catch (e) {
        if (!e || e.kind !== 'params') throw e;
        delete extra.temperature;
        try { res = await send(extra); }
        catch (e2) {
          if (!e2 || e2.kind !== 'params') throw e2;
          delete extra.max_tokens;
          state.streaming.maxTokensDropped = true;
          res = await send(extra);
        }
      }
      finishReport(state.streaming.full, {
        source: 'auto',
        finishReason: res.finishReason,
        maxTokensDropped: state.streaming.maxTokensDropped,
        interrupted: !res.finishReason && !res.usedFallbackNonStream,
        autoStore: true,
      });
    } catch (e) {
      if (e && e.kind === 'aborted') {
        finishReport(state.streaming.full, { source: 'auto', aborted: true, autoStore: true });
      } else {
        renderErrorCard(e);
      }
    } finally {
      clearInterval(elapsedTimer);
      streamStatus.hidden = true;
      state.streaming = null;
      setGradeDisabled(false);
      announce('批改结束');
    }
  }

  async function onGradeClick() {
    if (state.streaming) return;
    state.text = $('#essay-text').value;
    state.title = $('#essay-title').value;
    if (!state.text.trim() && state.images.length === 0) { toast('请先粘贴作文或上传图片'); return; }
    if (!state.settings.apiKey) {
      openCopyPanel();
      toast('还没有 Key？点 [复制批改指令] → 粘贴到任意 AI → 把结果粘回这里');
      return;
    }
    var preset = currentPreset();
    var model = currentModel();
    if (state.images.length > 0 && preset.visionModels.indexOf(model) === -1) {
      toast('当前模型（' + model + '）不支持图片识别，请更换支持视觉的模型或改用复制模式');
      return;
    }
    var meta = prompt.buildMetaBlock({
      level: levelArg(), title: state.title, text: state.text, images: state.images.length,
    });
    var userContent = meta;
    if (state.images.length) {
      userContent = [{ type: 'text', text: meta }].concat(state.images.map(function (im) {
        return { type: 'image_url', image_url: { url: im.dataUrl } };
      }));
    }
    var est = api.estimateInputTokens(
      JSON.stringify(userContent).length + prompt.buildSystemPrompt().length,
      state.images.length
    );
    var maxTokens = api.computeMaxTokens(preset, est);
    if (maxTokens <= 512) { toast('作文过长或模型上限太小，无法安全生成完整报告'); return; }
    await runStream({ preset: preset, model: model, userContent: userContent, maxTokens: maxTokens });
  }

  /* 复制模式（完整接线在第三部分） */
  function onCopyClick() { openCopyPanel(); toast('复制功能将随后接入（正在构建中）'); }
  function onRenderPaste() { toast('渲染功能将随后接入（正在构建中）'); }

  /* ---------- 启动 ---------- */
  function bindEvents() {
    var pills = document.querySelectorAll('.level-pill');
    for (var i = 0; i < pills.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          state.level = btn.getAttribute('data-level') || 'auto';
          syncLevelPills();
          updateWordBadge();
          saveDraftSoon();
        });
      })(pills[i]);
    }

    $('#essay-title').addEventListener('input', function () {
      state.title = this.value;
      saveDraftSoon();
    });
    $('#essay-text').addEventListener('input', function () {
      state.text = this.value;
      updateWordBadge();
      saveDraftSoon();
    });
    $('#paste-box').addEventListener('input', function () {
      state.pasteBox = this.value;
      saveDraftSoon();
    });

    $('#image-input-camera').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });
    $('#image-input-gallery').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });

    $('#btn-demo').addEventListener('click', function () {
      var s = demo.SAMPLES.cet4;
      state.level = 'cet4'; state.title = s.title; state.text = s.text;
      $('#essay-title').value = s.title;
      $('#essay-text').value = s.text;
      syncLevelPills();
      updateWordBadge();
      saveDraftSoon();
      toast('已填入四级示例作文');
    });

    $('#first-run-close').addEventListener('click', function () {
      $('#first-run-card').hidden = true;
      try { localStorage.setItem('eec.firstrun.v1', 'done'); } catch (e) { /* 忽略 */ }
    });

    $('#mode-strip').addEventListener('click', openSettings);
    $('#history-open').addEventListener('click', openHistory);
    $('#btn-grade').addEventListener('click', onGradeClick);
    $('#btn-copy-prompt').addEventListener('click', onCopyClick);
    $('#btn-render-paste').addEventListener('click', onRenderPaste);

    $('#btn-stop').addEventListener('click', function () {
      if (state.streaming) state.streaming.abort.abort();
    });
    $('#btn-regrade').addEventListener('click', onGradeClick);
    $('#btn-back-latest').addEventListener('click', function () {
      if (window.scrollTo) window.scrollTo(0, document.documentElement.scrollHeight || 0);
      $('#btn-back-latest').hidden = true;
    });
    var navLinks = document.querySelectorAll('.nav-link');
    for (var n = 0; n < navLinks.length; n++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var target = btn.getAttribute('data-target');
          if (target) {
            var el = document.getElementById(target);
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else if (window.scrollTo) {
            window.scrollTo(0, 0);
          }
        });
      })(navLinks[n]);
    }

    $('#drawer-backdrop').addEventListener('click', closeDrawers);
    var closers = document.querySelectorAll('.drawer-close');
    for (var c = 0; c < closers.length; c++) closers[c].addEventListener('click', closeDrawers);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawers();
    });
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    state.settings = store.loadSettings();

    var d = store.loadDraft();
    var hadImages = false;
    if (d) {
      state.level = d.level || 'auto';
      state.title = d.title || '';
      state.text = d.text || '';
      state.pasteBox = d.pasteBox || '';
      hadImages = d.imageCount > 0;
    }
    $('#essay-title').value = state.title;
    $('#essay-text').value = state.text;
    $('#paste-box').value = state.pasteBox;
    syncLevelPills();

    bindEvents();
    updateWordBadge();
    updateModeStrip();
    updateFirstRun();
    updateBanners();

    if (d && (d.text || d.title)) {
      toast('已恢复上次输入' + (hadImages ? '（图片需重新选择）' : ''));
    }
  }

  function scheduleBoot() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  var appExports = {
    state: state,
    _timing: _timing,
    boot: boot,
    openCopyPanel: openCopyPanel,
    closeCopyPanel: closeCopyPanel,
    toast: toast,
    announce: announce,
    openSettings: openSettings,
    openHistory: openHistory,
    closeDrawers: closeDrawers,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = appExports;
  else {
    (root.EEC = root.EEC || {}).app = appExports;
    scheduleBoot();
  }
})(typeof self !== 'undefined' ? self : globalThis);
