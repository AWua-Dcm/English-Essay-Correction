#!/usr/bin/env node
/**
 * ocr_accuracy.js - measure how well local OCR reads real CET essay images.
 *
 * Deciding whether local OCR is worth shipping needs a number, not a guess.
 * This runs Tesseract over real essay screenshots whose transcription is already
 * known (the anchor corpus carries a vision-model transcript for each), and
 * reports word error rate against that transcript.
 *
 * The transcript is the comparison baseline, so treat the number as
 * "agreement with a vision model", not "absolute truth" - but it is real,
 * measured on the actual images rather than estimated.
 *
 * Usage: node tools/ocr_accuracy.js [--pairs FILE] [--limit N]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAIRS = path.join(ROOT, 'corpus', '_ocr_test', 'pairs.json');
const LANG_DIR = path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
const CACHE = path.join(ROOT, 'corpus', '_ocr_test', 'tessdata-cache');

function normWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance over word arrays (standard WER numerator). */
function wordEditDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1], 10) : 0;
  if (!fs.existsSync(PAIRS)) {
    console.error('no pairs.json - run the pairing step first');
    process.exit(2);
  }
  let pairs = JSON.parse(fs.readFileSync(PAIRS, 'utf8'));
  if (limit) pairs = pairs.slice(0, limit);
  fs.mkdirSync(CACHE, { recursive: true });

  const { createWorker } = require(path.join(ROOT, 'node_modules', 'tesseract.js'));
  const worker = await createWorker('eng', 1, {
    langPath: LANG_DIR,
    cachePath: CACHE,
    gzip: true,
    logger: () => {},
  });

  const rows = [];
  for (const p of pairs) {
    const entry = { id: p.id, score: p.score, size: p.size, ref_words: p.ref_words };
    for (const [label, file] of [['raw', p.image], ['up3x', p.up]]) {
      if (!file || !fs.existsSync(file)) continue;
      const started = Date.now();
      try {
        const { data } = await worker.recognize(file);
        const ocr = normWords(data.text);
        const ref = normWords(p.ref);
        const dist = wordEditDistance(ocr, ref);
        entry[label] = {
          words: ocr.length,
          confidence: Math.round(data.confidence),
          wer: +(dist / Math.max(1, ref.length)).toFixed(3),
          accuracy: +Math.max(0, 1 - dist / Math.max(1, ref.length)).toFixed(3),
          ms: Date.now() - started,
          sample: data.text.replace(/\s+/g, ' ').slice(0, 70),
        };
      } catch (e) {
        entry[label] = { error: String(e.message || e).slice(0, 120) };
      }
    }
    rows.push(entry);
    const r = entry.raw, u = entry.up3x;
    console.log(
      `${entry.id} score=${String(entry.score).padEnd(4)} ref=${String(entry.ref_words).padStart(3)}w | ` +
      `raw acc=${r && r.accuracy != null ? r.accuracy : 'ERR'} (${r && r.confidence}%) | ` +
      `up3x acc=${u && u.accuracy != null ? u.accuracy : 'ERR'} (${u && u.confidence}%)`
    );
  }
  await worker.terminate();

  const agg = (key) => {
    const v = rows.map(r => r[key] && r[key].accuracy).filter(x => typeof x === 'number');
    if (!v.length) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sorted = [...v].sort((a, b) => a - b);
    return { n: v.length, mean: +mean.toFixed(3), median: +sorted[Math.floor(sorted.length / 2)].toFixed(3), min: sorted[0], max: sorted[sorted.length - 1] };
  };
  const out = { raw: agg('raw'), up3x: agg('up3x'), rows };
  fs.writeFileSync(path.join(ROOT, 'corpus', '_ocr_test', 'result.json'), JSON.stringify(out, null, 1));
  console.log('\n=== word-level accuracy vs vision transcript ===');
  for (const k of ['raw', 'up3x']) {
    const a = out[k];
    if (!a) continue;
    console.log(`  ${k.padEnd(5)} n=${a.n} mean=${(a.mean * 100).toFixed(1)}% median=${(a.median * 100).toFixed(1)}% range=${(a.min * 100).toFixed(0)}-${(a.max * 100).toFixed(0)}%`);
  }
  const worst = [...rows].filter(r => r.raw && r.raw.accuracy != null).sort((a, b) => a.raw.accuracy - b.raw.accuracy)[0];
  if (worst) console.log(`\nworst raw: ${worst.id} ${(worst.raw.accuracy * 100).toFixed(0)}% - "${worst.raw.sample}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
