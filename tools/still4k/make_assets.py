#!/usr/bin/env python3
"""Generate the test charts, synthetic photos and still videos for the 4K still test app.

Usage: python3 tools/still4k/make_assets.py [output-dir]

Needs numpy, Pillow (with AVIF support) and ffmpeg with libx265, libx264 and libsvtav1.
Every asset is synthetic, so nothing personal ever ends up in the package.
"""
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 3840, 2160
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "apps" / "still4k" / "assets"

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def font(size):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------- SDR chart

def line_pairs(width, height, period, vertical):
    axis = np.arange(width if vertical else height)
    on = (axis // (period // 2)) % 2 == 0
    if vertical:
        return np.broadcast_to(on[None, :], (height, width))
    return np.broadcast_to(on[:, None], (height, width))


def zone_plate(size):
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    r2 = (x - size / 2) ** 2 + (y - size / 2) ** 2
    # Spatial frequency reaches Nyquist (0.5 cycles/pixel) at the edge of the plate.
    k = math.pi / size
    return 0.5 + 0.5 * np.cos(k * r2)


def sdr_chart():
    img = np.full((H, W, 3), 40, np.uint8)

    def put(mask, x, y, on=255, off=0):
        h, w = mask.shape[:2]
        block = np.where(mask[..., None], on, off).astype(np.uint8)
        img[y:y + h, x:x + w] = block

    size = 600
    put(line_pairs(size, size, 2, True), 120, 200)
    put(line_pairs(size, size, 2, False), 840, 200)
    checker = (np.indices((size, size)).sum(axis=0) % 2) == 0
    put(checker, 1560, 200)
    put(line_pairs(size, size, 4, True), 2280, 200)
    plate = (zone_plate(size) * 255).astype(np.uint8)
    img[200:200 + size, 3000:3000 + size] = plate[..., None]

    # Gray ramp and color bars to look at banding and color handling.
    ramp = np.linspace(0, 255, 1680).astype(np.uint8)
    img[960:1160, 2040:3720] = ramp[None, :, None]
    bars = [(235, 235, 235), (235, 235, 16), (16, 235, 235), (16, 235, 16),
            (235, 16, 235), (235, 16, 16), (16, 16, 235), (16, 16, 16)]
    bar_w = 1680 // len(bars)
    for i, color in enumerate(bars):
        img[1260:1560, 2040 + i * bar_w:2040 + (i + 1) * bar_w] = color

    # One-pixel frame on the outermost pixels: all four edges must be visible at 4K.
    img[0, :] = img[-1, :] = 255
    img[:, 0] = img[:, -1] = 255

    pil = Image.fromarray(img)
    draw = ImageDraw.Draw(pil)
    label = font(40)
    for x, text in [(120, "1 px vertical"), (840, "1 px horizontal"), (1560, "1 px checker"),
                    (2280, "2 px vertical"), (3000, "zone plate")]:
        draw.text((x, 140), text, font=label, fill=(255, 255, 255))
    draw.text((2040, 900), "gray ramp 0-255", font=label, fill=(255, 255, 255))
    draw.rectangle((120, 960, 1900, 1560), fill=(0, 0, 0))
    y = 990
    for size_px in (12, 16, 20, 28, 40):
        draw.text((150, y), f"{size_px}px  The quick brown fox jumps over the lazy dog 0123456789",
                  font=font(size_px), fill=(255, 255, 255))
        y += size_px + 60
    title = font(72)
    draw.text((120, 1700), "If the 1 px blocks look gray, this is the 1920x1080 graphics plane.",
              font=title, fill=(255, 255, 255))
    draw.text((120, 1810), "If they show sharp lines, this is the 3840x2160 video plane.",
              font=title, fill=(255, 255, 255))
    draw.text((120, 1960), "Okuyuki 4K still test  3840 x 2160", font=font(56), fill=(180, 180, 180))
    return pil


# ---------------------------------------------------------------- photos

def mandelbrot(cx, cy, scale, iterations=160):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    c = (xs - W / 2) * scale / W + cx + 1j * ((ys - H / 2) * scale / W + cy)
    z = np.zeros_like(c)
    smooth = np.zeros(c.shape, np.float64)
    alive = np.ones(c.shape, bool)
    for n in range(iterations):
        z[alive] = z[alive] * z[alive] + c[alive]
        escaped = alive & (np.abs(z) > 4)
        smooth[escaped] = n + 1 - np.log2(np.log2(np.abs(z[escaped])))
        alive &= ~escaped
        if not alive.any():
            break
    smooth[alive] = 0
    return smooth


def palette(values, phase):
    t = values * 0.05 + phase
    rgb = np.stack([0.5 + 0.5 * np.cos(2 * np.pi * (t + o)) for o in (0.0, 0.33, 0.67)], axis=-1)
    rgb[values == 0] = 0
    return (rgb * 255).astype(np.uint8)


PHOTO_VIEWS = [
    (-0.743643887, 0.131825904, 0.012),
    (-0.7453, 0.1127, 0.0065),
    (-1.25066, 0.02012, 0.0017),
    (-0.16, 1.0405, 0.026),
    (0.2549, 0.0005, 0.005),
    (-0.0452, 0.9868, 0.004),
]


def photo(index):
    cx, cy, scale = PHOTO_VIEWS[index]
    pil = Image.fromarray(palette(mandelbrot(cx, cy, scale), index * 0.17))
    draw = ImageDraw.Draw(pil)
    draw.text((140, 120), str(index + 1), font=font(420), fill=(255, 255, 255), stroke_width=12,
              stroke_fill=(0, 0, 0))
    draw.text((160, 1960), f"Okuyuki still test photo {index + 1}  3840 x 2160", font=font(56),
              fill=(255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0))
    return pil


# ---------------------------------------------------------------- HDR charts

M1, M2 = 2610 / 16384, 2523 / 4096 * 128
C1, C2, C3 = 3424 / 4096, 2413 / 4096 * 32, 2392 / 4096 * 32


def pq_encode(nits):
    y = np.clip(np.asarray(nits, np.float64) / 10000.0, 0, 1)
    return ((C1 + C2 * y ** M1) / (1 + C3 * y ** M1)) ** M2


def hlg_encode(scene):
    e = np.clip(np.asarray(scene, np.float64), 0, 1)
    a, b, c = 0.17883277, 0.28466892, 0.55991073
    return np.where(e <= 1 / 12, np.sqrt(3 * e), a * np.log(np.maximum(12 * e - b, 1e-12)) + c)


def hdr_chart(kind):
    """Return a 16-bit RGB array with BT.2020 primaries and PQ or HLG code values."""
    if kind == "pq":
        encode = pq_encode
        background = encode(5.0)
        ramp_values = np.linspace(0, 1000, 3600)
        patches = [100, 203, 400, 600, 800, 1000]
        patch_labels = [f"{v} nits" for v in patches]
        colors = [(600, 0, 0), (0, 600, 0), (0, 0, 600), (203, 0, 0), (0, 203, 0), (0, 0, 203)]
        caption = "HDR10 (PQ, BT.2020). The patches should keep getting brighter up to 1000 nits."
    else:
        def encode(signal):
            return np.asarray(signal, np.float64)
        background = 0.08
        ramp_values = np.linspace(0, 1, 3600)
        levels = [0.25, 0.5, 0.75, 0.85, 0.95, 1.0]
        patches = levels
        patch_labels = [f"{int(v * 100)}% signal" for v in levels]
        colors = [tuple(float(hlg_encode(x)) for x in rgb) for rgb in
                  [(0.6, 0, 0), (0, 0.6, 0), (0, 0, 0.6), (0.26, 0, 0), (0, 0.26, 0), (0, 0, 0.26)]]
        caption = "HLG (BT.2020). 75% signal is reference white; brighter patches should glow."

    img = np.full((H, W, 3), background, np.float64)
    img[260:560, 120:3720] = encode(ramp_values)[None, :, None]
    for i, value in enumerate(patches):
        x = 120 + i * 610
        img[760:1160, x:x + 540] = encode(value)
    for i, color in enumerate(colors):
        x = 120 + i * 610
        img[1400:1800, x:x + 540] = encode(np.array(color)) if kind == "pq" else np.array(color)

    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    label = font(44)
    draw.text((120, 190), "ramp 0 to 1000 nits" if kind == "pq" else "ramp 0 to 100% signal",
              font=label, fill=255)
    for i, text in enumerate(patch_labels):
        draw.text((120 + i * 610, 1190), text, font=label, fill=255)
    color_names = ["R 600", "G 600", "B 600", "R 203", "G 203", "B 203"] if kind == "pq" else \
        ["R bright", "G bright", "B bright", "R ref", "G ref", "B ref"]
    for i, text in enumerate(color_names):
        draw.text((120 + i * 610, 1830), text, font=label, fill=255)
    draw.text((120, 1960), caption, font=font(56), fill=255)
    text = np.asarray(mask) > 127
    img[text] = encode(203.0) if kind == "pq" else 0.75

    return (np.clip(img, 0, 1) * 65535).round().astype(np.uint16)


def save_rgb48(array, path):
    # Pillow cannot write 16-bit RGB PNG, so hand the raw frame to ffmpeg instead.
    path.write_bytes(array.astype(">u2").tobytes())


# ---------------------------------------------------------------- encoding

def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


SDR_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]
SDR_X265 = "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited"


