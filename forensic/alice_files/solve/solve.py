#!/usr/bin/env python3
"""Recover Xerox MIC and correlate it with the hardcoded public access log."""

import argparse
import csv
import io
import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from pypdf import PdfReader
from scipy.ndimage import gaussian_filter, maximum_filter
from scipy.spatial import cKDTree


# Transcribed from the public access log; no generator imports or PDF text parsing.
BUILDING_ZONE = "00000000"

ACCESS_LOG = list(csv.DictReader(io.StringIO("""timestamp,badge_id,surname,surname_ascii,zone,event,result
2026-09-17T00:12:14+07:00,B096,Кузнецов,kuznetsov,00000000,ENTER,GRANTED
2026-09-17T00:16:38+07:00,B103,Павлова,pavlova,00000000,ENTER,GRANTED
2026-09-17T00:16:47+07:00,B096,Кузнецов,kuznetsov,00635127,ENTER,DENIED
2026-09-17T00:19:24+07:00,B096,Кузнецов,kuznetsov,00483729,ENTER,GRANTED
2026-09-17T00:22:51+07:00,B117,Фомин,fomin,00000000,ENTER,GRANTED
2026-09-17T00:27:16+07:00,B124,Никитина,nikitina,00000000,ENTER,GRANTED
2026-09-17T00:28:51+07:00,B096,Кузнецов,kuznetsov,00483729,EXIT,GRANTED
2026-09-17T00:32:17+07:00,B103,Павлова,pavlova,00483729,ENTER,GRANTED
2026-09-17T00:33:42+07:00,B138,Егоров,egorov,00000000,ENTER,GRANTED
2026-09-17T00:37:59+07:00,B145,Макарова,makarova,00000000,ENTER,GRANTED
2026-09-17T00:38:22+07:00,B117,Фомин,fomin,00712643,ENTER,DENIED
2026-09-17T00:41:23+07:00,B152,Громов,gromov,00000000,ENTER,GRANTED
2026-09-17T00:41:38+07:00,B103,Павлова,pavlova,00483729,EXIT,GRANTED
2026-09-17T00:45:06+07:00,B117,Фомин,fomin,00483729,ENTER,GRANTED
2026-09-17T00:46:17+07:00,B168,Тихонова,tikhonova,00000000,ENTER,GRANTED
2026-09-17T00:48:10+07:00,B027,Морозов,morozov,00000000,ENTER,GRANTED
2026-09-17T00:51:34+07:00,B176,Васильев,vasilev,00000000,ENTER,GRANTED
2026-09-17T00:52:44+07:00,B072,Волкова,volkova,00000000,ENTER,GRANTED
2026-09-17T00:54:43+07:00,B117,Фомин,fomin,00483729,EXIT,GRANTED
2026-09-17T00:56:49+07:00,B183,Романова,romanova,00000000,ENTER,GRANTED
2026-09-17T00:58:12+07:00,B058,Соколова,sokolova,00000000,ENTER,GRANTED
2026-09-17T00:59:27+07:00,B124,Никитина,nikitina,00483729,ENTER,GRANTED
2026-09-17T01:01:21+07:00,B014,Белов,belov,00000000,ENTER,GRANTED
2026-09-17T01:02:17+07:00,B197,Зорин,zorin,00000000,ENTER,GRANTED
2026-09-17T01:03:48+07:00,B138,Егоров,egorov,00542817,ENTER,DENIED
2026-09-17T01:04:18+07:00,B096,Кузнецов,kuznetsov,00174256,ENTER,GRANTED
2026-09-17T01:05:30+07:00,B031,Лебедева,lebedeva,00000000,ENTER,GRANTED
2026-09-17T01:07:42+07:00,B204,Котов,kotov,00000000,ENTER,GRANTED
2026-09-17T01:08:13+07:00,B085,Зайцев,zaytsev,00000000,ENTER,GRANTED
2026-09-17T01:08:56+07:00,B124,Никитина,nikitina,00483729,EXIT,GRANTED
2026-09-17T01:10:04+07:00,B044,Крылов,krylov,00000000,ENTER,GRANTED
2026-09-17T01:12:06+07:00,B063,Орлов,orlov,00000000,ENTER,GRANTED
2026-09-17T01:12:46+07:00,B138,Егоров,egorov,00483729,ENTER,GRANTED
2026-09-17T01:13:29+07:00,B218,Миронова,mironova,00000000,ENTER,GRANTED
2026-09-17T01:14:42+07:00,B096,Кузнецов,kuznetsov,00174256,EXIT,GRANTED
2026-09-17T01:18:53+07:00,B225,Фролов,frolov,00000000,ENTER,GRANTED
2026-09-17T01:19:36+07:00,B058,Соколова,sokolova,00712643,ENTER,DENIED
2026-09-17T01:20:26+07:00,B103,Павлова,pavlova,00635127,ENTER,GRANTED
2026-09-17T01:22:19+07:00,B138,Егоров,egorov,00483729,EXIT,GRANTED
2026-09-17T01:23:41+07:00,B239,Алексеева,alekseeva,00000000,ENTER,GRANTED
2026-09-17T01:26:04+07:00,B145,Макарова,makarova,00483729,ENTER,GRANTED
2026-09-17T01:28:14+07:00,B027,Морозов,morozov,00635127,ENTER,GRANTED
2026-09-17T01:29:18+07:00,B246,Данилов,danilov,00000000,ENTER,GRANTED
2026-09-17T01:31:48+07:00,B103,Павлова,pavlova,00635127,EXIT,GRANTED
2026-09-17T01:34:26+07:00,B152,Громов,gromov,00174256,ENTER,DENIED
2026-09-17T01:34:50+07:00,B027,Морозов,morozov,00635127,EXIT,GRANTED
2026-09-17T01:35:57+07:00,B145,Макарова,makarova,00483729,EXIT,GRANTED
2026-09-17T01:37:08+07:00,B031,Лебедева,lebedeva,00635127,ENTER,DENIED
2026-09-17T01:39:13+07:00,B152,Громов,gromov,00483729,ENTER,GRANTED
2026-09-17T01:40:20+07:00,B031,Лебедева,lebedeva,00712643,ENTER,GRANTED
2026-09-17T01:43:22+07:00,B117,Фомин,fomin,00542817,ENTER,GRANTED
2026-09-17T01:44:03+07:00,B031,Лебедева,lebedeva,00712643,EXIT,GRANTED
2026-09-17T01:47:46+07:00,B152,Громов,gromov,00483729,EXIT,GRANTED
2026-09-17T01:50:12+07:00,B014,Белов,belov,00483729,ENTER,GRANTED
2026-09-17T01:55:37+07:00,B117,Фомин,fomin,00542817,EXIT,GRANTED
2026-09-17T01:56:29+07:00,B014,Белов,belov,00483729,EXIT,GRANTED
2026-09-17T01:58:43+07:00,B176,Васильев,vasilev,00542817,ENTER,DENIED
2026-09-17T02:00:24+07:00,B168,Тихонова,tikhonova,00483729,ENTER,GRANTED
2026-09-17T02:02:33+07:00,B124,Никитина,nikitina,00712643,ENTER,GRANTED
2026-09-17T02:07:43+07:00,B014,Белов,belov,00712643,ENTER,DENIED
2026-09-17T02:09:51+07:00,B168,Тихонова,tikhonova,00483729,EXIT,GRANTED
2026-09-17T02:12:08+07:00,B176,Васильев,vasilev,00483729,ENTER,GRANTED
2026-09-17T02:13:47+07:00,B124,Никитина,nikitina,00712643,EXIT,GRANTED
2026-09-17T02:14:03+07:00,B085,Зайцев,zaytsev,00712643,ENTER,GRANTED
2026-09-17T02:14:22+07:00,B014,Белов,belov,00635127,ENTER,GRANTED
2026-09-17T02:20:47+07:00,B176,Васильев,vasilev,00483729,EXIT,GRANTED
2026-09-17T02:21:09+07:00,B014,Белов,belov,00635127,EXIT,GRANTED
2026-09-17T02:23:30+07:00,B085,Зайцев,zaytsev,00712643,EXIT,GRANTED
2026-09-17T02:23:34+07:00,B183,Романова,romanova,00483729,ENTER,GRANTED
2026-09-17T02:27:12+07:00,B138,Егоров,egorov,00174256,ENTER,GRANTED
2026-09-17T02:29:42+07:00,B183,Романова,romanova,00483729,EXIT,GRANTED
2026-09-17T02:31:15+07:00,B044,Крылов,krylov,00483729,ENTER,GRANTED
2026-09-17T02:34:52+07:00,B197,Зорин,zorin,00712643,ENTER,DENIED
2026-09-17T02:37:50+07:00,B058,Соколова,sokolova,00635127,ENTER,GRANTED
2026-09-17T02:37:51+07:00,B044,Крылов,krylov,00483729,EXIT,GRANTED
2026-09-17T02:38:51+07:00,B138,Егоров,egorov,00174256,EXIT,GRANTED
2026-09-17T02:39:02+07:00,B063,Орлов,orlov,00712643,ENTER,GRANTED
2026-09-17T02:39:12+07:00,B027,Морозов,morozov,00483729,ENTER,GRANTED
2026-09-17T02:43:17+07:00,B183,Романова,romanova,00542817,ENTER,GRANTED
2026-09-17T02:46:31+07:00,B027,Морозов,morozov,00483729,EXIT,GRANTED
2026-09-17T02:47:15+07:00,B058,Соколова,sokolova,00635127,EXIT,GRANTED
2026-09-17T02:48:54+07:00,B063,Орлов,orlov,00712643,EXIT,GRANTED
2026-09-17T02:49:15+07:00,B197,Зорин,zorin,00483729,ENTER,GRANTED
2026-09-17T02:51:14+07:00,B145,Макарова,makarova,00635127,ENTER,GRANTED
2026-09-17T02:51:26+07:00,B085,Зайцев,zaytsev,00483729,ENTER,DENIED
2026-09-17T02:53:28+07:00,B218,Миронова,mironova,00635127,ENTER,DENIED
2026-09-17T02:56:38+07:00,B183,Романова,romanova,00542817,EXIT,GRANTED
2026-09-17T02:57:43+07:00,B197,Зорин,zorin,00483729,EXIT,GRANTED
2026-09-17T02:58:19+07:00,B044,Крылов,krylov,00483729,ENTER,DENIED
2026-09-17T03:00:08+07:00,B204,Котов,kotov,00483729,ENTER,GRANTED
2026-09-17T03:00:34+07:00,B152,Громов,gromov,00542817,ENTER,GRANTED
2026-09-17T03:01:37+07:00,B145,Макарова,makarova,00635127,EXIT,GRANTED
2026-09-17T03:01:48+07:00,B168,Тихонова,tikhonova,00712643,ENTER,GRANTED
2026-09-17T03:02:12+07:00,B204,Котов,kotov,00483729,EXIT,GRANTED
2026-09-17T03:02:39+07:00,B072,Волкова,volkova,00635127,ENTER,GRANTED
2026-09-17T03:03:27+07:00,B031,Лебедева,lebedeva,00483729,ENTER,GRANTED
2026-09-17T03:09:40+07:00,B031,Лебедева,lebedeva,00483729,EXIT,GRANTED
2026-09-17T03:11:08+07:00,B218,Миронова,mironova,00483729,ENTER,GRANTED
2026-09-17T03:11:45+07:00,B072,Волкова,volkova,00635127,EXIT,GRANTED
2026-09-17T03:12:52+07:00,B168,Тихонова,tikhonova,00712643,EXIT,GRANTED
2026-09-17T03:13:52+07:00,B063,Орлов,orlov,00635127,ENTER,DENIED
2026-09-17T03:14:29+07:00,B152,Громов,gromov,00542817,EXIT,GRANTED
2026-09-17T03:15:22+07:00,B176,Васильев,vasilev,00174256,ENTER,GRANTED
2026-09-17T03:15:47+07:00,B218,Миронова,mironova,00483729,EXIT,GRANTED
2026-09-17T03:16:40+07:00,B027,Морозов,morozov,00000000,EXIT,GRANTED
2026-09-17T03:17:32+07:00,B058,Соколова,sokolova,00483729,ENTER,GRANTED
2026-09-17T03:19:27+07:00,B096,Кузнецов,kuznetsov,00000000,EXIT,GRANTED
2026-09-17T03:20:54+07:00,B085,Зайцев,zaytsev,00000000,EXIT,GRANTED
2026-09-17T03:22:06+07:00,B058,Соколова,sokolova,00483729,EXIT,GRANTED
2026-09-17T03:23:58+07:00,B103,Павлова,pavlova,00000000,EXIT,GRANTED
2026-09-17T03:24:15+07:00,B225,Фролов,frolov,00483729,ENTER,GRANTED
2026-09-17T03:25:11+07:00,B031,Лебедева,lebedeva,00000000,EXIT,GRANTED
2026-09-17T03:27:44+07:00,B117,Фомин,fomin,00000000,EXIT,GRANTED
2026-09-17T03:27:53+07:00,B239,Алексеева,alekseeva,00174256,ENTER,DENIED
2026-09-17T03:28:49+07:00,B176,Васильев,vasilev,00174256,EXIT,GRANTED
2026-09-17T03:29:36+07:00,B197,Зорин,zorin,00000000,EXIT,GRANTED
2026-09-17T03:30:00+07:00,B058,Соколова,sokolova,00000000,EXIT,GRANTED
2026-09-17T03:31:25+07:00,B124,Никитина,nikitina,00000000,EXIT,GRANTED
2026-09-17T03:32:48+07:00,B204,Котов,kotov,00000000,EXIT,GRANTED
2026-09-17T03:33:46+07:00,B225,Фролов,frolov,00483729,EXIT,GRANTED
2026-09-17T03:34:10+07:00,B063,Орлов,orlov,00000000,EXIT,GRANTED
2026-09-17T03:35:17+07:00,B138,Егоров,egorov,00000000,EXIT,GRANTED
2026-09-17T03:36:22+07:00,B239,Алексеева,alekseeva,00483729,ENTER,GRANTED
2026-09-17T03:37:24+07:00,B218,Миронова,mironova,00000000,EXIT,GRANTED
2026-09-17T03:38:26+07:00,B145,Макарова,makarova,00000000,EXIT,GRANTED
2026-09-17T03:40:11+07:00,B072,Волкова,volkova,00000000,EXIT,GRANTED
2026-09-17T03:41:16+07:00,B225,Фролов,frolov,00000000,EXIT,GRANTED
2026-09-17T03:42:38+07:00,B152,Громов,gromov,00000000,EXIT,GRANTED
2026-09-17T03:45:00+07:00,B014,Белов,belov,00000000,EXIT,GRANTED
2026-09-17T03:45:51+07:00,B239,Алексеева,alekseeva,00483729,EXIT,GRANTED
2026-09-17T03:46:52+07:00,B168,Тихонова,tikhonova,00000000,EXIT,GRANTED
2026-09-17T03:48:01+07:00,B044,Крылов,krylov,00000000,EXIT,GRANTED
2026-09-17T03:48:32+07:00,B246,Данилов,danilov,00483729,ENTER,GRANTED
2026-09-17T03:49:37+07:00,B239,Алексеева,alekseeva,00000000,EXIT,GRANTED
2026-09-17T03:50:27+07:00,B176,Васильев,vasilev,00000000,EXIT,GRANTED
2026-09-17T03:54:41+07:00,B183,Романова,romanova,00000000,EXIT,GRANTED
2026-09-17T03:56:14+07:00,B246,Данилов,danilov,00483729,EXIT,GRANTED
2026-09-17T03:58:47+07:00,B246,Данилов,danilov,00000000,EXIT,GRANTED
""")))


