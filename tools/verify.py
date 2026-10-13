#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify.py - mechanically re-check that each corpus record is real.

Agent-based verification cost ~1.4M subagent tokens per run and died on a
depleted balance twice. But most of what verification needs to establish is
deterministic: does the essay still appear on the page it was taken from, and
does the page still state the mark that was recorded? That is a re-fetch and a
string comparison, so it belongs in a script, not in a model.

What this can and cannot prove:
  * It CAN confirm that a recorded essay's text is present on the cited page,
    and that the claimed mark appears there too.
  * It CANNOT read an essay out of an image. Records whose text was transcribed
    from a screenshot (the university writing-diagnosis pages, the official
    sample scripts) will show low text overlap by construction. For those the
    mark is still checkable, so they are marked `text_from_image` rather than
    failed - but the transcript itself remains human/model-read, not verified.

Verdicts written back into each record:
  confirmed        text overlap high AND mark found on the page
  mark_only        mark found, text not present (image-hosted essay)
  text_only        text present, mark not found          <- investigate
  refuted          neither present                        <- drop candidate
  unreachable      page gone or fetch failed
"""
import io
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harvest  # noqa: E402

CORPUS = "corpus"
LEVELS = ("cet4", "cet6")
OVERLAP_CONFIRM = 0.45      # share of the record's 5-grams found on the page
OVERLAP_MIN = 0.08          # below this, the text is simply not on the page

NUM_ZH = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
          "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def norm(s):
    s = (s or "").lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9\s']", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def grams(text, k=5):
    w = norm(text).split()
    return {" ".join(w[i:i + k]) for i in range(max(0, len(w) - k + 1))}


def overlap(rec_text, page_text):
    g = grams(rec_text)
    if not g:
        return 0.0
    p = set(norm(page_text).split())
    hits = 0
    for gram in g:
        parts = gram.split()
        if all(x in p for x in parts):
            hits += 1
    return hits / len(g)


def mark_present(page_text, rec):
    """Does the page still state this record's mark?"""
    score = rec.get("score")
    raw = rec.get("score_raw") or ""
    hay = page_text or ""
    if score:
        for pat in (f"{score}分", f"{score} 分", f"{score}points",
                    f"{score} points", f"{score}/15", f"得分：{score}",
                    f"得分： {score}", f"作文得分：{score}"):
            if pat in hay:
                return True, pat
        if re.search(rf"(?<!\d){score}(?!\d)", hay):
            return True, str(score)
        return False, ""
    if raw:
        r = raw.strip()
        if r and r in hay:
            return True, r
    return False, ""


def main(argv):
    sys.stdout = out()
    only = argv[1] if len(argv) > 1 else "labeled"
    cache = {}
    results = []
    for level in LEVELS:
        path = os.path.join(CORPUS, f"{level}.jsonl")
        if not os.path.exists(path):
            continue
        rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
        for rec in rows:
            if only == "labeled" and rec.get("corpus_class") != "labeled":
                continue
            url = rec["source_url"]
            if url not in cache:
                raw, label = harvest.read_input(url)
                if raw is None:
                    cache[url] = None
                else:
                    html, _ = harvest.decode_html(raw)
                    cache[url] = harvest.strip_tags(html)
                print(f"  fetched {url[:78]}", file=sys.stderr)
            page = cache[url]
            if page is None:
                verdict, note, ov, mk = "unreachable", "fetch failed", None, False
            else:
                ov = overlap(rec["text"], page)
                mk, mkpat = mark_present(page, rec)
                if ov >= OVERLAP_CONFIRM and mk:
                    verdict, note = "confirmed", f"overlap={ov:.2f}; mark={mkpat}"
                elif mk and ov < OVERLAP_CONFIRM:
                    verdict, note = "mark_only", f"overlap={ov:.2f}; mark={mkpat}"
                elif ov >= OVERLAP_CONFIRM and not mk:
                    verdict, note = "text_only", f"overlap={ov:.2f}; mark not found"
                elif ov < OVERLAP_MIN and not mk:
                    verdict, note = "refuted", f"overlap={ov:.2f}; mark not found"
                else:
                    verdict, note = "mark_only", f"overlap={ov:.2f}; mark={mkpat}"
            rec["verify"] = verdict
            rec["verify_note"] = note
            results.append((verdict, rec.get("score"), rec.get("source_site", "")[:26]))
        with open(path, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nverified {len(results)} records")
    for v, n in Counter(r[0] for r in results).most_common():
        print(f"  {v:12s} {n}")
    print("\nby verdict x score:")
    grid = {}
    for v, s, _ in results:
        grid.setdefault(v, Counter())[s] += 1
    for v, c in grid.items():
        inner = " ".join(f"{k}:{n}" for k, n in sorted(c.items(),
                         key=lambda x: (x[0] is None, x[0])))
        print(f"  {v:12s} {inner}")
    refuted = [r for r in results if r[0] == "refuted"]
    if refuted:
        print(f"\n{len(refuted)} records refuted - inspect before using as anchors")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
