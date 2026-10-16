# 19 — Movement and pathing core: hierarchy, formations, cohort admission, and how big the route caches really are

Round-2 reviewer. **Read only.** The only file written in the repository is this one. Every probe ran from the scratchpad (`scratchpad/movement-core/*.mts`) and imported project modules by absolute path. Prototype wrappers existed only inside those scratch processes.

The working tree was reviewed as it stood on 2026-10-16 between 01:00 and 03:00. Line numbers are current and were checked with `grep -n` or `sed -n`.

During the review someone was editing `src/skirmish/content/Units.ts`, and new imports started throwing `Missing unlock earlymodern-carrier` from `Catalog.ts:65`. Because of that, the I1 repro (`mixedsel-head.mts`) ran on a `git archive HEAD` export instead. I diffed it first: `Simulation.ts` has the same deferred/army/findGroup branches at HEAD (lines 1467 and 1533 there), and `Pathfinding.ts`, `HierarchicalPaths.ts` and `Armies.ts` have no working-tree diff.

**Timing caveat.** The whole-match probes ran 3 to 5 at a time on the Ryzen 3700X, and other reviewers' probes were probably running too. Absolute tick times in my runs are about 3× round 1's (~300 ms mean at S≈1000), so read absolute milliseconds as inflated. Trust the counts, the shares of tick, the memory figures and the single-process microbenchmarks.

## Scope read

| File | Lines |
| --- | --- |
| `src/skirmish/HierarchicalPaths.ts` | 1–1232 (all) |
| `src/skirmish/Formations.ts` | 1–161 (all) |
| `src/skirmish/FormationLine.ts` | 1–154 (all) |
| `src/skirmish/FormationMovementProfile.ts` | 1–37 (all) |
| `src/skirmish/NavalLocalRoute.ts` | 1–78 (all) |
| `src/skirmish/BuildingFootprint.ts` | 1–113 (all) |
| `src/skirmish/domain/FormationGeometry.ts` | 1–728 (all; working-tree diff vs HEAD is the `shapeOf` charge-wedge removal at 175–180) |
| `src/skirmish/domain/FormationProfiles.ts` | 1–148 (all) |
| `src/skirmish/domain/FormationSlotAssignment.ts` | 1–63 (all); `client/FormationSlotAssignment.ts` is a 1-line re-export |
| `src/skirmish/domain/ShorelineTolerance.ts` | 1–82 (all) |
| `src/skirmish/domain/DomainRoutePorts.ts` | 1–52 (all) |
| `src/skirmish/domain/RouteTask.ts` | 1–40 (all) |
| `src/skirmish/domain/ColumnTravel.ts` | 1–65 (all) |
| `src/skirmish/domain/CommandPrecedence.ts` | 1–53 (all) |
| `src/skirmish/domain/CohortAdmission.ts` | 1–461 (all) |
| Context: `Pathfinding.ts` | 1–470 (TilePaths, route cache, find/search/findExact/findGroup) |
| Context: `PathTopology.ts` | 30–140 (costs, change listener, neighbours) |
| Context: `FormationPlanning.ts` | 19–200 (state shape, setup) |
| Context: `PlanningWorkspace.ts` | 225–245 (revision handling) |
| Context: `RoutePlanner.ts` | 160–265 (checkpoint/restore), 580–600 (pins), 740–800 (corridor admission) |
| Context: `Simulation.ts` | 187–189, 409–445, 795–830, 1254–1300, 1440–1660, 1738–1756, 1979–2070, 2226–2280, 3400–3410, 4085–4135, 4389–4440 |
| Context: `Armies.ts` | 155–200, 392–420, 636–648, 925–945, 985–1000, 1045–1066 |
| Context: `Forest.ts` | 45–80 |
| Context: `Terrain.ts` | 21–43 |
| Context: `serverMatchWorker.ts` | 58–200 |
| Context: `ServerMap.ts` | 1–80 |
| Context: `ReservedMatchWorker.ts` | 22 |
| Context: `HostedRuntime.ts` | 60–100 |
| Round-1 notes | `06-simulation-perf.md` (all); `08-latent-bugs.md` P19, P20, P36 and the "Refuted during verification" table |

## How it works today

### Three tile graphs, each with an optional HPA* hierarchy

`Skirmish` builds three graphs, all with `prepare=false` (`Simulation.ts:797-800`): `LandPaths`, `WaterPaths`, and, under `ages-v1`, `AmphibiousPaths`.

**`TilePaths`** (`Pathfinding.ts:20-470`) owns several things:
- Four full-map scratch arrays (`cost`, `parent`, `seen`, `closed`, 16 B/tile), plus `component` (4 B/tile).
- `PathTopology` cost bytes.
- A route LRU of 16,384 routes / 2 M tiles (`Pathfinding.ts:13-14`, `remember` at 291).
- A hierarchy, when the map has more than 16,384 cells (`:10`, `:93-96`).

`find()` (`:248`) does the following:
1. Serves cached unobstructed routes. A cache hit replays the original `work`, so budgets do not depend on what happens to be cached.
2. Otherwise calls `search()` (`:310`). For legs longer than 48 tiles, `search()` calls `HierarchicalPaths.find` (`:324`).
3. Falls back to an unbounded `findExact` when that result crosses the caller's `blocked` mask (`:256`, `:272`).

