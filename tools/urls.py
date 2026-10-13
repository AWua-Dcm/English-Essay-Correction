#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
urls.py - build a harvest URL list by walking paginated index pages.

Index pages list article titles but no essay text, so they are cheap to walk and
they are how the archive is actually navigated. Given a list of index URL
patterns, this collects same-site article links, filters out titles that cannot
be essays, and writes a deduplicated URL file for crawl.py batch.

  python -I tools/urls.py build --site koolearn-cet4 --pages 30 --out corpus/_urls_cet4.txt
  python -I tools/urls.py build --site koolearn-cet6 --pages 30 --out corpus/_urls_cet6.txt

Site patterns are declared in SITES below rather than passed as arguments so the
verified source list lives in one reviewable place.
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harvest  # noqa: E402
import crawl    # noqa: E402

SITES = {
    "koolearn-cet4": {
        "index": "https://cet4.koolearn.com/zuowen/{n}.html",
        "root": "https://cet4.koolearn.com/zuowen/",
        "match": r"^https?://cet4\.koolearn\.com/\d{8}/\d+\.html",
    },
    "koolearn-cet6": {
        "index": "https://cet6.koolearn.com/zuowen/{n}.html",
        "root": "https://cet6.koolearn.com/zuowen/",
        "match": r"^https?://cet6\.koolearn\.com/\d{8}/\d+\.html",
    },
}

# Titles that cannot contain a complete model essay.
TITLE_REJECT = [
    r"模板",          # template
    r"万能句型",      # universal sentence patterns
    r"高频词汇|词汇|单词",
    r"听力|阅读|翻译|完形|选词",
    r"报名|准考证|成绩查询|查分|分数线",
    r"真题答案|答案解析|参考答案",
    r"考试时间|考试流程|考场",
    r"经验|技巧汇总|备考计划|复习计划",
    r"语法",
]
TITLE_REJECT_RE = re.compile("|".join(TITLE_REJECT))
# Titles that suggest an essay is present.
TITLE_WANT = re.compile(r"范文|作文|写作|话题|押题|预测|模板作文|参考范文")


def out():
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def index_links(url):
    raw, label = crawl.quiet_read(url)
    if raw is None:
        return []
    html, _ = harvest.decode_html(raw)
    links, seen = [], set()
    for m in re.finditer(r'(?is)<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', html):
        href = m.group(1).strip()
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            href = re.match(r"https?://[^/]+", url).group(0) + href
        if not re.match(r"^https?://", href, re.I) or href in seen:
            continue
        seen.add(href)
        title = re.sub(r"<[^>]+>", "", m.group(2))
        title = re.sub(r"\s+", " ", title).strip()
        links.append((href, title))
    return links


def build(site, pages):
    cfg = SITES[site]
    pat = re.compile(cfg["match"])
    found, seen = [], set()
    urls = [cfg["root"]] + [cfg["index"].format(n=n) for n in range(1, pages + 1)]
    for i, u in enumerate(urls, 1):
        links = index_links(u)
        kept = 0
        for href, title in links:
            if not pat.match(href) or href in seen:
                continue
            if TITLE_REJECT_RE.search(title):
                continue
            seen.add(href)
            found.append((href, title))
            kept += 1
        print(f"  [{i}/{len(urls)}] {u} -> {len(links)} links, {kept} kept",
              file=sys.stderr)
    return found


def main(argv):
    sys.stdout = out()
    if len(argv) < 2 or argv[1] != "build":
        print(__doc__)
        return 2
    site = argv[argv.index("--site") + 1]
    pages = int(argv[argv.index("--pages") + 1])
    dest = argv[argv.index("--out") + 1]
    found = build(site, pages)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(f"# {site}: {len(found)} article urls\n")
        for href, title in found:
            fh.write(f"{href}\t{title}\n")
    print(f"{dest}: {len(found)} urls")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
