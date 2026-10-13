'use strict';
const test = require('node:test');
const assert = require('node:assert');
const render = require('../assets/js/render.js');

test('标题 #~#### 生成对应层级', () => {
  assert.match(render.toHtml('## 步骤① 总分与分项'), /<h2[^>]*>步骤① 总分与分项<\/h2>/);
  assert.match(render.toHtml('#### 深标题'), /<h4/);
});

test('粗体/斜体/行内代码', () => {
  assert.match(render.toHtml('**加粗** 与 *斜体* 与 `code<&>`'),
    /<strong>加粗<\/strong>.*<em>斜体<\/em>.*<code>code&lt;&amp;&gt;<\/code>/s);
});

test('围栏代码块不解析内部标记', () => {
  const html = render.toHtml('```\n**not bold** <b>\n```');
  assert.match(html, /<pre><code>/); assert.ok(!html.includes('<strong>'));
});

test('有序/无序列表与一层嵌套', () => {
  const html = render.toHtml('- a\n  - a1\n- b\n\n1. one\n2. two');
  assert.match(html, /<ul>[\s\S]*<li>a<ul><li>a1<\/li><\/ul><\/li>/);
  assert.match(html, /<ol>[\s\S]*<li>one<\/li>/);
});

test('列表项下方的引用行归入该列表项', () => {
  const html = render.toHtml('1. 问题类型：中式英语\n> 原文原句：The society is become more better.\n\n2. 下一项');
  assert.match(html, /<li>[\s\S]*<blockquote>[\s\S]*The society is become more better\.[\s\S]*<\/blockquote>[\s\S]*<\/li>/);
});

test('引用块、分隔线', () => {
  assert.match(render.toHtml('> quote\n\n---'), /<blockquote>quote<\/blockquote>/);
  assert.match(render.toHtml('---'), /<hr>/);
});

test('链接仅 http/https，安全属性，危险 scheme 变纯文本', () => {
  assert.match(render.toHtml('[文档](https://a.b/c)'),
    /<a href="https:\/\/a\.b\/c" target="_blank" rel="noopener">文档<\/a>/);
  const bad = render.toHtml('[x](javascript:alert(1))');
  assert.ok(!bad.includes('<a '));
});

test('XSS 套件：所有注入在输出中被转义', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '**<svg/onload=alert(1)>**',
    '<a href="javascript:alert(1)">x</a>',
    '&#60;script&#62;alert(1)&#60;/script&#62;',
  ];
  for (const a of attacks) {
    const html = render.toHtml(a);
    assert.ok(!/<script|<img|<svg/i.test(html), `未转义: ${a} -> ${html}`);
    assert.ok(!/href="javascript:/i.test(html));
  }
});

test('图片语法渲染为纯文本（不支持）', () => {
  const html = render.toHtml('![alt](https://a.b/c.png)');
  assert.ok(!html.includes('<img')); assert.ok(html.includes('alt'));
});

test('未知语法按普通段落降级', () => {
  assert.match(render.toHtml('| a | b |'), /<p>\| a \| b \|<\/p>/);
});
