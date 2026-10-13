# Plan to remove at least 20 ms from local late-game ticks

## Objective and evidence

Target the user's PC, local single-player, Migration 1000, 14 AI, tribes and
the captured approximately 530-squad / 270-ship workload. Sustain canonical
20 Hz movement and combat, with a worker mean toward 35–40 ms, rather than
merely reaching 50 ms once. Preserve responsive player orders and useful AI.

Source reviewed at `5b3064f5` (b1.5.1), with a clean checkout before this plan.
The earlier optimizations are now committed. No benchmark was rerun for this
review; the timing figures below are historical, not current-source certification.

The latest recorded normal rendered continuation achieved 0.8893x overall
(129.7 game seconds / 145.84 wall seconds). Its final rolling worker mean was
59.61 ms, p95 86.9 ms, p99 94.3 ms. Some AI exact requests waited over 1,200
ticks. A transient 43.6 ms window therefore did not qualify the game.
Older approximately 275-squad and early-game profiles are different workloads.

The attached review is directionally correct. However, prepared geometry,
candidate reuse, a free-movement avoidance bypass, local combat activity epochs,
shared formation spines, capture-contribution reuse and incremental neutral
territory discovery already exist. Reimplementing them would add maintenance
without establishing another gain. Root-only terrain checks, radial melee
damage and block-level ownership would change gameplay and are excluded.

## Savings budget: targets, not forecasts

### Trader publication contract added after payload inspection

The captured payload has approximately 3,857 trader-related objects even in a
delta publication. These actors currently resend their complete nested lists.
Add an optional versioned trader stream at the existing SnapshotCodec boundary:
transfer a full ordered numeric roster of id/x/y/waitTicks every publication,
and send immutable detail upserts only when any other field changes. Compare
list contents rather than borrowed references because trade mutates its lists.
Explicit removals retire detail entries. Baselines and metadata identity changes
reset the stream. Decoder staging validates the complete change before commit;
unknown detail ids, duplicate ids and missing baselines are errors. Legacy object
trader packets remain readable. Public decoded snapshots retain exactly the
same trader fields and ordering; trade routing, delivery and AI remain untouched.
Caches retain only the current roster, never historical actors. Test in-place
list mutation, removals, resets, mixed legacy/stream input, malformed deltas and
independently owned snapshots. Benchmark encode plus transfer plus decode, so
moving work between threads cannot masquerade as a saving.

The local replication source can borrow authoritative trader rows until the
synchronous encoder finishes. In that mode it omits the redundant full DTO
projection. The encoder projects public fields only when details change and
derives waitingForCargo exactly as the public snapshot does. Private route and
supply fields must never enter packets. Legacy encoding rejects a borrowed
source; ordinary public snapshots and network publication retain their existing
projection. Compare decoded local and legacy snapshots, including private field
mutation and cargo-wait transitions.

| Workstream | Additional whole-worker saving target | Confidence before fresh measurement |
| --- | ---: | --- |
| Movement: prove empty swept space before constructing detailed geometry | 10 ms | Medium direction; low numeric confidence |
| Combat: narrower candidate regions and acquisition invalidation | 6 ms | Medium direction; low numeric confidence |
| Routing: useful bounded planning without arena monopolization | 5 ms | High need; low numeric confidence |
| Publication: residual hot detail allocations | 1 ms | Low; existing protocol already removes much of this |
| Combined delivery budget | 22 ms | Must be measured together, never inferred by adding nested profiles |

The 22 ms budget leaves a small margin over the requested 20 ms. It is not a
promise that these opportunities contain 22 ms. If measurements disprove an
opportunity, stop that implementation and reallocate the budget. Garbage
collection improvement belongs to the measured workstream; do not count it
again as a separate saving. Main-thread decode/HUD savings cannot be credited
as worker-tick savings.

## 0. Establish one reproducible acceptance workload

Use the existing checkpoint builder and ordinary rendered replay page; no
second simulation or special simplified skirmish is needed. Archive the exact
source SHA, fixture hash, options and browser/build versions. Recreate the
530-squad starting checkpoint, then add an actively contested checkpoint and
a transport/fortification-heavy checkpoint so empty-space gains cannot conceal
regressions in the expensive cases.

Measure isolated repetitions, alternating control/candidate, with no concurrent
tests or other running matches. Keep worker simulation, encode, delivery,
decode/projection, renderer and HUD timings separate. Record mean, p95, p99,
max, missed tick deadlines, real-time progress and retained memory. Measure
both input-to-admission and admission-to-physical-movement latency.

