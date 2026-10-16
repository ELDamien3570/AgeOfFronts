# 16 — Load test: 8 active humans + 14 AI nations + 30 tribes (52 factions)

Round 2, read-only. Every number below comes from my own runs on 2026-10-16 (03:22–04:05 local), unless it is labelled **EXTRAPOLATED**. The ARM figures are desktop wall time × 2.4, the factor from 06. Round 1 extrapolated every 8-human number from runs with 0–3 *idle* human seats. These runs have 8 human seats that each issue 40–80 actions per minute against 44 AI factions.

**Headline.**

- **CRITICAL (CONFIRMED, reproduced through the real `ReservedMatchWorker`).** Eight active humans crash the match on Mediterranean about 3.8 simulated minutes after they take control. The fault is `TypeError: Cannot read properties of undefined (reading 'kind')` at `MovementAdmission.ts:942`, which throws out of `Skirmish.step`. `LiveMatch` then ends the match (`LiveMatch.ts:661-662`). The bug has been in HEAD since `d5ba9c40`, so it is not a working-tree regression.
- **Capacity.** With 8 active humans the tick costs +29 % (Mediterranean) to +34 % (Migration) more than with 8 idle human seats holding the same armies. Routing is 1.8× to 2.6× higher. The route planner stays pinned at 115–124 of its 128 job slots for the whole 10 minutes, with 274–634 movement admissions waiting. The result is ≈ 0.25× real time on the ARM host (**EXTRAPOLATED**). The desktop itself manages only 0.61–0.63×.
- **Network.** Publish-on-command raises the publication rate to 6.45–6.6 Hz, not 8 Hz. Each client receives 332–426 KB/s at full sim speed, and server egress for 8 clients is 21–27 Mbit/s. The client spends 37–40 ms of desktop CPU per publication, of which 66–73 % is the structured clone of the full view.
- **Queue limits.** No command was rejected for queue-full or planning-full under honest load. A single client that stays at the 50 msg/s rate limit does cause honest players to receive "Command queue is full" (modelled).

## Scope read

| File | Lines |
| --- | --- |
| `src/skirmish/multiplayer/application/LiveMatch.ts` | 1–300, 540–917 (admitCommand 551–574, scheduleTick 648–677, advanceWorld 678–774, broadcast/sendState/resync 862–917) |
| `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` | 1–318 (whole) |
| `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts`, `SnapshotEncodingWorker.ts`, `snapshotEncoderThread.ts` | whole |
| `src/skirmish/multiplayer/application/PublicationQueue.ts`, `ClientStateFlow.ts`, `MatchExecutor.ts` | whole / whole / 1–100 |
| `src/skirmish/multiplayer/CommandSchema.ts` | whole |
| `src/skirmish/multiplayer/SnapshotWireCodec.ts`, `StateCodec.ts` | whole / 150–167, 340–430 |
| `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts` | 190–215, 280–310 |
| `src/skirmish/CommandApplications.ts` | whole |
| `src/skirmish/MovementAdmission.ts` | 100–240, 335–375, 455–475, 680–1000 |
| `src/skirmish/RoutePlanner.ts` | 160–180, 360–560 |
| `src/skirmish/Simulation.ts` | 200–262 (onPhase, setAiController), 590–640 (drainRoutes/drainRouteBatch budgets), 800–830, 920–1000 (planner/admission ports), 1175–1232, 1254–1300 (applyCommand), 2353–2400 (spawnSquad), 5585–5605 (replicationSource) |
| `src/skirmish/client/multiplayerStateWorker.ts` 1–120, `CanonicalStateStream.ts` 1–60 and 125–175, `OnlineMatchSession.ts` 130–160 | as listed |
| `src/skirmish/multiplayer/infrastructure/ServerMap.ts`, `src/skirmish/lobby/LobbyDirectory.ts` 40–80 | whole / as listed |
| Round-1 notes | 02-network.md (whole), 06-simulation-perf.md 1–140, 02b-server-lifecycle.md 1–40, 00-summary.md 1–80 |

## Harness and method

All scripts are in `C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/load-test/`.

- **The working tree changed during the review.** Carrier and airfield edits were landing around 02:30–02:35, and the live tree briefly failed to import (`Catalog.ts:65 Missing unlock earlymodern-carrier`). I therefore ran everything against a frozen copy, `snap/`, taken at 02:45 (it imported and stepped cleanly). `snapfix/` is the same copy with a single `?.` guard at `MovementAdmission.ts:942`. The guard is needed so the Mediterranean humans run can finish 10 minutes, and it changes behaviour only at the crash site. `MovementAdmission.ts` in the live tree is byte-identical to HEAD (`git diff --stat HEAD` is empty).
- **`inproc.mts`** builds the match the way `LiveMatch` does:
  - `loadServerMap(defaultLobbySettings(map, 500), seed)`.
  - `Skirmish` with the LiveMatch options: `DEFAULT_AI_POLICIES`, raids-v1, corridors-v1, `FORMATION_MOVEMENT`, 8 human seats + 14 AI + 30 tribes, ages-v1, Napoleonic start, seed 1272661902.
  - Warm-up: 1 200 ticks (2.5 min) with the 8 human seats AI-controlled. Then `inject.mts` gives each human 60 squads, using the private `spawnSquad` path that recruitment uses, with the AI nations' unit mix (all `napoleonic-infantry` at that point). This adds 480 squads, so the measured phase holds 1 050–1 480 squads, the same order as the ARM reference load of ~1 100. The seats then switch to human control.
  - Measurement: 4 800 ticks (10 simulated minutes).
  - Each tick mirrors the `serverMatchWorker` advance: `commandSchema.parse` for every command, then `CommandApplications.apply`, then `match.step()` with `onPhase` timing. It publishes when the LiveMatch 5 Hz sim-time gate passes, a command executed, or a cohort committed (`serverMatchWorker.ts:282`). Capture is `SnapshotEncoder.encode(replicationSource(true))`. Encoding runs on the real `SnapshotEncodingWorker` thread.
