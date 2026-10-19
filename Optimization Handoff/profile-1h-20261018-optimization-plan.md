# One-hour profile and parity-preserving optimization plan — 18 October 2026

Source: `49a95269` (b1.5.8) on branch `1.5.7-10hz-prototype`. Nothing in `src/` was changed by this
investigation. All raw data, scripts and checkpoints are in `out/profile-1h-20261018/`.

## Implementation status (19 October 2026, uncommitted)

### Phase 0 parity harness

- **Fixture A/B:** `scripts/fixtureParityPair.ts`. It archives the control tree from a git ref with
  `git archive` into `out/parity/control-<sha>`. It compares every publication packet and a checkpoint hash
  every N ticks, and exits 1 on any divergence.
- **Self-test:** HEAD against an identical tree shows parity, with 0.7% timing noise.
- **Negative control:** an injected 0.25-unit squad nudge every 25 ticks was caught at the next checkpoint.
  The publication alone did not catch it, because wire positions are quantized.
- **Fixture generator:** `scripts/createLateGameFixture.ts` reproduces fixtures from the lobby options.

### Operational defects (both fixed)

- **Intentional end logged as a crash:** `LiveMatch.endAfterFailure` now returns early when `end()`
  already ran, and every end logs one `{event:"match-ended", …}` line.
- **Lost worker failure causes:** `ReservedMatchWorker` records the worker error `code`/`message` in
  `lifecycle` and logs `match-executor-exited` once for any stop that wasn't requested.
  `SnapshotEncodingWorker` does the same (`snapshot-encoder-exited`).
- **Tests:** new cases in `LiveMatch.test.ts` and `ReservedMatchWorker.test.ts`.

### Phase 1 status

| Item | Status |
|---|---|
| Q1 per-edge spread | Done: one reused probe |
| Q2 diagnostics | Done: typed-array sort; path residency refreshed once per simulated second instead of on every publication |
| Q3 bundled server | Done. `npm run build:multiplayer` → `build/multiplayer/*.mjs`, `start:multiplayer:built`; `WorkerEntry.ts` picks `.mjs` siblings without tsx. `Dockerfile.multiplayer` and `deploy/oracle/Dockerfile` build and run the bundle. Smoke-tested with a live browser match; a Docker build was **not** tested |
| Q4 footprint scan early exit | **Dropped.** Lobby matches use `raids-v1`, where `aiFootprintAllowed` returns before the radius scan |
| Q5 `performTick` allocations | Partly done: hoisted shape list, scratch `Set`/`Map`. In-place intent mutation and numeric navigation keys were skipped as not worth the risk |
| Q6 formation counts | Done: one doctrine lookup per squad. The pass-skip counter was skipped |
| Q7 zero-damage squads | Done: skipped only when provably a no-op (`undamagedNoOp`) |
| Q8 warship port scans | Done: `buildingIndex.byType` (same ordinal order) and `byId` |
| Q9 smaller items | Done: `siteSnapshot` first-per-tile Set, cheapest-first `homeNeedsLand`, incremental grid max extent. `LandingOccupancy` was already gated by an equality check, so it was left alone |

### Measured Phase 1 results

| Fixture (200 warm-up + 400 ticks) | Control | Candidate | Saving | Parity |
|---|---:|---:|---:|---|
| `checkpoint-sim45.v8` | 72.9 ms | 71.3 ms | 2.2% | 300 publications, 25 checkpoints identical |
| `checkpoint-sim60.v8` | 101.7 ms | 96.8 ms | 4.8% | 300 publications, 25 checkpoints identical |

- **Bundling (Q3)** adds about 1.5–2.5% on top, measured separately on the same fixture as tsx versus
  bundled. Q2 is server-only and is not in these figures.
- **Phase 1 delivered about half of its 8–12% estimate.** The large remaining items are Phase 2 (trade
  admissions, research revision, `hostile()` table, borrowed traders) and combat (C1).

### Phase 2 status (S1–S4 done; S5 and S6 not started)

