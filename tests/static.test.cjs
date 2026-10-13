'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const doc = new JSDOM(html).window.document;

test('相对路径硬约束', () => {
  assert.ok(!/(src|href)\s*=\s*"\/[^"]/.test(html), '出现以 / 开头的资源引用');
  assert.ok(!html.includes('awua-dcm.github.io'), '写死了部署域名');
});

test('脚本加载顺序', () => {
  const order = [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src').split('?')[0]);
  assert.deepStrictEqual(order, [
    'assets/js/util.js',
    // precheck.js 必须在 prompt.js 之前：prompt 组装指令时会读取 EEC.precheck
    'assets/js/precheck.js', 'assets/js/render.js', 'assets/js/providers.js', 'assets/js/prompt.js',
    'assets/js/api.js', 'assets/js/store.js', 'assets/js/exporter.js',
    // ocr.js 只是薄壳（引擎约 6.7MB 在首次点击识别时才懒加载），
    // 但必须排在 app.js 之前，app.js 启动时会读取 EEC.ocr
    'assets/js/ocr.js', 'assets/js/demo.js', 'assets/js/app.js',
  ]);
});

test('打印与缓存策略：@page A4/18mm、资源版本串、hidden 硬约束', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/, '缺少 [hidden] 硬约束（会被 display:flex 等覆盖）');
  assert.match(css, /@page\s*\{[^}]*size:\s*A4/, 'style.css 缺少 @page A4');
  assert.match(css, /@page\s*\{[^}]*margin:\s*18mm/, 'style.css 缺少 18mm 页边距');
  const exp = fs.readFileSync(path.join(__dirname, '../assets/js/exporter.js'), 'utf8');
  assert.match(exp, /@page\s*\{[^}]*A4[^}]*18mm/, '导出 HTML 缺少 @page A4/18mm');
  // 全部资源引用带 ?v=YYYYMMDD 版本串（缓存失效步骤）
  const refs = [...doc.querySelectorAll('link[href], script[src]')];
  assert.ok(refs.length >= 10);
  for (const el of refs) {
    const u = el.getAttribute('href') || el.getAttribute('src');
    assert.match(u, /\?v=\d{8}(-\d+)?$/, `${u} 缺少 ?v= 版本串`);
  }
});

test('DOM 契约元素齐全', () => {
  const ids = ['mode-strip','help-open','history-open','btn-clear-title','btn-clear-text','first-run-card','first-run-close','file-banner','wechat-banner',
    'level-pills','essay-title','essay-text','word-badge','image-input-camera','image-input-gallery',
    'image-thumbs','sticky-actions','btn-grade','btn-copy-prompt','btn-demo',
    'copy-panel','copy-prompt-preview','btn-copy-text','paste-box','btn-render-paste','paste-warning','btn-render-anyway','copy-tip',
    'report-area','report-nav','nav-top','scorecard','parse-note','report-body','report-toolbar',
    'btn-print','btn-export-md','btn-export-html','btn-regrade','stream-status','btn-stop',
    'btn-back-latest','truncation-banner','drawer-backdrop','settings-drawer','sel-provider','inp-key',
    'btn-toggle-key','inp-model','inp-baseurl','btn-test-conn','btn-save-settings','btn-clear-data',
    'preset-date','history-drawer','history-list','btn-clear-history','toast','live-status'];
  for (const id of ids) assert.ok(doc.getElementById(id), `缺少 #${id}`);
});

test('移动端与可访问性要素', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.strictEqual(doc.getElementById('live-status').getAttribute('aria-live'), 'polite');
  assert.match(html, /role="dialog"/);
});

test('页脚承诺文案与免责声明', () => {
  assert.ok(html.includes('复制模式'));
  assert.ok(html.includes('仅供学习参考'));
  assert.ok(html.includes('图片作文'));
  assert.ok(html.includes('不会离开'));
});

test('README 必需小节齐全', () => {
  const md = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  for (const s of ['快速开始', '两种批改模式', '免费', 'API Key 申请', '常见问题',
    '复制模式', '离线', 'zip', '维护', '隐私', '免责', '更新']) {
    assert.ok(md.includes(s), `README 缺少: ${s}`);
  }
});