- **Scripted humans** are seeded per seat, run in simulated time, and draw an APM between 40 and 80 (54, 52, 64, 55, 72, 79, 52, 56). The action mix:
  - 40 % moves of a ≤30-squad control group, toward the nearest hostile at 70 % of the distance. 35 % of moves are followed by 1–3 Shift-queued legs.
  - 15 % attacks on the nearest hostile squad, 8 % formation changes, 5 % charges, 4 % attack-structure.
  - 10 % builds, 8 % auto-recruits, 6 % research.
  - 2 % stance changes, 2 % age advances, and war declarations on the nearest non-hostile faction.
  - Over 10 minutes the humans issued 4 261 commands on Mediterranean and 4 478 on Migration, i.e. 53–56 actions per minute per human. About 23 % are rejected by domain rules, by design: the script makes no attempt to be clever.
- **Control run "idle"** is the same seed, warm-up and injection, with the humans on human control but issuing no commands. This is the round-1 "idle human seats" condition, now with armies.
- **`replay.mts`** decodes every dumped publication, in order, in a quiet process along the browser worker path: `decodeState` → `CanonicalStateStream.apply` → `presentationState()` → `structuredClone` (the `postMessage` copy) → `acknowledge`. It also re-encodes every second packet as a proxy for the encoder thread.
- **`worker.mts`** drives the real `ReservedMatchWorker`: `serverMatchWorker.ts`, the 384 MB cap, the real encoder thread and `PublicationQueue`. It paces requests exactly like `LiveMatch.advanceWorld`: 125 ms ticks, the clock-debt rebase, the wall and sim 5 Hz gate, one tick per advance. It feeds the exact per-tick command log recorded by `inproc.mts` and builds 8 fan-out frames per publication with `encodeSnapshotFrame`. The `inject-armies` request is a scratch-only hook in the frozen copy.
  - **Equivalence.** On Migration, the in-process run (snapfix) and the real worker (snap) produced identical order-independent squad hashes at all 3 805 common publication ticks. The simulation is deterministic across the two paths, and captures do not perturb it.
- **Timing hygiene.** The first two batches ran while other round-2 agents held the CPU at 100 %. Wall time was inflated 2.3–3.2× against 06's published numbers, so I discarded those batches; they are kept under `partial-v1/` and `contended-v2/` for deterministic metrics only. The final batch ran with only my processes on the 8-core 3700X. A same-time calibration run of 06's probe (`calib-perf52.ts`) measured 32 / 40 / 68.5 ms at ticks 400 / 800 / 1200, against 06's 35 / 43 / 57. The batch is therefore within about ±20 % of an uncontended desktop.
- **`queuemodel.mjs`** replays the measured per-human command rates in wall time against the measured tick series × 2.4. It models LiveMatch's shared 100-entry queue (**EXTRAPOLATED**/modelled).

## How it works today (the paths this test exercises)

- **Input path.** Browser → `CoordinatorServer` (50 msg/s per session after parse, `CoordinatorServer.ts:305`) → `LiveMatch.admitCommand`. The command queue holds 100 entries, **shared by all seats** (`LiveMatch.ts:559-561`). Each advance drains the whole queue (`LiveMatch.ts:738-740`) and runs exactly one tick. The worker applies each command through `CommandApplications.apply`, which holds 512 deferred receipts, **shared by all players** (`CommandApplications.ts:34, 77`).
- **Movement orders.** A human order of more than 10 squads is split into a 1-squad lead admission plus 10-squad cohorts that share `corridorId` (`MovementAdmission.ts:343-366`). Every member of every cohort issues its own planner request (`MovementAdmission.ts:961`).
  - The route planner has 128 job slots. Background requests are refused at 120 jobs, and uncommitted background requests at 104 (`RoutePlanner.ts:521-532`). Interactive requests have **no per-player cap and no aggregate cap below 128**.
  - Human admissions never time out (`Simulation.ts:944`), while AI admissions carry `autonomousRouteDeadlineTicks`.
  - Interactive admission work is 320 units per tick, split around the planner (`Simulation.ts:623-626`). Selecting the next interactive admission spreads the whole pending map on every loop iteration (`MovementAdmission.ts:803`).
