#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
probe.py — feasibility probe for CET essay harvesting.

Reads one or more already-downloaded HTML files and reports, per file:
  - detected encoding, byte size, visible-text char count, <img> count
  - how many score markers (14分/11分/...) and 档次 words appear
  - how many "English essay-like" paragraphs exist (long runs of Latin text)

Language-agnostic on purpose: the score-marker search uses unicode escapes so
this file stays ASCII and cannot be mangled by a Windows console codepage.

Usage:  python -I tools/probe.py corpus/_raw/a.html [more.html ...]
"""
import io
import os
import re
import sys
import unicodedata

# Score markers written as escapes: keeps this source file pure ASCII.
SCORE_WORDS = [
    "分",            # 分
    "样卷",      # 样卷
    "样文",      # 样文
    "范文",      # 范文
    "评分标准",  # 评分标准
    "档",            # 档
]
SCORE_PATTERNS = [f"{n}分" for n in (14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1)]


def decode(raw: bytes):
    """Return (text, encoding_name). Tries meta charset first, then common CN encodings."""
    head = raw[:6000]
    m = re.search(rb'charset\s*=\s*["\']?([\w\-]+)', head, re.I)
    cands = []
    if m:
        cands.append(m.group(1).decode("ascii", "replace").lower())
    cands += ["utf-8", "gb18030", "gbk", "big5"]
    for enc in cands:
        if enc in ("gb2312", "gb-2312"):
            enc = "gb18030"
        try:
            return raw.decode(enc), enc
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace"), "utf-8/replace"


def strip_tags(html: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript|svg|head)\b.*?</\1>", " ", html)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
          .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
          .replace("&#39;", "'").replace("&ldquo;", '"').replace("&rdquo;", '"'))
    s = re.sub(r"[ \t　]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return s.strip()


def english_paragraphs(text: str):
    """Paragraphs that look like English prose: >=8 words, mostly Latin letters."""
    out = []
    for para in re.split(r"\n{1,}", text):
        p = para.strip()
        if len(p) < 40:
            continue
        words = p.split()
        if len(words) < 8:
            continue
        latin = sum(1 for c in p if c.isascii() and c.isalpha())
        letters = sum(1 for c in p if c.isalpha())
        if letters and latin / letters > 0.92:
            out.append(p)
    return out


def probe(path: str):
    raw = open(path, "rb").read()
    text, enc = decode(raw)
    visible = strip_tags(text)
    paras = english_paragraphs(visible)

    print("=" * 72)
    print("FILE      ", path)
    print("bytes     ", len(raw))
    print("encoding  ", enc)
    print("visible   ", len(visible), "chars")
    print("img tags  ", len(re.findall(r"(?i)<img", text)))
    print("json-ld   ", len(re.findall(r"(?i)application/ld\+json", text)))

    marker_hits = sum(1 for p in SCORE_PATTERNS if p in visible)
    print("scorept*  ", marker_hits, "of", len(SCORE_PATTERNS), "distinct  N分 markers present")
    for w in SCORE_WORDS:
        c = visible.count(w)
        if c:
            print("  word    ", ascii(w).ljust(30), c)

    print("english paragraphs:", len(paras))
    total_words = 0
    for p in paras[:6]:
        w = len(p.split())
        total_words += w
        preview = " ".join(p.split()[:9])
        print(f"   - {w:4d}w | {preview} ...")
    if len(paras) > 6:
        print(f"   ... and {len(paras) - 6} more")
    print("english words in first 6 paragraphs:", total_words)


def main(argv):
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stdout = out
    if len(argv) < 2:
        print(__doc__)
        return 2
    for p in argv[1:]:
        if not os.path.exists(p):
            print("MISSING", p)
            continue
        try:
            probe(p)
        except Exception as e:  # noqa: BLE001 - probe tool, report and continue
            print("ERROR", p, type(e).__name__, e)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
