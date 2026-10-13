'use strict';
/**
 * tests/helpers.cjs — jsdom 装载器（dom.test.cjs 专用）
 * loadApp：载入真实 index.html，按静态测试同序注入全部脚本，返回驱动助手的集合。
 * （Task 11 在此文件追加 stubFetch）
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPT_ORDER = ['util', 'render', 'providers', 'prompt', 'api', 'store', 'exporter', 'demo', 'app'];

async function loadApp(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true });
  const window = dom.window;
  const document = window.document;

  // 补齐 jsdom 缺失的 Web API（用 Node 实现注入到 window realm）
  const globals = ['TextDecoder', 'TextEncoder', 'ReadableStream', 'Response', 'Headers', 'Request', 'Blob', 'fetch'];
  for (const g of globals) {
    if (window[g] === undefined && typeof globalThis[g] !== 'undefined') window[g] = globalThis[g];
  }

  if (opts.userAgent) {
    Object.defineProperty(window.navigator, 'userAgent', { value: opts.userAgent, configurable: true });
  }
  if (opts.localStorage) {
    for (const [k, v] of Object.entries(opts.localStorage)) {
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    }
  }

  for (const name of SCRIPT_ORDER) {
    window.eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', name + '.js'), 'utf8'));
  }

  // 消除 DOMContentLoaded 竞态：给事件一次机会，然后兜底强制启动
  await new Promise(r => setTimeout(r, 0));
  if (window.EEC && window.EEC.app && !window.EEC.app.state.booted) window.EEC.app.boot();

  const $ = sel => document.querySelector(sel);
  const $all = sel => Array.from(document.querySelectorAll(sel));
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const fireEvent = (el, typeName) => el.dispatchEvent(new window.Event(typeName, { bubbles: true }));
  const flushAll = async ({ ticks = 20, ms = 8 } = {}) => {
    for (let i = 0; i < ticks; i++) await new Promise(r => setTimeout(r, ms));
  };

  return { dom, window, document, $, $all, click, type, fireEvent, flushAll };
}

module.exports = { loadApp };