- **Publication.** The background gate is at most 5 Hz in wall and sim time (`LiveMatch.ts:731`). The worker also publishes after any executed command or committed cohort (`serverMatchWorker.ts:282`). Publications go through `PublicationQueue` (capacity 2) to the encoder thread and back to the sim thread, which forwards them only when it yields.
- **Client.** The browser worker decodes and applies each publication, builds `presentationState()`, and posts the full entity view to the main thread (`multiplayerStateWorker.ts`, entities mode, used by `OnlineMatchSession.ts:239`). The flow window is 4 unacknowledged frames (`ClientStateFlow.ts:8, 20-23`).

## Measured results

### Simulation tick: 8 active vs 8 idle humans (desktop ms, 4 800 ticks each)

| | Med. active | Med. idle | Mig. active | Mig. idle |
| --- | ---: | ---: | ---: | ---: |
| Squads during measurement | 1 052–1 198 | 867–1 383 | 1 176–1 295 | 995–1 476 |
| Factions alive at end | 43 | 30 | 46 | 35 |
| **tick mean / p50 / p95 / p99 / max** | **198 / 178 / 348 / 464 / 851** | 154 / 147 / 264 / 357 / 1 038 | **206 / 191 / 341 / 497 / 1 063** | 154 / 143 / 254 / 334 / 852 |
| economy mean / p99 | 6.7 / 24 | 6.8 / 24 | 6.4 / 21 | 7.2 / 23 |
| ai | 16.6 / 38 | 17.6 / 50 | 15.3 / 36 | 16.4 / 42 |
| ships | 1.9 / 5.6 | 1.7 / 6.3 | 1.8 / 5.6 | 2.3 / 7.8 |
| **routing** | **41.2 / 126 (max 529)** | 23.4 / 66 | **65.8 / 337 (max 919)** | 25.2 / 70 |
| movement | 68.2 / 173 | 59.2 / 156 | 60.7 / 141 | 56.1 / 138 |
| combat | 53.8 / 134 | 35.5 / 81 | 47.1 / 137 | 36.6 / 79 |
| capture | 6.2 / 26 | 6.2 / 27 | 5.5 / 25 | 6.0 / 27 |
| transport | 2.5 / 12 | 2.5 / 12 | 2.5 / 13 | 3.0 / 13 |
| setup + cleanup | 1.1 | 1.0 | 1.0 | 1.0 |
| **ARM tick mean / p99 (×2.4, EXTRAPOLATED)** | **475 / 1 114** | 369 / 858 | **495 / 1 194** | 369 / 802 |
| **ARM sim speed (EXTRAPOLATED)** | **0.26×** | 0.34× | **0.25×** | 0.34× |

- **Routing.** Active humans add +17.8 ms on Mediterranean and +40.5 ms on Migration. The worst single-tick routing phase rises to 529 and 919 ms.
- **Combat.** +18 and +11 ms, because humans declare wars and attack.
- **Movement.** Only +5 to +9 ms.
- Everything else is unchanged.

The idle baseline is itself slower than 06's all-AI 52-faction probe (82–113 ms at S ≈ 1 000–1 150), because the 480 stationary human squads pay the full per-squad cost that 06 Issue 2 describes.

A profiled re-run on Mediterranean (`PROFILE=1`, run under contention, so read it as shares) found:

- `MovementAdmission.stepAdmissions` takes 10.4–16.4 ms of thread CPU per tick, which is 6–7 % of the tick. 93–97 % of that time is in the priority (human) path.
- The mean pending admission count is 271–467.
- The planner refused 68–88 % of human requests, 86–97 % of AI requests and 96–97 % of trade requests.
  - Humans make 15–31 k requests per 400 ticks, i.e. 38–78 per tick; most are retries of refused requests.
  - The real-worker Migration run's cumulative `planner.admissionDeferred` reached 1 027 033 refused requests in 6 000 ticks, about 171 per tick.

### Queues and command outcomes (deterministic; identical in every batch)

| | Med. active | Med. idle | Mig. active | Mig. idle |
| --- | ---: | ---: | ---: | ---: |
| Planner jobs, mean of window means / max (limit 128) | **115 / 128** | 62 / 116 | **124 / 128** | 85 / 120 |
| Planner, worst window mean | 119 | 105 | 127 | 112 |
| MovementAdmission pending, mean / max | **274 / 543** | 33 / 202 | **635 / 755** | 66 / 320 |
| Deferred receipts pending, mean / max (limit 512) | 6 / 22 | 0 | 10 / 27 | 0 |
| Commands per advance, max (queue 100) | 5 | 0 | 5 | 0 |
| Queue-full / planning-full rejections | 0 / 0 | – | 0 / 0 | – |
| Outcomes executed / rejected / superseded | 2 406 / 1 020 / 831 | – | 2 220 / 1 069 / 1 177 | – |
| Command validation (zod), mean per advance | 0.09 ms | – | 0.09 ms | – |
| Command apply, mean per advance / max | 0.86 / 41 ms | – | 1.07 / 54 ms | – |

Of 2 400–2 600 human orders that deferred, 831–1 177 were superseded by the same human's next order before their admission finished. That is 33–45 % of the planning work spent on orders nobody waits for any more.

### Order latency (simulated ticks; 1 tick = 125 ms of game time, 400–500 ms of ARM wall time at the measured speed)

