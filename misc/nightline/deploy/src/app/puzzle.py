from array import array
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import random


NODE_COUNT = 20
MAX_COMMANDS = 128
MAP_WIDTH = 2048
MAP_HEIGHT = 1536


@dataclass(frozen=True)
class Puzzle:
    seed: str
    red: tuple[int, ...]
    blue: tuple[int, ...]
    target: int
    positions: tuple[tuple[float, float], ...]
    reference: str
    district: str

    def destinations(self, route: str) -> frozenset[int]:
        states = set(range(NODE_COUNT))
        for command in route:
            transition = self.red if command == "R" else self.blue
            states = {transition[state] for state in states}
        return frozenset(states)

    def accepts(self, route: str) -> bool:
        return self.destinations(route) == frozenset((self.target,))


def transition_tables(transition: tuple[int, ...]) -> tuple[list[int], list[int]]:
    half = NODE_COUNT // 2
    low = [0] * (1 << half)
    high = [0] * (1 << (NODE_COUNT - half))
    for mask in range(1, len(low)):
        bit = mask & -mask
        low[mask] = low[mask ^ bit] | (1 << transition[bit.bit_length() - 1])
    for mask in range(1, len(high)):
        bit = mask & -mask
        high[mask] = high[mask ^ bit] | (1 << transition[half + bit.bit_length() - 1])
    return low, high


def shortest_route(red: tuple[int, ...], blue: tuple[int, ...], target: int) -> str | None:
    low_red, high_red = transition_tables(red)
    low_blue, high_blue = transition_tables(blue)
    half = NODE_COUNT // 2
    low_mask = (1 << half) - 1
    initial = (1 << NODE_COUNT) - 1
    goal = 1 << target
    previous = array("i", [-2]) * (1 << NODE_COUNT)
    commands = bytearray(1 << NODE_COUNT)
    previous[initial] = -1
    queue = deque((initial,))
    while queue:
        mask = queue.popleft()
        next_states = (
            low_red[mask & low_mask] | high_red[mask >> half],
            low_blue[mask & low_mask] | high_blue[mask >> half],
        )
        for command, destination in enumerate(next_states):
            if previous[destination] != -2:
                continue
            previous[destination] = mask
            commands[destination] = command
            if destination == goal:
                route = []
                while previous[destination] != -1:
                    route.append("RB"[commands[destination]])
                    destination = previous[destination]
                return "".join(reversed(route))
            queue.append(destination)
    return None


def periodic_states(transition: list[int]) -> int:
    states = set(range(NODE_COUNT))
    for _ in range(NODE_COUNT):
        states = {transition[state] for state in states}
    return len(states)


def grid_cycle() -> list[int]:
    cycle = list(range(5))
    for row in range(1, 4):
        columns = range(4, 0, -1) if row % 2 else range(1, 5)
        cycle.extend(row * 5 + column for column in columns)
    cycle.extend((15, 10, 5))
    return cycle


def neighbors(node: int) -> list[int]:
    row, column = divmod(node, 5)
    return [
        other_row * 5 + other_column
        for other_row, other_column in ((row - 1, column), (row + 1, column), (row, column - 1), (row, column + 1))
        if 0 <= other_row < 4 and 0 <= other_column < 5
    ]


@lru_cache(maxsize=48)
def generate(seed: str) -> Puzzle:
    rng = random.Random(int.from_bytes(hashlib.sha256(seed.encode()).digest(), "big"))
    cycle = grid_cycle()
    if rng.randrange(2):
        cycle.reverse()
    red_base = [0] * NODE_COUNT
    for source, destination in zip(cycle, cycle[1:] + cycle[:1]):
        red_base[source] = destination
    labels = list(range(NODE_COUNT))
    rng.shuffle(labels)
    red = [0] * NODE_COUNT
    for source in range(NODE_COUNT):
        red[labels[source]] = labels[red_base[source]]
    for _ in range(96):
        blue_base = list(range(NODE_COUNT))
        unmatched = list(range(NODE_COUNT))
        rng.shuffle(unmatched)
        available = set(unmatched)
        for source in unmatched:
            if source not in available:
                continue
            options = [node for node in neighbors(source) if node in available]
            if options and rng.random() < 0.93:
                destination = rng.choice(options)
                blue_base[source], blue_base[destination] = destination, source
                available.remove(destination)
            available.remove(source)
        for source in rng.sample(range(NODE_COUNT), 3):
            blue_base[source] = rng.choice(neighbors(source))
        if periodic_states(blue_base) < 5:
            continue
        blue = [0] * NODE_COUNT
        for source in range(NODE_COUNT):
            blue[labels[source]] = labels[blue_base[source]]
        target = rng.randrange(NODE_COUNT)
        route = shortest_route(tuple(red), tuple(blue), target)
        if route is not None and 22 <= len(route) <= 72:
            break
    else:
        raise RuntimeError("Не удалось построить город с подходящим маршрутом")
    positions = [(0.0, 0.0)] * NODE_COUNT
    mirror = rng.randrange(2)
    for node in range(NODE_COUNT):
        row, column = divmod(node, 5)
        if mirror:
            column = 4 - column
        positions[labels[node]] = (
            265 + column * 376 + rng.uniform(-23, 23),
            255 + row * 337 + rng.uniform(-18, 18),
        )
    district = rng.choice(("Северная гавань", "Речной квартал", "Тихий порт", "Старая набережная", "Восточный причал"))
    return Puzzle(seed, tuple(red), tuple(blue), target, tuple(positions), route, district)