**`HierarchicalPaths`** (32×32 clusters, `HierarchicalPaths.ts:5`) samples boundary portals in pairs. Each portal can own a **crossing tree**: a cluster-sized Dijkstra with `Int32` cost and `Int16` parent, about 6 KB. Three things are layered on top:
- A **start-tree LRU**, 512 per graph (`:9`, `:416-432`).
- **Shared preparation trees**, up to 1,024 per graph, checkpointed (`:10`, `:251-273`, `sharedCheckpoint` `:191`, `restoreShared` `:200-237`).
- **Water backbones**: abstract chains keyed `startCluster:goalCluster:revision`, at most 128 chains / 65,536 nodes (`:238-250`, use at `:937-942`, record at `:1035`, delete-on-fail at `:813-815`).

A cost change, which in practice means forest clearing from building placement (`Forest.ts:51-75`), triggers `onCostsChanged` (`:334-346`). That bumps `clusterRevision` for the touched clusters and drops their crossing trees. `TilePaths.costRevision` is a single global counter, bumped by the same listener (`Pathfinding.ts:57`).

There are two consumers:
- The **incremental corridor** (`step`, `:794-1121`). It is a resumable abstract A* whose start and crossing trees are built under the planner's preparation budget (`prepareLocal`/`stepLocal`/`sharedLocal`). Its `work` is deterministic whether trees come from cache or are built cold (`:168-170`, `stepLocal` `:775-793`).
- The **synchronous `find`** (`:1123-1231`). It builds any missing crossing tree **immediately** through `crossing()` (`:433-440`), and that cost is not charged to `work`.

**Warming.** `warm(4)` runs once per tick (`PATH_WARM_TREES = 4`, `Simulation.ts:189`). In live config it warms land and then water only (`:3408`). The cursor is monotonic, so trees invalidated later are rebuilt lazily.

**Gating.** The planner only lets a job try a corridor once `tick >= corridorTicks[graph]` (`:804`, `:819-821`), where `corridorTicks = ceil(portals/4)+1`, summed land→water. Amphibious is gated at `Infinity` unless `autonomousRouteDeadlineTicks === secondsToTicks(2)`, and live leaves that option unset. Before the gate opens, long jobs run the bounded exact planner (65,536-node arena) and can end as `limited`.

### Formations

- **`Formations.plan`** (`Formations.ts:45-160`) is synchronous slot placement. For each member it searches up to `12+columns` square rings (8r candidates per ring). It tests standability, the `blocked` mask, `connected`, and separation against already-placed slots in 4-tile buckets. It is ID-sorted and deterministic.
- **`FormationLine`** has two halves:
  - `deploymentLine` is the pure geometry for a dragged line. In live it is superseded by `layoutBattleLine` (`Simulation.ts:1611`).
  - `translatedSlots`/`translatedDeployment` keep offsets.
- **`FormationGeometry`** has four parts:
  - **Templates:** a module-level LRU, 512 entries, key = count × shape × doctrine × `seed%16` × frontage (`:689-724`).
  - **Envelopes and slots:** WeakMaps keyed by the immutable `FormationState` object, 4 and 8 entries respectively (`:310-322`, `:390-450`).
  - **Transition assignments:** a content-keyed Map of 128 entries plus a WeakMap pair cache (`:454-481`).
  - **`reorientedFormation`** (`:113-120`): it runs a Hungarian assignment (`FormationSlotAssignment.ts:13-62`, O(n³)) to size the reform duration.
- **Immutability.** The discipline holds: the only in-place writes to formation fields are wire/restore decode (`FormationSlotStream.ts:179-181`) and `MovementAdmission.ts:133` (`landSlots` on planning state). Every simulation update replaces the `FormationState` object, which is what makes the identity-keyed caches correct.
- **`advanceFormationStates`** (`Simulation.ts:2226-2276`) re-faces each idle or fighting squad. Above a 30° delta (or for an explicit hold facing), it calls `reorientedFormation` and certifies the transition footprint (`:2271-2273`). If certification fails, it does nothing, and the next tick computes the same thing again.

### Cohort admission (army reconnection)

`CohortAdmission` (owner "army", `Armies.ts:160`) moves each plan through four phases:
1. **formation** — `FormationPlanning`, 16 units per step.
2. **destinations**
3. **routes** — a direct connector or a `DomainRoutePorts.request` through the planner.
4. **connectors** — the first path tile within 3 tiles that is `clear`.

It then makes one atomic commit.

The checks are thorough. `live()` (`:160-172`) re-checks owner, troops, embark, refit, generation, order revision and the port-level validity of the current member every iteration, and every member at commit (`:396-415`). A stale member replans the formation; a dead one supersedes the plan. The checkpoint is `{pending, nextId}`, which covers all mutable fields (`:443-461`).

### Checkpoint coverage, compared field by field (the 08c method)

| Class | Mutable fields | Checkpointed | Not checkpointed, and why that is safe |
| --- | --- | --- | --- |
| `HierarchicalPaths` | `clusterRevision`, `sharedTrees`, `sharedBackbones`/`backboneNodes`, `startTrees`, portal `tree`s/`crossingBytes`, `sharedPins`, `localRuntimes`, `reclamation`, `warmCursor`, `generation`, `work`, `sharedDiagnostics` | `clusterRevision`, `sharedTrees` (with partial heaps), `backbones`, via `sharedCheckpoint` (`:191-199`) | start/crossing trees and runtimes are pure caches whose effort is replayed identically (`:168-170`). Pins are reset every planner step (`RoutePlanner.ts:588-591`). `warmCursor` only moves cost: the gate is tick-derived, and restore happens into a fresh instance. `work` is consumed only as deltas. Caveat: I7 (restore into a *used* instance). |
| `TilePaths` | `costRevision`, `routes`/`routeTiles`, scratch `generation`, `exactWork`/`replayedWork`, `telemetry` | `costRevision` via `RoutePlanner.ts:179-181`, `245-247` | `routes` is cleared on restore (`Pathfinding.ts:153-155`), and hits replay their stored work. |
| `CohortAdmission` | `pending`, `nextId` | both (`:443-445`) | none. `restore` checks member count and uniqueness only (`:446-460`), not phases or cursors: hardening only. |
| `Formations`, `FormationLine`, `ColumnTravel`, `CommandPrecedence`, `ShorelineTolerance`, `NavalLocalRoute`, `BuildingFootprint` | stateless | — | — |
| `FormationGeometry` / `FormationProfiles` module caches | templates, envelopes, slots, keys, assignments, frontage candidates/summaries | — | Pure functions of their keys. The immutable `FormationState` objects make identity keys sound. |

