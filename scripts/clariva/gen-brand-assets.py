#!/usr/bin/env python3
# Copyright 2026 The Clariva Authors
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
"""
Regenerates the Clariva brand assets under res/ from ONE vector description of the mark (below).

    python scripts/clariva/gen-brand-assets.py          # needs Pillow (PIL); nothing else

Why a script: the designer's master files (SVG / 1024 px PNG) are not in any repository (spec 06 section 3.1), so the
mark was redrawn from the geometry of https://clarivahub.com's favicon.svg and checked against the Android PNGs. When a
designer master arrives, replace MARK_* below (or drop the generated files) and re-run.

Outputs (all paths relative to res/):
  themes/clariva/img/logos/clariva-logo.svg      transparent mark, square canvas (auth header, home page)
  themes/clariva/img/logos/clariva-app-logo.png  320x320 "glass tile" + mark (static error pages)
  themes/clariva/img/logos/opengraph.png         1200x630 social card
  vector-icons/clariva-icon.svg                  full-bleed #F4F6FB tile + mark (master for the PNG icons)
  vector-icons/favicon.ico                       16/32/48 px, rounded #F4F6FB tile + mark
  vector-icons/*.png                             PWA / apple-touch / mstile PNGs (same file names as upstream)
  vector-icons/browserconfig.xml                 Windows tile colour
"""

import io
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join(ROOT, "res")
FONT_DIR = os.path.join(ROOT, "packages", "matrix-react-sdk", "res", "fonts", "Inter")

# ----------------------------------------------------------------------------------------------------------------------
# Brand
# ----------------------------------------------------------------------------------------------------------------------
NAVY = "#0B1C3D"
TEAL = "#00BFA5"
SURFACE = "#F4F6FB"  # Android launcher / Play icon background, web manifest background_color
INK2 = "#4B5C56"  # marketing site secondary text

# Landing-page gradient (spec 06 section 3.3), stops are (position, colour)
GRADIENT_LIGHT = [(0.0, "#EAF8F3"), (0.20, "#74D2BC"), (0.40, "#E2F6EF"), (0.62, "#9FE2D3"), (1.0, "#F4FBF9")]

# The mark, in a 1024 x 1024 design space (geometry of clarivahub.com/favicon.svg): two overlapping flat speech
# bubbles (navy at the back, teal in front) and a white-ringed "eye" with a navy pupil on the front bubble.
MARK_BACK = (
    "M 230 250 L 540 250 Q 605 250 605 315 L 605 470 Q 605 535 540 535 L 425 535 L 380 595 L 380 535 "
    "L 230 535 Q 165 535 165 470 L 165 315 Q 165 250 230 250 Z"
)
MARK_FRONT = (
    "M 484 420 L 794 420 Q 859 420 859 485 L 859 690 Q 859 755 794 755 L 590 755 L 545 815 L 545 755 "
    "L 484 755 Q 419 755 419 690 L 419 485 Q 419 420 484 420 Z"
)
MARK_EYE = (540, 510, 32, 13)  # cx, cy, ring radius, pupil radius
MARK_BBOX = (165, 250, 859, 815)  # x0, y0, x1, y1 of the glyph
MARK_W = MARK_BBOX[2] - MARK_BBOX[0]  # 694
MARK_H = MARK_BBOX[3] - MARK_BBOX[1]  # 565
MARK_CX = (MARK_BBOX[0] + MARK_BBOX[2]) / 2  # 512
MARK_CY = (MARK_BBOX[1] + MARK_BBOX[3]) / 2  # 532.5


def hex_rgb(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# ----------------------------------------------------------------------------------------------------------------------
# Tiny path parser (M, L, Q, Z absolute only: that is all the mark uses) + rasteriser
# ----------------------------------------------------------------------------------------------------------------------
def flatten(path, steps=24):
    toks = path.replace(",", " ").split()
    pts, i, cur = [], 0, (0.0, 0.0)
    while i < len(toks):
        c = toks[i]
        if c == "M" or c == "L":
            cur = (float(toks[i + 1]), float(toks[i + 2]))
            pts.append(cur)
            i += 3
        elif c == "Q":
            cx, cy = float(toks[i + 1]), float(toks[i + 2])
            ex, ey = float(toks[i + 3]), float(toks[i + 4])
            for s in range(1, steps + 1):
                t = s / steps
                x = (1 - t) ** 2 * cur[0] + 2 * (1 - t) * t * cx + t * t * ex
                y = (1 - t) ** 2 * cur[1] + 2 * (1 - t) * t * cy + t * t * ey
                pts.append((x, y))
            cur = (ex, ey)
            i += 5
        elif c == "Z":
            i += 1
        else:
            raise ValueError("unsupported path command " + c)
    return pts


BACK_PTS = flatten(MARK_BACK)
FRONT_PTS = flatten(MARK_FRONT)


def mark_layer(width, height, mark_w, cx=None, cy=None, ss=4):
    """Transparent RGBA layer of size (width, height) with the mark, `mark_w` px wide, centred on (cx, cy)."""
    cx = width / 2 if cx is None else cx
    cy = height / 2 if cy is None else cy
    s = mark_w / MARK_W  # output px per design unit
    big = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)

    def tx(p):
        return ((cx + (p[0] - MARK_CX) * s) * ss, (cy + (p[1] - MARK_CY) * s) * ss)

    d.polygon([tx(p) for p in BACK_PTS], fill=hex_rgb(NAVY))
    d.polygon([tx(p) for p in FRONT_PTS], fill=hex_rgb(TEAL))
    ex, ey = tx((MARK_EYE[0], MARK_EYE[1]))
    for r, col in ((MARK_EYE[2], "#FFFFFF"), (MARK_EYE[3], NAVY)):
        rr = r * s * ss
        d.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], fill=hex_rgb(col))
    return big.resize((width, height), Image.LANCZOS)


