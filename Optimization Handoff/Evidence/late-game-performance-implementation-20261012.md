# Late-game performance implementation — 12 October 2026

Implemented the first performance pass for local single-player on this PC. The final browser fixture averages **37.74 ms of CPU work** for simulation, encoding and snapshot projection, versus **44.07 ms** before. Rendering, HUD and message-transfer wall time are additional. This is a useful result at roughly 275 squads, not full-game or larger-capacity acceptance.

## Final browser results

Migration 1000, seed 504565698, 14 AI, tribes, ages-v1, tick-6000 restored checkpoint, 40 warmup ticks and 600 measured ticks (6041–6640), encoding every tick. Chromium 155 on Windows x64. Frozen source copies include the concurrent recruitment/fortification changes equally; only this task's optimizations are removed from the baseline.

| Cost / metric | Baseline | Final candidate |
| --- | ---: | ---: |
| Simulation mean | 31.88 ms | 31.01 ms |
| Encoding mean | 2.07 ms | 2.20 ms |
| Worker total mean | 33.95 ms | 33.20 ms |
| Worker total p95 | 42.10 ms | 40.80 ms |
| Worker total p99 | 65.10 ms | 43.90 ms |
| Worker total maximum | 173.10 ms | 86.60 ms |
| Worker ticks above 50 ms | 13/600 | 1/600 |
| Main-thread projection mean | 10.12 ms | 4.53 ms |
| Main-thread projection p95 | 12.60 ms | 5.60 ms |
| Main-thread projection p99 | 14.10 ms | 6.80 ms |
| Mean worker + projection CPU work | 44.07 ms | 37.74 ms |

Projection is approximately **55% faster**; summed mean CPU work is approximately **14% lower**. Browser worker mean improves approximately 2%. Browser encoding mean did not improve in this interval. Percentiles are measured separately and must not be added. Summed means describe CPU work, not wall-clock frame latency. End populations differ (275 versus 276) because route publication timing changes subsequent gameplay.

The browser diagnostic waits for an acknowledgement before advancing each tick. It verifies a real worker and transferred snapshot buffers, but excludes rendering/HUD work, real-time queue pressure, message-transfer wall time and user input latency. This task ran no tests or Node benchmarks alongside the final timings. Activity outside this task is uncontrolled. Earlier runs had substantially higher absolute timings, so neither these numbers nor any single percentage should be treated as a guaranteed gain under every PC load.

## Longer Node results

Final sources, same fixture, 1,000 measured ticks (6041–7040), Node v24.18.0. Baseline was remeasured after the cleanup refinement; the candidate includes both cleanup and scheduler fixes.

| Cost / metric | Baseline | Final candidate |
| --- | ---: | ---: |
| Simulation mean | 48.96 ms | 38.72 ms |
| Extraction/encoding mean | 3.59 ms | 2.65 ms |
| Worker total mean | 52.55 ms | 41.37 ms |
| Worker total p95 | 67.48 ms | 52.03 ms |
| Worker total p99 | 89.81 ms | 58.28 ms |
| Worker total maximum | 228.71 ms | 121.52 ms |
| Worker ticks above 50 ms | 553/1000 | 78/1000 |
| Routing maximum | 189.98 ms | 20.01 ms |

Candidate phase means: movement **16.65 ms**, combat **7.42 ms**, routing **5.09 ms**, capture **3.13 ms**. Movement and combat consume approximately 62% of simulation time. End populations differ (280 versus 283 squads, 107 versus 101 ships). These are scenario/elapsed-interval comparisons, not identical evolving workloads or isolated causal estimates for individual optimizations.

The longer run still has **52.03 ms worker p95** and occasional movement/capture stalls. Sustained sub-50 ms gameplay, including rendering and later ages, remains unproven. The next useful target is repeated movement/contact construction and combat geometry consumption within the existing caches. A 35–40 ms worker mean across the longer run remains an unmet goal; it averages 41.37 ms including encoding.

## Implementation

- **Movement:** clearance uses bodies from the existing CombatGeometry preparation cache. Column sweeps are constructed once per candidate and reused across enemy polygons. Capsule direction offsets and column layout are prepared once per local hull calculation. Bent columns retain individual row envelopes; reform, cavalry penetration and transport rules remain intact. Terrain permissions and exact collision geometry are unchanged.
- **Routing continuations:** start-tree construction, missing portal crossings, abstract graph edges, refinement, validation and cleanup yield under the existing scheduler and are checkpointable. They share the bounded match planning arena. Local preparation units cover at most 512 heap dequeues. Cached trees replay actual effort so cache residence cannot change deterministic scheduling. Autonomous preparation may spend eight units per tick; the total may spend 32, reserving the remainder for human work. Ordinary abstract/path work retains the 4,096-unit fair budget.
- **Routing cleanup:** reclamation retains its map iterator across quanta, avoiding repeated scans over a deleted prefix. The cursor is derived runtime state; checkpoint restore reconstructs it from the remaining owned nodes. Slot release order and canonical results are preserved.
- **Scheduler:** once a background preparation exhausts its tick allowance, it is excluded from selection for the rest of that tick. It remains queued and is eligible next tick. Human requests retain the existing priority/idle handling. This prevents repeated full queue scans between runnable quanta.
- **Hierarchy storage:** cluster row-start references eliminate repeated coordinate validation in local search, using approximately 128 KiB of additional derived storage per million-tile hierarchy.
- **Invalidation:** entity owners pass actual written fields to indexes. Presentation/order-only writes advance dynamic replication without recomputing physical facts or notifying landing occupancy. Position, layout, casualties, ownership, boarding and charge still invalidate physical consumers.
- **Replication:** encoder-owned reuse serializes unchanged nested fields independently. Replaced combat facts no longer force unchanged manpower, formation or weapon containers to be serialized again. Packet format and decoder validation remain unchanged. Reset, removal and identity reuse discard cached facts.
- **Local projection:** the local client uses the decoder's documented latest-state ownership mode. Interpolation captures scalar coordinates; territory layers own retained tile state. Ordinary decode remains available for independent snapshots. Online presentation behavior is unchanged.

