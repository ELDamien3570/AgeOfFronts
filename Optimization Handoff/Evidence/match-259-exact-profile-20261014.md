# Match-259: exact live CPU profile and captured-state continuation

## Conclusion

The slowdown is authoritative simulation work. There are concrete inefficiencies worth fixing before a clock-rate change: repeated route scheduling classification, admission retries against bounded capacity, and repeated formation/movement geometry work. No single sampled function explains the whole gap. A 10 Hz simulation is a plausible architectural option, but its performance and gameplay have not been qualified here. Target: at least 0.85x sustained authoritative game speed on the existing two-core ARM host in comparable games.

No production game code or frequency was changed. Temporary inspector access was container-local, unpublished, and closed after capture. The coordinator remained healthy with restart count zero.

## Evidence and scope

- Production source: `7e4ff0e0af75799c75a212557a99e7d0c7b1d1ce`, Node 24.18.0.
- Three live V8 CPU profiles: coordinator, authoritative worker, snapshot encoder. Sampling interval 2 ms, 20-second nominal window, starting 18:14:06 UTC. No breakpoints or debugger pauses were used. Sampling adds overhead; do not use its durations as normal throughput measurements.
- After explicit owner approval, exported a lossless checkpoint and static map between completed ticks at tick 51,514. Export reads the existing instance and invokes its existing checkpoint method; it does not issue orders or change gameplay. Inspector object queries and copying can produce a brief diagnostic stall; capture intervals are excluded from normal timing conclusions.
- Captured world: Mediterranean 1000 x 500; 400 squads, 74 ships, 861 buildings, 516 traders. Configured 14 AI and 30 tribes; live faction records include 21 regular factions and 25 tribes after promotions. Two human names appear in options; three socket connections are not proof of three distinct human factions.
- Captured activity: 166 attack orders, 100 move orders, 132 hold orders, 2 replenish orders; 89 fighting squads, 98 with positive locomotion speed, 57 formation transitions. 379 mass, 12 line, 7 modern-loose, 2 column formations. Starting age is Napoleonic; factions have progressed during the match. This capture is later than the initial roughly 570–600-squad half-speed interval. It cannot reproduce that earlier lost state exactly.
- Checkpoint is about 27.1 MB; map about 3.5 MB. Both remain ignored local evidence under `out/match-259-profile-20261014/aof-match-259-live-profile/`.
- Local replay: restore captured map and checkpoint, warm up 120 ticks, measure 600 further ticks. No future human commands, network delivery, renderer, or server encoder are included. This is exact saved-state continuation, not a synthetic reconstruction, but not a recording of subsequent human play.

Method: Node's inspector CPU profiler and worker protocol, with `waitForDebuggerOnStart: false`. References: [Node inspector documentation](https://nodejs.org/api/inspector.html), [Node 24.18 worker inspector protocol](https://raw.githubusercontent.com/nodejs/node/v24.18.0/src/inspector/domain_node_worker.pdl).

## Live ARM function attribution

Authoritative profile contains 8,984 samples representing 20.411 seconds. Durations below are sampled inclusive stack time, not independently timed exclusive phases. Nested rows must not be added together.

| Function/subsystem | Sampled inclusive seconds | Share of sampled wall time |
| --- | ---: | ---: |
| `drainRouteBatch` | 5.037 | 24.7% |
| `RoutePlanner.step` (inside route batch) | 4.341 | 21.3% |
| `RoutePlanner.selectJob` (inside planner) | 1.194 | 5.8% |
| `LocalAvoidance.step` | 2.336 | 11.4% |
| `formationMoveClear` (inside movement clearance/avoidance) | 1.341 | 6.6% |
| `navigation` | 1.158 | 5.7% |
| `advanceFormationStates` | 1.106 | 5.4% |
| `Skirmish.fight` | 1.425 | 7.0% |
| `Expansion.afterMovement` | 0.797 | 3.9% |
| V8 garbage collection | 1.612 | 7.9% |

Individual self-time also identifies graph expansion (`advanceLocal`, `neighbors`, `PlanningPath.step`), formation hull construction (`convexHull`), geometry cache identity (`geometryKey`), and soldier slot assignment (`minimumTravelAssignment`). These are targets for further implementation-specific measurements, not proof they can all be eliminated. The profile's transformed TypeScript line numbers are mostly line 1; function identity is usable, precise original line attribution is not established.