| Item | What changed | Why results are identical |
|---|---|---|
| S1 trade indexes | `IdLookup` (verified id→position, scan fallback on a miss) for actor and player lookups in `validRoute`, `stepPlanning`, `allowedMarket` and `landCandidates`. Loading-admission counts per (player, naval, origin) are maintained by `setAdmission`/`deleteAdmission`, replacing the O(admissions) scan in `begin()` | Ids are unique. Admissions without an origin tile (old saves) fall back to the original scan |
| S2 research effects | `tradeCargoEffects` is memoized per completed-research array (identity + length, frozen value). `Trade.cargoEffects` and `Supply.goodsCapacity` no longer key on `tick` / `progression.revision`, which bumped every tick | `completed` is append-only or replaced wholesale (checked every writer) |
| S3 `hostile()` table | `Uint8Array` pair table in `Diplomacy`, cleared whenever revision, tick, or the identity/length of alliances, wars, embargoes or peace protection changes | Every input mutation appends, reassigns or bumps `revision`. New `DiplomacyHostileMemo.test.ts` compares every pair to the direct rule over 1,500 random steps per rule set, including restores |
| S4 borrowed traders | The server captures with `replicationSource(true)` (`serverMatchWorker.ts`) | The harness's `--candidate-borrowed` A/B shows byte-identical packets, key order included |

| Fixture (200 warm-up + 400 ticks, against the Phase 1 tree) | Phase 1 | Phase 2 | Saving | Parity |
|---|---:|---:|---:|---|
| `checkpoint-sim45.v8` | 101.7 ms | 84.9 ms | 16.5% | 300 publications, 25 checkpoints identical |
| `checkpoint-sim60.v8` | 177.6 ms | 150.8 ms | 15.1% | 300 publications, 25 checkpoints identical |

- Absolute ms were inflated by machine load during these runs; the alternating A/B keeps the ratio valid.
- **Cumulative, HEAD (`49a95269`) against Phase 1 + 2 on `checkpoint-sim60.v8`:** 122.6 → 103.1 ms,
  **15.9% saved**, with parity (300 publications, 25 checkpoints).
  - Bundling the server (about 2%) and the server-only diagnostics savings come on top.
  - Applied to the profiled late game (139 ms per tick), that estimates roughly 113–117 ms: under the
    125 ms budget, but with little headroom.
  - Combat (C1/C2) and routing (C4) remain the next levers.
- **Full suite after Phase 2:** 3,266 passed. Two failures:
  - `RussianAssetIntegration` also fails on clean HEAD.
  - `StateDelta` "rebuilds a running match" hit its 60 s timeout under full-suite load; it passes in
    isolation in about 9 s.
- Phase means at 60 min:
  - publication capture 22.8 → 14.2 ms;
  - combat 46.9 → 38.0;
  - AI 25.6 → 20.5;
  - economy 18.9 → 14.5;
  - routing 23.2 → 21.4.

## Bottom line

- **The server falls behind real time in the late game.** In a live hour on Migration 1000 with 14 AI, 30
  tribes and 3× technology speed, the match worker averaged 107–148 ms per tick from minute 40, against a
  125 ms budget (8 ticks/s). Pace slipped from 0.99 to 0.96, so 57.5 simulated minutes ran in 60 wall
  minutes. p95 ticks reached ~200 ms and the worst tick was 583 ms.
- **The late-game cost is spread across many systems.** Routing, trade/economy, AI, combat and movement each
  take 10–20% of busy time. No single fix gets the game back under budget.
- **There is a credible set of parity-preserving fixes.** Profile shares put their combined saving at roughly
  25–35% of late-game worker time, which would take ~139 ms to roughly 95–105 ms. That is an estimate:
  earlier work in this folder found estimates optimistic, so every item ships behind a measured A/B with
  identical checkpoint hashes.
- **Memory is fine for 60 minutes but not proven for the 90-minute time limit.** Live heap (after a forced
  GC) grew 97 → 219 MB, about 2 MB per minute, against the worker's 384 MB old-space cap.
- **Late-game client cost is moderate.** Each publication costs ~18.5 ms on the browser's state worker and
  ~10 ms of main-thread structured-clone receive, at 4 publications per second.
- **Two operational defects surfaced.** An intentional match end is logged as `Match stopped Error`, and
  worker exit causes are never logged.

## What was measured

