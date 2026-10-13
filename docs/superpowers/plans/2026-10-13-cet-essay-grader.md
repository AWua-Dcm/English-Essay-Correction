# 四六级作文 AI 批改台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个零依赖纯静态的"四六级作文 AI 批改"网页工具（双模式：浏览器直连大模型自动批改 / 免 Key 复制指令批改），并部署到 GitHub Pages（`https://awua-dcm.github.io/English-Essay-Correction/`）。

**Architecture:** 原生 HTML/CSS/JS 单页（普通 script 按序加载，无构建、无运行时第三方依赖、无 CDN）；`window.EEC` 命名空间下 10 个模块（util / render / providers / prompt / api / store / exporter / demo / app）；所有模块以 UMD-lite 收尾（浏览器挂 `EEC.<name>`，Node 下 `module.exports`）以便 `node --test` 直接单测。批改提示词 = 设计文档附录 A（模板正本）+ 附录 B（输出协议），逐字组装。

**Tech Stack:** 原生 JavaScript（ES2020，非 ES Modules）、HTML、CSS；测试：`node --test` + jsdom（仅 devDependency）。

**Spec:** `docs/superpowers/specs/2026-10-13-cet-essay-grader-design.md`（v2，用户已复核通过；本计划一切行为细节以该文档为准）

## Global Constraints（每个任务隐含遵守；数值取自设计文档）

- 零第三方**运行时**依赖；不引用任何 CDN；devDependencies 仅 `jsdom`。
- 不使用 ES Modules；`index.html` 中 `<script>` 按序加载：`util, render, providers, prompt, api, store, exporter, demo, app`。
- 所有资源引用一律**相对路径**：禁止 `(src|href)="/` 开头、禁止写死 `awua-dcm.github.io` 绝对 URL。
- 提示词 = 附录 A + 附录 B **逐字**；组装结果中禁止出现 "GitHub"、"仓库"、"推送" 字样（有测试断言）。
- 存储键：`eec.settings.v1` / `eec.draft.v1` / `eec.history.index.v1` / `eec.history.v1.<id>`；历史 100 条上限、单条 `reportMd` 40KB 上限。
- 词数区间：四级 120–180；六级 150–200。统计正则 `[A-Za-z]+(?:['’-][A-Za-z]+)*`。
- 评分：`0≤content≤5, 0≤structure≤4, 0≤vocab≤3, 0≤grammar≤3`；`total` 一律**本地重算**为四项之和；档次一律**本地重算**（13-15/10-12/7-9/4-6/0-3 → "1-3分档"含 0）。
- 界面文案全部中文；页脚必须含设计文档 §2.3 文案与免责声明。
- 移动端：`font-size ≥ 16px` 的输入控件、`viewport` meta、含 `env(safe-area-inset-bottom)` 的 sticky 操作条。
- `file://` 双击可打开（普通 script，无 ES Modules；fetch 受限时的行为见 §5.1.9）。
- 单一门禁命令：`npm test`（= `node --test tests/`）。

## Review Focus（设计文档隐含、测试矩阵最容易漏的 5 类输入/失败模式）

1. **模型输出完全不合协议**（纯散文、无 JSON、无标题）→ 期望：整段渲染 + "未解析到结构化分数"说明，界面不空白、不崩溃。测试落在 Task 7（parseMode:'none'）与 Task 12（dom：无标题提示条）。
2. **从微信/QQ 复制的文本**（Markdown 被剥离、带聊天寒暄、混入多余内容）→ 期望：仍渲染；标题丢失时给"用复制按钮重新复制"指引而非静默降级。测试落在 Task 12（真实形态夹具）。
3. **超长作文（>800 词）+ 多图**→ 期望：token 预算计算与上限告警生效，不产生 400、不被静默截断。测试落在 Task 6（computeMaxTokens 边界）与 Task 11（截断横幅）。
4. **流式中途 停止/断网/切后台**→ 期望：保留已生成内容并标注、可导出、草稿不丢。测试落在 Task 8（草稿恢复）与 Task 11（dom 停止用例）。
5. **localStorage 写满 + 双开标签页**→ 期望：淘汰最旧条目重试后新报告仍能保存，无未捕获异常。测试落在 Task 7（配额淘汰用例）。

## 文件结构（创建顺序 = 任务顺序）

```
package.json                     # 无构建；scripts.test = node --test tests/；devDeps: jsdom   (Task 1)
.nojekyll                                                                                        (Task 1)
assets/js/util.js                # 工具 + imagePolicy + 剪贴板降级（wordBadge 于 T10 增补）        (Task 1)
assets/js/render.js              # 白名单渲染（T2）+ 稳定前缀流式渲染（T3）                        (Task 2,3)
assets/js/providers.js           # 服务商预设表                                                    (Task 4)
assets/js/prompt.js              # 模板正本/协议/组装（T4）+ 解析/切分（T5）                       (Task 4,5)
assets/js/api.js                 # SSE 解析/token 预算/错误分类/streamChat                        (Task 6)
assets/js/store.js               # 设置/草稿/历史（索引+分条+配额韧性）                             (Task 7)
assets/js/exporter.js            # .md / 独立 .html / 评分卡 builder / 文件名                      (Task 8)
assets/js/demo.js                # 示例作文（词数受测试校验）                                        (Task 8)
assets/img/favicon.svg           # 站点图标                                                        (Task 9)
index.html                       # 页面结构（DOM 契约见下）                                         (Task 9)
assets/css/style.css             # 全部样式（含移动端/打印）                                        (Task 9)
assets/js/app.js                 # 编排：输入区(T10) / 自动流(T11) / 复制·导出·抽屉(T12)
tests/helpers.cjs                # jsdom 装载器（T10）+ fetch 桩（T11）
tests/util.test.cjs              # T1（wordBadge 用例于 T10 增补）    tests/render.test.cjs  # T2/T3
tests/prompt.test.cjs            # T4/T5                              tests/api.test.cjs     # T6
tests/store.test.cjs             # T7                                 tests/exporter.test.cjs # T8
tests/static.test.cjs            # T9/T13                             tests/dom.test.cjs      # T10/T11/T12
README.md                        # §12.8 清单                                                       (Task 13)
```

### DOM / ID 契约（Task 10 实现，Task 11-13 使用；static.test.cjs 断言存在）

- 横幅：`#file-banner`、`#wechat-banner`、`#first-run-card`（含 `#first-run-close`）
- 输入区：`#mode-strip`(button)、`#level-pills`（内含 `button.level-pill[data-level="cet4"|"cet6"|"auto"]`）、`#essay-title`、`#essay-text`、`#word-badge`、`#image-input-camera`、`#image-input-gallery`、`#image-thumbs`、`#sticky-actions`（内含 `#btn-grade` `#btn-copy-prompt` `#btn-demo`）
- 复制面板：`#copy-panel`、`#copy-prompt-preview`(只读 textarea)、`#btn-copy-text`、`#paste-box`、`#btn-render-paste`、`#paste-warning`、`#btn-render-anyway`、`#copy-tip`
- 报告区：`#report-area`、`#report-nav`（评分卡/①/②/③/④/`#nav-top`）、`#scorecard`、`#parse-note`、`#report-body`、`#report-toolbar`（`#btn-print` `#btn-export-md` `#btn-export-html` `#btn-regrade`）、`#stream-status`、`#btn-stop`、`#btn-back-latest`、`#truncation-banner`
- 抽屉与入口：`#drawer-backdrop`、`#settings-drawer`（`#sel-provider` `#inp-key` `#btn-toggle-key` `#inp-model` `#inp-baseurl` `#btn-test-conn` `#btn-save-settings` `#btn-clear-data` `#preset-date`）、`#history-drawer`（`#history-list` `#btn-clear-history`）、页头历史入口 `#history-open`
- 其他：`#toast`、`#live-status`(aria-live)

**评分卡子结构**：`.scorecard > .sc-total`(总分数字) `.sc-total-den`(应付"/15")、`.sc-tier`、`.sc-annotations`(ul)、`.sc-row[data-key="content|structure|vocab|grammar"] > .sc-name .sc-points .sc-bar>.sc-bar-fill`。

**代码包含策略（本计划约定）**：所有测试代码给全（测试即契约）；核心算法（SSE 解析、分数归一化、稳定性渲染、token 预算、配额淘汰、剪贴板降级、XSS 渲染）给出完整可粘贴实现；其余实现步骤给出精确到字符串/正则/签名的规格 + 关键片段，验收以该任务测试全绿为准。

---

### Task 1: 脚手架与 `util.js`

**Files:**
- Create: `package.json`, `.nojekyll`, `assets/js/util.js`, `tests/util.test.cjs`

**Interfaces:**
- Produces: `EEC.util = { escapeHtml(s): string; wordCount(text): number; formatDate(ts): string; formatDateShort(ts): string; truncate(s, n): string; debounce(fn, ms): Function; isWeChatOrQQ(ua): boolean; downloadFile(name, content, mime): void; copyText(text): Promise<boolean>; isHeic({name, type}): boolean; imagePolicy({name, type, size}): {accept: boolean, reason?: 'heic'|'type'|'size'} }`

- [ ] **Step 1: 写 `package.json` 与 `.nojekyll`**

```json
{
  "name": "english-essay-correction",
  "private": true,
  "version": "1.0.0",
  "description": "四六级作文 AI 批改台：零依赖纯静态网页工具",
  "scripts": { "test": "node --test tests/" },
  "devDependencies": { "jsdom": "^26.0.0" }
}
```

`.nojekyll` 为空文件。执行 `npm install`（jsdom 从 npmjs 安装，已实测可达）。

- [ ] **Step 2: 写失败测试 `tests/util.test.cjs`（完整）**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const util = require('../assets/js/util.js');

