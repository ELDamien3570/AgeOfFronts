# 11 - Procedural map generation and terrain (round 2)

Reviewer area: procedural map generation, terrain fields, cross-browser determinism of the map hash, generation cost, spawn/resource fairness, latent bugs.
Tree reviewed as it is on 2026-10-16 (working tree, not HEAD). Every line number below was re-checked with `grep -n` / `cat -n` on the current files.

Measurement host: AMD Ryzen 7 3700X (the "desktop" of the brief; ARM ~ desktop / 0.4), Node v24.18.0 (V8 13.6.233.17-node.50), Chrome 155.0.8059.82, Edge 155.0.4283.45, Firefox 155.0.1 (all headless, local). Scratch scripts live in the session scratchpad `mapgen/` (one.ts, prep*.mts, perturb.mts, fair.mts, fit.mts, resolve.mts, xb/ cross-browser harness). Nothing in the repository was modified except this file.

## Scope read

Read fully:
- `src/skirmish/ProceduralMaps.ts` 1-14, `Terrain.ts` 1-121, `Elevation.ts` 1-127, `Environment.ts` 1-378, `EnvironmentData.ts` 1-32, `Geography.ts` 1-62
- `ForestGeneration.ts` 1-65, `Forest.ts` 1-114, `ResourceTerrain.ts` 1-36, `ResourceGeography.ts` 1-139, `HeightmapMap.ts` 1-151, `TerrainNoise.ts` 1-18
- `ContinentsLayout.ts` 1-669, `ContinentsMap.ts` 1-202, `MigrationLayout.ts` 1-514, `MigrationMap.ts` 1-159, `MigrationCoast.ts` 1-156, `MigrationHydrology.ts` 1-121, `MigrationTopography.ts` 1-8, `MigrationValleyRoute.ts` 1-127
- `BlackForestLayout.ts` 1-223, `BlackForestMap.ts` 1-214, `BlackForestTopography.ts` 1-37
- `RegionalClimate.ts` 1-61, `RegionalTopography.ts` 1-234, `TerrainDissection.ts` 1-148, `TerrainDrainage.ts` 1-119, `TerrainErosion.ts` 1-53, `TerrainFormation.ts` 1-210, `TerrainPriorityQueue.ts` 1-74, `TerrainShoreDistance.ts` 1-50, `RiverCrossings.ts` 1-25, `CoastIndex.ts` 1-47
- `content/Maps.ts` 1-112, `content/Migration.ts` 1-71, `content/Continents.ts` 1-79, `content/BlackForest.ts` 1-35
- `multiplayer/infrastructure/ServerMap.ts` 1-67, `multiplayer/application/MapIdentity.ts` 1-49
- `StartingPositions.ts` 1-39, `domain/SpawnSelection.ts` 1-147, `domain/StartingResources.ts` 1-322, `domain/DepositGeneration.ts` 1-141
- `src/core/PseudoRandom.ts` 1-80

Read in part (context): `client/main.ts` 480-510, 795-830; `client/OnlineMatchSession.ts` 300-380; `multiplayer/infrastructure/serverMatchWorker.ts` 50-75, 110-215; `multiplayer/infrastructure/ReservedMatchWorker.ts` 15-90; `multiplayer/application/LiveMatch.ts` 130-200, 500-560, 625-640; `multiplayer/infrastructure/CoordinatorServer.ts` 460-485; `lobby/LobbyDirectory.ts` 1-160; `lobby/LobbyRules.ts` 1-41; `FactionRules.ts` 27-94; `domain/FactionRoster.ts` 1-60; `domain/Supply.ts` 160-185; `Simulation.ts` 775-800, 1005-1060; `src/core/game/GameMap.ts` 120-260.
Round-1 notes consulted: `05-balance-economy.md` (Starting economy and positions, issue 11, recommendation 8), `08-latent-bugs.md` refuted table (1697-1726), `08c-sweep-determinism.md` (randomness section). No round-1 reviewer covered map generation.

## How it works today