| Run | What | Coverage |
|---|---|---|
| Run 1 | Live server and browser client, in-thread sampling CPU profiler (2 ms) on every server thread, sliced every 5 min | 35 min. Ended when the idle human seat was conquered (the normal "every human empire has been defeated" path, `LiveMatch.ts:655-656`) |
| Run 2 | Same lobby without the profiler, with `SKIRMISH_LIVE_HEAP=1` (true live heap every 30 s of game time) | **The full 60 wall minutes** |
| Headless A | Same seed, settings and `lobbyMatchOptions`, human seat AI-controlled, no pacing, snapshot encode every 2nd tick | 60 simulated minutes; per-minute phase means, entity counts, live heap every 5 min |
| Headless B | Identical rerun with CPU profile slices every 5 simulated minutes; checkpoints at 45 and 60 min | Deterministic: entity counts identical to A at every minute |
| Client bench | `PublicationClientBench.ts` on 300 real wire publications replayed from the 45-minute checkpoint | Late-game decode/apply/clone cost |

**Caveats**

- **Windows thread CPU under-reports.** The server's `wallPerCpu` "contended" flag (about 4) is an artifact
  of Windows per-thread CPU accounting. An A/B showed the profiler did not slow ticks, and the flag reads
  2.5–3.6 even with no profiler. Trust the wall-clock phase timings, not thread CPU, on this host.
- **Absolute numbers are noisy.** Identical deterministic runs differed by up to ~1.7× in wall ms per tick
  because of background load from other sessions. The relative shares and the deterministic counts are
  solid; treat absolute ms as ±30%.
- **Client rendering beyond minute 4 is unmeasured.** The browser pane was hidden after about 4 minutes,
  which pauses `requestAnimationFrame`. The late-game client numbers below come from the headless bench and
  exclude WebGL rendering.

## Results

### Live server, run 2 (per-tick means in ms; budget 125 ms)

| Wall min | Pace | Live heap | Tick | p95 | Max | Routing | Movement | Combat | Economy | AI | Capture | Snapshot + extraction |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 0.988 | 123 MB | 71 | 118 | 157 | 15 | 25 | 8 | 6 | 6 | 8 | 7 |
| 15 | 0.995 | 162 MB | 89 | 141 | 197 | 25 | 20 | 15 | 8 | 12 | 6 | 9 |
| 30 | 0.985 | 185 MB | 66 | 98 | 144 | 15 | 10 | 15 | 9 | 11 | 2 | 11 |
| 45 | 0.968 | 205 MB | 148 | 198 | 277 | 31 | 27 | 41 | 17 | 21 | 4 | 19 |
| 57 | 0.959 | 216 MB | 109 | 157 | 273 | 23 | 18 | 28 | 13 | 18 | 2 | 13 |

### Headless late game (simulated minutes 51–60, unprofiled)

- **Entities at minute 60:** 1,460 squads, 2,672 buildings, 1,662 traders.
- **Tick:** 139 ms against the 125 ms budget. Combat 42 ms, movement 30, routing 23, AI 19, economy 15,
  capture 4, transport and ships 5, publication capture 4.
- **Combat scales super-linearly.** From minute 5 to 60, squads grew 3.6× while combat time grew about 7×,
  which suggests pairwise work. The root cause is not yet pinned down; see C1.

### Late-game CPU distribution (Headless B, minutes 45–60, % of busy simulation-thread time, inclusive)

| Area | Share | Main contributors |
|---|---:|---|
| Routing (`drainRouteBatch`) | 15.9% | `RoutePlanner.step` 10.9, `stepCorridor` 2.9, `HierarchicalPaths.step` 2.9, `PlanningWorkspace` 2.1 |
| `Expansion.afterMovement` | 14.3% | `Trade.step` 9.4 (`begin` 5.6, of which 4.3 is self), `Supply.step` 2.3 |
| `thinkAi` | 12.0% | `AiEconomicDirector` 3.3, `thinkProgression` 2.5, `HomeTerritory.frontier`/`goal` 3.1, `AiOperations` 1.5 |
| `Expansion.beforeStep` | 9.5% | |
| Combat (`fight`) | 9.1% | `Battle.rebuild` 2.9 (ground grid), `advanceProjectiles` 2.4, `resolveLandDamage` 2.4, `CombatGeometry.envelope` 2.2 |
| Local avoidance | 6.3% | |
| Phase spatial views (ground grid rebuilds) | ~2.8% | `SpatialGrid.rebuild`/`insert` |
| `hostile()` diplomacy checks | ~2.5% self | `Simulation.ts:2229`, `Diplomacy.ts:173` |
| Runtime TypeScript overhead | ~2.3% | `__name` (tsx `keepNames`) 1.3, `set filename` 1.1 |
| Garbage collection | 2.4% | |

The coordinator's main thread was under 1% busy. All server cost is in the match worker.

### Memory

