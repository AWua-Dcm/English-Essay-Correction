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

  /* ---------- 事件处理（批改/复制在后续部分接入） ---------- */
  function onGradeClick() { toast('批改功能将随后接入（正在构建中）'); }
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

  var api = {
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

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    (root.EEC = root.EEC || {}).app = api;
    scheduleBoot();
  }
})(typeof self !== 'undefined' ? self : globalThis);
