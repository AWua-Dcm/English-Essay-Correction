/**
 * precheck.js — 作文客观预检（纯前端、零依赖、瞬时、手机可用）
 *
 * 它只统计**确定性的、不可能算错的**事实：字数与官方扣分、段落与结论段、
 * 套话命中、重复词、句长分布、句式类别。
 *
 * 它**刻意不产出任何分数**。原因有实测依据：把规则引擎当评分器用，在四篇
 * 真实标分作文（2/5/8/11 分）上给出的分数跨度只有 1.5 分，还把 2 分那篇判成
 * 11 分——因为"句子读不通"需要解析句子，正则做不到。详见
 * docs/on-device-llm-spike.md 与 skill 的 reference/calibration.md。
 *
 * 所以这里的分工是：**规则引擎产事实，模型产判断**。预检结果会写进批改指令，
 * 让模型"有据可依"，而不是让网页自己给一个不可信的分数。
 *
 * UMD-lite：浏览器挂 window.EEC.precheck，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var util = (typeof module !== 'undefined' && module.exports)
    ? require('./util.js')
    : (root.EEC && root.EEC.util);

  /* 官方字数扣分表（2016 年修订版大纲）。
     注意不是"每少 10 词扣 1 分"的线性规则，低端有陡增。 */
  var DEDUCTION = {
    cet4: [[110, 119, 1], [100, 109, 2], [90, 99, 3], [80, 89, 4], [70, 79, 5],
           [60, 69, 6], [50, 59, 7], [0, 49, 9]],
    cet6: [[140, 149, 1], [130, 139, 2], [120, 129, 3], [110, 119, 4], [100, 109, 5],
           [90, 99, 6], [80, 89, 7], [0, 79, 9]],
  };
  var RANGE = { cet4: [120, 180], cet6: [150, 200] };

  // 套话。命中即列出原短语，供批改时直接引用。
  var CLICHES = [
    'more and more', 'with the development of society',
    'with the development of economy', 'with the rapid development of',
    'as we all know', 'in my opinion', 'play an important role in',
    'play a more and more important role', 'every coin has two sides',
    'last but not least', 'only in this way', 'it is well known that',
    'there is no denying that', 'as far as i am concerned',
    'with the advance of science and technology', 'in a word',
    'all in all', 'first and foremost', 'get more knowledge',
    'open our eyes', 'can let us', 'attach great importance to',
  ];

  var CONCLUSION_MARKERS = ['in conclusion', 'to sum up', 'to conclude', 'all in all',
    'in a word', 'on the whole', 'in short', 'to summarize', 'in summary'];

  // 句式类别（近似统计：只看表层标记，不解析句子）
  var SYNTAX = [
    { key: '从句', re: /\b(which|who|whom|whose|that|because|although|though|if|when|whenever|while|where|since|unless|until)\b/i },
    { key: '非谓语', re: /(\bto\s+[a-z]+)|(\b[a-z]+ing\s+(?:the|a|an|his|her|their|our|its|this|these)\b)|(\b[a-z]+ed\s+(?:by|in|with|from)\b)/i },
    { key: '倒装', re: /\b(only (?:by|when|then|if|after|in this way)|not only\b|never have|rarely|seldom|hardly|no sooner)\b/i },
    { key: '强调句', re: /\bit\s+is\s+[a-z]+\s+that\b/i },
  ];

  var WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

  function words(text) {
    return String(text == null ? '' : text).match(WORD_RE) || [];
  }

  function sentences(text) {
    var s = String(text == null ? '' : text).replace(/["”]\s*$/gm, '');
    var parts = s.split(/(?<=[.!?])\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p && words(p).length >= 3) out.push(p);
    }
    return out;
  }

  function countPhrase(low, phrase) {
    var n = 0, i = 0;
    while ((i = low.indexOf(phrase, i)) !== -1) {
      var before = i === 0 ? ' ' : low.charAt(i - 1);
      var afterIdx = i + phrase.length;
      var after = afterIdx >= low.length ? ' ' : low.charAt(afterIdx);
      if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) n++;
      i = afterIdx;
    }
    return n;
  }

  /** 官方扣分表查表；返回 {deduct, band}。level 只用 '四级'/'六级' 判定，内部键统一为 cet4/cet6 */
  function deductionFor(level, n) {
    var key = level === '六级' ? 'cet6' : 'cet4';
    var rows = DEDUCTION[key];
    var min = RANGE[key][0];
    if (n >= min) return { deduct: 0, level: key };
    for (var i = 0; i < rows.length; i++) {
      if (n >= rows[i][0] && n <= rows[i][1]) {
        return { deduct: rows[i][2], level: key, band: rows[i][0] + '-' + rows[i][1] };
      }
    }
    return { deduct: 0, level: key };
  }

  /**
   * 统计客观事实。**不返回分数**——这是刻意的设计约束，不要在这里加总分。
   * @param {string} text  作文正文
   * @param {string} [level] '四级' | '六级'；缺省时按四级区间给出但标注未定
   */
  function analyze(text, level) {
    var t = String(text == null ? '' : text);
    var ws = words(t);
    var n = util && util.wordCount ? util.wordCount(t) : ws.length;

    var sents = sentences(t);
    var lens = sents.map(function (s) { return words(s).length; });
    var sum = lens.reduce(function (a, b) { return a + b; }, 0);
    var mean = lens.length ? sum / lens.length : 0;
    var variance = lens.length
      ? lens.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / lens.length
      : 0;

    var paras = t.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (paras.length <= 1 && sents.length > 3) {
      // 未分段但句子很多：按单段处理，但给出提示（不擅自切开）
      paras = paras.length ? paras : [t.trim()];
    }

    var low = ' ' + t.toLowerCase().replace(/\s+/g, ' ') + ' ';

    var cliches = [];
    for (var i = 0; i < CLICHES.length; i++) {
      var c = countPhrase(low, CLICHES[i]);
      if (c > 0) cliches.push({ phrase: CLICHES[i], count: c });
    }

    var freq = {};
    for (var j = 0; j < ws.length; j++) {
      var w = ws[j].toLowerCase();
      if (w.length < 4) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    var repeats = Object.keys(freq)
      .filter(function (k) { return freq[k] >= 4; })
      .map(function (k) { return { word: k, count: freq[k] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 8);

    var conclMarker = null;
    for (var k = 0; k < CONCLUSION_MARKERS.length; k++) {
      if (low.indexOf(' ' + CONCLUSION_MARKERS[k]) !== -1) { conclMarker = CONCLUSION_MARKERS[k]; break; }
    }

    var syntax = [];
    for (var m = 0; m < SYNTAX.length; m++) {
      if (SYNTAX[m].re.test(t)) syntax.push(SYNTAX[m].key);
    }

    // 级别未定时**不能**套用某一级的扣分表：四级要求 120 词、六级要求 150 词，
    // 拿四级规则算六级作文会得出错误的扣分。宁可不给，也不给错。
    var known = (level === '四级' || level === '六级');
    var ded = known ? deductionFor(level, n) : { deduct: 0, band: null };

    return {
      words: n,
      level: known ? level : null,
      range: known ? RANGE[level === '六级' ? 'cet6' : 'cet4'] : null,
      deduction: ded.deduct,
      deductionBand: ded.band || null,
      meetsLength: ded.deduct === 0,
      paras: paras.length,
      sentences: sents.length,
      sentenceLength: {
        mean: Math.round(mean * 10) / 10,
        std: Math.round(Math.sqrt(variance) * 10) / 10,
        max: lens.length ? Math.max.apply(null, lens) : 0,
        min: lens.length ? Math.min.apply(null, lens) : 0,
        longCount: lens.filter(function (x) { return x >= 30; }).length,
        shortCount: lens.filter(function (x) { return x <= 6; }).length,
      },
      conclusionMarker: conclMarker,
      cliches: cliches,
      repeats: repeats,
      syntax: syntax,
      syntaxCategories: syntax.length,
    };
  }

  /** 把统计结果格式化成注入提示词的区块；无正文时返回空串 */
  function format(a) {
    if (!a || !a.words) return '';
    var L = [];
    var lvl = a.level || '级别未定';
    var lenLine = a.words + ' 词';
    if (a.range) {
      lenLine += '（' + a.level + '要求 ' + a.range[0] + '-' + a.range[1] + ' 词）';
      lenLine += a.meetsLength
        ? '，达标'
        : '，不足，按官方扣分表应扣 ' + a.deduction + ' 分'
          + (a.deductionBand ? '（落入 ' + a.deductionBand + ' 词区间）' : '');
    } else {
      lenLine += '（级别未定：四级要求 120-180 词，六级要求 150-200 词）';
    }
    L.push('字数：' + lenLine);

    L.push('段落：' + a.paras + ' 段；结论段标记：' +
      (a.conclusionMarker ? '有（' + a.conclusionMarker + '）' : '未检测到'));

    L.push('句长：共 ' + a.sentences + ' 句，平均 ' + a.sentenceLength.mean +
      ' 词，标准差 ' + a.sentenceLength.std + '，最长 ' + a.sentenceLength.max +
      ' 词，最短 ' + a.sentenceLength.min + ' 词' +
      (a.sentenceLength.longCount ? '，其中 ' + a.sentenceLength.longCount + ' 句超过 30 词' : ''));

    L.push('句式类别（近似统计）：' +
      (a.syntax.length ? a.syntax.join('、') + '（共 ' + a.syntaxCategories + ' 类）' : '未检测到'));

    if (a.cliches.length) {
      L.push('套话命中：' + a.cliches.map(function (c) {
        return c.phrase + (c.count > 1 ? '×' + c.count : '');
      }).join('、'));
    } else {
      L.push('套话命中：无');
    }

    if (a.repeats.length) {
      L.push('高频重复词：' + a.repeats.map(function (r) {
        return r.word + '×' + r.count;
      }).join('、'));
    }

    return '【网页客观预检】以下由网页精确统计，**请以此为据，不要自行重新计数**；\n' +
      '这些是事实而非评分，档位判断仍由你完成。\n' +
      L.map(function (x) { return '- ' + x; }).join('\n');
  }

  var api = {
    DEDUCTION: DEDUCTION,
    CLICHES: CLICHES,
    CONCLUSION_MARKERS: CONCLUSION_MARKERS,
    deductionFor: deductionFor,
    analyze: analyze,
    format: format,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).precheck = api;
})(typeof self !== 'undefined' ? self : globalThis);
