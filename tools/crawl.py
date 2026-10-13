#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crawl.py - bulk mechanical harvesting from an already-verified source list.

Searching is what makes agent-driven harvesting expensive (~140k tokens per agent,
measured). The source list is already known, so the bulk of the corpus should be
gathered by crawling deterministically and spending model tokens only on the parts
that need judgement: which band an essay belongs to, and whether a segmentation is
right.

This tool therefore produces CANDIDATES, never corpus records. Everything it emits
is `verify: pending` and must be adjudicated before it counts.

  index <url>                 list candidate detail-page links from an index page
  page  <url> [--shard NAME]  emit candidate essays from one article page as JSONL
  batch <urls-file> --shard N run `page` over many URLs, appending to one shard

Segmentation heuristics (deliberately conservative - a wrong split is worse than
a missed essay):
  * join hard-wrapped lines, because several sources (51test, m.koolearn) break
    sentences mid-line at ~40 chars and lose the space with it
  * an essay is a run of English-dominant paragraphs, 70-320 words
  * drop blocks carrying site watermarks or nav furniture
  * never merge across a Chinese heading - those mark source-level essay splits
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harvest  # noqa: E402  (local tool, path inserted above)

MIN_WORDS = 70
MAX_WORDS = 320

WATERMARKS = [
    r"恒星\s*英语",          # 恒星英语
    r"http://www\.Hxen\.com",
    r"本栏目更多同类内容",  # 本栏目更多同类内容
    r"扫码关注|微信公众号",  # 扫码关注 / 微信公众号
    r"版权所有|转载请注明",  # 版权所有 / 转载请注明
    r"点击查看更多|相关阅读|延伸阅读",
    r"copyright|\ball rights reserved\b",
    r"上一篇|下一篇",  # 上一篇 / 下一篇
]
WATERMARK_RE = re.compile("|".join(WATERMARKS), re.I)

# Chinese keeps appearing inline on these pages; a paragraph is "English" when
# almost all of its letters are Latin.
CJK_RE = re.compile(r"[一-鿿　-〿＀-￯]")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
END_PUNCT = '.!?;:"”’)'


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def quiet_read(url):
    """harvest.read_input() announces every download on stdout, which would
    corrupt this tool's JSONL output. Route that chatter to stderr."""
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        return harvest.read_input(url)
    finally:
        sys.stdout = saved


def join_hard_wraps(text):
    """Re-join lines that were wrapped mid-sentence by the source's layout.

    Several sources wrap at a fixed column and emit each wrapped line as its own
    paragraph (koolearn wraps at ~13 words, 51test at ~40 chars). The reliable
    signal is that a wrapped line does NOT end with terminal punctuation, so the
    join must not depend on the next line's capitalisation - these pages routinely
    capitalise the continuation, which would otherwise slice one essay into
    fragments too short to recognise.
    """
    lines = [l.rstrip() for l in text.split("\n")]
    merged = []
    for line in lines:
        if not merged:
            merged.append(line)
            continue
        prev = merged[-1]
        prev_open = bool(prev) and prev[-1] not in END_PUNCT
        next_is_cjk = bool(line) and bool(CJK_RE.search(line[:1]))
        prev_is_cjk = bool(prev) and bool(CJK_RE.search(prev[-1]))
        if (prev_open and line and not next_is_cjk and not prev_is_cjk
                and not prev.endswith(("-", "—"))):
            merged[-1] = prev + " " + line.lstrip()
        else:
            merged.append(line)
    return "\n".join(merged)


# A block matching this is an answer key or a multiple-choice list, not an essay.
OPTION_RE = re.compile(r"(?:^|\s)[A-D][\).]\s")
NUMITEM_RE = re.compile(r"(?:^|\s)\d{1,2}\s+[A-D][\).]\s")


