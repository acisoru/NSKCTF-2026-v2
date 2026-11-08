#!/usr/bin/env python3
import hashlib
import hmac
import os
import struct
import sys
import time

from pwn import context, log, remote

context.log_level = "info"

HOST = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
PORT = int(sys.argv[2] if len(sys.argv) > 2 else "18111")
MASTER_HEX = sys.argv[3] if len(sys.argv) > 3 else os.environ.get(
    "ALICE_MASTER",
    "7af70f560fa63d8e8f4e903d424cb150398b805e866f2520d15b4bf1a11ee34f",
)
MASTER = bytes.fromhex(MASTER_HEX)

io = remote(HOST, PORT, timeout=10)

banner = io.recvline()
log.info("banner: %r", banner)

io.sendline(b"CONNECT")
response = io.recvline().decode().strip()
log.info("challenge: %s", response)
assert response.startswith("OK "), response

values = dict(item.split("=", 1) for item in response.split()[1:])
nonce = bytes.fromhex(values["nonce"])
challenge = bytes.fromhex(values["challenge"])

session_key = hmac.new(MASTER, b"AL1C/3/" + challenge, hashlib.sha256).digest()
payload = struct.pack(">III", 0x3E7, 0x58414C, int(time.time()))

packet = (
    struct.pack(">4sHBBH", b"AL1C", 3, 0x10, 0, len(payload))
    + payload
    + nonce
)
packet += hmac.new(session_key, packet, hashlib.sha256).digest()

io.sendline(b"SEND " + packet.hex().encode())
result = io.recvline().decode().strip()
log.success("result: %s", result)
io.close()