#!/usr/bin/env python3
"""Organizer-only deterministic compiler and capsule builder."""

import argparse
import hashlib
import json
import random
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TOKEN = bytes.fromhex("7b511dcc79a95380155588e1aaf3ac9be2930cc1fbe573cd")
ROUND_SEED = 0xDB41008BF9DFB6E6A7079BAD0842DD87
LAYOUT_SEED = 0xEB21DA9F05542B0EEF7B048217D83F19
FLAG = "nskctf{c0l0ur_is_a_pr0t0c0l_093a1913bc5f0f6e}"
CLUE = (
    "Метка HACKED содержит маршрут в наблюдательную, вне покрытия камер, "
    "и номер допуска 000. В таблице этот допуск помечен «резервный, не выдан»."
)
MAGIC = b"PRIVET1\n"
N, P, ROUNDS = 24, 257, 20
PALETTE = (
    (0xFFC0C0, 0xFF0000, 0xC00000),
    (0xFFFFC0, 0xFFFF00, 0xC0C000),
    (0xC0FFC0, 0x00FF00, 0x00C000),
    (0xC0FFFF, 0x00FFFF, 0x00C0C0),
    (0xC0C0FF, 0x0000FF, 0x0000C0),
    (0xFFC0FF, 0xFF00FF, 0xC000C0),
)
DELTA = {
    "push": (0, 1), "pop": (0, 2), "add": (1, 0),
    "sub": (1, 1), "mul": (1, 2), "div": (2, 0),
    "mod": (2, 1), "not": (2, 2), "gt": (3, 0),
    "pointer": (3, 1), "switch": (3, 2), "dup": (4, 0),
    "roll": (4, 1), "in_num": (4, 2), "in_char": (5, 0),
    "out_num": (5, 1), "out_char": (5, 2),
}