Checkpoint size note: `RoutePlanner`'s `planning` section grew 1.6 → 4.3 → 8.0 → 12.5 MB at ticks 800/1,600/2,400/3,200 (Med 500). The cause is `sharedCheckpoint` serialising up to 1,024 shared trees per graph, with `Int16` parents widened to `Int32` and partial heaps as JS number arrays (`:191-199`). It is bounded by `SHARED_TREE_LIMIT`. The live server never calls `checkpoint()` (only `HostedRuntime`/`CommitVerifier`, which are unused), so this matters only for tests and diagnostic replay.

## Measurements

Every number below was measured, not estimated.

### A. Path-graph residency: static ceiling after a full `prepare()` (`static.mts`)

| Map (worldSize) | Graph | Clusters | Portals | Fixed typed arrays (off-heap) | Fixed JS heap | All crossing trees (off-heap) | Their JS wrappers (heap) | Full prepare, desktop |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mediterranean 500×250 | land | 128 | 1,868 | 2.8 MB | 1.1 MB | 10.5 MB | 1.0 MB | 0.70 s |
| | water | 128 | 768 | 2.8 | 0.6 | 4.5 | 0.4 | 0.11 s |
| | amphibious | 128 | 2,306 | 2.8 | 1.3 | 13.1 | 1.1 | 1.51 s |
| Migration 500×500 | land | 256 | 1,732 | 5.6 | 0.6 | 9.8 | 0.9 | 0.59 s |
| | water | 256 | 3,466 | 5.6 | 2.2 | 19.8 | 1.7 | 0.71 s |
| | amphibious | 256 | 4,740 | 5.6 | 2.8 | 26.9 | 2.3 | 2.87 s |
| Mediterranean 1000×500 | land | 512 | 7,602 | 11.2 | 3.3 | 43.3 | 3.7 | 2.91 s |
| | water | 512 | 2,932 | 11.1 | 1.9 | 17.0 | 1.4 | 0.46 s |
| | amphibious | 512 | 9,578 | 11.2 | 6.0 | 54.8 | 4.6 | 6.05 s |
| Migration 1000×1000 | land | 1,024 | 6,842 | 22.2 | 2.2 | 39.4 | 3.3 | 2.29 s |
| | water | 1,024 | 13,614 | 22.3 | 9.6 | 78.4 | 5.4 | 2.42 s |
| | amphibious | 1,024 | 19,344 | 22.4 | 13.3 | 111.4 | 9.3 | 9.92 s |

### B. Live residency at the 52-faction target (`dyn.mts`)

Setup: 8 seats AI-controlled + 14 AI + 30 tribes; `DEFAULT_AI_POLICIES`, raids-v1, corridors-v1, `FORMATION_MOVEMENT`, Napoleonic; seed 1272661902. Values are at tick 4,000, the end of each run. **"Freed" is what a full GC reclaimed after the cache was cleared.**

| Map | S / H / traders / B | Live heap after full GC | ArrayBuffers | Route cache (`TilePaths.routes`) freed | Start-tree LRU freed | Shared trees + backbones freed | Crossing trees freed | Checkpoint (v8.serialize) |
| --- | --- | ---: | ---: | --- | --- | --- | --- | ---: |
| Mediterranean 500 | 757 / 55 / 468 / 583 | **128.5 MB** | 38.9 MB | **0 entries, 0 MB** | 206+88 entries; 0.6 MB AB + 0.07 MB heap | 1,024 land + 587 water; 8.0 AB + 1.0 heap | 12.7 AB + 1.0 heap | 5.2 MB |
| Migration 500 | 790 / 47 / 738 / 529 | **133.1 MB** | 70.0 MB | **0, 0 MB** | 171+133; 0.5 AB + 0.06 heap | 1,024 + 1,024 (cap hit at tick 1,600 on water); 8.1 AB + 1.1 heap | 26.3 AB + 1.9 heap | 6.7 MB |
| Mediterranean 1000 | 1,133 / 26 / 426 / 443 | **147.3 MB** | 118.6 MB | **0, 0 MB** | 51+15; 0.3 AB + 0.03 heap | 1,024 + 1,024; 11.6 AB + 1.3 heap | 52.6 AB + 3.8 heap | 9.0 MB |

- The amphibious hierarchy held **0 MB of trees and 0 shared trees on every map for the whole run.** Its gate is `Infinity` and it is never warmed.
- **`TilePaths.find` was called 0 times and `HierarchicalPaths.find` 0 times in 12,000 AI ticks.** The route LRU and the synchronous HPA* path are reached only by human-command fallbacks (see I1).
- A worker with `resourceLimits.maxOldGenerationSizeMb: 64` held 40,000 cluster trees (234 MB of `Int32Array`/`Int16Array` backing stores) with `heapUsed` at 21 MB (`heapcap.mjs`). **Typed-array backing stores do not count against the 384 MB cap.**

