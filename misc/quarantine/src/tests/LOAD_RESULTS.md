# Load Test: 300 Players

Measured 2026-09-30 in Docker Desktop, Linux ARM, Node.js 24.
The container was limited to 4 CPUs and 8 GB RAM. Server and two client-worker
threads ran in the same container, using real loopback WebSocket connections.
Each scenario had a 2-second warmup. The first run measured 20 seconds per
scenario; the latest first-person/last-hit build measured 30 seconds per scenario.

## Latest Run: Performance Gate Failed

| Metric | Spread combat | Crowded combat |
|---|---:|---:|
| Connected players | 300 | 300 |
| Simulation ticks/s | 29.4 | 29.7 |
| Tick p95, ms | 19.30 | 12.80 |
| Tick p99, ms | 39.58 | 14.58 |
| Broadcast p95, ms | 123.15 | 31.76 |
| Event-loop delay p95, ms | 25.15 | 20.17 |
| Loopback RTT p95, ms | 20 | 11 |
| Loopback RTT p99, ms | 90 | 12 |
| Outbound payload, Mbit/s | 191.25 | 366.84 |
| Process RSS, MiB | 310.0 | 314.1 |
| Disconnections | 0 | 0 |
| Dropped snapshots | 0 | 0 |

The spread scenario exceeded the 33.34 ms p99 tick budget. The 300 connections
remained online, but this is not a passing result for consistent 30 Hz simulation.
The test exited with status 1. The variation from the earlier run must not be
hidden by quoting only its passing numbers. Profile on the target host before
claiming a lag-free 300-player deployment. An existing Compose game server was
also running on the same Docker host, so this was not an isolated-host benchmark;
no claim is made about which component caused the spike.

## Earlier Run: Performance Gate Passed

| Metric | Spread combat | Crowded combat |
|---|---:|---:|
| Connected players | 300 | 300 |
| Simulation ticks/s | 30.0 | 29.7 |
| Tick p95, ms | 16.27 | 12.43 |
| Tick p99, ms | 20.68 | 15.74 |
| Broadcast p95, ms | 91.29 | 34.07 |
| Event-loop delay p95, ms | 23.07 | 19.73 |
| Loopback RTT p95, ms | 14 | 10 |
| Loopback RTT p99, ms | 16 | 16 |
| Outbound payload, Mbit/s | 211.36 | 365.06 |
| Process RSS, MiB | 312.5 | 316.4 |
| Disconnections | 0 | 0 |
| Dropped snapshots | 0 | 0 |

Spread combat mixes pistols, shotguns, sniper rifles and machine guns across
the world. Crowded combat starts all 300 players in one firefight with machine
guns. Clients send input at 20 Hz; every fourth player sprints and every fifth
jumps periodically. High fixture HP prevents deaths from reducing combat load.
The benchmark uses compressed spatial world deltas and private player messages.

From `misc/quarantine/src/`:

```sh
docker build -f ../deploy/Dockerfile -t nsk-quarantine:local .
docker run --rm --cpus 4 --memory 8g \
  --env NODE_ENV=test --env LOAD_SECONDS=30 \
  --mount "type=bind,source=$PWD/tests,target=/app/tests,readonly" \
  nsk-quarantine:local node tests/load.mjs
```

For an unrestricted local check, use `npm run test:load`. `LOAD_PLAYERS` and
`LOAD_SECONDS` adjust player count and measurement duration. No real OAuth
accounts are created; the test-only authentication fixture is inaccessible
through production configuration. The test does not read deployment secrets.

This is a short synthetic capacity check, not a latency SLA or a long soak test.
It does not exercise OAuth provider capacity, persistent disk saves, slow WAN
clients, browser rendering, or attacks. RTT is loopback, and outbound throughput
excludes TCP/WebSocket/TLS overhead. RSS includes the client workers, not the
entire container. CPU limits do not specify the performance of a particular VPS.
Budget a 1 Gbit/s uplink and rerun on the actual server with a longer duration
and an external load generator before an event. Crowded client FPS additionally
depends on the player's GPU; player LOD and cosmetic-effect limits reduce work.
