# Late-game performance investigation — 12 October 2026

## Decision

Target local single-player on the user's PC, confirmed in this chat. Keep current gameplay and the fixed simulation frequency. Start with genuinely bounded routing and exact movement candidate reuse. Assess local replication and projection alongside those changes. Do not start by changing terrain permissions, collision accuracy, combat frequency, squad caps, or camera-dependent simulation.

The supplied recommendation is directionally sound. However, shared physical-body caches and selective spatial revisions already exist; extending their reuse is more appropriate than adding another overlapping cache. The 50 ms target is plausible as an optimization objective, but this investigation does not establish that the necessary improvement is feasible or that any proposed saving has been achieved.

No game source was changed. Added a diagnostic harness and this report. Generated evidence is under `out/performance-investigation-20261012/`.

## Current measurements and provenance

Source HEAD: `ab9c8f553b22478e8e6f24bdd3af1806598d8455`. Working tree was clean at the beginning. Runtime: Node v24.18.0 on Windows, AMD Ryzen 7 3700X, 16 logical processors, approximately 47.9 GiB system memory. These are headless Node measurements on the local PC, not browser acceptance.

The older Migration 1000, seed 504565698 checkpoint has 282 squads at tick 6000. Current restore rejects it: mission `land-army:22:3` has cursor 7 and a six-entry roster. The original artifact was left intact; no validators were bypassed and no saved mission state was edited. This prevents an exact current-code replay of the supplied capture. It does not by itself establish whether an older producer or a current producer created the invalid cursor.

Instead, regenerated the same map/seed and ran current code to tick 6000 with the saved options. The new checkpoint successfully restored. Measured ticks 6021–6220 after 20 warm-up ticks, with approximately 275 squads and 110–111 ships. Encoded every measured tick, matching normal local worker publication frequency.

| Run | Simulation mean | Extraction + encode mean | Combined mean | Combined p95 | Combined p99 | Maximum | Ticks >50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Uninterrupted fresh match, no method instrumentation | 58.81 | 4.64 | 63.45 | 76.67 | 87.39 | 154.20 | 194/200 |
| Restored continuation, method instrumentation | 50.82 | 3.87 | 54.69 | 70.88 | 81.07 | 114.06 | 135/200 |
| Restored continuation, CPU sampling | 55.17 | 3.96 | 59.13 | 77.22 | 90.29 | 111.78 | 174/200 |
| Restored continuation, no method instrumentation | 50.00 | 3.74 | 53.74 | 71.35 | 87.68 | 129.60 | 122/200 |

All times are milliseconds. Runs execute the same regenerated tick interval. No optimization occurred between them. Their different heap histories, cache warmth, JIT behavior and instrumentation prevent interpreting the differences as gains; this investigation did not isolate the contribution of each factor. Restored runs additionally rebuild derived hierarchy state, visible in their setup phase. Each measured interval is only ten simulated seconds.

The harness's `encoding` timer includes `replicationSource()` and `replicationFacts()` evaluation as well as `SnapshotEncoder.encode()`. Its original generic limitations string says checkpoint continuation even for `plain fresh`; the first row actually measures an uninterrupted fresh match. Phase names are broad boundaries: for example, combat also includes formation advancement and other after-movement work; routing includes army coordination and column-travel work.

Browser transfer, decoder validation/projection, rendering, HUD, command latency, and GPU work were not measured. Hosted costs are outside this user's primary target.

Reproduction, from the repository root:

```powershell
node node_modules/tsx/dist/cli.mjs tmp/performance-investigation-20261012.ts plain fresh
node node_modules/tsx/dist/cli.mjs tmp/performance-investigation-20261012.ts instrument checkpoint out/performance-investigation-20261012/fresh-checkpoint.v8
node node_modules/tsx/dist/cli.mjs tmp/performance-investigation-20261012.ts cpu checkpoint out/performance-investigation-20261012/fresh-checkpoint.v8
node node_modules/tsx/dist/cli.mjs tmp/performance-investigation-20261012.ts repeat checkpoint out/performance-investigation-20261012/fresh-checkpoint.v8
```

The original checkpoint supplies the seed, options, and target tick for fresh generation. Preserve evidence in a separately named output directory before repeating these commands: the harness overwrites its named outputs.

## 1. Bound routing work before pursuing the average alone

