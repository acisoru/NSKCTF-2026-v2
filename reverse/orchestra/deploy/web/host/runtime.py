from pathlib import Path
import json
import subprocess
import tempfile

WEB_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VM = WEB_ROOT / "bin/lead-part-tester"


class Rejected(ValueError):
    pass


def solve(melody, bass, rhythm, *, vm=DEFAULT_VM):
    try:
        data = [part.encode("utf-8") for part in (melody, bass, rhythm)]
    except (AttributeError, UnicodeEncodeError):
        raise Rejected("provide three UTF-8 ABC strings") from None
    if any(len(part) > 16384 for part in data):
        raise Rejected("ABC part size exceeded")
    try:
        with tempfile.TemporaryDirectory(prefix="orchestra-") as directory:
            paths = [Path(directory)/name for name in ("lead.abc", "bass.abc", "piano.abc")]
            for path, content in zip(paths, data):
                path.write_bytes(content)
            command = [str(Path(vm).resolve()), *map(str, paths)]
            # The binary inherits the service environment and reads FLAG itself.
            result = subprocess.run(command, capture_output=True, timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        raise Rejected("native orchestra unavailable or timed out") from None
    if result.returncode != 0:
        try:
            report = json.loads(result.stdout)
            reason = report.get("fault", "score rejected")
        except (ValueError, AttributeError, UnicodeDecodeError):
            reason = "invalid native orchestra response"
        raise Rejected(reason)
    try:
        flag = result.stdout.decode("utf-8").rstrip("\r\n")
    except UnicodeDecodeError:
        raise Rejected("invalid native orchestra response") from None
    if not flag:
        raise Rejected("native orchestra returned no flag")
    return flag