Snapshot encoder profile is predominantly idle; coordinator/socket diagnostics show no persistent send-buffer backlog. Earlier browser samples showed roughly 95–99 FPS, zero pending states and zero resync recoveries. Those browser figures belong to the earlier observed window; later console retrieval returned no samples and does not establish current FPS for every player.

## Exact replay operation counts

Across the same 600-tick continuation:

| Operation | Calls per tick |
| --- | ---: |
| Planner priority predicate | 9,416 |
| Planner committed-work predicate | 3,763 |
| Planner selection | 84.09 |
| Planner cohort lookup | 1,599.7 |
| Routing obstacle revision | 1,806.4 |
| Formation envelope lookup | 3,596.8 |
| Movement transport/clearance entry | 202.6 |
| Exact formation movement clearance | 194.5 |

Counts alone do not mean every lookup is expensive or every geometry lookup misses its cache. The live CPU sample confirms which related stacks consume time. Movement and battle share the same geometry owner; envelope counts describe that shared object once. The first timed trace wrapped some shared geometry methods twice, so use its counts and canonical agreement, not its inclusive wrapper durations as exclusive costs.

Admission demand probe records 50,507 calls to `RoutePlanner.request`, of which 683 are accepted and 49,824 rejected (98.65%). The request's false-return paths are capacity/reservation backpressure checks. These are attempts, including repeated waiting work, not 50,507 fresh player/AI decisions.

| Caller | Attempts | Accepted | Rejected |
| --- | ---: | ---: | ---: |
| Land admission | 38,862 | 244 | 38,618 |
| Ship admission | 7,999 | 89 | 7,910 |
| Trade | 2,851 | 295 | 2,556 |
| Navigation | 754 | 53 | 701 |
| Army | 40 | 1 | 39 |
| Strategy | 1 | 1 | 0 |

This supports explicit capacity/backpressure signals to waiting producers, retaining pending intentions and revisiting them when capacity/class eligibility changes. It does not justify dropping requests, treating capacity as unreachable, or enlarging the search budget indiscriminately. Admission retry removal alone is not shown to close the gap; `request` is not the largest sampled stack.

Uninstrumented local simulation mean is 39.31 ms, p95 58.73 ms. Timed trace, count trace and demand probe produce the identical final checkpoint hash as baseline:

`b2780cd2391ecc20862778623632552d19aec71073d684045de6f031ed7e4b0a`

These are local CPU measurements. They are not ARM speed claims, and the diagnostic modes are not paired performance candidates.

## Normal live speed after profiling

With the inspector closed and without an offline benchmark on the host, later live intervals measured:

| UTC interval | Ticks advanced | Wall seconds | Pace |
| --- | ---: | ---: | ---: |
| 18:24:47–18:25:32 | 600 | 44.892 | 0.668x |
| 18:25:32–18:26:13 | 600 | 41.722 | 0.719x |
| 18:26:13–18:26:56 | 600 | 42.813 | 0.701x |
| 18:26:56–18:27:44 | 600 | 48.152 | 0.623x |

The world evolved to roughly 378 squads, 78 ships, 904 buildings and 546 traders. This variation is not an optimization gain. At tick 56,409 mean tick = 75.41 ms, routing = 24.57, movement = 21.93, combat = 14.69, AI = 7.50. Planner pending = 105, work = 4096; earlier oldest pending age reached 3,720 ticks (186 simulated seconds). Pending age is not necessarily a human order's latency.

Earlier intervals in the same game ran 0.53–0.60x with larger armies and movement-dominated cost; see `out/match-259-profile-20261014/findings.md`. Both activity profiles matter for qualification.

## Recommended implementation order

1. Route scheduling: reduce repeated classification/scanning per quantum; preserve priority, committed cargo, player/caller rotation and checkpointed scheduler state. Cache only under explicit invalidation boundaries because completion callbacks can change eligibility during a tick. Measure selection cost separately from graph work.
2. Admission backpressure: avoid repeatedly attempting known-capacity-blocked admissions while retaining intentions and reacting to freed capacity/priority changes. Do not delay newly interactive commands behind a polling cadence.
3. Formation geometry and allocations: measure cache misses and preparation per distinct pose; reduce redundant preparation and allocation without weakening swept collision, transition clearance or contact correctness. Count high envelope lookup volume separately from actual recomputation.
4. Compare those behavior-preserving improvements at 20 Hz before integrating a 10 Hz candidate. Targeted CPU wins, backlog reduction and lower garbage allocation should remain useful at either rate.