- **Live heap** rose 97 → 219 MB over 60 minutes, about 2 MB per minute, tracking building and trader counts.
  Headless A matched within a few MB. `heapUsed` between GCs peaked at about 276 MB; `heapTotal` reached
  432 MB. That is normal because it includes new-space and code-space, which do not count toward the
  384 MB old-space cap.
- **The 90-minute time limit is not proven safe.** Extrapolating at 2 MB per minute gives about 280 MB live
  at 90 minutes, plus 130–160 MB of between-GC garbage, which is near the cap. 90 minutes was not measured.
- **Nothing grows without bound.** Two code sweeps checked journals, planners, AI memories and replication.
  Three formation/combat caches do keep geometry for up to 2,048 *dead* squads each, an estimated 10–60 MB:
  `FormationContact.ts:497` `approachShapes`, `:297` `physicalBodies`, and `CombatGeometry.ts:29`
  `envelopeHistory`.
- **The worker's typed arrays are separate.** About 270 MB of map, path and drainage data lives off-heap and
  does not count toward the cap.

### Publication and client

- **Encoder-thread CPU is only 13–20 ms per publication** (pack, JSON, compression, hash). The reported
  `encoding` time of 95–147 ms late in the match is mostly waiting for the simulation thread's event loop
  to free up between ticks, so publication latency tracks tick length. The 2-slot queue sat full late
  in the match.
- **Late-game client cost per publication (4 per second):**
  - decode 6.7 ms, apply 5.8 ms, worker-side clone 6.0 ms;
  - main-thread clone receive 9.9 ms, for a clone of about 1.5 MB;
  - about 176 KB/s gzipped on the wire per client; `details` rows are about 38 of the 44 KB per publication.
- **The bench's own decision rule selects the `lazy-row-view` path** (the packed path costs 65 ms on the main
  thread).
- **Early-game foreground client** (first 4 minutes): frame 4 ms, frame interval 27–32 ms, HUD 2.4 ms, JS heap
  186 → 239 MB.

## Operational defects

1. **An intentional end is logged as a crash.** When `end()` runs while an advance is in flight,
   `endAfterFailure` (`LiveMatch.ts:898`) logs `Match stopped Error: Match executor stopped` before `end()`
   returns early. This made run 1 look like an out-of-memory crash.
   - **Fix:** in `endAfterFailure`, `if (this.stopped) return;` before logging.
   - **Fix:** add one structured `{event:"match-ended", matchId, reason, tick}` line in `end()`
     (`LiveMatch.ts:900`).
2. **Worker failure causes are lost.** `ReservedMatchWorker.ts:106-108` stores neither the error `code`
   (for example `ERR_WORKER_OUT_OF_MEMORY`) nor its message. `SnapshotEncodingWorker.ts:35-36` has the same
   gap.
   - **Fix:** store and log both.
   - **Fix:** add a near-limit warning when the used heap after GC passes 85% of `heap_size_limit`.

## Optimization plan

**Parity rule for every item:** identical simulation results, wire output and checkpoint hashes, with no
gameplay rule changes and no reduction of useful work (no budget cuts, no skipped AI decisions). The
rejected routing reservation experiment (`late-game-performance-results-20261013.md`) is not re-proposed.

### Phase 0: measurement and parity harness (do first)

- **Fixtures:** use `out/profile-1h-20261018/checkpoint-sim45.v8` and `checkpoint-sim60.v8` as late-game
  fixtures (Migration 1000, seed 1606492585, 1,460 squads at 60 min). Each holds
  `{seed, settings, options, checkpoint}`; `late-pubs-dump.mts` shows how to restore one.
- **A/B runner:** a script that restores a fixture into a control tree and a candidate tree, steps
  400 ticks after 200 warm-up ticks, and compares per tick:
  - canonical checkpoint hash at the end;
  - encoded publication bytes at every publication;
  - phase means.

  It is modelled on `scripts/profileLateGamePair.ts`, and every item below must pass it.
- **Validation:** run the full skirmish suite per phase, with MigrationMap and BlackForestMap isolated
  because of their timeouts.

### Phase 1: low-risk local fixes (estimated 8–12% of late-game busy time)

