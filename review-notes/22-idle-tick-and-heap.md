# 22 — The idle 52-faction tick, and the worker heap with 8 human seats (round 3)

**Code under test.** HEAD `0d1783ce` ("pre-ultra", 2026-10-16 05:23) plus the uncommitted ranged-preparation delta, as it stood at 06:15. I copied the tree to the scratchpad (`idle-tick/snap`). `diff -rq` against the live `src/` was empty at 06:15 and again at the end of the review. All line numbers below are current working-tree lines, checked with `grep -n` / `sed -n`.

**Probes and data.** Everything is in `C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/idle-tick/`. The JSON outputs are in `out/`.

**Labels.**
- **CONFIRMED**: measured, with the mechanism read in code.
- **SUSPECT**: mechanism read, magnitude not measured.
- **BOUNDED**: the saving cannot exceed the function's measured share of the CPU profile.

## Scope read

| Source | What |
| --- | --- |
| review-notes 06 | "Measured" probe table, phase table, Issues 1–14 |
| review-notes 16 | "Harness and method", "Measured results", "Comparison", Issue 4. I also read 16's own output JSON in `scratchpad/load-test/`. |
| review-notes 19 | §B and §E (memory), I2 (reorientation retries), I4 (heap trend) |
| 08-latent-bugs | Refuted table (row "Movement work is O(all land squads)"), P11, P19, P20, P21, P36 |
| 08e-round2-ledger | R2-P5, R2-P6, R2-P10, R2-P11, R2-P19, R2-P21, R2-P31 |
| `src/skirmish/Simulation.ts` | 203–262 (`onPhase`, `setAiController`, checkpoint/restore), 377–386 (squad entity hooks), 480–494 (`movementLand`), 993–1012 (spatial grids), 1990–2140 (certification, `transportProposal`, `landingNeighbors`, `transportStepClear`, `emptyMovementSweep`, `formationMoveClear`), 2237–2296 (`advanceFormationStates`), 2365–2412 (`spawnSquad`), 3393–3691 (`step`/`performTick`, every phase), 3576–3590 (avoidance clearance callback), 3980–3985 (`holding`), 4590–4640 (`resolveLandDamage`), 4903–5240 (`thinkAi`, tribe marches) |
| `src/skirmish/LocalAvoidance.ts` | 145–330 (`step`, the `allowed` closure, steering) |
| `src/skirmish/domain/CombatGeometry.ts` | whole (envelope / pose caches) |
| `src/skirmish/domain/FormationGeometry.ts` | 121–160 (`geometryKey`, `physicalGeometryKey`), 311–322 (`formationEnvelope`) |
| `src/skirmish/SpatialGrid.ts` | 1–80 (`rebuild`, `insert` with the extent callback) |
| `src/skirmish/LandingOccupancy.ts` | whole |
| `src/skirmish/HomeTerritory.ts` | 105–135 (`goal`) |
| `src/skirmish/domain/Battle.ts` | 650–760 (`fight` head) |
| `src/skirmish/RoutePlanner.ts` | 368–430 (`selectJob`, `nextJob`) |
| `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts` | whole (`maxOldGenerationSizeMb: 384` at :22) |
| `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` | 84–108 (diagnostics memory) |

## How it works today (measured)

### Method

- **Setup.** This is 16's exact setup, rebuilt in `common.mts`: `loadServerMap(defaultLobbySettings(map,500))`, seed 1272661902, `DEFAULT_AI_POLICIES`, raids-v1, corridors-v1, `FORMATION_MOVEMENT`, ages-v1, Napoleonic start, and 8 seats + 14 AI + 30 tribes.
- **Warm-up.** Each map was warmed for 1,200 ticks with all 52 factions AI-driven, and checkpointed (`warm.mts` → `out/ckpt-{mig,med}-1200.bin`).
- **Configurations.** Every configuration forks from the same checkpoint:
  - (a) `ai`: all 52 AI.
  - (b) `idle`: 16's `injectArmies` (60 squads per seat, every third owned tile), then all 8 seats switched to human control with no commands.
  - `idle0`: seats idle, nothing injected.
  - `hold`: (b) plus an explicit `hold` order on every injected squad.
  - `holdface`: `hold` with `facing: 90`.
  - `march`: injected squads in groups of 10, ordered every 30 s between their spawn tile and an owned tile 18–30 tiles away.
  - `idle:60:12`: (b) with injected squads spread 12 tiles apart.
  - `idle:180:3`: 1,440 injected squads.