| Order kind | Map | Outcome tick − submit tick, i.e. admission committed (mean / p50 / p95 / p99 / max) | Half the selection moving (p50 / p95 / p99) | Any member moving (p50 / p95) |
| --- | --- | --- | --- | --- |
| move (≤30 squads) | Med. | 11.4 / 7 / 34 / 52 / 67 | 1 / 63 / 128 | 1 / 8 |
| move | Mig. | 18.2 / 12 / 51 / 73 / 120 | 1 / 100 / 145 | 1 / 29 |
| attack-structure | Med. | 17.3 / 9 / 61 / 135 / 135 | 1 / 90 / 141 | 1 / 40 |
| attack (executes in-tick) | Med. / Mig. | 0 | 2 / 105 · 1 / 132 | 1 / 31 · 1 / 85 |
| charge (executes in-tick) | Med. / Mig. | 0 | 1 / 109 · 1 / 122 | 1 / 101 · 1 / 108 |

- **Per-seat fairness.** Each human's p95 for a move outcome stays within 19–41 ticks on Mediterranean and 29–51 ticks on Migration. The planner's player round-robin works.
- **What the player sees.** The lead squad moves on the next tick because of the 1-squad lead admission. The rest of a 30-squad group takes a median of 0.9–1.5 s of game time to start, and 4–6 s at p95.
- **On ARM (EXTRAPOLATED, 0.25× speed).** A move takes a median of 3.5–6 s of wall time to commit, and 17–25 s at p95.
- The "half moving" tail (p95 63–132 ticks) also includes squads already in melee or blocked, so it overstates pure planning latency.

### Publication, bandwidth, encoder and client (8 clients)

| | Med. active | Med. idle | Mig. active | Mig. idle |
| --- | ---: | ---: | ---: | ---: |
| Publications per sim second (gate alone = 5.0) | **6.59** | 5.00 | **6.45** | 5.00 |
| gzip bytes per publication, mean / p95 / p99 / max | 64.7 k / 105 k / 114 k / 125 k | 57.0 k / 92 k / 100 k / 107 k | 51.5 k / 65 k / 72 k / 82 k | 51.8 k / 77 k / 90 k / 99 k |
| raw bytes per publication, mean (of which metadata JSON) | 601 k (416 k = 69 %) | 552 k (378 k) | 519 k (384 k = 74 %) | 507 k (356 k) |
| Changed squad rows per publication | 332 | 334 | 255 | 288 |
| **Per client at full sim speed** | **426 KB/s (3.4 Mbit/s)** | 285 KB/s | **332 KB/s (2.7 Mbit/s)** | 259 KB/s |
| **Egress for 8 clients** | **3.4 MB/s (27 Mbit/s)** | 2.3 MB/s | **2.65 MB/s (21 Mbit/s)** | 2.1 MB/s |
| Capture on sim thread, mean / worst-window p99 | 7.6 / 34 ms | 7.3 ms | 5.9 / 26 ms | 6.5 ms |
| Sim-thread `postMessage` to encoder | 1.3 ms | | 1.2 ms | |
| Encode on a quiet thread (re-encode proxy), mean / p99 | 12.8 / 20 ms | 12.2 / 19 ms | 10.8 / 16 ms | 11.5 / 18 ms |
| Client decode / apply / project / clone (mean) | 6.2 / 6.1 / 0.03 / 26.4 ms | 6.1 / 6.3 / 0.04 / 24.6 | 5.4 / 5.5 / 0.03 / 29.4 | 5.8 / 6.0 / 0.04 / 26.8 |
| **Client total per publication, mean / p95 / p99** | **38.7 / 47 / 54 ms** | 37.0 / 48 / 54 | **40.3 / 48 / 54** | 38.5 / 47 / 54 |
| Client CPU per second at full speed | 255 ms/s | 185 ms/s | 260 ms/s | 193 ms/s |
| Coordinator fan-out, 8 × `encodeSnapshotFrame` (real worker run) | | | 0.13 ms (p99 0.45) | |

#### Real-path run (Migration, `ReservedMatchWorker` + encoder thread, paced like LiveMatch, desktop, 8 active humans)

- **Throughput.** Advance round-trip was 208 ms mean, 191 p50, 345 p95, 472 p99, 1 047 max, so the simulation ran at 0.60× real time on the desktop.
- **Publications.** 6.47 per sim second, i.e. 3.89 per wall second at that speed. The wall-clock gap between publications was 217 ms p50, 498 ms p95, 716 ms p99 and 1 814 ms max. Per client this delivered 200 KB/s of wall time.
- **Forwarding delay (N6 confirmed).** Once the simulation is saturated, a publication reaches the coordinator 208 ms mean (p99 472) after the advance that captured it, i.e. one full advance later. During the unsaturated warm-up, at ≤1 200 ticks and about 0.97× speed, the same delay was 5–10 ms. This confirms 02's N6 and shows it costs a full tick exactly when the server is overloaded.
- **Encoder and memory.** `PublicationQueue` skipped 0 publications. Encoder compression took 6.7 ms mean. Worker heap was 237 MB used out of 419 MB at tick 5 600. The 384 MB cap was not hit.

