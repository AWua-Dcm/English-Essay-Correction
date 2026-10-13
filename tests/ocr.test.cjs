'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ocr = require('../assets/js/ocr.js');

const VENDOR_DIR = path.join(__dirname, '..', 'assets', 'vendor', 'tesseract');

test('置信度三档阈值（与实测一致：印刷体 95% 优，手写 69% 差）', () => {
  assert.strictEqual(ocr.gradeConfidence(95), 'good');    // 实测印刷体
  assert.strictEqual(ocr.gradeConfidence(85), 'good');
  assert.strictEqual(ocr.gradeConfidence(84), 'fair');
  assert.strictEqual(ocr.gradeConfidence(70), 'fair');
  assert.strictEqual(ocr.gradeConfidence(69), 'poor');    // 实测手写体
  assert.strictEqual(ocr.gradeConfidence(0), 'poor');
  assert.strictEqual(ocr.gradeConfidence(NaN), 'unknown');
  assert.strictEqual(ocr.gradeConfidence(undefined), 'unknown');
  assert.ok(ocr.CONF_GOOD > ocr.CONF_FAIR);
});

test('低置信度提示必须劝退手写体，且不得鼓励直接批改', () => {
  const poor = ocr.advice('poor');
  assert.ok(poor.includes('手写'), '未点明手写风险');
  assert.ok(poor.includes('视觉模型') || poor.includes('图片识别'), '未给出替代路径');
  assert.ok(!/可以直接批改|无需核对/.test(poor));
  // good / fair 是可继续的路径，必须要求核对；
  // poor 是劝退路径——此时不该说"核对后批改"，因为 75% 的转写率核对不出来。
  for (const g of ['good', 'fair', 'unknown']) {
    assert.ok(ocr.advice(g).includes('核对'), `${g} 缺少核对要求`);
  }
  assert.ok(!ocr.advice('poor').includes('核对后再批改'),
    'poor 档不能给出"核对后可批改"的暗示');
});

test('cleanText 绝不纠正拼写（否则会抹掉学生的真实错误）', () => {
  // 这些正是批改要找的错误，必须原样保留
  const raw = 'Nowdays, many parents does everything for their childrens.\n' +
    'Online learning have many informations and it is very useful。';
  const out = ocr.cleanText(raw);
  for (const keep of ['Nowdays', 'does everything', 'childrens', 'have many informations']) {
    assert.ok(out.includes(keep), `cleanText 擅自修改了原文: ${keep}`);
  }
  assert.ok(!/Nowadays/.test(out), 'cleanText 把拼写错误纠正了');
});

test('cleanText 只去版面噪声、不动正文', () => {
  const raw = '____\n\n12\n\nThe Value of Lifelong Learning\n\n- - -\n\nBody text here.\n\n\n\nSecond paragraph.';
  const out = ocr.cleanText(raw);
  assert.ok(out.includes('The Value of Lifelong Learning'));
  assert.ok(out.includes('Body text here.'));
  assert.ok(out.includes('Second paragraph.'));
  assert.ok(!/^____$/m.test(out), '未剔除下划线行');
  assert.ok(!/^- - -$/m.test(out), '未剔除分隔线');
  assert.ok(!/\n{3,}/.test(out), '多余空行未合并');
});

test('cleanText 归一空白与全角空格，不丢词', () => {
  const out = ocr.cleanText('A  sentence　with   wide\tspacing.');
  assert.strictEqual(out, 'A sentence with wide spacing.');
});

test('cleanText 容忍空/异常输入', () => {
  assert.strictEqual(ocr.cleanText(''), '');
  assert.strictEqual(ocr.cleanText(null), '');
  assert.strictEqual(ocr.cleanText(undefined), '');
});

test('vendor 资源齐备（缺失会导致线上 404）', () => {
  // corePath 以 "js" 结尾会被 worker 原样使用，因此这里必须与实现一致
  assert.ok(ocr.CORE_FILE.endsWith('js'), 'CORE_FILE 必须以 js 结尾才能跳过变体探测');
  assert.ok(ocr.CORE_FILE.includes('simd'), 'WASM SIMD 是当前浏览器基线，应使用 simd 变体');
  for (const f of ['tesseract.min.js', 'worker.min.js', ocr.CORE_FILE, 'eng.traineddata.gz']) {
    const p = path.join(VENDOR_DIR, f);
    assert.ok(fs.existsSync(p), `缺少 vendor 文件: ${f}`);
    assert.ok(fs.statSync(p).size > 1000, `vendor 文件异常过小: ${f}`);
  }
});

test('引擎变体选择：不得依赖 worker 的自动探测顺序', () => {
  // worker 的探测顺序是 relaxedsimd → simd → 无；只 vendor 一个变体时
  // 若走自动探测，现代 Chrome 会请求 relaxedsimd 而 404。
  // 因此实现必须把 corePath 钉到具体文件。
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'ocr.js'), 'utf8');
  assert.ok(/corePath\s*:\s*VENDOR\s*\+\s*CORE_FILE/.test(src),
    'corePath 必须指向具体文件而非目录');
  assert.ok(!/corePath\s*:\s*VENDOR\s*,/.test(src),
    'corePath 不得指向目录（会触发变体探测并 404）');
});

test('isSupported / hasSimd 在无 WebAssembly 时不抛异常', () => {
  assert.strictEqual(typeof ocr.isSupported(), 'boolean');
  assert.strictEqual(typeof ocr.hasSimd(), 'boolean');
});

test('无 WebAssembly 时 recognize 明确拒绝，且不发请求', async () => {
  const saved = globalThis.WebAssembly;
  try {
    // eslint-disable-next-line no-global-assign
    globalThis.WebAssembly = undefined;
    await assert.rejects(() => ocr.recognize('data:image/png;base64,AAAA'),
      /不支持本地文字识别|WebAssembly/);
  } finally {
    globalThis.WebAssembly = saved;
  }
});