- **Four kinds of run:**
  1. **Solo quiet runs** (`fork.mts`). These run in a real worker with `resourceLimits.maxOldGenerationSizeMb: 384`, as in `ReservedMatchWorker.ts:22`, with no other load of mine. A CPU-load log (`out/load-samples.txt`) shows 2–32 %, with no vitest running. Each run is 4,800 ticks (10 simulated minutes, ticks 1,200–6,000). They record `onPhase` per 400-tick window, thread CPU, `heapUsed`/`heapTotal`, the sampled peak, the live heap after a forced full GC at each window end, and GC events. They also capture snapshots at 5 Hz with `SnapshotEncoder`, as the worker does, so the encoder's retained state is in the heap.
  2. **Paired, interleaved runs** (`pair.mts`, `ab.mts`). Up to seven variants, or several patched source roots, are restored from the same checkpoint and stepped round-robin in one process. Host contention therefore hits every variant alike. I report thread CPU and an order-independent squad hash (equal hash = identical behaviour). Each run includes an A/A control (the same root twice). The A/A spread was 0.2–2.0 ms CPU and 2.0–6 ms wall per window. Caveat: the Windows thread-CPU clock ticks in 15.6 ms steps, so per-tick CPU values are quantised. Means over 400 ticks are fine.
  3. **CPU profiles** (`--cpu-prof`, 0.5 ms sampling, no wrappers) of (b), ticks 1,200–2,000. Analysed with `profsum.mjs` and `proftree.mjs`.
  4. **Mover census** (`movers.mts`). Classifies every squad that changed position in a tick by faction kind, order, displacement and shape.

### 1. The 06 vs 16 conflict is mostly a measurement artefact (CONFIRMED)

**16's own JSON.** `scratchpad/load-test/out-*.json` stores both wall and thread-CPU tick means. Wall/CPU was about 2 in every run:

| 16 run | tick wall mean | tick CPU mean | wall/CPU | per-window wall/CPU |
| --- | ---: | ---: | ---: | --- |
| Mig idle | 153.8 | 77.97 | **1.97** | 1.50–2.46 |
| Med idle | 153.9 | 78.46 | **1.96** | 1.40–2.61 |
| Mig active humans | 206.1 | 114.3 | 1.80 | 1.35–2.55 |
| Med active humans | 198.0 | 109.6 | 1.81 | 1.31–2.54 |

**Replaying the same state.** I re-ran 16's own harness (`inproc16.mts`, 16's frozen code `snap16`, Mig idle, 1,200 + 800 ticks) on a quiet machine. The state was bit-identical: at tick 1,600, S = 1,195, B = 276 and traders = 394 in both runs.

| Mig idle, window ending tick 1,600 | tick wall mean | tick CPU mean | movement | combat | routing | ai | capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 as published | **185.9** | 90.3 | 78.7 | 36.0 | 24.1 | 19.9 | 11.6 |
| Same harness, same code, quiet (mine) | **75.1** | 54.8 | n/a | n/a | n/a | n/a | n/a |
| Current code, `fork.mts`, solo quiet, capped | **70.0** | 53.6 | 26.2 | 12.7 | 11.3 | 7.4 | 5.1 |

Every one of 16's phases is about 2–2.5× mine, uniformly. That is the signature of the thread being descheduled (oversubscription), not of a per-squad cost.

The next window of my "solo" replay landed when other agents started full vitest suites. It read 211 ms wall against 108 ms CPU, which reproduces the effect on demand.

**Reconciliation:**

| Quantity | Value |
| --- | --- |
| 06, all-AI | 82–113 ms at S ≈ 1,000–1,150. My quiet all-AI run (a) reads 59–90 ms in the same tick range, on today's code. |
| 16, idle, as published | 154 ms. About 78 ms of CPU, and about 100 ms of quiet wall. |
| Quiet (b), 10 minutes, this tree | **82.9 ms** |

The real (a)→(b) difference is **+15.1 ms (+22 %)**, not +40–70 ms. About two thirds of it is the idle-army floor (§4) and about one third is wars that AIs start against the passive human seats (§2).

### 2. Per-phase cost of the idle 52-faction tick

These are quiet solo runs on Migration 500, desktop wall ms, in a capped worker, over ticks 1,200–6,000 (10 simulated minutes).

| Phase | (a) all AI | (b) 8 idle humans + 480 squads | (b) − (a) | share of (b) |
| --- | ---: | ---: | ---: | ---: |
| movement | 23.29 | 27.04 | +3.76 | 32.6 % |
| combat | 14.65 | 19.54 | +4.88 | 23.6 % |
| routing | 14.31 | 14.91 | +0.59 | 18.0 % |
| ai | 7.06 | 9.67 | +2.61 | 11.7 % |
| economy | 3.16 | 4.72 | +1.55 | 5.7 % |
| capture | 3.13 | 3.42 | +0.29 | 4.1 % |
| ships | 0.66 | 1.57 | +0.91 | 1.9 % |
| transport | 1.07 | 1.47 | +0.40 | 1.8 % |
| setup + cleanup | 0.49 | 0.57 | +0.08 | 0.7 % |
| **tick mean / p50 / p95 / p99 / max** | **67.8 / 65.0 / 100.2 / 125.1 / 209** | **82.9 / 80.4 / 115.6 / 147.1 / 230** | +15.1 | |
| thread CPU per tick | 51.1 | 64.6 | +13.5 | |
| squads (range) | 532–1,024 | 1,001–1,488 | +≈485 | |
| ARM estimate (×2.4, EXTRAPOLATED) | 163 mean / 300 p99 | **199 mean / 353 p99** | | |

