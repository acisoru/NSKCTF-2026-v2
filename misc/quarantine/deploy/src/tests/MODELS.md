# Model Verification

2026-10-02. The model changes do not affect authoritative hit shapes, movement,
projectile trajectories or damage. Character recreation is a separate explicit
server operation described in README.md.

## Coverage

- 78 Node tests pass, including first-person camera/recoil/reload, rigid
  geometry batching, preserved animation joints, finite vertex/normal/UV data,
  scalar texture color space, material reuse and cheaper enemy LOD variants.
- Full Chrome gameplay passes: sprint, jump, ladders, medkits, weapon purchases,
  four weapon families, reload, ten-player parties, reconnect and private raid
  rewards. The game canvas is nonblank.
- Dedicated model scenes pass in Chrome and Firefox. Screenshots cover three
  roles, six weapon families, three bosses, drones, bomber and pylon at desktop
  viewports. Rotors/fans change angles while rendering. Framing is checked at
  1440x900 and 1366x768.
- An 80-character/36-enemy scene retains at most 16 detailed player models and
  12 detailed ordinary enemies, with 88 low-detail instances. Replacing the
  population twice does not increase its geometry or texture counts.

Pure model fixtures contain about 79,000 triangles for an assault character
with weapon, 73,700 for the warden and 30,100 for a detailed drone. Rigid details
are batched; each tested detailed asset uses at most 48 meshes. Far enemy models
use less than 15% of the corresponding detailed geometry. These are model and
resource-lifecycle checks, not an FPS guarantee or a 300-browser load test.
The existing server capacity measurements remain separate in LOAD_RESULTS.md.

## Reproduce

From `misc/quarantine/src/`:

```sh
npm run build
npm test
npm run test:browser
npm run test:models
npm run test:recreate
npx playwright install firefox
BROWSER=firefox npm run test:models
```

PLAYWRIGHT_BROWSERS_PATH may select a separate browser cache. The model gallery
is built only by the test runner on a temporary loopback HTTP port; it is not a
production endpoint. Screenshots are written into test-results/. Neither these
fixtures nor gameplay tests use real OAuth credentials or player saves.

## Weapon Assembly And Recreation

Weapon regression builds unbatched geometry and verifies connected attachment
bounds: rails have a continuous base, magazine ribs follow their parent angle,
the shotgun carrier retains its shells and the machine-gun feed is supported.
The projectile model has a copper-colored pointed body, no spherical core and
a short alpha-faded trail behind the authoritative tip. The gallery inspects
both player/enemy projectiles outside safe zones and asserts they are visible.

Recreation tests cover safe-zone/role/confirmation guards, stale requests,
one-minute account cooldown across restart, unchanged account identity,
preserved earned flag entitlement, no starter-credit/medkit regeneration,
cleanup of old combat/loot/party state, reconnect and persisted acknowledgement.
Browser coverage includes cancellation, confirmation, blocked submission outside
safe zones, role refresh and the modal layout. Only test characters are reset.