def decode_grid(grid):
    """Decode independently using the published EFF column map."""
    if grid.shape != (8, 15):
        raise ValueError("Expected 15 columns and 8 rows")
    if np.any(grid.sum(axis=0) % 2 != 1) or np.any(grid[1:].sum(axis=1) % 2 != 1):
        raise ValueError("Odd parity check failed")
    values = (grid[1:] * np.array([64, 32, 16, 8, 4, 2, 1])[:, None]).sum(axis=0)
    if values[9] != 127:
        raise ValueError("Missing separator")
    if any(values[i] != 0 for i in (2, 3, 8, 14)):
        raise ValueError("Unexpected reserved column in this DocuColor profile")
    serial = ""
    for index in (13, 12, 11, 10):
        high, low = divmod(int(values[index]), 16)
        if high > 9 or low > 9:
            raise ValueError("Invalid BCD serial")
        serial += f"{high}{low}"
    printed = datetime(2000 + int(values[7]), int(values[6]), int(values[5]),
                       int(values[4]), int(values[1]))
    return serial, printed.isoformat(timespec="minutes")


def yellow_points(im):
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    # Yellow ink absorbs blue; common brightness/gray text cancels in this difference.
    signal = np.minimum(rgb[:, :, 0], rgb[:, :, 1]) - rgb[:, :, 2]
    signal -= gaussian_filter(signal, 4)
    mask = (signal > 6.0) & (signal == maximum_filter(signal, size=5))
    mask &= np.min(rgb, axis=2) > 135
    mask[:15] = mask[-15:] = False
    mask[:, :15] = mask[:, -15:] = False
    yy, xx = np.nonzero(mask)
    points = np.stack([xx, yy], axis=1).astype(np.float64)
    # Subpixel centroid substantially improves deskew over a 3508-pixel page.
    weighted = np.zeros_like(points)
    weight = np.zeros(len(points))
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            w = np.maximum(signal[yy + dy, xx + dx] - 1.5, 0)
            weight += w
            weighted += np.stack([xx + dx, yy + dy], axis=1) * w[:, None]
    points = weighted / weight[:, None]
    if len(points) < 200:
        raise ValueError("Too few yellow dot candidates")
    return points, signal


