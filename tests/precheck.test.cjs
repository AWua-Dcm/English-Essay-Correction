'use strict';
const test = require('node:test');
const assert = require('node:assert');
const precheck = require('../assets/js/precheck.js');
const prompt = require('../assets/js/prompt.js');

const ESSAY = [
  'Nowadays, with the development of society, online learning is playing a more and more important role in our daily life.',
  'As we all know, we can get more knowledge from the Internet. Many people think that it is very useful. Many people use it every day.',
  'In conclusion, online learning is important and we should make good use of it. We can let us learn better.',
].join('\n\n');

test('字数扣分与官方表一致（含低端陡增段，不是线性规则）', () => {
  // 四级
  assert.strictEqual(precheck.deductionFor('四级', 130).deduct, 0, '达标不应扣分');
  assert.strictEqual(precheck.deductionFor('四级', 120).deduct, 0, '120 词是达标下限');
  assert.strictEqual(precheck.deductionFor('四级', 115).deduct, 1);
  assert.strictEqual(precheck.deductionFor('四级', 95).deduct, 3);
  assert.strictEqual(precheck.deductionFor('四级', 55).deduct, 7);
  assert.strictEqual(precheck.deductionFor('四级', 45).deduct, 9, '四级 ≤49 词应扣 9（陡增段）');
  // 六级
  assert.strictEqual(precheck.deductionFor('六级', 145).deduct, 1);
  assert.strictEqual(precheck.deductionFor('六级', 85).deduct, 7);
  assert.strictEqual(precheck.deductionFor('六级', 75).deduct, 9, '六级 ≤79 词应扣 9（陡增段）');
  // 线性规则会给 45 词扣 8 分，官方表是 9 —— 这正是必须查表而非算差值的原因
  assert.notStrictEqual(precheck.deductionFor('四级', 45).deduct, 8);
});

test('预检绝不产出分数（这是刻意的设计约束）', () => {
  const a = precheck.analyze(ESSAY, '四级');
  // 结果里允许出现"扣分"（那是官方表的确定性查表结果），但不得出现任何档位或总分判断
  for (const k of ['total', 'score', 'band', 'tier', 'grade', 'level_band']) {
    assert.strictEqual(a[k], undefined, `预检结果不应含 ${k}`);
  }
  assert.strictEqual(a.level, '四级', 'level 只回显传入的级别，不是判定');
  const text = precheck.format(a);
  assert.ok(!/总分为|总分是|\/15 分|分档/.test(text), '预检文本不得暗示档位结论');
  assert.ok(text.includes('这些是事实而非评分'), '必须显式声明不产出评分');
  assert.ok(text.includes('档位判断仍由你完成'), '必须把定档责任交回模型');
});

test('套话检测命中确切短语，供批改时直接引用', () => {
  const a = precheck.analyze(ESSAY, '四级');
  const phrases = a.cliches.map((c) => c.phrase);
  assert.ok(phrases.includes('with the development of society'), '未检出常见开场套话');
  assert.ok(phrases.includes('more and more'));
  assert.ok(phrases.includes('as we all know'));
  assert.ok(phrases.includes('get more knowledge'));
  assert.ok(phrases.includes('can let us'));
  const m = a.cliches.find((c) => c.phrase === 'more and more');
  assert.ok(m.count >= 1);
});

test('套话匹配按词边界，不会误伤更长的词', () => {
  const a = precheck.analyze('In my opinions, more and moreish text.', '四级');
  const phrases = a.cliches.map((c) => c.phrase);
  assert.ok(!phrases.includes('more and more'), 'more and moreish 不应命中 more and more');
  assert.ok(!phrases.includes('in my opinion'), 'opinions 不应命中 in my opinion');
});

test('结构统计：段数、结论段标记、句式类别', () => {
  const a = precheck.analyze(ESSAY, '四级');
  assert.strictEqual(a.paras, 3, '按空行分段');
  assert.strictEqual(a.conclusionMarker, 'in conclusion');
  assert.ok(a.syntaxCategories >= 1, '应检出至少一类句式');
  assert.ok(a.sentences >= 3);
  assert.ok(a.sentenceLength.mean > 0);
});

test('未分段文本不臆造段数', () => {
  const a = precheck.analyze('One blob of text. With several sentences. But no blank lines at all.', '四级');
  assert.strictEqual(a.paras, 1);
  assert.strictEqual(a.conclusionMarker, null, '没有结论标记就不应报有');
});

test('高频重复词统计', () => {
  const a = precheck.analyze('people people people people walk. people people run.', '四级');
  const rep = a.repeats.find((r) => r.word === 'people');
  assert.ok(rep, '应检出高频词 people');
  assert.ok(rep.count >= 4);
});

test('级别未定时不擅自按四级判定达标', () => {
  const a = precheck.analyze(ESSAY, 'auto');
  assert.strictEqual(a.level, null);
  assert.strictEqual(a.range, null);
  assert.strictEqual(a.deduction, 0, '级别未定不应凭空扣分');
  const text = precheck.format(a);
  assert.ok(text.includes('级别未定'), '应显式标注级别未定');
});

test('空正文返回空串，预检失败不阻断批改', () => {
  assert.strictEqual(precheck.format(precheck.analyze('', '四级')), '');
  assert.strictEqual(precheck.format(null), '');
  assert.strictEqual(precheck.format(precheck.analyze(null, '四级')), '');
});

test('预检结论注入两种模式的指令', () => {
  const opts = { level: '四级', title: 'T', text: ESSAY, images: 0 };
  const copy = prompt.buildCopyText(opts);
  assert.ok(copy.includes('【网页客观预检】'), '复制模式缺少预检');
  assert.ok(copy.includes('这些是事实而非评分'));
  const meta = prompt.buildMetaBlock(opts);
  assert.ok(meta.includes('【网页客观预检】'), '自动模式缺少预检');
  // 预检必须排在作文之前，模型先看到事实再读作文
  assert.ok(copy.indexOf('【网页客观预检】') < copy.indexOf('===== 学生作文 ====='));
});

test('纯图片作文不注入预检（无正文可统计）', () => {
  const opts = { level: '六级', title: 'T', text: '', images: 2 };
  assert.ok(!prompt.buildMetaBlock(opts).includes('【网页客观预检】'));
  assert.ok(prompt.buildMetaBlock(opts).includes('（见附图，共 2 张）'), '原有图片提示不受影响');
});

test('预检注入不破坏既有元信息三态', () => {
  const t = prompt.buildMetaBlock({ level: '四级', title: '我的作文', text: 'hello', images: 0 });
  assert.ok(t.includes('【考试级别】四级'));
  assert.ok(t.includes('【作文题目】我的作文'));
  assert.ok(t.includes('【网页统计词数】1 词（四级要求 120-180 词）'));
});
