#!/usr/bin/env python3
"""
Luxe Vault brand assets — every icon, avatar and logo file, from one geometry.

The LV monogram is defined once below (Didone contrast: heavy stems, hairline
serifs, in #D4AF37 gold on #000000), and this script writes everything derived
from it, so no file can drift from another:

  app/favicon.ico                  16/32/48 px, heavy strokes, rounded tile
  app/icon.svg                     scalable tab icon (modern browsers)
  app/apple-icon.png               180x180, opaque — iOS home screen
  public/icons/icon-192.png        web manifest, purpose "any"
  public/icons/icon-512.png        web manifest, purpose "any"
  public/icons/icon-maskable-512.png  web manifest, purpose "maskable"
  public/brand/lv-monogram.svg     transparent master, for dark backgrounds
  public/brand/lv-monogram-black.svg  on a black square (social profiles)
  public/email/avatar-512.png      sender avatar (Gravatar, Google account)
  public/email/avatar-1024.png     the same, for services that want 1024
  public/bimi/luxe-vault.svg       BIMI logo, SVG Tiny Portable/Secure
  lib/brand/monogram.generated.ts  the paths for next/og (preview cards)

Run from anywhere:   python scripts/brand/generate_brand_assets.py
Requires Pillow:     pip install pillow
"""
from __future__ import annotations

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


def monogram(stem: float, hair: float) -> List[Shape]:
    """The LV monogram on the 512 grid, centred.

    `stem` is the heavy stroke, `hair` the hairline — the Didone contrast of
    the site's Bodoni headlines. A heavier pair is used for favicons, where a
    true hairline would be thinner than a pixel and vanish.
    """
    top, base = 146.0, 366.0
    lx = 118.0
    foot_end = lx + stem + 76
    shapes: List[Shape] = [
        _rect(lx, top, lx + stem, base),                    # L stem
        _rect(lx - 16, top, lx + stem + 16, top + hair),    # L head serif
        _rect(lx - 16, base - hair, foot_end, base),        # L foot
        _rect(foot_end - hair, base - 50, foot_end, base),  # L foot terminal
    ]
    x0 = foot_end + 20           # V's heavy arm, top-left
    thick = stem + 2
    ax = x0 + thick + 50         # the V's point
    x1 = x0 + 150                # V's hairline arm, top-left
    shapes += [
        [(x0, top + hair), (x0 + thick, top + hair), (ax, base), (ax - thick * 0.6, base)],
        [(x1, top + hair), (x1 + hair, top + hair), (ax, base), (ax - hair * 1.2, base)],
        _rect(x0 - 18, top, x0 + thick + 18, top + hair),   # V left serif
        _rect(x1 - 16, top, x1 + hair + 16, top + hair),    # V right serif
    ]
    xs = [x for s in shapes for x, _ in s]
    ys = [y for s in shapes for _, y in s]
    dx = CANVAS / 2 - (min(xs) + max(xs)) / 2
    dy = CANVAS / 2 - (min(ys) + max(ys)) / 2
    return [[(x + dx, y + dy) for x, y in s] for s in shapes]


REGULAR = monogram(stem=42, hair=8)
BOLD = monogram(stem=60, hair=22)


def place(shapes: List[Shape], scale: float, size: float) -> List[Shape]:
    """Scales the 512-grid shapes about the centre into a `size` square."""
    k = scale * size / CANVAS
    c = size / 2
    return [[((x - CANVAS / 2) * k + c, (y - CANVAS / 2) * k + c) for x, y in s] for s in shapes]


# ----------------------------------------------------------------- output --

def raster(size: int, shapes: List[Shape], scale: float, tile: str, radius: float = 0.0) -> Image.Image:
    """The monogram as a `size`-pixel image. tile: 'square' (opaque, full
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

    written.append(write('public/brand/lv-monogram.svg', (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<title>Luxe Vault</title>'
        f'<path fill="{GOLD_HEX}" d="{path_d(REGULAR)}"/>'
        '</svg>\n'
    )))
    written.append(write('public/brand/lv-monogram-black.svg', (
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
        "/** The LV monogram, centred in a 512x512 box. Didone contrast, for large sizes. */\n"
        "export const MONOGRAM_PATH = '__REGULAR__'\n\n"
        "/** Heavier strokes for small sizes, where a hairline would vanish. */\n"
        "export const MONOGRAM_BOLD_PATH = '__BOLD__'\n\n"
        "/** A standalone SVG of the monogram: gold by default, optionally on a background. */\n"
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
