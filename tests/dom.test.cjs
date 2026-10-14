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

/* ================= Task 12：复制模式 / 导出 / 抽屉 ================= */

test('复制模式全链路：杂乱真实形态依旧渲染（标题变体/列表内引用/无 [DONE]/寒暄）', async () => {
  const { $, $all, click, type } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  type($('#essay-text'), 'word '.repeat(130).trim());
  click($('#btn-copy-prompt'));
  assert.ok(!$('#copy-panel').hidden);
  assert.ok($('#copy-prompt-preview').value.includes('===== 批改要求（必须全部遵守）====='));
  // 模拟从聊天应用粘回的结果（Markdown 退化 + 寒暄）
  const messy = '好的，以下是批改报告：\n\n### 步骤 1 总分与分项\n总分 12 / 15\n\n' +
    '### 步骤2 逐条扣分点\n1. 问题类型：语法\n> He go to school everyday.\n\n' +
    '### 步骤三 修改建议\n建议修改主谓一致。\n\n### 步骤④ 优化版本\n### 优化版本正文\n' + 'word '.repeat(128).trim() + '\n### 主要改动点\n- a\n- b\n\n希望有帮助！';
  type($('#paste-box'), messy);
  click($('#btn-render-paste'));
  assert.strictEqual($all('#report-body .step-card').length, 4, '标题变体未识别');
  assert.ok($('#report-body').textContent.includes('He go to school everyday.'));
  assert.match($('#report-body').textContent, /优化版 128 词 · 达标/);
});

test('粘贴内容缺失标题 → 黄色确认条，确认后仍能渲染', async () => {
  const { $, $all, click, type } = await loadApp({});
  type($('#paste-box'), '这是一段没有任何标题的批改文字。');
  click($('#btn-render-paste'));
  assert.ok($('#paste-warning').hidden === false);
  click($('#btn-render-anyway'));
  assert.ok($('#report-body').textContent.includes('没有任何标题'));
});

test('剪贴板全失败 → 展开预览选中 + 提示，绝不显示"已复制✓"', async () => {
  const { $, click, type, window } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  window.navigator.clipboard = undefined; window.document.execCommand = () => false;
  type($('#essay-text'), 'x');
  click($('#btn-copy-prompt')); click($('#btn-copy-text'));
  assert.ok(!$('#btn-copy-text').textContent.includes('✓'));
  assert.match($('#toast').textContent, /Ctrl\+C|长按/);
});

test('历史抽屉：列表、载入、删除', async () => {
  const seed = [{ id: 'e1', ts: 1000, level: '四级', title: 'T', words: 130, optimizedWords: 132, scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 }, source: 'auto', status: 'complete', size: 10 }];
  const { $, $all, click } = await loadApp({ localStorage: {
    'eec.history.index.v1': JSON.stringify(seed),
    'eec.history.v1.e1': JSON.stringify({ ...seed[0], essay: 'essay', reportMd: REPORT_OK }),
  } });
  click($('#mode-strip'));                                      // 打开设置；历史另有入口
  click($('#history-open'));
  assert.strictEqual($all('#history-list .hist-item').length, 1);
  click($all('#history-list .hist-item .hist-load')[0]);
  assert.strictEqual($all('#report-body .step-card').length, 4);
  click($all('#history-list .hist-item .hist-del')[0]);
  assert.strictEqual($all('#history-list .hist-item').length, 0);
});

test('设置：服务商切换预设、保存后模式条更新', async () => {
  const { $, click, fireEvent } = await loadApp({});
  click($('#mode-strip'));
  const sel = $('#sel-provider'); sel.value = 'kimi'; fireEvent(sel, 'change');
  assert.strictEqual($('#inp-model').value, 'kimi-latest');
  assert.match($('#preset-date').textContent, /2026-10-13/);
  $('#inp-key').value = 'sk-test';
  click($('#btn-save-settings'));
  assert.match($('#mode-strip').textContent, /自动批改 · Kimi/);
});

