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
  assert.deepStrictEqual(fin, { finishReason: 'length' });
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
