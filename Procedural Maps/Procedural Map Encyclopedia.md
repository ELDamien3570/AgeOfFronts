# Procedural Map Encyclopedia

Developer and agent handoff for AgeOfFronts procedural maps.

**Last inspected: 2026-10-09.** Repository: `C:\Users\Damien\Documents\GitHub\AgeOfFronts\AgeOfFronts`. This document describes the implemented system, including the Migration terrain-formation work. Source code is authoritative if this document drifts. Commands below assume PowerShell in the repository root.

## 1. Purpose and product decisions

The tool creates seeded, playable maps from authored gameplay and visual themes. A theme supplies a recognizable layout and tunable parameters; the seed varies geography within that theme. It is integrated into normal solo and multiplayer map loading, rather than existing only as a drawing demo.

Two themes exist:

| Theme ID | Display name | Current recipe revision | Intent |
|---|---|---:|---|
| `black-forest` | Black Forest | 3 | Connected irregular clearings and winding passages through dense, traversable woods; variable ponds |
| `migration` | Migration | 7 | One or several mainlands, surrounding islands and islets, irregular coastlines, rivers, and regional topography |

Accepted user decisions that must survive future changes:

- Themes encompass both layout and visual environment.
- Black Forest woods are traversable and slow movement; trees are not impassable barriers.
- Black Forest pond coverage is selected per seed: no ponds, approximately half the clearings, or nearly all clearings. The three patterns are equally likely. Coverage is by clearing, not by player.
- Clearings, corridors, islands and coastlines should be irregular, with protrusions and sheltered inlets rather than obvious circles or blobs.
- Migration permits island or mainland starts. It does not reproduce AoE2's forced island starts or special economy.
- Migration seeds vary between one mainland and multiple large mainland islands, with smaller islands around them.
- Rivers should follow terrain and drainage rather than merely removing strips of land.
- Some mainland mountain ridges are impassable; high altitude alone should not make a flat plateau impassable.
- Large maps represent extensive territories: multiple landform types must coexist within a seed.
- World resources follow geography, but the existing starting-resource safeguard remains enabled.
- The latest terrain-formation upgrade is applied to Migration first. Black Forest has not received that upgrade.

Do not silently change these decisions or introduce forced faction starts, a new economy, or terrain-blocking forest mechanics.

## 2. Run and inspect

The local review pages are:

```text
http://127.0.0.1:9000/skirmish/black-forest.html?seed=3&size=500
http://127.0.0.1:9000/skirmish/migration.html?seed=614546621&size=1000
http://127.0.0.1:9000/skirmish/migration.html?seed=614546621&size=1000&resources=all
```

Valid sizes are **250, 500 and 1000**, producing square maps. Seeds are integers from **0 through 2147483647**. Invalid generator inputs throw; do not silently clamp them.

Start the standard development server:

```powershell
& 'C:/Program Files/nodejs/node.exe' node_modules/vite/bin/vite.js --config vite.skirmish.config.ts --host 127.0.0.1 --port 9000 --strictPort
```

Use project-local Node entrypoints if global npm/npx shims fail. Check the port before starting another server. Leave an existing user-facing server running unless its replacement is part of the task.

On this workspace, Windows file watching has crashed with `EBUSY` on concurrently written art PNGs. The local helper [tmp/resource-geography-dev.mjs](../tmp/resource-geography-dev.mjs) uses Vite's `createServer`, polling at 1000 ms and ignoring `Art`, `outputs`, `tmp` and `HeightMaps`. It is a development helper, not a required production dependency. Recreate it from its source if temporary files are removed. Excluding art also means art edits will not automatically trigger reloads.

For background launches, use `Start-Process -WindowStyle Hidden`, redirect stdout/stderr to task-specific logs, retain the returned PID, and only stop processes you can identify. Do not guess a previously recorded PID is still the same server.

### Review controls

Both pages use [ProceduralMapReview.ts](../src/skirmish/client/ProceduralMapReview.ts):

