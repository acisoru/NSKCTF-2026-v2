#!/usr/bin/env python3
"""Recover the ABC score; optionally check it locally or submit it by HTTP."""

import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

from emit import emit
from extract import extract_score
from inverse import recover
from notation import parse_part

ROOT = Path(__file__).resolve().parents[1]


def solve(public):
    bass = (public / "bass.abc").read_text()
    piano = (public / "rhythm.abc").read_text()
    accompaniment = parse_part(bass, 1) + parse_part(piano, 2)
    score = extract_score(public / "lead-part-tester", accompaniment)
    recovered = recover(accompaniment, score)
    melody = emit(recovered)
    if Counter(parse_part(melody, 0)) != Counter(recovered):
        raise ValueError("ABC round trip changed musical events")
    return {"melody": melody, "bass": bass, "rhythm": piano}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public", type=Path, default=ROOT / "public")
    parser.add_argument("--output", type=Path, default=Path("recovered.abc"))
    parser.add_argument("--tester", type=Path, help="Linux x86-64 tester")
    parser.add_argument("--url", help="service URL, e.g. http://127.0.0.1:9898")
    args = parser.parse_args()
    parts = solve(args.public)
    args.output.write_text(parts["melody"])
    if args.tester:
        subprocess.run(
            [
                str(args.tester.resolve()),
                str(args.output.resolve()),
                str((args.public / "bass.abc").resolve()),
                str((args.public / "rhythm.abc").resolve()),
                "--check",
            ],
            check=True,
        )
    if args.url:
        request = urllib.request.Request(
            args.url.rstrip("/") + "/solve",
            data=json.dumps(parts).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise SystemExit(json.load(error).get("error", "score rejected")) from None
        print(result["flag"])
    else:
        print(args.output)


if __name__ == "__main__":
    main()
