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

test('buildSystemPrompt = TEMPLATE + PROTOCOL + RUBRIC', () => {
  assert.strictEqual(
    prompt.buildSystemPrompt(),
    prompt.TEMPLATE + '\n\n' + prompt.PROTOCOL + '\n\n' + prompt.RUBRIC
  );
});

test('RUBRIC v3 采用官方五档对照法', () => {
  for (const s of ['官方评分办法', '总体印象评分', 'Global Scoring',
    '不按语言点错误数目扣分', '与某档相似即定该分', '±1 分',
    '14分档', '11分档', '8分档', '5分档', '2分档', '0分',
    '定档自查项', '用于确认，不用于算分',
    '四级（不足 120 词起算）', '六级（不足 150 词起算）',
    '49 及以下扣 9', '79 及以下扣 9',
    '不计入', '按比例扣分',
    '四项之和必须等于总分', '四项必须与总分档位自洽',
    '避免趋中倾向', '严禁默认给出 11-13 分']) {
    assert.ok(prompt.RUBRIC.includes(s), `标尺缺少: ${s}`);
  }
  // v2 的硬计数封顶与官方"不按语言点错误数目扣分"相抵触，不得残留
  assert.ok(!/破句密度/.test(prompt.RUBRIC), '仍残留 v2 的破句密度封顶');
  assert.ok(!/总分 ≤9/.test(prompt.RUBRIC), '仍残留 v2 的硬封顶');
  assert.ok(!/万能句占正文句子/.test(prompt.RUBRIC), '仍残留 v2 的万能句封顶');
});

test('RUBRIC 字数扣分与官方表一致（含低端陡增段）', () => {
  // 官方表不是"每少 10 词扣 1 分"的线性规则：≤49 词直接扣 9
  assert.ok(/49 及以下扣 9/.test(prompt.RUBRIC), '四级缺 49 词以下的陡增段');
  assert.ok(/79 及以下扣 9/.test(prompt.RUBRIC), '六级缺 79 词以下的陡增段');
  assert.ok(!/每少 10 词扣 1 分/.test(prompt.RUBRIC), '仍残留被简化的线性规则');
});

test('两种模式共用同一套批改规则（含标尺）', () => {
  const copy = prompt.buildCopyText({ level: '四级', title: 'T', text: 'x', images: 0 });
  assert.ok(copy.includes(prompt.RUBRIC), '复制模式缺少档位标尺');
  assert.ok(prompt.buildSystemPrompt().includes(prompt.RUBRIC), '自动模式缺少档位标尺');
});