**Conclusion for summary perf #10 / 06 rec. 11:**
- Halving `ROUTE_CACHE_TILES` and `START_TREE_CACHE` would free **≈0 MB** of the capped heap.
- Raising the cap is not needed for the path caches either. They are off-heap, and the live heap after GC is 128–147 MB at S≈760–1,130.
- Round 1's "heapUsed swings 107–476 MB" were mostly garbage awaiting collection, not live set. The ledger's capped probe also measured a 100–115 MB live heap.
- **What decides the cap is whether the live heap grows with match time.** See measurement E and I4.

### C. Synchronous path work in these files (`dyn.mts`)

| Map | `HierarchicalPaths.find` calls | Lazy crossing-tree builds outside warm | `TilePaths.find` calls | `findExact` calls / 400 ticks (all limit 2,048) | `findExact` max single call (contended) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Med 500 | 0 | 0 | 0 | 4 → 1,345 | 0.9 → 48 ms |
| Mig 500 | 0 | 0 | 0 | 5 → 659 | 1.3 → 52 ms |
| Med 1000 | 0 | 0 | 0 | 11 → 493 | 0.8 → 48 ms |

`findExact` is the bounded repair at `Simulation.ts:4107-4128` (ledger P19). Corridor preparation is budgeted. For AI play in live config, therefore, the only unmetered work in these files is the repair's `blocked` callback (P19). The human-command path in I1 is the exception, and it is large.

### D. Formation re-facing (`formations.mts`, `hung2.mts`, `hungarian.mts`)

`advanceFormationStates` on Med 500, 52 factions (contended run):

| Tick | S | Mean ms/tick | p99 | Max | Share of tick | Reorientation attempts / tick | Failed certifications | Retried on the very next tick |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 400 | 214 | 7.1 | 65.7 | 96.8 | 11.3 % | 5.6 | 0 | — |
| 1,200 | 596 | 16.1 | 84.7 | 108.7 | 8.9 % | 14.3 | 280 | 271 |
| 2,000 | 899 | 23.7 | 114.5 | 138.0 | 7.4 % | 24.3 | 1,378 | 1,359 |
| 2,800 | 1,078 | 28.7 | 137.8 | 182.0 | 6.2 % | 28.5 | 1,826 | 1,811 |
| 3,200 | 1,060 | 39.3 | 157.3 | 193.0 | 6.9 % | 29.1 | 2,676 | 2,659 |

Troop counts per attempt in Napoleonic: 1–48 only (e.g. 8,381 at 1–24 and 3,272 at 25–48 in the last window).

Hungarian `minimumTravelAssignment`, rotated lattice, single process:

| n | Time |
| ---: | ---: |
| 24 | 0.12 ms |
| 48 | 2.2 ms |
| 96 | 6.2 ms |
| 144 | 13.6 ms |

Full `reorientedFormation` plus the first transition `formationSlots` (the second Hungarian):

| Squad size | Time |
| --- | --- |
| 24–48 troops | 0.3–3 ms |
| 144 troops | 12–38 ms |

### E. Long-run live-heap trend (`long.mts`, Med 500, 52 factions, full GC before every sample, stopped at tick 8,000)

| Tick (min) | Alive | S | B | Traders | Live heap | ArrayBuffers | Checkpoint |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 800 (1.7) | 52 | 421 | 186 | 90 | 75.8 MB | 27.4 MB | 3.5 MB |
| 1,600 (3.3) | 52 | 744 | 271 | 282 | 91.6 | 28.5 | 7.1 |
| 2,400 (5) | 51 | 1,021 | 417 | 383 | 101.1 | 29.9 | 11.5 |
| 3,200 (6.7) | 49 | 1,060 | 503 | 460 | 110.4 | 36.9 | 16.8 |
| 4,000 (8.3) | 39 | 757 | 583 | 468 | 126.1 | 38.9 | 17.8 |
| 4,800 (10) | 35 | 676 | 645 | 516 | 132.8 | 41.7 | 19.7 |
| 5,600 (11.7) | 29 | 599 | 673 | 610 | 133.7 | 41.9 | 19.0 |
| 6,400 (13.3) | 26 | 591 | 716 | 624 | 138.1 | 42.0 | 19.7 |
| 7,200 (15) | 24 | 638 | 749 | 643 | 141.4 | 42.6 | 20.6 |
| 8,000 (16.7) | 24 | 747 | 772 | 688 | 146.3 | 42.5 | 20.7 |

**Reading the table:**
- The live heap does not follow S. It tracks buildings and traders, both of which keep rising, and its growth is slowing: about 7 MB/min early, about 2.0 MB/min from tick 4,800 to 8,000.
- Linear extrapolation from the late slope gives about 230 MB at 60 minutes on Med 500. Med 1000 runs about 15–20 MB higher at the same tick (B).
- **The 384 MB cap is not threatened by the path caches, and on these trends not by match length either.** Keep 384 MB and add a heap-after-GC metric to the worker diagnostics, so a real leak would show up.

I diffed two heap snapshots (ticks 2,400 and 7,200). By type, the growth is arrays, plain Objects and boxed numbers. The probe kept the just-built checkpoint alive in both snapshots, though, so the diff cannot separate state growth from checkpoint growth. Attributing it needs a retainer-path diff and is left to the perf area.

### F. Other probes

