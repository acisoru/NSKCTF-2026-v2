#!/usr/bin/env python3
"""Recover the key from the participant artifacts, then authenticate the capsule."""

import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

from piet import Piet


def normalize(trace):
    straight = []
    for op, value in trace:
        if op == "pointer":
            if not straight or straight[-1] not in (("push", 1), ("push", 3)):
                raise ValueError("Nonconstant DP change: inspect the control flow")
            straight.pop()
        else:
            straight.append((op, value))

    constants, folded = [], []
    for op, value in straight:
        if op == "push":
            constants.append(value)
        elif op == "not" and constants:
            constants[-1] = int(not constants[-1])
        elif op == "dup" and constants:
            constants.append(constants[-1])
        elif op in ("add", "sub", "mul", "mod", "gt") and len(constants) >= 2:
            a, b = constants[-2:]
            del constants[-2:]
            if op == "add":
                constants.append(a + b)
            elif op == "sub":
                constants.append(a - b)
            elif op == "mul":
                constants.append(a * b)
            elif op == "mod":
                constants.append(a % b)
            else:
                constants.append(int(a > b))
        else:
            folded.extend(("lit", value) for value in constants)
            constants.clear()
            folded.append((op,))
    folded.extend(("lit", value) for value in constants)

    result, i = [], 0
    while i < len(folded):
        if folded[i][0] == "lit":
            depth = folded[i][1]
            pattern = [("lit", depth), ("lit", -1), ("roll",), ("dup",),
                       ("lit", depth + 1), ("lit", 1), ("roll",)]
            if folded[i:i + 7] == pattern:
                result.append(("pick", depth))
                i += 7
                continue
            if i + 2 < len(folded) and folded[i + 1][0] == "lit" and folded[i + 2] == ("roll",):
                result.append(("rotate", depth, folded[i + 1][1]))
                i += 3
                continue
        result.append(folded[i])
        i += 1
    return result


class Reader:
    def __init__(self, tokens, offset):
        self.tokens, self.i = tokens, offset

    def expect(self, *tokens):
        actual = self.tokens[self.i:self.i + len(tokens)]
        if actual != list(tokens):
            raise ValueError(f"Unexpected instructions at {self.i}: {actual}; expected {tokens}")
        self.i += len(tokens)

    def argument(self, op):
        if self.i >= len(self.tokens) or self.tokens[self.i][0] != op:
            raise ValueError(f"Expected {op} at {self.i}")
        token = self.tokens[self.i]
        self.i += 1
        return token[1:]

    def literal(self):
        return self.argument("lit")[0]


def lift(tokens):
    inputs = [i for i, token in enumerate(tokens) if token == ("in_num",)]
    n = len(inputs)
    if n < 3 or inputs != list(range(inputs[0], inputs[0] + n)):
        raise ValueError("Expected one contiguous input block")
    reader = Reader(tokens, inputs[-1] + 1)
    reader.expect(("lit", 0))
    for depth in range(1, n + 1):
        reader.expect(("pick", depth + 1), ("lit", 255), ("gt",), ("add",),
                      ("lit", 0), ("pick", depth + 2), ("gt",), ("add",))
    reader.expect(("rotate", n + 1, 1))

    operations = []
    while tokens[reader.i] != ("lit", 0):
        if tokens[reader.i:reader.i + 2] == [("lit", n), ("lit", 0)]:
            reader.expect(("lit", n), ("lit", 0))
            for depth in range(1, n + 1):
                reader.expect(("pick", depth + 2), ("add",))
            reader.expect(("dup",), ("switch",), ("lit", n), ("mod",), ("roll",))
            operations.append(("spin",))
            continue
        a = reader.literal()
        reader.expect(("mul",))
        j = reader.argument("pick")[0]
        b = reader.literal()
        reader.expect(("mul",))
        k = reader.argument("pick")[0] - 1
        reader.expect(("mul",), ("add",), ("pick", j))
        c = reader.literal()
        reader.expect(("mul",), ("add",))
        d = reader.literal()
        reader.expect(("add",))
        modulus = reader.literal()
        reader.expect(("mod",))
        depth, count = reader.argument("rotate")
        if depth != n or not (2 <= j <= n and 2 <= k <= n):
            raise ValueError("Unexpected state dependencies")
        operations.append(("shear", j, k, a, b, c, d, modulus, count))

    reader.expect(("lit", 0))
    targets = []
    for _ in range(n):
        reader.expect(("rotate", 2, 1))
        targets.append(reader.literal())
        reader.expect(("sub",), ("dup",), ("mul",), ("add",))
    reader.expect(("add",), ("not",), ("out_num",), ("lit", 10), ("out_char",))
    if reader.i != len(tokens):
        raise ValueError("Unparsed instructions after the verifier")
    return operations, targets[::-1]


def rotate(state, count):
    count %= len(state)
    return state[-count:] + state[:-count] if count else state[:]


def invert(operations, targets):
    state = targets[:]
    for operation in reversed(operations):
        if operation[0] == "spin":
            state = rotate(state, -(sum(state) % len(state)))
        else:
            _, j, k, a, b, c, d, modulus, count = operation
            state = rotate(state, -count)
            y, z = state[-j], state[-k]
            state[-1] = (state[-1] - b*y*z - c*y - d) * pow(a, -1, modulus) % modulus
    if any(not 0 <= value <= 255 for value in state):
        raise ValueError("Inverse state is not a byte sequence")
    return bytes(state)


def recover(machine):
    # The zero execution discovers geometry, not secret-dependent stack indices.
    trace = machine.run(itertools.repeat(0), tracing=True).trace
    operations, targets = lift(normalize(trace))
    token = invert(operations, targets)
    if machine.run(token).output != "privet\n1\n":
        raise ValueError("Recovered input failed the actual Piet verifier")
    return token, operations


def decrypt(capsule, token):
    if len(capsule) < 36 or capsule[:8] != b"PRIVET1\n":
        raise ValueError("Not a PRIVET v1 capsule")
    plaintext = ChaCha20Poly1305(hashlib.sha256(token).digest()).decrypt(
        capsule[8:20], capsule[20:], capsule[:8]
    )
    return json.loads(plaintext)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("public", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1] / "public")
    parser.add_argument("--key-out", type=Path)
    args = parser.parse_args()
    token, operations = recover(Piet(args.public / "privet.png"))
    result = decrypt((args.public / "quarantine.bin").read_bytes(), token)
    print(f"Recovered {len(token)} bytes from {len(operations)} reversible steps", file=sys.stderr)
    if args.key_out:
        args.key_out.write_text(" ".join(map(str, token)) + "\n", encoding="ascii")
    print(result["flag"])
    print(result["evidence"])


if __name__ == "__main__":
    main()
