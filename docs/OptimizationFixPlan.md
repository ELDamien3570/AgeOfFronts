# Skirmish performance fix plan

Status: **plan only. No production code was changed.** Everything below was
measured against `main` at `e72b9c0` using the scripts in
[`docs/perf/prototypes/`](perf/prototypes/). Where a number is an estimate, or a
fix was not prototyped, the text says so.

This supersedes the earlier investigation report that circulated before the
host/verifier multiplayer path landed. That report targeted 1000 × 500, 60
factions and 2× speed, which is not the multiplayer configuration, and it did
not know about the commit pipeline described in section 2.

## 1. Bottom line

1. **The simulation does not stay inside its 50 ms tick budget on the shipped
   multiplayer maps.** In a 20-faction AI-only game at world size 500, mean tick
   cost passes 50 ms on Africa and Amazon River by minute 9–12, with single ticks
   of 1–2 seconds. Heightmap Test 1 misses the budget from minute 3, before any
   trader exists.
2. **The dominant cost is hierarchical pathfinding**, not combat. It is reached
   from three places: trade routing, squad route jobs (`RouteWork`), and
   (on one map) exact A\* because the hierarchy is switched off below 65,536
   cells.
3. **Three exact fixes (no gameplay change, verified by identical state hashes)
   roughly halve the cost** on the large maps. They do not solve it. The rest
   needs deliberate behavior decisions, listed in section 6.
4. **The multiplayer commit pipeline costs more than the simulation it carries.**
   Every four ticks the host serializes a full checkpoint and the server decodes
   and restores it. At minute 5–8 on Africa that is roughly 55–80 ms on the host
   and about 60–70 ms mean (85–100 ms p95) on the server per 200 ms commit, and
   about 75% of the upload is one derived structure (`ownedTiles`).
5. **Tick spikes become game-time slowdown**, because the next batch is only
   issued after the previous commit is verified (section 2). Fix the tails and the
   commit cost together or the game will visibly run slow.

## 2. How cost reaches players today

`LiveMatch.advance()` issues a `HostBatch` (up to 100 queued commands, 4 ticks,
`COMMIT_TICKS` in `HostedRuntime.ts`). The elected executor, a player's browser or
the server's reserved worker, runs the batch, then produces a commit:

```
host:    applyCommand* → step ×4 → checkpoint() (structuredClone)
         → encodeState (JSON pack + gzip + SHA-256 + base64)  → JSON websocket frame
server:  decodeState (base64 → gunzip → SHA-256 → JSON.parse → unpack)
         → replay commands for economy checks → restore() into its runtime
         → snapshot() → SnapshotEncoder → encodeState → broadcast (≈19 KB / client)
```

Consequences that are not obvious from reading any single file:

- **One batch is in flight at a time** (`if (this.batch) … return`). `nextAt = now +
200` only sets a minimum. Cycle time is therefore `host compute + serialize +
upload + verify + download`, and simulated time advances only when a cycle
  completes. If the cycle is 350 ms, the match runs at about 0.57× real time.
  Nothing today measures or reports that ratio.
- **A single 1.1 s tick spike lands inside one batch.** The host is dropped after
  3 s without a commit (`pendingSince > 3000`). A slow home upload plus a spike
  plus serialization can approach that, and each drop triggers a handover that
  costs a full checkpoint decode and restore.
- **Host qualification is nearly meaningless.** `multiplayerHostWorker` times 12
  ticks at match start, when ticks are cheap, and reports the worst. It says
  nothing about late-game tick cost, serialization cost or upload bandwidth.
- **The verifier does not re-simulate.** It checks economy deltas and tick bounds
  and trusts the host's world otherwise (`CommitVerifier` comment: "host world
  income remains trusted"). A player-host can alter positions, territory or the
  winner. This is a trust-model issue, not a performance one, but it affects
  decision D3.

## 3. Evidence

Method: `Skirmish` with `ruleset: "ages-v1"`, seed 42, 19 AI plus one idle human
(20 factions), tribes off, world size 500, AI-only play. Per-minute windows of
per-tick wall time. Node 22.22, 4-core cloud CPU. "Hash identical" means a
hash of owners, squads, buildings, players and traders matched the unpatched run
at every simulated minute checked. Prototype patches are runtime monkeypatches;
nothing in `src/` was edited except one temporary threshold edit that was
reverted.