### Load paths (server and client take the same code path)
- Procedural maps (`black-forest`, `migration`, `continents`, `content/Maps.ts:62-84`) are generated from `(mapId, worldSize, seed)` by `generateProceduralMap` (`ProceduralMaps.ts:12-14`).
  - Server: `loadServerMap` calls it first (`multiplayer/infrastructure/ServerMap.ts:17-31`), inside the `prepare` request of the match worker (`serverMatchWorker.ts:131-147`), then builds `SpawnSelection` and hashes the map with `mapIdentity` (`:145-147`).
  - Client: `loadMap` calls the same function first (`Terrain.ts:50-51`) on the **browser main thread** (`client/main.ts:52` import, `:811` online, `:493` solo), then `OnlineMatchSession` hashes the result and throws `"Map versions differ. Reload after deployment."` on mismatch (`client/OnlineMatchSession.ts:346-356`). The seed comes from the manifest (`manifest.options.seed`), which the server drew with `Math.random()` (`LiveMatch.ts:150`).
- Heightmap maps (Mediterranean = `heightmap-test1`, Africa, ...): terrain bytes and `heights.f32` are shipped as files; both sides call `decodeHeightmap` (`HeightmapMap.ts:31-118`; server `ServerMap.ts:32-66` via `readFile`, client `HeightmapMap.ts:120-151` via `fetch`). Both then derive forest cover (`ForestGeneration.ts:13`) and the desert mask (`ResourceTerrain.ts:22`) from an `EnvironmentProfile` computed locally (`Environment.ts:140-339`). So even heightmap maps have a computed, hashed component (forest cover, desert), but it is quantised to bytes.
- `mapIdentity` hashes a JSON header plus: terrain bytes, the raw Float32 elevation bytes, forest cover bytes, desert mask, the 8-byte-per-tile suitability table and the marine mask (`MapIdentity.ts:3-49`). Environment families/moisture/vegetation (used by the renderer) are *not* hashed.

### Procedural pipeline (Migration; Continents is analogous)
1. Landmass shapes: signed coast field `migrationCoastDistance` = harmonic radius (`Math.sin`) at `Math.atan2` angle minus `Math.hypot`, plus noise and cove/mouth capsules (`MigrationCoast.ts:98-156`); stamped per tile into `regions` (`MigrationLayout.ts:106-140`). Mainland channels are routed with an A* on a 250-grid (`MigrationValleyRoute.ts`) and accepted only if they split the mainland (`MigrationLayout.ts:179-258`); outer islands on a ring (`:337-357`), small islands by rejection sampling (`:358-401`); enclosed pools are folded into land (`:403-462`).
2. Heights: `createRegionalTopography` (ranges/massifs/plateaus with `Math.exp`, `Math.sin`, `Math.hypot`, final `Math.tanh`, `RegionalTopography.ts:131-232`), stored in a `Float32Array`; then `formTerrain` (branch spurs with `exp`/`atan2`/`cos`/`sin`, a 250-grid stream-power pass, bilinear transfer, `TerrainFormation.ts:23-210`), `dissectTerrain` (ridged noise + 2 drainage passes, `TerrainDissection.ts`), thermal erosion (`TerrainErosion.ts`), sea shelf with `Math.exp` (`MigrationLayout.ts:474-495`) and river carving from Priority-Flood drainage (`MigrationHydrology.ts`, `TerrainDrainage.ts`).
3. Classification: slope via `Math.hypot`, terrain byte 133/143/153/159, woodland cover, moisture, families (`MigrationMap.ts:43-117`).
4. Resource geography: 129x129 province grid with `Math.cos/sin/exp` and `** 3`, then per-tile weights with `Math.hypot` and `** 3`, rounded to bytes (`ResourceGeography.ts:45-138`).
5. Deposits are rolled at match start from the suitability table with an integer hash (`domain/DepositGeneration.ts:21-26, 110-120`); each faction gets a starting floor (`domain/StartingResources.ts:15-301`).

### Spawns
`SpawnSelection` builds candidates (every tile with a walkable 3x3 patch, a landmass of >= 80 tiles and a `startingCamp`, at least 6 tiles from the edge, `domain/SpawnSelection.ts:69-84`). Humans may reserve a tile during a 10 s window (`SPAWN_SECONDS`, `:48`); reservations need only `(2*6+4)` = 16 tiles from other human reservations (`:109-117`). `resolve()` (`:149-185`) seeds `StartingPositions` with `PseudoRandom(seed + attempt*104729)`, adds human reservations, then picks AI and tribes **uniformly at random** among candidates whose clearance is >= radius + 4 (`StartingPositions.ts:23-37`); humans who did not choose are placed the same way.

