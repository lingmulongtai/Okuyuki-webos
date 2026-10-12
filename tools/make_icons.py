#!/usr/bin/env python3
"""Draw the launcher icons for both apps (80x80 and 130x130, as webOS expects) and the TV app's
splash screen (1920x1080)."""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# The brand, as in the phone app's launcher icon: two squares overlapping in depth on the tile
# colour, the shared part cut out to the background.
TILE = (20, 24, 33)  # #141821, also the app tile colour (iconColor) in appinfo.json
INK = (11, 13, 18)  # #0B0D12, the TV app's background
BLUE = (39, 71, 230)  # #2747E6
EMBER = (232, 96, 63)  # #E8603F


def test_icon(size, text, accent):
    scale = 4
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big // 5, fill=(16, 20, 24, 255))
    draw.rounded_rectangle((big * 0.12, big * 0.72, big * 0.88, big * 0.78), radius=big // 40, fill=accent)
    font = ImageFont.truetype(FONT, int(big * 0.42))
    box = draw.textbbox((0, 0), text, font=font)
    x = (big - (box[2] - box[0])) / 2 - box[0]
    y = big * 0.40 - (box[3] - box[1]) / 2 - box[1]
    draw.text((x, y), text, font=font, fill=(242, 242, 242, 255))
    return image.resize((size, size), Image.LANCZOS)


def draw_mark(image, left, top, size, background):
    """The mark in a `size` square at (left, top): back square, front square, then the overlap."""
    side = size * 34 / 46
    offset = size * 12 / 46
    radius = size * 5.4 / 46

    def square(x, y):
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((x, y, x + side, y + side), radius=radius, fill=255)
        return mask

    back = square(left, top)
    front = square(left + offset, top + offset)
    image.paste(BLUE, (0, 0), back)
    image.paste(EMBER, (0, 0), front)
    image.paste(background, (0, 0), ImageChops.multiply(back, front))


def brand_icon(size):
    # The tile colour fills the whole square, so the icon blends into the tile whatever its shape.
    scale = 8
    big = size * scale
    image = Image.new("RGB", (big, big), TILE)
    mark = big * 0.58
    draw_mark(image, (big - mark) / 2, (big - mark) / 2, mark, TILE)
    return image.resize((size, size), Image.LANCZOS)


def splash():
    # The mark alone on the app's own background, so the first screen follows without a jump.
    scale = 4
    width, height = 1920, 1080
    image = Image.new("RGB", (width * scale, height * scale), INK)
    mark = 216 * scale
    draw_mark(image, (width * scale - mark) / 2, (height * scale - mark) / 2, mark, INK)
    return image.resize((width, height), Image.LANCZOS)


def main():
    still4k = ROOT / "apps" / "still4k"
    still4k.mkdir(parents=True, exist_ok=True)
    test_icon(80, "4K", (74, 168, 255, 255)).save(still4k / "icon.png")
    test_icon(130, "4K", (74, 168, 255, 255)).save(still4k / "largeIcon.png")

    tv = ROOT / "apps" / "tv" / "webos-meta"
    tv.mkdir(parents=True, exist_ok=True)
    brand_icon(80).save(tv / "icon.png", optimize=True)
    brand_icon(130).save(tv / "largeIcon.png", optimize=True)
    splash().save(tv / "splash.png", optimize=True)


if __name__ == "__main__":
    main()
