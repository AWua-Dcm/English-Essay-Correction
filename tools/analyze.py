#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze.py - measure what actually separates one CET score band from another.

The band descriptors in the grading rubric should come from measurement over the
corpus, not from what a language model remembers about CET rubrics. This computes
per-essay features and aggregates them per band, so a descriptor like "connective
variety collapses below band 7" is either backed by a number or not written.

Every feature here is a PROXY. Nothing in this file understands English; it counts
surface patterns. Treat small per-band n (the low bands) as indicative only, and
say so in anything derived from it.

Usage:
  python -I tools/analyze.py features           per-essay feature JSONL + summary
  python -I tools/analyze.py bands              per-band aggregate table
  python -I tools/analyze.py contrast           what separates adjacent bands
"""
import io
import json
import os
import re
import statistics as st
import sys
from collections import Counter, defaultdict

CORPUS = "corpus"
LEVELS = ("cet4", "cet6")
BAND_SEQUENCE = ["01-03", "04-06", "07-09", "10-12", "13-15"]

CONNECTIVES = [
    "however", "moreover", "furthermore", "therefore", "thus", "hence",
    "nevertheless", "nonetheless", "consequently", "meanwhile", "besides",
    "additionally", "in addition", "on the contrary", "in contrast", "by contrast",
    "as a result", "for instance", "for example", "in conclusion", "to conclude",
    "in summary", "to sum up", "first and foremost", "firstly", "secondly",
    "thirdly", "lastly", "finally", "what is more", "in other words",
    "on the one hand", "on the other hand", "in brief", "above all",
    "to begin with", "to start with", "in a word", "all in all", "so to speak",
]
SUBORDINATORS = [
    "although", "though", "unless", "whereas", "while", "because", "since",
    "if", "when", "whenever", "before", "after", "until", "as long as",
    "even though", "even if", "in order that", "so that", "provided that",
    "as if", "whether",
]
MODALS = ["can", "could", "may", "might", "must", "should", "would", "will", "shall"]

# Patterns that mark a plausible interlanguage error. Each is a regex over
# lowercased text; these catch shapes that are common in Chinese-L1 writing.
ERROR_PROBES = [
    ("uncountable_plural", r"\b(many|much|several|some)\s+(informations|advices|equipments|furnitures|knowledges|progresses|homeworks|researches|news|moneys|peoples)\b"),
    ("plural_noun_singular_verb", r"\b(people|students|we|they)\s+(is|was|has|does)\b"),
    ("third_person_s_drop", r"\b(he|she|it)\s+(have|do|make|take|get|go|come|need|want|help|play|think|know|say|give|find|use|become|seem)\b"),
    ("double_comparative", r"\b(more|most)\s+\w+er\b"),
    ("double_verb", r"\b(is|are|was|were|be)\s+\w+ed\s+\w+ed\b"),
    ("a_plural", r"\ba\s+\w+s\b"),
    ("reason_is_because", r"\bthe reason is because\b"),
    ("despite_of", r"\bdespite of\b"),
    ("according_to_me", r"\baccording to me\b"),
    ("very_much_like", r"\bvery much like\b"),
    ("can_not_verb", r"\bcan\s+\w+\s+to\s+\w+\b"),
    ("there_have", r"\bthere\s+(have|has)\b"),
    ("although_but", r"\balthough\b[^.]{0,80}\bbut\b"),
    ("in_my_opinion_i_think", r"\b(in my opinion|i think)\b[^.]{0,40}\bi (think|believe)\b"),
    ("with_the_development", r"\bwith the (rapid )?(development|growth|progress)\b"),
    ("more_and_more", r"\bmore and more\b"),
    ("nowadays_cliche", r"\bnowadays\b"),
    ("play_role_cliche", r"\bplay(s|ed)? (a|an) (more and more |increasingly )?(important|significant|vital|crucial) role\b"),
    ("only_in_this_way", r"\bonly in this way\b"),
    ("last_but_not_least", r"\blast but not least\b"),
]

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
CJK_RE = re.compile(r"[一-鿿　-〿＀-￯]")


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def sentences(text):
    parts = [s.strip() for s in SENT_SPLIT.split(text or "") if s.strip()]
    return [p for p in parts if WORD_RE.search(p)]


def words(text):
    return WORD_RE.findall(text or "")


def count_phrases(low, phrases):
    """Count non-overlapping occurrences, longest phrase first."""
    total = 0
    hits = Counter()
    for ph in sorted(phrases, key=len, reverse=True):
        pat = r"(?<![a-z])" + re.escape(ph) + r"(?![a-z])"
        n = len(re.findall(pat, low))
        if n:
            hits[ph] += n
            total += n
    return total, hits


def features(text, level, band, score):
    t = text or ""
    low = t.lower()
    ws = words(t)
    nw = len(ws) or 1
    sents = sentences(t)
    slens = [len(words(s)) for s in sents] or [0]
    paras = [p for p in re.split(r"\n\s*\n|\n", t) if p.strip()]
    types = {w.lower() for w in ws}
    clich = [re.findall(p, low) for _, p in ERROR_PROBES]
    conn_total, conn_hits = count_phrases(low, CONNECTIVES)
    sub_total, _ = count_phrases(low, SUBORDINATORS)
    modal_total, _ = count_phrases(low, MODALS)

    openings = [s.split()[0].lower() for s in sents if s.split()]
    opening_rep = 0
    if openings:
        opening_rep = max(Counter(openings).values()) / len(openings)

    # CJK characters inside an English essay usually mean an untranslated gloss
    # or a copied mark; either way the record is suspect.
    cjk = len(CJK_RE.findall(t))

    return {
        "level": level, "band": band, "score": score,
        "words": len(ws),
        "sentences": len(sents),
        "paragraphs": len(paras),
        "mean_sent_len": round(sum(slens) / len(slens), 2),
        "sd_sent_len": round(st.pstdev(slens), 2) if len(slens) > 1 else 0.0,
        "max_sent_len": max(slens),
        "long_sent_ratio": round(sum(1 for s in slens if s >= 25) / len(slens), 3),
        "short_sent_ratio": round(sum(1 for s in slens if s <= 8) / len(slens), 3),
        "ttr": round(len(types) / nw, 3),
        "long_word_ratio": round(sum(1 for w in ws if len(w) >= 7) / nw, 3),
        "connectives_per_100w": round(conn_total * 100 / nw, 2),
        "distinct_connectives": len(conn_hits),
        "subordinators_per_sent": round(sub_total / len(sents), 2) if sents else 0,
        "modals_per_100w": round(modal_total * 100 / nw, 2),
        "repeat_opening_ratio": round(opening_rep, 3),
        "error_probe_hits": sum(len(x) for x in clich),
        "error_probes_fired": sum(1 for x in clich if x),
        "cjk_chars": cjk,
        "cliche_hits": {name: len(re.findall(pat, low))
                        for name, pat in ERROR_PROBES
                        if re.findall(pat, low)},
    }


NUMERIC = [
    "words", "sentences", "paragraphs", "mean_sent_len", "sd_sent_len",
    "max_sent_len", "long_sent_ratio", "short_sent_ratio", "ttr",
    "long_word_ratio", "connectives_per_100w", "distinct_connectives",
    "subordinators_per_sent", "modals_per_100w", "repeat_opening_ratio",
    "error_probe_hits", "error_probes_fired",
]


def load_corpus():
    rows = []
    for lv in LEVELS:
        p = os.path.join(CORPUS, f"{lv}.jsonl")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return rows


def cmd_features():
    rows = load_corpus()
    if not rows:
        print("corpus empty - run store.py merge first")
        return 1
    feats = [features(r.get("text", ""), r["level"], r["band"], r.get("score"))
             for r in rows]
    dest = os.path.join(CORPUS, "features.jsonl")
    with open(dest, "w", encoding="utf-8") as fh:
        for f in feats:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    print(f"wrote {dest}: {len(feats)} rows")
    suspicious = [f for f in feats if f["cjk_chars"] > 0]
    if suspicious:
        print(f"  {len(suspicious)} records contain CJK characters (possible bad extraction)")
    thin = [f for f in feats if f["words"] < 80]
    if thin:
        print(f"  {len(thin)} records are under 80 words (possible excerpt, not a full essay)")
    return 0


def agg(rows, key):
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    if not vals:
        return None
    return {"mean": round(sum(vals) / len(vals), 2),
            "median": round(st.median(vals), 2),
            "min": round(min(vals), 2), "max": round(max(vals), 2)}


def cmd_bands():
    rows = load_corpus()
    if not rows:
        print("corpus empty")
        return 1
    feats = [features(r.get("text", ""), r["level"], r["band"], r.get("score"))
             for r in rows]
    by_band = defaultdict(list)
    for f in feats:
        by_band[f["band"]].append(f)

    print("Per-band profile (mean values). n is small in the low bands - read with care.\n")
    header = f"{'band':8s} {'n':>4s} " + " ".join(f"{k[:11]:>11s}" for k in NUMERIC[:10])
    print(header)
    print("-" * len(header))
    for band in BAND_SEQUENCE:
        rs = by_band.get(band, [])
        if not rs:
            print(f"{band:8s} {0:>4d}  (empty)")
            continue
        cells = []
        for k in NUMERIC[:10]:
            a = agg(rs, k)
            cells.append(f"{a['mean']:>11.2f}" if a else f"{'-':>11s}")
        print(f"{band:8s} {len(rs):>4d} " + " ".join(cells))

    print("\nError probes per band (share of essays firing each probe):")
    for band in BAND_SEQUENCE:
        rs = by_band.get(band, [])
        if not rs:
            continue
        counter = Counter()
        for r in rs:
            for name in r["cliche_hits"]:
                counter[name] += 1
        top = counter.most_common(6)
        share = ", ".join(f"{n} {c}/{len(rs)}" for n, c in top) or "(none)"
        print(f"  {band}: {share}")

    print("\nCliche/connective counts by band:")
    print(f"  {'band':8s} {'cliche_probe_hits':>18s} {'distinct_connectives':>21s} {'connectives/100w':>17s}")
    for band in BAND_SEQUENCE:
        rs = by_band.get(band, [])
        if not rs:
            continue
        e = agg(rs, "error_probe_hits"); d = agg(rs, "distinct_connectives")
        c = agg(rs, "connectives_per_100w")
        print(f"  {band:8s} {e['mean']:>18.2f} {d['mean']:>21.2f} {c['mean']:>17.2f}")
    return 0


def cmd_contrast():
    """Which features move monotonically across bands - those are the usable ones."""
    rows = load_corpus()
    if not rows:
        print("corpus empty")
        return 1
    feats = [features(r.get("text", ""), r["level"], r["band"], r.get("score"))
             for r in rows]
    by_band = defaultdict(list)
    for f in feats:
        by_band[f["band"]].append(f)

    print("Monotonicity check: does the feature move steadily from band 01-03 to 13-15?\n")
    scored = []
    for key in NUMERIC:
        means = []
        ok = True
        for band in BAND_SEQUENCE:
            rs = by_band.get(band, [])
            a = agg(rs, key) if rs else None
            if not a:
                ok = False
                break
            means.append(a["mean"])
        if not ok or len(means) < 4:
            continue
        diffs = [means[i + 1] - means[i] for i in range(len(means) - 1)]
        ups = sum(1 for d in diffs if d > 0)
        downs = sum(1 for d in diffs if d < 0)
        direction = "up" if ups >= len(diffs) - 1 else ("down" if downs >= len(diffs) - 1 else None)
        if direction:
            scored.append((key, direction, means))
    if not scored:
        print("No feature moves monotonically. Either the corpus is too small or the")
        print("bands are not separable by surface features - a real finding, report it.")
        return 0
    for key, direction, means in scored:
        arrow = "->".join(f"{m:g}" for m in means)
        print(f"  {key:24s} {direction:4s}  {arrow}")
    return 0


def main(argv):
    sys.stdout = out()
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    return {"features": cmd_features, "bands": cmd_bands,
            "contrast": cmd_contrast}.get(cmd, lambda: 2)()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
