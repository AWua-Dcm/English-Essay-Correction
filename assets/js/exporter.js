/**
 * exporter.js — 导出：评分卡 HTML 构建（屏上/导出单一来源）、.md、独立单文件 .html、文件名
 * 独立 HTML 不引用任何外部资源、不含 <script>，离线可打开（设计文档 §10）。
 * UMD-lite：浏览器挂 window.EEC.exporter，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var util = isNode ? require('./util.js') : (root.EEC && root.EEC.util);
  var render = isNode ? require('./render.js') : (root.EEC && root.EEC.render);
  var prompt = isNode ? require('./prompt.js') : (root.EEC && root.EEC.prompt);

  var escapeHtml = function (s) { return util.escapeHtml(s); };

  var SCORE_META = [
    { key: 'content', name: '内容完整性', max: 5 },
    { key: 'structure', name: '篇章结构', max: 4 },
    { key: 'vocab', name: '词汇表达', max: 3 },
    { key: 'grammar', name: '语法准确性', max: 3 },
  ];

  /** 评分卡 DOM 字符串（屏上评分卡与导出共用；所有插值经转义） */
  function scorecardHtml(info) {
    info = info || {};
    var scores = info.scores || null;
    var tier = info.tier || '';
    var annotations = info.annotations || [];
    var html = '<div class="scorecard">';
    html += '<div class="sc-total">' + escapeHtml(String(scores && scores.total != null ? scores.total : '-')) +
      '<span class="sc-total-den">/15</span></div>';
    if (tier) html += '<div class="sc-tier">' + escapeHtml(tier) + '</div>';
    if (annotations.length) {
      html += '<ul class="sc-annotations">';
      for (var a = 0; a < annotations.length; a++) html += '<li>' + escapeHtml(annotations[a]) + '</li>';
      html += '</ul>';
    }
    for (var i = 0; i < SCORE_META.length; i++) {
      var m = SCORE_META[i];
      var v = (scores && scores[m.key] != null) ? scores[m.key] : null;
      var num = Number(v);
      var pct = (v == null || !isFinite(num)) ? 0 : Math.max(0, Math.min(100, Math.round(num / m.max * 100)));
      html += '<div class="sc-row" data-key="' + m.key + '">' +
        '<span class="sc-name">' + m.name + '</span>' +
        '<span class="sc-points">' + (v == null ? '-' : escapeHtml(String(v))) + ' / ' + m.max + '</span>' +
        '<div class="sc-bar"><div class="sc-bar-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
    }
    html += '<p class="sc-note">四项得分之和即总分；档次为官方分数区间。</p>';
    html += '</div>';
    return html;
  }

  /** 导出文件名：批改报告_YYYY-MM-DD_级别_题目截断.html（非法字符全替换、题目截 20 字） */
  function reportFilename(entry) {
    var date = util.formatDateShort(entry && entry.ts);
    var level = (entry && entry.level) || '自动推断';
    var title = String((entry && entry.title) || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    if (!title) title = '未命名';
    if (title.length > 20) title = title.slice(0, 20);
    return '批改报告_' + date + '_' + level + '_' + title + '.html';
  }

  function tierOf(entry) {
    return (entry && entry.scores && entry.scores.total != null) ? prompt.tierFor(entry.scores.total) : '';
  }

  /** Markdown 导出：元信息 + 分数摘要（纯文本列表）+ 报告原文；不含任何 json 围栏 */
  function toMarkdown(entry) {
    entry = entry || {};
    var lines = [];
    lines.push('# 四六级作文批改报告');
    lines.push('');
    lines.push('- 日期：' + util.formatDate(entry.ts));
    lines.push('- 级别：' + (entry.level || '自动推断'));
    lines.push('- 题目：' + (entry.title || '未提供'));
    lines.push('- 原作文词数：' + (entry.words == null ? '-' : entry.words));
    if (entry.optimizedInfo && entry.optimizedInfo.words != null) {
      lines.push('- 优化版：' + entry.optimizedInfo.words + ' 词 · ' + entry.optimizedInfo.verdict +
        '（' + entry.optimizedInfo.rangeText + '）');
    } else if (entry.optimizedWords != null) {
      lines.push('- 优化版词数：' + entry.optimizedWords);
    }
    if (entry.scores) {
      var tier = tierOf(entry);
      lines.push('- 总分：' + entry.scores.total + ' / 15' + (tier ? '（' + tier + '）' : ''));
      lines.push('- 分项：内容完整性 ' + entry.scores.content + '/5、篇章结构 ' + entry.scores.structure +
        '/4、词汇表达 ' + entry.scores.vocab + '/3、语法准确性 ' + entry.scores.grammar + '/3');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(String(entry.reportMd || ''));
    var md = lines.join('\n');
    // 保险：剥离任何残留的 json 围栏（正常路径已被 extractScoreBlock 消费）
    return md.replace(/```[ \t]*json[\s\S]*?```/gi, '').replace(/\n{3,}/g, '\n\n');
  }

  var INLINE_CSS = [
    'body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#232323;background:#fff;margin:0;}',
    '.page{max-width:820px;margin:0 auto;padding:28px 20px 40px;}',
    'h1,h2,h3{line-height:1.4;}',
    '.report-head{border-bottom:2px solid #2f6f4f;padding-bottom:12px;margin-bottom:18px;}',
    '.report-head h1{margin:0 0 6px;font-size:21px;}',
    '.report-head p{margin:2px 0;color:#555;font-size:13px;}',
    '.scorecard{border:1px solid #d8e4dc;border-radius:10px;padding:14px 16px;margin:16px 0;}',
    '.sc-total{font-size:32px;font-weight:700;color:#2f6f4f;}',
    '.sc-total-den{font-size:14px;color:#888;font-weight:400;margin-left:4px;}',
    '.sc-tier{display:inline-block;background:#eef6f0;color:#2f6f4f;border-radius:12px;padding:2px 10px;font-size:13px;margin:4px 0;}',
    '.sc-annotations{margin:4px 0;padding-left:18px;color:#996a00;font-size:12px;}',
    '.sc-row{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:13px;}',
    '.sc-name{width:76px;color:#444;}',
    '.sc-points{width:52px;color:#333;}',
    '.sc-bar{flex:1;height:8px;background:#eef1ef;border-radius:4px;overflow:hidden;}',
    '.sc-bar-fill{height:100%;background:#2f6f4f;}',
    '.sc-note{color:#888;font-size:12px;margin:10px 0 0;}',
    '.report-body h2{font-size:17px;border-left:4px solid #2f6f4f;padding-left:10px;margin:26px 0 10px;}',
    '.report-body h3{font-size:15px;color:#3a3a3a;}',
    '.report-body blockquote{margin:6px 0 6px 0;padding:6px 12px;border-left:3px solid #c9d8cf;background:#f7faf8;color:#444;}',
    '.report-body pre{background:#f6f6f6;padding:10px;border-radius:6px;overflow:auto;}',
    '.report-body code{font-family:Consolas,Menlo,monospace;}',
    '.report-foot{margin-top:34px;border-top:1px solid #e3e3e3;padding-top:10px;color:#777;font-size:12px;line-height:1.7;}',
    '@page{size:A4;margin:18mm;}',
    '@media print{body{color:#000;}.page{max-width:none;padding:0;}}',
  ].join('\n');

  /** 独立单文件 HTML：样式内联、无脚本、离线可打开（设计文档 §10.3） */
  function toStandaloneHtml(entry) {
    entry = entry || {};
    var title = (entry.title || '作文批改');
    var bodyHtml = render.toHtml(String(entry.reportMd || ''));
    var card = entry.scores
      ? scorecardHtml({ scores: entry.scores, tier: tierOf(entry), annotations: [] })
      : '';
    return '<!doctype html>\n' +
      '<html lang="zh-CN">\n' +
      '<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml('批改报告 · ' + title) + '</title>\n<style>\n' + INLINE_CSS + '\n</style>\n</head>\n' +
      '<body>\n<div class="page">\n' +
      '<header class="report-head">' +
      '<h1>四六级作文 AI 批改报告</h1>' +
      '<p>日期：' + escapeHtml(util.formatDate(entry.ts)) + '　级别：' + escapeHtml(entry.level || '自动推断') +
      '　题目：' + escapeHtml(title) + '</p>' +
      (entry.scores ? '<p>总分：' + escapeHtml(String(entry.scores.total)) + ' / 15　原作文：' +
        escapeHtml(String(entry.words == null ? '-' : entry.words)) + ' 词' +
        (entry.optimizedInfo && entry.optimizedInfo.words != null
          ? '　优化版：' + escapeHtml(String(entry.optimizedInfo.words)) + ' 词 · ' +
            escapeHtml(entry.optimizedInfo.verdict) + '（' + escapeHtml(entry.optimizedInfo.rangeText) + '）'
          : (entry.optimizedWords != null ? '　优化版：' + escapeHtml(String(entry.optimizedWords)) + ' 词' : '')) + '</p>' : '') +
      '</header>\n' +
      card + '\n' +
      '<main class="report-body">\n' + bodyHtml + '\n</main>\n' +
      '<footer class="report-foot">' +
      '<p>本报告由 AI 生成，仅供学习参考，不代表官方评分。</p>' +
      '<p>免 Key 也能批改（复制模式），全程免费。图片作文在复制模式下：请把作文照片直接发送到你所用的 AI 对话里，本页上传的照片不会离开你的浏览器。</p>' +
      '</footer>\n' +
      '</div>\n</body>\n</html>\n';
  }

  var api = {
    scorecardHtml: scorecardHtml,
    reportFilename: reportFilename,
    toMarkdown: toMarkdown,
    toStandaloneHtml: toStandaloneHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).exporter = api;
})(typeof self !== 'undefined' ? self : globalThis);
