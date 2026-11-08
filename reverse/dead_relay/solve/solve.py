#!/usr/bin/env python3
"""Пройти все восемь участков установки через сетевой C++-сервер."""

import argparse
import socket
import struct
from pathlib import Path


MASK = (1 << 64) - 1
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def embedded_file(client: Path, wanted: str) -> bytes:
    executable = client.read_bytes()
    magic, size, expected_hash = struct.unpack_from("<8sQQ", executable, len(executable) - 24)
    if magic != b"DRPKG001" or size > len(executable) - 24:
        raise ValueError("в клиенте нет корректного встроенного архива")
    payload = memoryview(executable)[len(executable) - 24 - size : len(executable) - 24]
    value = 14695981039346656037
    for byte in payload:
        value = ((value ^ byte) * 1099511628211) & MASK
    if value != expected_hash:
        raise ValueError("контрольная сумма встроенного архива не совпала")

    count = struct.unpack_from("<I", payload, 0)[0]
    cursor = 4
    for _ in range(count):
        name_size, data_size = struct.unpack_from("<HQ", payload, cursor)
        cursor += 10
        name = bytes(payload[cursor : cursor + name_size]).decode()
        cursor += name_size
        data = payload[cursor : cursor + data_size]
        cursor += data_size
        if name == wanted:
            return bytes(data)
    raise ValueError(f"файл {wanted} не найден во встроенном архиве")


def rol(value: int, shift: int, width: int) -> int:
    mask = (1 << width) - 1
    return ((value << shift) | (value >> (width - shift))) & mask


def ferry(seed: int) -> int:
    return rol((((seed & 0xFFFF) ^ 0x9D7B) + 0x2143) & 0xFFFF, 5, 16) ^ 0x6A31


def archive(seed: int) -> str:
    x = seed ^ 0xCADE45F3
    result = ""
    for _ in range(8):
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
        result += ALPHABET[((x >> 21) ^ (x >> 9) ^ (x >> 3)) & 31]
    return result


def core(seed: int, rom: bytes) -> int:
    state = ((seed << 32) | (seed ^ 0xA5B35791)) & MASK
    for i, byte in enumerate(rom):
        op, arg = byte >> 5, byte & 31
        salt = 0x9E3779B97F4A7C15 ^ (((i + 1) * 0x100000001B3) & MASK)
        if op == 0:
            state += salt + arg
        elif op == 1:
            state ^= rol(salt, arg % 63 + 1, 64)
        elif op == 2:
            state = rol(state, arg % 31 + 1, 64)
        elif op == 3:
            state *= salt | 1
        elif op == 4:
            state ^= state >> (arg % 13 + 1)
        elif op == 5:
            state += rol(state, arg % 17 + 1, 64)
        elif op == 6:
            state = ~state ^ (salt >> (arg % 17))
        elif op == 7:
            state = (state ^ (state << (arg % 11 + 1))) + salt
        state &= MASK
    return state ^ 0xD6E8FEB86659FD93


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("host", nargs="?", default="127.0.0.1")
    parser.add_argument("port", nargs="?", type=int, default=34320)
    parser.add_argument("--client", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "dead_relay")
    parser.add_argument("--rom", type=Path, default=None)
    args = parser.parse_args()
    rom = args.rom.read_bytes() if args.rom else embedded_file(args.client, "pulse.rom")
    assert len(rom) == 64

    with socket.create_connection((args.host, args.port), timeout=5) as sock:
        file = sock.makefile("rwb", buffering=0)

        def recv() -> str:
            line = file.readline().decode().strip()
            if not line:
                raise RuntimeError("сервер разорвал соединение")
            return line

        def send(command: str) -> str:
            file.write((command + "\n").encode())
            response = recv()
            print(command, "=>", response)
            return response

        recv()  # приветствие
        hello = send("HELLO reverser")
        fields = hello.split("|")
        assert fields[0] == "WELCOME" and fields[2] == "STATE"
        seed = int(fields[5], 16)

        actions = [
            "ACT manifest 256",                # сканер видит ноль в одном байте
            "ACT salvage 65536",               # склад видит ноль в 16 битах
            f"ACT ferry {ferry(seed)}",         # преобразование зерна сеанса
            "ACT seam -1 7",                    # -1 указывает на плитку 255
            "ACT forge charge=1,charge=9,coil=6",  # первый и последний дубли
            f"ACT archive {archive(seed)}",     # указатель архива из зерна
            "ACT clock 4294967295",            # счётчик: 73 → 72
            f"ACT core {core(seed, rom):016X}", # интерпретировать 64 байта ROM
        ]
        for index, command in enumerate(actions):
            response = send(command)
            if index < 7 and not response.startswith("OK|"):
                raise RuntimeError(f"ошибка на участке {index + 1}")
            if index == 7:
                if not response.startswith("FLAG|nskctf{"):
                    raise RuntimeError("итоговая проверка не пройдена")
                fields = response.split("|", 2)
                print("ФЛАГ:", fields[1])
                if len(fields) == 3:
                    print("УЛИКА:", fields[2])


if __name__ == "__main__":
    main()