- Generate: regenerate the entered seed and size.
- New seed: use a fresh random seed; map generation itself remains deterministic.
- Overview: fit the map into the viewport.
- Explore glade/mainland: zoom to an inspection location.
- Drag and wheel: pan and zoom.
- Show paths: inspect Black Forest's clearing connection graph; hidden on Migration.
- Height & contours: Migration elevation colors, hillshade and 250 m contours.
- Landforms: Migration's authored regional feature paths and labels.
- Resources: world-deposit overlay, filter and counts. The query flag `resources` initially enables this overlay; the current implementation does not use its query value to select a particular resource.
- Save image: export the complete map, independent of viewport pan/zoom. Includes resources if enabled, but not the height/landform inspection layers.
- Play this map: link to `/skirmish/index.html?map=<theme>&seed=<seed>&size=<size>`.

The resource preview uses normal density/output and the map seed. It shows all deposit types regardless of discovery age. It has no chosen player starts, so it cannot show the later starting-resource supplements. Actual match density/output settings can differ.

Useful browser diagnostics:

| Element/property | Meaning |
|---|---|
| `#map.dataset.ready` | Seed string once generation succeeds |
| `#map.dataset.size` | Selected size |
| `#map.dataset.renderer` | `webgl` or `classic` |
| `#map.dataset.generationMs` | Generation/bake time measured by the review page, not a gameplay benchmark |
| `#map.dataset.deposits` | Preview world-deposit count |
| `#status.dataset.error` | Present when generation fails |
| `#resource-legend` | Counts for the eight deposit resources |

## 3. Architecture and ownership

```text
theme recipe + size + seed
    -> authored layout and continuous height surface
    -> terrain classes, forest and environment
    -> immutable resource geography
    -> LoadedMap
       -> solo worker / hosted runtime / server worker
       -> terrain renderer and review page

match seed + resource settings + immutable map
    -> world deposits
chosen starts + paths + owners + building reservations
    -> starting-resource supplements
```

### Entry points

| File | Responsibility |
|---|---|
| [content/Maps.ts](../src/skirmish/content/Maps.ts) | Map catalog, IDs, sizes and procedural-map classification |
| [ProceduralMaps.ts](../src/skirmish/ProceduralMaps.ts) | Shared dispatch through `generateProceduralMap(id, size, seed)` |
| [Terrain.ts](../src/skirmish/Terrain.ts) | Solo loader; procedural generation before custom heightmap loading; terrain movement speeds |
| [BlackForestMap.ts](../src/skirmish/BlackForestMap.ts) | Black Forest map assembly |
| [MigrationMap.ts](../src/skirmish/MigrationMap.ts) | Migration map assembly, terrain classes and climate |
| [Protocol.ts](../src/skirmish/Protocol.ts) | Loaded-map and worker request data contracts |
| [Elevation.ts](../src/skirmish/Elevation.ts) | Validated map construction and copied elevation/forest/resource fields |
| [ServerMap.ts](../src/skirmish/multiplayer/infrastructure/ServerMap.ts) | Server loader using the same procedural dispatcher |
| [MapIdentity.ts](../src/skirmish/multiplayer/application/MapIdentity.ts) | Canonical immutable map-input hash |
| [RuntimeBuild.ts](../src/skirmish/multiplayer/infrastructure/RuntimeBuild.ts) | Runtime source build identity |

Other consumers that must continue transporting the fields: `client/main.ts`, `client/OnlineMatchSession.ts`, `worker.ts`, multiplayer `MatchExecutor.ts`, `HostedRuntime.ts`, and `infrastructure/serverMatchWorker.ts`.

The generator must not depend on DOM, canvas, camera state, faction placement, current time or unseeded random calls. Layout inspection metadata is not a replacement for authoritative map fields. Use separate seeded streams for independent decisions where possible; adding decorative random draws should not arbitrarily reroll pond coverage or geography.

The renderer owns disposable colors, shading and decorations. Simulation owns passability, effective forest cover, movement, occupancy and deposits. Do not use a visual overlay to fix an authoritative navigation or geography defect.

## 4. Data contracts

Cells are row-major: `tile = y * width + x`. Do not transpose height, region, forest or resource buffers.

