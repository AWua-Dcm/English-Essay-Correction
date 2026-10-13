#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest_ocr.py - render a fake exam-script page so the OCR path can be tested.

The official CET sample scripts (14/11/8/5/2 marks) are published as images, so
transcribing images is the only route to real low-band essays. Before sending
agents down that route, render a page that looks like a scanned script and try
to read it back.

Output: corpus/_raw/img/selftest_script.png  (gitignored, throwaway)

Usage: python -I tools/selftest_ocr.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 900, 620
BG = (252, 252, 250)

SCRIPT = [
    ("Sample Script  (score label: 11)",
     "title"),
    ("", "body"),
    ("Directions: For this part, you are allowed 30 minutes to write an essay on",
     "body"),
    ("the importance of reading ability. You should write at least 120 words but",
     "body"),
    ("no more than 180 words.", "body"),
    ("", "body"),
    ("Nowadays, reading ability is playing a more and more important role in our",
     "body"),
    ("daily life. Many people think that read is very useful for everyone. On the",
     "body"),
    ("one hand, we can get many informations from books. On the other hand, it can",
     "body"),
    ("make us happy and relax. Besides, read can open our eyes and let us know the",
     "body"),
    ("world. So I think everyone should take time to read every day. In a word,",
     "body"),
    ("reading ability is very important for us.", "body"),
    ("", "body"),
    ("(Deliberate band-8-ish flaws: 'read' as verb, 'many informations',",
     "note"),
    ("repetitive sentence openings, weak connective variety.)", "note"),
]


def load_font(size: int, bold: bool = False):
    cands = [
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
    ]
    for path in cands:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main():
    out_dir = os.path.join("corpus", "_raw", "img")
    os.makedirs(out_dir, exist_ok=True)
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Faint ruled lines, like ruled exam paper.
    for y in range(70, H - 30, 34):
        draw.line([(40, y), (W - 40, y)], fill=(228, 228, 232), width=1)
    draw.rectangle([(30, 30), (W - 30, H - 30)], outline=(180, 180, 186), width=2)

    f_title = load_font(20, bold=True)
    f_body = load_font(19)
    f_note = load_font(16)

    y = 46
    for text, kind in SCRIPT:
        font = {"title": f_title, "note": f_note}.get(kind, f_body)
        color = (30, 30, 34) if kind != "note" else (120, 120, 130)
        if text:
            draw.text((52, y), text, font=font, fill=color)
        y += 30 if kind != "body" else 26

    path = os.path.join(out_dir, "selftest_script.png")
    img.save(path)
    print(f"wrote {path} ({W}x{H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
