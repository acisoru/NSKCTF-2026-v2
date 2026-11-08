# Verification And Capacity

Run all commands below from `admin/network_ops/src/`.

The web service and kernel network checker are tested separately. Browser
rendering is client-side; HTTP session count is not equivalent to simultaneous
Linux network labs. The default queue runs one checker job at a time.

Measured on 2026-10-01, Docker Desktop Linux ARM / Node.js 24, on a shared
development host. Do not interpret these measurements as a VPS or WAN SLA.

## Web Service: 100 Sessions

The container was limited to 1 CPU and 1 GiB. The same process contained the web
server and HTTP load generator. Each session made one cable-test action and one
state read per second, with isolated cookies and real progress-file persistence.

| Metric | Result |
|---|---:|
| Sessions | 100 |
| Measurement duration | 20 s |
| Requests | 4,000 |
| Failures | 0 |
| Requests/s | 200 |
| Response p95 | 56.53 ms |
| Response p99 | 116.81 ms |
| Outbound HTTP payload | 9.42 Mbit/s |
| Process RSS, including load generator | 136.6 MiB |
| Checker jobs in this test | 0 |

This does not simulate 100 GPUs, WAN clients, or 100 concurrent network checks.
Reproduce with the `tests/` directory mounted read-only into the web image:

```sh
docker build --target web -f ../deploy/Dockerfile -t labx-network-web:local .
docker run --rm --cpus 1 --memory 1g \
  --mount "type=bind,source=$PWD/tests,target=/app/tests,readonly" \
  labx-network-web:local node tests/load.mjs
```

## Real Network Checks

One worker, limited to 2.5 CPU and 3 GiB. Valid author solutions were built
through game actions and checked against actual Linux/OVS/FRR instances.

| Scenario | End-to-end elapsed | Result |
|---|---:|---|
| Easy | 1.64 s | Addressing, DNS and HTTP passed |
| Medium | 2.12 s | DHCP, VLAN connectivity, HTTP and ACL probes passed |
| Hard | 21.49 s | RSTP, OSPF, primary-uplink failure and cold boot passed |

Negative cases also passed: wrong VLAN rejected (1.96 s), missing ACL rejected
(1.88 s), disconnected camera did not count as isolation (7.94 s), missing
backup rejected (37.72 s), unsaved OSPF rejected after cold boot (34.98 s).
Wrong authentication and invalid interface references were rejected before
creating a lab. No network namespaces or OVS bridges remained after the suite.
The final safety-admission check also rejected an unprotected L2 cycle without
starting a broadcast storm. MAC tables, per-bridge RSTP state, OSPF neighbors and
DNS-aware ping were independently queried from real devices.

Slow/broken configurations spend time waiting for real protocol timeouts, so
queue capacity must be planned using failures as well as successful runs.
100 simultaneous Hard submissions at 21.49 s each would require roughly 36
minutes of service time on one worker, excluding failures and overhead. With
four independent equally fast workers the idealized batch time is about nine
minutes; this is an estimate, not a measured four-worker result. Interactive
diagnostics also consume worker slots. More RAM alone does not reduce this queue.

The web service can start on the existing host; for an event, isolate workers
in a dedicated VM with no other CTF services or credentials. An 8-vCPU/16-GiB
worker host with 2–4 workers is a starting budget to benchmark, not a proven
minimum. Rate of submissions and acceptable queue time determine final sizing.

## Functional Checks

75 Node tests cover physical construction, damaged conductors, split pairs,
configuration parsing, persistence, per-session isolation, stale results and
private rewards, OAuth state/PKCE, identity quotas, migration, active-time guards,
server gesture tokens, exact topology, projection redaction and movement limits.
Playwright exercised sixteen real 3D wire drags, both crimper
handles, certification, configuration entry, a real Easy checker result, private
progress and all three scene variants. Canvas pixels were nonblank. This is not
a substitute for a human difficulty/balance playtest.

The separate camera regression test uses native Chrome pointer lock, not a mock:
first-click capture, horizontal/vertical relative movement, Escape, recapture,
crosshair selection, automatic release for inspection/dialogs/console, and a
wire drag with the cursor unlocked. Camera rotation is checked using canvas
pixel differences. It does not require a network-checker worker.

