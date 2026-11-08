"""Invert the positive ADD machine using the extracted score and return."""

from collections import Counter

from notation import Note

PAIRS = ((0, 1), (1, 2), (2, 0))
# Pitch alphabet recovered from the executable's input validator.
DOMAIN = [p for p in range(57, 83) if p % 12 in {0, 1, 2, 3, 4, 5, 7, 9, 10}]
# Lifted from the final comparison in lead-part-tester: twelve uint192 cells.
EXPECTED = (
    6037120589,
    1015511263298,
    311267790790,
    1905224829698638052029170,
    3045867191113008752023,
    6121228544281320166390140,
    36232312933246579,
    1165319481681731980,
    423951471469866155,
    588284,
    318330,
    49235,
)


def last_pitch(accompaniment, voice, start):
    ended = [n for n in accompaniment if n.voice == voice and n.end <= start]
    return max(ended, key=lambda n: (n.end, n.start, n.pitch)).pitch if ended else 0


def recover(accompaniment, score):
    exterior = [n for n in score if n.pitch >= 0]
    skeleton = [(n.start, n.end) for n in score]
    memory = [list(EXPECTED[i : i + 3]) for i in range(0, 12, 3)]
    recovered = []
    for start, end in reversed(sorted(skeleton, key=lambda n: (n[1], n[0]))):
        bass = last_pitch(accompaniment, 1, start)
        piano = last_pitch(accompaniment, 2, start)
        region = bass % 4
        a, b = PAIRS[(piano - bass) % 3]
        word = 0
        for bit_index in range(5):
            x, y = memory[region][a], memory[region][b]
            if min(x, y) <= 0 or x == y:
                raise ValueError("state is outside the positive ADD image")
            bit = int(y > x)
            dst, src = (b, a) if bit else (a, b)
            memory[region][dst] -= memory[region][src]
            word |= bit << bit_index
        pitches = [p for p in DOMAIN if (p - bass) % 32 == word]
        if len(pitches) != 1:
            raise ValueError("instruction word has no unique pitch")
        recovered.append(Note(0, pitches[0], start, end))
    if memory != [[1, 1, 1] for _ in range(4)]:
        raise ValueError("wrong reset state")
    recovered.reverse()
    if recovered != sorted(recovered, key=lambda n: (n.end, n.start, n.pitch)):
        raise ValueError("noncanonical chord order")
    if not Counter(exterior) <= Counter(recovered):
        raise ValueError("known melody exterior changed")
    if Counter((n.start, n.end) for n in recovered) != Counter(skeleton):
        raise ValueError("gap rhythm changed")
    return recovered
