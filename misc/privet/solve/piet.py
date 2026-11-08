#!/usr/bin/env python3
"""Piet execution and tracing from RGB pixels; no compiler dependencies."""

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

COLORS = (
    "ffc0c0 ff0000 c00000 ffffc0 ffff00 c0c000 c0ffc0 00ff00 00c000 "
    "c0ffff 00ffff 00c0c0 c0c0ff 0000ff 0000c0 ffc0ff ff00ff c000c0"
).split()
COLORS = {tuple(bytes.fromhex(value)): divmod(i, 3) for i, value in enumerate(COLORS)}
COMMANDS = (
    ("nop", "push", "pop"), ("add", "sub", "mul"),
    ("div", "mod", "not"), ("gt", "pointer", "switch"),
    ("dup", "roll", "in_num"), ("in_char", "out_num", "out_char"),
)
DIRECTIONS = ((1, 0), (0, 1), (-1, 0), (0, -1))
BLACK, WHITE = (0, 0, 0), (255, 255, 255)


@dataclass
class Result:
    output: str
    stack: list
    trace: list
    steps: int


class Piet:
    def __init__(self, path):
        with Image.open(path) as image:
            image = image.convert("RGB")
            self.width, self.height = image.size
            colors = image.getcolors(21)
        if colors is None or {color for _, color in colors} - set(COLORS) - {BLACK, WHITE}:
            raise ValueError("Image contains non-Piet colors")
        self.image = image
        self.pixels = image.load()
        self.blocks = {}

    def color(self, x, y):
        if not (0 <= x < self.width and 0 <= y < self.height):
            return BLACK
        return self.pixels[x, y]

    def block(self, x, y):
        if (x, y) in self.blocks:
            return self.blocks[x, y]
        color = self.color(x, y)
        pending, found = [(x, y)], {(x, y)}
        while pending:
            cx, cy = pending.pop()
            for dx, dy in DIRECTIONS:
                point = cx + dx, cy + dy
                if point not in found and self.color(*point) == color:
                    found.add(point)
                    pending.append(point)
        exits = []
        for dx, dy in DIRECTIONS:
            for cc in (0, 1):
                sx, sy = (dy, -dx) if cc == 0 else (-dy, dx)
                exits.append(max(found, key=lambda p: (p[0]*dx + p[1]*dy,
                                                       p[0]*sx + p[1]*sy)))
        block = len(found), exits
        for point in found:
            self.blocks[point] = block
        return block

    def slide(self, x, y, dp, cc):
        seen = set()
        while (x, y, dp, cc) not in seen:
            seen.add((x, y, dp, cc))
            dx, dy = DIRECTIONS[dp]
            color = self.color(x + dx, y + dy)
            if color == BLACK:
                cc ^= 1
                dp = (dp + 1) % 4
            else:
                x, y = x + dx, y + dy
                if color != WHITE:
                    return x, y, dp, cc
        return None

    def run(self, values=(), limit=1_000_000, tracing=False):
        values = iter(values)
        stack, output, trace = [], [], []
        x, y, dp, cc = 0, 0, 0, 0
        for step in range(limit):
            current = self.color(x, y)
            if current == BLACK:
                return Result("".join(output), stack, trace, step)
            if current == WHITE:
                landing = self.slide(x, y, dp, cc)
                if landing is None:
                    return Result("".join(output), stack, trace, step)
                x, y, dp, cc = landing
                continue
            area, exits = self.block(x, y)
            for attempt in range(8):
                ex, ey = exits[dp * 2 + cc]
                dx, dy = DIRECTIONS[dp]
                nx, ny = ex + dx, ey + dy
                following = self.color(nx, ny)
                if following != BLACK:
                    break
                if attempt % 2 == 0:
                    cc ^= 1
                else:
                    dp = (dp + 1) % 4
            else:
                return Result("".join(output), stack, trace, step)
            x, y = nx, ny
            if following == WHITE:
                continue
            h0, l0 = COLORS[current]
            h1, l1 = COLORS[following]
            op = COMMANDS[(h1 - h0) % 6][(l1 - l0) % 3]
            if tracing:
                trace.append((op, area if op == "push" else 0))
            if op == "push":
                stack.append(area)
            elif op.startswith("in_"):
                value = next(values, None)
                if value is not None:
                    stack.append(value)
            elif op in ("pop", "not", "dup", "pointer", "switch", "out_num", "out_char"):
                if not stack:
                    continue
                if op == "dup":
                    stack.append(stack[-1])
                elif op == "not":
                    stack[-1] = int(not stack[-1])
                else:
                    value = stack.pop()
                    if op == "pointer":
                        dp = (dp + value) % 4
                    elif op == "switch":
                        cc = (cc + value) % 2
                    elif op == "out_num":
                        output.append(str(value))
                    elif op == "out_char":
                        output.append(chr(value))
            elif op == "roll" and len(stack) >= 2:
                depth, count = stack[-2:]
                if not 1 <= depth <= len(stack) - 2:
                    continue
                del stack[-2:]
                count %= depth
                if count:
                    stack[-depth:] = stack[-count:] + stack[-depth:-count]
            elif op in ("add", "sub", "mul", "div", "mod", "gt") and len(stack) >= 2:
                a, b = stack[-2:]
                if op in ("div", "mod") and b == 0:
                    continue
                del stack[-2:]
                if op == "add":
                    value = a + b
                elif op == "sub":
                    value = a - b
                elif op == "mul":
                    value = a * b
                elif op == "div":
                    value = abs(a) // abs(b) * (-1 if (a < 0) != (b < 0) else 1)
                elif op == "mod":
                    value = a % b
                else:
                    value = int(a > b)
                stack.append(value)
        raise RuntimeError(f"Piet step limit exceeded ({limit})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--limit", type=int, default=1_000_000)
    args = parser.parse_args()
    result = Piet(args.image).run(map(int, sys.stdin.read().split()), args.limit)
    print(result.output, end="")
