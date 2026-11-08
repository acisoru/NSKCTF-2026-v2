#!/usr/bin/env python3
"""Восстановить радиограмму без паддинга через КТО и точный кубический корень."""

import json
import math
import re
import sys
from pathlib import Path


def integer_cube_root(value: int) -> int:
    low, high = 0, 1 << ((value.bit_length() + 2) // 3 + 1)
    while low < high:
        mid = (low + high) // 2
        if mid**3 < value:
            low = mid + 1
        else:
            high = mid
    if low**3 != value:
        raise ValueError("результат КТО не является точным кубом")
    return low


def main() -> None:
    artifact = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "public" / "broadcast.json"
    data = json.loads(artifact.read_text())
    assert data["exponent"] == 3 and len(data["recipients"]) == 3
    pairs = [(int(row["n"]), int(row["ciphertext"])) for row in data["recipients"]]
    if any(math.gcd(a[0], b[0]) != 1 for i, a in enumerate(pairs) for b in pairs[i + 1 :]):
        raise ValueError("модули не являются попарно взаимно простыми")

    product = math.prod(n for n, _ in pairs)
    combined = sum(c * (product // n) * pow(product // n, -1, n) for n, c in pairs) % product
    plaintext = integer_cube_root(combined)
    bulletin = plaintext.to_bytes((plaintext.bit_length() + 7) // 8, "big")
    print(bulletin.decode())
    match = re.search(rb"nskctf\{[^}]+\}", bulletin)
    if not match:
        raise ValueError("во восстановленной радиограмме нет флага")


if __name__ == "__main__":
    main()
