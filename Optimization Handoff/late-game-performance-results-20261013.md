# Late-game optimization implementation and results

The accepted changes save roughly 8 ms per tick in the longer-warmup paired
headless replay. They do not deliver the requested 20 ms or qualify sustained
rendered 1x play. The routing reservation experiment was rejected and removed.

## Implemented

- SpatialGrid now visits occupied cells using a bitset and fuses envelope
  selection without changing candidate order or live extent reads.
- Movement, transport clearance and reform terrain certification can bypass
  detailed geometry after a conservative proof that the whole swept body is
  free of terrain, fortification and applicable hostile obstructions. Columns
  retain the exact path. Existing transport, immobilization and movement rules
  still run. Failed proofs use the existing exact implementation.
- Combat acquisition ignores activity from the attacker's own faction while
  tracking its own pose independently. Enemy activity, diplomacy, obstacle,
  casualty and transition dependencies retain their invalidation rules.
- Local worker publication sends a versioned transferable trader motion roster
  and detail upserts/removals. It avoids projecting every trader before checking
  for changes. In-place list edits and cargo-wait changes are detected. Decoder
  staging, reset/recovery and independent snapshot ownership are tested. Public
  and network snapshots retain their existing projection.
- Opt-in autonomous logical deadlines now cover queued land setup, structure
  handoff, cohort preparation, ship replacement/activation and trader planning.
  Expiry is processed even with zero planning allowance. Existing ship intent
  and trader cargo survive capacity expiry, and capacity results do not poison
  the new land/trade geographic failure paths. No new default policy is enabled.
- A separately opt-in 30-tick autonomous decision schedule preserves physical
  movement and combat at 20 Hz. Long autonomous routes can use the existing
  hierarchical planner under the bounded policy; idle preparation capacity is
  lent only while no interactive request waits. These policies are experimental:
  increased useful activity currently increases total simulation cost.

The extent query still retains the original global maximum search inflation.
Occupied-cell skipping is implemented; full per-bucket extent ownership is not.
The remaining exact movement/reform kernels have not been replaced.

## Measured results

Control source: `5b3064f5f05679e406ce35617029674bb7b6e846`, archived under
`out/late-game-20ms-20261012/control/src`.

Input: `out/local-stability-20261012/fixed-browser-seed/final.v8`, Migration 1000,
seed 1272661902, approximately 530 squads and 270 ships, tick 36000. SHA256:
`1c3f5289b914288c0fb262ba59d89b3d9efcf0e4682e13a557b9bf42e890ef60`.

Two Node matches alternate execution order every tick, publishing and decoding
every tick. Worker cost is simulation + encoding + structuredClone transfer;
decode is reported separately. No renderer runs. Node v24.18.0. The benchmark
shares a process, heap and GC, so these absolute costs are not browser 1x proof.
The original fixture's human player is eliminated; late player-order latency
is not qualified by this replay.

| Measurement | Control | Candidate | Saving |
| --- | ---: | ---: | ---: |
| 40 warmup, 400 measured ticks, repeat 1 worker mean | 112.65 ms | 100.75 ms | 11.90 ms |
| 40 warmup, 400 measured ticks, repeat 2 worker mean | 112.24 ms | 103.48 ms | 8.76 ms |
| 200 warmup, 400 measured ticks, worker mean | 108.36 ms | 100.20 ms | 8.16 ms |
| Longer-warmup worker p95 | 153.56 ms | 135.94 ms | 17.62 ms |
| Longer-warmup worker p99 | 167.17 ms | 152.03 ms | 15.14 ms |
| Longer-warmup simulation mean | 94.90 ms | 92.23 ms | 2.67 ms |
| Longer-warmup encode + transfer mean | 13.46 ms | 7.97 ms | 5.49 ms |
| Longer-warmup decode mean | 12.71 ms | 6.51 ms | 6.19 ms |

All 400 measured ticks in the longer-warmup run exceeded 50 ms on both sides.
Maximum worker time increased from 412.07 to 522.42 ms; improved averages and
percentiles do not establish spike elimination. The two short-warmup runs'
final 100-tick windows saved 7.62 and 5.40 ms. Do not promote the first run's
startup-influenced mean into a 12 ms sustained saving.

Canonical checkpoint hashes match in all three final comparisons. The longer
run ended at tick 36601 with hash
`66c73418b18539c7c31f539c31df1a353d0a8450d41eab72c1de6ef27e2dd6d4`.
Both sides delivered 99,366 gold during its measured window. Performance was
not obtained by disabling useful simulation work.

Reproduce the principal comparison with:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/profileLateGamePair.ts --warmup 200 --ticks 400 --out out/late-game-20ms-20261012/final-warm-pair
```

Raw result files and per-tick rows are in `final-pair-1`, `final-pair-2` and
`final-warm-pair` under `out/late-game-20ms-20261012`.

## Rejected routing experiment

The same shared arena was tested with an 8,192-node autonomous query limit,
16,384 slots reserved for human queries, no autonomous exclusive retry, and
the opt-in 40-tick deadline on both comparison sides. Over 400 ticks:

| Measurement | Control | Reservation experiment |
| --- | ---: | ---: |
| Worker mean | 122.06 ms | 123.90 ms |
| Routing mean | 21.56 ms | 20.94 ms |
| Completed routes | 1,643 | 1,606 |
| Capacity-limited routes | 436 | 424 |
| Planning work | 1,360,648 | 1,313,248 |
| Delivered gold during window | 205,560 | 206,220 |

Slightly lower planner CPU did not make the match faster. Runtime reservation
code and its option were removed. Evidence and the experimental patch/test are
archived under `out/late-game-20ms-20261012/rejected-reservations`; measured
results are under `paired-route-reservation`. The patch is an archival diff,
not a standalone patch to apply blindly to the current source.

## Validation and remaining work

- 2,276 tests passed across 329 skirmish test files. The broad run passed
  2,218 tests with two workers. MigrationMap and BlackForestMap passed all
  58 tests in an isolated run after their hard-coded timeouts were exceeded
  under concurrent load. No map implementation was changed.
- Column fixtures now install actual indexed barriers with valid building
  endpoints instead of overriding only the exact lookup. All 22 passage,
  deployment and restore assertions pass. The transport wall fixture uses
  actual indexed occupancy as well.
- Final TypeScript check, production build and diff whitespace check passed.
- No commit, push or deployment was performed.

An intermediate production-browser replay was saved in
`out/late-game-20ms-20261012/production-first-report.json`: its final rolling
worker mean was 64.52 ms, with roughly one-second frame delivery intervals.
That session was paused. It predates the final changes and does not qualify
normal foreground rendering or current-source pace.

The longer-warmup candidate still spent 32.31 ms in movement, 20.92 ms in
combat, 18.88 ms in routing and 7.78 ms in AI. These exclusive phase costs
identify the residual budget; inclusive geometry instrumentation must not be
added to them. The 20 ms estimate was optimistic. Further work needs a new
measured pass on exact movement/reform allocation and useful route preparation,
including shared-workspace fairness, rather than another arbitrary budget cut.

Outstanding acceptance gates: three rendered fixtures, sustained 1x pace,
30-minute wall-time soak, Opera repeat, queue/memory bounds, complete 40-tick
autonomous admission semantics, and late-game player command-to-movement
latency. Neither playtest stability nor the earlier 2,000-squad target is proven.
