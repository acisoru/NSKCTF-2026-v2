#!/usr/bin/env python3
"""Build synthetic DocuColor evidence. Author-only; never distribute src/."""

import argparse
import io
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from report import create_report, render_pages
from appendices import create_appendices
from scipy.ndimage import gaussian_filter

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 2480, 3508  # A4, 300 dpi
COPY = ("scan_03.pdf", "00483729", "2026-09-16T20:06", 0.41, (29, 95))


def encode_docucolor(serial: str, printed: datetime) -> np.ndarray:
    """EFF layout: top parity, left parity, 7 MSB-first bits per column.

    One-based columns: minute 2, hour 5, day 6, month 7, year 8,
    separator 10; serial BCD pairs in 14, 13, 12, 11.
    """
    if len(serial) != 8 or not serial.isascii() or not serial.isdecimal():
        raise ValueError("Serial must contain exactly eight ASCII decimal digits")
    if not 2000 <= printed.year <= 2099:
        raise ValueError("This fixture supports years 2000–2099")
    values = np.zeros(15, dtype=np.uint8)
    values[[1, 4, 5, 6, 7, 9]] = [
        printed.minute, printed.hour, printed.day, printed.month,
        printed.year - 2000, 127,
    ]
    for col, start in zip((13, 12, 11, 10), range(0, 8, 2)):
        pair = int(serial[start:start + 2], 16)
        if pair > 127:
            raise ValueError("BCD pair cannot exceed seven bits")
        values[col] = pair
    grid = np.zeros((8, 15), dtype=np.uint8)
    for row, bit in enumerate(range(6, -1, -1), start=1):
        grid[row] = (values >> bit) & 1
        grid[row, 0] = 1 ^ (int(grid[row, 1:].sum()) & 1)
    grid[0] = 1 ^ (grid[1:].sum(axis=0) % 2)
    assert np.all(grid.sum(axis=0) % 2 == 1)
    assert np.all(grid[1:].sum(axis=1) % 2 == 1)
    assert grid[0].sum() % 2 == 0  # NOT an odd-parity data row
    return grid


def scan(page, grid, angle, offset, rng) -> bytes:
    ink = np.asarray(page, dtype=np.float32) / 255
    yy = np.linspace(-1, 1, HEIGHT, dtype=np.float32)[:, None]
    xx = np.linspace(-1, 1, WIDTH, dtype=np.float32)[None, :]
    shade = 245 - 5 * xx - 3 * yy - 6 * (xx * xx + yy * yy)
    fibers = gaussian_filter(rng.normal(0, 1.8, (HEIGHT, WIDTH)).astype(np.float32), (0.35, 1.3))
    base = (shade + fibers) * (0.15 + 0.85 * ink)
    rgb = np.stack((base + 1.5, base + 0.5, base - 2.0), axis=-1)
    dots = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    active = np.argwhere(grid)
    pitch = 12
    # Staggered repetitions: 32 pitches across, 16 down, alternate rows +16.
    for band, y0 in enumerate(range(offset[1] - 384, HEIGHT, 16 * pitch)):
        for x0 in range(offset[0] - 768 + (band % 2) * 16 * pitch, WIDTH, 32 * pitch):
            for row, col in active:
                x, y = x0 + int(col) * pitch, y0 + int(row) * pitch
                if 3 <= x < WIDTH - 3 and 3 <= y < HEIGHT - 3 and rng.random() > 0.065:
                    dots[y, x] += rng.uniform(0.82, 1.18)
    # A few toner specks and absent dots make one block less reliable than consensus.
    for _ in range(380):
        dots[rng.integers(4, HEIGHT - 4), rng.integers(4, WIDTH - 4)] += rng.uniform(0.3, 1.1)
    dots = gaussian_filter(dots, 0.70)
    dots *= 155  # peak blue-channel absorption ~50 levels, dot only a few pixels
    rgb[:, :, 0] -= dots * 0.018
    rgb[:, :, 1] -= dots * 0.035
    rgb[:, :, 2] -= dots
    rgb += rng.normal(0, 0.65, rgb.shape).astype(np.float32)
    im = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
    im = im.filter(ImageFilter.GaussianBlur(0.22))
    im = im.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=(229, 228, 223))
    # Two JPEG passes simulate a scanner followed by an attachment export.
    temp = io.BytesIO()
    im.save(temp, format="JPEG", quality=94, subsampling=0)
    temp.seek(0)
    im = Image.open(temp)
    out = io.BytesIO()
    im.save(out, format="JPEG", quality=91, subsampling=0, dpi=(300, 300))
    return out.getvalue()




def build(output: Path, seed: int):
    output.mkdir(parents=True, exist_ok=True)
    master = create_report()
    master_path = HERE.parent / "output" / "pdf" / "confidential_report.pdf"
    master_path.parent.mkdir(parents=True, exist_ok=True)
    master_path.write_bytes(master)
    pages = list(render_pages(master, redact=True))
    rng = np.random.default_rng(seed)
    name, serial, stamp, angle, offset = COPY
    stream = io.BytesIO()
    pdf = Canvas(stream, pagesize=A4, invariant=1, pageCompression=1)
    pdf.setTitle("Архивная копия · РВ-26/09")
    pdf.setAuthor("Архивный пункт комиссии")
    grid = encode_docucolor(serial, datetime.fromisoformat(stamp))
    for i, page in enumerate(pages, 1):
        jpeg = scan(page, grid, angle + rng.uniform(-0.13, 0.13), offset, rng)
        pdf.drawImage(ImageReader(io.BytesIO(jpeg)), 0, 0, width=A4[0], height=A4[1])
        pdf.showPage()
        print(f"Built {name} page {i}/8: {len(jpeg):,} bytes", flush=True)
    pdf.save()
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(stream.getvalue())))
    writer.append(PdfReader(io.BytesIO(create_appendices())))
    writer.add_metadata({"/Title": "Архивная копия · РВ-26/09 · с приложением",
                         "/Author": "Архивный пункт комиссии"})
    target = output / name
    with target.open("wb") as destination:
        writer.write(destination)
    print(f"Wrote {target} ({target.stat().st_size:,} bytes, {len(writer.pages)} pages)")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE.parent / "public")
    parser.add_argument("--seed", type=int, default=20260917)
    args = parser.parse_args()
    build(args.output, args.seed)