| # | Change | Where | Est. share | Parity argument |
|---|---|---|---:|---|
| Q1 | Replace the `{...squad,...from}` per-edge spread with one reused probe of x, y, playerId, aiWithdrawal | `Simulation.ts:4432`, narrow `movementPolicyClear` | ~1.5% | That function reads only those four fields |
| Q2 | Run `RuntimeDiagnostics.snapshot` on Float64Array `slice().sort()`, and only every Nth publication; make `residency` totals incremental | `RuntimeDiagnostics.ts:114-119`, `serverMatchWorker.ts:171,388`, `Pathfinding.ts:61`, `HierarchicalPaths.ts:180` | ~1.5% | Diagnostics only, not simulation state |
| Q3 | Precompile server and workers with esbuild (no `keepNames`) and run them on plain node | `start:multiplayer`, `Dockerfile.multiplayer`, `ReservedMatchWorker.ts` / `SnapshotEncodingWorker.ts` `execArgv` | ~2% (`__name`, `set filename`) plus faster worker spawn | First grep for `.name` / `constructor.name` reliance |
| Q4 | Break the AI footprint scan on the first denial instead of finishing the radius | `Simulation.ts:745-758` | 0.5–1% | No side effects after denial |
| Q5 | Move `performTick` allocations out of the loop: hoisted constant arrays, in-place `revision`, numeric `hasNavigation(id)` instead of `` `navigation:${id}` ``, reused scratch arrays, no per-ship `before` objects | `Simulation.ts:3726-3894`, `2475-2508`, the 16 `navigation:` sites | 1–2% | Pure allocation removal |
| Q6 | Look up `formationDoctrine` once per squad; skip the third `syncFormationCounts` pass when its write counter is unchanged | `Simulation.ts:2444`, `:3782/:4959/:3967` | 0.5–1% | Same inputs, same writes |
| Q7 | Skip `resolveLandDamage` only when it is provably a no-op (no damage dealt, `floor(wounds/hp)==0`, live troops or hull) | `Simulation.ts:4942` | ~1% | The guard covers wound-only losses |
| Q8 | Replace warship repair/dock `buildings.find`/`filter` with id and type indexes in the same order | `Simulation.ts:3279,3325,3511,3566` | 0.5–1% | Verify the iteration order matches |
| Q9 | Smaller items: `siteSnapshot` dedupe with a first-seen Set; cheapest-first predicate order in `homeNeedsLand`; `LandingOccupancy` key as two fields; `IncrementalSpatialGrid` max-extent tracked on growth | `Trade.ts:1036`, `Simulation.ts:5321`, `LandingOccupancy.ts:21`, `SpatialGrid.ts:315` | ~1.5% | Pure functions or identical values |

### Phase 2: cache and index fixes for the parts that grow with match age (estimated 10–14%)

| # | Change | Where | Est. share | Parity argument and risk |
|---|---|---|---:|---|
| S1 | **Trade indexes.** id→index map for actor lookups (`validRoute`, `stepPlanning`); per-(player, naval, origin) loading-admission counts instead of the O(actors × admissions) scan in `begin`; per-tick player map for `allowedMarket` | `Trade.ts:453,479,628,663-665,728,757` | 4–6% late (the fastest-growing cost) | Ids are unique, so results are identical. Medium-low risk: every admission set/delete must update the counts |
| S2 | **Research-only revision.** `Progression.revision` bumps every tick while any job runs, so "cached" trade effects are recomputed each tick. Add `researchRevision`, bumped only when `completed` changes; key `cargoEffects`, `goodsCapacity`, `landTraderTier`, `vesselEffects` and `AiTradeCapacity` on it | `Progression.ts:212-216`, `Trade.ts:906`, `Supply.ts:156`, `ResearchEffects.ts:28,83`, `AiTradeCapacity.ts:149` | ~2–3% | These are pure functions of `completed`. Low risk; also restore mid-research |
| S3 | **`hostile()` lookup table.** Numeric pair compare instead of template strings, plus a `Uint8Array(P×P)` memo keyed on diplomacy revision, tick and the array identity/length of alliances, wars, embargoes and peace protection | `Diplomacy.ts:123,172-176`, `Simulation.ts:2229` | 2–4% (innermost avoidance and combat loops) | Property test, memo vs. direct, over random diplomacy sequences |
| S4 | **Borrowed-trader publication on the server.** Call `replicationSource(true)` as the local worker already does, so unchanged traders are skipped by revision instead of deep-compared | `serverMatchWorker.ts:133,142,302` | 2–3% | Byte-identical packets at every publication, baseline and join barrier. Requires every detail mutation to call `tradeDetailsChanged` |
| S5 | **Trade shortlist key.** Key on a revision covering only war, embargo and block inputs instead of the global `diplomacy.revision`, which thefts and offers bump | `Trade.ts:475` | 0.5–1% | Medium risk; an assertion mode rebuilds and compares |
| S6 | **Dead-squad cache eviction.** Delete `approachShapes`, `physicalBodies` and `envelopeHistory` entries in the `entityRemoved` hook | `FormationContact.ts:297,497`, `CombatGeometry.ts:29` | Memory: 10–60 MB | Cache-only, but eviction can change hit/miss, so verify hashes (geometry is recomputed identically) |

