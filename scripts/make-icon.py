"""Generates the PLACEHOLDER app icon (build/icon.png 1024px + build/icon.ico multi-size): a tile in BAND's green
(#92ED92) with a lower-case j in BAND's ink (#001319). It is this build's own drawing, not BAND's logo; the mark inside
the app is BAND's mascot (src/renderer/src/components/jam-mascot.tsx).

Usage: python scripts/make-icon.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
SIZE = 1024
SCALE = 4  # draw large, downsample for smooth edges
GREEN = (146, 237, 146, 255)
INK = (0, 19, 25, 255)


def render(size: int) -> Image.Image:
    big = size * SCALE
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # The mark lives on the SVG's 28-unit grid: tile x=2..26 radius 7, dot at (16.5, 8.6) r=1.9, stem from y=12.4 to 18.5
    # curving to (9.6, 21.4), stroke 2.6.
    unit = big / 28

    def p(v: float) -> float:
        return v * unit

    draw.rounded_rectangle((p(2), p(2), p(26), p(26)), radius=round(p(7)), fill=GREEN)
    r = p(1.9)
    draw.ellipse((p(16.5) - r, p(8.6) - r, p(16.5) + r, p(8.6) + r), fill=INK)
    stroke = round(p(2.6))
    draw.line((p(16.5), p(12.4), p(16.5), p(18.5)), fill=INK, width=stroke)
    # the hook: a quarter arc from the stem's foot round to the left
    draw.arc((p(16.5) - p(7.8), p(18.5) - p(4.0), p(16.5), p(18.5) + p(4.0)), start=0, end=120, fill=INK, width=stroke)
    cap = stroke / 2
    draw.ellipse((p(16.5) - cap, p(12.4) - cap, p(16.5) + cap, p(12.4) + cap), fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    icon = render(SIZE)
    icon.save(BUILD / 'icon.png')
    icon.save(BUILD / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('wrote', BUILD / 'icon.png', 'and', BUILD / 'icon.ico')


if __name__ == '__main__':
    main()
