import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public" / "duck_route.log"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("duck_route.png")
ALL = len(sys.argv) > 3 and sys.argv[3] == "--all"
DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]
SCALE = 4
PAD = 20

x, y, h, wet = 0, 0, 0, False
segs = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    _, cmd, *arg = line.split()
    if cmd == "налево":
        h = (h - 1) % 4
    elif cmd == "направо":
        h = (h + 1) % 4
    elif cmd == "лужа":
        wet = True
    elif cmd == "коврик":
        wet = False
    elif cmd == "вперёд":
        n = int(arg[0])
        nx, ny = x + DIRS[h][0] * n, y + DIRS[h][1] * n
        if wet or ALL:
            segs.append((x, y, nx, ny))
        x, y = nx, ny

xs = [v for s in segs for v in (s[0], s[2])]
ys = [v for s in segs for v in (s[1], s[3])]
ox, oy = min(xs), min(ys)
size = ((max(xs) - ox) * SCALE + 2 * PAD, (max(ys) - oy) * SCALE + 2 * PAD)
img = Image.new("RGB", size, (8, 14, 10))
draw = ImageDraw.Draw(img)
for a, b, c, d in segs:
    draw.line(
        [((a - ox) * SCALE + PAD, (b - oy) * SCALE + PAD), ((c - ox) * SCALE + PAD, (d - oy) * SCALE + PAD)],
        fill=(125, 255, 155),
        width=3,
    )
img.save(OUT)
print(f"сохранено: {OUT}, отрезков: {len(segs)}")