test('escapeHtml 转义全部关键字符', () => {
  assert.strictEqual(util.escapeHtml(`<img src="x" onerror='a&b'>`),
    '&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;');
});

test('wordCount 处理缩写/连字符/数字/连续空格', () => {
  assert.strictEqual(util.wordCount("Don't  worry —  it's well-known, 42 times!"), 7);
  assert.strictEqual(util.wordCount(''), 0);
  assert.strictEqual(util.wordCount('   \n\n  '), 0);
});

test('formatDate / formatDateShort 零填充', () => {
  const ts = new Date(2026, 0, 5, 9, 7).getTime();
  assert.strictEqual(util.formatDateShort(ts), '2026-01-05');
  assert.strictEqual(util.formatDate(ts), '2026-01-05 09:07');
});

test('truncate 不超长且加省略号', () => {
  assert.strictEqual(util.truncate('abcdef', 4), 'abc…');
  assert.strictEqual(util.truncate('abc', 4), 'abc');
});

test('debounce 延迟执行且可 flush', async () => {
  let n = 0; const d = util.debounce(() => { n++; }, 10);
  d(); d(); d();
  assert.strictEqual(n, 0);
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(n, 1);
});

test('isWeChatOrQQ 识别微信与 QQ UA', () => {
  assert.strictEqual(util.isWeChatOrQQ('... MicroMessenger/8.0 ...'), true);
  assert.strictEqual(util.isWeChatOrQQ('Mozilla/5.0 ... QQ/8.9'), true);
  assert.strictEqual(util.isWeChatOrQQ('Mozilla/5.0 Chrome/120'), false);
});

test('isHeic 按扩展名与 MIME 判断（iOS 空 type 不误判）', () => {
  assert.strictEqual(util.isHeic({ name: 'IMG_1.HEIC', type: '' }), true);
  assert.strictEqual(util.isHeic({ name: 'a.heif', type: '' }), true);
  assert.strictEqual(util.isHeic({ name: 'x', type: 'image/heic' }), true);
  assert.strictEqual(util.isHeic({ name: 'a.jpg', type: '' }), false);
});

test('imagePolicy 判定优先级：heic > size > type（空 type 放行）', () => {
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.heic', type: '', size: 10 }),
    { accept: false, reason: 'heic' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 }),
    { accept: false, reason: 'size' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'a.gif', type: 'image/gif', size: 10 }),
    { accept: false, reason: 'type' });
  assert.deepStrictEqual(util.imagePolicy({ name: 'IMG_2', type: '', size: 5 * 1024 * 1024 }),
    { accept: true });
});

test('copyText 降级链：clipboard 失败走 execCommand，两者失败返回 false', async () => {
  const mk = (clipboardOk, execOk) => {
    global.navigator = { clipboard: clipboardOk ? { writeText: async () => {} } : { writeText: async () => { throw new Error('x'); } } };
    global.document = { execCommand: () => execOk, createElement: () => ({ style: {}, select() {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } };
  };
  mk(true, false);  assert.strictEqual(await util.copyText('t'), true);
  mk(false, true);  assert.strictEqual(await util.copyText('t'), true);
  mk(false, false); assert.strictEqual(await util.copyText('t'), false);
});
```

- [ ] **Step 3: 运行测试确认失败**：`npm test` → FAIL（`Cannot find module '../assets/js/util.js'`）。

- [ ] **Step 4: 实现 `assets/js/util.js`（完整）**

要点（全部按测试行为实现）：`escapeHtml` 转义 `& < > " '`（顺序：先 `&`）；`wordCount` 用 `/[A-Za-z]+(?:['’-][A-Za-z]+)*/g`；`formatDate*` 用 `padStart(2,'0')`；`copyText`：`navigator.clipboard.writeText` try/catch → 隐藏 textarea + `document.execCommand('copy')`（finally 移除）→ 均失败 `false`（**绝不假成功**）；`imagePolicy` 优先级 heic → size(>25MB) → type（type 为空串放行、仅允许 `image/jpeg|png|webp`）；UMD-lite 收尾：

```js
(function (root) {
  'use strict';
  // ...实现...
  const api = { escapeHtml, wordCount, formatDate, formatDateShort, truncate, debounce, isWeChatOrQQ, downloadFile, copyText, isHeic, imagePolicy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).util = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 5: 运行测试确认通过**：`npm test` → 全部 PASS。

- [ ] **Step 6: 提交**：`git add package.json .nojekyll assets/js/util.js tests/util.test.cjs package-lock.json` → `git commit -m "feat: scaffold project and util module with clipboard fallback chain"`

---

### Task 2: `render.js` — 白名单 Markdown 渲染器（静态）

**Files:**
- Create: `assets/js/render.js`（第一部分）、`tests/render.test.cjs`

**Interfaces:**
- Consumes: `EEC.util.escapeHtml`
- Produces: `EEC.render.renderMarkdown(md: string): DocumentFragment`（在 Node 测试中返回字符串由 `toHtml(md)` 辅助导出：`EEC.render.toHtml(md): string`，浏览器渲染走 `renderMarkdown` 内部同一管线）

- [ ] **Step 1: 写失败测试 `tests/render.test.cjs`（完整）**

```js
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
```

- [ ] **Step 2: 运行确认失败**：`npm test` → render 相关 FAIL（module not found）。

- [ ] **Step 3: 实现 `render.js` 静态部分（完整）**

管线（**先转义、后渲染**）：`toHtml(md)` = 行级切块 → 逐块内联处理；`inline(text)` 顺序：escapeHtml → 行内代码 `` ` `` 占位（防其内部再解析）→ `**粗**` → `*斜*` → `[文本](http...)`（其余 scheme 保留为纯文本）→ 还原代码占位。块级规则：围栏 ``` / ~~~（含语言串，`json` 语言块照常输出 `<pre><code class="lang-json">`，是否隐藏由调用方决定）；`#{1,4} ` 标题；`---` 分隔线；`> ` 引用（**紧随其前的列表项若与引用行之间无空行，引用块作为该 `</li>` 前最后一个子节点插入**）；`- ` / `* ` 无序与 `1. ` 有序列表（缩进 2 空格一层嵌套）；其余为段落。输出统一 `<p>` 包裹。`renderMarkdown` 用 `template` 元素承载 `toHtml` 后返回 `content`。

- [ ] **Step 4: 运行确认通过**：`npm test` → 全部 PASS。

- [ ] **Step 5: 提交**：`git add assets/js/render.js tests/render.test.cjs` → `git commit -m "feat(render): escape-first whitelist markdown renderer with XSS test suite"`

---

### Task 3: `render.js` — 稳定前缀追加式流式渲染

**Files:**
- Modify: `assets/js/render.js`（追加）、`tests/render.test.cjs`（追加用例）

**Interfaces:**
- Produces: `EEC.render.createStreamRenderer(container: Element): { update(fullMd: string): void; finalize(): void; clear(): void }`
- 语义：以"空行且不在围栏内"为块边界；**已完成的块只渲染一次、永不重绘**；每 tick 只重渲染最后一个未稳定块；尾部未闭合围栏/行内标记在显示时自动补全（仅视觉）。

- [ ] **Step 1: 追加失败测试（完整）**

```js
test('流式：完成块只渲染一次，尾部块被重渲染', () => {
  // 用 jsdom 提供 DOM
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="c"></div>');
  const c = dom.window.document.getElementById('c');
  const sr = render.createStreamRenderer(c);
  sr.update('## 标题A\n\n正文一');
  const h2 = c.querySelector('h2');
  const h2Ref = h2;
  sr.update('## 标题A\n\n正文一\n\n## 标题B\n\n正文二');
  assert.strictEqual(c.querySelector('h2'), h2Ref, '已完成块被重绘了');
  assert.strictEqual(c.querySelectorAll('h2').length, 2);
});

test('流式：未闭合围栏显示为已闭合（尾部不整段吞掉）', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="c"></div>');
  const c = dom.window.document.getElementById('c');
  const sr = render.createStreamRenderer(c);
  sr.update('段前\n\n```\ncode line');
  assert.ok(c.querySelector('pre code'), '未闭合围栏应显示为代码块');
  sr.finalize();
});