test('TEMPLATE / PROTOCOL 仍是逐字正本（新增标尺不得改动它们）', () => {
  assert.ok(!prompt.TEMPLATE.includes('档位标尺'));
  assert.ok(!prompt.PROTOCOL.includes('档位标尺'));
  assert.ok(!prompt.TEMPLATE.includes('反虚高'));
  assert.ok(!prompt.PROTOCOL.includes('反虚高'));
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

test('displayText v2：中场出现的分数围栏也被隐藏（任意位置）', () => {
  const mid = '前言\n\n```json\n{"status":"ok","total":12}\n```\n\n## 步骤① 总分与分项\n正文';
  const out = prompt.displayText(mid);
  assert.ok(out.includes('前言'));
  assert.ok(!out.includes('"total"'), '中场 JSON 泄漏');
  assert.ok(out.includes('## 步骤①'));
});

test('findUnfencedObject 线性扫描：大括号洪泛输入不卡顿', () => {
  const t0 = Date.now();
  const r = prompt.extractScoreBlock('{'.repeat(30000));
  const dt = Date.now() - t0;
  assert.strictEqual(r.parseMode, 'none');
  assert.ok(dt < 400, `耗时 ${dt}ms（应 <400ms）`);
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

test('extractScoreBlock：正常 JSON（含围栏变体/前缀散文）', () => {
  const md = '好的，我来批改。\n\n```JSON\n{"status":"ok","level":"六级","total":12,"tier":"13-15分档","content":4,"structure":3,"vocab":2,"grammar":3}\n```\n\n## 步骤① 总分与分项\n内容';
  const r = prompt.extractScoreBlock(md);
  assert.strictEqual(r.parseMode, 'json');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.level, '六级');
  assert.deepStrictEqual(r.scores, { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 });
  assert.ok(!r.textWithout.includes('```json') && !r.textWithout.includes('"total"'));
  assert.deepStrictEqual(r.annotations, []);
});

test('extractScoreBlock：和≠总分 → 本地重算 + 注记', () => {
  const md = '```json\n{"status":"ok","total":15,"content":4,"structure":3,"vocab":2,"grammar":2}\n```\ntext';
  const r = prompt.extractScoreBlock(md);
  assert.strictEqual(r.scores.total, 11);
  assert.ok(r.annotations.some(a => a.includes('不一致')));
});

test('extractScoreBlock：超范围 → 进入正则降级/降级链', () => {
  const md = '```json\n{"status":"ok","total":12,"content":9,"structure":3,"vocab":2,"grammar":3}\n```\n## 步骤① 总分与分项\n总分：12 / 15\n内容完整性 4/5、篇章结构 3/4、词汇表达 2/3、语法准确性 3/3';
  const r = prompt.extractScoreBlock(md);
  assert.strictEqual(r.parseMode, 'regex');
  assert.deepStrictEqual(r.scores, { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 });
});

test('extractScoreBlock：无围栏 JSON 对象可被扫描到', () => {
  const r = prompt.extractScoreBlock('前言 {"status":"ok","total":10,"content":4,"structure":2,"vocab":2,"grammar":2} 后文');
  assert.strictEqual(r.parseMode, 'json'); assert.strictEqual(r.scores.total, 10);
});

test('extractScoreBlock：unreadable', () => {
  const r = prompt.extractScoreBlock('```json\n{"status":"unreadable","note":"图片无法辨认"}\n```\n图片太模糊，请重新拍照。');
  assert.strictEqual(r.status, 'unreadable'); assert.strictEqual(r.scores, null);
  assert.strictEqual(r.note, '图片无法辨认');
});

test('extractScoreBlock：完全不合协议 → parseMode none 且正文保留', () => {
  const r = prompt.extractScoreBlock('这是一段普通批改文字，没有任何结构。');
  assert.strictEqual(r.parseMode, 'none'); assert.strictEqual(r.scores, null);
  assert.strictEqual(r.textWithout, '这是一段普通批改文字，没有任何结构。');
});

test('正则降级容忍 ** 与全角冒号与无空格', () => {
  const md = '**总分：12/15**\n内容完整性 **4**/5、篇章结构 3 /4、词汇表达：2/3、语法准确性 3/ 3';
  const r = prompt.extractScoreBlock(md);
  assert.strictEqual(r.parseMode, 'regex');
  assert.deepStrictEqual(r.scores, { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 });
});

test('tierFor 本地重算（含 0）', () => {
  assert.strictEqual(prompt.tierFor(14), '13-15分档');
  assert.strictEqual(prompt.tierFor(12), '10-12分档');
  assert.strictEqual(prompt.tierFor(0), '1-3分档');
});

test('splitReport 容错标题变体', () => {
  const cases = ['## 步骤① 总分与分项', '### 步骤 1 总分与分项', '## 步骤一 总分', '## 步骤①：总分与分项（12/15）'];
  for (const h of cases) {
    const r = prompt.splitReport(`${h}\nA\n\n## 步骤② 逐条扣分点\nB\n\n## 步骤③ 修改建议\nC\n\n## 步骤④ 优化版本\nD`);
    assert.ok(r.found >= 1, h);
  }
  const full = prompt.splitReport('前言\n\n## 步骤① 总分与分项\nA\n\n## 步骤② 逐条扣分点\nB\n\n## 步骤③ 修改建议\nC\n\n## 步骤④ 优化版本\nD\n\n### 优化版本正文\noptimized text here\n\n### 主要改动点\n- x');
  assert.strictEqual(full.found, 4);
  assert.ok(full.preamble.includes('前言'));
  assert.strictEqual(prompt.extractOptimizedBody(full.steps[3].body).trim(), 'optimized text here');
});

/* ---------- 复制模式：区分「指令」与「报告」 ---------- */

test('looksLikeInstruction：认得自己生成的那份批改指令', () => {
  const instr = prompt.buildCopyText({ level: '四级', title: '', text: 'x', images: 0 });
  assert.strictEqual(prompt.looksLikeInstruction(instr), true);
  // 四段分隔标题任一出现即判定为指令
  for (const s of ['===== 批改要求（必须全部遵守）=====', '===== 作文信息 =====',
    '===== 学生作文 =====', '请你严格按照以下要求，批改下面这篇大学英语四六级作文']) {
    assert.ok(instr.includes(s), `指令缺少特征串: ${s}`);
    assert.strictEqual(prompt.looksLikeInstruction('前言 ' + s + ' 后文'), true);
  }
});

test('looksLikeInstruction：真正的报告不会被误判', () => {
  const report = '```json\n{"status":"ok","level":"四级","total":12,"tier":"10-12分档","content":4,"structure":3,"vocab":2,"grammar":3}\n```\n' +
    '## 步骤① 总分与分项\n内容完整性 4/5\n\n## 步骤② 逐条扣分点\n1. 主谓不一致\n> Online learning have many advantages.\n\n' +
    '## 步骤③ 修改建议\n改成 has。\n\n## 步骤④ 优化版本\n### 优化版本正文\nSome text.\n\n### 主要改动点\n- x';
  assert.strictEqual(prompt.looksLikeInstruction(report), false);
  assert.strictEqual(prompt.looksLikeInstruction(''), false);
  assert.strictEqual(prompt.looksLikeInstruction(null), false);
});

test('emptyStepIndexes：指令被当成报告时，四个分节里三个是空的', () => {
  const instr = prompt.buildCopyText({ level: '四级', title: '', text: 'x', images: 0 });
  const split = prompt.splitReport(instr);
  // PROTOCOL 逐字含那四个标题（协议要求 AI 使用它们），所以会被识别成 4 个分节
  assert.strictEqual(split.found, 4, '指令含四步标题，正是误渲染的成因');
  const empties = prompt.emptyStepIndexes(split);
  assert.deepStrictEqual(empties, [1, 2, 3], '前三个步骤应为空正文');
  assert.ok(empties.length > 0 && empties.length < split.steps.length,
    '不是全部为空——所以仅靠"全空"判断不足以拦住，必须另有指令识别');
});

test('emptyStepIndexes：正常报告没有空分节', () => {
  const report = '## 步骤① 总分与分项\nA\n\n## 步骤② 逐条扣分点\nB\n\n## 步骤③ 修改建议\nC\n\n## 步骤④ 优化版本\nD';
  const split = prompt.splitReport(report);
  assert.deepStrictEqual(prompt.emptyStepIndexes(split), []);
  assert.deepStrictEqual(prompt.emptyStepIndexes({ steps: [] }), []);
  assert.deepStrictEqual(prompt.emptyStepIndexes(null), []);
});