Window series for (b):

| tick | S | alive | B | tick mean | p99 | movement | combat | routing | ai |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,600 | 1,195 | 52 | 275 | 70.0 | 109 | 26.2 | 12.7 | 11.3 | 7.4 |
| 2,000 | 1,325 | 51 | 324 | 85.8 | 131 | 35.5 | 17.4 | 9.2 | 10.5 |
| 2,400 | 1,423 | 50 | 363 | 88.4 | 133 | 36.0 | 18.2 | 9.1 | 13.2 |
| 2,800 | 1,488 | 50 | 402 | 94.8 | 189 | 34.1 | 18.8 | 16.5 | 13.1 |
| 3,200 | 1,445 | 47 | 441 | 98.7 | 150 | 33.6 | 21.6 | 18.3 | 12.2 |
| 3,600 | 1,315 | 44 | 472 | 97.9 | 155 | 31.9 | 23.2 | 18.0 | 11.9 |
| 4,000 | 1,277 | 41 | 497 | 80.7 | 135 | 22.8 | 19.8 | 16.3 | 9.9 |
| 4,800 | 1,195 | 38 | 563 | 82.5 | 146 | 24.1 | 23.1 | 15.4 | 8.7 |
| 6,000 | 1,001 | 32 | 626 | 70.5 | 110 | 17.6 | 19.1 | 17.0 | 6.5 |

**Per-cause attribution of (b) − (a).** The paired long run (`pair-mig-ai_idle-4800.json`, CPU) gives +11.0 ms CPU (54.5 → 65.5). The per-phase CPU deltas are movement +3.4, combat +3.1, ai +1.9, economy +1.2, ships +0.7, transport +0.4, capture +0.2 and routing +0.1. They split as follows:

- **Idle-army floor.** 480 stationary squads × 16–18 µs CPU (§4) ≈ 7.7–8.6 ms CPU, about 10–11 ms quiet wall. This accounts for all of the movement delta and most of the combat delta.
- **Wars the humans are in.** Under raids-v1 the AIs declare war on the passive seats: 11 human wars and 13 AI war pairs one window after the switch, against 0 in (a), rising to 33 pairs against 18–24. This is the remaining ≈ 3–4 ms: the combat delta beyond the floor, plus ai +1.1–1.5, economy about +1 and ships +0.7.
- **Routing.** About 0 (+0.1 CPU, +0.6 wall). Idle seats issue no orders.
- **Mediterranean** (paired, ticks 1,200–2,000) shows the same shape. (b) − (a) is +13.0 and +11.6 ms CPU (+29 % / +21 %). Of that, idle0 − ai is +6.0 / +3.9 (seats idle, wars) and idle − idle0 is +6.9 / +7.7 (480 squads, 14–16 µs per squad).

### 3. Who moves in an idle tick: the 30 tribes (CONFIRMED)

From `movers.mts` (400 ticks each). "Tribe" is the 30 tribe factions; "regular" is the 8 seats plus the 14 AI nations.

| | Mig, ticks 1,200–1,600 | Med, ticks 1,200–1,600 | Mig, ticks 3,600–4,000 |
| --- | ---: | ---: | ---: |
| squads (land) per tick | 1,130 | 1,118 | 1,279 |
| squads that moved per tick | 365 | 461 | 178 |
| of which tribe squads | **342 (94 %)** | **431 (93 %)** | **139 (78 %)** |
| tribe squads moving / tribe squads | 342 / 576 (59 %) | 431 / 576 (75 %) | 139 / 537 (26 %) |
| regular-faction movers | 23 | 30 | 39 |
| movers with order `move` / `attack` / `hold` | 357 / 0 / 8 | 450 / 1 / 11 | 119 / 56 / 4 |
| movers at full step (≥ 32 units) | 257 | 364 | 132 |
| move-run length p50 / p90 (ticks) | 27 / 82 | 27 / 81 | 6 / 85 |

**What the tribes are doing.** Idle tribe squads hold. On their decision tick (`decisionInterval` = 0.75 s, `Simulation.ts:4904`) they are grouped into 16×16-tile "strategic expansion" marches (`Simulation.ts:5208–5212`). Each cohort of up to 16 squads is sent to a `HomeTerritory.goal` frontier tile (`Simulation.ts:5222–5229`, `HomeTerritory.ts:105–135`), walks there, captures, holds, and is sent again. This is the main territorial expansion loop, and it is what the movement, routing and capture phases mostly pay for in an idle match.

### 4. Measured per-squad cost: holding, idle and marching

Paired thread CPU, µs per squad per tick, Migration. Variants are matched at the same tick from the same checkpoint. Two 400-tick windows (ticks 1,200–1,600 and 1,600–2,000), shown as "w1 / w2". The 480-squad differences carry ±6–8 µs of A/A noise; the 1,440-squad leverage run carries ±2 µs. Quiet wall ≈ 1.3 × CPU (solo wall/CPU = 1.28–1.33).

