'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./helpers.cjs');

test('启动：模式条文案（无 Key → 复制模式）', async () => {
  const { $ } = await loadApp({});
  assert.match($('#mode-strip').textContent, /复制模式（未配置 Key）/);
});

test('级别胶囊切换与词数徽章三态', async () => {
  const { $, $all, click, type } = await loadApp({});
  type($('#essay-text'), 'word '.repeat(130).trim());          // 130 词
  assert.match($('#word-badge').textContent, /130 词 · 四级 120–180 \/ 六级 150–200/);  // 自动推断
  click($all('.level-pill').find(b => b.dataset.level === 'cet4'));
  assert.match($('#word-badge').textContent, /130 词 · 达标/);
  type($('#essay-text'), 'word '.repeat(100).trim());
  assert.match($('#word-badge').textContent, /100 词 · 偏少 20 词/);
  assert.ok($('#word-badge').classList.contains('is-low'));
});

test('草稿恢复', async () => {
  const draft = JSON.stringify({ level: 'cet6', title: 'T', text: 'restored text', pasteBox: '', imageCount: 0, ts: 1 });
  const { $ } = await loadApp({ localStorage: { 'eec.draft.v1': draft } });
  assert.strictEqual($('#essay-text').value, 'restored text');
  assert.strictEqual($('#essay-title').value, 'T');
});

test('示例填充与首次引导卡关闭', async () => {
  const { $, click } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  click($('#btn-demo'));
  assert.ok($('#essay-text').value.length > 300);
  assert.ok($('#level-pills .level-pill.is-active'));
  click($('#first-run-close'));
  assert.ok($('#first-run-card').hidden || $('#first-run-card').classList.contains('is-hidden'));
});

test('微信 UA 显示提示条', async () => {
  const { $ } = await loadApp({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0' });
  assert.ok(!$('#wechat-banner').hidden);
});

/* ================= Task 11：自动模式全链路 ================= */

const REPORT_OK = '```json\n{"status":"ok","level":"四级","total":12,"content":4,"structure":3,"vocab":2,"grammar":3}\n```\n\n' +
  '## 步骤① 总分与分项\n总分：12 / 15\n内容完整性 **4/5**：切题但论证单薄。\n\n' +
  '## 步骤② 逐条扣分点\n1. 问题类型：中式英语\n> The society is become more better.\n2. 问题类型：连接词滥用\n> 无直接原句\n\n' +
  '## 步骤③ 修改建议\n- 怎么改：**society has become better**\n\n' +
  '## 步骤④ 优化版本\n### 优化版本正文\n' + 'word '.repeat(140).trim() + '\n\n### 主要改动点\n- 修正 be 动词；- 精简连接词';

function sseChunks(text, { finish = 'stop' } = {}) {          // 把报告切成流式 chunk
  const mid = Math.floor(text.length / 3);
  const parts = [text.slice(0, mid), text.slice(mid, mid * 2), text.slice(mid * 2)];
  return parts.map(p => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] }) + '\n\n')
    .concat('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\n\n', 'data: [DONE]\n\n');
}

const KEYED = { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-x', model: 'deepseek-chat', baseURL: '' }) };

test('自动模式全链路：评分卡/四步骤/剥离 JSON/历史/导出启用', async () => {
  const { $, $all, click, stubFetch, flushAll } = await loadApp({ localStorage: { ...KEYED } });
  stubFetch({ chunks: sseChunks(REPORT_OK) });
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade'));
  await flushAll();
  const card = $('#scorecard');
  assert.ok(card.innerHTML.includes('data-key="content"'));
  assert.ok(card.textContent.includes('10-12分档'));
  assert.strictEqual($all('#report-body .step-card').length, 4);
  assert.ok(!$('#report-body').innerHTML.includes('"total"'), 'JSON 泄漏到报告区');
  assert.ok($('#report-body').textContent.includes('The society is become more better.'));
  assert.match($('#report-body').textContent, /优化版 140 词 · 达标（四级要求 120–180 词）/);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1')).length, 1);
  assert.ok(!$('#btn-export-md').disabled);
});

test('自动模式：finish=length 显示截断横幅', async () => {
  const { $, click, stubFetch, flushAll } = await loadApp({ localStorage: { ...KEYED } });
  stubFetch({ chunks: sseChunks(REPORT_OK, { finish: 'length' }) });
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade')); await flushAll();
  assert.ok(!$('#truncation-banner').hidden);
  assert.match($('#truncation-banner').textContent, /截断/);
});

test('自动模式：401 → 错误卡（含两个行动按钮），按钮恢复可点', async () => {
  const { $, $all, click, stubFetch, flushAll } = await loadApp({ localStorage: { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'bad', model: 'm', baseURL: '' }) } });
  stubFetch({ status: 401, body: '{"error":{"message":"bad key"}}' });
  $('#essay-text').value = 'x';
  click($('#btn-grade')); await flushAll();
  assert.match($('#report-area').textContent, /API Key 无效/);
  const btns = $all('#report-area button').map(b => b.textContent);
  assert.ok(btns.some(t => t.includes('检查 Key')) && btns.some(t => t.includes('复制模式')));
  assert.strictEqual($('#btn-grade').disabled, false);
});

test('自动模式：中途停止 → 保留部分内容并标注，历史标记已停止', async () => {
  const { $, click, stubFetch, flushAll, fireEvent } = await loadApp({ localStorage: { ...KEYED } });
  stubFetch({ chunks: sseChunks(REPORT_OK), chunkDelayMs: 40 });   // 慢速流：保证停止时流未结束
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade'));
  await flushAll({ ticks: 3, ms: 10 });                            // 只推进前几拍（流未结束）
  fireEvent($('#btn-stop'), 'click');
  await flushAll({ ticks: 20, ms: 10 });
  assert.match($('#report-area').textContent, /已停止/);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1'))[0].status, 'stopped');
});

test('无 Key 点击开始批改 → 引导到复制模式', async () => {
  const { $, click } = await loadApp({});
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  assert.ok(!$('#copy-panel').hidden);
  assert.match($('#toast').textContent, /复制批改指令/);
});