test('抽屉无障碍：Esc 关闭并归还焦点', async () => {
  const { $, click, window } = await loadApp({});
  click($('#mode-strip'));
  assert.strictEqual($('#settings-drawer').getAttribute('aria-modal'), 'true');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok($('#settings-drawer').hidden);
});

/* ================= 审查修复（Round B）：超时 / 中断 / 假成功 / 门控 / 错误卡 ================= */

test('自动模式：120s 超时看门狗（测试注入短超时）→ 保留前文并标注已超时中断', async () => {
  const { $, click, stubFetch, flushAll, window } = await loadApp({ localStorage: { ...KEYED } });
  window.EEC.app._timing.streamTimeoutMs = 60;
  stubFetch({ chunks: sseChunks(REPORT_OK), chunkDelayMs: 300 });   // 慢流：超时先到
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade'));
  await flushAll({ ticks: 30, ms: 20 });
  assert.match($('#report-area').textContent, /已超时中断/);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1'))[0].status, 'stopped');
  assert.strictEqual($('#btn-grade').disabled, false);
});

test('自动模式：流内错误保留已生成内容并标注（不清空报告区、不丢历史）', async () => {
  const { $, click, stubFetch, flushAll } = await loadApp({ localStorage: { ...KEYED } });
  const inside = '## 步骤① 总分与分项\n总分：12 / 15\n内容完整性 4/5、篇章结构 3/4、词汇表达 2/3、语法准确性 3/3\n';
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: inside }, finish_reason: null }] }) + '\n\n',
    'data: {"error":{"message":"upstream reset"}}\n\n',
  ];
  stubFetch({ chunks });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await flushAll();
  assert.match($('#parse-note').textContent, /生成中断/);
  assert.ok($('#parse-note').textContent.includes('upstream reset'), '应附上服务商错误文本');
  assert.ok($('#report-body').textContent.includes('总分：12 / 15'), '已生成内容被清空');
  assert.strictEqual($('#report-body').querySelectorAll('.error-card').length, 0);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1')).length, 1);
});

test('自动模式：[DONE] 无 finish_reason 属正常结束（不误判为生成中断）', async () => {
  const { $, $all, click, stubFetch, flushAll } = await loadApp({ localStorage: { ...KEYED } });
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: REPORT_OK }, finish_reason: null }] }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  stubFetch({ chunks });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await flushAll();
  assert.ok(!$('#parse-note').textContent.includes('生成中断'), '误判为中断');
  assert.strictEqual($all('#report-body .step-card').length, 4);
});

test('复制面板提示条：失败不显示、成功才显示（绝不假成功）', async () => {
  const okApp = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  okApp.window.document.execCommand = () => true;
  okApp.type(okApp.$('#essay-text'), 'x');
  assert.ok(okApp.$('#copy-tip').hidden, '初始必须隐藏');
  okApp.click(okApp.$('#btn-copy-prompt'));
  assert.ok(!okApp.$('#copy-tip').hidden, '复制成功后才显示提醒条');

  const badApp = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  badApp.window.document.execCommand = () => false;
  badApp.type(badApp.$('#essay-text'), 'x');
  badApp.click(badApp.$('#btn-copy-prompt'));
  assert.ok(badApp.$('#copy-tip').hidden, '复制失败时提醒条必须保持隐藏');
});

test('无视觉模型 + 图片 + 本地识别也不可用 → 常驻警示卡（含按钮与推荐视觉模型）', async () => {
  const { $, $all, click, window } = await loadApp({ localStorage: { ...KEYED } });
  // 现在无识图能力时优先走本地 OCR；只有连 OCR 也不可用，才回到"换模型"的提示
  window.EEC.ocr.isSupported = () => false;
  window.EEC.app.state.images.push({ dataUrl: 'data:image/jpeg;base64,AAAA', name: 't.jpg' });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  assert.ok(!$('#vision-warn').hidden);
  const t = $('#vision-warn').textContent;
  assert.ok(t.includes('当前模型'), '应点名当前模型');
  assert.ok(t.includes('kimi-latest') || t.includes('qwen-vl-max') || t.includes('glm-4v-plus'), '应给出具体视觉模型');
  const btns = $all('#vision-warn button').map(b => b.textContent);
  assert.ok(btns.some(x => x.includes('打开设置')) && btns.some(x => x.includes('复制模式')));
});

