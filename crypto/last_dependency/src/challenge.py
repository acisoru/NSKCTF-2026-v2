#!/usr/bin/env python3
"""One fresh relation ledger and one 888-second answer window per TCP session."""

import hmac
import os
import signal
import struct
import sys

from generate import build_ledger


def main() -> None:
    flag = os.environ.get("FLAG", "nskctf{placeholder_replace_me}")
    size = int(os.environ.get("LEDGER_SIZE", "6144"))
    seconds = int(os.environ.get("SOLVE_SECONDS", "888"))
    payload, secret = build_ledger(size)
    output = sys.stdout.buffer
    output.write(struct.pack(">I", len(payload)))
    output.write(payload)
    output.write("\n# Отправьте d: 64 шестнадцатеричных знака, little endian.\n".encode("utf-8"))
    output.flush()

    signal.alarm(seconds)
    line = sys.stdin.buffer.readline(128).strip()
    signal.alarm(0)
    try:
        answer = bytes.fromhex(line.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        answer = b""
    if not hmac.compare_digest(answer, secret.to_bytes(32, "little")):
        output.write("# неверно\n".encode("utf-8"))
        output.flush()
        return
    result = (
        "# верно\n"
        f"ФЛАГ: {flag}\n"
        "УЛИКА: последний вход по резервному допуску 000 произошёл на 366-е сутки "
        "из наблюдательной, единственного помещения без камер.\n"
    )
    output.write(result.encode("utf-8"))
    output.flush()


if __name__ == "__main__":
    main()
