#!/usr/bin/env python3
"""Receive a fresh ledger, run the prepared native solver, submit within 888 s."""

import argparse
import re
import socket
import struct
import subprocess
import tempfile
from pathlib import Path


def receive_exact(connection: socket.socket, length: int) -> bytes:
    chunks = []
    while length:
        chunk = connection.recv(length)
        if not chunk:
            raise EOFError("сервер закрыл соединение до конца файла")
        chunks.append(chunk)
        length -= len(chunk)
    return b"".join(chunks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("host")
    parser.add_argument("port", type=int)
    parser.add_argument("--solver", type=Path,
                        default=Path(__file__).resolve().parent / "target/release/last-dependency-solver")
    args = parser.parse_args()
    with socket.create_connection((args.host, args.port), timeout=30) as connection:
        connection.settimeout(900)
        length = struct.unpack(">I", receive_exact(connection, 4))[0]
        if not (1000 <= length <= 4_000_000):
            raise ValueError("неверная длина реестра")
        payload = receive_exact(connection, length)
        with tempfile.TemporaryDirectory(prefix="labx-relation-") as directory:
            artifact = Path(directory) / "ledger.bin"
            artifact.write_bytes(payload)
            result = subprocess.run([str(args.solver), str(artifact), "--answer-only"],
                                    capture_output=True, text=True, timeout=850, check=True)
        answer = result.stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{64}", answer):
            raise ValueError("решатель не вывел 32-байтный скаляр")
        print(result.stderr, end="")
        connection.sendall(answer.encode("ascii") + b"\n")
        response = bytearray()
        while chunk := connection.recv(4096):
            response.extend(chunk)
        print(response.decode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