Add counters that answer specific decisions: enemy/obstacle-free movement
fraction; swept candidates and detailed hulls per pose; cells/rows inspected by
spatial queries; acquisition cache misses and invalidation causes; routing
search versus preparation/copy/reclamation work; queue age, arena ownership,
exclusive waiting, terminal outcomes and successful trade deliveries.
Measure instrumentation overhead separately. These counters observe canonical
work; they must not determine it from wall time.

## 1. Repair useful bounded routing before claiming throughput

Owners: `RoutePlanner`, `PlanningWorkspace`, `HierarchicalPaths`, admission and
trade owners, integrated through `Simulation`.

The current workspace is shared, and an exclusive retry can reserve it while
other requests wait. Simply expiring jobs after 40 ticks freed queues but
increased limited trade results and actual movement work. Simply enabling
hierarchical corridors for all AI admissions also reduced useful completions.
Neither experiment established a solution.

First trace whether lost throughput comes from exclusivity, preparation,
reclamation, infeasible requests or repeated owner retries. Then replace
match-wide monopolization with explicit bounded workspace reservations and
fair progress within the existing planner. Player capacity remains reserved;
background domains cannot consume it. Node, preparation and retained-memory
allowances are explicit and deterministic. Search and cleanup must both remain
resumable. Do not instantiate an unbounded arena per request or double the
global work budget to mask contention.

The two-second limit applies to an autonomous logical planning attempt,
including queue wait and preparatory/connector stages. Carry its original
deadline through replacements and retries; a fresh exact-job timestamp must
not extend it indefinitely. Expiry returns a capacity-limited outcome, never
geographic impossibility. Domain owners retain active valid orders and choose
a bounded retry or another objective. Document this transition before edits.

Qualified routing means useful completions and trade deliveries are maintained,
player latency does not regress and autonomous attempts terminate by 40 game
ticks. Distinguish reclamation age from live planning age. Reject faster ticks
obtained by leaving units idle or repeatedly abandoning their routes. Expect
better AI throughput to increase downstream movement/combat load; measure that
real workload rather than subtracting routing costs in isolation.

## 2. Make exact movement conditional on a spatial proof

Owners: existing `SpatialGrid` / `PhaseSpatialViews`, fortification occupancy,
`CombatGeometry`, `LocalAvoidance`, `Simulation.formationMoveClear`.

Introduce conservative occupancy summaries at the existing spatial ownership
boundary. A query can return a proof of absence or possible occupancy. Summary
cells are an acceleration structure, never movement or territory authority.
Do not add another transit/tactical locomotion state machine.

Current `queryOverlaps` expands every query by the largest extent anywhere in
the grid. Replace that global inflation with a conservative extent-aware query
strategy, such as occupied bounds per bucket with correct traversal bounds.
Preserve the original candidate and tie order. Cross-bucket bodies, movement
between phases, casualties, boarding and restore must stay visible immediately.

For a movement proposal, compute a cheap bound enclosing the complete current,
next and transition-completion sweep, including rounding skin and column rows.
If it is in bounds, the existing root/transport/permission rules pass, no blocked
terrain or applicable fortification can intersect it, and no hostile body can
intersect it, detailed hull construction and polygon overlap are unnecessary.
Any uncertainty uses the existing exact path. A mixed cell is always uncertain.
False positives cost performance; false negatives are correctness failures.

Retain friendly advisory steering and its result, velocity/crossing guards,
cavalry penetration, imported-overlap escape, charge behavior and shoreline
transitions. A proof does not authorize skipping those state transitions.
Initially shadow-check every successful proof against the exact implementation
in tests and diagnostic replay. Test boundaries, bent columns, reform completion,
long bodies crossing cells, walls/gates, diplomacy changes and hostile arrivals.
Exact canonical replay equality is required for this pass.

Only proceed to lower-allocation exact kernels for contested space if the new
profile shows sufficient remaining cost. Earlier sorted sweep merging and
blocked-reform caches failed whole-game qualification; do not revive them
without a new workload-specific reason.

## 3. Reuse the same spatial facts in combat

Owners: `CombatActivity`, `Battle`, `UnitIndex`, `CombatGeometry`.

Reuse the extent-aware index and absence proofs from movement. Existing combat
acquisition already caches local activity epochs; first identify why those
caches miss. Moving friendly bodies can dirty a region even when its hostile
candidate set is unchanged. Refine invalidation by actual consumer dependencies
and relevant factions, while checking the attacker's own pose, profile and
order facts independently. Changes to hostility, cover, barriers, target
capacity/casualties and cavalry exposure must invalidate their consumers.