### 3.1 Tick time, unpatched `main`

| Map (cells)                                       | Minute | Mean ms | p99 ms | Max ms | Ticks > 50 ms in that minute |
| ------------------------------------------------- | ------ | ------: | -----: | -----: | ---------------------------: |
| Africa 500 × 500 (250,000)                        | 5      |    11.5 |     80 |    172 |                           33 |
|                                                   | 8      |    25.4 |    473 |    790 |                           88 |
|                                                   | 10     |    39.5 |    848 |  1,176 |                          164 |
|                                                   | 12     |    49.6 |    652 |  1,170 |                          198 |
| Amazon River 500 × 125 (62,500, **no hierarchy**) | 3      |     3.2 |     31 |    169 |                            3 |
|                                                   | 6      |    36.6 |    685 |  1,031 |                          120 |
|                                                   | 9      |    79.5 |  1,398 |  2,252 |                          213 |
| Heightmap Test 1 500 × 250 (125,000)              | 3      |    15.9 |    187 |    429 |         109 (no traders yet) |
|                                                   | 6      |    24.0 |    226 |    346 |                          178 |

Each minute has 1,200 ticks and a 50 ms budget, so 60 slow ticks is 5%.

### 3.2 After the three exact fixes (section 4, 1a + 2a + 2b)

| Map              | Minute | Mean | p99 | Max | > 50 ms | Hash identical       |
| ---------------- | ------ | ---: | --: | --: | ------: | -------------------- |
| Africa 500       | 5      |  6.7 |  57 | 121 |      15 | yes, minutes 1–10    |
|                  | 8      | 14.6 | 254 | 477 |      82 |                      |
|                  | 10     | 23.4 | 475 | 655 |     129 |                      |
| Heightmap Test 1 | 3      | 11.5 | 147 | 278 |      91 | yes, minutes 3 and 6 |
|                  | 6      | 14.0 | 162 | 210 |     116 |                      |

Amazon River is unaffected because the start-tree cache only applies when a
hierarchy exists. The earlier World 500 × 250 run (older code) improved from mean
19.3 / p99 142 / max 245 to 8.6 / 28.5 / 41 at minute 15 with the same fixes,
also hash identical. Africa is harder: it is four times the cells with more
traders alive.

### 3.3 Where the remaining time is

- **Africa, after fixes (12 min profile):** `HierarchicalPaths.find` self time is
  **45%** of all CPU, and `localTree` is down to 3%. Remaining cost is the
  abstract portal search itself, not the local trees.
- **Heightmap Test 1, first 4 minutes, after fixes:** `RouteWork.drain →
executeRouteTask → find` is **58.6%** inclusive; `HierarchicalPaths.find` self is
  32%. This map has no trade problem early. It is squad routing.
- **Trade on Africa (10 min, after fixes):** 4,181 `load()` calls, 727 `select()`
  calls, **61,341 path queries at 0.84 ms each** (mean path 231 tiles).
  **99.2%** of those queries repeat a `(start, goal)` pair already computed. A
  cache invalidated by any forest-cost change would still hit **77.3%**.
  `trade.step` was 53 s of a ~200 s run.
- **Amazon River with the hierarchy enabled (threshold edit, reverted):** minute 9
  mean 79.5 → 11.7 ms, p99 1,398 → 165, max 2,252 → 256. Paths are approximate
  with a hierarchy, so the AI trajectory differs; this is a behavior change, not
  an exact fix.

### 3.4 Commit pipeline (Africa 500, one commit = 4 ticks, sampled every 40 ticks)

| Minute | Host `checkpoint()` | Host `encodeState` | Upload (gzip + base64) | Server decode | Server `restore` | Server snapshot + encode | Server p95 total | Broadcast / client |
| -----: | ------------------: | -----------------: | ---------------------: | ------------: | ---------------: | -----------------------: | ---------------: | -----------------: |
|      1 |                7 ms |    89 ms (warm-up) |                  74 KB |         28 ms |            24 ms |     247 ms (first, cold) |           300 ms |     513 KB (reset) |
|      5 |              9.8 ms |            45.8 ms |                 200 KB |       36.8 ms |          13.3 ms |                   8.8 ms |            85 ms |              19 KB |
|      8 |             13.5 ms |            64.9 ms |                 257 KB |       43.3 ms |          15.7 ms |                   8.6 ms |            99 ms |              20 KB |

