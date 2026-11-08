"""Strict ABC 2.1 subset -> exact canonical events for the challenge.

Supported: Dm, 3/4, L:1/8, notes/accidentals/octaves, rational durations,
rests, equal-duration chords and measure-local '&' overlays. Unsupported
musical constructs are rejected instead of silently changing their meaning.
"""

from dataclasses import dataclass
from fractions import Fraction
import re

MAX_PART_BYTES = 16384
MAX_EVENTS = 256
NATURAL = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TOKEN = re.compile(r"([\^_=]?)([A-Ga-gz])([,']*)([0-9]*(?:/[0-9]*)?)")
LENGTH = re.compile(r"[0-9]*(?:/[0-9]*)?")


class InvalidScore(ValueError):
    pass


@dataclass(frozen=True, order=True)
class Note:
    voice: int
    pitch: int
    start: int
    end: int


def length_ticks(text):
    if len(text) > 12:
        raise InvalidScore("duration too large")
    try:
        if "/" in text:
            a, b = text.split("/")
            value = Fraction(int(a or 1), int(b or 2))
        else:
            value = Fraction(int(text or 1))
    except (ValueError, ZeroDivisionError):
        raise InvalidScore("invalid duration") from None
    ticks = 4 * value
    if ticks.denominator != 1 or not 0 < ticks <= 384:
        raise InvalidScore("duration outside positive 1/32 grid")
    return int(ticks)


def sequence(body, voice, offset):
    result, position, cursor, accidentals = [], 0, 0, {}

    def note():
        nonlocal position
        match = TOKEN.match(body, position)
        if not match:
            raise InvalidScore("unsupported or malformed ABC token")
        position = match.end()
        sign, letter, octaves, duration = match.groups()
        ticks = length_ticks(duration)
        if letter == "z":
            if sign or octaves:
                raise InvalidScore("invalid rest")
            return None, ticks
        upper = letter.upper()
        if sign:
            accidentals[upper] = {"^": 1, "_": -1, "=": 0}[sign]
        alteration = accidentals.get(upper, -1 if upper == "B" else 0)
        pitch = (
            60
            + NATURAL[upper]
            + (12 if letter.islower() else 0)
            + 12 * (octaves.count("'") - octaves.count(","))
            + alteration
        )
        if not 0 <= pitch <= 127:
            raise InvalidScore("MIDI pitch out of range")
        return pitch, ticks

    while position < len(body):
        if body[position].isspace():
            position += 1
            continue
        if body[position] == "[":
            position += 1
            pitches = []
            while position < len(body) and body[position] != "]":
                if body[position].isspace():
                    position += 1
                    continue
                pitch, duration = note()
                if pitch is None or duration != 4:
                    raise InvalidScore(
                        "use [DF]2 for chords; use & for unequal lengths"
                    )
                pitches.append(pitch)
                if len(pitches) > 16:
                    raise InvalidScore("chord capacity exceeded")
            if position == len(body) or not pitches:
                raise InvalidScore("unclosed or empty chord")
            position += 1
            match = LENGTH.match(body, position)
            position = match.end()
            duration = length_ticks(match.group())
            result.extend(
                Note(voice, pitch, offset + cursor, offset + cursor + duration)
                for pitch in pitches
            )
        else:
            pitch, duration = note()
            if pitch is not None:
                result.append(
                    Note(voice, pitch, offset + cursor, offset + cursor + duration)
                )
        cursor += duration
        if cursor > 24 or len(result) > MAX_EVENTS:
            raise InvalidScore("bar overrun or event capacity exceeded")
    if cursor != 24:
        raise InvalidScore("each overlay must fill one 3/4 bar")
    return result


def parse_part(text, voice):
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_PART_BYTES:
        raise InvalidScore("ABC part size exceeded")
    headers, body, in_body = {}, [], False
    for raw in text.splitlines():
        if raw.lstrip().startswith("%%"):
            raise InvalidScore("ABC directives are unsupported")
        line = raw.split("%", 1)[0].strip()
        if not line:
            continue
        if re.match(r"^[A-Za-z]:", line):
            if in_body:
                raise InvalidScore("inline headers and extra voices are unsupported")
            key, value = line.split(":", 1)
            if key not in {"X", "T", "M", "L", "K", "Q"} or key in headers:
                raise InvalidScore("unsupported or duplicate header")
            headers[key] = value.strip()
        else:
            in_body = True
            body.append(line)
    if any(headers.get(k) != v for k, v in {"M": "3/4", "L": "1/8", "K": "Dm"}.items()):
        raise InvalidScore("required headers: M:3/4 L:1/8 K:Dm")
    if not headers.get("X", "").isdigit():
        raise InvalidScore("X tune number is required")
    music = " ".join(body).strip()
    if music.startswith("|:"):
        music = "|" + music[2:]  # Legacy unmatched opener: explicitly one pass.
    if ":" in music or "|:" in music:
        raise InvalidScore("repeats are unsupported; submit one linear pass")
    bars = [part.strip() for part in re.split(r"\|(?:\]|\|)?", music) if part.strip()]
    if len(bars) != 16:
        raise InvalidScore("exactly sixteen bars are required")
    result = []
    for bar, content in enumerate(bars):
        overlays = content.split("&")
        if len(overlays) > 4:
            raise InvalidScore("overlay capacity exceeded")
        for overlay in overlays:
            result.extend(sequence(overlay, voice, bar * 24))
        if len(result) > MAX_EVENTS:
            raise InvalidScore("event capacity exceeded")
    return result


def parse_score(melody, bass, rhythm):
    result = []
    for voice, text in enumerate((melody, bass, rhythm)):
        result.extend(parse_part(text, voice))
    if len(result) > MAX_EVENTS:
        raise InvalidScore("total event capacity exceeded")
    return sorted(result, key=lambda e: (e.voice, e.start, e.end, e.pitch))