def still_args(source, frames, fps, raw=None):
    if raw:
        inputs = ["-stream_loop", str(frames - 1), "-f", "rawvideo", "-pixel_format", "rgb48be",
                  "-video_size", f"{W}x{H}"]
    else:
        inputs = ["-loop", "1"]
    return [*inputs, "-framerate", str(fps), "-i", str(source), "-frames:v", str(frames), "-an"]


def hevc(source, out, frames=2, fps=1, ten_bit=True, crf=12, raw=None, hdr=None):
    pix = "yuv420p10le" if ten_bit else "yuv420p"
    matrix = "bt2020" if hdr else "bt709"
    x265 = SDR_X265
    tags = SDR_TAGS
    if hdr == "pq":
        x265 = ("colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:hdr10=1:"
                "repeat-headers=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)"
                "WP(15635,16450)L(10000000,1):max-cll=1000,400")
        tags = ["-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
                "-color_range", "tv"]
    elif hdr == "hlg":
        x265 = "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:repeat-headers=1"
        tags = ["-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
                "-color_range", "tv"]
    run([*still_args(source, frames, fps, raw),
         "-vf", f"scale=out_color_matrix={matrix}:out_range=tv,format={pix}",
         "-c:v", "libx265", "-preset", "slow", "-x265-params", f"crf={crf}:{x265}:log-level=error",
         "-profile:v", "main10" if ten_bit else "main", "-tag:v", "hvc1", *tags,
         "-movflags", "+faststart", str(out)])