- **`Formations.plan` worst case** (`formplan.mts`, Med 500). 200 squads (MAX_SQUADS) onto a headland with 60 land tiles within r12: **9.6 ms**. 100 squads: 10.8 ms. Open ground, 200 squads: 1.5 ms. No issue.
- **Corridor gate effect on water** (`backbone.mts`, Mig 500, water gate at tick 1,302). 12 far + 27 near water routes ended **`limited`** between ticks 800 and 1,200. **Zero** new `limited` outcomes after the gate opened (ticks 1,600–2,000).
- **Amphibious `Infinity` gate is not a functional failure at 500 size** (`amphgate.mts`, Med 500, 1 human + 3 AI, Napoleonic). A 419-tile-Manhattan human move completed by exact search in 2 ticks with a 229-tile path. With the gate forced open, the corridor took 24 ticks and returned a 4 % longer path (239 tiles).
- **Global cost revision** (`revs.mts`, `corridorrev.mts`, Med 500). The land cost revision bumped 106/45/85/58 times per 400 ticks (a change on 40–70 of every 400 ticks). Even so, only **1 of 219** corridors was cancelled by a revision change by tick 2,400. Corridors finish within one or two ticks.
- **Backbone goal-side failures** (Mig 500). 67 backbone lookups and **3** fail-deletes by tick 2,000; 9 failed corridors out of 186.
- **Template cache** (`dyn.mts`). The 512-entry cap is reached at about tick 2,800, and cumulative misses then climb 1,196 → 3,336 → 9,662 → 15,605 (Med 500) and 2,222 → 12,308 (Mig 500). That is 5–16 misses per tick. Miss cost (`tmpl.mts`): `line` 0.026 ms, `mass` 0.25 ms; a hit costs 0.004 ms. Every one of the 768 calls for a `line` shape across 16 seeds was a miss, even though `line` slots do not depend on the seed.

## Strengths

- **The hierarchy is a careful piece of work.**
  - Cache-independent deterministic effort accounting: a cache hit replays the cold effort (`:168-170`, `stepLocal` `:775-793`, `Pathfinding.ts:282-285`).
  - Revision-guarded caches throughout.
  - Corridor preparation that yields under a fair budget.
  - Bounded shared preparation with pins (`pinShared` is reset every planner step to ≤128 origins, so the `subscriber bound exceeded` throw at `:258` is unreachable in practice).
  - Heavy input validation on restore (`:200-237`, `:500-677`).
- **The identity-keyed formation caches are sound.** The immutable-`FormationState` discipline holds across the simulation (only decode writes in place). Every module cache is a pure function of its key, so sharing them across matches in a worker cannot leak state.
- **CohortAdmission revalidates ownership on every step and at commit.** `live()` checks `playerId`, generation and order revision; Armies' `valid` port checks army revision and membership. I found **no instance of the match-269 stale-reference class** in these files.
  - Plan iteration order is rotated, checkpointed and deterministic.
  - Deleting during Map iteration (`:238-243`) is safe in JS.
- **The planner's design choices hold up under load.**
  - `PlanningPath.step` takes the job's own revision (`RoutePlanner.ts:787`), so cost churn does not stall exact searches.
  - Corridors complete fast enough that the global revision rarely bites (1/219).
- **Path data lives off-heap.** Crossing trees, start trees, shared trees and the fixed scratch arrays are typed arrays outside the V8 old generation, so they cannot push the worker over its 384 MB cap.

## Issues

### I1. A human move whose selection mixes army and non-army squads runs synchronous HPA* on the never-warmed amphibious graph and stalls the tick for 0.5–2.6 s (desktop)
- **Where:**
  - `Simulation.ts:1480-1483`: deferred admission requires `selected.every(s => !armies.armyOf(s))`.
  - `Simulation.ts:1513-1520` with `Armies.ts:403-411`: `groupOrder` returns `undefined` unless the selection is exactly one whole army.
  - `Simulation.ts:1543` and `:1546-1553`: synchronous `Formations.plan` + `squadPaths.findGroup(..., obstacleTest)`.
  - `Pathfinding.ts:416+` → `find` (`:248`) → `search` (`:310`) → `HierarchicalPaths.find` (`:1123`), which builds every missing crossing tree synchronously through `crossing()` (`:433-440`), uncharged (`:168-170`).
  - `Simulation.ts:3408`: only land and water are warmed. Every faction is amphibious from Napoleonic on: 49–52 of 52 in my runs.
- **Severity:** high. **Confidence:** CONFIRMED by execution (`mixedsel-head.mts` on a HEAD export with identical code for these paths).
- **Mechanism:** Box-select one squad that belongs to an army plus one that does not (or any partial army), then issue a non-append move. The deferred path is refused, `groupOrder` declines, and the command falls through to the legacy synchronous branch. `findGroup` runs `find` on the amphibious graph, whose crossing trees are all cold. HPA* touches thousands of portals and builds a 1,024-cell Dijkstra for each one, inside `applyCommand`, inside the tick.
- **Measured:**

  | Map | Selection | applyCommand time | Crossing trees built synchronously |
  | --- | --- | ---: | ---: |
  | Med 500 | army member + plain squad, 597 tiles | 535 ms | 666 |
  | Med 1000 | army member + plain squad, 1,174 tiles | 2,612 ms | 2,787 |
  | either | plain squad alone (deferred, control) | 0 ms | 0 |

  At about 2.4× on ARM that is roughly 1.3 s and 6 s. A prepared graph answers the same 40-squad `findGroup` in 36 ms (`findgroup.mts`).