Upload grows about linearly with owned territory (74 → 257 KB in seven minutes).
The sizes above already include base64. At one commit per 200 ms, minute 8 is
about 1.3 MB/s sustained from the host. The broadcast side is fine: ~100 KB/s per
client, already a shared delta stream with a baseline on join.

Composition of the minute-8 checkpoint: **`ownedTiles` is 413 KB of JSON (192 KB
after gzip + base64, about 75% of the upload) and ~42 ms of the ~65 ms encode.**
It is a `Map<player, Set<tile>>` that is derived from `owners`. The four
map-sized byte arrays (`owners`, `claims`, `progress`, `pressure`, 244 KB raw each
on Africa) cost 3–5 ms each to encode but compress to 1–9 KB.

World size 1000 on Africa (1,000,000 cells): `new Skirmish()` takes **6.8 s**
(RSS 336 MB, 444 MB after one minute). First-minute ticks are fine (mean 4.2 ms).
The lobby offers `worldSize: 1000` for every map.

### 3.5 What I could not or did not measure

- AI-only games. The AI never builds towers, walls or aircraft, so those costs are
  invisible here (section 4, WS3).
- One seed, one machine, Node not a browser. Browser main-thread cost, GPU, real
  network RTT and upload bandwidth were not measured.
- The commit-cycle slowdown in section 2 is inferred from component timings, not
  measured end to end.
- Server capacity per core. `MULTIPLAYER_MATCH_CAPACITY=1` is the current limit
  and the numbers above say it should stay there.

## 4. Workstreams

Ordering and gates are in section 5. "Exact" means the simulation state is
bit-identical to today's; "behavior change" means it is not and needs decision
D1.

### WS0. Determinism and performance harness (do first)

No optimization below should be merged without it. In my own prototype a naive
cache diverged from the baseline at minute 4 because forest clearing changes path
costs. That is the class of bug a hash check catches in minutes and a playtest
never will.

- **Golden-state test** in `tests/skirmish/`: fixed seed, fixed ticks, hash of
  owners, claims, squads, buildings, players and traders, compared with a checked
  in value. Use `thebox` and a 250-size heightmap map so it runs in CI without
  Git LFS. Intentional behavior changes update the golden and say why in the PR.
- **Perf harness** under `tests/perf/skirmish/`, promoted from
  `docs/perf/prototypes/profileMatch.mts`. Reports per-minute mean, p95, p99, max
  and slow-tick count, plus a state hash. Add the commit-pipeline harness from
  `commitPipeline.mts`.
- **Baselines** recorded for Africa, Amazon River and Heightmap Test 1 at size 500,
  minutes 3, 6, 9, 12, and for the commit pipeline at minute 5 and 8.

### WS1. Make hierarchical pathfinding cheaper

**1a. Cache the start-side local tree. Exact. Measured.**
`HierarchicalPaths.find` (`HierarchicalPaths.ts`, `localTree` at line 132) runs a
Dijkstra over the whole 32 × 32 start cluster, allocating fresh typed arrays, for
every query. Trade issues dozens of queries from the same factory tile. Memoize by
start tile (LRU, ~512 entries, about 6 KB each). **Every entry must be validated
against a per-cluster cost revision**, bumped in the existing `onCostsChanged`
handler that already clears portal trees. Without the revision, forest clearing
makes cached costs stale and the simulation diverges (observed at minute 4).
Hit rate in the prototype was 96–97%. Effect on World 500 × 250 (measured on the
pre-multiplayer code): total CPU −37%, p99 103 → 27 ms at minute 10. Re-verified
hash-identical on `main` (Africa, Heightmap Test 1).

**1b. Enable the hierarchy on mid-size maps. Behavior change. Measured.**
`Pathfinding.ts:54` builds the hierarchy only when `size > 65_536`. Amazon River
at size 500 is 62,500 cells, so every path is exact A\* and the map is the
slowest in section 3.1. Lowering the threshold to 16,384 cut minute-9 mean from
79.5 to 11.7 ms. Cost: hierarchical paths are near-optimal, not optimal, so routes
change on Amazon River (500) and on 250-size Africa. Alternative that keeps exact
paths: bound exact search by node count and cache results (1c), which I did not
measure.

