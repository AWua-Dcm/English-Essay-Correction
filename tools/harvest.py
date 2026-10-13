#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
harvest.py - fetch and clean web pages for CET essay corpus building.

WebFetch is unavailable in this environment; curl works against CN sites.
This tool is the mechanical half of harvesting: download, decode, strip tags,
and surface the high-signal English text. What counts as "one essay" is left
to the caller's judgement - the tool never guesses boundaries.

Subcommands
-----------
  fetch  <url> [--out FILE] [--raw-dir DIR]
        Download a URL (via curl) and save the raw HTML. Prints "saved <path>".
        Default output is <raw-dir>/<slug>.html where raw-dir is corpus/_raw.

  text   <url|FILE> [--english-only] [--offset N] [--max-chars N] [--json]
        Decode and strip a page, printing clean paragraph text.
        --english-only keeps only paragraph runs that are Latin-dominant,
        which is where CET essays live (drops all the Chinese boilerplate).
        Long text is windowed with --offset/--max-chars so a caller can page
        through it without blowing up its context.

  images <url|FILE>
        List absolute <img> URLs with alt text, one per line, as JSON.
        For the official sample-script pages whose essays are images.

Score normalisation lives in store.py, not here: this tool does not judge.

Exit codes: 0 ok, 2 usage, 3 fetch failure, 4 no such file.
Source is pure ASCII on purpose so a cp936 console cannot mangle it.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
DEFAULT_RAW_DIR = os.path.join("corpus", "_raw")

SKIP_TAGS = ("script", "style", "noscript", "svg", "head", "nav", "footer",
             "form", "iframe", "button", "select")


def out():
    """UTF-8 stdout that survives a non-UTF-8 console."""
    return io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def slugify(url: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("//", 1)[-1])[:80]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return f"{stem}.{digest}.html"


def fetch(url: str, out_path: str, quiet: bool = False):
    """Download `url` to `out_path`.

    When called as a helper by text/images, the progress line goes to stderr so
    it cannot corrupt a --json payload on stdout. The `fetch` subcommand itself
    calls with quiet=False because its output line IS the result.
    """
    def say(msg):
        if not quiet:
            print(msg)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    cmd = ["curl", "-sSL", "--max-time", "30", "--compressed",
           "-A", UA,
           "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
           "-w", "\n%{http_code}", url]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"FETCH_FAIL {url} {type(e).__name__}: {e}")
        return 3
    body = proc.stdout
    if not body:
        say(f"FETCH_FAIL {url} empty response")
        return 3
    nl = body.rfind(b"\n")
    status = body[nl + 1:].strip() if nl != -1 else b""
    content = body[:nl] if nl != -1 else body
    if not status.isdigit() or int(status) >= 400:
        say(f"FETCH_FAIL {url} http={status.decode('ascii', 'replace')}")
        return 3
    if len(content) < 200:
        say(f"FETCH_FAIL {url} too small ({len(content)} bytes)")
        return 3
    with open(out_path, "wb") as fh:
        fh.write(content)
    say(f"saved {out_path} ({len(content)} bytes, http={status.decode('ascii')})")
    return 0


# Lone surrogates (U+D800-U+DFFF) are not valid text and cannot be encoded back
# to UTF-8, so they crash any later write. Malformed source pages do produce
# them, so strip them at the single point where bytes become text.
LONE_SURROGATE_RE = re.compile(r"[\ud800-\udfff]")


def decode_html(raw: bytes):
    head = raw[:6000]
    m = re.search(rb'charset\s*=\s*["\']?([\w\-]+)', head, re.I)
    cands = []
    if m:
        cands.append(m.group(1).decode("ascii", "replace").lower())
    cands += ["utf-8", "gb18030", "big5"]
    for enc in cands:
        if enc in ("gb2312", "gb-2312"):
            enc = "gb18030"
        try:
            return LONE_SURROGATE_RE.sub("", raw.decode(enc)), enc
        except (UnicodeDecodeError, LookupError):
            continue
    return LONE_SURROGATE_RE.sub("", raw.decode("utf-8", "replace")), "utf-8/replace"


ENTITIES = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&apos;": "'", "&ldquo;": '"', "&rdquo;": '"',
    "&lsquo;": "'", "&rsquo;": "'", "&mdash;": "-", "&ndash;": "-",
    "&hellip;": "...", "&rarr;": "->", "&times;": "x", "&middot;": ".",
}


