#!/usr/bin/env python3
"""
Luxe Vault brand assets — every icon, avatar and logo file, from one geometry.

The mark is defined once below — a solid gold keyhole on black, #D4AF37 on
#000000 — and this script writes everything derived from it, so no file can
drift from another.

It replaced an "LV" letter monogram (2026-10): for a shop that sells replicas
of designer goods, two serif capitals L and V in gold read as a reference to a
fashion house's trade mark. A keyhole says "vault" and nothing else.

  app/favicon.ico                  16/32/48 px, heavy strokes, rounded tile
  app/icon.svg                     scalable tab icon (modern browsers)
  app/apple-icon.png               180x180, opaque — iOS home screen
  public/icons/icon-192.png        web manifest, purpose "any"
  public/icons/icon-512.png        web manifest, purpose "any"
  public/icons/icon-maskable-512.png  web manifest, purpose "maskable"
  public/brand/luxe-vault-mark.svg       transparent master, for dark backgrounds
  public/brand/luxe-vault-mark-black.svg on a black square (social profiles)
  public/email/avatar-512.png      sender avatar (Gravatar, Google account)
  public/email/avatar-1024.png     the same, for services that want 1024
  public/bimi/luxe-vault.svg       BIMI logo, SVG Tiny Portable/Secure
  lib/brand/monogram.generated.ts  the paths for next/og (preview cards)

Run from anywhere:   python scripts/brand/generate_brand_assets.py
Requires Pillow:     pip install pillow
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]

GOLD_HEX = '#D4AF37'
BLACK_HEX = '#000000'
GOLD = (212, 175, 55, 255)
BLACK = (0, 0, 0, 255)

CANVAS = 512          # the design grid every shape is drawn in
SUPERSAMPLE = 8       # rasterise at 8x, then downsample: clean anti-aliasing

Point = Tuple[float, float]
Shape = List[Point]


# --------------------------------------------------------------- geometry --

def _rect(x0: float, y0: float, x1: float, y1: float) -> Shape:
    # Clockwise, like every shape here, so the SVG path's nonzero fill is a
    # plain union of the pieces.
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _circle(cx: float, cy: float, r: float, steps: int = 96) -> Shape:
    """A circle as a clockwise polygon (y grows downwards on screen)."""
    return [
        (cx + r * math.cos(2 * math.pi * i / steps), cy + r * math.sin(2 * math.pi * i / steps))
        for i in range(steps)
    ]


def keyhole(radius: float, neck: float, foot: float, height: float) -> List[Shape]:
    """The mark: a keyhole on the 512 grid, centred.

    A round head and a stem that widens towards its foot — the classic
    escutcheon outline, drawn as two solid shapes so the fill needs no holes.
    `neck` and `foot` are the stem's widths where it leaves the head and at
    the bottom; a heavier set is used for favicons, where 16 px must still
    read as a keyhole.
    """
    cy = 0.0
    top = cy + radius * 0.55          # the stem starts inside the head
    base = cy + radius + height
    shapes: List[Shape] = [
        _circle(0.0, cy, radius),
        [(-neck / 2, top), (neck / 2, top), (foot / 2, base), (-foot / 2, base)],
    ]
    ys = [y for s in shapes for _, y in s]
    dx = CANVAS / 2
    dy = CANVAS / 2 - (min(ys) + max(ys)) / 2
    return [[(x + dx, y + dy) for x, y in s] for s in shapes]


REGULAR = keyhole(radius=66, neck=40, foot=104, height=150)
BOLD = keyhole(radius=86, neck=62, foot=150, height=150)


def place(shapes: List[Shape], scale: float, size: float) -> List[Shape]:
    """Scales the 512-grid shapes about the centre into a `size` square."""
    k = scale * size / CANVAS
    c = size / 2
    return [[((x - CANVAS / 2) * k + c, (y - CANVAS / 2) * k + c) for x, y in s] for s in shapes]


# ----------------------------------------------------------------- output --

def raster(size: int, shapes: List[Shape], scale: float, tile: str, radius: float = 0.0) -> Image.Image:
    """The mark as a `size`-pixel image. tile: 'square' (opaque, full
    bleed) or 'rounded' (rounded black tile, transparent corners)."""
    big = size * SUPERSAMPLE
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if tile == 'square':
        draw.rectangle([0, 0, big, big], fill=BLACK)
    else:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * big, fill=BLACK)
    for shape in place(shapes, scale, big):
        draw.polygon(shape, fill=GOLD)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def path_d(shapes: List[Shape], scale: float = 1.0) -> str:
    def n(v: float) -> str:
        return f'{round(v, 2):g}'
    parts = []
    for shape in place(shapes, scale, CANVAS):
        (fx, fy), rest = shape[0], shape[1:]
        parts.append(f'M{n(fx)} {n(fy)}' + ''.join(f'L{n(x)} {n(y)}' for x, y in rest) + 'Z')
    return ''.join(parts)


def write(rel: str, data) -> Path:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, Image.Image):
        data.save(path, optimize=True)
    else:
        path.write_text(data, encoding='utf-8', newline='\n')
    return path


def main() -> None:
    written: List[Path] = []

    # Browser tabs. Heavy strokes on a rounded black tile: readable at 16 px
    # on both light and dark tab bars.
    frames = [raster(s, BOLD, 1.0, 'rounded', 0.22) for s in (16, 32, 48)]
    ico = ROOT / 'app' / 'favicon.ico'
    frames[-1].save(ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=frames[:-1])
    written.append(ico)

    written.append(write('app/icon.svg', (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" rx="112" fill="{BLACK_HEX}"/>'
        f'<path fill="{GOLD_HEX}" d="{path_d(BOLD)}"/>'
        '</svg>\n'
    )))

    # Home screens. Opaque full-bleed squares — iOS and Android apply their
    # own corner masks, and iOS renders transparency as black anyway.
    written.append(write('app/apple-icon.png', raster(180, REGULAR, 0.86, 'square').convert('RGB')))
    written.append(write('public/icons/icon-192.png', raster(192, REGULAR, 0.86, 'square').convert('RGB')))
    written.append(write('public/icons/icon-512.png', raster(512, REGULAR, 0.86, 'square').convert('RGB')))
    # Maskable: the mark inside the central 80% safe zone, which survives
    # Android's circle, squircle and teardrop masks.
    written.append(write('public/icons/icon-maskable-512.png', raster(512, REGULAR, 0.66, 'square').convert('RGB')))

    # Sender avatars. Inboxes crop them to a circle: the mark sits well inside.
    written.append(write('public/email/avatar-512.png', raster(512, REGULAR, 0.72, 'square').convert('RGB')))
    written.append(write('public/email/avatar-1024.png', raster(1024, REGULAR, 0.72, 'square').convert('RGB')))

    written.append(write('public/brand/luxe-vault-mark.svg', (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>Luxe Vault</title>'
        f'<path fill="{GOLD_HEX}" d="{path_d(REGULAR)}"/>'
        '</svg>\n'
    )))
    written.append(write('public/brand/luxe-vault-mark-black.svg', (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>Luxe Vault</title>'
        f'<rect width="512" height="512" fill="{BLACK_HEX}"/>'
        f'<path fill="{GOLD_HEX}" d="{path_d(REGULAR, 0.86)}"/>'
        '</svg>\n'
    )))

    # BIMI: SVG Tiny Portable/Secure — version 1.2, baseProfile tiny-ps, a
    # <title>, a square viewBox, no x/y on the root, no text, scripts, images
    # or external references, a solid background, under 32 KB. Mail clients
    # show it in a circle, so the mark sits inside the circle's safe zone.
    written.append(write('public/bimi/luxe-vault.svg', (
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 512 512">'
        '<title>Luxe Vault</title>'
        f'<rect width="512" height="512" fill="{BLACK_HEX}"/>'
        f'<path fill="{GOLD_HEX}" d="{path_d(REGULAR, 0.78)}"/>'
        '</svg>\n'
    )))

    ts = (
        '// GENERATED by scripts/brand/generate_brand_assets.py — do not edit by hand.\n'
        '// Change the geometry there and re-run it; every icon is rewritten with it.\n\n'
        "/** The Luxe Vault mark (a keyhole), centred in a 512x512 box. */\n"
        "export const MONOGRAM_PATH = '__REGULAR__'\n\n"
        "/** A heavier cut for small sizes (favicons). */\n"
        "export const MONOGRAM_BOLD_PATH = '__BOLD__'\n\n"
        "/** A standalone SVG of the mark: gold by default, optionally on a background. */\n"
        "export function monogramSvg(opts: { fill?: string; background?: string } = {}): string {\n"
        "  const fill = opts.fill ?? '__GOLD__'\n"
        "  const ground = opts.background ? `<rect width=\"512\" height=\"512\" fill=\"${opts.background}\"/>` : ''\n"
        "  return `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">${ground}<path fill=\"${fill}\" d=\"${MONOGRAM_PATH}\"/></svg>`\n"
        "}\n"
    ).replace('__REGULAR__', path_d(REGULAR)).replace('__BOLD__', path_d(BOLD)).replace('__GOLD__', GOLD_HEX)
    written.append(write('lib/brand/monogram.generated.ts', ts))

    for path in written:
        print(f'{path.relative_to(ROOT).as_posix():40s} {path.stat().st_size:>7,d} bytes')


if __name__ == '__main__':
    main()
