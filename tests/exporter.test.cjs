'use strict';
const test = require('node:test');
const assert = require('node:assert');
const x = require('../assets/js/exporter.js');
const demo = require('../assets/js/demo.js');
const util = require('../assets/js/util.js');

const entry = {
  id: 'e1', ts: new Date(2026, 9, 13).getTime(), level: '六级', title: 'On Reading: A/B*C?',
  words: 155, optimizedWords: 162,
  scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 },
  source: 'auto', status: 'complete',
  essay: 'My essay text.', reportMd: '## 步骤① 总分与分项\n总分：12 / 15\n\n## 步骤② 逐条扣分点\n- 问题',
};

test('示例作文词数落在官方区间', () => {
  const c4 = util.wordCount(demo.SAMPLES.cet4.text);
  const c6 = util.wordCount(demo.SAMPLES.cet6.text);
  assert.ok(c4 >= 120 && c4 <= 180, `四级示例 ${c4} 词`);
  assert.ok(c6 >= 150 && c6 <= 200, `六级示例 ${c6} 词`);
});

test('toMarkdown 不含 json 围栏，含分数摘要', () => {
  const md = x.toMarkdown(entry);
  assert.ok(!md.includes('```json'));
  assert.ok(md.includes('总分：12 / 15') || md.includes('总分：12/15'));
  assert.ok(md.includes('On Reading'));
  assert.ok(md.includes('## 步骤① 总分与分项'));
});

test('toStandaloneHtml 单文件、无脚本、含免责与评分卡数值', () => {
  const html = x.toStandaloneHtml(entry);
  assert.ok(html.startsWith('<!doctype html'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('仅供学习参考'));
  assert.ok(html.includes('data-key="content"'));
  assert.ok(html.includes('>12<') || html.includes('12 / 15'));
});

test('reportFilename 净化非法字符与超长标题', () => {
  const f = x.reportFilename(entry);
  assert.ok(!/[\\/:*?"<>|]/.test(f));
  assert.ok(f.startsWith('批改报告_2026-10-13_六级_'));
  assert.ok(f.endsWith('.html'));
  const f2 = x.reportFilename({ ...entry, title: 'x'.repeat(50), level: '自动推断' });
  assert.ok(f2.includes('自动推断'));
  assert.ok(f2.length < 60);
});

test('scorecardHtml 结构完整（含档次与注记）', () => {
  const html = x.scorecardHtml({ scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 }, tier: '10-12分档', annotations: ['（测试注记）'] });
  for (const k of ['content', 'structure', 'vocab', 'grammar']) assert.ok(html.includes(`data-key="${k}"`));
  assert.ok(html.includes('10-12分档'));
  assert.ok(html.includes('四项得分之和即总分'));
  assert.ok(html.includes('（测试注记）'));
});

test('scorecardHtml 对分项数值也转义（防历史存储注入）', () => {
  const html = x.scorecardHtml({ scores: { total: 12, content: '<img src=x onerror=1>', structure: 3, vocab: 2, grammar: 3 }, tier: '10-12分档', annotations: [] });
  assert.ok(!html.includes('<img'));
});

test('导出含优化版判定（达标/偏少/偏多 + 区间）', () => {
  const withChip = { ...entry, optimizedInfo: { words: 190, verdict: '偏多 10 词', rangeText: '六级要求 150–200 词' } };
  const md = x.toMarkdown(withChip);
  assert.match(md, /偏多 10 词/);
  const html = x.toStandaloneHtml(withChip);
  assert.match(html, /偏多 10 词/);
});