| Squad state (how measured) | movement | combat | capture | routing | ai | economy | **all phases** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle as spawned (order `hold`): `idle:180:3` − `idle0`, ÷1,440 | 6.4 / 8.6 | 5.0 / 6.2 | 0.8 / 0.5 | 1.2 / −1.2 | 1.2 / 2.3 | 0.9 / 0.9 | **15.9 / 18.4** |
| Explicit `hold` (`hold` vs `idle`) | same as idle | same | same | same | same | same | same |
| `hold` with facing (`holdface` − `hold`) | no measurable difference: 52.39 vs 52.68 and 70.1 vs 68.8 ms tick CPU | | | | | | ≈ 0 extra |
| Spread 12 tiles apart (`idle:60:12` − `idle`) | no measurable difference | | | | | | ≈ 0 |
| Marching, per marching squad (`march` − `hold`, ÷480; 164 / 131 of 480 actually moving per tick) | 10.2 / 5.7 | 12.2 / 5.6 | −1.5 / −0.4 | 4.3 / −0.5 | 0.6 / −0.6 | 1.5 / 0 | **28 / 11** |
| ⇒ per moving squad-tick (scripted march) | | | | | | | **82 / 40** |
| Tribe expansion walking (A/B: tribes issue no marches, ≈342 fewer movers) | | | | | | | **51** per moving squad-tick (17.3 ms CPU / 342) |

**Notes on the table:**

- **Idle and hold are the same thing.** Spawned squads already carry `order: {type: "hold"}` (`Simulation.ts:2404`). Re-issuing `hold` produced the same squad hash and the same behaviour.
- **Holdface and spread** cost nothing measurable. On open ground the facing transition completes, so the R2-P10 retry loop does not fire.
- **Crowding is not a factor.** 16's "every third tile" packing costs the same as 12-tile spacing.
- **Wall cross-check.** High-resolution wall sub-timers in the same runs, per extra stationary squad (contended wall ≈ 2× CPU): avoidance 4.7, `Battle.fight` 8.5, `movementLand` (spatial rebuilds) 3.7, capture 2.7, `resolveLandDamage` 2.7, `syncFormationCounts` 2.0, `navigation` 1.4, `advanceNavigation` 1.2 µs.

**Against the refuted row** ("holding costs 2.5–4 ms at 1,000 squads, floor 3–9 µs per squad"):

- My **movement-only** floor, 6.4–8.6 µs CPU (about 8–11 µs quiet wall), is the same order and sits at the top of that range. It agrees with the refutation that movement-only sleeping is a small lever.
- The **all-phase** floor is about 2× larger (16–18 µs CPU, about 21–24 µs quiet wall), because combat (`Battle.fight` loop, `resolveLandDamage`, `syncFormationCounts`), the AI's grouping and the economy each walk every squad.
- In (b) there are about 850–1,050 stationary squads, so the all-phase floor is ≈ 18–24 ms of the 83 ms tick (22–29 %). A moving squad costs about 3–4× a stationary one (51–82 µs against 16–18 µs CPU).

This **partially contradicts** the refutation, explicitly: generic movement-only sleeping remains low value (≤ ≈ 10 %), but a combat + movement dormant-squad path is bounded at roughly half the all-phase floor, ≈ 10–12 % of the idle tick. It is listed as R5, not as a primary lever.

### 5. CPU profile of the idle tick

Profile of (b), ticks 1,200–2,000, no instrumentation wrappers. `performTick` is 87.6 % of all samples; the rest is map load, restore and snapshot capture. Shares below are of all samples.