### Command-queue model (EXTRAPOLATED: measured per-human rates and tick series, ARM ×2.4)

| Scenario | Queue at advance, mean / p99 / max | Honest commands rejected "queue full" | Dispatch wait, mean / p99 |
| --- | --- | --- | --- |
| 8 honest humans, Med. (Mig.) | 5.5 / 18 / 33 (6.0 / 19 / 44) | 0 | 278 / 934 ms (287 / 1 150) |
| + one client looping at 20 msg/s | 15 / 38 / 66 (16 / 39 / 85) | 0 | same |
| + one client at the 50 msg/s limit | 29 / 70 / **100** | **17 (Med.), 132 (Mig.) per match** | same |
| + 50 msg/s client and a 1 s stall | 29 / 70 / 100 | 28 / 106 | same |
| Desktop speed (×1.0), honest | 2.3 / 9 / 19 | 0 | 117 / 407 ms |

## Comparison with round-1 extrapolations

| Quantity | Round 1 (00-summary / 02 / 06, extrapolated from 0–3 idle seats) | Measured here, 8 active humans |
| --- | --- | --- |
| Tick at about 1 100 squads | 82–113 ms desktop, about 200–270 ms ARM (06, all AI) | **198–206 ms desktop, about 475–495 ms ARM (EXTRAPOLATED)**. The idle-army baseline is 154 ms. |
| Sim speed on ARM | about 0.5× (00) | **about 0.25× (EXTRAPOLATED)** |
| Publication rate with 8 humans | "8 Hz" (02 N7) | **6.45–6.6 Hz** at 53–56 APM |
| Per client | 330–375 KB/s at 5 Hz, 520–600 KB/s at 8 Hz | **332–426 KB/s** at full speed. The 8 Hz case was over-estimated, the 5 Hz case under-estimated. |
| Egress, 8 clients | 21–24 Mbit/s at 5 Hz | **21–27 Mbit/s** |
| Delta capture on sim thread | 4 ms desktop, about 12 ms ARM | **5.9–7.6 ms desktop, about 14–18 ms ARM** |
| Delta encode | 13 ms desktop, about 28 ms ARM | **10.8–12.8 ms desktop** on a quiet thread |
| Client decode + apply + project + clone | 6.5 + 8.6 + 3.6 + 20 ms (02) | **5.4–6.2 + 5.5–6.1 + 0.03 + 26–29 ms = 37–40 ms**. Projection is now free and the clone is the cost. |
| Planner | "pinned at 104–120 of 128 with 50–320 admissions waiting" (06, all AI) | **Pinned at 115–124 mean (128 max) for the full 10 minutes, with 274–635 admissions waiting** |
| Command queue / receipts | not measured | Never over 5 per advance and 27 receipts. Not a constraint for honest players. |

## Strengths

- **Determinism holds through the real path.** The in-process run and `ReservedMatchWorker` + encoder thread produce identical state at every one of 3 805 compared publications, and capture has no side effects.
- **Human orders get a fair share.** Each seat's p95 outcome latency is within 2× of the others. The planner's per-player round-robin and the 1-squad lead admission give the first visible motion on the next tick (p50 = 1 tick for every order kind).
- **Command validation is negligible.** It costs 0.09 ms per advance, and apply is 0.9–1.1 ms mean. Queues and receipts have large headroom for honest play.
- **The encoder thread keeps up.** It never skipped a publication. Fan-out costs 0.13 ms per publication for 8 clients, and the 384 MB heap cap was not reached at about 1 250 squads.
- **Client projection is cheap.** `presentationState()` costs 0.03 ms. 02's projection cost is gone. What remains is the clone (see Issue 6).

## Issues

### 1. CRITICAL — An 8-human match crashes: stale corridor-owner squad dereference in `MovementAdmission.stepAdmissions`

- **Where:** `src/skirmish/MovementAdmission.ts:942`, with `:343-366` (cohort split) and `:806-818` (lazy per-call validation). The match is ended at `src/skirmish/multiplayer/application/LiveMatch.ts:661-662`.
- **Confidence:** CONFIRMED, by execution three ways:
  1. The Mediterranean in-process run crashed between tick 3 000 and 3 200, 3.8–4.2 sim minutes into the 8-human phase.
  2. The same command log through the real `ReservedMatchWorker` crashed with `Match executor operation failed advance TypeError: Cannot read properties of undefined (reading 'kind') at MovementAdmission.stepAdmissions (MovementAdmission.ts:942:88) … at serverMatchWorker.ts:271`. The last diagnostic before it was at tick 3 000.
  3. A 40-line deterministic repro, `repro-corridor-crash.mts`, crashes at tick 7 on both the frozen copy and the live tree.
- **Mechanism:**
  - A human selection of more than 10 squads is split into a 1-squad lead admission (`corridorId` = its own id) and 10-squad cohorts with the same `corridorId`.
  - In the `routes` phase, a follower reads `original = this.pending.get(admission.corridorId)` and dereferences `this.ports.squad(original.members[0].id)!.kind`.
  - `stepAdmissions` validates an admission's own members only when it visits that admission (`:810-818`). Admissions rotate through the Map (delete + set), so a follower can be visited before the lead admission in the same call.
  - If the lead squad has died, `ports.squad()` returns `undefined`, and the `TypeError` escapes `Skirmish.step` in the middle of a tick.
