#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate.py - measure whether the distilled rubric actually grades like the real marks.

A rubric that "looks right" is worthless. This takes essays whose true mark is known,
strips every trace of it, lets a grader assign a mark blind, then compares.

Blinding is the whole point, so `split` is deliberately paranoid: it drops any field
that could carry the answer, including the source URL (these routinely contain the
mark, e.g. a URL ending in "-14fen"), the source title, agent notes, and even the
topic label if it names a band.

  split   corpus/cet4.jsonl ...  ->  corpus/_holdout/blind.jsonl   (graders see this)
                                     corpus/_holdout/keys.json     (nobody sees this)
  score   predictions.jsonl      ->  agreement report

Predictions format, one JSON object per line:
  {"id":"cet4-0007","total":11,"band":"10-12","content":4,"structure":3,"vocab":2,"grammar":2}

Metrics reported:
  * exact band agreement        - predicted band == true band (the headline number)
  * adjacent band agreement     - within one band
  * mean absolute error on the 15-point total
  * per-true-band breakdown     - a rubric that nails 14s but guesses 8s is not usable
"""
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict

HOLDOUT = os.path.join("corpus", "_holdout")
BAND_OF = {"13-15": (13, 15), "10-12": (10, 12), "07-09": (7, 9),
           "04-06": (4, 6), "01-03": (1, 3)}
BAND_SEQUENCE = ["01-03", "04-06", "07-09", "10-12", "13-15"]

# Anything matching these leaks the answer to the grader.
LEAK_PATTERNS = [
    re.compile(r"\b\d{1,2}\s*(?:/|out of)\s*15\b", re.I),
    re.compile(r"分档"),          # 分档
    re.compile(r"满分|得分|打分|评分"),  # 满分/得分/打分/评分
    re.compile(r"\bsample script\b", re.I),
]
SCORE_MARK = re.compile(r"(\d{1,2})\s*分")  # 11分


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def band_of(total):
    for band, (lo, hi) in BAND_OF.items():
        if lo <= total <= hi:
            return band
    return None


def leaks(text):
    hits = []
    for pat in LEAK_PATTERNS:
        m = pat.search(text or "")
        if m:
            hits.append(m.group(0))
    m = SCORE_MARK.search(text or "")
    if m:
        hits.append(m.group(0))
    return hits


# Topic and title strings routinely carry the mark ("作文得分：11分", "14分档范文").
# That does not make the essay unusable - the topic is legitimate grading context,
# so strip the mark out of it rather than discarding the item.
# The essay BODY is never sanitised: if an essay's own prose quotes a mark, the
# item is genuinely un-blindable and is dropped.
SANITISE_PATTERNS = [
    r"作文得分\s*[:：]?\s*\d{1,2}(?:\.\d)?\s*分?",
    r"得分\s*[:：]?\s*\d{1,2}(?:\.\d)?\s*分?",
    r"\d{1,2}(?:\.\d)?\s*分档",
    r"\d{1,2}(?:\.\d)?\s*分(?:范文|作文|范本)?",
    r"\d{1,2}\s*/\s*15",
    r"满分|评分标准|样卷|参考译文",
    r"\bband\b",
]


def sanitise(text):
    s = text or ""
    for pat in SANITISE_PATTERNS:
        s = re.sub(pat, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def cmd_split(argv):
    srcs = [a for a in argv if a.endswith(".jsonl")]
    if not srcs:
        srcs = [os.path.join("corpus", f"{lv}.jsonl") for lv in ("cet4", "cet6")]
    rows = []
    for s in srcs:
        rows += load_jsonl(s)
    if not rows:
        print("no corpus records found; run store.py merge first")
        return 1

    os.makedirs(HOLDOUT, exist_ok=True)
    blind, keys, dropped = [], {}, 0
    for r in rows:
        # Only labelled records can measure anything: a model essay has no true
        # score to compare against, so including it would dilute the metric.
        if r.get("corpus_class") != "labeled" or not r.get("band"):
            continue
        body = r.get("text", "")
        # An essay whose own prose quotes a mark cannot be blinded at all.
        if leaks(body):
            dropped += 1
            continue
        prompt = sanitise(r.get("topic") or r.get("title") or "")
        if leaks(prompt):
            dropped += 1
            continue
        blind.append({
            "id": r["id"],
            "level": r["level"],
            "prompt": prompt,
            "word_count": r.get("word_count"),
            "text": body,
        })
        keys[r["id"]] = {"band": r["band"], "score": r.get("score")}

    with open(os.path.join(HOLDOUT, "blind.jsonl"), "w", encoding="utf-8") as fh:
        for r in blind:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(HOLDOUT, "keys.json"), "w", encoding="utf-8") as fh:
        json.dump(keys, fh, ensure_ascii=False, indent=1)

    spread = Counter(k["band"] for k in keys.values())
    print(f"blinded {len(blind)} essays -> {HOLDOUT}/blind.jsonl")
    print(f"keys sealed        -> {HOLDOUT}/keys.json")
    print(f"dropped {dropped} as un-blindable (their own text mentions a mark)")
    print("true-band spread:", dict(spread))
    return 0


def cmd_score(argv):
    preds = []
    for a in argv:
        if a.endswith(".jsonl"):
            preds += load_jsonl(a)
    if not preds:
        p = os.path.join(HOLDOUT, "predictions.jsonl")
        preds = load_jsonl(p)
    keys_path = os.path.join(HOLDOUT, "keys.json")
    if not os.path.exists(keys_path):
        print("no keys.json; run split first")
        return 1
    keys = json.load(open(keys_path, encoding="utf-8"))

    exact = adj = 0
    scored = 0
    abs_err = []
    per_band_true = Counter()
    per_band_exact = Counter()
    confusion = defaultdict(Counter)
    missing = []

    for p in preds:
        rid = p.get("id")
        key = keys.get(rid)
        if not key:
            missing.append(rid)
            continue
        total = p.get("total")
        if not isinstance(total, (int, float)):
            continue
        total = int(total)
        pband = p.get("band") or band_of(total)
        if pband not in BAND_SEQUENCE or key.get("band") not in BAND_SEQUENCE:
            continue
        scored += 1
        tband = key["band"]
        per_band_true[tband] += 1
        confusion[tband][pband] += 1
        if pband == tband:
            exact += 1
            per_band_exact[tband] += 1
        elif abs(BAND_SEQUENCE.index(pband) - BAND_SEQUENCE.index(tband)) == 1:
            adj += 1
        if isinstance(key.get("score"), int):
            abs_err.append(abs(total - key["score"]))

    if not scored:
        print("no usable predictions matched the keys")
        return 1

    print(f"graded {scored} essays")
    if missing:
        print(f"  {len(missing)} predictions had unknown ids (ignored)")
    print(f"  exact band agreement    {exact}/{scored} = {exact / scored:.1%}")
    print(f"  within one band         {(exact + adj)}/{scored} = {(exact + adj) / scored:.1%}")
    if abs_err:
        print(f"  mean absolute error     {sum(abs_err) / len(abs_err):.2f} marks (n={len(abs_err)})")
    print("\nper true band:")
    for band in BAND_SEQUENCE:
        n = per_band_true[band]
        if not n:
            continue
        e = per_band_exact[band]
        top = confusion[band].most_common(3)
        print(f"  {band}: {e}/{n} exact ({e / n:.0%}) | predicted as: "
              + ", ".join(f"{b}x{c}" for b, c in top))
    return 0


def main(argv):
    sys.stdout = out()
    if len(argv) < 2:
        print(__doc__)
        return 2
    if argv[1] == "split":
        return cmd_split(argv[2:])
    if argv[1] == "score":
        return cmd_score(argv[2:])
    print(f"unknown subcommand: {argv[1]}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