def looks_like_non_essay(blob: str) -> bool:
    if len(OPTION_RE.findall(blob)) >= 3:
        return True
    if NUMITEM_RE.search(blob):
        return True
    # Reading-passage tells: heavy quotation of statistics or a header marker.
    if re.match(r"^(?:\d+\.\s*)?(?:Section|Part|Passage|Questions?)\b", blob, re.I):
        return True
    sentences = [s for s in re.split(r"[.!?]+\s", blob) if s.strip()]
    if sentences and sum(len(s.split()) for s in sentences) / len(sentences) > 45:
        return True
    return False


# Chinese full stops and commas often terminate English sentences on these
# pages (koolearn writes "...is very happy。"), so normalise them to ASCII.
FULLWIDTH = {"。": ".", "，": ",", "；": ";", "：": ":", "！": "!", "？": "?",
             "（": "(", "）": ")", "“": '"', "”": '"', "‘": "'", "’": "'"}

# A short pure-Chinese line (an annotation like "2分" or "参考译文") sits between
# lines of the same essay and must not split it. Longer Chinese lines are site
# furniture, score tables or the next essay's heading, and must split it.
BRIDGE_MAX_CJK_WORDS = 8
BRIDGE_MAX_LINES = 2


def line_profile(raw_line: str):
    """Return (english_text, english_word_count, cjk_word_count)."""
    eng = CJK_RE.sub(" ", raw_line)
    for fw, asc in FULLWIDTH.items():
        eng = eng.replace(fw, asc)
    eng = re.sub(r"\s+", " ", eng).strip()
    cjk_words = len(re.findall(r"[一-鿿]+", raw_line))
    return eng, len(WORD_RE.findall(eng)), cjk_words


def blocks(text):
    """Split page text into English essay candidates.

    Works line by line rather than paragraph by paragraph: these pages interleave
    Chinese annotations with the English essay inside a single paragraph, so
    filtering at paragraph level throws the essay away with the annotation.
    """
    joined = join_hard_wraps(text)
    lines = [line_profile(l) for l in joined.split("\n")]

    runs, cur, gap = [], [], 0
    for eng, wc, cjk_words in lines:
        if wc >= 4:
            cur.append(eng)
            gap = 0
        elif cur and cjk_words and wc == 0 and gap < BRIDGE_MAX_LINES \
                and cjk_words <= BRIDGE_MAX_CJK_WORDS:
            gap += 1          # short label inside an essay - bridge over it
        else:
            if cur:
                runs.append(" ".join(cur))
            cur, gap = [], 0
    if cur:
        runs.append(" ".join(cur))

    out_blocks = []
    for blob in runs:
        blob = re.sub(r"\s+", " ", blob).strip().replace("''", "'")
        # Split BEFORE filtering. A mixed page can concatenate several essays and
        # an answer key into one run; rejecting the run as a whole would discard
        # the good essays along with the answer key.
        for piece in split_long_run(blob):
            wc = len(WORD_RE.findall(piece))
            if wc < MIN_WORDS or wc > MAX_WORDS:
                continue
            if WATERMARK_RE.search(piece):
                continue
            if looks_like_non_essay(piece):
                continue
            out_blocks.append(piece)
    return out_blocks