**1c. Route result cache. Exact if done carefully. Analysis, not prototyped.**
99.2% of trade queries repeat a pair. Key by `(start, goal)` when no fortification
obstacle exists; otherwise add the owner, `Fortifications.version` and an alliance
revision (`Diplomacy` has no revision counter today, and gates depend on
alliances). Invalidate on any cost revision (77% hit rate measured as the floor).
Open question to settle before coding: whether any caller mutates the returned
array (`actor.path` is advanced by index in `Trade`, but check all call sites
before sharing arrays; otherwise return frozen copies).

**1d. Fewer trade queries. Exact. Not prototyped.**
`Trade.load` (`Trade.ts:193`) calls `destinations()` (`:94`) and the `select()` it
ends with (`:124`) calls it again. Reuse the shortlist for the first select; in later selects
filter to the remaining stops before routing; evaluate candidates in order of a
lower bound (Chebyshev distance is a valid lower bound on land path length, since
steps are 8-connected) and stop when the K-th best is below the next bound. Use a
strict comparison so ties still resolve by building id. Do not change the 64
nearest-candidate shortlist or the sort order; that changes the economy.

**1e. The abstract search itself. Needs a prototype.**
After 1a the hierarchy search is 32–45% of CPU in `HierarchicalPaths.find` self
time. Plausible causes, in the code: a fresh `visit` closure and result arrays per
call, a full clique scan of each cluster's portals for every expanded portal, a
heuristic that assumes the cheapest terrain everywhere (weak on forested maps), and
repeated `map.x/map.y` division in `estimate`. Try micro-optimizations first
(hoist closures, per-query heuristic cache, flat adjacency arrays), then a
stronger heuristic (landmarks) if needed. Target about 2×. Landmark distances need
the same cost-revision invalidation as 1a.

**1f. Budget route work by cost, not job count. Behavior change.**
`routeWork.drain(24)` (`Simulation.step`) runs 24 route _jobs_ per tick whatever
they cost. At roughly 1–3 ms per query on large maps that alone is a 24–70 ms
tick, which matches the early Heightmap profile. Give each job a cost estimate
(for example clusters crossed) and drain to a per-tick cost budget, keeping the
existing fair FIFO. Orders then start moving a few ticks later under load. Trade
routing sits outside this queue entirely; route its work through the same budget
once 1c/1d are in.

### WS2. Remove whole-map scans and per-tick allocation

**2a. `coastalDestination` iterates every tile. Exact. Measured.**
`Simulation.ts` (`coastalDestination`, around line 2743 on `main`) loops over all
cells and allocates a neighbour array for each land tile. Iterate a precomputed,
ascending list of land tiles that have a water neighbour (4,337 of 125,000 on
World 500 × 250; `CoastIndex` already exists and is the natural home). Keep the
inner neighbour order and the `d < distance` tie rule. In the older-code run it cut
AI think time 14.5 → 6.2 s and removed the 110–170 ms AI spikes every 3 s. The
scan is 4× worse at 1000 × 500 and 16× worse on Africa 1000.

**2b. `SpatialGrid.rebuild` clears every bucket ever allocated. Exact. Measured.**
It runs about 14 times per tick. Track buckets used since the last rebuild and
clear only those. **Register buckets inside `insert` from the very first call**:
my first prototype patched after construction and left stale entries (squads
that had died still answered queries). Effect: 5–17% off the mean.
Also skip the two `Trade.step` grid rebuilds when there are no traders.

**2c.** Allocation churn (`filter/sort/new Map` per tick, GC ~4–6% in profiles) is
real but secondary. Revisit after WS1.

### WS3. Fortifications (human-driven cost, not yet re-measured on `main`)

Earlier measurement on the pre-multiplayer code: three completed towers built by
one faction took the whole simulation from 3.7 to 10.9 ms per tick in an otherwise
identical game; 96% of the extra time was exact A\* fallbacks inside
`Trade.route`, not the line-of-sight checks. My tower placement was arbitrary
(first owned tiles), so treat the 3× as indicative. **Re-measure with
`towerEffect.mts` on `main` before implementing**, because Trade changed since.

Mechanism: `TilePaths.find` returns the hierarchical route only if it is free of
blocked tiles; otherwise it falls back to `findExact` with no expansion limit, up
to 64 times per trade load. Fixes, in order:

1. Memoize fallback results (key includes fortification version, owner, alliance
   revision) and add a deterministic node-expansion limit with deterministic retry
   (behavior change only for pathological enclosed goals).