| Inclusive | Function (call path) |
| ---: | --- |
| 21.9 % | `LocalAvoidance.step` (`LocalAvoidance.ts:145`). Of this, **11.8 %** is the clearance callback (`Simulation.ts:3576–3590`) → `transportStepClear` (10.6 %, `:2041`) → `formationMoveClear` (9.4 %, `:2117`) → `emptyMovementSweep` 4.9 % (`:2085`), `movementSweep` 1.8 %, `certifyFormationPolygon` 1.6 %. A further 4.0 % is the `apply` callback (`updateOwned`), including `LandingOccupancy.observe` 1.3 %. |
| 10.6 % | `drainRouteBatch`: `RoutePlanner.step` 8.3 % (`PlanningWorkspace.step` 2.5 %, corridor `HierarchicalPaths.step` 1.7 %, **`selectJob` 1.6 %**), `MovementAdmission.step` 0.8 %, trade planning 0.6 %, `RouteWork.drain` 0.5 % |
| 8.0 % | `Battle.fight`: its own spatial `rebuild` 2.1 %, `resolveLandDamage` 0.7 % (1.5 % in total across its callers) |
| 7.8 % | `CombatGeometry.envelope` (`CombatGeometry.ts:35`) summed over all callers: `formationEnvelope` 4.6 %, `geometryKey` / `physicalGeometryKey` 2.7 % / 2.1 % (string keys) |
| 7.3 % | `thinkAi` (mostly its own grouping and decision loops; `AiOperations.step` 1.3 %, `HomeTerritory.goal` 1.1 %) |
| 5.9 % | `SpatialGrid.rebuild` (`SpatialGrid.ts:34`). `insert` is 4.8 %, of which 1.8 % is the extent callback computing the envelope per squad per rebuild (`Simulation.ts:998`) |
| 5.4 % | `advanceFormationStates` (`:2237`): `emptyTransitionTerrain` 1.9 %, `reorientedFormation` 1.4 % (`minimumTravelAssignment` 1.9 % in total) |
| 4.1 % | `navigation` |
| 3.8 % | `Expansion.beforeStep` (AI economy director 1.7 %, progression 1.3 %) |
| 3.7 % | `capture` |
| 3.8 % | garbage collector (self) |
| 2.1 % | `LandingOccupancy.observe` in total (eager maintenance on every spatial change once any landing has been checked; `Simulation.ts:377–378`, `LandingOccupancy.ts:15`) |

### 6. Prototype A/B results

Scratch copies of the tree, never the repository. Run with `ab.mts` on Migration (b), ticks 1,200–2,000/2,400, with an A/A control. Wall ms per tick unless marked CPU.

| Prototype (scratch only) | Behaviour | Window 1,600 | Window 2,000 | Window 2,400 | Verdict |
| --- | --- | --- | --- | --- | --- |
| A/A (baseline twice) | identical hash | 84.1 vs 86.8 (CPU 49.4 vs 47.4) | 123.8 vs 126.6 | n/a | noise ±2–3 % |
| **P2** `resolveLandDamage` skips squads with `dealt === 0` (P21) | **identical hash** | 86.4 (CPU 48.3) | 123.7 (CPU 61.5) | n/a | ≤ A/A noise. Profile bound ≤ 1.5 %. |
| **P3** `LandingOccupancy` maintained lazily (dirty set flushed in `landingNeighbors`) | **identical hash** | 91.4 | 126.6 | n/a | no saving visible. Bound ≤ 2.1 %. |
| **P1** reorientation failure back-off, 8 ticks (R2-P10) | diverges | 88.8 | 129.3 | n/a | no saving visible in the idle tick. Bound ≤ 3.4 %. |
| **T**: tribes issue no expansion marches | diverges | **56.2** (−32.3, −36 %) | **71.4** (−25.2, −26 %) | **68.5** (−26.4, −28 %) | upper bound of the tribe lever |
| **T4**: at most 4 tribe squads on expansion marches at once | diverges | **72.0** (−16.5, −19 %) | **69.3** (−27.3, −28 %) | **73.4** (−21.4, −23 %) | |
| **T8**: at most 8 | diverges | 78.0 (−10.5, −12 %) | 81.4 (−15.2, −16 %) | 80.7 (−14.1, −15 %) | |

Baseline for T / T4 / T8: 88.5 / 96.6 / 94.9 ms.

Gameplay cost of the tribe caps (tribe-held land at the window end):

| | baseline | T4 | T8 | T (none) |
| --- | ---: | ---: | ---: | ---: |
| tick 1,600 | 35,025 | 31,621 (−10 %) | 32,550 (−7 %) | 29,922 (−15 %) |
| tick 2,000 | 42,159 | 33,591 (−20 %) | 34,229 (−19 %) | 28,209 (−33 %) |
| tick 2,400 | 43,122 | 35,545 (−18 %) | 36,133 (−16 %) | 27,612 (−36 %) |

Regular nations gained 1–2k tiles in exchange.

### 7. Heap with 8 human seats

Quiet solo runs in a worker with `maxOldGenerationSizeMb: 384` (the `ReservedMatchWorker.ts:22` setting), with 5 Hz snapshot capture.

| | (a) all AI, tick 1,600 → 6,000 | (b) 8 idle humans + 480 squads, tick 1,600 → 6,000 |
| --- | --- | --- |
| `heapUsed` at window end (pre-GC) | 152–262 MB | 142–280 MB |
| **Peak `heapUsed`** (sampled every 25 ticks) | 213 → 292 MB | 226 → **309 MB** |
| `heapTotal` | 313 → 446 MB | 326 → **448 MB** |
| **Live heap after a full GC** | 87 → 145 MB | 93 → **147 MB** |
| ArrayBuffers (off-heap) | 53–78 MB | 49–76 MB |
| Major GCs per 400 ticks / time | 6–9 / 147–482 ms (0.4–1.2 ms per tick) | 6–10 / 180–478 ms (0.45–1.2 ms per tick) |
| Minor GCs per 400 ticks / time | 180–298 / 461–855 ms (1.2–2.1 ms per tick) | 220–374 / 524–911 ms (1.3–2.3 ms per tick) |