- **Why load triggers it:** the window is only open while the lead route waits in the planner. Under 8 active humans the planner is pinned at 115–128 jobs, the waits stretch to tens of ticks, and leads are killed in the fights the humans start.
- **Consequence:**
  - The worker rejects the `advance` request, and `LiveMatch.advance().catch` calls `end("Match stopped: Cannot read properties of undefined (reading 'kind')")`. Every player loses the match.
  - The simulation state is also left half-ticked.
  - AI never splits orders: AI orders are ≤30 squads and the AI cohort size is 30. So this is a pure human-load crash, invisible in every round-1 run, which had idle human seats.
- **Repro sketch:**
  1. On a 160×100 all-land map, give a human 12 squads.
  2. Make the planner accept requests without completing them: `game.routePlanner.request = () => true`.
  3. Issue one `order` move for all 12 squads, then step 6 ticks.
  4. Find the admission with `corridorId === id` and `members.length === 1`, and `removeSquad` its member.
  5. `step()` throws at tick 7.

### 2. HIGH — The planner's 128 job slots are monopolised by interactive per-member requests, starving AI and trade routing

- **Where:** `src/skirmish/RoutePlanner.ts:521-532`, `src/skirmish/MovementAdmission.ts:961`, `src/skirmish/Simulation.ts:623-626`.
- **Confidence:** CONFIRMED (measured).
- **Mechanism:**
  - Every member of every cohort requests its own exact job. The leader's spine is shared, but entry and exit connectors are still separate jobs.
  - Interactive requests may take all 128 slots, while background requests stop at 120 and uncommitted background requests at 104. Nothing caps one seat or all seats together.
  - A refused request returns `false` and is retried on the next admission step.
- **Measured:**
  - The planner averages 115–124 jobs for all 10 minutes, with a maximum of 128 in every 400-tick window.
  - 274–635 admissions are pending.
  - Refusals: 68–88 % for human requests, 86–97 % for AI and 96–97 % for trade (profile run). `admissionDeferred` reached 1.03 M in 6 000 ticks on the real worker.
- **Consequence:**
  - The routing phase grows by +18 to +41 ms mean, with p99 126–337 ms and single ticks of 529–919 ms.
  - AI armies and trade wait on the leftover 0–8 slots. AI deadline rejections feed the retry storm documented in 06.
  - Human orders themselves queue for tens of ticks (move outcome p95 34–51 ticks).

### 3. HIGH — `stepAdmissions` priority selection is O(P²) per call

- **Where:** `src/skirmish/MovementAdmission.ts:803` (`[...this.pending].find(...)` on every loop iteration), `:795` (`[...this.pending.values()].some(...)`). It is called up to 3 times per tick, at `Simulation.ts:623, 626` and in `step`'s 2/3 priority pass.
- **Confidence:** CONFIRMED mechanism and measured share.
- **Mechanism:**
  - Each iteration materialises all P pending entries as fresh `[key, value]` arrays to find the first priority admission.
  - When every human admission is waiting on the planner (the normal state under Issue 2), the loop runs until `idle >= pending.size` without consuming budget. That is P iterations × P entries.
- **Measured:**
  - Micro-benchmark: 4 ms per call at P = 150, 17–23 ms per call at P = 320–500.
  - In the match profile: 10–16 ms of thread CPU per tick, 6–7 % of the tick, 93–97 % of it in the priority path, at a mean P of 271–467.
- **Consequence:** this is a quadratic hot spot that grows with exactly what 8 humans create. On ARM it is about 25–40 ms per tick (EXTRAPOLATED).

### 4. HIGH — Active humans make the 52-faction target about 4× too slow for the ARM host (EXTRAPOLATED)

- **Where:** whole tick, see the table. The routing additions are Issues 2 and 3. The combat additions come from real fighting.
- **Confidence:** CONFIRMED on desktop; the ARM figure is EXTRAPOLATED.
- **Measured:**
  - The desktop runs at 198–206 ms mean, p99 464–497 ms, i.e. 0.61–0.63× real time on the desktop itself. The real-worker run reached 0.60×.
  - × 2.4 gives 475–495 ms per tick on ARM, or 0.25× real time.
  - Idle seats with the same armies cost 154 ms desktop, i.e. 0.34× on ARM.
- **Consequence:**
  - Under the LiveMatch clock-debt policy the game runs at about a quarter speed and publication intervals stretch with it.
  - Every human-visible latency above, measured in ticks, is multiplied by about 4 in wall time on ARM. For example, a move's p95 commit becomes 17–25 s.
  - The round-1 estimate of 0.5× was optimistic by about 2×.

### 5. MEDIUM — Publish-on-command raises the rate to about 6.5 Hz, and under saturation every publication waits one extra tick