2. `Fortifications.clear()` (line ~101): add a coarse obstacle-occupancy grid
   (for example 8 × 8 tile blocks marked if they hold any tower or barrier tile,
   including gates, as a conservative superset). If the segment's tile bounding box
   touches no marked block, return true. Exact, helps dense armies.
3. `blocked()` allocates a fresh `[]` per call (`?? []`); use a shared constant.
4. `Fortifications.step` compares the tower array length with a `Set` size, so two
   towers on one tile rebuild the whole obstacle index every tick. Compare unique
   tiles.

### WS4. Commit pipeline (the multiplayer hot path)

**4a. Drop `pressure` from the checkpoint. Exact. Trivial.**
`Simulation.capture()` calls `pressure.fill(0)` before any read; no reader exists
outside `capture()`. Remove it from `checkpoint()` and from the length check in
`restore()` (`Simulation.ts:121`). Saves one map-sized array and a few ms.

**4b. Stop serializing `ownedTiles`. Behavior change. Biggest single item.**
It is derived from `owners` and is 75% of upload and ~40 ms of encode. The catch:
insertion order of each `Set` is observable. `Expansion.ts:1074`
(`Array.from(ownedLand).slice(0, 256)`), `Expansion.ts:1195` and
`Simulation.ts:2703`, `:2919` iterate it. Recommended: make iteration canonical
(ascending tile id), rebuild the sets from `owners` on `restore`, and update the
golden hashes. This also removes a class of host/server divergence. The visible
change is which 256 tiles the AI considers for building sites. Alternatives if
that is unacceptable: serialize each set as an ordered `Uint32Array`, or include
it only in delta commits (4c).

**4c. Delta commits. Largest redesign.**
Host and server both already hold the last committed state. Send only what
changed: tile diffs for `owners/claims/progress` (reuse the logic in
`SnapshotEncoder`), full small sections (`squads`, `buildings`, `ships`, `players`
are 50 KB, 33 KB, 16 KB, 4 KB of JSON at minute 8), and per-section revisions for
slow-changing state (`expansion` supply, progression, diplomacy). Keep full
checkpoints for `host-restore`, new hosts and a periodic keyframe. Estimate
(unmeasured): 20–40 KB per commit instead of 200–260 KB, and server verify applying
a delta instead of decode plus restore. Build this after 4a/4b so the keyframe is
already small.

**4d. Binary transport.**
`CoordinatorServer` sends `JSON.stringify(message)` with the payload as a base64
string: +33% size and an extra encode/decode pass in both directions. Send state
payloads as binary WebSocket frames and keep JSON for control messages.

**4e. Measure what the commit cycle actually is.**
Add per-commit timings (host compute, serialize, upload, verify, broadcast), the
**game-time ratio** (simulated seconds per wall second), and queue age to
`LiveMatch` and expose them. Re-qualify hosts periodically with a measure that
includes serialization and upload, not 12 early ticks. Revisit the 3 s demotion
timeout against measured cycle p99.

**4f. Pipelining (design decision, after 4c).**
Allow the host to start the next batch while the server verifies the previous
one. It hides verify and download time from game time, but needs rollback if a
commit is rejected. Do not start it before the cycle is measured.

### WS5. Load time and map size

`new Skirmish()` on Africa 1000 × 1000 is 6.8 s and 336 MB. Every host worker
pays it, the server pays it per match, and a handover pays a decode on top. Either
hide `worldSize: 1000` in the lobby until this is fixed, or make the static work
(component labelling, hierarchy preparation, forest and resource fields) cacheable
per map and size so it is paid once per process, not per match.

### WS6. Client presentation (secondary now)

Packets arrive per commit (about 5 Hz), so the earlier concern about 20 Hz HUD
rebuilds is a quarter as large. What remains in `client/main.ts` `updateHud`: the
roster does `squads.filter` per player (O(players × squads)) and replaces
`innerHTML` every packet; hidden panels are rebuilt. Update on change or at a
fixed 4–5 Hz. Separately, `Renderer` interpolates over a fixed
`(tickGap × 50)` ms from arrival time; if commit cycles vary (200–400 ms) units
will reach the target, stall, then jump. Interpolate over a smoothed inter-arrival
time instead. Both need a browser measurement before and after; none was taken.

### WS7. Operations

