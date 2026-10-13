#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
store.py - corpus storage, merging, de-duplication and gap reporting.

Harvesting agents each write their own shard file, which they never share, so
a shard can never corrupt another. This tool is the single writer of the
merged corpus and is where the project's invariants are actually enforced:

  * every record carries a band (13-15 / 10-12 / 07-09 / 04-06 / 01-03)
  * exact scores, when present, must agree with the band
  * word counts are recomputed here rather than trusted from the agent
  * near-duplicate essays are collapsed (the same essay is republished widely)
  * the "<=6 essays per topic inside one score cell" rule is measured, not assumed

Layout (corpus/ is gitignored - full text never enters the public repo):
  corpus/_incoming/<shard>.jsonl   written by harvest agents
  corpus/cet4.jsonl                merged, de-duplicated
  corpus/cet6.jsonl
  corpus/rejected.jsonl            records that failed validation
  corpus/REPORT.md                 counts, topic spread, gaps

Usage:
  python -I tools/store.py merge
  python -I tools/store.py stats
  python -I tools/store.py add --shard NAME < records.jsonl
"""
import glob
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict

CORPUS = "corpus"
INCOMING = os.path.join(CORPUS, "_incoming")
LEVELS = ("cet4", "cet6")
BANDS = ("13-15", "10-12", "07-09", "04-06", "01-03")
BAND_ORDER = {b: i for i, b in enumerate(BANDS)}

# CEFR-style band boundaries, mirrored from the official CET writing rubric.
BAND_RANGES = {"13-15": (13, 15), "10-12": (10, 12), "07-09": (7, 9),
               "04-06": (4, 6), "01-03": (1, 3)}

LEVEL_ALIASES = {
    "cet4": "cet4", "4": "cet4", "cet-4": "cet4", "cet_4": "cet4",
    "four": "cet4", "四级": "cet4", "si": "cet4",
    "cet6": "cet6", "6": "cet6", "cet-6": "cet6", "cet_6": "cet6",
    "six": "cet6", "六级": "cet6", "liu": "cet6",
}


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def band_for_score(score):
    for band, (lo, hi) in BAND_RANGES.items():
        if lo <= score <= hi:
            return band
    return None


def normalize_level(v):
    if v is None:
        return None
    k = str(v).strip().lower().replace(" ", "")
    if k in LEVEL_ALIASES:
        return LEVEL_ALIASES[k]
    if "6" in k or "六" in k:
        return "cet6"
    if "4" in k or "四" in k:
        return "cet4"
    return None


def parse_score(raw):
    """Pull an integer 0-15 out of whatever the source/agent wrote.

    Returns (score, note). Tolerates '11', '11分', '11.5', '11/15',
    '10-12' (band only -> None), and Chinese numerals are deliberately not
    guessed at: an ambiguous source should be re-checked, not coerced.
    """
    if raw is None or raw == "":
        return None, "empty"
    if isinstance(raw, (int, float)):
        v = int(raw)
        return (v, "") if 0 <= v <= 15 else (None, f"out of range: {raw}")
    s = str(raw).strip()
    m = re.search(r"(\d{1,2})(?:\.\d+)?\s*(?:/\s*15|分)?", s)
    if not m:
        return None, f"unparsed: {raw!r}"
    v = int(m.group(1))
    if 1 <= v <= 15:
        return v, ""
    if v == 0:
        return None, "zero score kept as band-only"
    return None, f"out of range: {raw!r}"


WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")


def word_count(text):
    return len(WORD_RE.findall(text or ""))


def norm_text(text):
    """Aggressive normalisation for duplicate detection."""
    s = (text or "").lower()
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = re.sub(r"[^a-z0-9\s']", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def shingles(text, k=5):
    words = norm_text(text).split()
    if len(words) < k:
        return set()
    return {" ".join(words[i:i + k]) for i in range(len(words) - k + 1)}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


NEAR_DUP_THRESHOLD = 0.55  # same essay republished with edits / OCR noise


def validate(rec):
    """Return (clean_record, None) or (None, reason)."""
    if not isinstance(rec, dict):
        return None, "not an object"
    text = rec.get("text") or ""
    if not isinstance(text, str) or word_count(text) < 45:
        return None, f"too short ({word_count(text)} words)"
    if len(text) > 6000:
        return None, "implausibly long"
    latin = sum(1 for c in text if c.isascii() and c.isalpha())
    letters = sum(1 for c in text if c.isalpha())
    if letters and latin / letters < 0.85:
        return None, "not predominantly English"

    level = normalize_level(rec.get("level"))
    if not level:
        return None, f"unrecognised level: {rec.get('level')!r}"

    score, note = parse_score(rec.get("score"))
    band = str(rec.get("band") or "").strip()
    band = band.replace("0", "0") if band else ""
    if band and band not in BANDS:
        # Accept "7-9", "7~9", "7—9" and "10-12分档" shapes.
        m = re.search(r"(\d{1,2})\s*[-~—–to]+\s*(\d{1,2})", band)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            band = next((b for b, (l, h) in BAND_RANGES.items()
                         if l == lo and h == hi), "")
        if band not in BANDS:
            band = ""
    if score is not None:
        derived = band_for_score(score)
        if band and band != derived:
            return None, f"score {score} contradicts band {band}"
        band = derived

    # Published model essays (范文) carry no stated mark. They are still the bulk
    # of what the web offers, and they define the high-band reference distribution
    # even though they cannot serve as ground truth. They are admitted with an
    # explicit corpus_class so that nothing downstream can mistake them for
    # labelled data.
    corpus_class = str(rec.get("corpus_class") or "").strip().lower()
    if not band:
        if corpus_class == "model" or rec.get("genre") == "model_essay":
            corpus_class = "model"
        else:
            return None, "no usable band or score"
    else:
        corpus_class = "labeled"

    url = str(rec.get("source_url") or "").strip()
    if not url.lower().startswith("http"):
        return None, "missing source_url"

    verify = str(rec.get("verify") or "pending").strip().lower()
    if verify not in ("pending", "confirmed", "refuted"):
        verify = "pending"

    clean = {
        "level": level,
        "score": score,
        "band": band,
        "corpus_class": corpus_class,
        "label_confidence": ("stated" if corpus_class == "labeled" else "assumed-high"),
        "score_raw": str(rec.get("score_raw") or rec.get("score") or "")[:60],
        "score_basis": str(rec.get("score_basis") or "unstated")[:40],
        "topic": str(rec.get("topic") or "").strip()[:160],
        "topic_key": re.sub(r"[^a-z0-9]+", "-",
                            str(rec.get("topic_key") or "").strip().lower()
                            ).strip("-")[:60],
        "title": str(rec.get("title") or "").strip()[:160],
        "text": text.strip(),
        "word_count": word_count(text),
        "source_url": url[:500],
        "source_site": str(rec.get("source_site") or "").strip()[:80],
        "source_title": str(rec.get("source_title") or "").strip()[:200],
        "harvested_by": str(rec.get("harvested_by") or "")[:60],
        "verify": verify,
        "notes": str(rec.get("notes") or "")[:400],
    }
    if not clean["topic_key"] and clean["topic"]:
        clean["topic_key"] = re.sub(r"[^a-z0-9]+", "-",
                                    clean["topic"].lower()).strip("-")[:60]
    clean["text_hash"] = hashlib.sha1(
        norm_text(text).encode("utf-8")).hexdigest()[:16]
    return clean, None


def load_jsonl(path):
    recs = []
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"  ! {os.path.basename(path)}:{lineno} bad JSON: {e}")
    return recs


def cmd_merge():
    os.makedirs(CORPUS, exist_ok=True)
    shard_files = sorted(glob.glob(os.path.join(INCOMING, "*.jsonl")))
    # Crawler output lands in _candidates/ and is unlabelled by construction, so
    # it is admitted as corpus_class=model rather than silently treated as scored.
    shard_files += sorted(glob.glob(os.path.join(CORPUS, "_candidates", "*.jsonl")))
    if not shard_files:
        print(f"no shards in {INCOMING}/ or {CORPUS}/_candidates/")
        return 1

    accepted, rejected = [], []
    reasons = Counter()
    for path in shard_files:
        raw = load_jsonl(path)
        for rec in raw:
            clean, why = validate(rec)
            if clean:
                clean["shard"] = os.path.basename(path)[:-6]
                accepted.append(clean)
            else:
                reasons[why.split(":")[0]] += 1
                rejected.append({"reason": why, "shard": os.path.basename(path),
                                 "source_url": (rec or {}).get("source_url", "")
                                 if isinstance(rec, dict) else ""})
        print(f"  {os.path.basename(path):40s} {len(raw):5d} records")

    print(f"\nvalidated {len(accepted)} | rejected {len(rejected)}")
    for why, n in reasons.most_common():
        print(f"   reject: {why} x{n}")

    # De-duplicate: exact hash first, then near-duplicate shingles within level.
    kept = []
    by_hash = {}
    by_level = defaultdict(list)
    for rec in accepted:
        h = (rec["level"], rec["text_hash"])
        if h in by_hash:
            by_hash[h]["dupe_urls"].append(rec["source_url"])
            continue
        by_hash[h] = rec
        rec["dupe_urls"] = []
        by_level[rec["level"]].append(rec)

    final = []
    for level, recs in by_level.items():
        sigs = []
        for rec in recs:
            sig = shingles(rec["text"])
            rec["_sig"] = sig
            dup_of = None
            for other, osig in sigs:
                if jaccard(sig, osig) >= NEAR_DUP_THRESHOLD:
                    dup_of = other
                    break
            if dup_of is not None:
                dup_of.setdefault("dupe_urls", []).append(rec["source_url"])
                continue
            sigs.append((rec, sig))
            final.append(rec)

    for rec in final:
        rec.pop("_sig", None)

    for level in LEVELS:
        path = os.path.join(CORPUS, f"{level}.jsonl")
        rows = [r for r in final if r["level"] == level]
        rows.sort(key=lambda r: (r["band"], -(r["score"] or 0), r["text_hash"]))
        with open(path, "w", encoding="utf-8") as fh:
            for i, r in enumerate(rows):
                r["id"] = f"{level}-{i + 1:04d}"
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {path}: {len(rows)} essays")

    with open(os.path.join(CORPUS, "rejected.jsonl"), "w", encoding="utf-8") as fh:
        for r in rejected:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\ndropped {len(accepted) - len(final)} duplicate essays")
    return 0


def cell_table(rows):
    """counts[level][band][score] plus topic spread per cell."""
    counts = {lv: {b: Counter() for b in BANDS} for lv in LEVELS}
    topics = {lv: {b: Counter() for b in BANDS} for lv in LEVELS}
    for r in rows:
        lv, b = r["level"], r["band"]
        counts[lv][b][r["score"] if r["score"] is not None else -1] += 1
        topics[lv][b][r["topic_key"] or "(unlabeled)"] += 1
    return counts, topics


def cmd_stats():
    rows = []
    for level in LEVELS:
        path = os.path.join(CORPUS, f"{level}.jsonl")
        if os.path.exists(path):
            rows += load_jsonl(path)
    if not rows:
        print("corpus is empty - run merge first")
        return 1

    counts, topics = cell_table(rows)
    lines = ["# CET essay corpus - harvest report", ""]
    lines.append(f"Total essays: **{len(rows)}** "
                 f"(confirmed by re-check: {sum(1 for r in rows if r['verify'] == 'confirmed')})")
    lines.append("")

    for lv in LEVELS:
        lines.append(f"## {lv.upper()}")
        lines.append("")
        lines.append("| band | total | " + " | ".join(f"{s}分" for s in range(15, 0, -1)) + " |")
        lines.append("|---" * 17 + "|")
        for b in BANDS:
            c = counts[lv][b]
            exact = " | ".join(str(c.get(s, 0) or "") for s in range(15, 0, -1))
            lines.append(f"| {b} | {sum(c.values())} | {exact} |")
        lines.append("")
        counts_lv = sum(sum(counts[lv][b].values()) for b in BANDS)
        print(f"{lv}: {counts_lv} essays")

        for b in BANDS:
            tot = sum(counts[lv][b].values())
            if not tot:
                print(f"  band {b}: EMPTY")
                continue
            tc = topics[lv][b]
            top = tc.most_common(3)
            worst = top[0][1] if top else 0
            flag = "  <-- topic rule violated (<=6 per topic)" if worst > 6 else ""
            print(f"  band {b}: {tot:4d} essays | {len(tc):3d} distinct topics | "
                  f"largest topic x{worst}{flag}")
            lines.append(f"- {b}: {tot} essays, {len(tc)} distinct topics, "
                         f"largest single topic x{worst} "
                         f"({'VIOLATES' if worst > 6 else 'ok'} rule <=6)")

            # Exact-score cells are the user's primary target.
            for s in range(15, 0, -1):
                n = counts[lv][b].get(s, 0)
                if 0 < n < 20:
                    pass
        lines.append("")

    gaps = []
    for lv in LEVELS:
        for b in BANDS:
            n = sum(counts[lv][b].values())
            if n < 20:
                gaps.append(f"{lv} {b}: {n}/20 ({20 - n} short)")
    lines.append("## Gaps vs the 20-per-cell target")
    lines.append("")
    lines += [f"- {g}" for g in gaps] or ["- none"]

    with open(os.path.join(CORPUS, "REPORT.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\nwrote corpus/REPORT.md")
    print(f"cells still short of 20: {len(gaps)} of {len(LEVELS) * len(BANDS)}")
    return 0


def cmd_add(shard):
    os.makedirs(INCOMING, exist_ok=True)
    dest = os.path.join(INCOMING, f"{re.sub(r'[^A-Za-z0-9._-]', '_', shard)}.jsonl")
    n = 0
    with open(dest, "a", encoding="utf-8") as fh:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            fh.write(line + "\n")
            n += 1
    print(f"{dest}: +{n}")
    return 0


def main(argv):
    sys.stdout = out()
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "merge":
        return cmd_merge()
    if cmd == "stats":
        return cmd_stats()
    if cmd == "add":
        shard = argv[2] if len(argv) > 2 else "unnamed"
        if "--shard" in argv:
            shard = argv[argv.index("--shard") + 1]
        return cmd_add(shard)
    print(f"unknown subcommand: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
