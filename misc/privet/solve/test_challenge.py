import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

from cryptography.exceptions import InvalidTag
from PIL import Image

from piet import Piet
from solve import decrypt, recover

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import build


class ChallengeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.machine = Piet(ROOT / "public/privet.png")
        cls.token, cls.operations = recover(cls.machine)
        cls.capsule = (ROOT / "public/quarantine.bin").read_bytes()

    def test_public_artifacts_recover_the_exact_secret_and_evidence(self):
        self.assertEqual(self.token, build.TOKEN)
        self.assertEqual(sum(op[0] == "shear" for op in self.operations), 480)
        self.assertEqual(sum(op[0] == "spin" for op in self.operations), 40)
        self.assertEqual(decrypt(self.capsule, self.token),
                         {"flag": build.FLAG, "evidence": build.CLUE})

    def test_invalid_bytes_and_congruent_out_of_range_inputs_are_rejected(self):
        candidates = [list(bytes(24)), list(bytes([255]) * 24)]
        for index in (0, 11, 23):
            value = list(self.token)
            value[index] ^= 1
            candidates.append(value)
        for delta in (-257, 257):
            value = list(self.token)
            value[0] += delta
            candidates.append(value)
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                result = self.machine.run(candidate)
                self.assertEqual(result.output, "privet\n0\n")
                self.assertEqual(result.stack, [])

    def test_control_flow_is_input_independent_even_when_cc_changes(self):
        accepted = self.machine.run(self.token, tracing=True)
        rejected = self.machine.run([0] * 24, tracing=True)
        self.assertEqual(accepted.trace, rejected.trace)
        self.assertEqual(accepted.output, "privet\n1\n")
        self.assertEqual(rejected.output, "privet\n0\n")

    def test_capsule_cannot_be_opened_by_bypassing_the_receipt(self):
        with self.assertRaises(InvalidTag):
            decrypt(self.capsule, bytes(24))
        changed = bytearray(self.capsule)
        changed[-1] ^= 1
        with self.assertRaises(InvalidTag):
            decrypt(bytes(changed), self.token)

    def test_rebuild_preserves_exact_pixels_and_capsule(self):
        with tempfile.TemporaryDirectory() as directory:
            with contextlib.redirect_stdout(io.StringIO()):
                build.build(Path(directory))
            with Image.open(Path(directory) / "privet.png") as rebuilt:
                with Image.open(ROOT / "public/privet.png") as released:
                    self.assertEqual(rebuilt.mode, released.mode)
                    self.assertEqual(rebuilt.size, released.size)
                    self.assertEqual(rebuilt.tobytes(), released.tobytes())
            self.assertEqual((Path(directory) / "quarantine.bin").read_bytes(), self.capsule)

    def test_public_directory_has_only_the_intended_artifacts(self):
        public = ROOT / "public"
        self.assertEqual({p.name for p in public.iterdir()},
                         {"privet.png", "quarantine.bin", "terminal.txt", "unpack.py"})
        for path in public.iterdir():
            data = path.read_bytes()
            self.assertNotIn(build.FLAG.encode(), data)
            self.assertNotIn(build.TOKEN, data)
        data = (public / "privet.png").read_bytes()
        cursor, chunks = 8, []
        while cursor < len(data):
            length = struct.unpack_from(">I", data, cursor)[0]
            chunks.append(data[cursor + 4:cursor + 8])
            cursor += length + 12
        self.assertEqual(cursor, len(data))
        self.assertEqual(set(chunks), {b"IHDR", b"IDAT", b"IEND"})
        self.assertEqual(chunks[-1], b"IEND")

    def test_public_unpacker_decrypts_the_released_capsule(self):
        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory) / "key.txt"
            key_path.write_text(" ".join(map(str, self.token)), encoding="ascii")
            command = [sys.executable, str(ROOT / "public/unpack.py"),
                       str(ROOT / "public/quarantine.bin"), str(key_path)]
            opened = subprocess.run(command,
                                    capture_output=True, text=True, check=True, timeout=10)
            self.assertEqual(json.loads(opened.stdout), decrypt(self.capsule, self.token))

    def test_public_unpacker_rejects_bad_files_keys_and_authentication(self):
        correct_key = " ".join(map(str, self.token))
        cases = [
            (self.capsule[:19], correct_key),
            (b"INVALID\n" + self.capsule[8:], correct_key),
            (self.capsule, "1 2 3"),
            (self.capsule, " ".join(["256"] * 24)),
            (self.capsule, " ".join(["0"] * 24)),
            (self.capsule[:-1] + bytes([self.capsule[-1] ^ 1]), correct_key),
        ]
        with tempfile.TemporaryDirectory() as directory:
            capsule_path = Path(directory) / "quarantine.bin"
            key_path = Path(directory) / "key.txt"
            for capsule, key in cases:
                with self.subTest(capsule=capsule, key=key):
                    capsule_path.write_bytes(capsule)
                    key_path.write_text(key, encoding="ascii")
                    result = subprocess.run(
                        [sys.executable, str(ROOT / "public/unpack.py"), str(capsule_path),
                         str(key_path)],
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")

    def test_solver_runs_with_no_organizer_files(self):
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory)
            shutil.copytree(ROOT / "public", isolated / "public")
            for name in ("solve.py", "piet.py"):
                shutil.copy2(ROOT / "solve" / name, isolated / name)
            result = subprocess.run(
                [sys.executable, str(isolated / "solve.py"), str(isolated / "public")],
                cwd=isolated, env={**os.environ, "PYTHONPATH": ""},
                capture_output=True, text=True, timeout=30, check=True,
            )
            self.assertEqual(result.stdout, build.FLAG + "\n" + build.CLUE + "\n")

    @unittest.skipUnless(os.environ.get("NPIET"), "Set NPIET to check an independent interpreter")
    def test_independent_npiet(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "privet.ppm"
            with Image.open(ROOT / "public/privet.png") as image:
                image.save(image_path)
            candidates = [self.token, bytes(24), bytes([self.token[0] ^ 1]) + self.token[1:],
                          [self.token[0] + 257, *self.token[1:]],
                          [self.token[0] - 257, *self.token[1:]]]
            for candidate in candidates:
                with self.subTest(candidate=list(candidate)):
                    result = subprocess.run(
                        [os.environ["NPIET"], "-q", "-cs", "1", "-e", "1000000", str(image_path)],
                        input=" ".join(map(str, candidate)) + "\n",
                        capture_output=True, text=True, timeout=30, check=True,
                    )
                    self.assertEqual(result.stdout, self.machine.run(candidate).output)
                    self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