def on_surface(width, height, mark_w, bg=SURFACE, cx=None, cy=None):
    img = Image.new("RGBA", (width, height), hex_rgb(bg))
    img.alpha_composite(mark_layer(width, height, mark_w, cx, cy))
    return img


def rounded_mask(size_xy, radius, ss=4):
    w, h = size_xy
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=radius * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def glass_tile(canvas, tile, mark_frac=0.52, dy=0):
    """Square RGBA canvas with a white rounded 'glass' tile (Android ElementLogoAtom look), soft shadow and the mark."""
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    radius = tile * 0.275  # 33 / 120 in the Android spec
    x0 = (canvas - tile) // 2
    y0 = (canvas - tile) // 2 + dy
    mask = rounded_mask((tile, tile), radius)
    # shadow: offset down 8/120, blur 32/120, #1B1D22 at 25 %
    shadow = Image.new("L", (canvas, canvas), 0)
    shadow.paste(mask, (x0, y0 + int(tile * 0.067)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(tile * 0.07)).point(lambda v: int(v * 0.30))
    sh = Image.new("RGBA", (canvas, canvas), (27, 29, 34, 0))
    sh.putalpha(shadow)
    img.alpha_composite(sh)
    # tile fill (near-opaque white so it reads on the pale error-page background) + hairline border
    fill = Image.new("RGBA", (tile, tile), (255, 255, 255, 245))
    img.paste(fill, (x0, y0), mask)
    border = Image.new("RGBA", (tile, tile), (200, 214, 224, 255))
    inner = Image.new("L", (tile, tile), 0)
    inner.paste(rounded_mask((tile - 2, tile - 2), radius - 1), (1, 1))
    img.paste(border, (x0, y0), ImageChops.subtract(mask, inner))
    # mark
    img.alpha_composite(mark_layer(canvas, canvas, tile * mark_frac, canvas / 2, canvas / 2 + dy))
    return img


def gradient(width, height, stops):
    img = Image.new("RGB", (1, height))
    px = img.load()
    cols = [(p, hex_rgb(c)[:3]) for p, c in stops]
    for y in range(height):
        t = y / max(1, height - 1)
        for (p0, c0), (p1, c1) in zip(cols, cols[1:]):
            if p0 <= t <= p1:
                f = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                px[0, y] = tuple(int(round(c0[k] + (c1[k] - c0[k]) * f)) for k in range(3))
                break
    return img.resize((width, height), Image.NEAREST).convert("RGBA")


def font(weight, size):
    path = os.path.join(FONT_DIR, "Inter-%s.woff" % weight)
    return ImageFont.truetype(path, size)


def save_png(img, rel, opaque=False):
    """`opaque=True` stores an RGB PNG (no alpha channel), which iOS prefers for apple-touch icons."""
    path = os.path.join(RES, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if opaque:
        img = img.convert("RGB")
    img.save(path, "PNG", optimize=True)
    print("wrote", rel, img.size)


def write_text(rel, text):
    path = os.path.join(RES, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote", rel)


# ----------------------------------------------------------------------------------------------------------------------
# SVG outputs
# ----------------------------------------------------------------------------------------------------------------------
def mark_svg_group(indent="  "):
    ex, ey, r, p = MARK_EYE
    return (
        f'{indent}<path d="{MARK_BACK}" fill="{NAVY}"/>\n'
        f'{indent}<path d="{MARK_FRONT}" fill="{TEAL}"/>\n'
        f'{indent}<circle cx="{ex}" cy="{ey}" r="{r}" fill="#FFFFFF"/>\n'
        f'{indent}<circle cx="{ex}" cy="{ey}" r="{p}" fill="{NAVY}"/>\n'
    )


def make_svgs():
    scale = 1.15  # mark = 78 % of the canvas width
    logo = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 1024 1024" fill="none">\n'
        "  <title>Clariva</title>\n"
        f'  <g transform="translate(512 512) scale({scale}) translate(-{MARK_CX:g} -{MARK_CY:g})">\n'
        + mark_svg_group("    ")
        + "  </g>\n</svg>\n"
    )
    write_text("themes/clariva/img/logos/clariva-logo.svg", logo)

    icon = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">\n'
        "  <title>Clariva</title>\n"
        f'  <rect width="1024" height="1024" fill="{SURFACE}"/>\n'
        f'  <g transform="translate(512 512) scale(0.915) translate(-{MARK_CX:g} -{MARK_CY:g})">\n'
        + mark_svg_group("    ")
        + "  </g>\n</svg>\n"
    )
    write_text("vector-icons/clariva-icon.svg", icon)


# ----------------------------------------------------------------------------------------------------------------------
# Raster outputs
# ----------------------------------------------------------------------------------------------------------------------
def square_icon(size):
    frac = 0.74 if size <= 50 else 0.62
    return on_surface(size, size, size * frac)


def wide_icon(w, h):
    return on_surface(w, h, h * 0.62 * (MARK_W / MARK_H))


def make_icons():
    for s in (24, 44, 50, 76, 88, 120, 150, 152, 180, 300, 1024):
        save_png(square_icon(s), f"vector-icons/{s}.png")
    save_png(wide_icon(620, 300), "vector-icons/620x300.png")
    save_png(wide_icon(1240, 600), "vector-icons/1240x600.png")
    for s in (57, 60, 72, 76, 114, 120, 144, 152, 180):
        save_png(on_surface(s, s, s * 0.62), f"vector-icons/apple-touch-icon-{s}.png", opaque=True)  # iOS: opaque square
    for s in (70, 150, 310):
        save_png(on_surface(s, s, s * 0.6), f"vector-icons/mstile-{s}.png")
    save_png(wide_icon(310, 150), "vector-icons/mstile-310x150.png")

    # favicon.ico: rounded #F4F6FB tile + mark (like clarivahub.com/favicon.svg). The tile keeps the navy bubble visible on
    # dark browser chrome, where a bare transparent mark would disappear.
    ico_src = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    ico_src.paste(Image.new("RGBA", (512, 512), hex_rgb(SURFACE)), (0, 0), rounded_mask((512, 512), 512 * 0.2))
    ico_src.alpha_composite(mark_layer(512, 512, 512 * 0.74))
    path = os.path.join(RES, "vector-icons", "favicon.ico")
    ico_src.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote vector-icons/favicon.ico")

    write_text(
        "vector-icons/browserconfig.xml",
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<browserconfig>\n"
        "  <msapplication>\n"
        "    <tile>\n"
        '      <square70x70logo src="/vector-icons/mstile-70.png"/>\n'
        '      <square150x150logo src="/vector-icons/mstile-150.png"/>\n'
        '      <square310x310logo src="/vector-icons/mstile-310.png"/>\n'
        '      <wide310x150logo src="/vector-icons/mstile-310x150.png"/>\n'
        f"      <TileColor>{TEAL}</TileColor>\n"
        "    </tile>\n"
        "  </msapplication>\n"
        "</browserconfig>\n",
    )


def make_logos():
    save_png(glass_tile(320, 240, 0.55), "themes/clariva/img/logos/clariva-app-logo.png")

    # Open Graph card 1200 x 630: landing-page gradient, glass tile with the mark, wordmark + tagline.
    w, h = 1200, 630
    og = gradient(w, h, GRADIENT_LIGHT)
    tile = glass_tile(380, 280, 0.55)
    og.alpha_composite(tile, (100, (h - 380) // 2))
    d = ImageDraw.Draw(og)
    x = 520
    d.text((x, 205), "Clariva", font=font("Bold", 124), fill=hex_rgb(NAVY))
    d.text((x, 360), "Private conversations.", font=font("Medium", 40), fill=hex_rgb(INK2))
    d.text((x, 412), "Real value.", font=font("Medium", 40), fill=hex_rgb(INK2))
    d.text((x, 520), "clarivahub.com", font=font("SemiBold", 28), fill=hex_rgb("#0C5F4E"))
    save_png(og, "themes/clariva/img/logos/opengraph.png", opaque=True)


if __name__ == "__main__":
    if not os.path.isdir(RES):
        sys.exit("res/ not found next to the scripts/ directory")
    make_svgs()
    make_icons()
    make_logos()