### C1 findings (19 October 2026): no pairwise algorithmic bug; C2 deprioritized

Measured on `checkpoint-sim60.v8` after Phases 0–2, with a 0.5 ms CPU profile over 300 ticks plus
per-tick counters, using `out/parity/combat-profile.mts`, `combat-counts.mts` and `subtree.mjs`.

**The "combat" phase is not only combat.** The span `diagnosticPhase("combat")` measures in
`performTick` (`Simulation.ts:3956-3979`) also runs `Expansion.afterMovement` (trade and supply),
`advanceFormationStates`, `replenish` and `syncFormationCounts`. Its 60-minute breakdown:

| Part | Share of phase |
|---|---:|
| `Battle.fight` | 38% |
| `afterMovement` | 36% (of which `Trade.step` 26%) |
| `advanceFormationStates` | 11% |
| `resolveLandDamage` | 6% |
| `fightShips` | 6% |
| `syncFormationCounts` | 5% |

**The growth is engagement density, not O(n²).** From 45 to 60 minutes squads grew 1.4× (1,044 →
1,470), while acquisition searches grew 5.7× (19 → 109 per tick) and hybrid ranged contacts 2.8×.
Spatial queries return about 0.2 candidates each. The work per engaged squad is flat; more squads are
engaged.

**`Battle.fight` has no single hotspot.**

| Part of `Battle.fight` | Share |
|---|---:|
| Per-squad loop (about 1.3 µs per squad) | 26% self |
| Ground-grid rebuilds | 22% |
| `resolveLandDamage` | 9% |
| `updateSquad` | 6% |

`Battle.definition()` is cheap: `unitEffects` is an identity function.

**Three micro-fixes were tried and reverted.** A `permissionSignature` memo, hoisted keys in
`Trade.candidates`, and skipping the dead-squad roster copy all kept parity, but saved +0.5% and −1.0%
(noise). They were not kept.

**C2 is not worth its risk yet.** All `PhaseSpatialViews` rebuilds across the tick total **2.8%**, over
half of it the per-squad extent callback. A fully incremental ground grid caps out near 2.8%, with real
invariant risk.

**Revised order:** routing inner loops (C4; routing is about 16% inclusive late), AI (about 12%,
including `HomeTerritory.frontier` and `AiEconomicDirector`), then the trade parts that remain in
`afterMovement` (S5 shortlist key, `Trade.step` self). Combat itself is mostly irreducible useful work
at this engagement density.

### C4 routing inner loops (19 October 2026, uncommitted)

**Where the time went (60 min).** Routing was 12.1% of the tick. Per tick the scheduler ran 152
selections over about 107 jobs, making 39,000 classification lookups (each job classified about 2.4
times per selection). `PathTopology.neighbors` ran 24,000 times.

**Changes:**

- **`PathTopology.neighbors`.** Direct row-major index arithmetic for diagonals on `GameMapImpl`, with
  each side's `blocked` result asked at most once per call. Other maps and non-integer tiles keep the
  original code.
- **`knownClear()`.** Lets `PlanningPath.step` skip re-asking `blocked` for cardinal sides the same call
  already proved clear. Every `blocked` predicate is a read or memo-only.
- **`stepCost()`.** `advanceLocal` computes the expanding tile's coordinates once instead of four
  div/mods per neighbour.
- **`RoutePlanner` selection.** Classifies each job once and reuses those facts for reservation and
  urgency tests.

**Evidence:**

- **New test.** `PathTopologyNeighbors.test.ts` checks identical output and order against the verbatim
  original, across land/water/amphibious, random terrain and blocked masks. It also checks each side is
  asked at most once and that `knownClear` never vouches for a blocked tile.