An empty candidate region skips target geometry/LOS work only. Weapon clocks,
reloads, projectiles, cavalry waves and required combat-state clearing still
advance at 20 Hz. In contested regions retain exact contact participants,
frontage, deterministic target ties, line of sight and simultaneous damage.
Target ranges and body extents determine coverage; no fixed-size war-zone
radius or camera visibility is sufficient. Keep projectile collision as its
existing independent authority.

Avoid another overlapping contact cache. Narrow invalidation and reuse the
existing prepared owner. Require canonical equality and restored-continuation
equality, including moving targets, long-range shots and diplomacy transitions.

## 4. Small finishing work; territory only if newly justified

Profile the existing compact local snapshot stream and nested-detail reuse.
Remove only measured residual hot allocations, preserving transactional decode,
clear/removal semantics, bounded dictionaries, full reset and recovery. Do not
skip publication indiscriminately or count decoder CPU as simulation savings.

Capture is a secondary reserve opportunity, not the foundation of the 20 ms
plan. It already retains tile-pressure contributions; neutral territory already
has dirty regions and resumable discovery. If the fresh capture profile warrants
it, optimize repeated resisted-capture checks and scratch/frontier handling
under exact tile ownership and connectivity. No macro-cell ownership or border
smoothing substitution. Do not attribute the whole capture phase to neutral BFS.

## Delivery and rejection gates

### Continued bounded scheduling contract (13 October)

Test a local-only 30-tick autonomous squad-decision cadence (at most 1.5 game
seconds), with immediate player admission and the same 20 Hz movement, combat,
reloads and projectile updates. Skip faction-wide frontier/raid preparation
when no decision or existing river/development timer is due. Preserve existing
15-tick replay timing when the option is absent. This intentionally changes AI
decision timing; qualify useful activity, deliveries, player latency and restore
determinism, rather than requiring the old schedule's canonical hash.

The 40-tick logical deadline spans land queued setup, ship replacements and
committed activation, military cohort preparation/connectors, and trader
candidate/retry preparation. Expiry is checked even with zero work allowance.
Ship committed activation returns a terminal capacity receipt and preserves
paused voyage intent with no live searches; replacement/cancel releases it.
Autonomous committed ships start a new attempt after the existing 100-tick
idle interval. The prior attempt has already returned its terminal capacity
receipt; the new attempt receives a new admission identity and its own 40-tick
deadline. Independent AI squads reconsider a capacity-paused queued leg on
their next bounded decision. These retries must not accumulate live attempts.
Trade retires its attempt and waits the existing 100-tick idle interval without
losing cargo or adding a geographic market-failure record. Land capacity results
must not enter HomeTerritory's geographic-failure cache. Restored legacy attempts
without a saved deadline receive one allowance when the policy is enabled.

Keep these policies off by default until throughput and local-browser evidence
support enabling them. An idle AI world is not a performance qualification.

Under the bounded routing policy, long autonomous requests (at least 128 cells
root-to-goal distance) may use the existing hierarchical planner, including
amphibious topology. Short requests keep exact A*. Warm all three static graph
owners sequentially under one existing eight-tree-per-tick allowance. The
existing 32-unit preparation ceiling can serve background work only when no
live interactive request is waiting; otherwise its previous 24/8 reservation
applies. The global exact-work allowance and arena capacity do not increase.
This specifically targets long searches that cannot finish before the logical
deadline, rather than enabling the earlier failed all-AI corridor experiment.

Implement one workstream at a time after its contract and baseline. Checkpoint
compatibility, invalidation and memory bounds are part of each change. Pure
execution optimizations must match canonical outcomes. Routing schedule changes
may intentionally change future outcomes; test deterministic restore separately
and compare useful planning/delivery/AI activity metrics instead of requiring
the old scheduler's final hash.

Run focused correctness tests, affected integration tests, current TypeScript,
build and final full gates. Keep unrelated recruitment, targeting and art work
untouched. Archive rejected experiments and remove their runtime complexity.

Final acceptance: repeated rendered 1x runs from all three checkpoints, including
at least a 30-minute wall-time continuation of the dense case; repeat in Opera,
where the user reported the freeze. Require no stopped clock, lost orders,
snapshot failure or growing retained queues/memory. Demonstrate mean worker
headroom toward 35–40 ms, report tails and deadline misses, and verify 40-tick
autonomous planning and player movement latency together. A short average,
headless result or faster stationary world is insufficient.

If these stages cannot deliver 20 ms, report the residual hot path and measured
limit. Any reduction to combat/movement frequency, accurate contact rules,
territory authority or the supported population is a separate user decision,
not an implicit optimization fallback.
