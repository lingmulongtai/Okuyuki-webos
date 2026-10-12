#!/usr/bin/env python3
"""Draw the launcher icons for both apps (80x80 and 130x130, as webOS expects)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def icon(size, text, accent):
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


def main():
    targets = [
        (ROOT / "apps" / "still4k", "4K", (74, 168, 255, 255)),
        (ROOT / "apps" / "tv" / "webos-meta", "Ok", (255, 176, 64, 255)),
    ]
    for directory, text, accent in targets:
        directory.mkdir(parents=True, exist_ok=True)
        icon(80, text, accent).save(directory / "icon.png")
        icon(130, text, accent).save(directory / "largeIcon.png")


if __name__ == "__main__":
    main()