| Change, isolated (`checkpoint-sim60.v8`) | Routing | Whole tick | Parity |
|---|---:|---:|---|
| Scheduler | −3% | +1.8% | identical |
| Kernels (`neighbors`, `advanceLocal`) | −5% | +2.2% | identical |
| Kernels + `knownClear` | −10.5% | +4.5% | identical |
| All of C4 together | −8% | +1.5% | identical |

- **One version was rejected.** A first version allocated a closure per `neighbors` call and ran about
  5–9% slower. It was replaced with the closure-free loop before these measurements.
- **Full suite:** 3,270 passed. The one failure is `RussianAssetIntegration`, which also fails on clean
  HEAD.

### AI decision and trade (19 October 2026, uncommitted)

**Late-game profile (bundled, 60 min).** AI decision work is 16.3% of the tick: `thinkAi` 10.2%, plus
the economic, progression, tribe, air and naval directors inside `Expansion.beforeStep`. Trade is 7.8%.

**Kept (all parity-identical):**

| Change | Where | Isolated effect (bundled, 60-min fixture) |
|---|---|---|
| Frontier BFS via `neighbors4` (same N,S,W,E order), packed numeric distance sort (exact), `homeNeedsLand` stops at the first tile beyond the radius when the frontier was sorted from this base (non-checkpointed `sortedFrom`), decision-cadence check before `controllerOf`, `reserved` built with a loop | `HomeTerritory.ts`, `Simulation.ts` | AI phase −16%; tick +2.7% |
| `cohortDps` builds one slim `Defence` per enemy cohort (exactly the fields `damageAmount` reads) instead of a full definition spread per pair | `TacticalEstimate.ts` | AI phase −5%; tick within noise (kept: simple, exhaustively tested) |
| Interception queries the shared `ground` grid with `troops > 0` tested first (no second alive-only grid); `revision(owner)` computed once per `candidates()` call; naval couriers reject own and non-port markets before permission checks | `Trade.ts` | Trade phases −1.7 ms; tick +2.8% |
| `PairRelations.refresh` compares a numeric stamp tuple and rebuilds owner signatures only when the content changes | `PairRelations.ts` | Trade phase −0.8 ms; tick +1.0% |

**Combined on `checkpoint-sim60.v8` (bundled, 200 + 400 ticks): 5.5% faster per tick, parity identical.**
AI phase 10.65 → 8.67 ms; "combat" (with trade) 21.2 → 19.6 ms.

**Tests:**

- `AiEstimateEquivalence.test.ts` checks `frontier` (tiles, order, shores) against the verbatim original
  BFS/sort.
- The same file checks `cohortDps` against the original per-pair spread, with `Object.is`, over random
  pairings of every unit.
- Full suite: 3,272 passed. The one failure is `RussianAssetIntegration`, which also fails on HEAD.

**Not done (from the studies):**

| Item | Why not |
|---|---|
| Frontier clean-skip | Needs complete tile-owner invalidation |
| Combat-advantage memo across ticks | Medium risk |
| `aiTradeCapacity` source cache | Medium risk |
| Placement revision memo | Small; not attempted |
| Planner decorate-sort | Small; not attempted |
| Lazy `sleepKey` | Small; not attempted |
| `threatTroops` spatial query | Medium risk |
| `HomeTerritory.goal` failure-key change | Would alter a checkpointed key format |

**Harness fixes made along the way:**

- **False-positive divergences.** The digest no longer hashes `v8.serialize` bytes. V8 encodes the same
  number as a small integer or a heap double depending on JIT state, which made two identical trees
  "diverge" at tick 29,180. It now hashes a canonical walk with numbers compared by value.
- **`--bundled`.** Runs each tree as a production-style esbuild bundle, so measurements match how the
  server runs.
- **Divergence dumps.** The first divergence of each kind is saved as `.v8` files for diffing.

### Phase 3: combat and movement scaling (estimated 6–10%, plus investigation)

- **C1: find the root cause of super-linear combat scaling.** Instrument per tick:
  - acquisition candidates evaluated and target pairs;
  - projectile count and envelope calls.

  Use the 45→60-minute fixture. Fix what the counts reveal: wider-than-needed queries, repeated
  per-candidate filters, or projectile lists scanned per target.
- **C2: incremental ground grid.** Turn the phase "ground" view into an `IncrementalSpatialGrid` fed by the
  same dirty-squad hook as `movementPoseChanges`, rebuilding fully when membership changes. Cache the facts
  object per (tick, revisions). Location: `PhaseSpatialViews.ts:65-157`, Battle `rebuild`. Estimated
  share 2.5–4%. Parity rests on the existing I-3 "update equals rebuild" guarantee; assert that squads are
  id-ascending.
