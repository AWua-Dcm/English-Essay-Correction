/**
 * render.js — 白名单 Markdown 渲染器（先转义、后渲染）
 *
 * 支持子集（设计文档 §7.2）：#~#### 标题、**粗体**、*斜体*、行内代码、围栏代码块、
 * 有序/无序列表（一层嵌套）、> 引用块（含紧随列表项下方的引用行归入该列表项）、
 * --- 分隔线、[文本](http/https) 链接、段落与硬换行。
 * 不支持：表格、HTML 标签、图片（渲染为纯文本）、未知语法降级为普通文本。
 *
 * UMD-lite：浏览器挂 window.EEC.render，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var escapeHtml = (typeof module !== 'undefined' && module.exports)
    ? require('./util.js').escapeHtml
    : function (s) { return (root.EEC && root.EEC.util).escapeHtml(s); };

  /**
   * 行内代码占位符哨兵：运行时从私用区（U+E000–U+F8FF）挑选字符串中未出现的两个码点。
   * 源码不含任何非 ASCII 控制/私用字符，物理上保证哨兵与正文内容不冲突。
   */
  function pickSentinels(s) {
    var used = {};
    for (var i = 0; i < s.length; i++) used[s.charCodeAt(i)] = true;
    var found = [];
    for (var c = 0xE000; c <= 0xF8FF && found.length < 2; c++) {
      if (!used[c]) found.push(String.fromCharCode(c));
    }
    return found; // [open, close]
  }

  /** 行内渲染：escape 在前，标记占位/替换在后；不产生任何未转义的用户内容 */
  function inline(text) {
    var s = escapeHtml(String(text == null ? '' : text));
    var codeStore = [];
    var sent = pickSentinels(s);
    var phOpen = sent[0], phClose = sent[1];
    // 行内代码（先取出为占位符，避免其内部再被解析）
    s = s.replace(/`([^`]+)`/g, function (m, code) {
      codeStore.push('<code>' + code + '</code>');
      return phOpen + (codeStore.length - 1) + phClose;
    });
    // 粗体 → 斜体
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 链接：仅 http/https；javascript: 等保持纯文本；图片语法（前导 !）不处理
    s = s.replace(/(^|[^!])\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      function (m, pre, label, url) {
        return pre + '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
      });
    // 还原行内代码
    s = s.replace(new RegExp(phOpen + '(\\d+)' + phClose, 'g'),
      function (m, i) { return codeStore[+i]; });
    return s;
  }

  var LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var FENCE_RE = /^\s*(```|~~~)([A-Za-z0-9_-]*)\s*$/;
  var HEADING_RE = /^(#{1,4})\s+(.*)$/;
  var HR_RE = /^\s*(---|\*\*\*)\s*$/;
  var QUOTE_RE = /^\s*>\s?(.*)$/;

  /** 解析列表（一层嵌套；条目后紧随的引用行归入该条目）。返回下一行下标。 */
  function parseList(lines, start, out) {
    var i = start;
    var first = LIST_ITEM_RE.exec(lines[i]);
    var ordered = /\d/.test(first[2]);
    var items = [];
    var last = null;
    while (i < lines.length) {
      var line = lines[i];
      var mm = LIST_ITEM_RE.exec(line);
      if (mm) {
        var indent = mm[1].replace(/\t/g, '  ').length;
        var isOrdered = /\d/.test(mm[2]);
        if (indent >= 2 && last) {
          last.nested.push({ ordered: isOrdered, html: inline(mm[3]) });
        } else if (isOrdered !== ordered) {
          break; // 列表类型切换 → 结束当前列表
        } else {
          last = { html: inline(mm[3]), nested: [], quote: null };
          items.push(last);
        }
        i++; continue;
      }
      var qq = QUOTE_RE.exec(line);
      if (qq && last) { last.quote = inline(qq[1]); i++; continue; }
      break;
    }
    var html = ordered ? '<ol>' : '<ul>';
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      html += '<li>' + it.html;
      if (it.nested.length) {
        var no = it.nested[0].ordered;
        html += no ? '<ol>' : '<ul>';
        for (var j = 0; j < it.nested.length; j++) html += '<li>' + it.nested[j].html + '</li>';
        html += no ? '</ol>' : '</ul>';
      }
      if (it.quote !== null) html += '<blockquote>' + it.quote + '</blockquote>';
      html += '</li>';
    }
    html += ordered ? '</ol>' : '</ul>';
    out.push(html);
    return i;
  }

  /** 块级渲染（完整管线：先转义、后渲染） */
  function toHtml(md) {
    var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var fence = FENCE_RE.exec(line);
      if (fence) {
        var marker = fence[1];
        var lang = fence[2];
        var buf = [];
        i++;
        while (i < lines.length) {
          var close = /^\s*(```|~~~)\s*$/.exec(lines[i]);
          if (close && close[1] === marker) { i++; break; }
          buf.push(lines[i]); i++;
        }
        var cls = lang ? ' class="lang-' + escapeHtml(lang) + '"' : '';
        out.push('<pre><code' + cls + '>' + escapeHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      var h = HEADING_RE.exec(line);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }
      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }
      if (LIST_ITEM_RE.test(line)) { i = parseList(lines, i, out); continue; }
      var q = QUOTE_RE.exec(line);
      if (q) { out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); i++; continue; }
      // 段落（连续普通行，硬换行以 <br> 表示）
      var para = [];
      while (i < lines.length &&
             !/^\s*$/.test(lines[i]) &&
             !FENCE_RE.test(lines[i]) &&
             !HEADING_RE.test(lines[i]) &&
             !HR_RE.test(lines[i]) &&
             !QUOTE_RE.test(lines[i]) &&
             !LIST_ITEM_RE.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  /** 生成 DocumentFragment（浏览器）；Node 环境返回 HTML 字符串（由 toHtml 覆盖验证） */
  function toFragment(md) {
    var html = toHtml(md);
    if (typeof document === 'undefined') return html;
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content;
  }

  function renderMarkdown(md) { return toFragment(md); }

  var api = { toHtml: toHtml, toFragment: toFragment, renderMarkdown: renderMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).render = api;
})(typeof self !== 'undefined' ? self : globalThis);
