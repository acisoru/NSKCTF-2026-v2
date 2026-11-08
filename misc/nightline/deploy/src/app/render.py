from functools import lru_cache
import hashlib
import io
import math
import os
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFont

from .puzzle import MAP_HEIGHT, MAP_WIDTH, Puzzle, generate


BACKGROUND = "#101b22"
RED = "#ff7866"
BLUE = "#75bfff"
LIME = "#d6f47b"


@lru_cache(maxsize=24)
def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    configured = os.environ.get("MAP_FONT_BOLD" if bold else "MAP_FONT")
    choices = [
        configured,
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",
        f"/System/Library/Fonts/Supplemental/Arial{' Bold' if bold else ''}.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for choice in choices:
        if choice and Path(choice).is_file():
            return ImageFont.truetype(choice, size)
    raise RuntimeError("Не найден шрифт карты. Установите DejaVu Sans или задайте MAP_FONT и MAP_FONT_BOLD")


def quadratic(start: tuple, control: tuple, end: tuple, t: float) -> tuple[float, float]:
    return (
        (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t * t * end[0],
        (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t * t * end[1],
    )


def cubic(start: tuple, first: tuple, second: tuple, end: tuple, t: float) -> tuple[float, float]:
    return tuple(
        (1 - t) ** 3 * start[index]
        + 3 * (1 - t) ** 2 * t * first[index]
        + 3 * (1 - t) * t * t * second[index]
        + t ** 3 * end[index]
        for index in (0, 1)
    )


def arrow(draw: ImageDraw.ImageDraw, point: tuple, angle: float, color: str) -> None:
    direction = (math.cos(angle), math.sin(angle))
    normal = (-direction[1], direction[0])
    tip = (point[0] + direction[0] * 13, point[1] + direction[1] * 13)
    base = (point[0] - direction[0] * 10, point[1] - direction[1] * 10)
    draw.polygon(
        [tip, (base[0] + normal[0] * 9, base[1] + normal[1] * 9), (base[0] - normal[0] * 9, base[1] - normal[1] * 9)],
        fill=color,
    )


def road(draw: ImageDraw.ImageDraw, puzzle: Puzzle, source: int, destination: int, command: str) -> None:
    start = puzzle.positions[source]
    end = puzzle.positions[destination]
    color = RED if command == "R" else BLUE
    if source == destination:
        x, y = start
        points = [cubic((x + 19, y + 5), (x + 130, y + 16), (x + 92, y + 132), (x - 8, y + 25), t / 80) for t in range(81)]
    else:
        dx, dy = end[0] - start[0], end[1] - start[1]
        distance = math.hypot(dx, dy)
        normal = (-dy / distance, dx / distance)
        offset = -12 if command == "R" else 55
        control = ((start[0] + end[0]) / 2 + normal[0] * offset, (start[1] + end[1]) / 2 + normal[1] * offset)
        points = [quadratic(start, control, end, t / 100) for t in range(101)]
    draw.line(points, fill="#0c171f", width=15, joint="curve")
    if command == "R":
        draw.line(points, fill=color, width=6, joint="curve")
    else:
        traveled = 0.0
        for first, second in zip(points, points[1:]):
            length = math.dist(first, second)
            if int(traveled / 16) % 2 == 0:
                draw.line((first, second), fill=color, width=6)
            traveled += length
    index = int(len(points) * 0.70)
    first, second = points[index - 1], points[index + 1]
    arrow(draw, points[index], math.atan2(second[1] - first[1], second[0] - first[0]), color)
    label_index = int(len(points) * 0.41)
    x, y = points[label_index]
    draw.rounded_rectangle((x - 13, y - 15, x + 13, y + 15), radius=6, fill="#13232c", outline=color, width=1)
    draw.text((x, y - 1), command, font=font(19, True), fill=color, anchor="mm")


def background(puzzle: Puzzle) -> Image.Image:
    rng = random.Random(int.from_bytes(hashlib.sha256((puzzle.seed + "scenery").encode()).digest(), "big"))
    image = Image.new("RGB", (MAP_WIDTH, MAP_HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    for x in range(0, MAP_WIDTH, 64):
        draw.line((x, 0, x, MAP_HEIGHT), fill="#15222a", width=1)
    for y in range(0, MAP_HEIGHT, 64):
        draw.line((0, y, MAP_WIDTH, y), fill="#15222a", width=1)
    coast = [(1918 + int(30 * math.sin(y / 180)), y) for y in range(0, MAP_HEIGHT + 64, 32)]
    draw.polygon(coast + [(MAP_WIDTH, MAP_HEIGHT), (MAP_WIDTH, 0)], fill="#102b36")
    draw.line(coast, fill="#214451", width=3)
    for y in (380, 720, 1110):
        draw.rounded_rectangle((1865, y, 1980, y + 29), radius=3, fill="#263b43")
        draw.line((1880, y + 10, 1970, y + 10), fill="#3b535b", width=2)
    for row in range(3):
        for column in range(4):
            left = 265 + column * 376 + 65
            top = 255 + row * 337 + 69
            if (row + column) % 5 == 0:
                draw.rounded_rectangle((left - 7, top - 4, left + 230, top + 185), radius=18, fill="#172b29", outline="#203b32", width=2)
                for _ in range(20):
                    x = rng.randint(int(left + 10), int(left + 210))
                    y = rng.randint(int(top + 10), int(top + 165))
                    radius = rng.randint(7, 15)
                    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=rng.choice(("#214035", "#284638", "#1d392f")))
            else:
                for building_row in range(3):
                    for building_column in range(3):
                        x = left + building_column * 78 + rng.randint(-6, 6)
                        y = top + building_row * 59 + rng.randint(-5, 5)
                        width, height = rng.randint(43, 65), rng.randint(31, 45)
                        draw.rounded_rectangle((x + 4, y + 5, x + width + 4, y + height + 5), radius=3, fill="#0c161c")
                        draw.rounded_rectangle((x, y, x + width, y + height), radius=3, fill=rng.choice(("#22313a", "#26343b", "#1d3038")), outline="#34464d", width=1)
                        draw.line((x + 6, y + 6, x + width - 6, y + 6), fill="#3c4e53", width=2)
                        if rng.random() < 0.45:
                            draw.rectangle((x + width - 14, y + 10, x + width - 9, y + 15), fill="#8c8153")
    for y in range(330, 1250, 105):
        draw.rounded_rectangle((66, y, 133, y + 62), radius=4, fill="#21333b", outline="#344a52", width=2)
        draw.line((76, y + 9, 121, y + 9), fill="#4a6065", width=2)
    draw.text((78, 95), "NIGHTLINE / АРХИВ ALICE / HACKED", font=font(19, True), fill="#91a6ac")
    draw.text((78, 135), puzzle.district.upper(), font=font(34, True), fill="#dae6e6")
    draw.line((78, 183, 287, 183), fill="#566a6c", width=2)
    draw.text((78, 190), "СХЕМА НАПРАВЛЕНИЙ", font=font(13), fill="#71898e")
    draw.text((78, 1450), "СОЕДИНЕНИЯ ТОЛЬКО В НУМЕРОВАННЫХ УЗЛАХ", font=font(16), fill="#70878d")
    draw.line((1450, 1459, 1790, 1459), fill="#536a70", width=2)
    for x in range(1450, 1791, 85):
        draw.line((x, 1453, x, 1465), fill="#536a70", width=2)
    draw.text((1450, 1481), "ГОРОДСКОЙ КОНТУР / 20 УЗЛОВ", font=font(14), fill="#70878d")
    draw.text((1910, 102), "N", font=font(23, True), fill="#adc0c2", anchor="mm")
    draw.polygon(((1910, 129), (1901, 160), (1910, 153), (1919, 160)), fill="#adc0c2")
    return image


@lru_cache(maxsize=96)
def render_map(seed: str, layer: str = "all") -> bytes:
    puzzle = generate(seed)
    image = background(puzzle)
    draw = ImageDraw.Draw(image)
    if layer in {"all", "red"}:
        for source, destination in enumerate(puzzle.red):
            road(draw, puzzle, source, destination, "R")
    if layer in {"all", "blue"}:
        for source, destination in enumerate(puzzle.blue):
            road(draw, puzzle, source, destination, "B")
    for node, (x, y) in enumerate(puzzle.positions):
        if node == puzzle.target:
            draw.ellipse((x - 44, y - 44, x + 44, y + 44), fill="#27392b", outline="#53663d", width=1)
            draw.ellipse((x - 32, y - 32, x + 32, y + 32), fill="#182a2b", outline=LIME, width=5)
            if y < 300 and x < 400:
                label_x, label_y = x - 105, y
            else:
                label_x, label_y = x, y - 67
            draw.rounded_rectangle((label_x - 50, label_y - 16, label_x + 50, label_y + 16), radius=7, fill=LIME)
            draw.text((label_x, label_y), "СКЛАД", font=font(18, True), fill="#1b2718", anchor="mm")
            fill = LIME
        else:
            draw.ellipse((x - 27, y - 25, x + 29, y + 31), fill="#071219")
            draw.ellipse((x - 26, y - 26, x + 26, y + 26), fill="#182a32", outline="#80949a", width=3)
            fill = "#e5eeee"
        draw.text((x, y), f"{node + 1:02}", font=font(23, True), fill=fill, anchor="mm")
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()