## Strengths
- All PRNG use is sfc32 (`src/core/PseudoRandom.ts`, 32-bit integer ops) with per-purpose XOR-salted streams (generators, `FactionRoster.ts:24-26`, deposits use a stateless integer hash). No `Math.random` on the generation path.
- Generation is a pure function of `(mapId, size, seed)`; server and client run literally the same functions; the client verifies with SHA-256 before playing. 375 seeds at 250 (125 per procedural map, including 0, 2^31-1, 2^30, 65535, 65536) all generated without error and with unique hashes.
- Intermediate height fields live in `Float32Array`s, and most outputs are rounded to bytes. This quantisation is what currently makes cross-engine results agree (see Issue 1).
- `TerrainPriorityQueue` is a fully ordered heap (priority, secondary, tile) so drainage is independent of insertion order; `terrainShoreDistance` is an exact O(n) Felzenszwalb EDT using only `sqrt` (correctly rounded everywhere).
- Validation is thorough: generators reject unknown sizes and seeds (`MigrationMap.ts:18-24`, `ContinentsMap.ts:51-57`, `BlackForestLayout.ts:37-43`), `ElevationField` rejects out-of-range samples (`Elevation.ts:26-45`), `SkirmishMap` rejects forest on water (`:90-98`).
- The starting resource floor (`StartingResources.ts:140, 235-268`) gives every faction one site of each mineral plus oil and **horses** (the `"horses"` entry at `:237` is part of the floor), allocated constrained camps first (`:80-107`). This corrects 05-balance-economy issue 11, which says horses are not in the floor.
- Heightmap maps fit the maximum lobby roster (20 humans + 14 AI + 30 tribes) at 250 on Continents, Black Forest, Mediterranean, Africa, Old World and Middle East (3 seeds each, `fit.mts`). Only Amazon River 250 and Migration 250 need the `MAP_CAMP_LIMITS` budget, and both have one (`lobby/LobbyRules.ts:30-34`).

## Issues

### 1. Map identity depends on engine libm results; protected only by Float32/byte quantisation (latent cross-browser join failure)
- Where: transcendental calls on the hashed path. Migration/Continents shapes: `MigrationCoast.ts:9, 26-27, 42-43, 61-65, 83-84, 105-109, 120, 128-136, 151`; `ContinentsLayout.ts:90-103, 126, 160-168, 262-286, 428, 445, 460-478, 506, 556-561, 626`. Heights: `RegionalTopography.ts:166-187, 211` (`Math.tanh`), `TerrainFormation.ts:85-119`, `TerrainErosion.ts:38`, `TerrainDrainage.ts:83, 91` (`Math.hypot`, `Math.pow(.,2)`), `TerrainDissection.ts:49, 67`, `MigrationLayout.ts:480` (`Math.exp`), `MigrationHydrology.ts:100`, `MigrationValleyRoute.ts:17-18, 57, 83-86`. Classification: `MigrationMap.ts:41-48`, `ContinentsMap.ts:71-80, 107`, `BlackForestLayout.ts:74, 121-177, 195`, `BlackForestMap.ts:93-131, 178`. Resources: `ResourceGeography.ts:61-66` (cos, sin, exp), `:80` and `:108` (`** 3`), `:99` (hypot). Heightmap environment: `Geography.ts:13` (`atan`, `sinh`), `:54` (`asinh`, `tan`), `RegionalClimate.ts:55` (`hypot`). Hashed bytes: `MapIdentity.ts:25-37` (raw Float32 elevation included).
- Severity: medium. Confidence: mechanism CONFIRMED (executed); real-world mismatch rate SUSPECT (low).
- Evidence (executed):
  - Engine libm differs today. Over 200,000 inputs, relative to Node 24 (the server): Firefox 155 differs on `sin`/`cos` 2.4 %, `tan` 4.1 %, `Math.hypot` 35.4 % (up to 2 ulp), `x ** 3` 26.2 %; Chrome/Edge 155 differ on `sin`/`cos` 3.4 %, `tan` 3.7 %, `atan2` 17.9 %, `exp` 9.8 %, `tanh` 9.5 % (up to 2 ulp), plus `log`, `sinh`, `atan`, `asinh`, `log2` fingerprints. So even Chrome's V8 is not bit-identical to the server's V8 build. `sqrt` and `Math.pow(x, 2)` are identical everywhere. None of the differing values changed after `Math.fround`.
  - Yet all 13 cases matched the Node hash in Firefox, Chrome and Edge: Migration 250 seeds 1-4, Continents 250 seeds 1-2, Black Forest 250, Migration/Continents/Black Forest 500, Mediterranean 500 and 1000, Africa 500.
  - Worst-case stress (`perturb.mts`): wrapping Math.sin/cos/tan/atan2/exp/tanh/hypot/pow/log/log2/sinh/atan/asinh so that **every** result is off by 1 ulp changed the map hash in 6 of 120 maps (Migration 250: 2/30; Continents 500: 3/8, where terrain bytes, forest and suitability also changed; Continents 1000: 1/2). At a 20 % perturbation rate (close to real engines), 0 of 20 Continents 500 maps changed.
