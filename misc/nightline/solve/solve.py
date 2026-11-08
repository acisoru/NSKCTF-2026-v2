import argparse
from array import array
from collections import deque
import json
import os
from pathlib import Path
import urllib.request
from uuid import uuid4


def solve(red: list[int], blue: list[int], target: int) -> str:
    size = len(red)
    if not 1 <= size <= 22 or len(blue) != size:
        raise ValueError("Нужны две таблицы одинаковой длины, от 1 до 22 узлов")
    if any(type(value) is not int or not 0 <= value < size for value in [*red, *blue, target]):
        raise ValueError("Номер узла вне таблицы")
    if size == 1:
        return "R"
    tables = []
    for transition in (red, blue):
        image = array("I", [0]) * (1 << size)
        for mask in range(1, len(image)):
            bit = mask & -mask
            image[mask] = image[mask ^ bit] | (1 << transition[bit.bit_length() - 1])
        tables.append(image)
    initial = (1 << size) - 1
    goal = 1 << target
    previous = array("i", [-2]) * (1 << size)
    commands = bytearray(1 << size)
    previous[initial] = -1
    queue = deque([initial])
    while queue:
        current = queue.popleft()
        for command, table in enumerate(tables):
            destination = table[current]
            if previous[destination] != -2:
                continue
            previous[destination] = current
            commands[destination] = command
            if destination == goal:
                route = []
                while previous[destination] != -1:
                    route.append("RB"[commands[destination]])
                    destination = previous[destination]
                return "".join(reversed(route))
            queue.append(destination)
    raise ValueError("У автомата нет синхронизирующего слова к указанному складу")


def main() -> None:
    parser = argparse.ArgumentParser(description="NIGHTLINE: поиск маршрута по вручную восстановленной таблице")
    parser.add_argument("table", type=Path, help="JSON с массивами red, blue и номером target")
    parser.add_argument("--zero-based", action="store_true", help="Нумерация от 0 вместо номеров 01..20 на карте")
    parser.add_argument("--url", help="Отправить ответ в свою сессию; cookie берётся из NIGHTLINE_SESSION")
    arguments = parser.parse_args()
    data = json.loads(arguments.table.read_text())
    offset = 0 if arguments.zero_based else 1
    try:
        red = [value - offset for value in data["red"]]
        blue = [value - offset for value in data["blue"]]
        target = data["target"] - offset
        route = solve(red, blue, target)
    except (ValueError, TypeError, KeyError) as error:
        raise SystemExit(f"Некорректная таблица: {error}")
    if len(route) > 128:
        raise SystemExit(f"Кратчайший маршрут содержит {len(route)} команд: проверь таблицу")
    print(route)
    if not arguments.url:
        return
    token = os.environ.get("NIGHTLINE_SESSION", "")
    if not token:
        raise SystemExit("Для отправки задай cookie nightline_session в NIGHTLINE_SESSION")
    base = arguments.url.rstrip("/")
    headers = {"Cookie": f"nightline_session={token}", "Content-Type": "application/json"}
    request = urllib.request.Request(base + "/api/session", headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        session = json.load(response)
    if int(session["target_label"]) != target + 1 or session["node_count"] != len(red):
        raise SystemExit("Таблица и текущая сессия не совпадают")
    headers["X-CSRF-Token"] = session["csrf_token"]
    body = json.dumps({"puzzle_id": session["puzzle_id"], "request_id": str(uuid4()), "route": route}).encode()
    request = urllib.request.Request(base + "/api/submit", body, headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result["accepted"]:
        raise SystemExit(result["message"])
    print(result["flag"])


if __name__ == "__main__":
    main()
