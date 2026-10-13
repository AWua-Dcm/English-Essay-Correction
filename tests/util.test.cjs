'use strict';
const test = require('node:test');
const assert = require('node:assert');
const util = require('../assets/js/util.js');

test('escapeHtml 转义全部关键字符', () => {
  assert.strictEqual(util.escapeHtml(`<img src="x" onerror='a&b'>`),
    '&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;');
});

test('wordCount 处理缩写/连字符/数字/连续空格', () => {
  // 设计文档 §8 正则为 [A-Za-z]+(?:['’-][A-Za-z]+)*：数字与破折号不计入
  assert.strictEqual(util.wordCount("Don't  worry —  it's well-known, 42 times!"), 5);
  assert.strictEqual(util.wordCount("it's a well-known issue"), 4);
  assert.strictEqual(util.wordCount(''), 0);
  assert.strictEqual(util.wordCount('   \n\n  '), 0);
});

test('formatDate / formatDateShort 零填充', () => {
  const ts = new Date(2026, 0, 5, 9, 7).getTime();
  assert.strictEqual(util.formatDateShort(ts), '2026-01-05');
  assert.strictEqual(util.formatDate(ts), '2026-01-05 09:07');
});

test('truncate 不超长且加省略号', () => {
  assert.strictEqual(util.truncate('abcdef', 4), 'abc…');
  assert.strictEqual(util.truncate('abc', 4), 'abc');
});

test('debounce 合并连续调用（窗口内多次调用只执行一次）', async () => {
  let n = 0; const d = util.debounce(() => { n++; }, 10);
  d(); d(); d();
  assert.strictEqual(n, 0);
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(n, 1);
});

test('isWeChatOrQQ 识别微信与 QQ UA', () => {
  assert.strictEqual(util.isWeChatOrQQ('... MicroMessenger/8.0 ...'), true);
  assert.strictEqual(util.isWeChatOrQQ('Mozilla/5.0 ... QQ/8.9'), true);
  assert.strictEqual(util.isWeChatOrQQ('Mozilla/5.0 Chrome/120'), false);
});

test('isHeic 按扩展名与 MIME 判断（iOS 空 type 不误判）', () => {
  assert.strictEqual(util.isHeic({ name: 'IMG_1.HEIC', type: '' }), true);
  assert.strictEqual(util.isHeic({ name: 'a.heif', type: '' }), true);
  assert.strictEqual(util.isHeic({ name: 'x', type: 'image/heic' }), true);
  assert.strictEqual(util.isHeic({ name: 'a.jpg', type: '' }), false);
});

test('imagePolicy 判定优先级：heic > size > type（空 type 放行）', () => {
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.heic', type: '', size: 10 }),
    { accept: false, reason: 'heic' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 }),
    { accept: false, reason: 'size' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.gif', type: 'image/gif', size: 10 }),
    { accept: false, reason: 'type' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'IMG_2', type: '', size: 5 * 1024 * 1024 }),
    { accept: true });
});

test('copyText 降级链：clipboard 失败走 execCommand，两者失败返回 false', async () => {
  // Node 24 的 globalThis.navigator 为 getter-only，必须用 defineProperty 注入
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const mk = (clipboardOk, execOk) => {
    setGlobal('navigator', { clipboard: clipboardOk ? { writeText: async () => {} } : { writeText: async () => { throw new Error('x'); } } });
    setGlobal('document', { execCommand: () => execOk, createElement: () => ({ style: {}, select() {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } });
  };
  mk(true, false);  assert.strictEqual(await util.copyText('t'), true);
  mk(false, true);  assert.strictEqual(await util.copyText('t'), true);
  mk(false, false); assert.strictEqual(await util.copyText('t'), false);
});

test('copyTextCompat 同步降级路径（execCommand）', () => {
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  setGlobal('document', { execCommand: () => true, createElement: () => ({ style: {}, select() {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } });
  assert.strictEqual(util.copyTextCompat('t'), true);
  setGlobal('document', { execCommand: () => false, createElement: () => ({ style: {}, select() {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } });
  assert.strictEqual(util.copyTextCompat('t'), false);
  setGlobal('document', { createElement: () => { throw new Error('x'); } });
  assert.strictEqual(util.copyTextCompat('t'), false);
});

test('wordBadge 三态与官方区间（含 0 词与纯图片）', () => {
  assert.deepStrictEqual(util.wordBadge({ level: 'cet4', count: 130, imageCount: 0 }),
    { text: '130 词 · 达标', status: 'ok' });
  assert.deepStrictEqual(util.wordBadge({ level: 'cet4', count: 100, imageCount: 0 }),
    { text: '100 词 · 偏少 20 词', status: 'low' });
  assert.deepStrictEqual(util.wordBadge({ level: 'cet6', count: 214, imageCount: 0 }),
    { text: '214 词 · 偏多 14 词', status: 'high' });
  assert.deepStrictEqual(util.wordBadge({ level: 'auto', count: 143, imageCount: 0 }),
    { text: '143 词 · 四级 120–180 / 六级 150–200', status: 'info' });
  assert.deepStrictEqual(util.wordBadge({ level: 'cet4', count: 0, imageCount: 0 }),
    { text: '0 词', status: 'info' });
  assert.deepStrictEqual(util.wordBadge({ level: 'cet4', count: 0, imageCount: 2 }),
    { text: '图片作文 2 张 · 词数以识别结果为准', status: 'info' });
});