- Mechanism: values are computed in double precision, then stored to `Float32Array` heights or rounded to bytes. A 1-ulp double difference survives a Float32 store with probability about 2^-29 per store, so most runs agree. When it does survive, threshold logic (`TerrainDrainage.ts:72-96` equality tests, erosion `drop > excess`, river/lake carving) can cascade it into terrain bytes. Elevation is hashed as raw Float32, so a single changed sample changes the identity. The risk grows with tile count and with how far an engine's libm differs. Safari/JavaScriptCore (Apple libm) and the ARM64 server build (compiler FMA contraction in V8's C++ libm) are untested and plausibly differ again.
- Consequence: an affected player gets "Map versions differ. Reload after deployment." (`OnlineMatchSession.ts:355-356`). Reloading regenerates the same bytes, so that player cannot join that match on that browser. There is no fallback. It is rare today but not bounded, and a browser update can change it at any time. Heightmap maps are practically safe, because only byte-rounded forest and desert fields depend on libm.
- Repro sketch: `npx tsx scratchpad/mapgen/perturb.mts orig 1.0 continents 500 4 5 6` vs `... perturb 1.0 continents 500 4 5 6`: the identities differ. Cross-browser: `scratchpad/mapgen/xb/` (esbuild bundle + local POST collector + headless Firefox/Chrome/Edge).

