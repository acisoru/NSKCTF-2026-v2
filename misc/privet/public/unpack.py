#!/usr/bin/env python3
# Dependency: cryptography==46.0.5
import hashlib
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

data = Path(sys.argv[1]).read_bytes()
key_material = bytes(map(int, Path(sys.argv[2]).read_text().split()))

magic = data[:8]
nonce = data[8:20]
ciphertext = data[20:-16]
tag = data[-16:]

key = hashlib.sha256(key_material).digest()
plaintext = ChaCha20Poly1305(key).decrypt(nonce, ciphertext + tag, magic)
print(plaintext.decode("utf-8"))
