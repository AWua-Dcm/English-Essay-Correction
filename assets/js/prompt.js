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

  /* ===== 附录 C：档位标尺（新增，不改动附录 A / B 的措辞） =====
   *
   * 目的：模型给四六级作文打分时会向 10-13 分聚集（虚高且判不出差异）。这里给出
   * 可观测的定档依据与反虚高硬性规则，把"凭整体印象给分"换成"先定档再定分"。
   * 措辞可改；上面 TEMPLATE / PROTOCOL 是逐字正本，不可改。 */
  var RUBRIC = `【档位标尺（官方五档对照法）】

一、官方评分办法（照此执行）
四六级写作采用总体印象评分（Global Scoring）：按总的印象给奖励分，**不按语言点错误数目扣分**。
阅卷员对照各档样卷：与某档相似即定该分，稍优或稍劣 ±1 分，不得加减半分。
所以：先判断这篇"最像哪一档"，再决定落在档心还是 ±1。

二、五档描述（逐条对照，取最接近的一档）
14分档（13-15分）：切题。表达思想清楚，文字通顺、连贯，基本上无语言错误，仅有个别小错。
11分档（10-12分）：切题。表达思想清楚，文字连贯，但有少量语言错误。
8分档（7-9分）：基本切题。有些地方表达思想不够清楚，文字勉强连贯；语言错误相当多，其中有一些是严重错误。
5分档（4-6分）：基本切题。表达思想不清楚，连贯性差。有较多的严重语言错误。
2分档（1-3分）：条理不清，思路紊乱，语言支离破碎或大部分句子均有错误，且多数为严重错误。
0分：白卷，作文与题目毫不相关，或只有几个孤立的词而无法表达思想。

三、定档自查项（用于确认，不用于算分）
下面几项只帮你确认"有没有看漏"，**不是加分扣分公式**。定档仍以第二步的档位描述为准。
· 切题度：是否回应了题目全部要求（图表读数值与趋势 / 图画描述+寓意+表态 / 书信四件 / 谚语解释+举例+表态 / 议论文立场+理由+回应反面）
· 具体支撑：有几处例子、数字、具体的人或物、两步因果链；是否通篇只有表态
· 破句：有几处句子必须重写才能读懂（缺谓语、双谓语、从句没有主句、整句不成句）
· 句式类别：从句 / 非谓语 / 倒装 / 强调句，各有几类
· 万能句：把主题词换成本题以外的主题后，句子是否依然成立
自查的作用：若你按描述定到 11 分档，却发现通篇只有表态、或大半句子不成句，
说明定档偏高——回到第二步重新对照。

四、字数扣分（官方表，按级别照查，不看级别不要用）
四级（不足 120 词起算）：110-119 扣 1；100-109 扣 2；90-99 扣 3；80-89 扣 4；70-79 扣 5；60-69 扣 6；50-59 扣 7；49 及以下扣 9。
六级（不足 150 词起算）：140-149 扣 1；130-139 扣 2；120-129 扣 3；110-119 扣 4；100-109 扣 5；90-99 扣 6；80-89 扣 7；79 及以下扣 9。
题目中给出的主题句、起始句、结束句**不计入**所写字数。规定内容未写全者按比例扣分。

五、分项打分锚点（四项之和必须等于总分）
内容完整性 __/5：切题且题目要求写全 5；切题但展开不足 3-4；部分偏题 1-2；跑题 0
篇章结构 __/4：三段清晰、过渡自然 4；结构完整但过渡生硬 3；结构混乱或缺段 1-2
词汇表达 __/3：达意准确、无明显重复或中式表达 3（官方 13-15 档只要求文字通顺，不要求高级词）；重复或中式表达明显 2；用词错误影响理解 1
语法准确性 __/3：基本上无语言错误、仅个别小错 3；少量语言错误 2；错误相当多且含严重错误 1
四项必须与总分档位自洽：定档 13-15 时词汇与语法应为 3；若给 2，说明该文其实不足 13-15，应下调总分。

六、硬性规则
1. 客观评分，不虚高、不刻意压分，**避免趋中倾向**（官方原话）。
2. 不得因篇幅长、字迹工整、观点积极而加分。
3. 严禁默认给出 11-13 分。给分落在 10-13 时，必须说明它为什么不是相邻档，差在哪一条描述上。`;

  function buildSystemPrompt() {
    return TEMPLATE + '\n\n' + PROTOCOL + '\n\n' + RUBRIC;
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
      '===== 批改要求（必须全部遵守）=====\n' + TEMPLATE + '\n\n' + PROTOCOL + '\n\n' + RUBRIC + '\n\n' +
      '===== 作文信息 =====\n' + metaLines(opts) + '\n\n' +
      '===== 学生作文 =====\n' + essayBlock(opts, 'copy');
  }

  /**
   * 流式显示用文本：隐藏分数 JSON 围栏（**任意位置**，含 ~~~ 围栏；设计文档 §7.2/§15.2）。
   * 闭合围栏 → 删除该段；未闭合 → 从围栏处起隐藏（尾部超 4000 字符时放弃隐藏，防整段吞没）。
   */
  function displayText(md) {
    var s = String(md == null ? '' : md);
    var blocks = findFencedBlocks(s);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var isScore = b.lang.toLowerCase() === 'json' ||
        b.content.indexOf('"status"') !== -1 || b.content.indexOf('"total"') !== -1;
      if (!isScore) continue;
      return (s.slice(0, b.start) + s.slice(b.end)).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    }
    var open = /(^|\n)([ \t]*)(```|~~~)[A-Za-z0-9_-]*[ \t]*\r?\n/.exec(s);
    if (open) {
      var fenceAt = open.index + (open[1] ? open[1].length : 0);
      var tail = s.slice(fenceAt);
      var hasKeys = tail.indexOf('"status"') !== -1 || tail.indexOf('"total"') !== -1;
      if (hasKeys) {
        if (tail.length > 4000) return s;
        return s.slice(0, fenceAt).replace(/\n{3,}/g, '\n\n');
      }
    }
    return s;
  }

  /* ===== 分数块解析与报告切分（设计文档 §7.1） ===== */

  /** 档次一律本地重算（不信任模型字符串；0 → 1-3分档） */
  function tierFor(total) {
    var t = Number(total) || 0;
    if (t >= 13) return '13-15分档';
    if (t >= 10) return '10-12分档';
    if (t >= 7) return '7-9分档';
    if (t >= 4) return '4-6分档';
    return '1-3分档';
  }

  var STEP_MARKERS = { '①': 1, '1': 1, '一': 1, '②': 2, '2': 2, '二': 2, '③': 3, '3': 3, '三': 3, '④': 4, '4': 4, '四': 4 };

  /** 容错切分报告四步骤（标题变体：## ##/###/####、步骤 1/一/①、全角冒号、标题后缀） */
  function splitReport(md) {
    var s = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    var lines = s.split('\n');
    var heads = [];
    for (var i = 0; i < lines.length; i++) {
      var h = /^\s*#{2,4}\s*步骤\s*([①②③④1-4一-四])/.exec(lines[i]);
      if (h && STEP_MARKERS[h[1]]) {
        heads.push({ index: STEP_MARKERS[h[1]], lineNo: i, title: lines[i].replace(/^\s*#+\s*/, '').trim() });
      }
    }
    if (heads.length === 0) return { preamble: s, steps: [], found: 0 };
    var steps = [];
    for (var k = 0; k < heads.length; k++) {
      var start = heads[k].lineNo + 1;
      var end = (k + 1 < heads.length) ? heads[k + 1].lineNo : lines.length;
      steps.push({ index: heads[k].index, title: heads[k].title, body: lines.slice(start, end).join('\n').trim() });
    }
    return { preamble: lines.slice(0, heads[0].lineNo).join('\n').trim(), steps: steps, found: steps.length };
  }

  /** 步骤④内的优化作文正文（### 优化版本正文 与下一个标题之间）；缺失返回 null */
  function extractOptimizedBody(step4Body) {
    var s = String(step4Body == null ? '' : step4Body);
    var m = /^\s*#{2,4}[ \t]*优化版本正文[^\n]*$/m.exec(s);
    if (!m) return null;
    var rest = s.slice(m.index + m[0].length).replace(/^\n+/, '');
    var end = /^\s*#{2,4}[ \t]*\S/m.exec(rest);
    return (end ? rest.slice(0, end.index) : rest).trim();
  }

  var SCORE_KEYS = ['content', 'structure', 'vocab', 'grammar'];
  var SCORE_MAX = { content: 5, structure: 4, vocab: 3, grammar: 3 };

  function parseScoreJson(raw) {
    var t = String(raw).replace(/[​-‍﻿]/g, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a === -1 || b === -1 || b < a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }

  /** 四个分项必须为范围内整数；不满足返回 null（触发降级链） */
  function validScores(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var out = {};
    for (var i = 0; i < SCORE_KEYS.length; i++) {
      var k = SCORE_KEYS[i];
      var v = obj[k];
      if (typeof v !== 'number' || !isFinite(v) || v !== Math.floor(v)) return null;
      if (v < 0 || v > SCORE_MAX[k]) return null;
      out[k] = v;
    }
    return out;
  }

  /** 全部围栏块（``` 与 ~~~），含 lang 与起止位置 */
  function findFencedBlocks(s) {
    var re = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```|~~~([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)~~~/g;
    var out = [], m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] !== undefined) out.push({ start: m.index, end: m.index + m[0].length, lang: m[1], content: m[2] });
      else out.push({ start: m.index, end: m.index + m[0].length, lang: m[3], content: m[4] });
    }
    return out;
  }

  /**
   * 无围栏时扫描第一个含 "total"/"status" 的 {...} 对象。
   * 单次线性扫描 + 扫描上限与候选长度上限（防大括号洪泛输入造成的 O(n²) 卡顿）。
   */
  function findUnfencedObject(s) {
    var limit = Math.min(s.length, 65536);
    var depth = 0, start = -1;
    for (var j = 0; j < limit; j++) {
      var c = s.charAt(j);
      if (c === '{') {
        if (depth === 0) start = j;
        depth++;
      } else if (c === '}') {
        if (depth > 0) {
          depth--;
          if (depth === 0 && start !== -1) {
            var len = j + 1 - start;
            if (len <= 8192) {
              var cand = s.slice(start, j + 1);
              if (cand.indexOf('"status"') !== -1 || cand.indexOf('"total"') !== -1) {
                return { start: start, end: j + 1, text: cand };
              }
            }
            start = -1;   // 该顶层对象不合格，继续找下一个
          }
        }
      }
    }
    return null;
  }

  function removeRange(s, r) {
    if (!r) return s;
    return (s.slice(0, r.start) + s.slice(r.end)).replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 分数块解析（三级降级链）：围栏 JSON → 无围栏 JSON 扫描 → 步骤①文本正则 → none。
   * scores.total 一律为四项之和的本地重算值；解析成功的 JSON 块从 textWithout 中剥离。
   */
  function extractScoreBlock(md) {
    var s = String(md == null ? '' : md);
    var res = {
      status: null, level: null, scores: null, note: null,
      annotations: [], parseMode: 'none', textWithout: s,
    };
    var consumed = null;
    var obj = null;

    var blocks = findFencedBlocks(s);
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i];
      var isJsonLang = blk.lang.toLowerCase() === 'json';
      var hasKeys = blk.content.indexOf('"status"') !== -1 || blk.content.indexOf('"total"') !== -1;
      if (isJsonLang && hasKeys) {
        var parsed = parseScoreJson(blk.content);
        if (parsed && typeof parsed === 'object') {
          obj = parsed;
          consumed = { start: blk.start, end: blk.end };
          break;
        }
      }
    }
    if (!obj) {
      var uf = findUnfencedObject(s);
      if (uf) {
        var p2 = parseScoreJson(uf.text);
        if (p2 && typeof p2 === 'object') { obj = p2; consumed = { start: uf.start, end: uf.end }; }
      }
    }

    if (obj) {
      if (obj.status === 'unreadable') {
        res.status = 'unreadable';
        res.note = (typeof obj.note === 'string' && obj.note) ? obj.note : '图片无法辨认';
        res.parseMode = 'json';
        res.textWithout = removeRange(s, consumed);
        return res;
      }
      var four = validScores(obj);
      if (four) {
        var sum = four.content + four.structure + four.vocab + four.grammar;
        res.status = 'ok';
        res.scores = { total: sum, content: four.content, structure: four.structure, vocab: four.vocab, grammar: four.grammar };
        if (typeof obj.total === 'number' && obj.total !== sum) {
          res.annotations.push('模型给出总分与四项之和不一致，已按四项之和显示');
        }
        if (obj.level === '四级' || obj.level === '六级') res.level = obj.level;
        res.parseMode = 'json';
        res.textWithout = removeRange(s, consumed);
        return res;
      }
      // JSON 存在但数值超范围 → 落入正则降级
    }

    var stripped = s.replace(/\*/g, '');
    var mc = /内容(?:完整性)?\s*[:：]?\s*(\d)/.exec(stripped);
    var ms = /篇章结构\s*[:：]?\s*(\d)/.exec(stripped);
    var mv = /词汇(?:表达)?\s*[:：]?\s*(\d)/.exec(stripped);
    var mg = /语法(?:准确性)?\s*[:：]?\s*(\d)/.exec(stripped);
    if (mc && ms && mv && mg) {
      var four2 = validScores({ content: +mc[1], structure: +ms[1], vocab: +mv[1], grammar: +mg[1] });
      if (four2) {
        var sum2 = four2.content + four2.structure + four2.vocab + four2.grammar;
        res.status = 'ok';
        res.scores = { total: sum2, content: four2.content, structure: four2.structure, vocab: four2.vocab, grammar: four2.grammar };
        res.annotations.push('（解析方式：文本提取）');
        res.parseMode = 'regex';
        return res; // 正则模式不删改正文
      }
    }
    return res; // 终态：none，正文原样保留
  }

  /* ===== 粘贴内容识别（复制模式：区分"指令"与"报告"） ===== */

  /**
   * 复制出去的「批改指令」自带的特征串。
   *
   * 用户很容易把指令本身粘回渲染框（而不是 AI 的回复）。此时不能只靠"找不到步骤标题"
   * 来判错——因为 PROTOCOL 里**逐字包含** `## 步骤① 总分与分项` 等四个标题（协议要求
   * AI 使用它们）。那四个标题会被 splitReport 正常识别，得到四个**空正文**分节，
   * 于是页面安静地渲染出一份"空白报告"。所以必须单独认出指令本体。
   */
  var INSTRUCTION_MARKERS = [
    '===== 批改要求（必须全部遵守）=====',
    '===== 作文信息 =====',
    '===== 学生作文 =====',
    '请你严格按照以下要求，批改下面这篇大学英语四六级作文',
  ];

  function looksLikeInstruction(text) {
    var s = String(text == null ? '' : text);
    for (var i = 0; i < INSTRUCTION_MARKERS.length; i++) {
      if (s.indexOf(INSTRUCTION_MARKERS[i]) !== -1) return true;
    }
    return false;
  }

  /** 有标题但正文为空的步骤序号；全部为空说明只粘贴了骨架，没有实际报告内容 */
  function emptyStepIndexes(split) {
    var out = [];
    if (!split || !split.steps) return out;
    for (var i = 0; i < split.steps.length; i++) {
      if (!String(split.steps[i].body || '').trim()) out.push(split.steps[i].index);
    }
    return out;
  }

  var api = {
    TEMPLATE: TEMPLATE,
    PROTOCOL: PROTOCOL,
    RUBRIC: RUBRIC,
    buildSystemPrompt: buildSystemPrompt,
    looksLikeInstruction: looksLikeInstruction,
    emptyStepIndexes: emptyStepIndexes,
    buildMetaBlock: buildMetaBlock,
    buildCopyText: buildCopyText,
    displayText: displayText,
    tierFor: tierFor,
    splitReport: splitReport,
    extractOptimizedBody: extractOptimizedBody,
    extractScoreBlock: extractScoreBlock,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).prompt = api;
})(typeof self !== 'undefined' ? self : globalThis);