[RoutePlanner.step](../../src/skirmish/RoutePlanner.ts) calls `paths.hierarchical()` synchronously, then charges its work after return. The reserve gates admission to the call; it does not cap its duration. [HierarchicalPaths.find](../../src/skirmish/HierarchicalPaths.ts) synchronously builds the start tree, searches the abstract graph and refines the path. [Pathfinding.hierarchical](../../src/skirmish/Pathfinding.ts) then validates the complete route synchronously.

The instrumented run caught a water corridor at tick 6042, start tile 421920 to goal 604998, taking **54.36 ms**. Another water corridor at tick 6202 took **35.56 ms**. This supports the architectural concern. It does not identify the precise request behind the other chat's 148 ms spike, nor establish whether these queries were representative of fully warm long-session routing.

Implement deterministic continuations for start-tree preparation, any missing crossing-tree preparation, abstract search, refinement, obstacle validation and cleanup. Charge edge/neighbor visits and path copying as well as node expansion. Bound retained memory and outstanding work. Shared heap/search arrays currently belong to synchronous queries: simply inserting yield points would allow another request to overwrite them. Continuation ownership must be explicit, using bounded arenas or another documented reservation scheme.

Keep cache-hit work accounting independent of cache residence, player/caller fairness, cancellation, permission/cost revision revalidation, and superseded outcomes. Checkpoint continuations must resume deterministically. Human order admission and eventual path completion are separate latency contracts; define both before implementation. Existing one-tick corridor-completion tests will need a deliberate contract update, not deletion to conceal latency regressions.

Also audit active synchronous callers. For example, [Armies.resolveRoute](../../src/skirmish/domain/Armies.ts) performs synchronous `find()` calls, and [Simulation.drainRouteBatch](../../src/skirmish/Simulation.ts) has separate admission/route work. Some other `find()` calls are legacy fallbacks guarded by deferred planning. Classify them by production reachability before moving them into the scheduler. Fixing only the named corridor call would not prove that all routing work is bounded.

## 2. Extend exact movement preparation and candidate reuse

Instrumented inclusive timings:

| Method | Calls/tick | Inclusive ms/tick |
| --- | ---: | ---: |
| formationMoveClear | 246.06 | 10.20 |
| transportStepClear | 250.73 | 10.72 |
| certifyFormationPolygon | 278.98 | 0.89 |
| formationFits | 29.24 | 0.90 |
| navigation | 275.30 | 2.61 |
| advanceFormationStates | 1 | 2.01 |

Nested timings overlap and cannot be added. Clearance time is an opportunity ceiling, not a predicted saving.

[FormationContact](../../src/skirmish/domain/FormationContact.ts) already retains current and candidate body facts, local hulls, and pair contacts. [CombatGeometry](../../src/skirmish/domain/CombatGeometry.ts) already provides prepared bodies. [Simulation.formationMoveClear](../../src/skirmish/Simulation.ts) additionally has a column certificate path.

Extend that foundation with an operation-scoped movement preparation object that captures source pose, physical layout and transition time. Reuse exact source polygons across candidate endpoints, and build pure-translation sweeps with less allocation/sorting where equivalence can be demonstrated. Column preparation currently constructs the proposed trail before choosing the certificate branch; profile whether avoiding unnecessary trail construction helps. Reuse constant capsule offsets and scratch storage where safe.

Preserve column row unions through bends, moving reforms and transition completion, imported-overlap escape, cavalry penetration, shoreline/transport transitions, wall checks, and entry permissions. Do not replace a bent column with its enclosing convex hull: that fills empty interior and changes traversability. Arithmetic changes near collision boundaries must receive explicit equivalence testing.

CPU sampling supports investigating this path: `transportStepClear` was about 18.2% inclusive, `formationMoveClear` 16.9% inclusive, geometry-key work 4.1% self, and hull construction 3.5% self. These figures overlap and include sampling effects. Sampler line numbers reflect transpilation, so use source symbols rather than the summary's line-1 locations for navigation.

## 3. Treat local replication and presentation as a pipeline

[worker.publish](../../src/skirmish/worker.ts) extracts and encodes each normal tick, then transfers numeric buffers. [SnapshotCodec](../../src/skirmish/SnapshotCodec.ts) already selects changed entities, removals and metadata revisions. This is not a full-world wire snapshot every tick.

Nevertheless, an average of **275.3 squad rows** were encoded per tick: virtually the whole active squad population. [SnapshotDetails.packSnapshotDetails](../../src/skirmish/SnapshotDetails.ts) JSON-serializes formation, manpower, weapon and combat details for each selected squad. Changes to hot scalar fields therefore carry unrelated nested details again.

