#!/usr/bin/env python3
"""Turn your own photos into the files the 4K still test reads from a PC.

Usage: python3 tools/still4k/convert.py OUTPUT_DIR PHOTO_OR_FOLDER [...]

Folders and wildcards (also on Windows) are expanded to the photos inside them.
For every photo this writes NAME.mp4 (an HEVC Main 10 still that fits inside 3840x2160) and
NAME.jpg (fits inside 1920x1080), then updates OUTPUT_DIR/list.json for serve.mjs.
HEIC files need pillow-heif (python3 -m pip install pillow-heif).
HDR gain maps are not applied here: this tool only compares SDR sharpness.
"""
import glob
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_assets import hevc  # noqa: E402

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    register_heif_opener = None


PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def photos(arguments):
    for argument in arguments:
        matches = glob.glob(argument) or [argument]
        for match in sorted(matches):
            path = Path(match)
            if path.is_dir():
                yield from sorted(p for p in path.iterdir() if p.suffix.lower() in PHOTO_SUFFIXES)
            else:
                yield path


def fit(image, width, height):
    scale = min(width / image.width, height / image.height, 1.0)
    # HEVC 4:2:0 needs even dimensions.
    size = (max(2, int(image.width * scale) // 2 * 2), max(2, int(image.height * scale) // 2 * 2))
    return image if size == image.size else image.resize(size, Image.LANCZOS)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    listing = out / "list.json"
    entries = json.loads(listing.read_text(encoding="utf-8")) if listing.exists() else []
    by_name = {entry["name"]: entry for entry in entries}
    for source in photos(sys.argv[2:]):
        if source.suffix.lower() in (".heic", ".heif") and register_heif_opener is None:
            print(f"skip {source.name}: install pillow-heif to read HEIC")
            continue
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        stem = source.stem
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "frame.png"
            fit(image, 3840, 2160).save(png)
            hevc(png, out / f"{stem}.mp4", crf=14)
        fit(image, 1920, 1080).save(out / f"{stem}.jpg", quality=92)
        by_name[stem] = {"name": stem, "still": f"{stem}.mp4", "jpeg": f"{stem}.jpg"}
        print(f"converted {source.name}")
    listing.write_text(json.dumps(list(by_name.values()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