**Reconciliation with earlier numbers:**
- 16's real-worker figure was "237 MB used / 419 MB total at tick 5,600". Mine at 5,600 is 262 used / 413 total in (a) and 280 / 436 in (b). They match within GC timing.
- 19's figure was "128–147 MB live". Mine is 141–147 MB live at 5,200–6,000. They match.
- **480 extra squads add only 1–9 MB of live heap.** The live heap follows buildings and traders (19 I4), not S.
- **Why `heapTotal` reads above 384 MB:** `heapTotal` includes new space and code space. The 384 MB cap applies to old space only.
- **The cap does not cost GC time.** In the uncapped run the first windows had fewer but larger major GCs: 2–5 / 237–506 ms, against 8–9 / 253–332 ms capped. Total major-GC time is about the same.

## Issues

### I1. Round 2's 8-human load-test tick times are inflated about 2× by host oversubscription, and its "stationary squads" attribution is wrong — HIGH (it drives the roadmap), CONFIRMED

- **Where:** review-notes/16 "Measured results" and "Comparison"; 08e R2-P31; and therefore 00-summary's capacity figures.
- **Mechanism:**
  - 16's own output stores tick wall 153.8 / 153.9 ms against thread CPU 78.0 / 78.5 ms (idle), and 206 / 198 against 114 / 110 (active). Its harness thread was off-CPU about half the time.
  - Replaying the bit-identical state (tick 1,600: S 1,195, B 276, traders 394) in 16's own harness, with 16's code, on a quiet host gives 75.1 ms against the published 185.9 ms. Every phase scales by the same factor.
- **Consequence:**
  - The idle 52-faction tick on today's tree is **82.9 ms mean / 115.6 p95 / 147 p99** on the desktop (≈ 199 / 353 ms on ARM, EXTRAPOLATED), not 154 ms.
  - The 8-human active figure (198–206 ms) is probably ≈ 110–150 ms quiet wall. That is SUSPECT: the active run was not replayed.
  - 16's sentence "the 480 stationary human squads pay the full per-squad cost" is wrong. They pay ≈ 16–18 µs CPU each, ≈ 10 ms of the tick (§4).
  - R2-P31's "≈ 0.25× on ARM" should read ≈ 0.4–0.5× for active humans and ≈ 0.63× for idle seats (EXTRAPOLATED, ×2.4).

### I2. Tribe expansion walking is the largest single cost of the idle tick — HIGH (perf/design), CONFIRMED

- **Where:** `Simulation.ts:5208–5212` (march grouping), `:5222–5229` (cohort orders to `HomeTerritory.goal`), `HomeTerritory.ts:105–135`, `:4904` (0.75 s decision interval).
- **Mechanism:**
  - Every holding tribe squad re-enters a 16-squad expansion march on its next decision tick, walks to a frontier tile, captures, and repeats.
  - In minutes 2.5–3.3, 342 of Migration's 365 movers per tick (431 of 461 on Mediterranean) are tribe squads: 59–75 % of all tribe squads walking at any moment. At minutes 7.5–8.3 it is still 139 of 178.
  - A moving squad costs 51–82 µs CPU per tick, against 16–18 µs for a stationary one, across avoidance clearance, routing, spatial rebuilds and capture refresh.
- **Consequence:** A/B, in the same process, from the same checkpoint:

  | Change | Saving on the idle tick | Tribe land |
  | --- | --- | --- |
  | Remove tribe marches | 25–32 ms wall (26–36 %) | n/a |
  | Cap at 4 concurrent marchers per tribe | 16.5–27.3 ms (19–28 %) | −10 % to −20 % |
  | Cap at 8 | 10.5–15.2 ms (12–16 %) | n/a |

  No other single change in this review is worth more than about 10 %.

### I3. The idle-army floor is about 2× the refuted movement-only floor once every phase is counted — MEDIUM, CONFIRMED

- **Where:** per-squad walks in `performTick` (`Simulation.ts:3476–3640`), `Battle.fight` (`Battle.ts:651`, `:668–670`, which filters and sorts all squads every tick), `resolveLandDamage` (`Simulation.ts:4594`, `:4636–4641`), `syncFormationCounts` (`:2187`, called at `:3481`, `:3663` and again inside `resolveLandDamage` at `:4636`), and the `thinkAi` grouping (`:4905–4911`).
- **Measured:** stationary squad, quiet ≈ 21–24 µs wall per tick:
  - movement 6.4–8.6 µs CPU, which agrees with the refutation;
  - combat 5.0–6.2;
  - ai + economy 2.1–3.2;
  - capture 0.5–0.8.
- **Consequence:**
  - With about 1,000 stationary squads, the floor is about 22–29 % of the idle tick.
  - Movement-only sleeping stays low value (≤ ≈ 10 %), as refuted.
  - A combat-plus-movement dormant path is bounded at about 10–12 % (half the floor; spatial insert and capture checks remain). See R5.