- **Consequence:** A single human click freezes the whole match for every player, in the same class as the 2026-10-15 freeze. After the first command the trees stay cached and repeats are cheaper. Forest changes (every 4–10 ticks, see F) invalidate trees cluster by cluster, though, so the cost recurs.
- **Repro:** Napoleonic, 1 human + 3 AI, Mediterranean 1000. At tick 40 send `create-army` with squads A and B, then `order` move with `squadIds:[C, A]` to the far side of the map.

### I2. Re-facing retries a failed reorientation every tick and runs the O(n³) assignment twice per attempt
- **Where:**
  - `Simulation.ts:2266-2273`: no backoff after `certifyFormationPolygon` fails.
  - `FormationGeometry.ts:113-120`: Hungarian #1, used only to size `duration`.
  - `FormationGeometry.ts:435` / `:467`: Hungarian #2. The first `formationSlots` call of the transition re-solves the same (source, to) pair, and `emptyTransitionTerrain` triggers it in the same tick.
  - `FormationSlotAssignment.ts:13-62`.
- **Severity:** medium. **Confidence:** CONFIRMED (measured).
- **Mechanism:**
  - A squad whose target bearing differs from its facing by more than 30° calls `reorientedFormation` every tick. That covers attack orders, `combatTargetId`, and hold-facing orders.
  - Each call does two `formationSlots`, a Hungarian over up to 144 slots, and a transition-footprint certification.
  - When certification fails (blocked ground, friendly overlap), nothing is recorded. The facing still differs, so the next tick repeats all of it.
  - The `fromSlots` array is new each time, so the `assignmentPairs` WeakMap misses. Only the 128-entry content-keyed map can hit, and building its key string costs O(n) on every attempt.
- **Consequence:**
  - 6–11 % of tick time at S 214–1,078, rising to 29 attempts per tick.
  - Up to 6.7 failures per tick, 99.4 % retried on the very next tick.
  - p99 65–157 ms for this phase alone (contended).
  - Later-age 144-troop units cost 12–38 ms per attempt, so one blocked full-strength squad could cost tens of ms on every tick.

### I3. Corridor warm-up is paced per tick, so the 20→8 Hz change made it 3.75× slower in wall time; long water and trade routes are `limited` for minutes on large maps
- **Where:** `Simulation.ts:189` (`PATH_WARM_TREES = 4`; it was 6 at 20 Hz in commit 86db80be), `:802-805`, `:819-821`, `:3403-3409`.
- **Severity:** medium. **Confidence:** CONFIRMED. The gate arithmetic is exact, and the effect was measured on Mig 500.
- **Mechanism:** Corridors may not start before `corridorTicks`. The rate fell from 120 trees/s to 32 trees/s, so the gates now open at:

  | Map | Land gate | Water gate |
  | --- | --- | --- |
  | Med 500 | 468 ticks (58 s) | 661 (83 s) |
  | Mig 500 | 434 | 1,302 (2.7 min) |
  | Med 1000 | 1,902 (4.0 min) | 2,636 (5.5 min) |
  | Mig 1000 | 1,712 (3.6 min) | 5,117 (**10.7 min**) |

  Until then, long routes (interactive moves, trade, sea traders) use the 65,536-node exact arena.
- **Consequence:** On Mig 500, 39 water routes ended `limited` before the gate and none after. On Migration 1000 the opening 10 minutes of sea trade and naval moves depend on the bounded planner and its retry backoff.

### I4. The live heap grows with match time, but slowly; it tracks buildings and traders rather than S (cross-area)
- **Where:** global. Measured in E.
- **Severity:** low. **Confidence:** CONFIRMED trend; the 60-minute projection is an extrapolation.
- **Mechanism / consequence:**
  - On Med 500 the live heap after a full GC went 101 → 146 MB between ticks 2,400 and 8,000, while S stayed between 591 and 1,060 and alive factions fell from 51 to 24.
  - Buildings (417 → 772) and traders (383 → 688) rose throughout.
  - The slope fell from about 7 to about 2 MB/min, which projects to about 230 MB at 60 minutes. That is under the 384 MB cap, with no evidence of an unbounded leak.
  - Not a reason to raise the cap or to shrink path caches. It is a reason to export heap-after-GC in `serverMatchWorker` diagnostics, which today report `heapUsed` including garbage.

### I5. The amphibious hierarchy is built and held but unusable in live config, and its residency is not reported
- **Where:** `Simulation.ts:800` (built with a hierarchy), `:804` (gate `Infinity`), `:3408` (never warmed), `serverMatchWorker.ts:96` (diagnostics report land and water only).
- **Severity:** low-medium. **Confidence:** CONFIRMED.
- **Mechanism:** The only consumer that can reach the amphibious hierarchy is the synchronous `find` (I1). It is pure cost:
  - Portal objects and the `portalsByTile` Map: 1.3 / 2.8 / 6.0 / **13.3 MB of JS heap** (Med 500 / Mig 500 / Med 1000 / Mig 1000).
  - Construction: 0.09–0.39 s.
  - Its full-map scratch arrays: 2.8–22.4 MB off-heap.

  Separately, the scratch arrays `cost/parent/seen/closed` exist in all three graphs (16 B/tile/graph, 48 MB on Mig 1000). Only `findExact` (bounded at 2,048 expansions for repairs) and the never-called `find` use them.