| Field | Representation | Notes |
|---|---|---|
| `terrain` | `Uint8Array(width * height)` | GameMap terrain encoding, including land/passability |
| `elevation.values` | `Float32Array(width * height)` | Calibrated heights in metres |
| `elevation.minimum/maximum/seaLevel` | Numbers | Validation range and marine reference level |
| `elevation.reliefScale` | Optional number | Presentation gain; validated positive and at most 10; absent on existing custom maps |
| `forest.cover` | `Uint8Array(width * height)` | Natural density 0–255, only on passable land |
| `environmentData` | Byte arrays | Moisture, vegetation, aridity and environment-family indices |
| `resourceTerrain.desert` | `Uint8Array(width * height)` | Existing generic biome input |
| `resourceTerrain.suitability` | Optional `Uint8Array(width * height * 8)` | Tile-major relative resource weights |
| `resourceTerrain.marine` | Optional `Uint8Array(width * height)` | Explicit offshore-oil water eligibility |

`SkirmishMap` copies supplied buffers into its fields. Resource inputs must survive structured cloning into workers. When adding another field, update validation/copying, transport contracts, canonical hashing and parity tests together. Hash field presence as well as its bytes to avoid ambiguous identities.

Important terrain bytes used by Migration:

| Byte | Meaning |
|---:|---|
| 1 | Water |
| 133 | Plains |
| 143 | Highland |
| 153 | Traversable mountain terrain |
| 159 | Impassable land |

The underlying GameMap decoder uses the land bit and low-five-bit magnitude. Impassable land is still land for coast, climate and visual relief calculations.

Migration's declared elevation range is **−4500 to 6000 m**, sea level 0. Ocean beds are negative. Inland river beds remain positive and descend toward their negative ocean outlet. Do not flatten all water heights to sea level: that would invent cliffs along high river banks. Black Forest declares **0 to 500 m**; its ponds use local positive bed elevations.

## 5. Black Forest generation

Recipe: [content/BlackForest.ts](../src/skirmish/content/BlackForest.ts). Layout: [BlackForestLayout.ts](../src/skirmish/BlackForestLayout.ts).

1. Generate a jittered clearing lattice. Side count is at least four and otherwise approximately `size / 82`.
2. Vary clearing extent, aspect, rotation and boundary phases. These are not simple circles.
3. Build a connected clearing graph from sorted candidate links, then add short alternative connections. Passages have shaped polylines and variable openings.
4. Rasterize signed clearance fields. `clearance` is positive inside open ground; `passageClearance` reserves fast-route shoulders.
5. Derive forest edge density from clearance. Dense cover ranges approximately 215–255. Glades use grassland-steppe; dense forest uses boreal-conifer.
6. Generate relatively gentle heights from noise. This theme does not currently use `TerrainFormation` or Migration's regional topography.
7. Select a separate seeded pond stream and one of coverage `[0, 0.5, 0.9]`. Shuffle candidate clearings; search irregular pond pockets within open ground. Protect settlement centers, passages, shore margins and other ponds. A bounded fallback scan searches smaller pockets.
8. Assemble environment and resource geography, then construct the final validated map.

Pond targets are rounded clearing counts, not unconditional guarantees. A clearing can fail the placement constraints. Pond shapes and positions should remain reproducible.

### Forest movement and distant appearance

[Forest.ts](../src/skirmish/Forest.ts) keeps immutable natural cover separately from building-cleared occupancy. Effective cover can be cleared by the normal building lifecycle. Do not destroy the natural field to represent a construction site.

`terrainSpeed` multiplies base speed by `1 - 0.4 * effectiveCover`. Base speeds are plains 56, highland 35 and traversable mountains 20. Dense woods therefore approach 60% of their terrain's base movement speed. The pathfinding/movement consumers must agree with the same field.

The distant forest presentation uses cached canopy stands in the terrain decoration system, rather than relying only on a dark ground splat. See [TerrainDecorations.ts](../src/skirmish/client/TerrainDecorations.ts) and [PaintedTerrain.ts](../src/skirmish/client/PaintedTerrain.ts). Presentation must still reveal forest as trees when zoomed out.

