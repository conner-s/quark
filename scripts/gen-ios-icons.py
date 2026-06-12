#!/usr/bin/env python3
"""Generate the iOS app-icon set from icon.png — composite, then resize.

Pipeline (per the requested order):

    source RGBA  ->  composite over black (RGB)  ->  resize NEAREST  ->  write

Compositing happens at the FULL source resolution first, so antialiased edges in
the logo are blended against black before any sampling. Nearest-neighbour then
just picks pixels — no further blending, crisp output. (This is deliberately the
opposite order from gen-ios-icons.py, which resizes first and flattens after.)

App Store rejects icons with an alpha channel, so output is always RGB (no alpha).

Both tracked iOS locations are written byte-identically:
  - src-tauri/icons/ios/                                     (Tauri record)
  - src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/  (Xcode builds this)
Editing only the first never reaches the app.

Usage:
  python3 scripts/gen-ios-icons-flat.py                 # write both locations
  python3 scripts/gen-ios-icons-flat.py --output /tmp/x # dry preview, don't touch tree
  python3 scripts/gen-ios-icons-flat.py --source path/to/logo.png
"""

import argparse
import os
import struct
import sys
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SOURCE = os.path.join(REPO, "src-tauri/icons/icon.png")
PRIMARY = os.path.join(REPO, "src-tauri/icons/ios")
MIRROR = os.path.join(REPO, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset")


# ── PNG read (8-bit gray/RGB/RGBA -> RGBA) ───────────────────────────────────
def load_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"not a PNG: {path}"
    pos, idat = 8, b""
    w = h = col = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + ln]
        if typ == b"IHDR":
            w, h = struct.unpack(">II", chunk[:8])
            col = chunk[9]
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[col]
    bpp, stride = ch, w * ch
    out = bytearray()
    prev = bytearray(stride)
    i = 0

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    for _ in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if ft:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if ft == 1:
                    line[x] = (line[x] + a) & 255
                elif ft == 2:
                    line[x] = (line[x] + b) & 255
                elif ft == 3:
                    line[x] = (line[x] + ((a + b) >> 1)) & 255
                elif ft == 4:
                    line[x] = (line[x] + paeth(a, b, c)) & 255
        out += line
        prev = line
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        o = i * ch
        if ch == 4:
            rgba[i * 4 : i * 4 + 4] = out[o : o + 4]
        elif ch == 3:
            rgba[i * 4 : i * 4 + 3] = out[o : o + 3]
            rgba[i * 4 + 3] = 255
        else:  # gray (+alpha)
            g = out[o]
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g
            rgba[i * 4 + 3] = out[o + 1] if ch == 2 else 255
    return w, h, bytes(rgba)


def write_rgb_png(path, w, h, rgb):
    def chunk(typ, body):
        return (
            struct.pack(">I", len(body))
            + typ
            + body
            + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # colortype 2 = RGB
    stride = w * 3
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * stride : (y + 1) * stride]
    idat = zlib.compress(bytes(raw), 9)
    open(path, "wb").write(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    )


# ── Pipeline: composite over black, THEN resize nearest ──────────────────────
def composite_on_black(w, h, rgba):
    """Alpha-over black. Returns 3-channel RGB at the same resolution."""
    rgb = bytearray(w * h * 3)
    for i in range(w * h):
        o = i * 4
        a = rgba[o + 3]
        rgb[i * 3] = rgba[o] * a // 255
        rgb[i * 3 + 1] = rgba[o + 1] * a // 255
        rgb[i * 3 + 2] = rgba[o + 2] * a // 255
    return bytes(rgb)


def resize_nearest_rgb(sw, sh, rgb, dw, dh):
    dst = bytearray(dw * dh * 3)
    for dy in range(dh):
        sy = min(sh - 1, int((dy + 0.5) * sh / dh))
        for dx in range(dw):
            sx = min(sw - 1, int((dx + 0.5) * sw / dw))
            so = (sy * sw + sx) * 3
            do = (dy * dw + dx) * 3
            dst[do : do + 3] = rgb[so : so + 3]
    return bytes(dst)


def main():
    ap = argparse.ArgumentParser(description="Generate iOS app icons: composite on black, then resize nearest.")
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--output", default=None,
                    help="write the set here instead of the two real locations (dry preview)")
    args = ap.parse_args()

    dests = [args.output] if args.output else [PRIMARY, MIRROR]
    for d in dests:
        os.makedirs(d, exist_ok=True)

    print(f"source : {args.source}")
    print(f"output : {', '.join(dests)}\n")

    sw, sh, src = load_png(args.source)
    flat = composite_on_black(sw, sh, src)  # composite ONCE at full res

    # target sizes/names come from the existing committed set (fixed by Apple)
    names = sorted(f for f in os.listdir(PRIMARY) if f.endswith(".png"))
    for n in names:
        w, h, _ = load_png(os.path.join(PRIMARY, n))
        rgb = resize_nearest_rgb(sw, sh, flat, w, h)
        for d in dests:
            write_rgb_png(os.path.join(d, n), w, h, rgb)
        print(f"  {n:26} {w}x{h}")

    # verify: output is RGB (no alpha) and both locations match
    print("\nverifying…")
    bad = 0
    if not args.output:
        for n in names:
            if open(os.path.join(PRIMARY, n), "rb").read() != open(os.path.join(MIRROR, n), "rb").read():
                print(f"  OUT OF SYNC: {n}")
                bad += 1
    if bad:
        sys.exit(f"FAIL: {bad} issue(s).")
    print("OK: " + ("preview written." if args.output else "both locations written and in sync."))


if __name__ == "__main__":
    main()
