#!/usr/bin/env python3
"""Создать подписи журнала ALICE с неисправным 232-битным источником nonce."""

import argparse
import hashlib
import json
import secrets
from pathlib import Path

from Crypto.Cipher import AES
from ecdsa import SECP256k1, SigningKey


ORDER = SECP256k1.order
DOMAIN = "ЛАБ-X/ALICE/ЖУРНАЛ/КЛЮЧ\x00".encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flag", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not (args.flag.startswith("nskctf{") and args.flag.endswith("}")):
        parser.error("флаг должен иметь формат nskctf{}")

    private = secrets.randbelow(ORDER - 1) + 1
    public = SigningKey.from_secret_exponent(private, curve=SECP256k1).verifying_key.pubkey.point
    records = []
    for index in range(28):
        message = f"ALICE/КАРАНТИН/ЗАПИСЬ-{index:02d}".encode("utf-8")
        digest = hashlib.sha256(message).digest()
        nonce = secrets.randbelow((1 << 232) - 1) + 1
        r = (nonce * SECP256k1.generator).x() % ORDER
        s = (pow(nonce, -1, ORDER) * (int.from_bytes(digest, "big") + r * private)) % ORDER
        assert r and s
        records.append({"message": message.decode(), "r": f"{r:064x}", "s": f"{s:064x}"})

    key = hashlib.sha256(DOMAIN + private.to_bytes(32, "big")).digest()
    iv = secrets.token_bytes(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    sealed_record = (
        f"{args.flag}\n"
        "УЛИКА: расход склада в пробеле 2018–2019 годов не равен нулю.\n"
    ).encode("utf-8")
    ciphertext, tag = cipher.encrypt_and_digest(sealed_record)
    artifact = {
        "curve": "secp256k1",
        "digest": "SHA-256",
        "context": "Подписанные строки журнала ALICE из карантинного архива Лаборатории X",
        "nonce_reservoir_bits": 232,
        "public_key": {"x": f"{public.x():064x}", "y": f"{public.y():064x}"},
        "records": records,
        "release": {"algorithm": "AES-256-GCM", "kdf": "SHA256(domain || d.to_bytes(32, 'big'))", "domain_hex": DOMAIN.hex(), "iv": iv.hex(), "ciphertext": ciphertext.hex(), "tag": tag.hex()},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