test('自定义服务商 + 勾选支持视觉 → 图片不再被门控', async () => {
  const { $, click, stubFetch, flushAll, fireEvent, window } = await loadApp({});
  click($('#mode-strip'));
  const sel = $('#sel-provider'); sel.value = 'custom'; fireEvent(sel, 'change');
  $('#inp-baseurl').value = 'https://gw.example.com/v1';
  $('#inp-model').value = 'my-vl-model';
  $('#inp-key').value = 'sk-x';
  $('#chk-custom-vision').checked = true;
  click($('#btn-save-settings'));
  window.EEC.app.state.images.push({ dataUrl: 'data:image/jpeg;base64,AAAA', name: 't.jpg' });
  $('#essay-text').value = 'x';
  stubFetch({ status: 401, body: '{"error":{"message":"bad key"}}' });
  click($('#btn-grade'));
  await flushAll();
  // 门控放行：没有警示卡，且请求真正发出（得到 401 错误卡）
  assert.ok($('#vision-warn').hidden, '不应再被视觉门控拦截');
  assert.match($('#report-area').textContent, /API Key 无效/);
});

test('错误卡：402/429 含更换服务商按钮；去充值为可点动作', async () => {
  const a = await loadApp({ localStorage: { ...KEYED } });
  a.stubFetch({ status: 402, body: '{"error":{"message":"no balance"}}' });
  a.$('#essay-text').value = 'x';
  a.click(a.$('#btn-grade'));
  await a.flushAll();
  const btns = a.$all('#report-area button').map(b => b.textContent);
  assert.ok(btns.some(t => t.includes('去充值')), '402 应有去充值');
  assert.ok(btns.some(t => t.includes('更换服务商')), '402 应有更换服务商');

  const b = await loadApp({ localStorage: { ...KEYED } });
  b.stubFetch({ status: 429, body: '{"error":{"message":"rate limited"}}' });
  b.$('#essay-text').value = 'x';
  b.click(b.$('#btn-grade'));
  await b.flushAll();
  const btns2 = b.$all('#report-area button').map(x => x.textContent);
  assert.ok(btns2.some(t => t.includes('稍后重试')), '429 应有稍后重试');
  assert.ok(btns2.some(t => t.includes('更换服务商')), '429 应有更换服务商');
});

/* ================= 审查修复（Round C）：状态细节 ================= */

test('visibilitychange 立即保存草稿（不等防抖）', async () => {
  const { $, type, window } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  type($('#essay-text'), '紧急内容');
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  const d = JSON.parse(localStorage.getItem('eec.draft.v1') || 'null');
  assert.ok(d && d.text === '紧急内容', 'visibilitychange 未同步保存草稿');
});

test('空态：无作文无图片时两个主按钮禁用，输入后启用', async () => {
  const { $, type } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  assert.strictEqual($('#btn-grade').disabled, true);
  assert.strictEqual($('#btn-copy-prompt').disabled, true);
  type($('#essay-text'), 'x');
  assert.strictEqual($('#btn-grade').disabled, false);
  assert.strictEqual($('#btn-copy-prompt').disabled, false);
  type($('#essay-text'), '');
  assert.strictEqual($('#btn-grade').disabled, true);
});

test('status=unreadable → 警示卡含重新提交按钮（点击聚焦正文）', async () => {
  const { $, click, stubFetch, flushAll, window } = await loadApp({ localStorage: { ...KEYED } });
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '```json\n{"status":"unreadable","note":"图片无法辨认"}\n```\n图片太模糊。' }, finish_reason: 'stop' }] }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  stubFetch({ chunks });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await flushAll();
  assert.match($('#report-body').textContent, /图片无法辨认/);
  const btn = $('#report-body').querySelector('button');
  assert.ok(btn && btn.textContent.includes('重新提交'), '缺少重新提交按钮');
  click(btn);
  assert.strictEqual(window.document.activeElement, $('#essay-text'), '点击后应聚焦正文输入');
});

