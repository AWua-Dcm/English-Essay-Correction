/**
 * prompt.js — 批改提示词正本、组装、报告结构切分与分数块解析
 *
 * TEMPLATE / PROTOCOL 为设计文档附录 A / 附录 B 的逐字正本，禁止改动措辞。
 * 组装结果中不得出现任何仓库管理语言（有测试断言）。
 *
 * UMD-lite：浏览器挂 window.EEC.prompt，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var util = (typeof module !== 'undefined' && module.exports)
    ? require('./util.js')
    : (root.EEC && root.EEC.util);

  /* ===== 附录 A：批改模板正本（system 提示词第一部分，逐字） ===== */
  var TEMPLATE = `你现在是大学英语四六级作文阅卷导师，严格按照大学英语四六级作文官方评分标准工作。请批改我随后提供的作文。

请严格分 4 步执行，禁止跳过步骤，禁止在步骤①②③中直接一次性重写整篇作文。除英文原句和步骤④的优化版本外，其余讲解全部用中文。

步骤①：总分与分项打分
- 总分：__ / 15，并标注所属档次：13-15分档 / 10-12分档 / 7-9分档 / 4-6分档 / 1-3分档
- 分项打分：内容完整性 __/5、篇章结构 __/4、词汇表达 __/3、语法准确性 __/3
- 四个分项之和必须等于总分
- 每个分项给一句话打分理由

步骤②：逐条点评扣分点
按严重程度从高到低列出 3-8 条，每条必须包含：
1. 问题类型：跑题 / 论点空洞 / 中式英语 / 连接词滥用 / 低级语法错误 / 句式单调 / 词汇重复 / 字数不达标等
2. 原文原句：直接引用原文对应句子，禁止编造；没有对应原句就写"无直接原句"
3. 问题说明：用中文解释为什么扣分、扣在哪一档
如果存在跑题，请明确指出偏题方向和正确审题思路。

步骤③：给出可落地的修改建议
针对步骤②的每个问题，逐条告诉学生：
- 怎么改：给出具体改法、替换表达或改写示范
- 为什么这么改：结合四六级评分标准解释得分逻辑
- 写作思路：说明这类作文如何写主题句、如何展开论据、如何避免中式英语、如何增加句式变化、如何自然使用连接词

步骤④：提供优化版本
- 必须保留学生原本的核心观点和立意，不更换观点
- 优化句式、衔接、词汇与语法，不堆砌生僻词，符合大学生英语水平
- 字数符合级别要求：四级 120-180 词，六级 150-200 词
- 最后列出 3-5 处主要改动点，并说明改动逻辑

【硬性要求】
1. 客观评分，不虚高、不刻意压分。
2. 步骤②必须引用原文原句，不得编造。
3. 不要直接给一篇全新作文，必须先完成步骤①②③。
4. 输出用 Markdown 分节，标题分别为：
   "步骤① 总分与分项"
   "步骤② 逐条扣分点"
   "步骤③ 修改建议"
   "步骤④ 优化版本"
5. 不要只给结论，必须给出可执行的修改路径。
6. 如果我未提供考试级别或作文题目，请根据作文内容推断，并先说明你的推断。
7. 如果学生以图片形式提供作文（手机相册选择或直接拍照），请先准确识别图片中的英文内容，再进行批改；若图片模糊或文字无法辨认，请说明并请我补充文字版或重新拍照。`;

  /* ===== 附录 B：输出协议（system 提示词第二部分，逐字） ===== */
  var PROTOCOL = `【输出协议（网页渲染要求，必须严格遵守）】
1. 回复中必须包含且仅包含一个 JSON 代码块（\`\`\`json 围栏）。级别为"自动推断"时，请在 JSON 块后另起一行用一句话写明你的推断（例如：推断级别：六级）。除该 JSON 块外，不要再输出任何 JSON 代码块；不要输出你的思考过程或分析过程。
2. JSON 字段（均为整数，除 status/level/tier/note 外）：
{"status":"ok","level":"四级","total":12,"tier":"10-12分档","content":4,"structure":3,"vocab":2,"grammar":3}
- status："ok"=正常批改；"unreadable"=图片模糊或无法辨认。
- level：本次批改采用的级别（"四级"或"六级"）。
- content≤5、structure≤4、vocab≤3、grammar≤3，四项之和必须等于 total。
- tier 仅作参考（网页会按 total 校核并自行判定档次）。
- status 为 "unreadable" 时：只输出 {"status":"unreadable","note":"图片无法辨认"}，并用一段中文说明原因、请学生补充文字版或重新拍照；不要输出分数，也不要输出下面四个步骤。
3. status 为 "ok" 时：JSON 块（及可选的一句推断说明）之后，紧跟完整批改报告。报告必须且只能使用以下四个 Markdown 二级标题（## ），标题文字不得更改：
## 步骤① 总分与分项
## 步骤② 逐条扣分点
## 步骤③ 修改建议
## 步骤④ 优化版本
步骤④ 内必须且只能使用两个三级标题（###）：### 优化版本正文（优化作文正文）、### 主要改动点（3-5 处主要改动点与改动逻辑）。
4. 报告中不使用 Markdown 表格、HTML 标签和图片；引用学生原文句子使用 Markdown 引用块（>），每条引用单独成行，放在对应条目文字的下一行；引用英文原句保持原文，不修改。
5. 字数判断：若上文提供了【网页统计词数】的有效数值，以它为准，不要自行重新统计；若上文标注"未提供（作文以图片形式提交）"，请依据你识别出的内容估算词数并注明"（估算）"。步骤④优化版本正文须自行控制在该级别要求范围内（四级 120-180 词，六级 150-200 词）。
6. 步骤①②③的讲解全部使用中文；英文仅出现在原文引用、步骤④优化正文及必要的术语中（与批改模板一致）。`;

  function buildSystemPrompt() {
    return TEMPLATE + '\n\n' + PROTOCOL;
  }

  /** 元信息行（三态：级别直接给出 / 自动推断 / 纯图片），设计文档 §6.1 */
  function metaLines(opts) {
    var level = opts.level || 'auto';
    var title = String(opts.title || '');
    var text = String(opts.text || '');
    var images = opts.images || 0;
    var levelLine = (level === '四级' || level === '六级')
      ? level
      : '未提供，请依据作文内容推断，并先说明你的推断';
    var titleLine = title ? title : '未提供，请依据作文内容推断';
    var n = util.wordCount(text);
    var countLine;
    if (n === 0 && images > 0) {
      countLine = '未提供（作文以图片形式提交，请依据图片自行估算词数，并注明为"估算"）';
    } else if (level === '四级') {
      countLine = n + ' 词（四级要求 120-180 词）';
    } else if (level === '六级') {
      countLine = n + ' 词（六级要求 150-200 词）';
    } else {
      countLine = n + ' 词（级别未提供；请按你推断的级别对照达标：四级 120–180 词，六级 150–200 词）';
    }
    return '【考试级别】' + levelLine + '\n【作文题目】' + titleLine + '\n【网页统计词数】' + countLine;
  }

  /** 学生作文段（mode: 'api' = 剧本态消息里附图占位；'copy' = 复制模式提示用户在对话中附照片） */
  function essayBlock(opts, mode) {
    var text = String(opts.text || '');
    var images = opts.images || 0;
    var inner = '';
    if (text) {
      inner = text;
      if (images > 0) {
        inner += '\n' + (mode === 'copy'
          ? '（另见对话中的作文照片 ' + images + ' 张）'
          : '（另见附图 ' + images + ' 张）');
      }
    } else if (images > 0) {
      inner = (mode === 'copy')
        ? '（见本对话中的作文照片，共 ' + images + ' 张）'
        : '（见附图，共 ' + images + ' 张）';
    }
    return '"""\n' + inner + '\n"""';
  }

  /** 自动模式的 user 消息（元信息 + 作文段） */
  function buildMetaBlock(opts) {
    return metaLines(opts) + '\n\n【学生作文】\n' + essayBlock(opts, 'api');
  }

  /** 复制模式的完整单条文本（设计文档 §9.1） */
  function buildCopyText(opts) {
    return '请你严格按照以下要求，批改下面这篇大学英语四六级作文。请先完整阅读全部要求，再一次性输出完整报告。\n\n' +
      '===== 批改要求（必须全部遵守）=====\n' + TEMPLATE + '\n\n' + PROTOCOL + '\n\n' +
      '===== 作文信息 =====\n' + metaLines(opts) + '\n\n' +
      '===== 学生作文 =====\n' + essayBlock(opts, 'copy');
  }

  /**
   * 流式显示用文本：隐藏开头的分数 JSON 围栏（含其后空行）。
   * 未闭合且全文 <4000 字符 → 返回空串（流式早期整段隐藏）；超 4000 未闭合 → 放弃隐藏，原样返回。
   */
  function displayText(md) {
    var s = String(md == null ? '' : md);
    var open = /^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n/.exec(s);
    if (!open) return s;
    var afterOpen = s.slice(open[0].length);
    var closeMatch = /\r?\n[ \t]*```/.exec(afterOpen);
    var content = !closeMatch ? afterOpen : afterOpen.slice(0, closeMatch.index);
    if (content.indexOf('"status"') === -1 && content.indexOf('"total"') === -1) return s;
    if (!closeMatch) return s.length < 4000 ? '' : s;
    var after = afterOpen.slice(closeMatch.index + closeMatch[0].length);
    return after.replace(/^\n+/, '');
  }

  var api = {
    TEMPLATE: TEMPLATE,
    PROTOCOL: PROTOCOL,
    buildSystemPrompt: buildSystemPrompt,
    buildMetaBlock: buildMetaBlock,
    buildCopyText: buildCopyText,
    displayText: displayText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).prompt = api;
})(typeof self !== 'undefined' ? self : globalThis);
