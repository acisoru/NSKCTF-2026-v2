#!/usr/bin/env python3
"""Решёточная атака на ECDSA с укороченными случайными nonce.

Требуются fpylll, cysignals, ecdsa и pycryptodome.
"""

import hashlib
import json
import sys
from pathlib import Path

from Crypto.Cipher import AES
from ecdsa import SECP256k1
from fpylll import CVP, IntegerMatrix, LLL


def recover_private(data: dict) -> int:
    n = SECP256k1.order
    bound = 1 << data["nonce_reservoir_bits"]
    scale = 1 << (n.bit_length() - data["nonce_reservoir_bits"])
    rows = data["records"]
    count = len(rows)
    basis = IntegerMatrix(count + 1, count + 1)
    target = [0] * (count + 1)
    for index, row in enumerate(rows):
        r, s = int(row["r"], 16), int(row["s"], 16)
        z = int.from_bytes(hashlib.sha256(row["message"].encode()).digest(), "big")
        a = r * pow(s, -1, n) % n
        b = z * pow(s, -1, n) % n
        basis[index, index] = scale * n
        basis[count, index] = scale * a
        target[index] = scale * (bound // 2 - b)
    basis[count, count] = 1
    target[count] = n // 2

    LLL.reduction(basis)
    nearest = CVP.closest_vector(basis, target)
    candidate = int(nearest[count]) % n
    point = candidate * SECP256k1.generator
    if point.x() != int(data["public_key"]["x"], 16) or point.y() != int(data["public_key"]["y"], 16):
        raise ValueError("кандидат из решётки не совпал с открытым ключом")
    return candidate


def main() -> None:
    artifact = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "public" / "telemetry.json"
    data = json.loads(artifact.read_text())
    private = recover_private(data)
    release = data["release"]
    key = hashlib.sha256(bytes.fromhex(release["domain_hex"]) + private.to_bytes(32, "big")).digest()
    cipher = AES.new(key, AES.MODE_GCM, nonce=bytes.fromhex(release["iv"]))
    flag = cipher.decrypt_and_verify(bytes.fromhex(release["ciphertext"]), bytes.fromhex(release["tag"]))
    print(flag.decode())


if __name__ == "__main__":
    main()