test('粘贴确认条：有分数 JSON 但缺标题同样拦截；[重新粘贴] 可回退', async () => {
  const { $, click, type } = await loadApp({});
  const jsonOnly = '```json\n{"status":"ok","total":12,"content":4,"structure":3,"vocab":2,"grammar":3}\n```\n这是一段没有标题的批改文字。';
  type($('#paste-box'), jsonOnly);
  click($('#btn-render-paste'));
  assert.strictEqual($('#paste-warning').hidden, false, '含分数 JSON 但缺标题也必须提示');
  const repaste = $('#btn-repaste');
  assert.ok(repaste, '缺少重新粘贴按钮');
  click(repaste);
  assert.ok($('#paste-warning').hidden);
});

test('历史行：状态标签与每行导出按钮', async () => {
  const seed = [
    { id: 'e1', ts: 1000, level: '四级', title: 'T1', words: 130, optimizedWords: 132, scores: null, source: 'paste', status: 'complete', size: 10 },
    { id: 'e2', ts: 2000, level: '六级', title: 'T2', words: 160, optimizedWords: 162, scores: null, source: 'auto', status: 'stopped', size: 10 },
  ];
  const { $, $all, click } = await loadApp({ localStorage: {
    'eec.history.index.v1': JSON.stringify(seed),
    'eec.history.v1.e1': JSON.stringify({ ...seed[0], essay: 'a', reportMd: REPORT_OK }),
    'eec.history.v1.e2': JSON.stringify({ ...seed[1], essay: 'b', reportMd: REPORT_OK }),
  } });
  click($('#history-open'));
  const metas = $all('#history-list .hist-meta').map(e => e.textContent);
  assert.ok(metas.some(m => m.includes('粘贴导入')), '缺少粘贴导入标签');
  assert.ok(metas.some(m => m.includes('已停止')), '缺少已停止标签');
  assert.strictEqual($all('#history-list .hist-export').length, 2, '每行应有导出按钮');
});

test('优化版切片缺失 → 未标注回退（不静默丢失）', async () => {
  const { $, click, type } = await loadApp({});
  const wrongHeading = '## 步骤① 总分与分项\n总分：12 / 15\n\n## 步骤② 逐条扣分点\n- a\n\n## 步骤③ 修改建议\n- b\n\n## 步骤④ 优化版本\n### 优化版正文\n' + 'word '.repeat(130).trim();
  type($('#paste-box'), wrongHeading);
  click($('#btn-render-paste'));
  const chip = $('#report-body').querySelector('.opt-chip');
  assert.ok(chip, '缺少回退徽章');
  assert.match(chip.textContent, /未标注/);
});

test('打印头包含档次', async () => {
  const { $, click, stubFetch, flushAll } = await loadApp({ localStorage: { ...KEYED } });
  stubFetch({ chunks: sseChunks(REPORT_OK) });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await flushAll();
  click($('#btn-print'));
  assert.match($('.print-head').textContent, /10-12分档/);
});