### 2. Procedural generation at 1000 approaches or exceeds the 30 s worker request timeout on ARM; 2000 always exceeds it
- Where: `ReservedMatchWorker.ts:68-72` (30 s per request), `serverMatchWorker.ts:131-147` (generation + SpawnSelection + hash run inside one `prepare` request), `CoordinatorServer.ts:475-482` (a failed prepare ends the match), `LobbyDirectory.ts:87-92` (2000 allowed for procedural maps), `client/main.ts:484-485` (client accepts 2000 for procedural maps).
- Severity: high (Migration 1000 is the owner's target map). Confidence: CONFIRMED on desktop; the ARM figures are extrapolated with the brief's 0.4 ratio.
- Evidence: full `prepare` in a Worker with `maxOldGenerationSizeMb: 384` (`prep.mts`), seed 1, desktop:

  | map | 500 | 1000 | 2000 | ARM estimate at 1000 / 2000 |
  |---|---|---|---|---|
  | Migration | 2.5 s (gen 2.1 + spawn 0.4) | 10.8 s (9.1 + 1.6) | 47.0 s (41.7 + 5.2) | ~27 s / ~118 s |
  | Continents | 3.3 s | 15.3 s (12.8 + 2.4) | 80.6 s (70.5 + 10.0) | ~38 s / ~200 s |
  | Black Forest | 6.4 s | 18.2 s (13.0 + 5.2) | 67.1 s (50.7 + 16.3) | ~46 s / ~168 s |
  | Mediterranean (heightmap) | 0.6 s | 2.3-2.5 s | n/a | ~6 s |

  Per-seed variance at 250 is about 3x (median 1.1-1.7 s, max 3.0-4.0 s over 125 seeds), so the slow tail at 1000 is worse than seed 1. Peak RSS: 236-256 MB at 1000 and ~500 MB at 2000 (single process). The 384 MB old-generation cap was not hit at 2000.
- Consequence: on the 2-CPU ARM host, Continents and Black Forest at 1000 time out ("Match executor timed out during prepare") and Migration 1000 sits at the limit, worse when two matches prepare at once. Every 2000 match fails. The lobby offers these sizes without warning.
- Client side: the same work runs on the browser main thread (`client/main.ts:811`). Chrome took 1.8-2.3 s at 500 and Firefox 2.1-3.9 s. At 1000 expect 6-15 s of frozen UI, and at 2000 tens of seconds (browser "page unresponsive" dialog), counted against the 60 s load deadline (`LiveMatch.ts:188-189, 631-637`).
- Hotspots (CPU profiles at 1000): Migration: `migrationCoastDistance` 31.5 % self + 6.4 % in its `coastRadius` reduce closure, `RegionalTopography` sample 23 %, GC 18.7 % (closures and `{tile, priority, secondary}` objects). Black Forest: `buildTerrainDrainage` 20.5 % + `TerrainPriorityQueue.pop/push` 20.5 %, `dissectTerrain` 19.3 %, `RegionalTopography` 18.7 %, `erodeTerrainSlopes` 8.1 %. One cause is `MigrationLayout.ts:124-131`, which evaluates the full coast field of every other island for every tile of every island stamp. Another is `MigrationCoast.ts:105-106`, which recomputes `cos`/`sin` of the rotation on every call.

### 3. Spawn selection cost scales with map area; every human click reruns the full placement, serially, under the same 30 s timeout
- Where: `StartingPositions.ts:16-22` (`add` scans **all** candidates per placed camp), `:23-37` (`next` scans all candidates twice), `SpawnSelection.ts:121-134` (`select` calls `resolve()` for all 52-64 factions), `LiveMatch.ts:510-533` (no per-guest rate limit), `ReservedMatchWorker.ts:64-72` (backlog 8, 30 s timeout per request).
- Severity: medium. Confidence: CONFIRMED (timed); timeout cascade SUSPECT (not reproduced on ARM).
- Evidence (`resolve.mts`, desktop, 8 humans + 14 AI + 30 tribes): Black Forest 1000 has 976,144 candidates; constructor 2.1 s, `resolve` 2.4 s, one `select` 2.4 s. Migration 1000 has 273,111 candidates; 1.1 s / 0.69 s / 0.49 s.
- Consequence: on ARM a Black Forest 1000 click costs about 6 s of worker time. Eight humans clicking in the 10 s window queue up to 8 requests. The last one waits about 42 s, which exceeds its 30 s timer. The executor then terminates and the match dies at the spawn screen. On Migration 1000 the queue costs about 8 s of spawn-UI lag.

### 4. Random spawns give 8 humans very unequal land, coast and deposit access (quantifies 05 issue 11)
- Where: `StartingPositions.ts:23-37` (uniform sampling), `SpawnSelection.ts:109-117` (16-tile minimum between human reservations), `:170-178` (AI and tribes need only radius + 4 clearance from humans).
- Severity: medium (design). Confidence: CONFIRMED (measured, `fair.mts`, every human placed by `resolve`, 8 humans + 14 AI + 30 tribes).
- Evidence, per match, across the 8 humans (min-max):
  - Mediterranean 500, seeds 1-6:
    - walkable Voronoi land share: max/min 3.4-14.8x
    - land within 40 steps: 2.5-7.9x
    - coast tiles within 40 steps: 0 for at least one human in 5 of 6 seeds, while others have 136-199
    - BFS distance to water: 3-68 tiles
    - world deposits within 36 steps: 0-9
    - nearest other faction: 16-54 tiles
  - Migration 500, seeds 1-4: land-share ratio 4-22.7x, land within 40 steps 3.5-12.8x, nearest faction 16-159 tiles.
  - Continents 500, seeds 1-3: land-share ratio 4.8-9.5x.
  - Migration 1000, seed 1: land-share ratio 103x (one human alone on a large landmass), and one human has no coast within 40 steps.
- Consequence: humans who do not click in the 10 s window, or click late, get a start that can be landlocked or squeezed between three tribes 16 tiles away. With 52 factions the first-come advantage in the spawn UI is large. The starting resource floor equalises *presence* of every resource; the random world roll adds 0-9 extra deposits per human (`DepositGeneration.ts:110-120`).

### 5. Black Forest layout, the simulation master RNG and spawn attempt 0 share one PRNG stream
- Where: `BlackForestLayout.ts:44` `new PseudoRandom(seed)`, `Simulation.ts:789` `new PseudoRandom(options.seed)`, `SpawnSelection.ts:154-156` `new PseudoRandom(this.options.seed + Math.imul(0, 104729))`, all with the same seed (`LiveMatch.ts:150`).
- Severity: low. Confidence: CONFIRMED (code read).
- Mechanism: the k-th spawn pick on Black Forest is `floor(r_k * count)`, where `r_k` is also the k-th clearing-shape draw (the first is clearing 0's `extent`). Camp choice is therefore statistically coupled to the map layout. Every other generator salts its stream (`^ 0x29fa8371`, `^ 0x472bf319`, `^ 0x5a3c91e7`, ...). The same pattern makes `Simulation.random` a replica of spawn attempt 0 on every map. It is harmless today (08c: `this.random` is only consumed at construction), but it is a trap for future runtime use.

### 6. Unlucky-seed and range invariants abort the match instead of re-rolling
- Where: `MigrationLayout.ts:257` `throw "Migration could not separate the mainland"` (12 channel attempts, `content/Migration.ts:24`), `:330` (no mainland), `TerrainDrainage.ts:104-106` (land without outlet), `Elevation.ts:39-45` (any sample outside `[minimum-0.01, maximum+0.01]`), `BlackForestMap.ts:164` (`bed = heights[centre] - 3` checked against `minimum: 0` at `:185`), `StartingPositions.ts:27-30` ("Not enough room"), caught only by `CoordinatorServer.ts:475-482`, which ends the match.
- Severity: low. Confidence: SUSPECT (no failing seed found).
- Evidence: 375 seeds at 250 and 8 seeds at 500 for each map generated without error. Black Forest heights over 40 seeds at 250 stay within [21.1, 1000.1] against the calibrated [0, 1200], and the lowest pond bed is 42.2. The margins are comfortable but nothing enforces them: `formTerrain` clamps to 5800 (`TerrainFormation.ts:201-207`), not to the theme's 1200.
- Consequence: if a seed (likely at 1000/2000, which were barely sampled) hits one of these throws, the whole lobby gets "Unable to initialize match" with no automatic retry. The seed is not logged (08c I5), so it cannot be reproduced.

### 7. Map edge: Migration outer islands are clipped by the map border
- Where: `MigrationLayout.ts:340-355`: ring radius `size * [0.455, 0.48] / max(|dx|, |dy|)` from the centre, island radius up to `0.073 * 1.18 * size`; stamp bounds clamp to `[0, size)` (`:97-104`).
- Severity: low (presentation/gameplay oddity). Confidence: CONFIRMED (geometry; visible in land touching the edge).
- Consequence: corner and edge islands have straight cut coastlines and land on the outermost row and column. Spawns exclude a 6-tile band (`SpawnSelection.ts:69-70`), so this only affects aesthetics and edge approaches. Continents forces a water border (`ContinentsLayout.ts:590-598`) and Black Forest forces a woodland border (`BlackForestLayout.ts:216-220`), so Migration is the odd one out.

### 8. The hash omits the renderer's environment fields; clients can render different biomes without detection
- Where: `MapIdentity.ts:5-37` hashes terrain, elevation, forest and resources, but not `environmentData` (families, moisture, vegetation, aridity) built at `MigrationMap.ts:100-116`, `ContinentsMap.ts:128-167`, `BlackForestMap.ts:62-75`, which `Renderer.setMap` consumes (`client/main.ts:814`).
- Severity: low. Confidence: CONFIRMED (code read).
- Consequence: cosmetic only, because these fields do not reach the simulation, except where they feed forest and desert, which are hashed. Worth knowing when choosing what to ship (Recommendation 1).

### 9. Memory duplication of large fields
- Where: `Elevation.ts:46` (`values.slice()`), `:82-86` (resource arrays sliced), `Forest.ts:100` (cover sliced). Generators build `bare` and then `map` (`MigrationMap.ts:127-141`), and `ServerMap`/`makeMap` construct another `SkirmishMap` (`serverMatchWorker.ts:58-66`).
- Severity: low. Confidence: CONFIRMED.
- Consequence: at 2000 the suitability table alone is 32 MB and is copied 2-3 times; client RSS during generation reached about 500 MB in Node. The 384 MB worker cap survived, but low-memory browsers (tablets) at 1000/2000 are at risk.

## Recommendations

1. **Make generation bit-exact by construction (about 1 day; fixes Issue 1).**
   - Add `src/skirmish/DeterministicMath.ts` with `dsin`, `dcos`, `datan2`, `dexp`, `dtanh`, `dhypot` and `cube`, written only with `+ - * /`, `Math.floor`, `Math.abs` and `Math.sqrt`. ECMAScript requires every basic operation to be individually rounded, and engines never fuse them, so these are identical on every engine.
     - sin/cos: range reduction by Cody-Waite with 2 constants plus a degree-13/12 minimax polynomial, accurate to well under 1e-15 over |x| < 1e4; or a 4096-entry table plus a cubic correction.
     - atan2: octant reduction plus a degree-15 polynomial.
     - exp: `2^k * p(r)` with `k = Math.round(x / ln2)` and the result built by repeated multiplication or a 2^k table.
     - tanh: `(e2 - 1) / (e2 + 1)` with `e2 = dexp(2x)`.
     - hypot: `Math.sqrt(x*x + y*y)` (no overflow at these magnitudes).
     - cube: `x*x*x`.
   - Replace every call site listed in Issue 1, including `**` at `ResourceGeography.ts:80, 108`. Bump `MIGRATION_THEME.revision` (8 to 9), `CONTINENTS_THEME.revision` (1 to 2) and `BLACK_FOREST_THEME.revision` (4 to 5).
   - Add an oxlint `no-restricted-properties` rule for `Math.{sin,cos,tan,atan2,atan,exp,log,pow,tanh,sinh,asinh,hypot,cbrt}` scoped to the generator files.
   - Add `tests/skirmish/MapIdentityGolden.test.ts` pinning `mapIdentity` for {3 maps x 250/500 x 3 seeds} and Mediterranean 500. A browser job (Playwright with firefox and webkit) running the same bundle would make this a CI guarantee.
   - Trade-off: all procedural maps change once; generation speed is about the same (polynomials are as fast as libm).
2. **Add a byte fallback on hash mismatch, and ship bytes for large maps (1-2 days; belt and braces for Issue 1, removes client cost for Issue 2).**
   - The server already holds the `RuntimeMap`. Cache it per match as one blob: terrain, f32 elevation, forest, desert, suitability, marine and the four environment bytes. That is about 16 bytes per tile: 1 MB at 250, 4 MB at 500, 16 MB at 1000 raw, roughly 30-40 % after gzip because elevation compresses poorly. Delta-coding the Float32 bit patterns row-wise first reaches about 20 %.
   - Serve it over HTTP (`GET /skirmish/match/{id}/map/{mapHash}.bin`, immutable cache) rather than the WebSocket.
   - Client: if the local hash mismatches, or if size >= 1000, fetch the blob, verify the SHA-256 and build the `LoadedMap` from it (layout metadata such as rivers and islands is optional for rendering).
   - Trade-off: server memory, about 16-24 MB per 1000-map match during the loading window; free it once all seats have loaded.
3. **Get prepare under the timeout (Issue 2).**
   - (a) Immediate, 1 hour. Give `prepare` its own timeout (e.g. 150 s) in `ReservedMatchWorker.request`; keep 30 s for tick requests. Hide or disable 2000 in the lobby (`LobbyDirectory.ts:91`) until (c) lands. Show a warning on 1000 procedural maps.
   - (b) Half a day, keeps output identical.
     - `MigrationLayout.ts:124-131`: test a bounding box (`bounds(other)` expanded by 4) before calling `migrationCoastDistance` for other islands.
     - `MigrationCoast.ts:105-106`: precompute `cos`/`sin` per landmass, and replace the `reduce` at `:7-11` with a loop.
     - `TerrainPriorityQueue`: rewrite as typed arrays (`Int32Array` tiles, `Float64Array` priority/secondary, grown by doubling) with a `pop` that writes into fields instead of allocating an object.
     - Expect about 35-50 % less generation time. Profile again with `--cpu-prof`.
   - (c) 1-2 days, changes output (revision bump). Evaluate the `RegionalTopography` landform sum on a coarse grid (e.g. 512²) and interpolate, with noise detail per tile. Cull features beyond 3 widths (`exp(-d²·1.5) < 1e-5`).
   - (d) Optional. Pre-generate a pool of seeds per (map, size) in an idle low-priority worker and store the blobs from Recommendation 2. A match picks a pooled seed, so prepare becomes a file read.
   - Tests: a perf budget test (`generateMigration(1000, s)` under 4 s on CI hardware, skipped when slow) and a regression test checking that the hash for fixed seeds is unchanged after (b).
4. **Make spawn placement O(local) (Issue 3, half a day).**
   - In `StartingPositions.add`, update clearance only inside a window of radius `maxRadius + maxClearance` (about 16-20 tiles) around the new camp. Iterate the window, and skip non-candidates via `viable`.
   - In `next`, keep `eligibleCount` up to date incrementally and sample by rejection (draw a random candidate index, accept if eligible, with a linear fallback after 64 misses).
   - Rate-limit `select-spawn` to one in-flight request per guest in `LiveMatch.selectSpawn`.
   - Expect about 52 x 1,300 window cells instead of 52 x 976k candidates, i.e. under 10 ms at 1000.
   - Changes placements for a given seed: update `SpawnSelection.test.ts` and the `MAP_CAMP_LIMITS` measurements.
5. **Balanced human starts (Issue 4 and 05 issue 11, 1-2 days).** In `SpawnSelection`, before the spawn window:
   1. Score each candidate on a coarse grid (every 4th tile) with `S = (L40, C40, D36, E)`:
      - `L40` = walkable tiles within 40 BFS steps
      - `C40` = coast-adjacent tiles within 40 steps
      - `D36` = summed suitability within 36 steps
      - `E` = distance to the map edge
   2. Generate 64 seeded configurations of `H` human sites by farthest-point sampling from a random start among candidates with `L40 >= p40(L40)`.
   3. Keep configurations whose minimum pairwise distance is `>= 0.8 * sqrt(landArea / (H + AI))` and in which either all or none of the sites are coastal (`C40 >= 30`).
   4. Choose the one that minimises `max/min` of `L40` and `D36`.
   5. Offer these `H` sites as highlighted suggestions. Assign them to humans who do not click, instead of a uniform draw.
   6. Then place AI with clearance `>= 30` and tribes `>= 22` from any human site, instead of radius + 4.

   - Cost: 64 x 8 BFS of radius 40 (about 2.5 M steps, under 100 ms).
   - Test `SpawnFairness.test.ts`: over 12 seeds on Mediterranean 500 and Migration 500, `max/min(L40) <= 1.35`, coastal parity holds, and no human is within 30 tiles of another faction.
   - Lobby toggle "balanced starts" (default on for public lobbies).
6. **Separate streams and re-roll bad seeds (Issues 5-6, 1-2 hours).**
   - Salt `BlackForestLayout.ts:44` (`seed ^ 0x3c6ef372`), `Simulation.ts:789` and `SpawnSelection.ts:154` (e.g. `seed ^ 0x51ed270b`). Bump the Black Forest revision.
   - In `serverMatchWorker` prepare, catch generation and placement errors and retry with `seed = (seed * 1103515245 + 12345) & 0x7fffffff` up to 3 times, then report.
   - Log `{mapId, size, seed, mapHash, genMs}` on every prepare (also requested by 08c I5).
   - Clamp Black Forest heights to `[1, 1150]` before building the `ElevationField`, rather than trusting the 200 m margin.
7. **Migration edge (Issue 7, 1 hour).** Cap the ring radius so that `ring + 1.55 * islandRadius <= size/2 - 4`, or add the Continents-style water border. Revision bump.
8. **Hash coverage (Issue 8, 15 minutes).** Optionally append `environmentData.families` to `mapIdentity` (or to the shipped blob of Recommendation 2), so a client that would render different biomes is detected.

## Open questions
- Has a Migration/Continents match ever been played on the ARM server with Safari or Firefox clients? A single "Map versions differ" report would confirm Issue 1 in the field. A WebKit run (Playwright webkit) of `scratchpad/mapgen/xb` would settle Safari.
- Is the production Node on the ARM host built with FMA contraction in V8's bundled libm? Running the `xb/node.mts` fingerprint on the server would show it. The map hashes probably still match for the quantisation reasons above.
- Should 2000 stay in the lobby at all, given 47-81 s desktop prepare times and 40+ s main-thread generation in the browser?
- Are heightmap assets served from a CDN with non-content-hashed names (`/maps/<id>/500.terrain.bin`)? A stale cached asset after a map update would also produce "Map versions differ" for every cached client. This is outside the generator scope but has the same symptom.
- Is first-come spawn choice intended as a skill element? Recommendation 5 assumes parity is wanted for public 8-human lobbies.