## 10 Hz assessment

At 20 Hz, 0.85x requires end-to-end average wall time per step no greater than 58.82 ms. At 10 Hz, it requires no greater than 117.65 ms per 100-ms step. The earlier 0.55x stretch needs about 35% less cost to reach 0.85x at 20 Hz. Later 0.623x needs about 27% less. A mean criterion alone does not certify smooth frame pacing or order response.

Fewer movement/contact/formation evaluations per simulated second can provide legitimate savings if those sampling intervals are acceptable gameplay. However, a 100-ms step travels farther and needs correct larger swept checks; maintaining routing work per simulated second can require twice the work per step. Two full 50-ms movement/combat substeps recover much of the existing cost. No measured 10 Hz speed claim is available from this investigation.

Recommended split if pursuing 10 Hz:

- One authoritative movement/collision/combat update cadence for all factions.
- Input reception and receipts serviced promptly outside expensive simulation steps; selected cheap validation/preparation can run at 20 Hz. Authoritative command application remains ordered against simulation boundaries.
- Client selection, order feedback, camera and interpolated presentation run at rendering cadence.
- Economy/strategic AI/diplomacy need explicit schedules or due-event processing. Preserve rates, deadlines and useful behavior; do not silently skip turns or make trade retries mean failure.
- Only specific timing-sensitive events use finer subdivisions if evidence requires them. Avoid full alternate 20 Hz player physics: players and AI interact through the same contacts and targets, and separate physics rates create authority/order/fairness complications.

### Clock migration requirements

A global `TICKS_PER_SECOND = 10` edit is insufficient. Source inspection found explicit `*20` in projectile predictive aiming (`Battle.ts`) and formation reorientation duration (`FormationGeometry.ts`), alongside per-tick speed, inverse-frequency-squared acceleration/braking, `tick+1` swept transition geometry, countdown decrements, modulo schedules, retention periods and persisted tick timestamps.

Keep an explicit integer simulation clock, with a versioned relationship between clock units and update cadence. Tick-based deadlines are fine, but their physical duration must remain defined independently of the selected subsystem frequency. Convert player-facing seconds at boundaries. Do not reinterpret old saves/replays by changing one global constant.

Audit movement distance, acceleration/braking/turning, route budgets per simulated second, projectile flight and hit timing, reloads/DPS, formation transitions, recruitment/construction/research, production/trade, strategic AI periods, diplomacy deadlines, command ordering, interpolation, snapshots and checkpoint/replay compatibility. A 10 Hz candidate has a separate gameplay contract; its canonical hashes need not match 20 Hz, but determinism within its own clock contract must.

## Qualification contract to agree before implementation

- ARM throughput: at least 0.85x across sustained representative windows, not a short average or a local-PC extrapolation. Aim for 1x internally to leave headroom.
- Fixtures: this exact live capture, plus a movement/combat-heavy scenario matching the earlier approximately 600-squad portion of this game. The later capture alone does not cover the earlier worst movement load.
- Repeatable comparison: alternate baseline/candidate runs; separate CPU sampling/tracing from throughput runs; no competing benchmark on the production VM while people play.
- Continue long enough to observe planner queues and allocation behavior, preferably at least ten simulated minutes. Confirm queues clear or remain bounded in latency rather than merely bounded in count.
- Multiplayer: three connected clients, representative new orders, receipt-to-application/publication latency, update jitter, reconnect behavior, client state agreement, rendered movement at the claimed pace.
- Gameplay correctness: same-rate optimizations preserve canonical continuation hashes; clock changes additionally compare distance/time, combat outcomes/DPS, reload/production/research duration, collisions, transitions and deterministic replay.

The 0.85x target is not yet achieved or proven. This task established the exact capture and attribution needed to choose and validate the next implementation.

## Reproduction artifacts

Root: `out/match-259-profile-20261014/` (ignored). `attach-profile.mjs` and `query-function-test.mjs` document capture tooling; do not rerun production capture without checking current state/authorization. `replay-profile.ts` accepts `baseline`, `trace`, `counts`, or `demand`, followed by measured tick count. `analyze-cpu.cjs`, `checkpoint-summary.cjs` and `summarize.cjs` generate compact evidence summaries. Baseline/counts/trace/demand result JSON files and final checkpoints are retained. Normal live logs, CPU profiles, capture approval execution log and `approved-capture-verification.log` are retained.