test('微信提示条可关闭并记忆', async () => {
  const app = await loadApp({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0' });
  assert.ok(!app.$('#wechat-banner').hidden);
  app.click(app.$('#wechat-close'));
  assert.ok(app.$('#wechat-banner').hidden);
  const again = await loadApp({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0', localStorage: { 'eec.wechat.v1': 'done' } });
  assert.ok(again.$('#wechat-banner').hidden, '已关闭状态应被记忆');
});

test('报告工具条：[复制报告全文] 可用', async () => {
  const { $, click, stubFetch, flushAll, window } = await loadApp({ localStorage: { ...KEYED } });
  stubFetch({ chunks: sseChunks(REPORT_OK) });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await flushAll();
  const btn = $('#btn-copy-report');
  assert.ok(btn, '缺少复制报告全文按钮');
  window.document.execCommand = () => true;
  click(btn);
  assert.match($('#toast').textContent, /复制/);
});

/* ================= 后续迭代：一键清除 ================= */

test('一键清除：题目与正文按钮（空态禁用，清除后同步状态）', async () => {
  const { $, click, type } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  const bt = $('#btn-clear-title');
  const be = $('#btn-clear-text');
  assert.ok(bt && be, '缺少清除按钮');
  assert.strictEqual(bt.disabled, true, '空题目时应禁用');
  assert.strictEqual(be.disabled, true, '空正文时应禁用');
  type($('#essay-title'), 'My Title');
  type($('#essay-text'), 'word '.repeat(130).trim());
  assert.strictEqual(bt.disabled, false, '有题目后应可用');
  assert.strictEqual(be.disabled, false, '有正文后应可用');
  click(bt);
  assert.strictEqual($('#essay-title').value, '');
  assert.strictEqual(bt.disabled, true);
  click(be);
  assert.strictEqual($('#essay-text').value, '');
  assert.match($('#word-badge').textContent, /^0 词$/);
  assert.strictEqual($('#btn-grade').disabled, true, '清空后主按钮回到禁用');
});

/* ================= 后续迭代：使用说明可再次展开 ================= */

test('使用说明：关闭后可一键再次展开（有 Key 时也可）', async () => {
  const app = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  assert.ok(!app.$('#first-run-card').hidden, '首次访问应显示引导卡');
  app.click(app.$('#first-run-close'));
  assert.ok(app.$('#first-run-card').hidden, '点知道了应隐藏');
  app.click(app.$('#help-open'));
  assert.ok(!app.$('#first-run-card').hidden, '点使用说明应再次展开');
  app.click(app.$('#first-run-close'));
  assert.ok(app.$('#first-run-card').hidden, '可再次关闭');

  const keyed = await loadApp({ localStorage: { ...KEYED } });
  assert.ok(keyed.$('#first-run-card').hidden, '有 Key 时启动自动隐藏');
  keyed.click(keyed.$('#help-open'));
  assert.ok(!keyed.$('#first-run-card').hidden, '有 Key 时也可手动展开使用说明');
});

/* ---------- 本地 OCR（免 Key 识图） ---------- */

test('OCR：模块已接入页面且接口完整', async () => {
  const { window } = await loadApp({});
  assert.ok(window.EEC.ocr, 'EEC.ocr 未挂载（ocr.js 加载顺序或路径有问题）');
  for (const k of ['isSupported', 'recognize', 'cleanText', 'gradeConfidence', 'advice']) {
    assert.strictEqual(typeof window.EEC.ocr[k], 'function', `缺少 ${k}`);
  }
});

test('OCR：无图片时不展示识别入口，注记默认隐藏', async () => {
  const { $ } = await loadApp({});
  assert.ok($('#ocr-row'), '缺少 #ocr-row');
  assert.ok($('#ocr-note'), '缺少 #ocr-note');
  assert.ok($('#btn-ocr'), '缺少 #btn-ocr');
  assert.ok($('#ocr-row').hidden, '无图片时应隐藏识别入口');
  assert.ok($('#ocr-note').hidden, '注记默认应隐藏');
  assert.ok($('#ocr-note-text'), '缺少 #ocr-note-text');
});

test('OCR：无图片直接点击 → 提示先添加图片，不发起识别', async () => {
  const { $, click, window } = await loadApp({});
  click($('#btn-ocr'));
  await new Promise(r => setTimeout(r, 0));
  assert.match($('#toast').textContent, /请先添加图片/);
  assert.ok(!window.EEC.app.state.ocrBusy, '不应进入识别中状态');
});

test('OCR：不支持时给出替代路径而不是静默失败', async () => {
  const { $, click, window } = await loadApp({});
  // 模拟老旧浏览器：无 WASM SIMD
  window.EEC.ocr.hasSimd = () => false;
  window.EEC.ocr.isSupported = () => false;
  window.EEC.app.state.images.push({ dataUrl: 'data:image/jpeg;base64,AAAA', name: 't.jpg' });
  click($('#btn-ocr'));
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!$('#ocr-note').hidden, '不支持时必须给出可见说明');
  const t = $('#ocr-note-text').textContent;
  assert.ok(t.includes('不支持'), '应说明不支持');
  assert.ok(t.includes('图片识别') || t.includes('粘贴'), '应给出替代路径');
});

test('OCR：警示卡按钮齐备（改用视觉模型 / 改用复制模式）', async () => {
  const { $, $all } = await loadApp({});
  const btns = $all('#ocr-note button').map(b => b.textContent);
  assert.ok(btns.some(x => x.includes('视觉模型')), '缺少改用视觉模型');
  assert.ok(btns.some(x => x.includes('复制模式')), '缺少改用复制模式');
});

/* ---------- 复制模式：粘贴指令而非报告 ---------- */

test('粘贴「批改指令」本身 → 明确告知，且不渲染空报告', async () => {
  const { $, $all, click, type, window } = await loadApp({});
  const instr = window.EEC.prompt.buildCopyText({ level: '四级', title: '', text: 'x', images: 0 });
  type($('#paste-box'), instr);
  click($('#btn-render-paste'));
  assert.ok(!$('#paste-warning').hidden, '未给出提示');
  assert.match($('#paste-warning-text').textContent, /批改指令/);
  assert.match($('#paste-warning-text').textContent, /AI/, '应说明该粘贴 AI 的回复');
  // 关键：不得渲染出四个空分节的骨架
  assert.strictEqual($all('.step-card').length, 0, '不应渲染任何步骤卡');
  // 更要紧：协议里含一段示例 JSON（total:12, 10-12分档），会被 extractScoreBlock 当成真分数。
  // 若放行，页面会显示一个看起来完全可信的 12/15 —— 学生会以为那是自己的成绩。
  assert.strictEqual($('#scorecard').innerHTML.trim(), '', '不得渲染来自示例 JSON 的评分卡');
  assert.ok(!$('#report-body').textContent.includes('12'), '报告区不应出现示例分数');
});

test('只粘贴到步骤标题没有正文 → 同样拦下', async () => {
  const { $, $all, click, type } = await loadApp({});
  type($('#paste-box'), '## 步骤① 总分与分项\n\n## 步骤② 逐条扣分点\n\n## 步骤③ 修改建议\n\n## 步骤④ 优化版本\n');
  click($('#btn-render-paste'));
  assert.ok(!$('#paste-warning').hidden, '应给出提示');
  assert.strictEqual($all('.step-card').length, 0, '不应渲染空步骤卡');
});

test('正常报告仍能渲染，且空分节被跳过', async () => {
  const { $, $all, click, type } = await loadApp({});
  const ok = '```json\n{"status":"ok","level":"四级","total":12,"tier":"10-12分档","content":4,"structure":3,"vocab":2,"grammar":3}\n```\n' +
    '## 步骤① 总分与分项\n内容完整性 4/5。\n\n## 步骤② 逐条扣分点\n1. 主谓不一致\n> Online learning have many advantages.\n\n' +
    '## 步骤③ 修改建议\n改成 has。\n\n## 步骤④ 优化版本\n### 优化版本正文\n' + 'word '.repeat(130).trim() + '\n\n### 主要改动点\n- 修正主谓一致';
  type($('#paste-box'), ok);
  click($('#btn-render-paste'));
  assert.ok($('#paste-warning').hidden, '正常报告不应触发警示');
  assert.strictEqual($all('.step-card').length, 4, '四个分节都应有正文');
});

/* ---------- 客观预检面板 ---------- */

test('预检面板：输入作文后显示确定性事实，且不出现任何分数结论', async () => {
  const { $, $all, type } = await loadApp({});
  assert.ok($('#precheck').hidden, '无正文时应隐藏');
  const essay = 'Nowadays, with the development of society, online learning is very important. ' +
    'Many people use it every day. In conclusion, we should use it well and study hard.';
  type($('#essay-text'), essay);
  assert.ok(!$('#precheck').hidden, '有正文后应显示预检');
  const t = $('#precheck').textContent;
  assert.match(t, /客观预检/);
  assert.match(t, /只给事实，不给分数/);
  assert.match(t, /字数 \d+ 词/);
  // 关键：面板不得给出档位或总分
  assert.ok(!/\/15|分档|总分/.test(t), '预检面板不得给出分数结论');
});

test('预检面板：套话与重复词来自作文，必须以纯文本渲染（防注入）', async () => {
  const { $, type } = await loadApp({});
  type($('#essay-text'), 'more and more more and more more and more people people people people. ' +
    'With the development of society we learn. As we all know we grow every single day.');
  const box = $('#precheck');
  assert.ok(!box.hidden);
  assert.strictEqual(box.querySelectorAll('script, img').length, 0, '不应生成任何标签节点');
  assert.match(box.textContent, /套话命中/);
  assert.match(box.textContent, /more and more/);
});

test('预检面板：级别未定时不给出达标结论', async () => {
  const { $, type } = await loadApp({});
  type($('#essay-text'), 'word '.repeat(130).trim());
  const t = $('#precheck').textContent;
  assert.match(t, /级别未定/, '自动级别下应标注级别未定');
  assert.ok(!/达标/.test(t), '级别未定不应下达标结论');
});

test('无视觉模型 + 图片 + 本地识别可用 → 不弹换模型警示卡，走本地识别', async () => {
  const { $, click, window } = await loadApp({ localStorage: { ...KEYED } });
  window.EEC.ocr.isSupported = () => true;
  // 桩掉识别：断言的是"分流到了 OCR 这条路"，不是识别本身
  let asked = false;
  window.EEC.ocr.recognize = () => { asked = true; return Promise.resolve({ text: '', confidence: 90, grade: 'good', advice: '' }); };
  window.EEC.app.state.images.push({ dataUrl: 'data:image/jpeg;base64,AAAA', name: 't.jpg' });
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(asked, '应调用本地识别，而不是直接拦住');
  assert.match($('#toast').textContent, /本地识别|转成文字/, '应告知正在改用本地识别');
});

test('OCR 文本注入批改指令时声明来源，避免识别误差被当成学生错误', async () => {
  const { window } = await loadApp({});
  const p = window.EEC.prompt;
  const meta = p.buildMetaBlock({ level: '四级', title: 'T', text: 'Some essay text here.', images: 0, fromOcr: true });
  assert.ok(meta.includes('【文字来源】'), '缺少来源声明');
  assert.ok(meta.includes('本地图片识别'), '未说明来自 OCR');
  assert.ok(meta.includes('疑似识别误差'), '未要求区分识别误差');
  // 非 OCR 来源不得出现该声明
  const plain = p.buildMetaBlock({ level: '四级', title: 'T', text: 'Some essay text here.', images: 0 });
  assert.ok(!plain.includes('【文字来源】'), '普通文本不应带 OCR 声明');
});

/* ---------- 复制模式：缺步骤时的可操作提示 ---------- */

test('报告缺少步骤 → 明确说出缺哪一步，而不是笼统说不完整', async () => {
  const { $, click, type } = await loadApp({});
  const partial = '```json\n{"status":"ok","level":"四级","total":12,"tier":"10-12分档","content":4,"structure":3,"vocab":2,"grammar":3}\n```\n' +
    '## 步骤① 总分与分项\n内容完整性 4/5。\n\n## 步骤② 逐条扣分点\n1. 主谓不一致\n> Online learning have many advantages.';
  type($('#paste-box'), partial);
  click($('#btn-render-paste'));
  const warn = $('#paste-warning-text').textContent;
  assert.ok(!$('#paste-warning').hidden, '应给出提示');
  assert.match(warn, /缺少步骤③、④/, '应点名缺哪几步');
  assert.match(warn, /仍然渲染/, '应给出继续的出口');
});

test('缺步骤时仍可点「仍然渲染」查看已有部分', async () => {
  const { $, $all, click, type } = await loadApp({});
  const partial = '## 步骤① 总分与分项\n内容完整性 4/5。\n\n## 步骤② 逐条扣分点\n1. 主谓不一致';
  type($('#paste-box'), partial);
  click($('#btn-render-paste'));
  assert.ok(!$('#paste-warning').hidden);
  click($('#btn-render-anyway'));
  assert.strictEqual($all('.step-card').length, 2, '已有的两个步骤应能渲染出来');
});