## 6. Migration layout and coastlines

Recipe: [content/Migration.ts](../src/skirmish/content/Migration.ts). Layout: [MigrationLayout.ts](../src/skirmish/MigrationLayout.ts).

`MigrationLayout` exposes `mainland` (first mainland compatibility alias), `mainlands`, `mainlandPattern`, `islands`, `rivers`, `regions`, and `landforms`.

- Mainland pattern is `single` or `split`; split layouts allow up to three mainlands.
- Landmass boundaries use harmonics, rotation and seeded variation.
- Outer islands reserve a sea moat. Nominal outer-island recipe bounds are 6–9; placement and topology validation matter more than interpreting this as every island on the map.
- Additional small-island recipe counts scale with size: 3–5 at 250, 8–12 at 500, 20–30 at 1000. The total includes the larger surrounding islands.
- [MigrationCoast.ts](../src/skirmish/MigrationCoast.ts) supplies irregular coves, mouths and coastline distance evaluation, creating sheltered pockets and peninsulas.
- [MigrationValleyRoute.ts](../src/skirmish/MigrationValleyRoute.ts) routes mainland channels through low ground using bounded path search. These channels establish the authored separation pattern; they are not the same as drainage-generated freshwater rivers.
- Layout repairs preserve the intended mainland topology and connected navigable water.
- `regions[tile] === 0` means water. Mainland IDs precede island IDs. Rivers update the region mask to water. Landmass records describe authoring regions and should not be confused with final navigation connected components.
- [TerrainShoreDistance.ts](../src/skirmish/TerrainShoreDistance.ts) computes exact Euclidean shore distances; do not substitute Manhattan distances that create diamond-shaped artifacts.

The returned `shore` field is established before freshwater carving. A later consumer needing distance from the final river shoreline must recompute it from the final mask rather than assuming it includes rivers.

## 7. Migration topography and formation pipeline

The important order in `MigrationLayout` is:

1. Create regional height source alongside layout authoring.
2. Finish landmass/channel/cove topology and shore distances.
3. Evaluate continuous initial heights against the authored shoreline.
4. Apply terrain formation: ridge branches, finer dissection and runoff erosion.
5. Apply thermal slope relaxation.
6. Assign ocean shelf and deep-water heights.
7. Route and carve freshwater drainage on the resulting surface.
8. In `MigrationMap`, derive terrain classes, environment, forest and resource suitability from the final data.

### Regional structure

[MigrationTopography.ts](../src/skirmish/MigrationTopography.ts) configures [RegionalTopography.ts](../src/skirmish/RegionalTopography.ts). Each seed mixes ranges, massifs, plateaus, basins and plains. Half the feature placement is focused on the continental center; the rest is distributed more widely.

Current recipe ranges:

| Landform | Count | Authored uplift |
|---|---:|---:|
| Range | 2–4 | 1800–3900 m |
| Massif | 1–3 | 1400–3200 m |
| Plateau | 1–3 | 650–1700 m |
| Basin | 2–4 | Suppresses uplift rather than adding height |
| Plain | 2–4 | Suppresses uplift and promotes lower coastal terrain |

Features use normalized coordinates. Ranges are bent polylines; other regions have width, aspect and rotation. Noise warps/detail these authored shapes. Regional heights use soft saturation near a 5800 m recipe maximum and spatially varying coastal blending.

### Terrain formation, added in revision 7

[TerrainFormation.ts](../src/skirmish/TerrainFormation.ts) exports `formTerrain(size, land, heights, shore, features, seed, recipe)`. It modifies heights in place, not land masks.