class Assembler:
    def __init__(self):
        self.code = []

    def op(self, name, value=0):
        self.code.append((name, value))

    def number(self, value):
        if value < 0:
            self.number(0)
            self.number(-value)
            self.op("sub")
        elif value == 0:
            self.op("push", 1)
            self.op("not")
        elif value <= 16:
            self.op("push", value)
        else:
            self.number(value // 16)
            self.op("push", 16)
            self.op("mul")
            if value % 16:
                self.op("push", value % 16)
                self.op("add")

    def roll(self, depth, count):
        self.number(depth)
        self.number(count)
        self.op("roll")

    def pick(self, depth):
        self.roll(depth, -1)
        self.op("dup")
        self.roll(depth + 1, 1)

    def text(self, text):
        for character in text:
            self.number(ord(character))
            self.op("out_char")


def parameters():
    rng = random.Random(ROUND_SEED)
    for _ in range(ROUNDS):
        for _ in range(N):
            j, k = rng.sample(range(2, N + 1), 2)
            yield j, k, rng.randrange(1, P), rng.randrange(1, P), \
                rng.randrange(1, P), rng.randrange(P), rng.randrange(1, N)


def rotate(values, count):
    count %= len(values)
    return values[-count:] + values[:-count] if count else values[:]


def program():
    asm = Assembler()
    asm.text("privet\n")
    for _ in range(N):
        asm.op("in_num")

    # Keep a range-error accumulator underneath the reversible state.
    asm.number(0)
    for depth in range(1, N + 1):
        asm.pick(depth + 1)
        asm.number(255)
        asm.op("gt")
        asm.op("add")
        asm.number(0)
        asm.pick(depth + 2)
        asm.op("gt")
        asm.op("add")
    asm.roll(N + 1, 1)

    state = list(TOKEN)
    for index, (j, k, a, b, c, d, shift) in enumerate(parameters()):
        asm.number(a)
        asm.op("mul")
        asm.pick(j)
        asm.number(b)
        asm.op("mul")
        asm.pick(k + 1)
        asm.op("mul")
        asm.op("add")
        asm.pick(j)
        asm.number(c)
        asm.op("mul")
        asm.op("add")
        asm.number(d)
        asm.op("add")
        asm.number(P)
        asm.op("mod")
        asm.roll(N, shift)
        x, y, z = state[-1], state[-j], state[-k]
        state[-1] = (a * x + b * y * z + c * y + d) % P
        state = rotate(state, shift)

        if (index + 1) % 12 == 0:
            asm.number(N)
            asm.number(0)
            for depth in range(1, N + 1):
                asm.pick(depth + 2)
                asm.op("add")
            asm.op("dup")
            asm.op("switch")
            asm.number(N)
            asm.op("mod")
            asm.op("roll")
            state = rotate(state, sum(state) % N)

    asm.number(0)
    for target in reversed(state):
        asm.roll(2, 1)
        asm.number(target)
        asm.op("sub")
        asm.op("dup")
        asm.op("mul")
        asm.op("add")
    asm.op("add")
    asm.op("not")
    asm.op("out_num")
    asm.text("\n")
    return asm.code


class Canvas:
    """Independent instruction islands, irregular block areas, DP turns."""

    def __init__(self, width=2048):
        self.width = width
        self.rows = []
        self.rng = random.Random(LAYOUT_SEED)
        self.x, self.y, self.dx = 0, 0, 1

    def paint(self, x, y, color):
        assert 0 <= x < self.width and y >= 0
        while len(self.rows) <= y:
            self.rows.append([0] * self.width)
        assert self.rows[y][x] in (0, color), (x, y)
        self.rows[y][x] = color

    def colors(self, name):
        hue, light = self.rng.randrange(6), self.rng.randrange(3)
        dh, dl = DELTA[name]
        return PALETTE[hue][light], PALETTE[(hue + dh) % 6][(light + dl) % 3]

    def tile(self, name, area=1, decorate=True):
        source, target = self.colors(name)
        width = area
        if decorate and area >= 5:
            width = self.rng.randint(max(3, (area + 6) // 3), area)
        for offset in range(width):
            self.paint(self.x + offset * self.dx, self.y, source)
        remaining = area - width
        columns = list(range(1, width - 1))
        self.rng.shuffle(columns)
        for offset in columns:
            height = min(2, remaining)
            for dy in range(1, height + 1):
                self.paint(self.x + offset * self.dx, self.y + dy, source)
            remaining -= height
        assert remaining == 0
        end = self.x + width * self.dx
        self.paint(end, self.y, target)
        self.paint(end + self.dx, self.y, 0xFFFFFF)
        self.x = end + 2 * self.dx
        return end

    def turn(self):
        boundary = self.width - 24 if self.dx == 1 else 20
        for x in range(self.x, boundary, self.dx):
            self.paint(x, self.y, 0xFFFFFF)
        self.x = boundary
        amount = 1 if self.dx == 1 else 3
        self.tile("push", amount, decorate=False)
        column = self.tile("pointer", decorate=False)
        for dy in range(1, 4):
            self.paint(column, self.y + dy, 0xFFFFFF)
        source, target = self.colors("push")
        for dy in range(4, 4 + amount):
            self.paint(column, self.y + dy, source)
        self.paint(column, self.y + 4 + amount, target)
        self.paint(column, self.y + 5 + amount, 0xFFFFFF)
        source, target = self.colors("pointer")
        self.paint(column, self.y + 6 + amount, source)
        self.paint(column, self.y + 7 + amount, target)
        self.y += 7 + amount
        self.dx *= -1
        self.paint(column + self.dx, self.y, 0xFFFFFF)
        self.x = column + 2 * self.dx

    def render(self, code):
        for name, value in code:
            area = value if name == "push" else self.rng.randrange(1, 14)
            end = self.x + self.dx * (area + 3)
            if (self.dx == 1 and end >= self.width - 40) or (self.dx == -1 and end < 40):
                self.turn()
            self.tile(name, area)
        end = self.x + self.dx * 5
        if (self.dx == 1 and end >= self.width - 40) or (self.dx == -1 and end < 40):
            self.turn()
        # A middle-edge entrance cannot be selected as an exit from this block.
        color = PALETTE[0][0]
        for dy in (-1, 0, 1):
            for dx in range(3):
                self.paint(self.x + self.dx * dx, self.y + dy, color)
        pixels = bytearray()
        for row in self.rows:
            for color in row:
                pixels.extend(color.to_bytes(3, "big"))
        pixels.extend(bytes(self.width * 3))
        return Image.frombytes("RGB", (self.width, len(self.rows) + 1), bytes(pixels))


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    code = program()
    image = Canvas().render(code)
    image.save(output / "privet.png", optimize=False, compress_level=9)
    payload = json.dumps({"flag": FLAG, "evidence": CLUE}, ensure_ascii=False,
                         separators=(",", ":")).encode("utf-8")
    key = hashlib.sha256(TOKEN).digest()
    # Bind the deterministic nonce to the entire plaintext, including edits.
    nonce = hashlib.sha256(b"privet/nonce\0" + key + payload).digest()[:12]
    capsule = MAGIC + nonce + ChaCha20Poly1305(key).encrypt(nonce, payload, MAGIC)
    (output / "quarantine.bin").write_bytes(capsule)
    print(f"{image.width}x{image.height}; {len(code)} Piet instructions")
    for filename in ("privet.png", "quarantine.bin"):
        data = (output / filename).read_bytes()
        print(f"{filename}: {len(data)} bytes; sha256={hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "public")
    build(parser.parse_args().output)
