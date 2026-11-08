"""Locate the score validator's event table in the Linux executable."""
import struct

from notation import Note

EVENT = struct.Struct("<iiii")
MELODY_EVENTS = 83


def extract_score(binary, accompaniment):
    fixed = sorted(accompaniment, key=lambda n: (n.voice, n.start, n.end, n.pitch))
    signature = b"".join(EVENT.pack(n.voice, n.pitch, n.start, n.end) for n in fixed)
    data = binary.read_bytes()
    offset = data.find(signature)
    if offset < MELODY_EVENTS * EVENT.size or data.find(signature, offset + 1) != -1:
        raise ValueError("cannot locate the unique score table")
    start = offset - MELODY_EVENTS * EVENT.size
    notes = [Note(*fields) for fields in EVENT.iter_unpack(data[start:offset])]
    if any(n.voice != 0 or not 0 <= n.start < n.end <= 384
           or not -1 <= n.pitch <= 127 for n in notes):
        raise ValueError("invalid melody table in executable")
    return notes