No lower-frequency combat, camera-dependent canonical simulation, squad-cap change, new overlapping combat cache or simplified terrain rules were introduced. The synchronous hierarchy remains available to legacy callers; the profiled deferred match made no synchronous land/water find calls. This does not establish bounded wall time for every possible legacy mode.

## Why the first routing attempt was insufficient

The initial continuation implementation still reproduced a roughly 150–180 ms planner stall. Profiling showed individual corridor steps, exact-search slices and completion callbacks were small. Repeated scheduler selection was the remaining trap: budget-exhausted background jobs were selected again between runnable jobs, multiplying queue/cohort scans without consuming the recorded work budget. The final deferral change removes that amplification. The largest measured routing phase is now 20.01 ms in the 1,000-tick run.

Earlier candidate comparisons include both regressions and improvements and are retained as diagnostic artifacts, not final acceptance. For example, before the scheduler correction the combined Node worker mean was 58.30 ms versus 55.95 ms baseline. Cleanup alone left a roughly 151 ms routing stall. The final result should be judged using the tables above, not those intermediate versions.

## Verification and outstanding unrelated failures

- Production skirmish build passes after the final scheduler fix.
- Final focused routing, continuation, fairness, AI naval, navigation cleanup, structure attack, player/ship admission and spatial tests: **95 tests pass** (24 + 38 + 33). The new performance regression bounds selection overhead with 32 cold background corridors alongside runnable preparation/exact-search work, verifies progress/completion and checks cancellation reclamation. The same fixture makes **4,258 selections before the fix versus 255 after**, so the regression rejects the previous scheduler amplification.
- Earlier geometry, lifecycle and snapshot coverage passes another 34-test focused run, with overlap in spatial/admission tests.
- Before the final scheduler refinements, the full suite passed **2,223 tests** and failed the four-army demo's explicit 30-second timeout. An isolated candidate took approximately 34.6 seconds; the baseline scenario also exceeds the threshold (approximately 44.9 seconds) while completing its combat assertions. The timeout was not changed. The full suite is not entirely green and was not rerun in full after the final refinements.
- Holding the original scheduler constant, **all 100 per-tick canonical checkpoint hashes match** between baseline and movement/invalidation/encoding changes, including the concurrent domain edits captured in both sources. This does not claim identical gameplay with the new scheduler.
- Before background deferral, the cursor refinement produced a deeply equal final canonical checkpoint after 1,000 ticks compared with the preceding candidate. Iterators are derived state and do not enter checkpoints.
- Portable planner restoration, cold/warm work determinism, malformed ownership rejection, cancellation, late-obstacle cleanup and near-optimal/player-priority routing pass.
- Real-worker browser regression passes for held presentation, changed-back dirt and removals.
- Current combined TypeScript check reports three errors in the other chat's active work: invalid cavalry/archer TargetTag arguments at client/main.ts:1806 and undefined inside at Recruitment.test.ts:308. The concurrent recruitment suite has 12 passing and two failing tests (undefined inside; adjacent-water spawning). Those edits were preserved and not repaired by this optimization task.

Another chat is editing recruitment spawning and fortification targeting in this checkout. Those features share Simulation.ts and client/main.ts. Our narrow movement/index/decoder hooks were reapplied after whole-file replacement, preserving the other changes. Final benchmark source was frozen to avoid further live edits changing the comparison. The performance-owned files still match the final frozen candidate.

## Fixture and reproduction

The original supplied 282-squad checkpoint fails current restore validation. Measurements use a validated regenerated Migration 1000 checkpoint with 275 starting squads; the original was not altered. See late-game-performance-20261012.md for the original investigation.

The current gameplay checkpoint contains existing nonfinite naval target distances and AI operation scores that the portable StateCodec refuses to encode. The browser diagnostic therefore uses a benchmark-only lossless envelope for the original numbers, typed arrays, maps and sets, then runs normal domain restore validation. Production codec validation was not relaxed. This portable recovery defect remains outside the optimization patch.

Generated evidence lives under out/performance-investigation-20261012:

- fresh-checkpoint.v8 and fresh-browser-fixture.json
- combined-baseline/src and combined-candidate/src
- browser-final-results.json
- baseline-combined-cursor-paired-result.json and candidate-combined-scheduler-final-result.json, plus per-tick rows and final checkpoints
- callback/scheduler profiles and earlier intermediate results
- pre-cursor-RoutePlanner.ts, pre-cursor-HierarchicalPaths.ts and pre-defer-RoutePlanner.ts preserve earlier diagnostic versions

```powershell
node --import tsx scripts/measureLateGamePerformance.ts baseline-combined-repeat 1000
node --import tsx scripts/measureLateGamePerformance.ts candidate-combined-repeat 1000
node --import tsx scripts/exportLateGamePerformanceFixture.ts
node node_modules/vite/bin/vite.js --config vite.skirmish.config.ts
```

Open /tests/skirmish/browser/LateGamePerformance.html?combined&baseline, run it, then use ?combined for the frozen candidate. Without combined, the fixture uses the earlier baseline or live candidate. Preserve named output artifacts before repeating. Source copies/checkpoints are generated evidence, not committed assets. No changes were committed, pushed or deployed.