- **Where:** `serverMatchWorker.ts:282`, `PublicationQueue.ts` (forwarding in the sim thread's event loop), `LiveMatch.ts:731`.
- **Confidence:** CONFIRMED (measured).
- **Measured:** 6.45–6.59 publications per sim second, against 5.00 for idle. The extra 30 % costs:
  - sim-thread capture: +1.5 × 7 ms per second of game time;
  - encoder work: +1.5 × 12 ms;
  - client CPU: +70 ms per second;
  - bandwidth: +27 % on Mediterranean (426 vs 285 KB/s per client).

  In the real-worker run, a publication reaches the coordinator one full advance after its tick once the simulation is saturated: 208 ms mean, 472 ms p99. Unsaturated, the delay is 5–10 ms.
- **Consequence:** the "immediate" command feedback costs bandwidth and CPU, and it does not arrive sooner under load, because each publication is held for a whole tick.

### 6. MEDIUM — Client cost per publication is dominated by cloning the full entity view

- **Where:** `src/skirmish/client/multiplayerStateWorker.ts` (entities mode posts `stream.presentationState()`), `CanonicalStateStream.ts:133-158`.
- **Confidence:** CONFIRMED (measured in a quiet replay of 3 000–3 950 real publications per run).
- **Measured:**
  - Decode 5.4–6.2 ms, apply 5.5–6.3 ms, project 0.03 ms.
  - `structuredClone` of the view: 25–29 ms, scaling with total squads (about 1 100–1 250), not with changed rows (255–334).
  - Total 37–40 ms per publication, about 255–260 ms of CPU per second at 6.5 Hz. Roughly half of the clone is paid again as deserialisation on the main thread.
- **Consequence (EXTRAPOLATED for a laptop at 2.5× slower):**
  - About 650 ms of CPU per second goes to state handling, and about 30 % of the main thread is spent deserialising.
  - The flow window of 4 frames (`ClientStateFlow.ts:20-23`) gives 0.6 s of slack at 6.5 Hz. Any GC or tab hitch longer than that triggers the baseline recovery loop described in 02 N1.

### 7. MEDIUM — The command queue and deferred receipts are global, not per seat

- **Where:** `LiveMatch.ts:559-561` (100 shared), `CommandApplications.ts:34, 77` (512 shared), `CoordinatorServer.ts:305` (50 msg/s per session, counted after parse).
- **Confidence:** CONFIRMED mechanism; the magnitude is modelled (EXTRAPOLATED).
- **Measured:** honest load never exceeded 5 commands per advance or 27 receipts.
- **Modelled:** one client at the permitted 50 msg/s fills the shared queue to 100 at ARM tick lengths. Honest players then receive 17–132 "Command queue is full" errors per match. A 20 msg/s client peaks at 66–85 entries. One seat can likewise hold all 512 receipts, and the others get "Command planning is full".
- **Consequence:** a single misbehaving client (macro, broken UI repeat, or malicious) degrades every human's input.

### 8. MEDIUM — Human admissions have no deadline or coalescing, so 33–45 % of their planning work is superseded

- **Where:** `Simulation.ts:944` (no human deadline); the `MovementAdmission` cancel path.
- **Confidence:** CONFIRMED (measured).
- **Measured:** 831 superseded orders on Mediterranean and 1 177 on Migration, out of about 2 500 deferred human orders. The maximum move-commit latency was 67–135 ticks.
- **Consequence:** planner slots and admission budget are spent on routes the player has already replaced, which deepens Issues 2 and 3.

### 9. LOW — Metadata JSON is 69–74 % of every raw publication under 8 humans

- **Where:** `SnapshotCodec.ts` `selectMetadata` (02 N3/N4).
- **Confidence:** CONFIRMED (measured, `metadataBytes` from decode stats).
- **Measured:** 384–416 KB of 519–601 KB raw.
- **Consequence:** this compresses well, so it is not the bandwidth driver. It is a large share of decode and JSON-parse work and of the clone in Issue 6.

## Recommendations (prioritised)

1. **Fix Issue 1 now. Effort: S, a few hours.**
   - In `MovementAdmission.stepAdmissions` `routes` phase, look up the original leader once:

     ```ts
     const originalLeader = original && this.ports.squad(original.members[0].id);
     if (original && original !== admission && !corridor && originalLeader && this.ports.squad(leader.id)!.kind === originalLeader.kind)
     ```

     If the original is invalid, finish it as superseded, or clear `admission.corridorId` so the cohort plans its own spine.
   - Defence in depth: replace every `this.ports.squad(...)!` in `MovementAdmission.ts` with a checked lookup. Have `Skirmish.removeSquad` (`Simulation.ts:1227`) call `movementAdmission.cancel([id], tick)`, so no admission outlives its member. Today it only clears `movementClearance` and `playerAttacks`, unlike `cancelMovement` at `:1219-1226`. This is the same "stale cache across removal" class as the 2026-10-15 freeze.
   - Test: put `repro-corridor-crash.mts` in `tests/skirmish/MovementAdmissionCorridorLeaderDeath.test.ts`. Assert that `step()` does not throw, that the follower cohorts still commit, and that the receipt resolves to `executed` or `superseded`.
2. **Partition planner slots. Effort: M, 2–3 days.**
   - In `RoutePlanner.request`, add a per-player interactive cap of **16 jobs** and an aggregate interactive cap of **64**. That leaves 64 for background work, of which 16 are reserved for committed trade, replacing today's 120 and 104 thresholds.
   - Rationale: honest humans averaged 1 command per second, each 30-squad order needs 1 lead and about 3 cohort spines, and the 1-squad lead keeps first motion at 1 tick even under a 16-job cap.
   - Pair it with **one planner job per cohort**: the leader's exact path, with members taking short connectors from the local detour lattice, as entry and exit already do. This cuts human jobs per order from ≤30 to ≤4.
   - Expected: routing returns to the idle level of about 23–25 ms, saving 18–41 ms desktop (43–98 ms ARM). AI and trade get ≥48 slots back.
   - Test: an 8-human planner-starvation test asserting that background requests are accepted while 8 seats each hold 16 jobs.
3. **Make `stepAdmissions` linear. Effort: S, 1 day.**
   - Keep two insertion-ordered Maps (priority and background) and rotate within the chosen one, so selection is O(1).
   - Give each admission a `retryAt` back-off (2, 4, 8 ticks, capped at 16) after the planner refuses a request, so a refused request costs neither an iteration nor budget until it is due.
   - Expected: −10 to −16 ms per tick at the measured P (6–7 %), and planner refusals drop from about 171 per tick to under 20.
   - Test: an equivalence test of admission order on a fixed seed, plus a micro-benchmark with P = 500 under 1 ms per call.
4. **Per-seat input quotas. Effort: S.**
   - In `LiveMatch.admitCommand`, add a per-seat queue cap of **24** within the shared 100. The modelled honest maximum is 33–44 across all 8 seats at ARM speed.
   - Add a per-seat token bucket of **8 commands/s with burst 24**. 80 APM is 1.3/s; a 300 APM expert is 5/s.
   - In `CommandApplications`, add a per-player deferred-receipt cap of **64** (measured maximum 27 across all seats).
   - Move the 50 msg/s check before `JSON.parse` (02 N8).
   - Test: a LiveMatch test with one seat at 50/s showing other seats are never refused.
5. **Coalesce superseded human admissions. Effort: S.** When a new non-append order for the same squads arrives, cancel the in-flight planner keys immediately (`RoutePlanner.cancel`, `RoutePlanner.ts:503`) and free the slot this tick. Track a `supersededWork` diagnostic. Expected: 33–45 % fewer human jobs.
6. **Cap publications at 5 Hz, but publish commands immediately. Effort: S.**
   - Let a command-triggered publication replace the next scheduled background publication: reset `nextSnapshotAt` and `nextSnapshotSimulationMs` to 200 ms after it, so the combined rate is ≤ 5 Hz while orders still publish on their own tick.
   - Expected: −23 % publications. That is −95 KB/s per client on Mediterranean, −1.5 × 7 ms per second of capture, −1.5 × 12 ms per second of encoder work, and −70 ms per second of client CPU.
   - Also implement 02 #6 (encoder → coordinator `MessageChannel`). It removes the measured one-advance delay (208 ms mean, 472 ms p99) under saturation.
7. **Do not move interest management (02 #10) ahead of the CPU work.**
   - The binding constraint is simulation CPU (0.25× real time on ARM, EXTRAPOLATED), not egress. Egress of 21–27 Mbit/s for 8 clients is within a typical VPS allowance, and at the real simulation speed it is about 4× lower.
   - Do 02 #4 first (incremental presentation, so the main thread receives only changed rows; Issue 6), then 02 #5 (metadata revisions; Issue 9).
   - Revisit interest management only if Oracle egress is capped below 30 Mbit/s per match or a 1000×1000 map pushes gzip publications above 100 KB mean.
   - The Mediterranean p99 publication is already 114 KB; watch it.
8. **Add an 8-active-human load test to the qualification. Effort: M.**
   - Adopt `inproc.mts`, `inject.mts` and `worker.mts` as `tests/skirmish/perf/EightHumanLoad.ts`: fixed seed, Mediterranean and Migration, 60-squad human armies, scripted 40–80 APM.
   - Gate on: no exception; planner window-mean below 100; admissions pending below 150; move-outcome p95 under 16 ticks; tick mean within 1.15× of the idle-seat control.
   - The equivalence check (identical squad hashes in-process versus real worker) costs nothing to keep and guards determinism.

## Open questions

- Should a human selection of 11–30 squads really fan out into 1 + 3 admissions with per-member exact jobs? Cohort-level planning (recommendation 2) changes formation-slot connectors; the owner should confirm the visual contract.
- The idle-seat baseline (154 ms) is about 1.5× 06's all-AI probe at a similar squad count, because 480 stationary human squads are as expensive as moving ones (06 Issue 2). How many squads does the owner expect a human to field at minute 10–20? It decides whether idle-squad sleeping or planner partitioning comes first.
- The scripted humans issued no naval (`sail`) or army (`army-order`) commands, and no aircraft or missile orders (the start was Napoleonic). Ship admission and army planning share the same 128 slots, so a naval-heavy lobby may pin the planner harder than shown here.
- On ARM, is 0.25× real time acceptable as a playtest state, or does the owner want a hard admission cap (for example "8 humans only with ≤30 AI factions") until recommendations 2 and 3 land?