The tabletop regression uses physical 3D tools without the old assembly
buttons, at 1440x900 and 1366x768. It measures and cuts cable, rejects premature
RJ45 insertion, checks disposal confirmation, drags all sixteen wires, strips
both ends, trims, inserts connectors, squeezes the crimper, certifies and stows
the result. Screenshots and canvas-pixel checks cover the full table. The
routed-cable geometry test enumerates every endpoint pair across all missions
and checks floor clearance, including tray routing, against tube vertices.

Real worker diagnostics cover static and DHCP addresses, links, routes, ARP,
dig with explicit/default DNS, nslookup, missing resolvers and disconnected
links. Both parsers reject external resolvers, arbitrary names, AXFR and
invalid interfaces. `help` is list-only; every listed command has `--help`.

Incident regressions cover the 300-second active timer, migration of older
15-minute schedules without resetting progress, pause without heartbeat,
random exposed-wire permutations, obstacle-aware rat movement, chewing,
protected tray cables, persistent breaks, stale checker results, gun pickup,
ammunition, reload, hit range and occlusion. Playwright picks up the wall gun,
observes rat movement, shoots and reloads, and checks animated cable sparks.
The browser fixture advances the server's private simulation time; it does not
wait five wall-clock minutes and no fast-forward endpoint exists in production.
The three real checker scenarios also pass when every cable is handmade.
`node tests/checker-damage.mjs` additionally confirms that an actual simulated
bite breaks the worker's cable check and real HTTP connectivity to the archive.

After account-bound admission and interaction guards, an additional local
Node.js run with 100 simultaneously active rats and 100 private accounts
completed 3,000 requests in 15.01 s with zero failures: p95 43.96 ms,
p99 109.43 ms, process RSS 164.6 MiB including the load generator. An earlier
run concurrent with browser/network tests had zero failures but p99 685.88 ms,
exceeding the 500 ms local benchmark threshold; the isolated rerun passed.
Reproduce with `LOAD_WORLD=1 LOAD_SECONDS=15 npm run test:load`. This run was on
the shared macOS development host without a CPU limit, had no checker jobs
and did not render 100 browsers; it is not a 4-vCPU production guarantee.

OAuth tests use the real redirect/state/cookie/token-exchange code with a mock
provider; no Yandex password or real authorization code is embedded in tests.
Actual consent and first account login still require the user's browser.
`node tests/login-browser.mjs` checks the login gate, server-enforced pause,
resume and logout at a desktop viewport, with screenshots and no anonymous
profile allocation before the OAuth callback.
`node tests/panels-browser.mjs` verifies I/J toggles at 1440x900 and 1366x768,
retained native pointer lock, movement and camera rotation with panels open,
Escape cursor release without closing panels, scene-click recapture, repeat
and modifier guards, non-Latin keyboard layout, text entry, bench actions and
shooting with both panels visible. Modal dialogs still block movement.
HTTP fixtures prove that the old semantic assembly calls fail even after login,
the two-cable Easy shortcut is rejected before worker execution, paused actions
are refused, non-world actions advance incident time, late body bursts are
rate-limited, and repeat login does not create fresh profiles or quotas.

## Anti-Cheat Regression (2026-10-02)

All 63 Node tests passed, including 13 anti-cheat cases: repeated trusted-field
tampering, correction-acknowledged impossible movement, invented current gesture
tokens, duplicate suppression, stale/known tokens, lost corrections, latency,
ordinary input errors, identity isolation, expiry, reset/re-login/restart,
in-flight HTTP requests, pending checker cancellation and no late reward delivery.
Persistent tests exercise private operator socket permissions, unban without
progress loss, failed unban writes, and automatic retry of a failed ban write.

`node tests/anticheat-browser.mjs` checks actual auto-ban, cursor release, expiry
and reference display, blocked reload and return to play after operator unban
at 1366x768. All ban tests use isolated mock-provider identities, never live
players. Native camera movement/sprint and full tabletop construction also
pass with zero scored cheat signals (tabletop: 1440x900 and 1366x768).

A local post-change run (`LOAD_WORLD=1 LOAD_SECONDS=15 npm run test:load`)
used 100 active accounts and rats: 3,000 requests in 15.01 s, zero failures,
p95 25.05 ms, p99 78.84 ms, 164.9 MiB RSS including the load generator and
2.18 Mbit/s response payload. This is another shared macOS development-host
measurement without a CPU limit or checker jobs, not a 4-vCPU production SLA.

Reproduction from the task directory:

