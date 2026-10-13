'use strict';
const test = require('node:test');
const assert = require('node:assert');

function freshStore(limitBytes) {          // 简易可限容 localStorage 模拟
  const map = new Map(); let used = 0;
  const ls = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const old = map.get(k) || ''; const next = used - old.length * 2 + v.length * 2;
      if (limitBytes && next > limitBytes) { const e = new Error('QuotaExceeded'); e.name = 'QuotaExceededError'; throw e; }
      used = next; map.set(k, v);
    },
    removeItem: k => { used -= (map.get(k) || '').length * 2; map.delete(k); },
    clear: () => { map.clear(); used = 0; },
  };
  // Node 24 的 localStorage（若存在）可能为 getter-only，沿用 defineProperty 注入
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  delete require.cache[require.resolve('../assets/js/store.js')];
  return require('../assets/js/store.js');
}

const mkEntry = (i, size = 200) => ({
  id: 'e' + i, ts: 1000 + i, level: '四级', title: 'T' + i, words: 130, optimizedWords: 135,
  scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 }, source: 'auto', status: 'complete',
  essay: 'essay' + i, reportMd: 'x'.repeat(size),
});

test('设置与草稿往返；损坏 JSON 安全降级', () => {
  const store = freshStore();
  assert.strictEqual(store.loadSettings().providerId, 'deepseek');
  store.saveSettings({ providerId: 'kimi', apiKey: 'k', model: 'm', baseURL: '' });
  assert.strictEqual(store.loadSettings().providerId, 'kimi');
  localStorage.setItem('eec.settings.v1', '{broken');
  assert.strictEqual(store.loadSettings().providerId, 'deepseek');

  store.saveDraft({ level: 'cet6', title: '', text: 'abc', pasteBox: '', imageCount: 0, ts: 1 });
  assert.strictEqual(store.loadDraft().text, 'abc');
  store.clearDraft(); assert.strictEqual(store.loadDraft(), null);
});

test('历史：增删查清与索引/分条一致', () => {
  const store = freshStore();
  store.addEntry(mkEntry(1)); store.addEntry(mkEntry(2));
  const idx = store.loadHistoryIndex();
  assert.deepStrictEqual(idx.map(e => e.id), ['e2', 'e1']);       // 新在前
  assert.strictEqual(store.getEntry('e1').essay, 'essay1');
  store.deleteEntry('e1');
  assert.strictEqual(store.getEntry('e1'), null);
  assert.strictEqual(store.loadHistoryIndex().length, 1);
  store.clearHistory(); assert.deepStrictEqual(store.loadHistoryIndex(), []);
});

test('历史：100 条上限淘汰最旧', () => {
  const store = freshStore();
  for (let i = 0; i < 105; i++) store.addEntry(mkEntry(i));
  assert.strictEqual(store.loadHistoryIndex().length, 100);
  assert.strictEqual(store.getEntry('e0'), null);
  assert.ok(store.getEntry('e104'));
});

test('历史：单条 reportMd 超 40KB 被截断并标注', () => {
  const store = freshStore();
  store.addEntry(mkEntry(1, 50 * 1024));
  const full = store.getEntry('e1');
  assert.strictEqual(full.truncated, true);
  assert.ok(full.reportMd.length < 42000);
});

test('历史：写满配额时淘汰最旧条目重试，新条目仍保存', () => {
  const store = freshStore(60 * 1024);                             // 约 30K 字符预算
  for (let i = 0; i < 10; i++) store.addEntry(mkEntry(i, 4 * 1024));
  const r = store.addEntry(mkEntry(99, 4 * 1024));                 // 需要挤掉旧条目
  assert.strictEqual(r.saved, true);
  assert.ok(store.getEntry('e99'));
  assert.ok(store.loadHistoryIndex().length < 11);
});

test('历史：索引损坏 → 返回空并清除坏键', () => {
  const store = freshStore();
  localStorage.setItem('eec.history.index.v1', 'garbage');
  assert.deepStrictEqual(store.loadHistoryIndex(), []);
  assert.strictEqual(localStorage.getItem('eec.history.index.v1'), null);
});