- Work is capped at `min(size, 250)` per side under the current recipe.
- Range anchors seed lateral spurs, bent extensions and smaller forks. Massif anchors also seed branches.
- Ridge uplift is localized, stronger in uplands and faded near the coast.
- Several regional noise scales add finer ridge/gully dissection before erosion.
- Four erosion passes recompute drainage and contributing area on the reference grid.
- An implicit downstream-first stream-power solve reduces slopes toward downstream elevations. Current `streamPower` is 38 and `spurHeight` is 0.28.
- Original low basins are not raised to the routing spill surface. Erosion is bounded by a retained-height floor.
- Bilinear transfer of the **height change** preserves the original full-resolution surface and shoreline, rather than replacing them with the coarse grid.
- Resulting land heights are kept positive and capped at 5800 m.

This is not a complete geological or hydraulic simulation. It exports eroded material rather than simulating sediment deposition. The fixed reference grid limits very fine gullies at 1000 size. Numeric recipe limits and hardcoded local scales live in `TerrainFormation.ts`; expose them deliberately if theme authors need more controls.

### Thermal erosion

[TerrainErosion.ts](../src/skirmish/TerrainErosion.ts) performs conservative bounded transport between land neighbors. Current recipe: eight iterations, talus 55, rate 0.1. The simultaneous eight-neighbor update requires a stable rate no greater than 1/8. Do not increase it indiscriminately to smooth artifacts. Water remains unchanged. The talus is currently specified per raster step, so cross-resolution equivalence is approximate.

### Drainage and freshwater

[TerrainDrainage.ts](../src/skirmish/TerrainDrainage.ts) uses priority-flood drainage with deterministic tie ordering through [TerrainPriorityQueue.ts](../src/skirmish/TerrainPriorityQueue.ts). It returns a depression-resolved routing surface, downstream indices, accumulation and outlet-to-headwater order. The routing surface is temporary construction data, not the rendered heightmap.

[MigrationHydrology.ts](../src/skirmish/MigrationHydrology.ts):

- Selects mainland sources by catchment accumulation and minimum river length.
- Catchment threshold is `max(45, size² * 0.0004)`.
- Minimum length is `size * 0.025`.
- Widens streams downstream with contributing area.
- Incises beds and blends wider banks into the surrounding surface.
- Breaches selected spill points to retain descending beds without filling whole basins.
- Includes the actual ocean outlet and restores descending center beds after overlapping raster footprints.
- Uses incision parameter 75 and valley-bank multiplier 4.

Freshwater rivers remain raster-based eight-neighbor routes. Some stretches can still read angular, and their water is rendered by the existing top-down water layer. There is no volumetric water or physical sloped river surface.

### Terrain, climate and forest derivation

Migration computes a local central-difference slope, normalized by `size / 1000`. This is a gameplay relief measure, not a slope angle in degrees or a physically calibrated horizontal distance.

- Impassable ridges: mainland only, height at least 1600 m, slope at least 38 and original shore distance at least six tiles.
- Passable mountain terrain: slope greater than 32 and height greater than 900 m.
- Highland: slope greater than 14 and height greater than 250 m.
- Otherwise land remains plains.
- Outer islands remain free of impassable ridges; they can still contain traversable hills/mountains.
- Seeded wind direction and upwind relief modulate rainfall. Ocean bed heights are clamped out of the upwind calculation.
- Growing vegetation decreases above upland elevations. Mountain/alpine terrain is sparse; lowlands combine grass and woods.
- Moisture, vegetation, aridity and family arrays are authoritative inputs to environment/resource derivation, not camera-dependent effects.

## 8. Resource placement

Contracts: [ResourceTerrain.ts](../src/skirmish/ResourceTerrain.ts). Geography bake: [ResourceGeography.ts](../src/skirmish/ResourceGeography.ts). Deposit generation: [domain/DepositGeneration.ts](../src/skirmish/domain/DepositGeneration.ts).

Suitability order is fixed and shared with the generator:

```text
horses, stone, copper, tin, ironOre, carbon, gunpowder, oil
```

The suitability buffer is tile-major: `tile * 8 + resourceIndex`. A zero weight means ineligible. Passable procedural land currently retains a low positive baseline for every resource, so geography biases access rather than enforcing absolute regional scarcity.

### Geography rules