def h264(source, out, frames=2, fps=1):
    run([*still_args(source, frames, fps), "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
         "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-profile:v", "high", "-level", "5.1",
         *SDR_TAGS, "-movflags", "+faststart", str(out)])


def av1(source, out, frames=2, fps=1):
    run([*still_args(source, frames, fps), "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p10le",
         "-c:v", "libsvtav1", "-preset", "6", "-crf", "18", *SDR_TAGS, "-movflags", "+faststart", str(out)])


def main():
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is required")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"width": W, "height": H, "charts": [], "hdr": [], "photos": []}
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        chart = sdr_chart()
        chart.save(OUT / "chart.png", optimize=True)
        chart.save(OUT / "chart.avif", quality=90)
        chart_png = OUT / "chart.png"
        variants = [
            ("chart-hevc10-2f.mp4", "HEVC Main10, 2 frames at 1 fps", lambda p: hevc(chart_png, p)),
            ("chart-hevc10-1f.mp4", "HEVC Main10, 1 frame", lambda p: hevc(chart_png, p, frames=1)),
            ("chart-hevc10-30f.mp4", "HEVC Main10, 30 frames at 30 fps", lambda p: hevc(chart_png, p, frames=30, fps=30)),
            ("chart-hevc8-2f.mp4", "HEVC Main 8-bit, 2 frames", lambda p: hevc(chart_png, p, ten_bit=False)),
            ("chart-h264-2f.mp4", "H.264 High 5.1, 2 frames", lambda p: h264(chart_png, p)),
            ("chart-av1-2f.mp4", "AV1 10-bit, 2 frames", lambda p: av1(chart_png, p)),
        ]
        manifest["charts"].append({"file": "chart.png", "label": "PNG in <img> (graphics plane)", "kind": "image"})
        manifest["charts"].append({"file": "chart.avif", "label": "AVIF in <img> (graphics plane)", "kind": "image"})
        for name, label, encode in variants:
            encode(OUT / name)
            manifest["charts"].append({"file": name, "label": label, "kind": "video"})

        for kind, label in (("pq", "HDR10 (PQ)"), ("hlg", "HLG")):
            raw = tmp / f"hdr-{kind}.rgb48"
            save_rgb48(hdr_chart(kind), raw)
            name = f"hdr-{kind}.mp4"
            hevc(raw, OUT / name, raw=raw, hdr=kind, crf=10)
            manifest["hdr"].append({"file": name, "label": label, "kind": "video"})
        manifest["hdr"].append({"file": "chart-hevc10-2f.mp4", "label": "SDR reference", "kind": "video"})

        for index in range(len(PHOTO_VIEWS)):
            pil = photo(index)
            png = tmp / f"photo-{index + 1}.png"
            pil.save(png)
            still = f"photo-{index + 1}.mp4"
            hevc(png, OUT / still, crf=16)
            jpg = f"photo-{index + 1}.jpg"
            pil.resize((1920, 1080), Image.LANCZOS).save(OUT / jpg, quality=92)
            manifest["photos"].append({"still": still, "jpeg": jpg, "label": f"Photo {index + 1}"})

    for entry in manifest["charts"] + manifest["hdr"]:
        entry["bytes"] = (OUT / entry["file"]).stat().st_size
    for entry in manifest["photos"]:
        entry["bytes"] = (OUT / entry["still"]).stat().st_size
    text = json.dumps(manifest, indent=2)
    (OUT / "manifest.json").write_text(text + "\n")
    # Packaged webOS apps run from file://, where fetch() cannot read local files; a script tag can.
    (OUT / "manifest.js").write_text("window.STILL4K_MANIFEST = " + text + ";\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
