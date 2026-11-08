"""Serialize exact note intervals as bar-local ABC overlays."""
from fractions import Fraction

SPELL = {0:("C", "="), 1:("C", "^"), 2:("D", "="), 3:("D", "^"),
         4:("E", "="), 5:("F", "="), 7:("G", "="), 9:("A", "="), 10:("B", "_")}


def pitch_token(pitch):
    letter, sign = SPELL[pitch%12]
    octave = pitch//12-5
    if octave >= 1:
        return sign+letter.lower()+"'"*(octave-1)
    return sign+letter+","*(-octave)


def duration_token(ticks):
    value = Fraction(ticks,4)
    return "" if value == 1 else str(value)


def emit(events):
    lines = ["X:1", "T:Violin", "M:3/4", "L:1/8", "K:Dm"]
    for bar in range(16):
        groups = {}
        for e in events:
            if bar*24 <= e.start < (bar+1)*24:
                groups.setdefault((e.start-bar*24,e.end-bar*24), []).append(e.pitch)
        channels = []
        for (start,end), pitches in sorted(groups.items()):
            channel = next((v for v in channels if v[0] <= start), None)
            if channel is None:
                channel = [0, []]
                channels.append(channel)
            if channel[0] < start:
                channel[1].append("z"+duration_token(start-channel[0]))
            notes = "".join(pitch_token(p) for p in sorted(pitches))
            if len(pitches) > 1:
                notes = "["+notes+"]"
            channel[1].append(notes+duration_token(end-start))
            channel[0] = end
        for channel in channels:
            if channel[0] < 24:
                channel[1].append("z"+duration_token(24-channel[0]))
        lines.append("|"+" & ".join("".join(c[1]) for c in channels)+("|]" if bar == 15 else "|"))
    return "\n".join(lines)+"\n"

