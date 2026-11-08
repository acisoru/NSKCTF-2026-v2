#!/usr/bin/env python3
"""Build an EC relation ledger with exactly one missing cycle."""

import argparse
import ctypes
import ctypes.util
import hashlib
import io
import secrets
import struct
from pathlib import Path

from nacl.bindings import crypto_aead_xchacha20poly1305_ietf_encrypt


ORDER = 2**252 + 27742317777372353535851937790883648493
MAGIC = b"LABXRLG1"
KEY_DOMAIN = b"LABX/ALICE/RELATION-LEDGER/2026\x00"


class Ristretto:
    def __init__(self):
        name = ctypes.util.find_library("sodium")
        if not name:
            raise RuntimeError("libsodium не найдена")
        self.lib = ctypes.CDLL(name)
        if self.lib.sodium_init() < 0:
            raise RuntimeError("sodium_init не выполнен")
        self.lib.crypto_scalarmult_ristretto255_base.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.lib.crypto_scalarmult_ristretto255_base.restype = ctypes.c_int

    def base(self, scalar: int) -> bytes:
        result = ctypes.create_string_buffer(32)
        value = ctypes.create_string_buffer(scalar.to_bytes(32, "little"), 32)
        if self.lib.crypto_scalarmult_ristretto255_base(result, value) != 0:
            raise RuntimeError("ошибка умножения точки")
        return result.raw


def scalar() -> int:
    return secrets.randbelow(ORDER - 1) + 1


def build_ledger(size: int, flag: str | None = None) -> tuple[bytes, int]:
    if not (2 <= size <= 8192):
        raise ValueError("размер таблицы должен быть от 2 до 8192")
    group = Ristretto()
    count = 4 * size
    secret = scalar()
    q = group.base(secret)
    logs = [scalar() for _ in range(count)]
    points = [group.base(value) for value in logs]

    # A rooted tree has no relation dependency. Every edge is a valid
    # A_child - A_parent = u*G + v*Q, but reveals no scalar log by itself.
    edges = []
    for child in range(1, count):
        parent = secrets.randbelow(child)
        v = scalar()
        u = (logs[child] - logs[parent] - v * secret) % ORDER
        edges.append((child, parent, u, v))
    secrets.SystemRandom().shuffle(edges)

    chosen = [secrets.randbelow(size) for _ in range(4)]
    indexes = [table * size + index for table, index in enumerate(chosen)]
    total = (logs[indexes[0]] + logs[indexes[1]]
             - logs[indexes[2]] - logs[indexes[3]]) % ORDER
    target_v = scalar()
    target_u = (total - target_v * secret) % ORDER
    target_point = group.base(total)

    if flag is None:
        nonce = bytes(24)
        sealed = b""
    else:
        key = hashlib.sha256(KEY_DOMAIN + secret.to_bytes(32, "little")).digest()
        nonce = secrets.token_bytes(24)
        record = (
            "ЛАБОРАТОРИЯ X / ЖУРНАЛ ПЕРЕЗАПУСКА ALICE\n"
            f"ФЛАГ: {flag}\n"
            "УЛИКА: последний вход по резервному допуску 000 произошёл на 366-е сутки "
            "из наблюдательной, единственного помещения без камер.\n"
        ).encode("utf-8")
        sealed = crypto_aead_xchacha20poly1305_ietf_encrypt(record, MAGIC, nonce, key)

    stream = io.BytesIO()
    stream.write(MAGIC)
    stream.write(struct.pack("<II", 1, size))
    stream.write(q)
    for point in points:
        stream.write(point)
    for child, parent, u, v in edges:
        stream.write(struct.pack("<II", child, parent))
        stream.write(u.to_bytes(32, "little"))
        stream.write(v.to_bytes(32, "little"))
    stream.write(target_u.to_bytes(32, "little"))
    stream.write(target_v.to_bytes(32, "little"))
    stream.write(target_point)
    stream.write(nonce)
    stream.write(struct.pack("<I", len(sealed)))
    stream.write(sealed)
    return stream.getvalue(), secret


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flag", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=256, help="размер локального тестового экземпляра")
    args = parser.parse_args()
    if not (args.flag.startswith("nskctf{") and args.flag.endswith("}")):
        parser.error("флаг должен иметь формат nskctf{}")
    payload, _ = build_ledger(args.size, args.flag)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(payload)
    print(f"Создан тестовый реестр: {args.size} точек в таблице, {len(payload)} байт")


if __name__ == "__main__":
    main()