def strip_tags(html: str) -> str:
    s = html
    for tag in SKIP_TAGS:
        s = re.sub(rf"(?is)<{tag}\b.*?</{tag}\s*>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|li|h[1-6]|tr|blockquote|section|article)\s*>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    for ent, rep in ENTITIES.items():
        s = s.replace(ent, rep)
    s = re.sub(r"&#x?[0-9A-Fa-f]+;", " ", s)
    s = s.replace("　", " ")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = "\n".join(line.strip() for line in s.split("\n"))
    s = re.sub(r"\n{2,}", "\n", s)
    return s.strip()


def latin_ratio(p: str) -> float:
    letters = [c for c in p if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isascii()) / len(letters)


def english_dominant(para: str, min_words: int = 8) -> bool:
    p = para.strip()
    if len(p) < 35 or len(p.split()) < min_words:
        return False
    if latin_ratio(p) < 0.90:
        return False
    # Reject navigation / markup leftovers: CJK-free but punctuation-sparse.
    if p.count("  ") > len(p) / 20:
        return False
    return True


def paragraphs(text: str):
    return [p.strip() for p in re.split(r"\n+", text) if p.strip()]


def read_input(src: str):
    """src is a URL or a local path. Returns (html, label) or (None, label)."""
    if re.match(r"^https?://", src, re.I):
        tmp = os.path.join(DEFAULT_RAW_DIR, slugify(src))
        rc = fetch(src, tmp, quiet=True)
        if rc != 0:
            return None, src
        return open(tmp, "rb").read(), tmp
    if not os.path.exists(src):
        return None, src
    return open(src, "rb").read(), src


def cmd_text(src: str, english_only: bool, offset: int, max_chars: int, as_json: bool):
    raw, label = read_input(src)
    if raw is None:
        print(f"NO_INPUT {label}", file=sys.stderr)
        return 4
    html, enc = decode_html(raw)
    text = strip_tags(html)
    paras = paragraphs(text)
    if english_only:
        keep = []
        for p in paras:
            if english_dominant(p):
                keep.append(p)
            elif keep and keep[-1] != "" and len(p) < 35:
                pass  # short labels between English paras are dropped
        paras = keep
    full = "\n\n".join(paras)
    total = len(full)
    window = full[offset:offset + max_chars] if max_chars > 0 else full[offset:]
    if as_json:
        print(json.dumps({
            "label": label, "encoding": enc,
            "paragraphs": len(paras), "total_chars": total,
            "offset": offset, "returned_chars": len(window),
            "truncated": (offset + len(window)) < total,
            "text": window,
        }, ensure_ascii=False))
    else:
        print(f"### {label} | enc={enc} | paras={len(paras)} | "
              f"chars={total} | showing {offset}..{offset + len(window)}"
              f"{' (truncated)' if (offset + len(window)) < total else ''}")
        print(window)
    return 0


def cmd_images(src: str):
    raw, label = read_input(src)
    if raw is None:
        print(f"NO_INPUT {label}", file=sys.stderr)
        return 4
    html, _ = decode_html(raw)
    base = label if re.match(r"^https?://", str(label), re.I) else ""
    m = re.search(r'<base\s+href=["\']([^"\']+)', html, re.I)
    if m:
        base = m.group(1)
    found = []
    for tag in re.findall(r"(?is)<img[^>]*>", html):
        # Lazy-loading is near-universal on CN content sites; the real URL often
        # lives only in a data-* attribute while src holds a placeholder.
        sm = None
        for attr in ("src", "data-src", "data-original", "data-lazy-src",
                     "data-echo", "data-actualsrc", "data-ks-lazyload"):
            sm = re.search(rf'(?i)\b{attr}\s*=\s*["\']([^"\']+)["\']', tag)
            if sm and not sm.group(1).strip().lower().startswith("data:"):
                break
            sm = None
        if not sm:
            continue
        url = sm.group(1).strip()
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/") and base:
            url = base.rstrip("/") + url
        elif not re.match(r"^https?://", url, re.I) and base:
            url = base.rstrip("/") + "/" + url
        if not re.match(r"^https?://", url, re.I):
            continue
        if re.search(r"\.(gif|svg)(\?|$)", url, re.I):
            continue
        alt = re.search(r'(?i)\balt\s*=\s*["\']([^"\']*)["\']', tag)
        found.append({"src": url, "alt": (alt.group(1).strip() if alt else "")})
    print(json.dumps(found, ensure_ascii=False, indent=1))
    return 0


def parse_flags(argv):
    flags = {"english_only": False, "json": False, "offset": 0,
             "max_chars": 0, "out": None, "raw_dir": DEFAULT_RAW_DIR}
    positional = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--english-only":
            flags["english_only"] = True
        elif a == "--json":
            flags["json"] = True
        elif a == "--offset":
            i += 1
            flags["offset"] = int(argv[i])
        elif a == "--max-chars":
            i += 1
            flags["max_chars"] = int(argv[i])
        elif a == "--out":
            i += 1
            flags["out"] = argv[i]
        elif a == "--raw-dir":
            i += 1
            flags["raw_dir"] = argv[i]
        else:
            positional.append(a)
        i += 1
    return positional, flags


def main(argv):
    sys.stdout = out()
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    pos, flags = parse_flags(argv[2:])
    if not pos:
        print("missing argument", file=sys.stderr)
        return 2
    target = pos[0]
    if cmd == "fetch":
        dest = flags["out"] or os.path.join(flags["raw_dir"], slugify(target))
        return fetch(target, dest)
    if cmd == "text":
        return cmd_text(target, flags["english_only"], flags["offset"],
                        flags["max_chars"], flags["json"])
    if cmd == "images":
        return cmd_images(target)
    print(f"unknown subcommand: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
