import argparse
import json
import os
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.config import load_environment
from app.puzzle import NODE_COUNT, generate
from app.render import render_map


def resolve_seed(arguments) -> str:
    if arguments.seed:
        return arguments.seed
    if not arguments.puzzle_id:
        raise SystemExit("Укажи --seed или --puzzle-id")
    import psycopg

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise SystemExit("Для --puzzle-id задайте DATABASE_URL; внутри контейнера он уже настроен")
    with psycopg.connect(database_url, connect_timeout=5, options="-c default_transaction_read_only=on") as connection:
        row = connection.execute("SELECT seed FROM sessions WHERE puzzle_id = %s", (arguments.puzzle_id,)).fetchone()
    if not row:
        raise SystemExit("Такого города нет в базе")
    return row[0]


def main() -> None:
    load_environment()
    parser = argparse.ArgumentParser(description="Инструменты организатора NIGHTLINE. Этот модуль не доступен через HTTP и не входит в образ контейнера")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name, description in (("solve", "Получить эталонный маршрут для своего города"), ("preview", "Сохранить растровую карту")):
        command = subparsers.add_parser(name, help=description)
        source = command.add_mutually_exclusive_group(required=True)
        source.add_argument("--seed", help="Закрытый seed генератора")
        source.add_argument("--puzzle-id", help="Идентификатор города из интерфейса или API")
        if name == "solve":
            command.add_argument("--json", action="store_true", help="Вывести переходы и ответ в JSON для организатора")
        else:
            command.add_argument("--output", default="/tmp/nightline-preview.png", help="Файл PNG или - для вывода PNG в stdout")
            command.add_argument("--layer", choices=("all", "red", "blue"), default="all")
    audit = subparsers.add_parser("audit", help="Проверить качество и разрешимость серии городов")
    audit.add_argument("--count", type=int, default=25)
    audit.add_argument("--prefix", default="release-audit")
    arguments = parser.parse_args()
    if arguments.command == "audit":
        if not 1 <= arguments.count <= 1000:
            raise SystemExit("Количество городов должно быть от 1 до 1000")
        lengths = []
        durations = []
        for index in range(arguments.count):
            started = time.perf_counter()
            puzzle = generate(f"{arguments.prefix}-{index}")
            if not puzzle.accepts(puzzle.reference):
                raise SystemExit(f"Некорректный эталон для экземпляра {index}")
            if puzzle.accepts("R" * 128) or puzzle.accepts("B" * 128):
                raise SystemExit(f"Вырожденный город в экземпляре {index}")
            lengths.append(len(puzzle.reference))
            durations.append(time.perf_counter() - started)
            print(f"{index + 1:03}/{arguments.count} · {lengths[-1]} команд · {durations[-1]:.3f} с", flush=True)
        print(json.dumps({"cities": len(lengths), "nodes": NODE_COUNT, "shortest_route": {"min": min(lengths), "median": statistics.median(lengths), "max": max(lengths)}, "generation_seconds": {"median": round(statistics.median(durations), 3), "max": round(max(durations), 3)}}, ensure_ascii=False, indent=2))
        return
    seed = resolve_seed(arguments)
    puzzle = generate(seed)
    if arguments.command == "preview":
        data = render_map(seed, arguments.layer)
        if arguments.output == "-":
            sys.stdout.buffer.write(data)
        else:
            output = Path(arguments.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
            print(output.resolve())
    elif arguments.json:
        print(json.dumps({"red": puzzle.red, "blue": puzzle.blue, "target": puzzle.target, "route": puzzle.reference, "length": len(puzzle.reference)}, ensure_ascii=False))
    else:
        print(f"Район: {puzzle.district}\nСклад: {puzzle.target + 1:02}\nКоманд: {len(puzzle.reference)}\nМаршрут: {puzzle.reference}")


if __name__ == "__main__":
    main()
