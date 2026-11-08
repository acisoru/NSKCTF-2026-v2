#!/usr/bin/env python3
"""Сборка целевого снимка Луны для задачи «Вечерние демонстрации».

Берёт исходный снимок кратера Fracastorius (кадр из LROC QuickMap,
NASA/ASU, public domain; район южной кромки Mare Nectaris) и приводит
его к виду «снято через телескоп и выложено в фотодневник»:

  - grayscale (убирает цвет рендера карты);
  - поворот на 180° — 200-мм рефлектор (Ньютон) даёт перевёрнутое
    изображение без зеркалирования; это ломает прямое сопоставление
    с картами и reverse-image-поиск. Зеркало (--mirror) — опция для
    рефрактора/ЅК со звёздным диагоналем, по умолчанию выключено;
  - перекрестие на целевом кратере (Fracastorius);
  - кадр центрируется на цели, яркость/контраст, зерно, виньетка —
    «любительское фото»;
  - полная очистка EXIF (пересохранение через PIL метаданные не переносит).

Позиция цели отслеживается отдельным locator-слоем, поэтому кроп всегда
попадает на кратер независимо от угла поворота. Скрипт параметризован:
можно подставить другой исходник и подвинуть перекрестие (--tx/--ty).

Запуск:
  python3 make_moon.py moon_source.png site/photos/moon_last_show.jpg
"""

import argparse

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


def transform(img: Image.Image, mirror: bool, angle: float) -> Image.Image:
    if mirror:
        img = ImageOps.mirror(img)
    return img.rotate(angle, resample=Image.BICUBIC, expand=True)


def build(args: argparse.Namespace) -> None:
    im = Image.open(args.input).convert("L")
    scale = args.scale
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    if args.smooth > 0:
        im = im.filter(ImageFilter.GaussianBlur(args.smooth))

    tx, ty = int(args.tx * im.width), int(args.ty * im.height)

    r = int(args.marker * im.width)
    gap, line = r // 3, max(2, im.width // 420)
    draw = ImageDraw.Draw(im)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        draw.line((tx + dx * gap, ty + dy * gap, tx + dx * r, ty + dy * r), fill=240, width=line)
    draw.ellipse((tx - r, ty - r, tx + r, ty + r), outline=240, width=line)

    loc = Image.new("L", im.size, 0)
    ImageDraw.Draw(loc).ellipse((tx - 6, ty - 6, tx + 6, ty + 6), fill=255)

    im = transform(im, args.mirror, args.angle)
    loc = transform(loc, args.mirror, args.angle)

    bbox = loc.getbbox()
    px, py = (bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2

    cw, ch = int(im.width * args.crop), int(im.height * args.crop)
    left = max(0, min(int(px - cw * args.place_x), im.width - cw))
    top = max(0, min(int(py - ch * args.place_y), im.height - ch))
    im = im.crop((left, top, left + cw, top + ch))

    im = ImageEnhance.Contrast(im).enhance(args.contrast)
    im = ImageEnhance.Brightness(im).enhance(args.bright)
    im = ImageOps.autocontrast(im, cutoff=args.cutoff)

    noise = Image.effect_noise(im.size, args.grain).convert("L")
    im = Image.blend(im, noise, args.grain_mix)

    vign = Image.new("L", im.size, 0)
    ImageDraw.Draw(vign).ellipse(
        (-im.width // 7, -im.height // 7, im.width + im.width // 7, im.height + im.height // 7), fill=255
    )
    vign = vign.filter(ImageFilter.GaussianBlur(im.width // 10))
    im = Image.composite(im, Image.new("L", im.size, 6), vign)

    im.convert("RGB").save(args.output, format="JPEG", quality=84, optimize=True)
    print(f"written {args.output} {im.size}  target@crop=({px-left},{py-top})")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--tx", type=float, default=0.54)
    p.add_argument("--ty", type=float, default=0.50)
    p.add_argument("--marker", type=float, default=0.045)
    p.add_argument("--angle", type=float, default=180.0)
    p.add_argument("--mirror", dest="mirror", action="store_true",
                   help="добавить зеркалирование (рефрактор/ЅК со звёздным диагоналем)")
    p.add_argument("--no-mirror", dest="mirror", action="store_false",
                   help="без зеркалирования — рефлектор даёт только поворот 180° (по умолчанию)")
    p.set_defaults(mirror=False)
    p.add_argument("--scale", type=float, default=1.3)
    p.add_argument("--smooth", type=float, default=0.0)
    p.add_argument("--crop", type=float, default=0.55)
    p.add_argument("--place-x", type=float, default=0.40, help="target horizontal position in crop (0=left)")
    p.add_argument("--place-y", type=float, default=0.60, help="target vertical position in crop (0=top)")
    p.add_argument("--contrast", type=float, default=1.05)
    p.add_argument("--bright", type=float, default=1.0)
    p.add_argument("--cutoff", type=float, default=0.3)
    p.add_argument("--grain", type=float, default=20.0)
    p.add_argument("--grain-mix", type=float, default=0.12)
    build(p.parse_args())


if __name__ == "__main__":
    main()