test('流式：clear 清空容器', () => {
  const { JSDOM } = require('jsdom');
  const c = new JSDOM('<div id="c"></div>').window.document.getElementById('c');
  const sr = render.createStreamRenderer(c);
  sr.update('x'); sr.clear(); assert.strictEqual(c.innerHTML, '');
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（createStreamRenderer 未定义）。

- [ ] **Step 3: 实现（完整）**

```js
function createStreamRenderer(container) {
  let stableMd = '';        // 已渲染完成的稳定前缀（不含尾部未稳定块）
  let renderedCount = 0;    // 已渲染的块元素数（用于增量 append）
  let tailEl = null;        // 当前尾部未稳定块容器
  function splitStable(md) {
    // 返回 {stable, tail}：从后向前找到最后一个"行尾终止于空行且不在围栏内"的切点
    const lines = md.split('\n');
    let fence = false, cut = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^(```|~~~)/.test(t)) fence = !fence;
      if (!fence && t === '' && i > 0) cut = i; // 候选切点（空行位置）
    }
    if (cut === -1 || fence) return { stable: '', tail: md };
    // cut 之后可能还有内容 → 切在最后一个空行之后
    return { stable: lines.slice(0, cut + 1).join('\n'), tail: lines.slice(cut + 1).join('\n') };
  }
  function autoClose(md) { // 视觉补全：未闭合围栏 / 行内标记
    const fences = (md.match(/^(```|~~~)/gm) || []).length;
    if (fences % 2 === 1) md += '\n```';
    const bold = (md.match(/\*\*/g) || []).length;
    if (bold % 2 === 1) md += '**';
    return md;
  }
  function renderInto(el, md) { el.innerHTML = ''; el.appendChild(toFragment(md)); }
  return {
    update(fullMd) {
      const { stable, tail } = splitStable(fullMd);
      if (stable !== stableMd) {
        const stableFrag = toFragment(stable.slice(stableMd.length));
        container.appendChild(stableFrag);   // 只追加增量，不重绘
        stableMd = stable;
      }
      if (!tailEl) { tailEl = document.createElement('div'); tailEl.className = 'stream-tail'; container.appendChild(tailEl); }
      renderInto(tailEl, autoClose(tail));   // 只重画尾部
      renderedCount++;
    },
    finalize() {
      if (tailEl) { renderInto(tailEl, tailEl.getAttribute('data-last') || tailEl.textContent); tailEl.removeAttribute('class'); }
    },
    clear() { container.innerHTML = ''; stableMd = ''; tailEl = null; },
  };
}
```

（实现细节以测试为准；`toFragment` 为内部 `toHtml` 的 DocumentFragment 版本。`finalize` 收尾时把尾部按"已结束文档"重画一次以移除自动补全痕迹。）

- [ ] **Step 4: 运行确认通过** → PASS（全部 render 用例）。

- [ ] **Step 5: 提交**：`git commit -m "feat(render): stable-prefix append streaming renderer"`

---

### Task 4: `providers.js` + `prompt.js` 第一部分（模板正本与组装）

**Files:**
- Create: `assets/js/providers.js`、`assets/js/prompt.js`、`tests/prompt.test.cjs`

**Interfaces:**
- Produces:
  - `EEC.providers.PROVIDERS: Preset[]`；`EEC.providers.byId(id): Preset|undefined`；`EEC.providers.DEFAULT_PROVIDER_ID`（`'deepseek'`）。`Preset = { id, name, baseURL, defaultModel, visionModels: string[], browserDirect: 'verified'|'partial'|'proxy-required'|'custom', contextWindow: number, maxOutput: number, lastChecked: '2026-10-13', note?: string }`
  - `EEC.prompt.TEMPLATE: string`（附录 A 正本）、`EEC.prompt.PROTOCOL: string`（附录 B 正本）
  - `EEC.prompt.buildSystemPrompt(): string`（= TEMPLATE + '\n\n' + PROTOCOL）
  - `EEC.prompt.buildMetaBlock({ level, title, text, images }): string`（level ∈ '四级'|'六级'|'auto'；images = 图片数）
  - `EEC.prompt.buildCopyText({ level, title, text, images }): string`
  - `EEC.prompt.displayText(md): string`（隐藏开头分数 JSON 围栏：闭合则删去；未闭合且长度 <4000 字符则返回空串；超 4000 未闭合放弃隐藏）

- [ ] **Step 1: 写失败测试 `tests/prompt.test.cjs`（完整）**

```js
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
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

将设计文档**附录 A、附录 B 全文逐字**录入 `prompt.js` 的两个模板字符串（反引号模板串，注意转义内部反引号 `\``）。`buildMetaBlock` 按 §6.1 三态拼装（词数行用 `EEC.util.wordCount(text)`）。`buildCopyText` 按 §9.1 拼装。`displayText`：若开头（允许前导空白）是 ` ```json ` 或 ` ```JSON ` 围栏 → 找闭合围栏：找到则返回其后内容；未找到且输入 <4000 字符返回 `''`，否则原样返回。`providers.js` 按设计文档 §6.2 表格录入 8 项预设（含默认值与 `lastChecked: '2026-10-13'`；siliconflow 的 `note` 写"Allow-Headers 为通配符，Chrome 可能拦截 Authorization；直连未完全验证"）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(prompt): verbatim template + protocol + assembly; providers presets"`

---

### Task 5: `prompt.js` 第二部分 — 分数块解析与报告切分

**Files:**
- Modify: `assets/js/prompt.js`、`tests/prompt.test.cjs`（追加）

**Interfaces:**
- Produces:
  - `EEC.prompt.extractScoreBlock(md): { status: 'ok'|'unreadable'|null, level: '四级'|'六级'|null, scores: { total, content, structure, vocab, grammar }|null, note: string|null, annotations: string[], parseMode: 'json'|'regex'|'none', textWithout: string }`（`scores.total` 一律为四项之和的本地重算值）
  - `EEC.prompt.tierFor(total): string`（'13-15分档'|'10-12分档'|'7-9分档'|'4-6分档'|'1-3分档'）
  - `EEC.prompt.splitReport(md): { preamble: string, steps: Array<{ index: 1|2|3|4, title: string, body: string }>, found: number }`（容错匹配标题变体；`found` 为识别到的步骤数）
  - `EEC.prompt.extractOptimizedBody(step4Body): string|null`（`### 优化版本正文` 与下一个标题之间；缺失返回 null）

- [ ] **Step 1: 追加失败测试（完整）**

```js
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
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现（关键算法，完整）**

JSON 定位顺序：全文搜索围栏 ```json/```JSON/~~~json（大小写不敏感）且内容含 `"total"` 或 `"status"` 的块 → 否则扫描第一个包含 `"total"` 或 `"status"` 的 `{...}`（花括号配对截取）→ 解析（先去零宽字符 `​-‍﻿`、截取首 `{` 至末 `}`）→ 校验四子项为整数且在范围内 → `total = 四者之和`（与模型值不一致时追加注记"模型给出总分与四项之和不一致，已按四项之和显示"）→ `level` 白名单 {四级, 六级} → 从 `textWithout` 中删除被消费的围栏原文。失败 → 正则降级：先剥 `*` 与空白，匹配 `/总分\s*[:：]?\s*(\d{1,2})\s*(?:\/\s*15|分)/`，四项分别匹配 `/内容(?:完整性)?\s*[:：]?\s*(\d)/`、`/篇章结构\s*[:：]?\s*(\d)/`、`/词汇(?:表达)?\s*[:：]?\s*(\d)/`、`/语法(?:准确性)?\s*[:：]?\s*(\d)/`，全部命中且范围合法才成功（parseMode:'regex'，含注记"（解析方式：文本提取）"）→ 否则 parseMode:'none'，正文原样。`splitReport` 标题正则：`/^\s*#{2,4}\s*步骤\s*[①②③④1-4一-四]\s*[:：]?\s*(总分|逐条|建议|优化)/`（映射 1=总分, 2=逐条, 3=建议, 4=优化；"总分与分项/总分"均归 1，正文为标题行之后到下一个标题之间的内容）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(prompt): tolerant score-block extraction and report splitting"`

---

### Task 6: `api.js` — 行解码器、SSE 解析、token 预算、错误分类、`streamChat`

**Files:**
- Create: `assets/js/api.js`、`tests/api.test.cjs`

**Interfaces:**
- Produces:
  - `EEC.api.createLineDecoder(): { push(bytes: Uint8Array): string[]; end(): string[] }`（内部 `TextDecoder('utf-8')` + `decode(chunk, {stream:true})` 单例；按 `\n` 切行、剥 `\r`；跨 chunk 保留残行）
  - `EEC.api.createSSEParser(): { pushLine(line: string): SSEEvent[] }`；`SSEEvent = {type:'delta', text:string} | {type:'finish', reason:string} | {type:'done'} | {type:'error', message:string}`（空行触发派发；多行 `data:` 以 `\n` 连接；忽略 `:` 注释行；`data:` 后允许 0/1 个空格；`[DONE]` → done；顶层 `error` 字段 → error；JSON 解析失败 → error）
  - `EEC.api.estimateInputTokens(chars: number, imageCount: number): number` = `Math.ceil(chars / 1.5) + 1500 * imageCount + 512`
  - `EEC.api.computeMaxTokens(preset, estInput): number` = `Math.max(512, Math.min(preset.maxOutput, preset.contextWindow - estInput - 512))`
  - `EEC.api.classifyError({ status, bodyText, error }): { kind, message }`；kind ∈ `auth|balance|rate|params|network|timeout|aborted|server|stream_error`
  - `EEC.api.streamChat({ preset, apiKey, model, baseURL, messages, signal, onDelta, onFinish }): Promise<{ finishReason: string|null, usedFallbackNonStream: boolean }>`（fetch → `Content-Type` 含 `text/event-stream` 走流式，否则按普通 JSON 解析；内部逐事件调用 `onDelta(text)`、结束时 `onFinish({finishReason})`；抛出的错误对象形如 `{ kind, message, raw }`）

- [ ] **Step 1: 写失败测试 `tests/api.test.cjs`（完整）**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const api = require('../assets/js/api.js');

test('行解码器：UTF-8 多字节字符跨 chunk 不产生乱码', () => {
  const d = api.createLineDecoder();
  const bytes = new TextEncoder().encode('中文abc\n第二行\n');
  assert.deepStrictEqual(d.push(bytes.slice(0, 4)), []);           // "中" 的 3 字节被切开
  const lines = d.push(bytes.slice(4));
  assert.deepStrictEqual(lines, ['中文abc', '第二行']);
});

test('行解码器：CRLF 与残行', () => {
  const d = api.createLineDecoder();
  assert.deepStrictEqual(d.push(new TextEncoder().encode('a\r\nb')), ['a']);
  assert.deepStrictEqual(d.end(), ['b']);
});

test('SSE：基本 delta 与 [DONE]（含无空格 data:[DONE]）', () => {
  const p = api.createSSEParser();
  const ev = [];
  ev.push(...p.pushLine('data: {"choices":[{"delta":{"content":"你"}}]}'));
  ev.push(...p.pushLine(''));
  ev.push(...p.pushLine('data:[DONE]'));
  ev.push(...p.pushLine(''));
  assert.deepStrictEqual(ev.map(e => e.type), ['delta', 'done']);
  assert.strictEqual(ev[0].text, '你');
});

test('SSE：注释行忽略、多行 data 合并、error 事件、finish_reason', () => {
  const p = api.createSSEParser();
  const ev = [];
  ev.push(...p.pushLine(': keep-alive'));
  ev.push(...p.pushLine('data: {"choices":[{"delta":{"content":"a"},'));
  ev.push(...p.pushLine('data: "finish_reason":null}]}'));
  ev.push(...p.pushLine(''));
  ev.push(...p.pushLine('data: {"choices":[{"delta":{},"finish_reason":"length"}]}'));
  ev.push(...p.pushLine(''));
  ev.push(...p.pushLine('data: {"error":{"message":"rate limited"}}'));
  ev.push(...p.pushLine(''));
  assert.deepStrictEqual(ev.map(e => e.type), ['delta', 'finish', 'error']);
  assert.strictEqual(ev[0].text, 'a');
  assert.strictEqual(ev[1].reason, 'length');
  assert.match(ev[2].message, /rate limited/);
});

test('estimateInputTokens / computeMaxTokens 边界', () => {
  assert.strictEqual(api.estimateInputTokens(1500, 0), 1000 + 512);
  assert.strictEqual(api.estimateInputTokens(0, 3), 4500 + 512);
  const p = { contextWindow: 8192, maxOutput: 8192 };
  assert.strictEqual(api.computeMaxTokens(p, 7000), 680);          // 8192-7000-512
  assert.strictEqual(api.computeMaxTokens(p, 100000), 512);        // 地板值
  assert.strictEqual(api.computeMaxTokens({ contextWindow: 131072, maxOutput: 4096 }, 1000), 4096);
});

test('classifyError 映射矩阵', () => {
  assert.strictEqual(api.classifyError({ status: 401 }).kind, 'auth');
  assert.strictEqual(api.classifyError({ status: 402 }).kind, 'balance');
  assert.strictEqual(api.classifyError({ status: 429 }).kind, 'rate');
  assert.strictEqual(api.classifyError({ status: 400 }).kind, 'params');
  assert.strictEqual(api.classifyError({ status: 503 }).kind, 'server');
  assert.strictEqual(api.classifyError({ status: null, error: new TypeError('Failed to fetch') }).kind, 'network');
  assert.strictEqual(api.classifyError({ status: null, error: { name: 'AbortError' } }).kind, 'aborted');
});

test('streamChat：成功流（含 finish=length）', async () => {
  const sse = ['data: {"choices":[{"delta":{"content":"你好"}}]}', '',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}', '', 'data: [DONE]', ''].join('\n') + '\n';
  global.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const deltas = []; let fin = null;
  const r = await api.streamChat({
    preset: { baseURL: 'https://x/v1' }, apiKey: 'k', model: 'm',
    messages: [], signal: null, onDelta: t => deltas.push(t), onFinish: f => { fin = f; },
  });
  assert.deepStrictEqual(deltas, ['你好']);
  assert.strictEqual(r.finishReason, 'length');
  assert.strictEqual(r.usedFallbackNonStream, false);
});

test('streamChat：401 抛 auth；非 SSE 响应走回退解析', async () => {
  global.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => api.streamChat({ preset: { baseURL: 'https://x/v1' }, apiKey: 'k', model: 'm', messages: [], onDelta: () => {} }),
    e => e.kind === 'auth');

  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '纯 JSON 报告' }, finish_reason: 'stop' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  const deltas = [];
  const r = await api.streamChat({ preset: { baseURL: 'https://x/v1' }, apiKey: 'k', model: 'm', messages: [], onDelta: t => deltas.push(t) });
  assert.deepStrictEqual(deltas, ['纯 JSON 报告']);
  assert.strictEqual(r.usedFallbackNonStream, true);
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现（关键循环完整）**

`streamChat` 流程：构造 `body = { model, messages, stream: true, temperature: 0.6, max_tokens }` → `fetch(baseURL + '/chat/completions', { method:'POST', headers:{ Authorization: 'Bearer '+apiKey, 'Content-Type':'application/json' }, body: JSON.stringify(body), signal })`；`!res.ok` → 读 `await res.text()` → `throw classifyError({ status: res.status, bodyText })`；`Content-Type` 不含 `text/event-stream` → 读 JSON → `onDelta(choices[0].message.content)` → 返回 `{ finishReason: choices[0].finish_reason, usedFallbackNonStream: true }`；否则 `res.body.getReader()` 循环：`decoder.push(value)` 得行 → `parser.pushLine(line)` → 逐事件：`delta` → `onDelta`；`finish` → 记 `finishReason`；`done` → break；`error` → `throw classifyError({ status: null, bodyText: ev.message })` 映射为 `stream_error`。循环捕获：`AbortError` → kind 'aborted'；`TypeError`（fetch 网络/CORS）→ 'network'；其它原样抛。结束条件：`[DONE]` / reader done / finish_reason 非空（任一命中即终止读取；finish 后再收到 delta 忽略）。`classifyError` 的 message 为中文固定文案（auth:"API Key 无效或无权限"、balance:"账户余额不足"、rate:"请求过于频繁（限流）"、params:"该模型不支持当前请求参数"、network:"无法连接服务商（网络受限或不允许浏览器直连）"、timeout:"请求超时"、aborted:"已停止"、server:"服务商暂时不可用"、stream_error:"生成过程中出错"）。注意：`temperature`/`max_tokens` 的参数重试逻辑由 app 层编排（调用 streamChat 捕获 kind==='params' 后改写 body 重试，见 Task 11）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(api): line decoder, SSE parser, token budget, error classification, streamChat"`

---

### Task 7: `store.js` — 设置 / 草稿 / 历史（索引 + 分条 + 配额韧性）

**Files:**
- Create: `assets/js/store.js`、`tests/store.test.cjs`

**Interfaces:**
- Produces:
  - `EEC.store.loadSettings(): Settings`（缺省 `{ providerId: DEFAULT_PROVIDER_ID, apiKey:'', model:'', baseURL:'' }`；损坏 JSON → 缺省）
  - `EEC.store.saveSettings(s): boolean`
  - `EEC.store.loadDraft(): Draft|null`；`saveDraft(d): void`；`clearDraft(): void`；`Draft = { level, title, text, pasteBox, imageCount, ts }`
  - `EEC.store.loadHistoryIndex(): Entry[]`（新→旧；损坏 → `[]` 并删除坏键）
  - `EEC.store.getEntry(id): EntryFull|null`
  - `EEC.store.addEntry(entry): { saved: boolean, reason?: 'quota' }`（自动：40KB 截断标注、100 条上限、配额淘汰重试）
  - `EEC.store.deleteEntry(id): void`；`EEC.store.clearHistory(): void`
  - `Entry = { id, ts, level, title, words, optimizedWords, scores, source: 'auto'|'paste', status: 'complete'|'stopped', size }`；`EntryFull = Entry & { essay, reportMd, truncated?: boolean }`

- [ ] **Step 1: 写失败测试 `tests/store.test.cjs`（完整，含配额模拟）**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

function freshStore(limitBytes) {          // 简易可限容 localStorage 模拟
  const map = new Map(); let used = 0;
  global.localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const old = map.get(k) || ''; const next = used - old.length * 2 + v.length * 2;
      if (limitBytes && next > limitBytes) { const e = new Error('QuotaExceeded'); e.name = 'QuotaExceededError'; throw e; }
      used = next; map.set(k, v);
    },
    removeItem: k => { used -= (map.get(k) || '').length * 2; map.delete(k); },
    clear: () => { map.clear(); used = 0; },
  };
  delete require.cache[require.resolve('../assets/js/store.js')];
  return require('../assets/js/store.js');
}