### I6. The template cache key includes `seed%16` for shapes that ignore the seed, and it thrashes at 512 entries
- **Where:** `FormationGeometry.ts:689-699` (key), `:715-720` (cap), `buildSlots` `:367-371` (only `mass`/`modern-loose` read the seed).
- **Severity:** low. **Confidence:** CONFIRMED.
- **Consequence:**
  - Up to 16 identical copies of every `line`, `column`, `square`, `wedge` and `shield-wall` template.
  - After about 2,800 ticks, 5–16 misses per tick.
  - A `mass` miss costs 0.25 ms, about 60× a hit.
  - Extra short-lived garbage.

### I7. `restoreShared` resets `clusterRevision` without dropping start and crossing trees cached on a used instance
- **Where:** `HierarchicalPaths.ts:200-206`. Callers: `RoutePlanner.ts:263-265`; reachable on a non-fresh instance via `HostedRuntime.ts:93` (CommitVerifier rollback). The live server restores only into fresh instances (`worker.ts:114-115`).
- **Severity:** low. **Confidence:** SUSPECT (not executed).
- **Mechanism:** After a rollback, revision numbers are reused. A start tree cached on the abandoned branch at revision r can be accepted on the new branch at r even though the costs differ. Walkability is static, so the route stays legal but may differ from a fresh restore, which is a determinism divergence between verifier and host.

### I8. Water backbones are only checked on the start side; goal-side failures happen late and delete the backbone
- **Where:** `HierarchicalPaths.ts:937-942` (only `backbone[0]` is tested against the start tree), `:1074` (late failure), `:813-815` (delete).
- **Severity:** low. **Confidence:** CONFIRMED by code; 3 deletes in 67 lookups measured.
- **Mechanism:** The key is `startCluster:goalCluster:revision`. If the goal cluster's water is split (a coast or peninsula), the cached chain can end at a portal that cannot reach this goal. The full refine runs before it fails, the job falls back to exact search, and the next query rebuilds the chain.

### I9. Every in-flight corridor fails on any cost change anywhere on its graph
- **Where:** `HierarchicalPaths.ts:854`; `Pathfinding.ts:57` (global `costRevision`).
- **Severity:** low (measured 1/219). **Confidence:** CONFIRMED.
- **Mechanism:** `clusterRevision` is per cluster, but the corridor validates the global revision. Land cost revisions change every 4–10 ticks, so slower corridors (big maps, saturated budgets) are increasingly exposed.

### I10. FormationPlanning keeps a full shallow copy of each Squad as `origin`
- **Where:** `FormationPlanning.ts:108` (`origin:{...origin}`). Every caller passes `origin: squad`: `CohortAdmission.ts:129`, `:411`; `MovementAdmission.ts:427`, `:887`, `:1043`; `Armies.ts:235`; `Simulation.ts:3822`. The copies are also stored in reservations (`accept`: `{...point, ...member}`).
- **Severity:** low. **Confidence:** CONFIRMED.
- **Consequence:** The copies keep stale `path`/`formation` arrays alive and are deep-cloned into checkpoints (admission section 0.01–0.73 MB). Only `x`/`y` are read.

### I11. CohortAdmission's 3,000-tick deadline is a 20 Hz literal
- **Where:** `CohortAdmission.ts:255`.
- **Severity:** low. **Confidence:** CONFIRMED (introduced 2026-10-03 at 20 Hz).
- **Consequence:** The cohort timeout went from 150 s to 375 s at 8 Hz.

### I12. `CohortAdmission.start` refuses at 128 pending before superseding the caller's own plans
- **Where:** `CohortAdmission.ts:97-104`.
- **Severity:** low. **Confidence:** CONFIRMED by code.
- **Consequence:** When the table is full, a re-plan for the same squads is refused (Armies retries) instead of replacing the stale plan.

### I13. `geometryKey` still includes `charge.phase` after the charge-wedge override was removed
- **Where:** `FormationGeometry.ts:140`, `:143`; working-tree diff at `:175-180`.
- **Severity:** low. **Confidence:** CONFIRMED.
- **Consequence:** Envelope and geometry-key churn, and invalidation of geometry-keyed consumers, on every charge phase change, although the slots no longer depend on it.

### I14. Forest navigation clearing is centred on the building's NW tile, not its footprint
- **Where:** `BuildingFootprint.ts:85-99`, used at `Forest.ts:58`.
- **Severity:** low (design). **Confidence:** CONFIRMED.
- **Consequence:** A 3×3 city at (x,y) clears columns x−1..x+1 and rows y−1..y+1. Its own east column and south row keep forest cost. The comment says this is a deliberate legacy mask.

### I15. Dead branch in `controllerOf`
- **Where:** `CommandPrecedence.ts:32`. The second `stance` check is unreachable after `:29`.
- **Severity:** low.

### I16. `withinShoreline` fails open on degenerate or NaN polygons
- **Where:** `ShorelineTolerance.ts:55`, `:78`, `:81`.
- **Severity:** low (hardening). **Confidence:** SUSPECT. No NaN producer was found upstream.
- **Mechanism:** `area(intersection) > 0.01` is false for NaN, so `pieces` starts empty and the function returns `true` ("covered"). A footprint polygon with a NaN vertex would be accepted on deep water instead of rejected.
- **Fix:** start with `if (polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;`.

## Recommendations (prioritised)

1. **Close I1 (S, 0.5–1 day).** Two independent changes; do both:
   - **(a) Stop the fallthrough.** At `Simulation.ts:1480`, split mixed selections: send the whole-army part through `armies.groupOrder` and the rest through `movementAdmission.start`. Alternatively, reject a mixed selection with a message. Either way, `applyCommand` never reaches the legacy synchronous branch while `deferredPlanning` is on. The same applies to `:1652` and `:1750`, which are already guarded.
   - **(b) Defence in depth.** Give `HierarchicalPaths.find` a `maxColdTrees` argument (for example 32). When it would exceed that, return `null`, and have `TilePaths.search` use `findExact` with a limit, or have the caller queue a planner job.
   - **Tests:**
     - a mixed-selection move on a 500 map returns `null` within 20 ms, `movementAdmission.pendingCount` grows, and the amphibious graph's `residency.treeBytes` stays 0;
     - a unit test that `find` on a cold graph builds at most N trees.