Expose and alert on: tick p50/p99/max per match, slow-tick count, commit cycle
and its parts, game-time ratio, checkpoint bytes, host demotions, handover count,
worker RSS. Keep `MULTIPLAYER_MATCH_CAPACITY=1` until a load test on the chosen
Render plan shows otherwise. Server-fallback execution (server as executor) pays
sim + checkpoint + encode + decode + restore in one process, which at minute 8 is
about 60–100 ms of sim plus 120–180 ms of serialization per 200 ms commit before
fixes; it cannot host a late-game match today.

## 5. Sequencing and gates

| Phase                  | Work                                              | Gate                                                                                                                   |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0                      | WS0 harness and goldens                           | Goldens pass on `main`; baselines recorded                                                                             |
| 1 (exact, quick)       | 1a, 2a, 2b (incl. skipping empty Trade grids), 4a | Goldens unchanged. Africa 500 minute 10 mean ≤ 25 ms (measured 23.4 for the first three)                               |
| 2 (decisions D1 taken) | 1b, 1c, 1d, 1f, 4b                                | Tick p99 < 50 ms and max < 100 ms through minute 12 on all three maps at 500 (proposed target, not yet shown feasible) |
| 3 (protocol)           | 4c, 4d, 4e                                        | Upload ≤ 60 KB p95 at minute 10; host commit CPU ≤ 25 ms; server verify ≤ 25 ms p95; game-time ratio ≥ 0.98            |
| 4                      | 1e, WS3, WS5, WS6, WS7, 4f                        | Per-item, using the harness                                                                                            |

Run phase 1 now: it is small, exact and needs no decisions. Phases 2 and 3 are
independent enough to run in parallel by different people once WS0 exists.

## 6. Decisions needed

- **D1. Behavior changes before launch.** Are you willing to change gameplay-visible
  behavior now (hierarchy on mid-size maps, canonical `ownedTiles` order,
  cost-based route budget, trade ordering ties) in exchange for tick stability? No
  public matches or replays exist yet, so this is cheapest before launch. After
  launch each one needs a rules revision. Recommendation: yes, and add an explicit
  `rulesRevision` to the match manifest at the same time.
- **D2. `worldSize` 1000.** Hide it in the lobby until WS5, or accept the load time?
- **D3. Who runs the simulation.** Verification currently costs the server about
  as much as running the ticks would (decode + restore ≈ 65 ms vs about 60 ms of sim
  per commit at minute 8 after the three fixes), it does not check simulation
  correctness, and it needs a 1+ MB/s host upload. A server-run simulation
  broadcasting the existing shared delta snapshot would cost the server the sim plus
  about 0.5 ms of encoding, and removes the host trust and bandwidth problems, at
  the price of server CPU per match. I would not decide this until 4c numbers
  exist, but it should be decided deliberately, not by default.
- **D4. Pipelining** (4f): needed, or is a ≥ 0.98 game-time ratio after 4c enough?

## 7. Reproducing the numbers

From the repo root, with Git LFS maps pulled
(`git lfs pull --include="resources/maps/*"`), after `npm ci --ignore-scripts`:

```bash
mkdir -p /tmp/perf-out
# per-minute tick stats + state hash; PATCH selects prototype fixes (tree,coast,grid)
PATCH= node --import tsx docs/perf/prototypes/profileMatch.mts africa 500 19 0 12 base
PATCH=tree,coast,grid node --import tsx docs/perf/prototypes/profileMatch.mts africa 500 19 0 12 fixed
# trade query counts, hit-rate analysis
PATCH=tree,coast,grid node --import tsx docs/perf/prototypes/profileTrade.mts africa 500 19 0 10 trade
# host/server commit pipeline cost and checkpoint composition
node --import tsx docs/perf/prototypes/commitPipeline.mts africa 500 8
node --import tsx docs/perf/prototypes/checkpointParts.mts
# CPU profile: add `--cpu-prof --cpu-prof-dir=/tmp/perf-out/prof` before --import, then
node docs/perf/prototypes/summarizeCpuProfile.mjs /tmp/perf-out/prof/ < file > .cpuprofile
```

Arguments are `map size aiCount tribes minutes label`. The prototype patches in
`profileMatch.mts` are the reference implementation for 1a, 2a and 2b; read them
for the revision validation and active-bucket details. They are measurement
scaffolding, not production code. `amazon-river` at size 500 is below the
hierarchy threshold, so the `tree` patch is skipped there by design.