- Horses: strongly prefer low forest cover, gentler slopes and lower elevations. Black Forest horses consequently concentrate in glades and passages.
- Stone: exposed/rough uplands, modulated by regional provinces.
- Copper, tin and iron ore: upland/rocky suitability and distinct correlated mineral provinces.
- Carbon and land oil: wetter lowlands and authored basin influence, modulated by their own provinces.
- Gunpowder: existing abstract raw-material-site resource, biased toward suitable lower terrain. Do not describe it as a naturally occurring geological powder deposit.
- Regional provinces and basin influence are cached on a 128-cell normalized grid and interpolated; actual cover and slopes remain per tile.
- Black Forest marine mask is zero everywhere: ponds do not receive offshore oil.
- Migration marine water means water with height at or below zero. Positive-height freshwater rivers do not receive offshore oil.
- Offshore oil additionally obeys the existing coastal reach limit. The resource marine mask does not redefine global coastal ownership or navigation rules.

Maps without procedural suitability retain the generic behavior: nearby mountains favor metals, plains favor horses, desert favors oil, and coastal water can host oil. Do not change legacy/custom map distribution as an incidental procedural-map fix.

### Deposit budget and determinism

`DEPOSIT_RULES` revision is 5. Ordinary expected density is `eligibleCells * 2 * density / 6300`; powder abundance is doubled. Per-resource weights are normalized, redistributing deposits without intentionally inflating global counts. A stable integer tile/seed hash selects at most one deposit per tile. Counts remain stochastic, not exact quotas.

Base yield is 2 per second for horses, 3 for other deposits, multiplied by output. Density and output match settings accept 1, 2, 3 or 5. Very small scenarios below 20,000 cells have a seeded missing-type fallback; it must respect eligibility and unique tiles. Supported procedural sizes are above that threshold.

### Starting-resource safeguard

[Supply.ts](../src/skirmish/domain/Supply.ts) first generates world deposits. After players, paths and buildings exist, `ensureStartingResources` invokes [StartingResources.ts](../src/skirmish/domain/StartingResources.ts).

- It searches reachable land on the same walkable component, excluding another player's territory.
- Preferred reach is 24 steps; maximum reach is 36.
- It respects extraction/building footprints and starting building reservations.
- It prioritizes copper, tin, iron ore, carbon, stone, gunpowder and oil, then horses.
- It can place supplements on nearby neutral land when owned space is insufficient.
- Supplements deliberately can override geographic preferences; this is the accepted fairness policy.
- It may filter out original world mineral sites that cannot support valid extraction footprints. Preview markers are therefore not a final match deposit guarantee.
- **Cramped islands can receive only a partial floor.** Bronze inputs are prioritized; the system does not fabricate space, overlap extraction buildings, or promise every resource on every tiny island.

Resource discovery/technology ages and extractor rules remain normal gameplay. Preview visibility does not grant match extraction rights. Existing resource-site construction validation must continue to agree between client and simulation.

## 9. Rendering, relief and exports

The renderer is a top-down map display, not a displaced 3D terrain mesh.

- [GroundBake.ts](../src/skirmish/client/GroundBake.ts): bake painted land colors; adjacent water texels inherit land colors to avoid shoreline interpolation artifacts.
- [TerrainFields.ts](../src/skirmish/client/TerrainFields.ts): RGBA fields for coast distance, hillshade and water depth.
- [GroundLayer.ts](../src/skirmish/client/GroundLayer.ts): WebGL2 ground/water quad, zoom-dependent water detail, context recovery.
- [PaintedTerrain.ts](../src/skirmish/client/PaintedTerrain.ts): Canvas2D terrain fallback and decoration layer; decorations-only when WebGL is active.
- [ElevationRelief.ts](../src/skirmish/client/ElevationRelief.ts): optional normal-based local/regional lighting used by Migration.
- [MigrationHeightView.ts](../src/skirmish/client/MigrationHeightView.ts): cached elevation inspection colors and 250 m contours.
- [ProceduralResourceView.ts](../src/skirmish/client/ProceduralResourceView.ts): markers, legend and resource filters.

