'use strict';
const test = require('node:test');
const assert = require('node:assert');
const prompt = require('../assets/js/prompt.js');
const providers = require('../assets/js/providers.js');

test('TEMPLATE 逐字包含关键要素（步骤与硬性要求）', () => {
  for (const s of ['大学英语四六级作文阅卷导师', '步骤①：总分与分项打分', '内容完整性 __/5',
    '步骤②：逐条点评扣分点', '无直接原句', '步骤③：给出可落地的修改建议', '步骤④：提供优化版本',
    '四级 120-180 词，六级 150-200 词', '【硬性要求】', '客观评分，不虚高、不刻意压分',
    '步骤②必须引用原文原句，不得编造', '不要直接给一篇全新作文', '不要只给结论',
    '请根据作文内容推断，并先说明你的推断', '请先准确识别图片中的英文内容']) {
    assert.ok(prompt.TEMPLATE.includes(s), `模板缺少: ${s}`);
  }
});

test('PROTOCOL 包含输出协议关键要素', () => {
  for (const s of ['必须包含且仅包含一个 JSON 代码块', '"status":"ok"', '"status":"unreadable"',
    '四项之和必须等于 total', '### 优化版本正文', '### 主要改动点', '不要输出你的思考过程或分析过程',
    '若上文提供了【网页统计词数】的有效数值，以它为准']) {
    assert.ok(prompt.PROTOCOL.includes(s), `协议缺少: ${s}`);
  }
});

test('组装后的提示词不含仓库管理语言（防脚手架泄漏）', () => {
  const all = prompt.buildSystemPrompt() + prompt.buildMetaBlock({ level: '四级', title: '', text: 'x', images: 0 }) + prompt.buildCopyText({ level: '四级', title: '', text: 'x', images: 0 });
  for (const banned of ['GitHub', 'github', '仓库', '推送', 'Pages']) {
    assert.ok(!all.includes(banned), `泄漏了: ${banned}`);
  }
});

test('buildSystemPrompt = TEMPLATE + PROTOCOL', () => {
  assert.strictEqual(prompt.buildSystemPrompt(), prompt.TEMPLATE + '\n\n' + prompt.PROTOCOL);
});

test('元信息三态字符串', () => {
  const t = prompt.buildMetaBlock({ level: '四级', title: '我的作文', text: 'hello', images: 0 });
  assert.ok(t.includes('【考试级别】四级'));
  assert.ok(t.includes('【作文题目】我的作文'));
  assert.ok(t.includes('【网页统计词数】1 词（四级要求 120-180 词）'));

  const a = prompt.buildMetaBlock({ level: 'auto', title: '', text: 'hello world', images: 0 });
  assert.ok(a.includes('未提供，请依据作文内容推断，并先说明你的推断'));
  assert.ok(a.includes('未提供，请依据作文内容推断'));            // 题目
  assert.ok(a.includes('2 词（级别未提供；请按你推断的级别对照达标：四级 120–180 词，六级 150–200 词）'));

  const i = prompt.buildMetaBlock({ level: '六级', title: 'T', text: '', images: 2 });
  assert.ok(i.includes('未提供（作文以图片形式提交，请依据图片自行估算词数，并注明为"估算"）'));
  assert.ok(i.includes('（见附图，共 2 张）'));
});

test('buildCopyText 含三段结构与图片提示', () => {
  const c = prompt.buildCopyText({ level: '六级', title: 'T', text: '', images: 1 });
  assert.ok(c.includes('===== 批改要求（必须全部遵守）====='));
  assert.ok(c.includes('===== 作文信息 ====='));
  assert.ok(c.includes('===== 学生作文 ====='));
  assert.ok(c.includes('（见本对话中的作文照片，共 1 张）'));
});

test('displayText 隐藏开头分数围栏', () => {
  const ok = '```json\n{"status":"ok","total":12}\n```\n\n## 步骤① 总分与分项\n正文';
  assert.ok(prompt.displayText(ok).startsWith('## 步骤①'));
  assert.strictEqual(prompt.displayText('```json\n{"status"'), '');          // 未闭合短内容 → 全隐
  assert.ok(prompt.displayText('## 正文\n没有围栏').startsWith('## 正文'));
});

test('providers 预设完整性', () => {
  assert.ok(providers.PROVIDERS.length >= 7);
  for (const p of providers.PROVIDERS) {
    for (const k of ['id','name','baseURL','defaultModel','visionModels','browserDirect','contextWindow','maxOutput','lastChecked']) {
      assert.ok(k in p, `${p.id} 缺字段 ${k}`);
    }
  }
  assert.strictEqual(providers.byId('deepseek').browserDirect, 'verified');
  assert.strictEqual(providers.byId('siliconflow').browserDirect, 'partial');
  assert.strictEqual(providers.byId('openai').browserDirect, 'proxy-required');
  assert.strictEqual(providers.byId(providers.DEFAULT_PROVIDER_ID).id, 'deepseek');
});