def fit_lattice(points):
    # Estimate spacing/angle from local neighbours; neither comes from the source.
    pairs = cKDTree(points).query_pairs(30, output_type="ndarray")
    vectors = points[pairs[:, 1]] - points[pairs[:, 0]]
    horiz = vectors[np.abs(vectors[:, 1]) < 0.12 * np.abs(vectors[:, 0])]
    horiz = horiz * np.where(horiz[:, :1] < 0, -1, 1)
    vert = vectors[np.abs(vectors[:, 0]) < 0.12 * np.abs(vectors[:, 1])]
    vert = vert * np.where(vert[:, 1:] < 0, -1, 1)
    equivalent = np.concatenate([horiz, np.stack([vert[:, 1], -vert[:, 0]], axis=1)])
    lengths = np.linalg.norm(equivalent, axis=1)
    hist, edges = np.histogram(lengths, bins=np.arange(7, 21.1, 0.2))
    peak = (edges[np.argmax(hist)] + edges[np.argmax(hist) + 1]) / 2
    chosen = equivalent[np.abs(lengths - peak) < 0.7]
    dx, dy = np.mean(chosen, axis=0)
    basis = np.array([[dx, -dy], [dy, dx]])
    unit = points @ np.linalg.inv(basis).T
    phase = np.angle(np.mean(np.exp(2j * np.pi * unit), axis=0)) / (2 * np.pi)
    origin = phase @ basis.T
    for _ in range(5):
        unit = (points - origin) @ np.linalg.inv(basis).T
        cells = np.rint(unit)
        good = np.max(np.abs(unit - cells), axis=1) < 0.19
        design = np.column_stack([cells[good], np.ones(good.sum())])
        fitted = np.linalg.lstsq(design, points[good], rcond=None)[0]
        basis, origin = fitted[:2].T, fitted[2]
    unit = (points - origin) @ np.linalg.inv(basis).T
    cells = np.rint(unit).astype(int)
    good = np.max(np.abs(unit - cells), axis=1) < 0.19
    cells = cells[good]
    low, high = cells.min(axis=0), cells.max(axis=0)
    lattice = np.zeros((high[1] - low[1] + 1, high[0] - low[0] + 1), dtype=np.float64)
    lattice[cells[:, 1] - low[1], cells[:, 0] - low[0]] = 1
    return lattice, basis, origin, low, int(good.sum())


