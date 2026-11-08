#!/usr/bin/env python3
"""Генерация филлер-снимков для фотодневника «Вечерние демонстрации».

Это декоративные кадры (оборудование, закаты, звёздное небо, вид
лаборатории издалека), которые наполняют страницу и прячут целевой
снимок Луны среди обычных. Все приводятся к единому «старому зернистому
фото» виду. Среди них — монтировка телескопа со знаком ✕ (отсылка §6
канона, в задаче не объясняется).

Запуск:  python3 make_filler.py <out_dir>
"""

import math
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

random.seed(1847)
W, H = 900, 680


def finish(im: Image.Image) -> Image.Image:
    im = im.convert("L")
    noise = Image.effect_noise(im.size, 14).convert("L")
    im = Image.blend(im, noise, 0.05)
    vign = Image.new("L", im.size, 0)
    ImageDraw.Draw(vign).ellipse((-W // 8, -H // 8, W + W // 8, H + H // 8), fill=255)
    vign = vign.filter(ImageFilter.GaussianBlur(W // 11))
    im = Image.composite(im, Image.new("L", im.size, 8), vign)
    return im.convert("RGB")


def sky(top: int, bottom: int) -> Image.Image:
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):
        t = y / H
        v = int(top + (bottom - top) * t)
        for x in range(W):
            px[x, y] = (v, v, v)
    return im


def stars(im: Image.Image, n: int, ymax: float = 1.0) -> None:
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y = random.randint(0, W), random.randint(0, int(H * ymax))
        b = random.randint(120, 255)
        r = random.choice([0, 0, 0, 1])
        d.ellipse((x - r, y - r, x + r, y + r), fill=(b, b, b))


def evening_sky(path: str) -> None:
    im = sky(30, 165)
    stars(im, 70, 0.4)
    d = ImageDraw.Draw(im)
    gx, gy = int(W * 0.68), int(H * 0.74)
    for rr in range(140, 0, -6):
        a = int(90 * (rr / 140))
        d.ellipse((gx - rr, gy - rr, gx + rr, gy + rr), fill=(165 - a // 3, 160 - a // 3, 150 - a // 3))
    d.polygon([(0, H), (0, int(H * 0.8)), (W * 0.3, int(H * 0.86)), (W * 0.6, int(H * 0.78)),
               (W, int(H * 0.84)), (W, H)], fill=(18, 18, 18))
    finish(im).save(path, "JPEG", quality=82)


def night_stars(path: str) -> None:
    im = sky(8, 26)
    stars(im, 420)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 3):
        y = int(H * 0.5 + 40 * math.sin(x / 120))
        if random.random() < 0.5:
            v = random.randint(30, 70)
            d.point((x, y + random.randint(-18, 18)), fill=(v, v, v))
    d.polygon([(0, H), (0, int(H * 0.88)), (W, int(H * 0.92)), (W, H)], fill=(10, 10, 10))
    finish(im).save(path, "JPEG", quality=82)


def telescope_mount(path: str) -> None:
    im = sky(40, 150)
    stars(im, 40, 0.35)
    d = ImageDraw.Draw(im)
    d.rectangle((0, int(H * 0.82), W, H), fill=(22, 22, 22))
    cx, cy = int(W * 0.5), int(H * 0.82)
    d.line((cx, cy, cx - 110, H), fill=(12, 12, 12), width=10)
    d.line((cx, cy, cx + 110, H), fill=(12, 12, 12), width=10)
    d.line((cx, cy, cx + 8, H), fill=(12, 12, 12), width=10)
    head = (cx, int(H * 0.5))
    d.ellipse((head[0] - 26, head[1] - 26, head[0] + 26, head[1] + 26), fill=(15, 15, 15))
    d.line((head[0], head[1], cx, cy), fill=(12, 12, 12), width=14)
    ang = math.radians(-32)
    tl = 230
    x2, y2 = int(head[0] + tl * math.cos(ang)), int(head[1] + tl * math.sin(ang))
    d.line((head[0], head[1], x2, y2), fill=(20, 20, 20), width=30)
    d.ellipse((x2 - 20, y2 - 20, x2 + 20, y2 + 20), fill=(28, 28, 28))
    # знак ✕ на головке монтировки (отсылка §6, не объясняется)
    m = 17
    d.line((head[0] - m, head[1] - m, head[0] + m, head[1] + m), fill=(225, 225, 225), width=4)
    d.line((head[0] - m, head[1] + m, head[0] + m, head[1] - m), fill=(225, 225, 225), width=4)
    finish(im).save(path, "JPEG", quality=84)


def lab_distant(path: str) -> None:
    im = sky(14, 40)
    stars(im, 120, 0.6)
    d = ImageDraw.Draw(im)
    base = int(H * 0.72)
    d.rectangle((0, base, W, H), fill=(16, 16, 16))
    bx, bw, bh = int(W * 0.34), int(W * 0.32), int(H * 0.16)
    d.rectangle((bx, base - bh, bx + bw, base), fill=(26, 26, 26))
    d.rectangle((bx + bw, base - bh // 2, bx + bw + 60, base), fill=(22, 22, 22))
    for i in range(6):
        for j in range(2):
            if random.random() < 0.55:
                wx = bx + 14 + i * (bw - 20) // 6
                wy = base - bh + 12 + j * (bh - 18) // 2
                v = random.choice([150, 180, 205])
                d.rectangle((wx, wy, wx + 12, wy + 10), fill=(v, v, v - 20))
    d.polygon([(0, H), (0, base + 20), (W, base + 30), (W, H)], fill=(8, 8, 8))
    finish(im).save(path, "JPEG", quality=82)


def equipment(path: str) -> None:
    im = sky(60, 95)
    d = ImageDraw.Draw(im)
    d.rectangle((0, int(H * 0.6), W, H), fill=(30, 30, 30))
    for i, cx in enumerate((W * 0.28, W * 0.5, W * 0.72)):
        cx = int(cx); cy = int(H * 0.55)
        rr = 44 - i * 6
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(18, 18, 18), width=6)
        d.ellipse((cx - rr + 12, cy - rr + 12, cx + rr - 12, cy + rr - 12), fill=(12, 12, 12))
    finish(im).save(path, "JPEG", quality=82)


def crescent(path: str) -> None:
    im = sky(6, 16)
    stars(im, 160)
    d = ImageDraw.Draw(im)
    cx, cy, r = int(W * 0.5), int(H * 0.46), 150
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(205, 205, 200))
    d.ellipse((cx - r + 70, cy - r - 10, cx + r + 70, cy + r - 10), fill=(10, 10, 14))
    finish(im).save(path, "JPEG", quality=82)


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    telescope_mount(f"{out}/telescope_mount.jpg")
    evening_sky(f"{out}/evening_sky.jpg")
    night_stars(f"{out}/night_stars.jpg")
    lab_distant(f"{out}/lab_distant.jpg")
    equipment(f"{out}/eyepieces.jpg")
    crescent(f"{out}/crescent.jpg")
    print("filler written to", out)


if __name__ == "__main__":
    main()