Migration supplies `reliefScale = 5 * size / 1000`. It controls presentation gain only; terrain classification and resources read unchanged calibrated heights. Existing maps without this optional field retain their prior relief calculation. Do not globally increase contrast as a substitute for meaningful generated height structure.

`proceduralMapImage()` exports 750–2000 pixels per side. It temporarily resizes the existing GL context, copies its freshly drawn buffer immediately, draws decorations/resources, and restores the original context size in `finally`. It does not allocate one GL context per export. Water animation phase can change exported appearance without changing map generation.

## 10. Validation and useful evidence

Primary tests:

| Test file under `tests/skirmish` | Coverage |
|---|---|
| `BlackForestMap.test.ts` | Seeded layout, water/clearings, gameplay behavior and authored recipe contract |
| `BlackForestMultiplayer.test.ts` | Solo/server procedural parity and integration |
| `MigrationMap.test.ts` | Seed/size parity, coast/island layout, water connectivity and playable starts |
| `MigrationRegionalNavigation.test.ts` | Starts and connected water across sizes/seeds, medium-map maximum roster, small-map roster boundaries, canonical identity |
| `MigrationHydrology.test.ts` | Valley routing, descending beds, widening streams, tributaries and relief bounds |
| `RegionalTopography.test.ts` | Regional diversity, reproducibility, erosion stability and input validation |
| `TerrainFormation.test.ts` | Coast preservation, bounded incision, reproducibility, traversable hill classes and passable outer islands |
| `TerrainDrainage.test.ts` | Drainage invariants |
| `TerrainShoreDistance.test.ts` | Euclidean distance behavior |
| `ResourceGeography.test.ts` | Geographic weighting, resource budgets, marine oil, immutable cloning, starting access and map identity |
| `DepositGeneration.test.ts` / `ProductionAccess.test.ts` | Generic resource distribution and starting production/extraction contracts |
| `ElevationRelief.test.ts` | Opposing-face lighting, flat plateaus and presentation-gain validation |
| `TerrainFields.test.ts` / `GroundBake.test.ts` | Shared field/color bakes and renderer compatibility |

Example focused run:

```powershell
& 'C:/Program Files/nodejs/node.exe' node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts tests/skirmish/TerrainFormation.test.ts tests/skirmish/ElevationRelief.test.ts tests/skirmish/MigrationHydrology.test.ts tests/skirmish/ResourceGeography.test.ts tests/skirmish/TerrainFields.test.ts tests/skirmish/GroundBake.test.ts tests/skirmish/MigrationRegionalNavigation.test.ts --maxWorkers=1
& 'C:/Program Files/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit
```

Build outside the watched repository where possible. Substitute a task-owned output directory:

```powershell
& 'C:/Program Files/nodejs/node.exe' node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts --outDir '<absolute-task-output-directory>'
```

Do not run `--emptyOutDir` against an unverified/shared path. Do not treat production chunk-size warnings as a test failure, but preserve any actual error. On this busy Windows checkout, overlapping browser captures, builds and tests can inflate durations. Rerun a timed-out focused test without those concurrent workloads before changing its timeout or diagnosing a regression.

Recorded latest formation validation:

- Seven test files, 31 tests passed in `tmp/migration-formation-final-checks.log`.
- An earlier broader four-file integration run passed 26 tests in `tmp/migration-formation-integration.log`.
- Final full TypeScript and production build passed. Early TypeScript errors in an untouched troop-rendering file cleared during concurrent work; no terrain fix was applied to that file.
- Browser cases: seed 614546621 at 1000, seed 3 at 500, seed 42 at 250. HTTP 200, WebGL renderer, no page errors.
- Browser generation/bake measurements were approximately 5.5 s, 1.9 s and 0.8 s under that local capture workload. These are observations, not guaranteed performance budgets.

Artifacts in `outputs/migration-review` include normal previews, height previews and exported maps named `Formation-migration-<size>-Seed-<seed>-Preview.png`, `...-Heights.png`, and `Formation-migration-<size>-Seed-<seed>.png`. Temporary logs/scripts are evidence helpers and may be removed later. Lobby preview PNGs under `resources/maps/<theme>` are static previews, not runtime generation sources, and may lag a recipe change.

