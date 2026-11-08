#!/usr/bin/env python3
"""Добавить архив ресурсов к очищенному от символов Linux-клиенту.

Загрузчик ELF игнорирует хвост файла. Клиент проверяет его и распаковывает,
сохраняя относительные пути для зависимостей моделей glTF.
"""

import io
import struct
from pathlib import Path


TASK = Path(__file__).resolve().parents[1]
CLIENT = TASK / "public" / "dead_relay"
MAGIC = b"DRPKG001"
MASK = (1 << 64) - 1


def fnv64(data: bytes) -> int:
    value = 14695981039346656037
    for byte in data:
        value = ((value ^ byte) * 1099511628211) & MASK
    return value


def main() -> None:
    sources = [("pulse.rom", TASK / "src" / "shared" / "pulse.rom")]
    assets = TASK / "src" / "client" / "assets"
    sources.extend(
        ("assets/" + path.relative_to(assets).as_posix(), path)
        for path in sorted(assets.rglob("*"))
        if path.is_file()
    )
    if not CLIENT.is_file() or not sources or not all(path.is_file() for _, path in sources):
        raise SystemExit("не найден клиент или исходные ресурсы")

    stream = io.BytesIO()
    stream.write(struct.pack("<I", len(sources)))
    for name, path in sources:
        encoded = name.encode("utf-8")
        if len(encoded) > 255:
            raise SystemExit(f"слишком длинное имя ресурса: {name}")
        data = path.read_bytes()
        stream.write(struct.pack("<HQ", len(encoded), len(data)))
        stream.write(encoded)
        stream.write(data)

    payload = stream.getvalue()
    footer = struct.pack("<8sQQ", MAGIC, len(payload), fnv64(payload))
    with CLIENT.open("ab") as output:
        output.write(payload)
        output.write(footer)
    print(f"Ресурсов: {len(sources)}; встроено {len(payload):,} байт в {CLIENT.name}")


if __name__ == "__main__":
    main()
