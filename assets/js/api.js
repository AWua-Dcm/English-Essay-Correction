/**
 * api.js — 大模型请求层：行解码器、SSE 流解析、token 预算、错误分类、streamChat
 * 全部走 OpenAI 兼容协议（POST {baseURL}/chat/completions）。
 * UMD-lite：浏览器挂 window.EEC.api，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  /* ===== 行解码器：TextDecoder(stream:true) + 行缓冲（防 UTF-8 多字节字符跨 chunk 断裂） ===== */
  function createLineDecoder() {
    var dec = new TextDecoder('utf-8');
    var buf = '';
    function splitLines() {
      var lines = [];
      var idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        var line = buf.slice(0, idx);
        if (line.charAt(line.length - 1) === '\r') line = line.slice(0, -1);
        lines.push(line);
        buf = buf.slice(idx + 1);
      }
      return lines;
    }
    return {
      push: function (bytes) {
        buf += dec.decode(bytes, { stream: true });
        return splitLines();
      },
      end: function () {
        buf += dec.decode();
        var lines = splitLines();
        if (buf.length > 0) {
          lines.push(buf.charAt(buf.length - 1) === '\r' ? buf.slice(0, -1) : buf);
          buf = '';
        }
        return lines;
      },
    };
  }

  /* ===== SSE 解析器：空行派发；多行 data 以 \n 连接；注释行忽略；顶层 error 立即报错 ===== */
  function createSSEParser() {
    var dataBuf = [];
    function dispatch() {
      var evs = [];
      if (dataBuf.length === 0) return evs;
      var payload = dataBuf.join('\n');
      dataBuf = [];
      if (payload.trim() === '[DONE]') { evs.push({ type: 'done' }); return evs; }
      var obj = null;
      try { obj = JSON.parse(payload); } catch (e) {
        evs.push({ type: 'error', message: '流数据解析失败' });
        return evs;
      }
      if (obj && obj.error) {
        var em = (obj.error && obj.error.message) ? obj.error.message : String(obj.error);
        evs.push({ type: 'error', message: em });
        return evs;
      }
      if (obj && obj.choices && obj.choices.length > 0) {
        var ch = obj.choices[0] || {};
        if (ch.delta && typeof ch.delta.content === 'string' && ch.delta.content.length > 0) {
          evs.push({ type: 'delta', text: ch.delta.content });
        }
        if (ch.finish_reason) evs.push({ type: 'finish', reason: ch.finish_reason });
      }
      return evs;
    }
    return {
      pushLine: function (line) {
        var l = String(line == null ? '' : line);
        if (l === '') return dispatch();
        if (l.charAt(0) === ':') return [];           // 注释行（keep-alive）
        var m = /^data:(.*)$/.exec(l);
        if (!m) return [];                            // event:/id:/retry: 等字段忽略
        var d = m[1];
        if (d.charAt(0) === ' ') d = d.slice(1);      // data: 后允许 0/1 个空格
        var evs = [];
        if (dataBuf.length > 0) {
          // 兼容无空行分隔的流：若已缓冲内容本身是完整 JSON，先派发前一事件
          var complete = false;
          try { JSON.parse(dataBuf.join('\n')); complete = true; } catch (e) { complete = false; }
          if (complete) evs = dispatch();
        }
        dataBuf.push(d);
        return evs;
      },
    };
  }

  /* ===== token 预算 ===== */
  function estimateInputTokens(chars, imageCount) {
    return Math.ceil((chars || 0) / 1.5) + 1500 * (imageCount || 0) + 512;
  }

  function computeMaxTokens(preset, estInput) {
    var ctx = (preset && preset.contextWindow) || 32768;
    var out = (preset && preset.maxOutput) || 4096;
    return Math.max(512, Math.min(out, ctx - (estInput || 0) - 512));
  }

  /* ===== 错误分类 ===== */
  var ERROR_MESSAGES = {
    auth: 'API Key 无效或无权限',
    balance: '账户余额不足',
    rate: '请求过于频繁（限流）',
    params: '该模型不支持当前请求参数',
    network: '无法连接服务商（网络受限或该服务商不允许浏览器直连）',
    timeout: '请求超时',
    aborted: '已停止',
    server: '服务商暂时不可用',
    stream_error: '生成过程中出错',
  };

  function classifyError(info) {
    info = info || {};
    var status = (typeof info.status === 'number') ? info.status : null;
    var bodyText = String(info.bodyText || '');
    var error = info.error;
    var kind;
    if (status === 401 || status === 403) kind = 'auth';
    else if (status === 402) kind = 'balance';
    else if (status === 429) kind = 'rate';
    else if (status === 400 || status === 422) kind = 'params';
    else if (status !== null) kind = 'server';
    else if (error && error.name === 'TimeoutError') kind = 'timeout';
    else if (error && error.name === 'AbortError') kind = 'aborted';
    else kind = 'network';
    var detail = '';
    if (kind === 'network' && error && error.message) detail = '（' + String(error.message).slice(0, 120) + '）';
    else if (bodyText) detail = '：' + bodyText.slice(0, 200);
    var err = new Error(ERROR_MESSAGES[kind] + detail);
    err.kind = kind;
    err.status = status;
    err.raw = bodyText || (error && error.message) || '';
    return err;
  }

  /* ===== streamChat ===== */
  async function streamChat(opts) {
    var preset = opts.preset || {};
    var baseURL = String(opts.baseURL || preset.baseURL || '').replace(/\/+$/, '');
    var url = baseURL + '/chat/completions';
    var body = Object.assign(
      { model: opts.model, messages: opts.messages || [] },
      opts.extra || {},
      { stream: true }
    );
    var res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (opts.apiKey || ''),
        },
        body: JSON.stringify(body),
        signal: opts.signal || undefined,
      });
    } catch (err) {
      if (opts.signal && opts.signal.aborted) { var e1 = new Error(ERROR_MESSAGES.aborted); e1.kind = 'aborted'; throw e1; }
      if (err && err.name === 'AbortError') { var e2 = new Error(ERROR_MESSAGES.aborted); e2.kind = 'aborted'; throw e2; }
      throw classifyError({ status: null, error: err });
    }
    if (!res.ok) {
      var txt = '';
      try { txt = await res.text(); } catch (e3) { /* 忽略读体失败 */ }
      throw classifyError({ status: res.status, bodyText: txt });
    }
    var ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (ct.indexOf('text/event-stream') === -1) {
      // 非流式回退（服务商拒绝 stream）
      var j = await res.json();
      var ch = (j && j.choices && j.choices[0]) || {};
      var content = (ch.message && ch.message.content) || '';
      if (content && opts.onDelta) opts.onDelta(content);
      var fr = ch.finish_reason || null;
      if (opts.onFinish) opts.onFinish({ finishReason: fr });
      return { finishReason: fr, usedFallbackNonStream: true };
    }
    var decoder = createLineDecoder();
    var parser = createSSEParser();
    var reader = res.body.getReader();
    var finishReason = null;
    var done = false;
    function handle(events) {
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev.type === 'delta') { if (opts.onDelta) opts.onDelta(ev.text); }
        else if (ev.type === 'finish') { if (!finishReason) finishReason = ev.reason; }
        else if (ev.type === 'error') { var e = new Error(ev.message); e.kind = 'stream_error'; throw e; }
        else if (ev.type === 'done') { done = true; }
      }
    }
    try {
      while (!done && !finishReason) {
        if (opts.signal && opts.signal.aborted) {
          var eab = new Error(ERROR_MESSAGES.aborted);
          eab.kind = 'aborted';
          throw eab;
        }
        var r = await reader.read();
        if (r.done) {
          handle(parser.pushLine(''));  // 冲刷未派发事件（无空行结尾的流）
          break;
        }
        var lines = decoder.push(r.value);
        for (var i2 = 0; i2 < lines.length; i2++) handle(parser.pushLine(lines[i2]));
      }
    } catch (err) {
      try { reader.cancel(); } catch (e4) { /* 忽略 */ }
      if (err && err.kind) throw err;
      if (opts.signal && opts.signal.aborted) { var ea = new Error(ERROR_MESSAGES.aborted); ea.kind = 'aborted'; throw ea; }
      throw classifyError({ status: null, error: err });
    }
    if (opts.onFinish) opts.onFinish({ finishReason: finishReason });
    return { finishReason: finishReason, usedFallbackNonStream: false };
  }

  var api = {
    createLineDecoder: createLineDecoder,
    createSSEParser: createSSEParser,
    estimateInputTokens: estimateInputTokens,
    computeMaxTokens: computeMaxTokens,
    classifyError: classifyError,
    streamChat: streamChat,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).api = api;
})(typeof self !== 'undefined' ? self : globalThis);