const mkEntry = (i, size = 200) => ({
  id: 'e' + i, ts: 1000 + i, level: '四级', title: 'T' + i, words: 130, optimizedWords: 135,
  scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 }, source: 'auto', status: 'complete',
  essay: 'essay' + i, reportMd: 'x'.repeat(size),
});

test('设置与草稿往返；损坏 JSON 安全降级', () => {
  const store = freshStore();
  assert.strictEqual(store.loadSettings().providerId, 'deepseek');
  store.saveSettings({ providerId: 'kimi', apiKey: 'k', model: 'm', baseURL: '' });
  assert.strictEqual(store.loadSettings().providerId, 'kimi');
  localStorage.setItem('eec.settings.v1', '{broken');
  assert.strictEqual(store.loadSettings().providerId, 'deepseek');

  store.saveDraft({ level: 'cet6', title: '', text: 'abc', pasteBox: '', imageCount: 0, ts: 1 });
  assert.strictEqual(store.loadDraft().text, 'abc');
  store.clearDraft(); assert.strictEqual(store.loadDraft(), null);
});

test('历史：增删查清与索引/分条一致', () => {
  const store = freshStore();
  store.addEntry(mkEntry(1)); store.addEntry(mkEntry(2));
  const idx = store.loadHistoryIndex();
  assert.deepStrictEqual(idx.map(e => e.id), ['e2', 'e1']);       // 新在前
  assert.strictEqual(store.getEntry('e1').essay, 'essay1');
  store.deleteEntry('e1');
  assert.strictEqual(store.getEntry('e1'), null);
  assert.strictEqual(store.loadHistoryIndex().length, 1);
  store.clearHistory(); assert.deepStrictEqual(store.loadHistoryIndex(), []);
});

test('历史：100 条上限淘汰最旧', () => {
  const store = freshStore();
  for (let i = 0; i < 105; i++) store.addEntry(mkEntry(i));
  assert.strictEqual(store.loadHistoryIndex().length, 100);
  assert.strictEqual(store.getEntry('e0'), null);
  assert.ok(store.getEntry('e104'));
});

