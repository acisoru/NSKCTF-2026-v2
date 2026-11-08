import argparse
from pathlib import Path
import shutil
import sys


IGNORED = {"__pycache__", ".venv", ".DS_Store"}


def files(root: Path) -> dict[Path, Path]:
    return {
        path.relative_to(root): path
        for path in root.rglob("*")
        if path.is_file()
        and not any(part in IGNORED for part in path.relative_to(root).parts)
        and path.suffix not in {".pyc", ".pyo"}
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Синхронизация копии исходников NIGHTLINE в deploy/src")
    parser.add_argument("--check", action="store_true", help="Только проверить совпадение, не изменяя файлы")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / "src"
    destination = root / "deploy" / "src"
    if not source.is_dir():
        parser.error(f"Не найдены исходники: {source}")
    original = files(source)
    deployed = files(destination)
    missing = sorted(original.keys() - deployed.keys())
    extra = sorted(deployed.keys() - original.keys())
    changed = sorted(path for path in original.keys() & deployed.keys() if original[path].read_bytes() != deployed[path].read_bytes())
    if arguments.check:
        for label, paths in (("Отсутствует", missing), ("Лишний файл", extra), ("Отличается", changed)):
            for path in paths:
                print(f"{label}: deploy/src/{path}")
        if missing or extra or changed:
            print("Выполни python3 misc/nightline/solve/sync_deploy.py")
            return 1
    else:
        if extra:
            for path in extra:
                print(f"Лишний файл: deploy/src/{path}")
            print("Синхронизация остановлена: сначала проверь лишние файлы")
            return 1
        for path in missing + changed:
            target = destination / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original[path], target)
    print(f"NIGHTLINE: src и deploy/src совпадают ({len(original)} файлов)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
