import random
import sys
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "duck_route.log"
FLAG = "nskctf{quack_is_a_result}"
DAYS = 2191
START = date(2019, 10, 13)
END = date(2025, 10, 11)
DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]
DUCK_CELL = 2
DUCK_W = 58
DUCK_H = 66
FONT_CELL = 2

GLYPHS = {
    "n": [[(0, 6), (0, 2), (4, 2), (4, 6)]],
    "s": [[(4, 2), (0, 2), (0, 4), (4, 4), (4, 6), (0, 6)]],
    "k": [[(0, 0), (0, 6)], [(0, 4), (2, 4), (2, 3), (4, 3), (4, 2)], [(2, 4), (2, 5), (4, 5), (4, 6)]],
    "c": [[(4, 2), (0, 2), (0, 6), (4, 6)]],
    "t": [[(2, 0), (2, 6), (4, 6)], [(0, 2), (4, 2)]],
    "f": [[(4, 0), (2, 0), (2, 6)], [(0, 3), (4, 3)]],
    "{": [[(4, 0), (3, 0), (3, 3), (1, 3)], [(3, 3), (3, 6), (4, 6)]],
    "}": [[(0, 0), (1, 0), (1, 3), (3, 3)], [(1, 3), (1, 6), (0, 6)]],
    "q": [[(4, 8), (4, 2), (0, 2), (0, 6), (4, 6)]],
    "u": [[(0, 2), (0, 6), (4, 6), (4, 2)]],
    "a": [[(0, 2), (4, 2), (4, 6), (0, 6), (0, 4), (4, 4)]],
    "_": [[(0, 7), (4, 7)]],
    "i": [[(2, 2), (2, 6)], [(2, 0), (2, 1)]],
    "r": [[(0, 6), (0, 2), (4, 2), (4, 3)]],
    "e": [[(0, 4), (4, 4), (4, 2), (0, 2), (0, 6), (4, 6)]],
    "l": [[(2, 0), (2, 6), (4, 6)]],
}


def duck_bitmap():
    img = Image.new("1", (DUCK_W, DUCK_H))
    d = ImageDraw.Draw(img)
    d.rectangle((20, 55, 23, 61), fill=1)
    d.rectangle((36, 55, 39, 61), fill=1)
    d.rectangle((13, 61, 24, 63), fill=1)
    d.rectangle((29, 61, 40, 63), fill=1)
    d.polygon([(21, 30), (37, 30), (46, 42), (48, 56), (11, 56), (13, 42)], fill=1)
    d.polygon([(45, 40), (55, 33), (53, 45), (47, 50)], fill=1)
    d.ellipse((12, 2, 44, 34), fill=1)
    d.rounded_rectangle((1, 17, 16, 26), radius=3, fill=1)
    d.line([(4, 22), (13, 22)], fill=0)
    d.ellipse((15, 11, 26, 22), fill=0)
    d.ellipse((30, 11, 41, 22), fill=0)
    d.rectangle((26, 15, 30, 15), fill=0)
    d.rectangle((18, 15, 20, 17), fill=1)
    d.rectangle((33, 15, 35, 17), fill=1)
    d.line([(22, 33), (28, 42), (28, 55)], fill=0)
    d.line([(35, 33), (28, 42)], fill=0)
    d.rectangle((33, 41, 44, 53), fill=0)
    d.rectangle((35, 44, 42, 44), fill=1)
    d.rectangle((35, 47, 42, 47), fill=1)
    d.rectangle((35, 50, 39, 50), fill=1)
    return img


def contours(img):
    w, h = img.size
    px = img.load()
    lit = lambda x, y: 0 <= x < w and 0 <= y < h and px[x, y]
    edges = {}
    for y in range(h):
        for x in range(w):
            if not lit(x, y):
                continue
            if not lit(x, y - 1):
                edges.setdefault((x, y), []).append((x + 1, y))
            if not lit(x + 1, y):
                edges.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if not lit(x, y + 1):
                edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if not lit(x - 1, y):
                edges.setdefault((x, y + 1), []).append((x, y))
    loops = []
    while edges:
        start = next(iter(edges))
        path = [start]
        cur = start
        while True:
            nxt = edges[cur].pop()
            if not edges[cur]:
                del edges[cur]
            path.append(nxt)
            cur = nxt
            if cur == start and cur not in edges:
                break
        loops.append(simplify(path))
    return loops


def simplify(path):
    out = [path[0]]
    for i in range(1, len(path) - 1):
        a, b, c = out[-1], path[i], path[i + 1]
        if (a[0] == b[0] == c[0]) or (a[1] == b[1] == c[1]):
            continue
        out.append(b)
    out.append(path[-1])
    return out