Design explicit motion, layout/manpower and combat-detail revisions based on real mutation frequency. Start by measuring how many detail containers actually remain unchanged: formation trails and combat facts can change frequently and should not be assumed cold. Retain packet-local string interning and introduce encoder-owned, bounded serialized-detail reuse only with correct invalidation. A delta protocol additionally needs explicit absent-versus-cleared semantics, removal/ID reuse handling, full resets, version compatibility and recovery guarantees. Never use stable squad object identity as the revision: the owner mutates scalar records in place.

For local single-player, [main.ts](../../src/skirmish/client/main.ts) calls `decoder.decode(message.packet)` with default `copyArrays=true`. The [decoder](../../src/skirmish/SnapshotCodec.ts) then copies owners, claims and progress, plus retained squads/ships/buildings and expansion metadata. A 1000×1000 map produces three million tile bytes of copies each update, approximately 60 MB/s at 20 updates/s before other allocations. This is allocation volume, not a measured timing claim.

Measure decode validation, projection, transfer, renderer update, render frame and HUD separately in the real browser. Consider coherent retained presentation/projection with bounded latest-state publication, using the existing online canonical/projection design as a reference. Preserve dirty-cell unions, ordering, interpolation samples and ownership. Merely setting `copyArrays=false` is not an approved fix: audit consumers first so a later decode cannot mutate a supposedly historical render sample. Keep canonical simulation independent of camera visibility; visual work can still be culled.

## 4. Refine invalidation where profiling justifies it

There were **1,153.3 index changes/tick**, costing **1.48 ms/tick directly**. This is not 1,153 full spatial rebuilds. [UnitIndex.changed](../../src/skirmish/UnitIndex.ts) already checks physical inputs and only advances `spatialRevision` when relevant facts change. [movementLand](../../src/skirmish/Simulation.ts) and [PhaseSpatialViews](../../src/skirmish/PhaseSpatialViews.ts) already use distinct revision-based reuse.

CPU sampling attributes approximately 5.4% inclusive to spatial rebuilds, including their insertion/nested work, and shows geometry-key work separately. Trace which formation/container replacements force key recomputation or view rebuilding. Consider explicit change domains and atomic commits for one logically simultaneous mutation. Do not defer all writes to the end of the tick: routing, movement, boarding, casualties and combat have intermediate consumers that require current facts. Retain these phase boundaries.

## 5. Reprofile combat and capture after the foundations

The uninstrumented continuation averaged movement 20.44 ms, combat 9.90 ms, routing 6.72 ms, capture 4.38 ms, and extraction/encoding 3.74 ms. Capture still had a 29.86 ms phase maximum. The uninterrupted run's movement phase had a 95.81 ms spike, whose cause is not isolated.

Prepared combat geometry, contact caches, capture contributions and phase spatial views already exist. Next work should trace misses and repeated live queries, then improve actual consumers. Do not respond to the phase name with another general cache, reduced combat accuracy, or a lower canonical update frequency.

## Acceptance sequence

1. Establish paired current-source fixtures and deterministic state/checkpoint comparisons, including uninterrupted and restored runs. Keep the invalid old checkpoint as separate evidence; investigate its restore defect independently.
2. Record browser costs and order admission/start-of-motion latency before changing ownership or protocol semantics.
3. Implement bounded routing, then exact movement reuse, as separate reviewable passes. Measure each before stacking changes. Replication/projection can follow with its own ownership contract; reassess index work using remaining profiles.
4. Repeat several seeds, at least thousands of measured ticks, and relevant later-age cases on the actual local browser. Include dense fighting, columns/transport, mass human orders and ordinary long-session heap history. Do not extrapolate the approximately 275-squad case to a larger capacity target.
5. Aim for 35–40 ms mean worker simulation plus extraction/encoding as headroom, while tracking p95/p99 and over-budget frequency. A mean below 50 ms alone is insufficient: the observed tail and command stalls must improve. Browser frame responsiveness remains a separate acceptance metric.

The required saving is approximately 14–23 ms/tick to reach a 40 ms mean across the two uninstrumented runs. Nothing here demonstrates that the movement and serialization work alone can provide it. The order above targets both avoidable repeated work and the strongest confirmed latency hazard without changing game rules.