- **C3: combat per-candidate filters.** Memoize the tag match for `profile.targets` against `targetTags`,
  and cache `permissionSignature` per owner per tick. Location: `Battle.ts:912-955`. Estimated share
  0.5–1%.
- **C4: routing inner loops.**
  - `PathTopology.neighbors`: indexed offsets, direct `passable[]` reads, each cardinal's blocked result
    computed at most once.
  - `PlanningPath.step`: skip the second `blocked` check using a known-clear mask.
  - `advanceLocal`: fixed offset table with the same enqueue order.
  - `RoutePlanner`: read `classificationRevision` once per pass, a constant caller table, and memoized
    `partitionRefuses` counts.

  Locations: `PathTopology.ts:71-104`, `PlanningWorkspace.ts:274`, `HierarchicalPaths.ts:743-770`,
  `RoutePlanner.ts:392-549`. Estimated share 3–5%. For parity, compare old and new neighbour output and
  order for every tile and mask, compare cluster trees byte-for-byte, and run a side-by-side scan
  assertion for the memoized counts.
- **C5: `geometryKey`/`formationEnvelope` hit path.** Only after freezing formation containers in test mode
  proves nothing mutates them in place. Location: `FormationGeometry.ts:124-314`. Estimated share 1–1.5%.

### Phase 4: client and wire

- **W1:** adopt the lazy row view the bench selected, so the main thread does not structured-clone about
  1.5 MB per publication (about 40 ms/s of main-thread time late in a match).
- **W2:** gate expensive `Expansion.snapshot()` sections on the metadata revisions the codec already checks,
  instead of rebuilding them on every capture. Keep the output identical, proven by packet equality on
  every path.
- **W3:** investigate the `details` share of the wire (38 of 44 KB per publication) for unchanged-row
  suppression. Bandwidth per client is about 176 KB/s gzipped.
- **W4:** measure late-game rendering with the browser pane in the foreground. This profile could not.

### Phase 5: memory qualification

- **M1:** run to the 90-minute limit with `SKIRMISH_LIVE_HEAP=1` on Migration 1000 at 3× speed, from
  `checkpoint-sim60.v8` for speed. If live heap exceeds about 250 MB, raise `maxOldGenerationSizeMb` to
  512 and size containers for capacity × (512 + 256) MB.
- **M2:** apply S6, then re-measure.

## Expected outcome and order

**Order:** Phase 0 → operational defects (zero parity risk) → Phase 1 → S1/S2/S3/S4 → C1 investigation →
C2/C4 → client W1 → M1.

**Target:** the late-game tick back under budget with headroom, from about 139 ms to about 95–105 ms by the
sum of the estimates. Accept each item only on measured savings in the fixture A/B.
The combat root cause (C1) is the largest unknown and the most likely place to recover more.

## Files

| File | What it is |
|---|---|
| `server.log`, `server-run2.log` | Live coordinator and worker diagnostics (30 s cadence) |
| `server-run2-timeline.json` | Parsed per-30 s phase, pace and heap timeline |
| `cpu/` | Run 1 sliced CPU profiles (`.cpuprofile`, open in Chrome DevTools) |
| `cpu-headless2/` | Late-game profiles every 5 simulated minutes |
| `mapped-serverMatchWorker.json`, `mapped-sim.json` | Source-mapped self and inclusive rankings |
| `headless.jsonl`, `headless2.jsonl` | Per-minute phase means, entity counts and heap |
| `checkpoint-sim45.v8`, `checkpoint-sim60.v8` | Late-game parity fixtures |
| `client-bench-late45.json` | Client decode/apply/clone bench |
| `profile-server.mjs`, `profiler-preload.mjs` | Sliced per-thread profiler wrapper; no source edits needed |
| `analyze-cpu.mjs`, `map-columns.mjs`, `analyze-log.mjs` | Analysis scripts. `map-columns` re-runs tsx's esbuild transform to map profile columns to TypeScript lines |
| `late-game-headless*.mts`, `late-pubs-dump.mts`, `overhead-ab.mts` | Headless harnesses |

`.claude/launch.json` gained `multiplayer-profile`, `multiplayer-heap` and `skirmish-online-profile`
configurations, which use port 9012 because another server was already running on 9011.
