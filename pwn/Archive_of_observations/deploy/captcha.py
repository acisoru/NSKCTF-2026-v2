import io
import random
import secrets

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
WIDTH = 190
HEIGHT = 64


def new_code(length=5):
    return ''.join(secrets.choice(CHARS) for _ in range(length))


def render(code):
    image = Image.new('RGB', (WIDTH, HEIGHT), (18, 11, 8))
    draw = ImageDraw.Draw(image)
    for _ in range(7):
        draw.line(
            [(random.randrange(WIDTH), random.randrange(HEIGHT)),
             (random.randrange(WIDTH), random.randrange(HEIGHT))],
            fill=(random.randrange(45, 95), random.randrange(25, 65), random.randrange(15, 45)),
            width=random.choice((1, 1, 2)),
        )
    for _ in range(240):
        draw.point(
            (random.randrange(WIDTH), random.randrange(HEIGHT)),
            fill=(random.randrange(70, 170), random.randrange(45, 120), random.randrange(25, 80)),
        )

    step = (WIDTH - 20) // len(code)
    for index, char in enumerate(code):
        size = random.randrange(32, 43)
        font = ImageFont.truetype(FONT_PATH, size)
        glyph = Image.new('RGBA', (56, 58), (0, 0, 0, 0))
        glyph_draw = ImageDraw.Draw(glyph)
        glyph_draw.text(
            (5, 0),
            char,
            font=font,
            fill=(random.randrange(190, 255), random.randrange(110, 200), random.randrange(45, 150), 255),
        )
        glyph = glyph.rotate(
            random.uniform(-18, 18),
            expand=True,
            resample=Image.Resampling.BICUBIC,
        )
        x = 10 + index * step + random.randrange(-3, 4)
        y = random.randrange(4, 12)
        image.paste(glyph, (x, y), glyph)

    image = image.filter(ImageFilter.SMOOTH)
    output = io.BytesIO()
    image.save(output, format='PNG', optimize=True)
    return output.getvalue()