test('历史：单条 reportMd 超 40KB 被截断并标注', () => {
  const store = freshStore();
  store.addEntry(mkEntry(1, 50 * 1024));
  const full = store.getEntry('e1');
  assert.strictEqual(full.truncated, true);
  assert.ok(full.reportMd.length < 42000);
});

test('历史：写满配额时淘汰最旧条目重试，新条目仍保存', () => {
  const store = freshStore(60 * 1024);                             // 约 30K 字符预算
  for (let i = 0; i < 10; i++) store.addEntry(mkEntry(i, 4 * 1024));
  const r = store.addEntry(mkEntry(99, 4 * 1024));                 // 需要挤掉旧条目
  assert.strictEqual(r.saved, true);
  assert.ok(store.getEntry('e99'));
  assert.ok(store.loadHistoryIndex().length < 11);
});

test('历史：索引损坏 → 返回空并清除坏键', () => {
  const store = freshStore();
  localStorage.setItem('eec.history.index.v1', 'garbage');
  assert.deepStrictEqual(store.loadHistoryIndex(), []);
  assert.strictEqual(localStorage.getItem('eec.history.index.v1'), null);
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现（配额淘汰循环完整）**

`addEntry` 关键流程：`reportMd` 超 40960 字符 → `slice(0, 40960)` + `truncated: true`；`id` = `String(ts) + '-' + Math.random().toString(36).slice(2, 8)`；先 `index.unshift(entryMeta)` 并删超 100 条最旧的（含其分条键）；保存循环：

```js
let entriesToDrop = [...index];
while (true) {
  try { localStorage.setItem('eec.history.v1.' + id, JSON.stringify(full)); localStorage.setItem(IDX, JSON.stringify(index)); return { saved: true }; }
  catch (e) {
    const victim = entriesToDrop.pop();
    if (!victim || victim.id === id) return { saved: false, reason: 'quota' };
    localStorage.removeItem('eec.history.v1.' + victim.id);
    index = index.filter(x => x.id !== victim.id);
  }
}
```

所有 `JSON.parse` 包裹 try/catch 并降级；`loadHistoryIndex` 校验数组且逐项过滤缺 `id` 的脏数据。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(store): settings, draft, history with quota-resilient index+entry layout"`

---

### Task 8: `exporter.js` + `demo.js`

**Files:**
- Create: `assets/js/exporter.js`、`assets/js/demo.js`、`tests/exporter.test.cjs`

**Interfaces:**
- Produces:
  - `EEC.exporter.scorecardHtml({ scores, tier, annotations }): string`（评分卡 DOM 字符串；`.scorecard` 结构见 DOM 契约；`tier` 与 `annotations` 由调用方传入——**app 的屏上评分卡也复用它，单一来源**）
  - `EEC.exporter.reportFilename(entry): string`（`批改报告_YYYY-MM-DD_级别_题目.html`；非法字符 `[\\/:*?"<>|]` 替换为 `_`；题目截 20 字；级别回退 `自动推断`）
  - `EEC.exporter.toMarkdown(entry): string`（元信息 + 分数摘要纯文本列表 + `reportMd`；**输出中不得出现 ```json**）
  - `EEC.exporter.toStandaloneHtml(entry): string`（`<!doctype html>` + charset + 内联 `<style>` + 头信息 + 评分卡 + 报告正文（经 `EEC.render.toHtml`）+ 页脚免责与成本文案；**不含 `<script`**）
  - `EEC.demo.SAMPLES = { cet4: { level:'四级', title, text }, cet6: { level:'六级', title, text } }`

- [ ] **Step 1: 写失败测试 `tests/exporter.test.cjs`（完整）**

```js
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
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

`scorecardHtml`：`<div class="scorecard"><div class="sc-total">12<span class="sc-total-den">/15</span></div><div class="sc-tier">10-12分档</div><ul class="sc-annotations">…</ul><div class="sc-row" data-key="content"><span class="sc-name">内容完整性</span><span class="sc-points">4 / 5</span><div class="sc-bar"><div class="sc-bar-fill" style="width:80%"></div></div></div>…</div><p class="sc-note">四项得分之和即总分；档次为官方分数区间。</p>`（所有插值经 `util.escapeHtml`）。`toStandaloneHtml` 的内联样式为精简版报告样式（白底、A4 友好、评分卡条形）。`demo.js`：自拟两篇示例——四级题为校园话题、**刻意含 3-4 处典型错误**（如 `The society is become more better.`、连接词滥用、中式表达），六级题含更隐晦的结构问题；文本 120-180 / 150-200 词（由测试校验）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(exporter,demo): standalone exports, scorecard builder, sample essays"`

---

### Task 9: `index.html` + `style.css` + `favicon.svg`（静态页面完整）

**Files:**
- Create: `index.html`、`assets/css/style.css`、`assets/img/favicon.svg`、`tests/static.test.cjs`

**Interfaces:**
- Consumes: 无（纯结构/样式）
- Produces: 全部 DOM 契约元素（本计划顶部清单）；`<script>` 顺序 `util→render→providers→prompt→api→store→exporter→demo→app`；`<title>四六级作文 AI 批改台 · 严格对照官方评分标准</title>`；favicon 用 `<link rel="icon" href="assets/img/favicon.svg">`（相对路径）。

- [ ] **Step 1: 写失败测试 `tests/static.test.cjs`（完整）**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const doc = new JSDOM(html).window.document;

test('相对路径硬约束', () => {
  assert.ok(!/(src|href)\s*=\s*"\/[^"]/.test(html), '出现以 / 开头的资源引用');
  assert.ok(!html.includes('awua-dcm.github.io'), '写死了部署域名');
});

test('脚本加载顺序', () => {
  const order = [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  assert.deepStrictEqual(order, [
    'assets/js/util.js', 'assets/js/render.js', 'assets/js/providers.js', 'assets/js/prompt.js',
    'assets/js/api.js', 'assets/js/store.js', 'assets/js/exporter.js', 'assets/js/demo.js', 'assets/js/app.js',
  ]);
});

test('DOM 契约元素齐全', () => {
  const ids = ['mode-strip','history-open','first-run-card','first-run-close','file-banner','wechat-banner',
    'level-pills','essay-title','essay-text','word-badge','image-input-camera','image-input-gallery',
    'image-thumbs','sticky-actions','btn-grade','btn-copy-prompt','btn-demo',
    'copy-panel','copy-prompt-preview','btn-copy-text','paste-box','btn-render-paste','paste-warning','btn-render-anyway','copy-tip',
    'report-area','report-nav','nav-top','scorecard','parse-note','report-body','report-toolbar',
    'btn-print','btn-export-md','btn-export-html','btn-regrade','stream-status','btn-stop',
    'btn-back-latest','truncation-banner','drawer-backdrop','settings-drawer','sel-provider','inp-key',
    'btn-toggle-key','inp-model','inp-baseurl','btn-test-conn','btn-save-settings','btn-clear-data',
    'preset-date','history-drawer','history-list','btn-clear-history','toast','live-status'];
  for (const id of ids) assert.ok(doc.getElementById(id), `缺少 #${id}`);
});

test('移动端与可访问性要素', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.strictEqual(doc.getElementById('live-status').getAttribute('aria-live'), 'polite');
  assert.match(html, /role="dialog"/);
});

test('页脚承诺文案与免责声明', () => {
  assert.ok(html.includes('复制模式'));
  assert.ok(html.includes('仅供学习参考'));
  assert.ok(html.includes('图片作文'));
  assert.ok(html.includes('不会离开'));
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（index.html 不存在）。

- [ ] **Step 3: 实现**

**执行时调用 frontend-design 技能确定视觉方向**，再按 DOM 契约实现。结构要求（对应设计文档 §5.1）：横幅区（file/wechat/first-run 三个可关闭条）→ 页头 → 输入卡片（级别胶囊 / 题目 / 作文 textarea + 词数徽章 / 图片双入口与缩略图区 / 操作按钮）+ 复制面板（默认隐藏）→ 报告区（sticky 导航 + 评分卡占位 `#scorecard` + `#report-body` + 工具条 + 流式状态区）→ 页脚。两个抽屉与 backdrop 置于 DOM 尾部。`style.css` 要求：CSS 自定义属性做设计令牌（主色、中性色、圆角、阴影）；输入控件 `font-size: 16px`；`#sticky-actions` 移动端 `position: sticky; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`；评分卡条形图动画；`@media print` 区块（A4、隐藏交互元素、卡片防跨页）；`@media (max-width: 640px)` 移动适配；`:focus-visible` 可见焦点环；抽屉与 toast 样式。favicon.svg：一把钢笔/对勾的组合简笔图标（内联 SVG，`currentColor` 不适用时用固定色 `#2f6f4f`）。

- [ ] **Step 4: 运行确认通过** → `npm test` 全绿（static 用例 + 既有用例）。

- [ ] **Step 5: 提交**：`git commit -m "feat(ui): page structure, design system styles, favicon"`

---

### Task 10: `app.js` 第一部分 — 输入区、视图状态、草稿恢复、横幅

**Files:**
- Create: `assets/js/app.js`、`tests/helpers.cjs`、`tests/dom.test.cjs`
- Modify: `assets/js/util.js`（新增 `wordBadge`）

**Interfaces:**
- Produces:
  - `EEC.util.wordBadge({ level, count, imageCount }): { text: string, status: 'ok'|'low'|'high'|'info' }`；文案规则：纯图（imageCount>0 && count===0）→ `图片作文 ${imageCount} 张 · 词数以识别结果为准`(info)；count===0 → `0 词`(info)；四级 → `${count} 词 · 达标`(ok) / `${count} 词 · 偏少 ${120-count} 词`(low) / `${count} 词 · 偏多 ${count-180} 词`(high)；六级同（150/200）；自动推断 → `${count} 词 · 四级 120–180 / 六级 150–200`(info)
  - `EEC.app` 挂载于 DOMContentLoaded；内部状态对象 `EEC.app.state = { level, title, text, images: [], pasteBox, settings, streaming: null }`（测试可读）
  - `tests/helpers.cjs` 导出 `loadApp({ localStorage = {}, userAgent }): Promise<{ dom, window, document, $, $all, click, type, fireEvent, flushAll }>`——用 `JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' })` 载入 `index.html`，按静态测试同序 `window.eval(fs.readFileSync(script))` 注入 8 个模块 + app.js，并预置 localStorage 与 UA；`stubFetch` 由 Task 11 在本文件扩展。

- [ ] **Step 1: 写失败测试（追加 `tests/dom.test.cjs`；`tests/util.test.cjs` 增 wordBadge 用例）**

```js
// tests/dom.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./helpers.cjs');

test('启动：模式条文案（无 Key → 复制模式）', async () => {
  const { $ } = await loadApp({});
  assert.match($('#mode-strip').textContent, /复制模式（未配置 Key）/);
});

test('级别胶囊切换与词数徽章三态', async () => {
  const { $, $all, click, type } = await loadApp({});
  type($('#essay-text'), 'word '.repeat(130).trim());          // 130 词
  assert.match($('#word-badge').textContent, /130 词 · 四级 120–180 \/ 六级 150–200/);  // 自动推断
  click($all('.level-pill').find(b => b.dataset.level === 'cet4'));
  assert.match($('#word-badge').textContent, /130 词 · 达标/);
  type($('#essay-text'), 'word '.repeat(100).trim());
  assert.match($('#word-badge').textContent, /100 词 · 偏少 20 词/);
  assert.ok($('#word-badge').classList.contains('is-low'));
});

test('草稿恢复', async () => {
  const draft = JSON.stringify({ level: 'cet6', title: 'T', text: 'restored text', pasteBox: '', imageCount: 0, ts: 1 });
  const { $ } = await loadApp({ localStorage: { 'eec.draft.v1': draft } });
  assert.strictEqual($('#essay-text').value, 'restored text');
  assert.strictEqual($('#essay-title').value, 'T');
});

test('示例填充与首次引导卡关闭', async () => {
  const { $, click } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  click($('#btn-demo'));
  assert.ok($('#essay-text').value.length > 300);
  assert.ok($('#level-pills .level-pill.is-active'));
  click($('#first-run-close'));
  assert.ok($('#first-run-card').hidden || $('#first-run-card').classList.contains('is-hidden'));
});

test('微信 UA 显示提示条', async () => {
  const { $ } = await loadApp({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0' });
  assert.ok(!$('#wechat-banner').hidden);
});
```

同时为 `util.wordBadge` 增加与上述规则一一对应的单元测试（含 0 词与纯图片两例）。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

`app.js` 骨架：IIFE，`document.addEventListener('DOMContentLoaded', boot)`；`boot()` 依次：加载设置/草稿 → 渲染模式条（`自动批改 · ${providerName}` / `复制模式（未配置 Key）`）→ 绑定级别胶囊、题目、textarea（input → `updateWordBadge()` + `debouncedSaveDraft`）→ 绑定图片入口 `change`（对每个文件依次：`util.isHeic`/`imagePolicy` 拒绝并 `toast`；合格 → `decode+compress`（`createImageBitmap(file,{imageOrientation:'from-image'})` 失败回退 `Image`；空图检测：canvas 采样 9 个点全近似同色 → 报"无法读取该图片"）→ 压成 JPEG dataURL（长边 2048、q0.85；总量 >6MB 拒绝）→ push 到 `state.images` → 渲染缩略图（含删除按钮）→ `updateWordBadge()`）→ 绑定 `#btn-demo`（填入 `EEC.demo.SAMPLES.cet4` 并切换 level 胶囊）→ 首次引导卡/L1 横幅（`location.protocol === 'file:'` / `util.isWeChatOrQQ(navigator.userAgent)`）→ `updateWordBadge()` → 恢复草稿提示 toast。`toast(msg, type)` 助手（3 秒自动消失，`#live-status` 同步播报）。所有按钮的点击处理在 Tasks 11/12 接线（本任务先留空函数 `onGradeClick` / `onCopyClick`，点击时 toast "构建中" 占位——由后续任务替换）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(app): input area, word badge, image pipeline, draft restore, banners"`

---

---

### Task 11: `app.js` 第二部分 — 自动模式全链路（流式、评分卡、报告、历史、停止与错误）

**Files:**
- Modify: `assets/js/app.js`、`tests/helpers.cjs`（新增 fetch 桩）、`tests/dom.test.cjs`

**Interfaces:**
- Produces:
  - `EEC.app._renderReport(fullText, { source: 'auto'|'paste', fallbackLevel: '四级'|'六级'|'自动推断', finishReason?: string|null, maxTokensDropped?: boolean }): { entry: Entry, rendered: boolean }`（**两模式共用**：解析 → 评分卡 → 四步骤卡 → 优化版徽章 → 截断/注记横幅 → 构建 entry 但不落库；落库由调用方决定）
  - `helpers` 提供 `stubFetch(script): void`（`loadApp` 返回的 `stubFetch` 已绑定到该窗口，测试直接 `stubFetch({...})` 调用；实现追加在 `tests/helpers.cjs`）；`script = { status?: number, contentType?: string, chunks?: string[], finishReason?: string|null, body?: string }`（把字符串块按 `TextEncoder` 切成 `Uint8Array` 流；`chunks` 缺省时用 `body` 一次性返回非流式响应；`status>=400` 用 `body` 作错误体）

- [ ] **Step 1: 写失败测试（追加 `tests/dom.test.cjs`，完整）**

```js
const REPORT_OK = '```json\n{"status":"ok","level":"四级","total":12,"content":4,"structure":3,"vocab":2,"grammar":3}\n```\n\n' +
  '## 步骤① 总分与分项\n总分：12 / 15\n内容完整性 **4/5**：切题但论证单薄。\n\n' +
  '## 步骤② 逐条扣分点\n1. 问题类型：中式英语\n> The society is become more better.\n2. 问题类型：连接词滥用\n> 无直接原句\n\n' +
  '## 步骤③ 修改建议\n- 怎么改：**society has become better**\n\n' +
  '## 步骤④ 优化版本\n### 优化版本正文\n' + 'word '.repeat(140).trim() + '\n\n### 主要改动点\n- 修正 be 动词；- 精简连接词';

function sseChunks(text, { finish = 'stop' } = {}) {          // 把报告切成流式 chunk
  const mid = Math.floor(text.length / 3);
  const parts = [text.slice(0, mid), text.slice(mid, mid * 2), text.slice(mid * 2)];
  return parts.map(p => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] }) + '\n\n')
    .concat('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\n\n', 'data: [DONE]\n\n');
}

test('自动模式全链路：评分卡/四步骤/剥离 JSON/历史/导出启用', async () => {
  const { $, $all, click, stubFetch, flushAll } = await loadApp({ localStorage: { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-x', model: 'deepseek-chat', baseURL: '' }) } });
  stubFetch({ chunks: sseChunks(REPORT_OK) });
  $('#' + 'essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade'));
  await flushAll();                                            // 驱动定时器与微任务直至流结束
  const card = $('#scorecard');
  assert.ok(card.innerHTML.includes('data-key="content"'));
  assert.ok(card.textContent.includes('10-12分档'));
  assert.strictEqual($all('#report-body .step-card').length, 4);
  assert.ok(!$('#report-body').innerHTML.includes('"total"'), 'JSON 泄漏到报告区');
  assert.ok($('#report-body').textContent.includes('The society is become more better.'));
  assert.match($('#report-body').textContent, /优化版 140 词 · 达标（四级要求 120–180 词）/);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1')).length, 1);
  assert.ok(!$('#btn-export-md').disabled);
});

test('自动模式：finish=length 显示截断横幅', async () => {
  const { $, click, stubFetch, flushAll } = await loadApp({ localStorage: { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-x', model: 'm', baseURL: '' }) } });
  stubFetch({ chunks: sseChunks(REPORT_OK, { finish: 'length' }) });
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade')); await flushAll();
  assert.ok(!$('#truncation-banner').hidden);
  assert.match($('#truncation-banner').textContent, /截断/);
});

test('自动模式：401 → 错误卡（含两个行动按钮），按钮恢复可点', async () => {
  const { $, $all, click, stubFetch, flushAll } = await loadApp({ localStorage: { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'bad', model: 'm', baseURL: '' }) } });
  stubFetch({ status: 401, body: '{"error":{"message":"bad key"}}' });
  $('#essay-text').value = 'x';
  click($('#btn-grade')); await flushAll();
  assert.match($('#report-area').textContent, /API Key 无效/);
  const btns = $all('#report-area button').map(b => b.textContent);
  assert.ok(btns.some(t => t.includes('检查 Key')) && btns.some(t => t.includes('复制模式')));
  assert.strictEqual($('#btn-grade').disabled, false);
});

test('自动模式：中途停止 → 保留部分内容并标注，历史标记已停止', async () => {
  const { $, click, stubFetch, flushAll, fireEvent } = await loadApp({ localStorage: { 'eec.settings.v1': JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-x', model: 'm', baseURL: '' }) } });
  stubFetch({ chunks: sseChunks(REPORT_OK) });
  $('#essay-text').value = 'word '.repeat(140).trim();
  click($('#btn-grade'));
  await flushAll({ ticks: 2 });                                 // 只推进前几拍（流未结束）
  fireEvent($('#btn-stop'), 'click');
  await flushAll();
  assert.match($('#report-area').textContent, /已停止/);
  assert.strictEqual(JSON.parse(localStorage.getItem('eec.history.index.v1'))[0].status, 'stopped');
});

test('无 Key 点击开始批改 → 引导到复制模式', async () => {
  const { $, click } = await loadApp({});
  $('#essay-text').value = 'x';
  click($('#btn-grade'));
  assert.ok(!$('#copy-panel').hidden);
  assert.match($('#toast').textContent, /复制批改指令/);
});
```

`helpers.cjs` 的 `flushAll({ticks})`：循环 `await new Promise(setImmediate)` 并把 `window` 内注册的节流定时器推进到完成（实现时 app 的节流用可注入的 `setTimeout`/`requestAnimationFrame` 兼容包装 `EEC.app._timing`，测试可加速）。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

核心接线（全部按设计文档 §5.2/§5.3/§6.3/§7 行为）：

```js
async function onGradeClick() {
  if (state.streaming) return;                                   // 防重复提交
  const s = state.settings;
  if (!state.text.trim() && state.images.length === 0) return toast('请先粘贴作文或上传图片');
  if (!s.apiKey) { openCopyPanel(); return toast('未配置 API Key：点 [复制批改指令] → 粘贴到任意 AI → 把结果粘回这里'); }
  const preset = providers.byId(s.providerId) || providers.PROVIDERS[0];
  const model = s.model || preset.defaultModel;
  if (state.images.length > 0 && !preset.visionModels.includes(model))
    return toast(`当前模型（${model}）不支持图片识别，请更换支持视觉的模型或改用复制模式`);
  // 组装消息、预算、提交
  const meta = prompt.buildMetaBlock({ level: levelArg(), title: state.title, text: state.text, images: state.images.length });
  const userContent = state.images.length
    ? [{ type: 'text', text: meta }, ...state.images.map(d => ({ type: 'image_url', image_url: { url: d } }))]
    : meta;
  const est = api.estimateInputTokens(JSON.stringify(userContent).length + prompt.buildSystemPrompt().length, state.images.length);
  const maxTokens = api.computeMaxTokens(preset, est);
  if (maxTokens <= 512) return toast('作文过长或模型上限太小，无法安全生成完整报告');
  return runStream({ preset, model, userContent, maxTokens });
}

async function runStream(ctx) {
  state.streaming = { abort: new AbortController(), full: '', maxTokensDropped: false };
  setGradeDisabled(true); showStreamSkeleton(); startElapsedTimer();
  const renderer = render.createStreamRenderer($('#report-body'));
  const send = (extra = {}) => api.streamChat({
    preset: ctx.preset, apiKey: state.settings.apiKey, model: ctx.model, baseURL: state.settings.baseURL || ctx.preset.baseURL,
    messages: [{ role: 'system', content: prompt.buildSystemPrompt() }, { role: 'user', content: ctx.userContent }],
    signal: state.streaming.abort.signal,
    onDelta: t => { state.streaming.full += t; throttledRender(); },
  });
  try {
    let extra = { temperature: 0.6, max_tokens: ctx.maxTokens };
    let res;
    try { res = await send(extra); }
    catch (e) {
      if (e.kind !== 'params') throw e;
      delete extra.temperature;                                  // 参数重试 1：去 temperature
      try { res = await send(extra); }
      catch (e2) {
        if (e2.kind !== 'params') throw e2;
        delete extra.max_tokens; state.streaming.maxTokensDropped = true;   // 重试 2：去 max_tokens + 告警
        res = await send(extra);
      }
    }
    finishReport(state.streaming.full, { source: 'auto', finishReason: res.finishReason, maxTokensDropped: state.streaming.maxTokensDropped, autoStore: true });
  } catch (e) {
    if (e.kind === 'aborted') { finishReport(state.streaming.full, { source: 'auto', aborted: true, autoStore: true }); }
    else renderErrorCard(e);                                     // §5.3 每种 kind 的文案与按钮
  } finally { state.streaming = null; setGradeDisabled(false); stopElapsedTimer(); }
}
```

`throttledRender()`：100ms 节流，`renderer.update(prompt.displayText(state.streaming.full))`；滚动跟随仅在距底 <120px 时生效，否则显示 `#btn-back-latest`。`finishReport`：`renderer.finalize()` → `_renderReport(...)` → 截断横幅（`finishReason==='length'` 或 `maxTokensDropped`）→ 自动跟随关闭 → `autoStore` 时 `store.addEntry(entry)` 并刷新历史抽屉数据。`_renderReport` 的渲染细节：`parse-note` 显示 `annotations`/`（解析方式：文本提取）`/`未解析到结构化分数`；`found<4` 时在报告顶部插入黄色提示条（"未识别到步骤①-④标题……仍要渲染吗？"仅粘贴路径出现，auto 路径直接附说明并以整块渲染）；步骤④徽章按 §8 计算；评级导航点击滚动到卡片。错误卡：按 kind 生成文案 + `[检查 Key/测试连接] [改用复制模式]`、`[重试]`、`[去充值] [更换服务商]` 等按钮（§5.3），`[改用复制模式]` → `openCopyPanel()`。

- [ ] **Step 4: 运行确认通过** → PASS（含 Task 1-10 全部既有用例）。

- [ ] **Step 5: 提交**：`git commit -m "feat(app): full auto-mode pipeline with streaming, report render, errors, stop"`

---

### Task 12: `app.js` 第三部分 — 复制模式、导出、历史与设置抽屉、无障碍

**Files:**
- Modify: `assets/js/app.js`、`tests/dom.test.cjs`

**Interfaces:**
- Consumes: `_renderReport`（Task 11）、`exporter.*`、`store.*`、`util.copyText`
- Produces: 完成全部交互；`EEC.app.openCopyPanel(): void`（供 Task 11 错误卡调用）

- [ ] **Step 1: 写失败测试（追加 `tests/dom.test.cjs`，完整）**

```js
test('复制模式全链路：杂乱真实形态依旧渲染（标题变体/列表内引用/无 [DONE]/寒暄）', async () => {
  const { $, $all, click, type } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  type($('#essay-text'), 'word '.repeat(130).trim());
  click($('#btn-copy-prompt'));
  assert.ok(!$('#copy-panel').hidden);
  assert.ok($('#copy-prompt-preview').value.includes('===== 批改要求（必须全部遵守）====='));
  // 模拟从聊天应用粘回的结果（Markdown 退化 + 寒暄）
  const messy = '好的，以下是批改报告：\n\n### 步骤 1 总分与分项\n总分 12 / 15\n\n' +
    '### 步骤2 逐条扣分点\n1. 问题类型：语法\n> He go to school everyday.\n\n' +
    '### 步骤三 修改建议\n建议修改主谓一致。\n\n### 步骤④ 优化版本\n### 优化版本正文\n' + 'word '.repeat(128).trim() + '\n### 主要改动点\n- a\n- b\n\n希望有帮助！';
  type($('#paste-box'), messy);
  click($('#btn-render-paste'));
  assert.strictEqual($all('#report-body .step-card').length, 4, '标题变体未识别');
  assert.ok($('#report-body').textContent.includes('He go to school everyday.'));
  assert.match($('#report-body').textContent, /优化版 128 词 · 达标/);
});

test('粘贴内容缺失标题 → 黄色确认条，确认后仍能渲染', async () => {
  const { $, $all, click, type } = await loadApp({});
  type($('#paste-box'), '这是一段没有任何标题的批改文字。');
  click($('#btn-render-paste'));
  assert.ok($('#paste-warning').hidden === false);
  click($('#btn-render-anyway'));
  assert.ok($('#report-body').textContent.includes('没有任何标题'));
});

test('剪贴板全失败 → 展开预览选中 + 提示，绝不显示"已复制✓"', async () => {
  const { $, click, type, window } = await loadApp({ localStorage: { 'eec.draft.v1': 'null' } });
  window.navigator.clipboard = undefined; window.document.execCommand = () => false;
  type($('#essay-text'), 'x');
  click($('#btn-copy-prompt')); click($('#btn-copy-text'));
  assert.ok(!$('#btn-copy-text').textContent.includes('✓'));
  assert.match($('#toast').textContent, /Ctrl\+C|长按/);
});

test('历史抽屉：列表、载入、删除', async () => {
  const seed = [{ id: 'e1', ts: 1000, level: '四级', title: 'T', words: 130, optimizedWords: 132, scores: { total: 12, content: 4, structure: 3, vocab: 2, grammar: 3 }, source: 'auto', status: 'complete', size: 10 }];
  const { $, $all, click } = await loadApp({ localStorage: {
    'eec.history.index.v1': JSON.stringify(seed),
    'eec.history.v1.e1': JSON.stringify({ ...seed[0], essay: 'essay', reportMd: REPORT_OK }),
  } });
  click($('#mode-strip'));                                      // 打开设置；历史另有入口
  click($('#history-open'));
  assert.strictEqual($all('#history-list .hist-item').length, 1);
  click($all('#history-list .hist-item .hist-load')[0]);
  assert.strictEqual($all('#report-body .step-card').length, 4);
  click($all('#history-list .hist-item .hist-del')[0]);
  assert.strictEqual($all('#history-list .hist-item').length, 0);
});

test('设置：服务商切换预设、保存后模式条更新', async () => {
  const { $, click, fireEvent } = await loadApp({});
  click($('#mode-strip'));
  const sel = $('#sel-provider'); sel.value = 'kimi'; fireEvent(sel, 'change');
  assert.strictEqual($('#inp-model').value, 'kimi-latest');
  assert.match($('#preset-date').textContent, /2026-10-13/);
  $('#inp-key').value = 'sk-test';
  click($('#btn-save-settings'));
  assert.match($('#mode-strip').textContent, /自动批改 · Kimi/);
});

test('抽屉无障碍：Esc 关闭并归还焦点', async () => {
  const { $, click, window } = await loadApp({});
  click($('#mode-strip'));
  assert.strictEqual($('#settings-drawer').getAttribute('aria-modal'), 'true');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok($('#settings-drawer').hidden);
});
```

（测试需要的两个补充 ID 一并加入 DOM 契约与静态测试：`#history-open`（页头历史入口）、`#paste-warning`/`#btn-render-anyway`（粘贴确认条）。）

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

复制模式：`onCopyClick` → `util.copyText(prompt.buildCopyText(...))`；`true` → 按钮 `已复制 ✓` + `#copy-tip` 常驻提醒（"已复制，去 AI 应用粘贴；返回后把整段结果粘回这里。"，含图片时的附加提示与推荐服务链接）；`false` → 展开预览、`select()` 全选、toast"请长按/按 Ctrl+C 复制"。`#btn-render-paste` → `prompt.extractScoreBlock` + `splitReport`：`found===0` 且无 JSON → 显示确认条（`仍然渲染` → 整块渲染；`重新粘贴` → 聚焦 paste-box）；否则 `_renderReport(text, {source:'paste', fallbackLevel: levelArg()})` + `store.addEntry`。导出：`#btn-print` → `window.print()`；`#btn-export-md`/`#btn-export-html` → `util.downloadFile(exporter.reportFilename(entry), content, mime)`。历史抽屉：渲染索引列表、载入（`_renderReport(entry.reportMd, {source:'paste', fallbackLevel: entry.level})` 且用 entry.scores 覆盖评分卡数据）、单项导出、删除、清空（`window.confirm`）。设置抽屉：`PROVIDERS` + 自定义填充 `#sel-provider`；切换预设 → 填默认模型/接口地址 + `#preset-date` 文案；[测试连接] → `api.streamChat` 最小请求（`max_tokens: 1`、消息"回复：ok"）→ 成功 toast"连接成功"；失败 toast 错误 message + "若报模型不存在…"提示；[保存] → `store.saveSettings` + 更新模式条；[清空全部本地数据] → confirm → 清 settings/draft/history → 重载页面状态。抽屉无障碍：开：记 `document.activeElement`、`aria-hidden` 切换、聚焦首个可聚焦元素；Esc/backdrop 关闭；关：焦点归还。`#live-status` 播报开始/结束/生成字数。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "feat(app): copy mode, exports, history and settings drawers, a11y basics"`

---

### Task 13: `README.md`（§12.8 清单）

**Files:**
- Create: `README.md`；Modify: `tests/static.test.cjs`

**Interfaces:**
- Produces: README 含全部必需小节（下）。页面文案与 README 使用同一份 §2.3 文本。

- [ ] **Step 1: 追加失败测试**

```js
test('README 必需小节齐全', () => {
  const md = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  for (const s of ['快速开始', '两种批改模式', '免费', 'API Key 申请', '常见问题',
    '复制模式', '离线', 'zip', '维护', '隐私', '免责', '更新']) {
    assert.ok(md.includes(s), `README 缺少: ${s}`);
  }
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 README**

小节：项目简介（一句话 + 上线 URL）→ 快速开始（三种用法：网页直接用 / 复制模式免 Key / 自动模式配 Key）→ 成本说明（§2.2 表格 + §2.3 文案原文）→ API Key 申请（DeepSeek/Kimi/通义/智谱/OpenRouter 控制台链接）→ 常见问题（错误提示→怎么办对照表，`改用复制模式` 为万能路径；含"模型不存在 → 去官方文档复制最新模型名"）→ 离线使用（ZIP 直链 `https://github.com/AWua-Dcm/English-Essay-Correction/archive/refs/heads/main.zip` + 解压双击 + file:// 限制说明）→ 隐私声明（无上报、Key 仅本机、内容仅发给所选服务商）→ 免责声明 → 更新说明（push 后 1–10 分钟、Ctrl+F5、离线副本不自动更新）→ 维护指南（改默认模型名、新增 OpenAI 兼容服务商、[测试连接] 自检、预设核验日期）→ 版权说明（未附开源协议，保留所有权利）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 提交**：`git commit -m "docs: README with usage, cost, FAQ, offline and maintenance guides"`

---

### Task 14: 全量验证 + 独立审查工作流 + 修复收口

**Files:**
- Modify: 视审查结果而定；`docs/superpowers/specs/2026-10-13-cet-essay-grader-design.md`（仅当发现设计级问题时同步）

- [ ] **Step 1: 全量自动化测试**：`npm test` → 全部 PASS（记录通过用例数与耗时）。

- [ ] **Step 2: 本地服务冒烟**：`python -m http.server 8080`（后台）→ `curl -s localhost:8080 | head` 200；`curl -s -o /dev/null -w '%{http_code}' localhost:8080/assets/js/app.js` 200。把 `http://localhost:8080` 交给用户做真机/视觉验收（设计文档 §13.4 清单中"人工"部分）。

- [ ] **Step 3: 多智能体审查工作流**（五视角，读**真实产物文件**而非设计文档）：①功能对照设计文档完整性 ②安全（渲染器 XSS 面、Key 处理、隐私文案与实现一致性）③部署配置（相对路径、脚本顺序、.nojekyll、Pages 兼容）④UX 边界状态覆盖（§5.3 逐行核对实现）⑤批改模板与输出协议逐字一致性（附录 A/B vs prompt.js 代码）。产出结构化 findings（blocker/major/minor）。

- [ ] **Step 4: 修复 block/major 并回归**：逐条修复 → `npm test` 重跑 → 直至零 blocker 零 major；修复提交：`git commit -m "fix: address independent review findings"`

- [ ] **Step 5: 收口提交**：核对 `git status` 干净；`git log --oneline` 记录 15+ 次提交。

---

### Task 15: 部署（设计文档 §12 运行手册执行）

**Files:**
- 无代码变更（除非发现部署问题）

- [ ] **Step 1: 连通性预检**：`GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/AWua-Dcm/English-Essay-Correction.git`（超时 ≥60s，重试 2–3 次；404=远程不存在属预期，401=认证问题转人工）。

- [ ] **Step 2: 仓库创建**：默认路径——请用户在浏览器创建公开仓库 `English-Essay-Correction`（不加任何初始化文件），创建后回到 Step 1 验证"远程为空且 URL 精确匹配"；**仅当用户在此时明确同意**才走 API 自动化路径（执行纪律见设计文档 §12.2，令牌绝不出现在日志/对话中）。

- [ ] **Step 3: 推送**：`git remote add origin https://github.com/AWua-Dcm/English-Essay-Correction.git` → `git push -u origin main`（网络错误自动重试 2 次，间隔 10–20s；GCM 弹窗登录属预期，若挂起则提示用户完成登录）→ `ls-remote` 复核 main 已存在。

- [ ] **Step 4: 启用 Pages**：优先 API（用户已同意自动路径时）；否则请用户 Settings → Pages → Deploy from a branch → main → / (root)。明确告知：**首次构建 1–10 分钟内 URL 会 404，属正常**。

- [ ] **Step 5: 上线验证**：轮询 `https://awua-dcm.github.io/English-Essay-Correction/` 直到 200（每 15s、上限 10 分钟）→ 抓取 index.html 并逐一确认其引用的全部 CSS/JS/favicon 均 200 → `curl -s` 抽验 `assets/js/prompt.js` 内容包含 `步骤①：总分与分项打分`（防串版本）。若操作者网络不可达：明确记录并移交用户验证。

- [ ] **Step 6: 交付报告**：向用户输出——上线 URL、本次提交范围、验收清单（§13.4）中待用户完成项（真机、真 Key 自动模式、打印导出目测）、**后续如需改动：push 即自动更新（1–10 分钟生效）**。

---

## Spec 覆盖对照（自审记录）

| 设计文档小节 | 覆盖任务 |
|---|---|
| §2 成本与免 Key 文案 | 9（页脚）、13（README） |
| §3 范围 1–11 | 1–12（逐项落在对应模块任务） |
| §4 相对路径/无模块/文件结构 | 9（static 测试）、1（UMD-lite） |
| §5.1 信息架构、移动端、无障碍 | 9（结构样式）、10（输入区）、11（报告区流式）、12（抽屉/无障碍） |
| §5.2 主流程与无 Key 引导 | 11（引导用例） |
| §5.3 状态与错误表 | 6（分类）、10（横幅/徽章）、11（错误卡/截断/停止/未读卡片）、12（粘贴确认/剪贴板） |
| §6.1 提示词与元信息三态 | 4 |
| §6.2 服务商预设 | 4（providers 完整性测试） |
| §6.3 请求/SSE/预算/截断/重试 | 6（解析与预算）、11（参数重试编排/横幅） |
| §6.4 图片管线 | 10（策略单测 + 解码实现）、14（用户真机目测） |
| §6.5 Key 与隐私 | 12（设置抽屉）、13（README） |
| §6.6 错误分类 | 6、11 |
| §7.1 分数解析/剥离/档次重算 | 5、11（渲染用例断言） |
| §7.2 渲染器（白名单 + 稳定前缀） | 2、3 |
| §7.3 评分卡 | 8（builder）、11（装配） |
| §8 字数与步骤④核验 | 1（计数）、10（徽章）、11（优化版徽章用例） |
| §9 复制模式（组装/降级/校验/往返） | 4（组装）、12（全链路、剪贴板、确认条）、10（草稿） |
| §10 导出 | 8、12 |
| §11 历史与草稿（含配额韧性） | 7、11（写入时机）、12（抽屉） |
| §12 部署手册 | 15 |
| §13 质量保障 | 各任务的测试步骤 + 14（审查工作流 + 人工清单交接） |
| §14 风险对策 | 各对应任务 + 14（复核） |
| 附录 A/B 逐字 | 4（录入 + 逐字断言 + 反泄漏断言） |