def strokes():
    res = []
    text_w = len(FLAG) * 6 * FONT_CELL
    duck_x = (text_w - DUCK_W * DUCK_CELL) // 2
    for loop in contours(duck_bitmap()):
        res.append([(duck_x + x * DUCK_CELL, y * DUCK_CELL) for x, y in loop])
    top = DUCK_H * DUCK_CELL + 10
    for i, ch in enumerate(FLAG):
        ox = i * 6 * FONT_CELL
        for s in GLYPHS[ch]:
            res.append([(ox + x * FONT_CELL, top + y * FONT_CELL) for x, y in s])
    return res


class Duck:
    def __init__(self):
        self.pos = (0, 0)
        self.heading = 0
        self.log = []

    def face(self, want):
        turn = (want - self.heading) % 4
        if turn == 1:
            self.log.append("направо")
        elif turn == 3:
            self.log.append("налево")
        elif turn == 2:
            self.log += ["направо", "направо"]
        self.heading = want

    def axis(self, dx, dy):
        if dx:
            self.face(1 if dx > 0 else 3)
            self.log.append(f"вперёд {abs(dx)}")
        if dy:
            self.face(2 if dy > 0 else 0)
            self.log.append(f"вперёд {abs(dy)}")

    def go(self, target):
        self.axis(target[0] - self.pos[0], 0)
        self.axis(0, target[1] - self.pos[1])
        self.pos = target

    def cost(self, target):
        probe = Duck()
        probe.pos, probe.heading = self.pos, self.heading
        probe.go(target)
        return len(probe.log)


def route(items, rng):
    xs = [x for s in items for x, _ in s]
    ys = [y for s in items for _, y in s]
    box = (min(xs), min(ys), max(xs), max(ys))
    base = Duck()
    for s in items:
        base.go(s[0])
        base.log.append("лужа")
        for p in s[1:]:
            base.go(p)
        base.log.append("коврик")
    spare = DAYS - len(base.log)
    if spare < 0:
        sys.exit(f"не хватает суток: {len(base.log)} > {DAYS}")
    quota = spare // (len(items) + 1)
    duck = Duck()
    for s in items:
        wander(duck, box, quota, s[0], rng)
        duck.go(s[0])
        duck.log.append("лужа")
        for p in s[1:]:
            duck.go(p)
        duck.log.append("коврик")
    if len(duck.log) > DAYS:
        sys.exit(f"перебор: {len(duck.log)} > {DAYS}")
    while DAYS - len(duck.log) >= 8:
        wander(duck, box, DAYS - len(duck.log) - 4, None, rng)
    while len(duck.log) < DAYS:
        duck.log.append(rng.choice(["налево", "направо"]))
    return duck.log, box


def wander(duck, box, budget, nxt, rng):
    used = len(duck.log)
    while True:
        t = (rng.randint(box[0], box[2]), rng.randint(box[1], box[3]))
        left = budget - (len(duck.log) - used)
        if nxt is not None:
            probe = Duck()
            probe.pos, probe.heading = t, duck.heading
            need = duck.cost(t) + probe.cost(nxt) + 2
        else:
            need = duck.cost(t)
        if need > left:
            return
        duck.go(t)


def replay(lines):
    x, y, h, wet = 0, 0, 0, False
    segs = []
    for line in lines:
        _, cmd, *arg = line.split()
        if cmd == "налево":
            h = (h - 1) % 4
        elif cmd == "направо":
            h = (h + 1) % 4
        elif cmd == "лужа":
            wet = True
        elif cmd == "коврик":
            wet = False
        else:
            n = int(arg[0])
            nx, ny = x + DIRS[h][0] * n, y + DIRS[h][1] * n
            if wet:
                segs.append(((x, y), (nx, ny)))
            x, y = nx, ny
    return segs


def unit_cells(segs):
    cells = set()
    for (a, b), (c, d) in segs:
        for t in range(abs(c - a) + abs(d - b)):
            sx, sy = (c > a) - (c < a), (d > b) - (d < b)
            p = (a + sx * t, b + sy * t)
            q = (p[0] + sx, p[1] + sy)
            cells.add(frozenset((p, q)))
    return cells


def main():
    rng = random.Random(20191013)
    items = strokes()
    log, box = route(items, rng)
    lines = [f"{(START + timedelta(days=i)).strftime('%d.%m.%Y')} {c}" for i, c in enumerate(log)]
    assert len(lines) == DAYS
    assert lines[0].startswith(START.strftime("%d.%m.%Y"))
    assert lines[-1].startswith(END.strftime("%d.%m.%Y"))
    want = unit_cells([(s[i], s[i + 1]) for s in items for i in range(len(s) - 1)])
    assert unit_cells(replay(lines)) == want
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"строк: {len(lines)}, штрихов: {len(items)}, поле: {box}")


if __name__ == "__main__":
    main()