def recurrence(lattice, axis):
    scores = {}
    for lag in range(16, min(81, lattice.shape[axis] // 2)):
        a = np.take(lattice, range(lattice.shape[axis] - lag), axis=axis).ravel()
        b = np.take(lattice, range(lag, lattice.shape[axis]), axis=axis).ravel()
        scores[lag] = float(np.corrcoef(a, b)[0, 1])
    best = max(scores.values())
    if best < 0.35:
        raise ValueError("No convincing repeating grid")
    # Prefer the fundamental over a multiple with a similar correlation.
    return min(lag for lag, value in scores.items() if value >= best * 0.88)


def recover(im, debug_prefix=None):
    points, signal = yellow_points(im)
    lattice, basis, origin, low, used = fit_lattice(points)
    px, py = recurrence(lattice, 1), recurrence(lattice, 0)
    yy, xx = np.indices(lattice.shape)
    buckets = (yy % py) * px + xx % px
    sums = np.bincount(buckets.ravel(), weights=lattice.ravel(), minlength=px * py)
    counts = np.bincount(buckets.ravel(), minlength=px * py)
    consensus = (sums / counts).reshape(py, px)
    # Fit the two occupancy populations instead of assuming a dot intensity.
    lower, upper = 0.0, float(consensus.max())
    for _ in range(8):
        cut = (lower + upper) / 2
        lower = float(consensus[consensus <= cut].mean())
        upper = float(consensus[consensus > cut].mean())
    binary = np.uint8(consensus > (lower + upper) / 2)
    found = Counter()
    picked = None
    for turn in range(4):
        oriented = np.rot90(binary, turn)
        tiled = np.tile(oriented, (2, 2))
        for y in range(oriented.shape[0]):
            for x in range(oriented.shape[1]):
                grid = tiled[y:y + 8, x:x + 15]
                try:
                    value = decode_grid(grid)
                except ValueError:
                    continue
                found[value] += 1
                picked = grid
    if len(found) != 1:
        raise ValueError(f"Expected a unique parity-valid MIC, found {dict(found)}")
    (serial, printed), repetitions = next(iter(found.items()))
    if debug_prefix:
        debug_prefix.parent.mkdir(parents=True, exist_ok=True)
        enhanced = Image.fromarray(np.uint8(255 - np.clip(signal * 14, 0, 255)))
        enhanced.save(str(debug_prefix) + "-blue.png")
        Image.fromarray(np.uint8(255 - consensus * 255)).resize(
            (px * 16, py * 16), Image.Resampling.NEAREST).save(str(debug_prefix) + "-consensus.png")
        Image.fromarray(np.uint8(255 - picked * 255)).resize(
            (15 * 28, 8 * 28), Image.Resampling.NEAREST).save(str(debug_prefix) + "-grid.png")
    return {
        "serial": serial, "printer_time": printed,
        "spacing_px": round(float(np.linalg.norm(basis[:, 0])), 4),
        "angle_deg": round(math.degrees(math.atan2(basis[1, 0], basis[0, 0])), 4),
        "period_cells": [px, py], "dot_candidates": len(points),
        "lattice_dots": used, "matching_blocks": repetitions,
        "column_parity": "15/15 odd", "data_row_parity": "7/7 odd",
    }


def presence_at(rows, instant):
    active, names = {}, {}
    for row in sorted(rows, key=lambda r: datetime.fromisoformat(r["timestamp"])):
        t = datetime.fromisoformat(row["timestamp"])
        if t > instant:
            break
        if row["result"] != "GRANTED":
            continue
        key = (row["zone"], row["badge_id"])
        names[row["badge_id"]] = (row["surname"], row["surname_ascii"])
        if row["event"] == "ENTER":
            if key in active:
                raise ValueError(f"Duplicate ENTER: {key}")
            active[key] = t
        elif row["event"] == "EXIT":
            if key not in active:
                raise ValueError(f"EXIT without ENTER: {key}")
            del active[key]
        else:
            raise ValueError(f"Unknown event {row['event']}")
    return active, names


def identify(decoded, rows):
    serial = decoded["serial"]
    if serial == BUILDING_ZONE or not any(row["zone"] == serial for row in rows):
        raise ValueError("Decoded serial does not match any access zone")
    start = datetime.fromisoformat(decoded["printer_time"]).replace(tzinfo=timezone.utc)
    end = start + timedelta(minutes=1)
    # MIC has minute precision: inspect all changes inside that minute.
    instants = {start}
    instants.update(t for r in rows if start < (t := datetime.fromisoformat(r["timestamp"])) < end)
    candidates, names = set(), {}
    for instant in sorted(instants):
        active, names = presence_at(rows, instant)
        occupants = {badge for zone, badge in active if zone == serial}
        in_building = {badge for zone, badge in active if zone == BUILDING_ZONE}
        if not occupants or not occupants <= in_building:
            raise ValueError("A full print minute must have registered presence")
        candidates |= occupants
    if len(candidates) != 1:
        raise ValueError(f"Ambiguous employee during the print minute: {candidates}")
    badge = candidates.pop()
    surname, ascii_name = names[badge]
    local = start.astimezone(timezone(timedelta(hours=7)))
    return {"serial": serial, "local_time": local.isoformat(timespec="minutes"),
            "badge_id": badge, "surname": surname, "surname_ascii": ascii_name,
            "answer": f"nskctf{{{ascii_name}_{local:%H%M}}}"}


def solve(path, all_pages=False, debug_dir=None):
    reader = PdfReader(path)
    scan_pages = [i for i, page in enumerate(reader.pages)
                  if len(page.images) == 1]
    if not scan_pages:
        raise ValueError("No scanned report pages")
    selected = scan_pages if all_pages else scan_pages[:1]
    recovered = []
    for index in selected:
        debug = debug_dir / f"{path.stem}-{index+1:02d}" if debug_dir else None
        decoded = recover(reader.pages[index].images[0].image, debug)
        recovered.append(decoded)
        print(f"{path.name} [{index+1}/{len(scan_pages)}]: {decoded['serial']} / {decoded['printer_time']}", flush=True)
    if len({(r['serial'], r['printer_time']) for r in recovered}) != 1:
        raise ValueError("Pages in the report disagree")
    person = identify(recovered[0], ACCESS_LOG)
    print(person["answer"])
    return {"mic": recovered, "person": person, "flag": person["answer"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--all-pages", action="store_true")
    parser.add_argument("--debug-dir", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    result = solve(args.pdf, args.all_pages, args.debug_dir)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
