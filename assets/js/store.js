/**
 * store.js — 本地存储：设置 / 输入草稿 / 历史记录（索引 + 分条 + 配额韧性）
 *
 * 键设计（设计文档 §11）：
 *   eec.settings.v1        设置
 *   eec.draft.v1           输入草稿（不含图片数据）
 *   eec.history.index.v1   轻量元数据数组（新在前）
 *   eec.history.v1.<id>    单条报告正文（essay + reportMd，单条上限 40KB）
 *
 * 所有 localStorage 访问均容错；损坏数据安全降级；写入配额不足时从最旧条目开始淘汰重试。
 * UMD-lite：浏览器挂 window.EEC.store，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var K_SETTINGS = 'eec.settings.v1';
  var K_DRAFT = 'eec.draft.v1';
  var K_INDEX = 'eec.history.index.v1';
  var K_ENTRY_PREFIX = 'eec.history.v1.';
  var HISTORY_MAX = 100;
  var REPORT_MAX = 40960; // 40KB（字符数）

  function ls() {
    try {
      return (typeof localStorage !== 'undefined') ? localStorage : null;
    } catch (e) { return null; }
  }

  function readJson(key, fallback) {
    var s = ls();
    if (!s) return fallback;
    try {
      var raw = s.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return (v == null) ? fallback : v;
    } catch (e) { return fallback; }
  }

  function writeJson(key, val) {
    var s = ls();
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  /* ---------- 设置 ---------- */

  function loadSettings() {
    var raw = readJson(K_SETTINGS, null);
    var out = { providerId: 'deepseek', apiKey: '', model: '', baseURL: '' };
    if (raw && typeof raw === 'object') {
      if (typeof raw.providerId === 'string' && raw.providerId) out.providerId = raw.providerId;
      if (typeof raw.apiKey === 'string') out.apiKey = raw.apiKey;
      if (typeof raw.model === 'string') out.model = raw.model;
      if (typeof raw.baseURL === 'string') out.baseURL = raw.baseURL;
    }
    return out;
  }

  function saveSettings(s) {
    s = s || {};
    return writeJson(K_SETTINGS, {
      providerId: s.providerId || 'deepseek',
      apiKey: s.apiKey || '',
      model: s.model || '',
      baseURL: s.baseURL || '',
    });
  }

  /* ---------- 输入草稿 ---------- */

  function loadDraft() {
    var raw = readJson(K_DRAFT, null);
    if (!raw || typeof raw !== 'object') return null;
    return {
      level: raw.level || 'auto',
      title: String(raw.title || ''),
      text: String(raw.text || ''),
      pasteBox: String(raw.pasteBox || ''),
      imageCount: raw.imageCount || 0,
      ts: raw.ts || 0,
    };
  }

  function saveDraft(d) {
    return writeJson(K_DRAFT, {
      level: (d && d.level) || 'auto',
      title: String((d && d.title) || ''),
      text: String((d && d.text) || ''),
      pasteBox: String((d && d.pasteBox) || ''),
      imageCount: (d && d.imageCount) || 0,
      ts: (d && d.ts) || 0,
    });
  }

  function clearDraft() {
    var s = ls();
    if (!s) return;
    try { s.removeItem(K_DRAFT); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 历史记录 ---------- */

  function loadHistoryIndex() {
    var s = ls();
    if (!s) return [];
    var rawStr = null;
    try { rawStr = s.getItem(K_INDEX); } catch (e) { return []; }
    if (rawStr == null) return [];
    var arr = null;
    try { arr = JSON.parse(rawStr); } catch (e) { arr = null; }
    if (!Array.isArray(arr)) {
      try { s.removeItem(K_INDEX); } catch (e) { /* 忽略 */ }   // 清除坏键
      return [];
    }
    return arr.filter(function (e) { return e && typeof e.id === 'string'; });
  }

  function getEntry(id) {
    return readJson(K_ENTRY_PREFIX + id, null);
  }

  /**
   * 新增一条历史。返回 { saved: true } 或 { saved: false, reason: 'quota' }。
   * 规则：reportMd 超 40KB 截断并标注；超过 100 条淘汰最旧；
   * 写入配额不足时循环淘汰最旧条目重试（保证新记录能写入）。
   */
  function addEntry(entry) {
    var s = ls();
    if (!s) return { saved: false, reason: 'quota' };
    entry = entry || {};
    var ts = entry.ts || 0;
    var id = entry.id
      ? String(entry.id)
      : String(ts) + '-' + Math.random().toString(36).slice(2, 8);
    var reportMd = String(entry.reportMd || '');
    var truncated = false;
    if (reportMd.length > REPORT_MAX) { reportMd = reportMd.slice(0, REPORT_MAX); truncated = true; }
    var essay = String(entry.essay || '');
    var full = {
      id: id,
      ts: ts,
      level: entry.level || '自动推断',
      title: String(entry.title || ''),
      words: entry.words == null ? 0 : entry.words,
      optimizedWords: entry.optimizedWords == null ? null : entry.optimizedWords,
      scores: entry.scores || null,
      source: entry.source || 'auto',
      status: entry.status || 'complete',
      essay: essay,
      reportMd: reportMd,
    };
    if (truncated) full.truncated = true;
    var meta = {
      id: id, ts: ts, level: full.level, title: full.title, words: full.words,
      optimizedWords: full.optimizedWords, scores: full.scores,
      source: full.source, status: full.status,
      size: essay.length + reportMd.length,
    };

    var index = loadHistoryIndex();
    index.unshift(meta);
    while (index.length > HISTORY_MAX) {          // 条数上限：淘汰最旧
      var victim = index.pop();
      try { s.removeItem(K_ENTRY_PREFIX + victim.id); } catch (e) { /* 忽略 */ }
    }

    var dropList = index.slice();                 // 新在前 → 从末尾（最旧）开始淘汰
    while (true) {
      var okEntry = false, okIndex = false;
      try { s.setItem(K_ENTRY_PREFIX + id, JSON.stringify(full)); okEntry = true; } catch (e) { /* 配额不足 */ }
      if (okEntry) {
        try { s.setItem(K_INDEX, JSON.stringify(index)); okIndex = true; } catch (e) { /* 配额不足 */ }
      }
      if (okEntry && okIndex) return { saved: true };
      var victim2 = dropList.pop();
      if (!victim2 || victim2.id === id) return { saved: false, reason: 'quota' };
      try { s.removeItem(K_ENTRY_PREFIX + victim2.id); } catch (e) { /* 忽略 */ }
      index = index.filter(function (x) { return x.id !== victim2.id; });
    }
  }

  function deleteEntry(id) {
    var s = ls();
    if (!s) return;
    try { s.removeItem(K_ENTRY_PREFIX + id); } catch (e) { /* 忽略 */ }
    var index = loadHistoryIndex().filter(function (x) { return x.id !== id; });
    writeJson(K_INDEX, index);
  }

  function clearHistory() {
    var s = ls();
    if (!s) return;
    var index = loadHistoryIndex();
    for (var i = 0; i < index.length; i++) {
      try { s.removeItem(K_ENTRY_PREFIX + index[i].id); } catch (e) { /* 忽略 */ }
    }
    try { s.removeItem(K_INDEX); } catch (e) { /* 忽略 */ }
  }

  var api = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadDraft: loadDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    loadHistoryIndex: loadHistoryIndex,
    getEntry: getEntry,
    addEntry: addEntry,
    deleteEntry: deleteEntry,
    clearHistory: clearHistory,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).store = api;
})(typeof self !== 'undefined' ? self : globalThis);