```sh
npm run build
npm test
docker build --target checker -f ../deploy/Dockerfile -t labx-network-checker:local .
docker compose -f tests/checker-compose.yml up -d
npm run test:checker
node tests/checker-negative.mjs
npm run test:browser
npm run test:camera
npm run test:bench
npm run test:incidents
node tests/anticheat-browser.mjs
node tests/audio-browser.mjs
node tests/audio-controls-browser.mjs
node tests/checker-diagnostics.mjs
```

The checker has 2.5 CPU and 3 GiB memory limits in this local Docker Desktop
Linux ARM fixture. Its test token is non-production, and its port is bound only
to loopback. Measurements on a shared development host are not isolated-host
or Internet-latency measurements.

## Audio And Tool Slots (2026-10-02)

Six additional unit tests cover persisted/bounded audio preferences, unavailable
storage, no audio creation before input, spatial attenuation and camera-relative
stereo, result cues, both five-tool layouts, numpad keys and text/drag/modifier
guards. All 69 Node tests pass.

`node tests/audio-browser.mjs` passes at 1440x900 and 1366x768: actual music
samples after user activation, five server-confirmed world and bench selections,
modal/text input guards, saved independent volumes, mute/pause/resume and a
synthetic visibility-change regression. No cheat signals or JavaScript errors.
Screenshots cover the sound dialog and selected tabletop tool. Full manual
cable construction, native incident gameplay and the ban screen also pass.

OfflineAudioContext renders the actual production audio graph at 48 kHz.
Five-second windows have music RMS 0.00794 / peak 0.04789 and shotgun RMS
0.01074 / peak 0.31109. Strip, crimp, tester and error cues have distinct
nonzero output; mute and either zeroed volume bus produce exact silence.
All scheduled voices disconnect after rendering. These checks establish signal
generation and lifecycle correctness, not a subjective listening assessment
or a guarantee about the user's hardware output level.

## Nonmodal Panels And Trimming (2026-10-02)

All 71 unit tests pass. Two additional cable regressions cover the 12 mm
trimming jig, old 25-28 mm stripping strokes with completed trim, read-only
interpretation of saved cables, and continued rejection of missing trim,
deep cuts, split pairs and physical damage. Manual-construction checks no
longer duplicate electrical-quality failures.

The tabletop browser test completes, certifies and stows a cable with a short
stripping stroke at 1440x900 and a longer stroke at 1366x768. Both pass with
zero cheat points and nonblank canvas pixels. Nonmodal-panel browser checks
also pass at both sizes without JavaScript errors or cheat points.

## Firefox Audio And Frozen Workbench (2026-10-02)

The original failure was reproduced in real Firefox 155: dragging music to 80
left its visible output at 32%. Firefox has no AudioParam.cancelAndHoldAtTime;
the resulting exception also interrupted the animation frame when the workbench
changed the music mix. A compatible hold fallback now preserves the current
gain with cancelScheduledValues/setValueAtTime. Audio failures are isolated
from scene changes, preference updates and gameplay.

Two additional unit tests cover the native/fallback envelope paths and audio
failure isolation. The full suite contains 73 tests. The new regression uses
real mouse drags, asserts percentages before mouse release and measures actual
bus gains plus scheduled music output, not just a nonzero offline waveform.
It also checks keyboard adjustment, silent zero volume, persisted mute,
full manual cable construction with music active, workbench exit and movement,
and continued rendering/control after an injected audio-device failure.

The final runs pass in Firefox 155.0 and Chromium 153.0.8010.54 at 1366x768.
Scheduled music measured RMS 0.00565 and 0.00575 respectively; setting its
slider to zero measured exact silence in both. All 73 unit tests pass.

Reproduce the browser regression with:

```sh
node tests/audio-controls-browser.mjs
npx playwright install firefox
BROWSER=firefox node tests/audio-controls-browser.mjs
```

Browser installation/test cache can be relocated with PLAYWRIGHT_BROWSERS_PATH.
Tests use isolated mock OAuth accounts and never reset a live player's lab.

## Workbench Tool Models (2026-10-02)

The selection plates are removed. All nine tools have separate detailed
geometry and cached surface materials; crimper handles pivot instead of
scaling the complete tool. Unit regressions check unscaled handle movement,
finite vertex/normal/UV data, pickable tool and depth-wheel surfaces, linear
scalar texture maps and material/texture reuse across workbench rebuilds.

Full tabletop construction, both stripping strokes, certification and stowing
pass in Chrome at 1440x900 and 1366x768. Firefox's full audio/assembly regression
also passes at 1366x768 with no JavaScript errors or cheat points. Screenshots
and nonblank canvas checks cover the updated tools and the completed cable.