def split_long_run(blob: str):
    """Break an over-long run at sentence boundaries instead of discarding it.

    Multi-essay pages put three set-essays back to back with only a short Chinese
    header between them, so the bridging step merges them into one run far longer
    than any single essay. Dropping that run would lose three real essays with no
    trace, so split it and let adjudication decide where the real boundaries are.
    """
    if len(WORD_RE.findall(blob)) <= MAX_WORDS:
        return [blob]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", blob) if s.strip()]
    chunks, cur, cur_wc = [], [], 0
    for s in sentences:
        s_wc = len(WORD_RE.findall(s))
        if cur and cur_wc + s_wc > MAX_WORDS and cur_wc >= MIN_WORDS:
            chunks.append(" ".join(cur))
            cur, cur_wc = [], 0
        cur.append(s)
        cur_wc += s_wc
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def cmd_index(url):
    raw, label = quiet_read(url)
    if raw is None:
        print(f"NO_INPUT {label}", file=sys.stderr)
        return 4
    html, _ = harvest.decode_html(raw)
    base = url if re.match(r"^https?://", url, re.I) else ""
    links = []
    seen = set()
    for m in re.finditer(r'(?is)<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', html):
        href, inner = m.group(1).strip(), m.group(2)
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/") and base:
            href = base.rstrip("/") + href
        elif not re.match(r"^https?://", href, re.I):
            continue
        if not re.search(r"\.(html?|shtml)(\?|$)", href, re.I):
            continue
        title = re.sub(r"<[^>]+>", "", inner)
        title = re.sub(r"\s+", " ", title).strip()
        if len(title) < 4 or href in seen:
            continue
        seen.add(href)
        links.append({"url": href, "title": title[:110]})
    print(json.dumps(links, ensure_ascii=False, indent=1))
    print(f"# {len(links)} links", file=sys.stderr)
    return 0


def essay_candidates(url):
    raw, label = quiet_read(url)
    if raw is None:
        return None, "no input"
    html, enc = harvest.decode_html(raw)
    text = harvest.strip_tags(html)
    title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    page_title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else ""
    cands = blocks(text)
    return {"url": url, "label": label, "encoding": enc,
            "page_title": page_title[:200], "candidates": cands}, None


def cmd_page(url, shard=None):
    data, err = essay_candidates(url)
    if err:
        print(f"NO_INPUT {url}", file=sys.stderr)
        return 4
    site = re.sub(r"^https?://(www\.|m\.)?", "", url).split("/")[0]
    level = "cet6" if re.search(r"cet6|liuji|六级", url, re.I) else "cet4"
    lines = []
    for i, text in enumerate(data["candidates"]):
        rec = {
            "level": level,
            "score": None,
            "band": "",
            "score_raw": "",
            "score_basis": "unstated",
            "topic": "",
            "topic_key": "",
            "title": data["page_title"],
            "text": text,
            "source_url": url,
            "source_site": site,
            "source_title": data["page_title"],
            "verify": "pending",
            "notes": f"crawler candidate #{i + 1}; band and topic not yet adjudicated",
        }
        lines.append(json.dumps(rec, ensure_ascii=False))
    if shard:
        os.makedirs(os.path.join("corpus", "_candidates"), exist_ok=True)
        dest = os.path.join("corpus", "_candidates",
                            re.sub(r"[^A-Za-z0-9._-]", "_", shard) + ".jsonl")
        with open(dest, "a", encoding="utf-8") as fh:
            for l in lines:
                fh.write(l + "\n")
        print(f"{url} -> {len(lines)} candidates -> {dest}")
    else:
        for l in lines:
            print(l)
    return 0


def cmd_batch(urls_file, shard):
    # urls.py writes "<url>\t<title>"; keep only the URL column.
    urls = [l.split("\t")[0].strip() for l in open(urls_file, encoding="utf-8")
            if l.strip() and not l.startswith("#")]
    total = 0
    for u in urls:
        data, err = essay_candidates(u)
        if err:
            print(f"  SKIP {u}")
            continue
        n = len(data["candidates"])
        total += n
        if n:
            cmd_page(u, shard)
        else:
            print(f"  0 candidates {u}")
    print(f"batch done: {total} candidates from {len(urls)} urls")
    return 0


def main(argv):
    sys.stdout = out()
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "index":
        return cmd_index(argv[2])
    if cmd == "page":
        shard = None
        if "--shard" in argv:
            shard = argv[argv.index("--shard") + 1]
        return cmd_page(argv[2], shard)
    if cmd == "batch":
        shard = argv[argv.index("--shard") + 1] if "--shard" in argv else "batch"
        return cmd_batch(argv[2], shard)
    print(f"unknown subcommand: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
