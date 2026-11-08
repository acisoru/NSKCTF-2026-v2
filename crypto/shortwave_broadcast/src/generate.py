#!/usr/bin/env python3
"""Собрать три копии архивной радиограммы. Требуется pycryptodome."""

import argparse
import json
from pathlib import Path

from Crypto.Util.number import getPrime


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flag", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    if not (args.flag.startswith("nskctf{") and args.flag.endswith("}")):
        parser.error("флаг должен иметь формат nskctf{}")

    # Одного шифртекста недостаточно для извлечения кубического корня.
    # При этом сообщение помещается под каждый 1024-битный модуль.
    bulletin = (
        "ЛАБОРАТОРИЯ X\n"
        "ALICE / АРХИВ\n"
        "ПРОБЕЛ: 559 СУТОК\n"
        f"КОД: {args.flag}\n"
    ).encode("utf-8")
    message = int.from_bytes(bulletin, "big")
    recipients = []
    for station in ("СЕВЕР", "ВОСТОК", "ЗАПАД"):
        while True:
            p, q = getPrime(512), getPrime(512)
            if p != q and (p - 1) % 3 and (q - 1) % 3:
                break
        modulus = p * q
        assert message < modulus
        recipients.append(
            {"station": station, "n": str(modulus), "ciphertext": str(pow(message, 3, modulus))}
        )

    assert message**3 > max(int(item["n"]) for item in recipients)
    assert message**3 < __import__("math").prod(int(item["n"]) for item in recipients)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"scheme": "RSA", "exponent": 3, "recipients": recipients}, indent=2, ensure_ascii=False) + "\n"
    )


if __name__ == "__main__":
    main()