2. **Reorientation (S, 1 day).**
   - **(a)** Compute the assignment once. Have `reorientedFormation` call `assignedTransitionSources(source, to, 1)` (export it), so the result seeds the `assignmentPairs` WeakMap for the exact `fromSlots`/`to` objects the transition will use. Take `distance` from that result. This halves the cost and is bit-identical.
   - **(b)** Back off after a failure. Add `reorientRetryTick` to `FormationState` (validate it in `validateFormation`; squads are checkpointed whole) and skip `reorientedFormation` until `tick >= reorientRetryTick` (use `COLUMN_TRAVEL.retryTicks`). Clear it on a facing change larger than 30°. Do **not** reuse `retryTick`: `columnDecision` reads it (`ColumnTravel.ts:26`).
   - **(c)** For n > 64, consider an O(n log n) assignment (sort both slot sets by projection on the new facing, then by lateral). It is optimal for rigid rotations of the same lattice and falls back to Hungarian when the shapes differ.
   - **Expected:** formation phase from 6–11 % of the tick to about 1–3 %.
   - **Tests:** a squad pinned against forest with an attack target behind it makes at most ⌈80/retryTicks⌉+1 attempts in 80 ticks, and checkpoint/restore equality holds.
3. **Warm-up pace (XS–S).**
   - Express the rate per second, e.g. `PATH_WARM_TREES = Math.ceil(120 / TICKS_PER_SECOND)` = 15. The gate formula uses the same constant, so it stays deterministic.
   - Cost: about 0.37 ms per land tree on desktop (≈0.9 ms on ARM), i.e. roughly 13 ms per tick on ARM for the first 30–80 s on Med 500. Early ticks run about 35 ms.
   - Better: build land and water trees during spawn selection (`serverMatchWorker.ts` "prepare"). That takes 0.8 s on desktop for Med 500 and 4.7 s for Mig 1000. Hand the prepared graphs to `Skirmish`, then set `corridorTicks` land and water to 0.
   - **Test:** on Migration 1000, a sea-trader route requested at tick 10 completes as a corridor.
4. **Heap policy (XS).**
   - Drop "halve ROUTE_CACHE_TILES / START_TREE_CACHE": measured gain 0 MB of capped heap.
   - Keep the 384 MB cap. Measured live set: 128–147 MB at tick 4,000 across Med 500, Mig 500 and Med 1000; about 230 MB projected at 60 minutes on Med 500 (I4).
   - Add heap-after-GC (or `v8.getHeapStatistics().used_heap_size` sampled after a scavenge-free window) to the worker diagnostics, so growth is visible in production.
   - Separately, budget host **RSS** per match for off-heap typed arrays. Measured `arrayBuffers` at tick 4,000 (all subsystems; path data is most of it): Med 500 39 MB, Mig 500 70 MB, Med 1000 119 MB. Mig 1000 is estimated at about 200 MB from table A (67 MB fixed + 118 MB land/water trees + ≤16 MB shared), plus about 110 MB if the amphibious hierarchy is ever warmed.
5. **Skip the amphibious hierarchy while its gate is `Infinity` (S).** Construct `AmphibiousPaths` with a flag that omits `HierarchicalPaths`, or build it lazily on first corridor or `find` use. This saves 1.3–13.3 MB of JS heap and 0.1–0.4 s of setup, and removes the I1 cold-tree hazard on that graph. Add amphibious to the `serverMatchWorker` residency diagnostics. Optionally replace the 16 B/tile scratch arrays with a hashed 4,096-node workspace for bounded `findExact` (saves 48 MB off-heap on Mig 1000).
6. **Templates (XS).** Use `shape==="mass"||shape==="modern-loose" ? seed%16 : 0` in the key and raise the cap to 2,048 (≈4 MB of heap). **Test:** 16 seeds of a `line` squad yield 1 template entry.
7. **Small fixes (XS each):**
   - I11: `secondsToTicks(150)`.
   - I12: supersede before the capacity check.
   - I13: remove `s.charge?.phase` from `geometryKey`; check `columnCertificates`/`movementClearance` keyed consumers.
   - I10: copy `{x, y}`.
   - I8: before using a backbone, require the goal-side portal's crossing tree to reach the goal (or skip the backbone when that tree is cold).
   - I7: clear `startTrees` and portal trees in `restoreShared`.
   - I9 can wait: record `clusterRevision` for the clusters on the chain in `CorridorState` and fail only when one of those changes.

## Open questions

- At 1000×1000, can the bounded exact planner (65,536-node arena) serve every amphibious long move without the corridor? At 500 size it did (F); at 1000 size it is unmeasured.
- What retains the roughly 2 MB/min late-game heap growth (I4)? By type it is arrays, Objects and boxed numbers. A retainer-path diff of two snapshots taken without a live checkpoint would answer it.
- Do later ages produce 144-troop squads that re-face often (the 12–38 ms reorientations)? My runs were Napoleonic (≤48 troops).
- Armies' synchronous `squadPaths(...).find` at `Armies.ts:998` and `:1055-1065` was never hit in AI play. Is it reachable for human army orders in live config?