### I4. Moving-squad clearance and geometry keys cost about 1/5 of the idle tick — MEDIUM, CONFIRMED share, BOUNDED saving

- **Where:**
  - The avoidance clearance callback `Simulation.ts:3576–3590` → `transportStepClear` `:2041` → `transportProposal` `:2020` → `formationMoveClear` `:2117` → `emptyMovementSweep` `:2085`.
  - `CombatGeometry.envelope` `CombatGeometry.ts:35–59`: on a miss it rebuilds `physicalGeometryKey`/`geometryKey` strings, `FormationGeometry.ts:121–151`.
  - The spatial extent callback `Simulation.ts:998`.
- **Mechanism:**
  - Every candidate endpoint tried by a moving squad (preferred velocity, steering, up to 12 fallback headings) is certified. The per-tick proof cache holds 8 candidates.
  - Each certification computes the transport handoff, an envelope (a WeakMap hit plus 8 field compares, or a string-key rebuild when the formation object changed), a `mayOverlap` scan and an obstacle-area test.
  - Separately, the spatial grid recomputes envelope extents for every squad on every rebuild (`movementLand` runs up to 4× per tick, `Simulation.ts:3446/3461/3473/3640`).
- **Consequence (profile shares of (b)):**
  - clearance path 11.8 %;
  - all envelope work 7.8 % (overlapping);
  - `SpatialGrid.rebuild` 5.9 %;
  - `LandingOccupancy.observe` 2.1 %.

### I5. The micro-fixes already in the ledger do not move the idle tick — LOW, CONFIRMED by A/B

- **What I tested** (each behaviour-preserving where possible):
  - P21 (`resolveLandDamage` zero-damage skip): hash-identical.
  - Lazy `LandingOccupancy`: hash-identical.
  - R2-P10 (reorientation back-off): diverges.
- **Result:** each one's saving was inside the A/A spread (±2–3 %), and their profile bounds are ≤ 1.5 %, ≤ 2.1 % and ≤ 3.4 %.
- **Consequence:** R2-P10 still matters for blocked 144-troop squads in combat (19 I2), but none of these is a capacity lever for the idle 52-faction tick.

### I6. Passive human seats attract wars, which costs about 4 ms — LOW (expected gameplay), CONFIRMED

- **What happens:** after the seats go idle, AIs declare war on them (13 AI war pairs against 0 within 50 s), and each idle human ends up at war with 1–6 factions.
- **Cost:** about +1.5 combat, +1.1–1.5 ai, +1 economy and +0.7 ships, against (a), on top of the floor.
- **Routing is unaffected:** idle seats queue nothing. The +18 to +41 ms routing growth in 16 belongs to active orders (R2-P3/R2-P6).

### I7. The 384 MB worker cap is not a constraint with 8 human seats — LOW (verdict), CONFIRMED over 10 simulated minutes

- **Measured headroom:**
  - Peak `heapUsed` 309 MB, live 147 MB, against the 384 MB old-generation cap.
  - Major-GC cost is 0.4–1.2 ms per tick, the same as uncapped.
- **Projection:** at 19's late-match slope (≈ 2 MB/min live) about 230 MB live after 60 minutes, which is still under the cap. Peak `heapUsed` would approach the cap only if live heap passes ≈ 230–250 MB, because garbage between GCs runs at about 130–160 MB. That is EXTRAPOLATED.
- **Observability gap:** worker diagnostics report only `heapUsed`/`heapTotal`, including garbage (`serverMatchWorker.ts:107–108`). There is no live-heap or thread-CPU figure, which is how I1 went unnoticed.

## Recommendations

**Baseline:** quiet desktop (b), 82.9 ms mean, p95 115.6, p99 147. The orchestrator's target, "desktop under 125 ms" (≈ ARM 300 ms), is **already met on the mean and on p95**; p99 (147) is not.

That target is 0.42× real time on ARM. Real time on ARM (125 ms) needs ≈ 52 ms on the desktop, a −37 % cut. The changes below are ordered by measured or bounded saving.