### Browser capture caveat

The local headless Chromium/software ANGLE combination has produced false repeating canopy patches or hangs with GPU-backed Canvas2D. For automated captures only, existing scripts force `willReadFrequently: true` for 2D canvas contexts while retaining the actual WebGL ground renderer. Do not ship that capture workaround as a product rendering change without separate justification.

Helpers: `tmp/migration-formation-browser.cjs`, `tmp/resource-geography-browser.cjs`, and `tmp/migration-hydrology-capture.cjs`. They depend on local Playwright/Chromium paths, so inspect rather than blindly reuse. Freeze RAF for screenshots, and resume queued callbacks explicitly before requesting another view; simply unfreezing can lose the render loop. Save the map export before screenshotting and collect page errors.

Browser screenshots establish local rendering evidence, not user artistic approval or deployment qualification. Unit/component tests do not certify arbitrary player counts or full production match performance.

## 11. Safe extension workflow

1. Inspect current checkout status, relevant source and tests. This repository often contains concurrent art, troop, simulation and technology work. Preserve unrelated edits.
2. Clarify ambiguous intended behavior before coding. Separate terrain appearance changes from gameplay changes.
3. Locate the theme recipe and correct stage. Coast edits belong in layout/coast authoring; ridges/valleys in formation; water routes in drainage; fairness in starting access; camera readability in presentation.
4. Retain determinism, immutable copied inputs and shared solo/server generation. Add new authoritative fields to every transport/hash/validation path.
5. Increment the applicable recipe revision when generation behavior changes. Update explicit revision tests. Do not assume old seeds reproduce previous revisions.
6. Test multiple seeds and all three sizes, including island/mainland starts, maximum supported rosters, water connectivity, freshwater/ocean classification and extraction footprints.
7. Compare normal and height views. A pleasing height overlay alone does not prove the normal game view conveys relief.
8. Verify type/build checks and local browser behavior. State limitations and distinguish unrelated concurrent failures.
9. Update static lobby previews and this document when applicable.
10. Commit/push/deploy only when authorized. Local preview/build work is not publication authorization.

### Adding a theme

Add its catalog entry in `content/Maps.ts`, an authored recipe, a pure generator returning the established loaded-map fields, and dispatch in `ProceduralMaps.ts`. Add a review page using the shared review module, build input wiring in `vite.skirmish.config.ts`, lobby preview assets, and solo/server integration tests. Do not fork resource generation or renderer ownership just to support one theme.

### Known limits and likely next work

- Black Forest still has the earlier gentle noise height surface. Applying regional formation there requires a distinct wooded-hill recipe and renewed clearing/pond/start tests.
- Migration is an authored island pattern refined with landscape processes, not plate tectonics or a physically complete erosion simulation.
- Erosion exports material; sedimentary deposition, deltas, floodplain sediment and lake filling are not modeled.
- Rivers can remain angular at raster scale. Improving channel curvature must preserve descending beds, connected water and stable authoritative footprints.
- Forest decoration can conceal terrain lighting at overview. Any canopy/lighting refinement must retain clear tree silhouettes and sensible performance.
- Resource geology is gameplay suitability, not real geological provenance. Budgets are normalized globally, not guaranteed independently on every landmass.
- Very small islands can lack room for all starting extractors. Preserve the existing constrained packing behavior and disclose it rather than inventing unreachable deposits.
- Horizontal physical map scale is not formally calibrated; normalized generation preserves relative feature scales. Do not interpret the slope thresholds as degrees.
- The current preview page generates/bakes on the browser thread and is not a worker-based terrain editor. Measure responsiveness before choosing a generation-worker refactor.
- No arbitrary map dimensions, theme editor UI, revision archive, true 3D displacement or release/deployment workflow is provided by this tool.

The intended architecture is shared, deterministic geographic data with separate theme recipes and disposable presentation. Avoid solving a missing landform with painted blobs, solving a rendering defect by changing movement, or solving a cramped start by violating extraction footprints.