| # | Change | Files | Saving on the idle tick | Effort | Test |
| --- | --- | --- | --- | --- | --- |
| **R1** | **Bound tribe expansion walking.** Cap concurrent expansion marchers per tribe (K = 4–8), or let tribes claim adjacent frontier tiles without walking (border growth) and keep marches for contested tiles. | `Simulation.ts:5222–5229` (budget before the cohort loop; the prototype is 3 lines), `HomeTerritory.ts:105`. Gameplay owner sign-off needed: tribes held 7–20 % less land at minutes 3.3–5 of the match. | **Measured** −10.5 to −27.3 ms (K = 4: −19 to −28 %; K = 8: −12 to −16 %). Upper bound with no marches: −26 to −36 %. | S (cap) / M (border growth) | Deterministic test on a 52-faction fixture: after N ticks no tribe has more than K squads holding march-issued `move` orders, and tribe land stays ≥ X % of baseline. Perf contract: tribe movers per tick ≤ 30 × K at tick 1,600 on the Mig 500 fixture. |
| **R2** | **Cheaper clearance for moving squads.** (a) Skip `transportProposal`/`transportHandoff` when the squad is not afloat and start and end tiles are both land. (b) Memoise the envelope and `emptyMovementSweep` bounds per (formation object, tick) within the avoidance solve. (c) Cache `broadRadius` for the spatial extent in a WeakMap keyed by the immutable formation object. | `Simulation.ts:2020`, `:2041–2050`, `:2085–2115`, `:998`; `CombatGeometry.ts:35`. | BOUNDED: the clearance path is 11.8 % and envelope work 7.8 % (overlapping). Realistic ≈ 5–8 % (4–7 ms). | M | Behaviour preservation: a 400-tick squad-hash equality test (baseline vs patched; the `ab.mts` pattern) plus a counter test that envelope builds per tick fall. |
| **R3** | **Spatial-index maintenance.** Rebuild the movement grid once per phase boundary that needs it, rather than on every `movementLand()` call after any position write, or update moved squads incrementally. Note that bucket order must stay ID-sorted, because `LocalAvoidance` relies on it. Share the extent value with Battle's `PhaseSpatialViews` grid. | `Simulation.ts:480–494`, `SpatialGrid.ts:34–70`, `Battle.ts:266`. | BOUNDED: `SpatialGrid.rebuild` is 5.9 % of samples (≈ 6.7 % of tick). Realistic ≈ 3–4 %. | M | Hash equality over 400 ticks; unit test that `query` results stay ID-ordered after incremental moves. |
| **R4** | **Planner selection and admission bookkeeping.** Per-class job counters instead of rescanning every job per quantum (P36), and in-place priority iteration (R2-P6). | `RoutePlanner.ts:368–430`, `MovementAdmission.ts:801–804`. | BOUNDED idle: `selectJob` 1.6 % + `stepAdmissions` 0.8 % ≈ 2–3 %. Larger with active humans: R2-P6 measured 10–16 ms CPU per tick at P = 271–467. | S–M | Existing planner fairness tests, plus a checkpoint hash test with the same job order. |
| **R5** | **Dormant-squad path across combat and movement** (re-proposed only because §4 contradicts the refutation's "low" for the all-phase floor). Skip `Battle.fight` acquisition, the `resolveLandDamage` walk (P21), `syncFormationCounts` and the navigation/advance walks for squads that hold, are not fighting, have no hostile within the acquisition radius, and whose position, formation and order revision are unchanged since last tick. Wake them on spatial-revision or diplomacy change near them. | `Battle.ts:668–670`, `Simulation.ts:3476–3640`, `:4594`, `:2187`. | BOUNDED: half of the 18–24 ms floor ≈ 10–12 %. Prototype P2 alone did not show (I5), so only a cross-phase version is worth doing. | L | Hash equality over a 400-tick idle fixture; a war-declaration test proving dormant squads wake on the tick an enemy enters range. |
| — | **Measurement hygiene, prerequisite.** Record thread CPU next to wall in `RuntimeDiagnostics` and the perf scripts. Reject or flag runs whose wall/CPU exceeds 1.5. Export live heap after GC (19 I4). | `serverMatchWorker.ts:86–107`, `RuntimeDiagnostics.ts`, `scripts/measureLateGamePerformance.ts` | none on its own; it prevents a repeat of I1 | S | Unit test that diagnostics carry `cpuMs` and the ratio. |

**Expected combined effect** (does not add linearly; R1 shrinks R2's base):
- R1 (K = 4) + R2 + R3 ≈ −30 to −38 %, i.e. about 52–58 ms mean on the desktop, which is around real time on ARM (EXTRAPOLATED ×2.4).
- R1 + R2 alone: ≈ 60–66 ms.
- Without touching tribes, R2 to R5 together are bounded at roughly −20 to −25 % (≈ 62–66 ms).

## Open questions

1. **ARM factor.** All ARM figures assume ×2.4 (06/16). With I1 resolved, the factor should be re-measured on the A1 host with thread CPU (`docs/OracleLateGameHardwareTest.md`).
2. **Active humans.** I did not replay 16's active-human command logs on a quiet host. That would settle the 8-active figure (I1, SUSPECT ≈ 110–150 ms quiet). The input is `scratchpad/load-test/mig-humans-log.commands.json` with `worker.mts`.
3. **Tribe expansion cadence.** Is continuous walking intended? A cap or border-growth model changes the early-game land race (§6 table). The owner should choose K, or a non-walking claim.
4. **Map coverage.** Mediterranean was checked only for ticks 1,200–2,000 (paired and mover census), not a 10-minute solo run. Larger maps (1000) were not run.
5. **Pop-up factions.** Nomads, and later pirates, will add walking squads. At the measured 51–82 µs per moving squad-tick, each 20-squad nomad band on the move costs about 1–1.6 ms CPU per tick. They should get the same march budget as tribes.
