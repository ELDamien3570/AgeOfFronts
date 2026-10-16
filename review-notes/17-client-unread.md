# 17 — Browser client: files round 1 did not read, plus a frame-cost measurement

Reviewer: round 2, client (unread files) + performance measurement. Tree reviewed as it stood 2026-10-16 01:55–03:10. The owner was editing the tree during this review (aircraft carriers landed in `Units.ts`, `EmpireHudView.ts`, `SkirmishViewModel.ts` and other files between 02:30 and 02:47, and `Renderer.ts` line numbers moved by about +3). All line numbers below were re-checked with `grep -n` against the live tree at about 03:00. Measurements ran on frozen copies of the tree in the scratchpad (see "Measurement method"), never on the repository.

Conventions: **CONFIRMED** means traced end to end in code, or executed. **SUSPECT** means the mechanism is real but its magnitude or visible effect was not measured.

## Scope read

Fully read (live tree):
- Terrain and ground: `GroundBake.ts` 1–129, `RoadLayer.ts` 1–239, `RoadArtwork.ts` 1–23, `TerrainArtwork.ts` 1–44, `TerrainFields.ts` 1–219, `TerrainEnvironment.ts` 1–77, `TerrainViewModel.ts` 1–31, `ElevationRelief.ts` 1–19, `RoundedTerritoryBorders.ts` 1–56, `TerritoryStyle.ts` 1–31.
- Effects: `CombatEffectsView.ts` 1–217, `CombatEffectsViewModel.ts` 1–287, `ImpactPresentation.ts` 1–89, `BoatPresentation.ts` 1–232.
- Aircraft: `AircraftLayer.ts` 1–28, `AircraftView.ts` 1–73, `AircraftPresentation.ts` 1–106, `AircraftGroundPresentation.ts` 1–204.
- Buildings and fortifications: `BuildingArtwork.ts` 1–38, `BuildingSpriteLayout.ts` 1–75, `BuildingGunPresentation.ts` 1–57, `WallPresentation.ts` 1–99, `TrenchArtwork.ts` 1–39, `PlacementPreview.ts` 1–693, `PlacementCoverage.ts` 1–66.
- HUD and view models: `RecruitmentQueueView.ts` 1–69, `RecruitmentQueueViewModel.ts` 1–79, `ResearchOpportunitiesView.ts` 1–128, `ResearchOpportunitiesViewModel.ts` 1–60, `TechnologyTreeView.ts` 1–72, `TechnologyViewModel.ts` 1–65, `MatchMetricsViewModel.ts` 1–18, `OpponentAttention.ts` 1–38, `SpawnSelectionViewModel.ts` 1–42, `ArmyViewModel.ts` 1–102, `FactionViewModel.ts` 1–31, `ChargeReadiness.ts` 1–47, `HudView.ts` 1–639, `EmpireView.ts` 1–778, `EmpireHudView.ts` 1–563. EmpireHudView was read before the carrier edit; its new lines 95 and 452–453 were read afterwards.
- Troops: `troops/CavalryMeleePresentation.ts` 1–138, `CavalryPoseContinuity.ts` 1–57, `ChargeImpactPresentation.ts` 1–36, `CavalryAssaultPresentation.ts` 1–547, `FactionMaskTint.ts` 1–48, `ProjectilePresentation.ts` 1–69, `RussianTroopCatalogue.ts` 1–28, `TroopAssetUrls.ts` 1–9, `TroopFormationModel.ts` 1–302, `TroopImpacts.ts` 1–264, `TroopMeleeStrike.ts` 1–37, `TroopPacking.ts` 1–68, `TroopRemains.ts` 1–68, `TroopVolley.ts` 1–177.
- Lobby and lab: `lobby/LobbyView.ts` 1–421, `lab/BalanceDraft.ts` 1–420, `lab/BalanceExperiment.ts` 1–339, `lab/BalanceScenarios.ts` 1–123, `lab/BattleTuning.ts` 1–120.

Read for context (callers): `Renderer.ts` 120–135, 330–560, 1091–1200, 1425–1500; `troops/TroopActors.ts` 175–195, 425–515, 700–830, 1195–1225; `troops/TroopPresentation.ts` 1–120; `main.ts` 340–370, 460–520, 600–720, 840–960, 2140–2177; `FormationRenderPose.ts` 1–80; `domain/FormationGeometry.ts` 116–145, 305–322; `RuntimeDiagnostics.ts` 1–80; `domain/Definitions.ts` 478–504; `multiplayer/Protocol.ts` 30–80; `multiplayer/infrastructure/ServerMap.ts` 1–60; `DiagnosticReplay.ts`; `tests/skirmish/TroopOffscreenCasualties.test.ts`, `TroopVisibilityPerformance.test.ts`, `LargeMatch.test.ts` 1–60, `multiplayerReleaseProfile.ts`.

Round 1 context read: `07-client.md` (all), `08-latent-bugs.md` (P1 and the refuted table).

## Measurement method

Everything ran on the Ryzen 3700X desktop. **Caveat:** the machine was at 100 % CPU throughout, because other round-2 reviewers were running simulations in about ten concurrent `node` processes. Wall-clock numbers are therefore inflated, roughly 1.5–2.5× judging by Node CPU time against wall time. The ratios between phases are reliable; the absolute milliseconds are upper bounds. Desktop runs at about 0.4× ARM wall time, so a Chrome client on a mid-range laptop will sit somewhere between these numbers and twice them.

Load, built identically in both harnesses: a 500×250 synthetic map (land, with a sea band in rows 200–249). 8 humans, 14 AI and 30 tribes, so 52 factions. Napoleonic start, `DEFAULT_AI_POLICIES`, alliances on. Each of the 22 regular factions gets 40 extra squads in paired blocks that face each other, and the pairs declare war. 14 warships per faction. After 40 warm-up ticks that gives **1042 squads, 207 ships, 75 buildings, 52 players, about 115 squads fighting**, and an entity payload of **1.28 MB JSON-equivalent (≈950 B per squad row)**. Snapshots come from `game.snapshot()` every 1–2 ticks, matching 8 Hz simulation with 5 Hz publication. After each snapshot the harness renders 12 frames: `presentation.beginFrame` + `renderer.draw` + `endFrame`, mirroring `main.ts frame()`.

1. **Real Chrome (the session's built-in browser, Chrome 152, 1600×900, dpr 1, WebGL2 available).** The harness page is `scratchpad/client-unread/tree2/measure/` and is served by Vite from a frozen copy of the tree. It builds the match on the page's main thread and drives a real `Renderer` with `installTroopPresentation`, real Canvas2D, WebGL ground and real sprite sheets. The harness waits until the troop sheets report loaded (`squadArtworkDetailed === true`), then times `renderer.draw` synchronously and wraps the TroopActors hooks with timers. The browser pane was hidden, which throttles rAF, so the harness calls `draw` directly in a loop and yields through `MessageChannel`. This times main-thread CPU, including Canvas2D command recording; GPU rasterisation is asynchronous and not included.
2. **Node/jsdom with a no-op Canvas2D** (`scratchpad/client-unread/client.bench.test.ts`, run with a scratch vitest config). It times the JS-only cost of `Renderer.update`, `renderer.draw` and the HUD view models. It also records a V8 CPU profile through `node:inspector` (`prof/strategic.cpuprofile`) for attribution.
3. Micro-benchmarks run under tsx: `CavalryAssaultMotion` planning (`assault.ts`), and `TroopRemains` retention while zoomed out (`remains.bench.test.ts`).
4. The actual local-match page (`/skirmish/index.html?map=heightmap-test1&size=500&diagnostics`, 14 AI, Napoleonic, 4×) ran, but it is not usable for the target load. The machine was contended, so the worker simulation averaged a 520 ms tick, ran at under 0.5× speed and never grew past early-game squad counts. The late-game Migration diagnostic replay (`out/late-game-20ms-20261012/production-current/replay.json`) no longer restores: "Squad manpower does not match its recipe". The local match's early-game numbers are listed under Results only for completeness.

### Results (real Chrome, 1042 squads, ms per call)

| View | Visible squads | `renderer.draw` p50 / p95 / p99 / max | of which `TroopActors.draw` p50 | of which `TroopActors.flush` p50 | `renderer.update` p50 (per publication) | `structuredClone` of entities, serialise + deserialise, p50 |
|---|---|---|---|---|---|---|
| Strategic (scale 3.1, whole map) | 1042 | 17.7 / 30.4 / 48.5 / 65 (second run: 19.9 / 32.8 / 41.2 / 50) | – | – | 11.6 | 22.0 |
| Soldier, scale 16, centred on the densest fight | 202 (all detailed) | **186.6 / 298.5 / 383.4 / 651** | **90.4** | **86.3** | 21.0 | 19.6 |
| Soldier, scale 12 | 273 (all detailed) | **297.8 / 1188 / 3296 / 4173** (an earlier run: 348 / 504 / 555 / 559) | **137.4** | **128.1** | 24.6 | 20.2 |
| Soldier, scale 16, troop sheets not yet loaded (fallback era sprites) | 202 | 20.6 / 145 / 306 | 0.2 | 0.1 | – | – |

Chrome JS heap held 105–252 MB with the simulation on the same page.

Headless JS-only, using Node CPU time (Windows `cpuUsage` granularity is about 15.6 ms, so these are means over 21–26 samples):
- Strategic `renderer.draw` mean **41 ms CPU** with a no-op context.
- `renderer.update` mean 18–20 ms.
- `structuredClone` round trip mean 35 ms.
- HUD view models (`RecruitmentQueueViewModel`, `SkirmishViewModel.recruitmentQuotes`, `EmpireViewModel.buildChoice` × CONSTRUCTION, `HudViewModel.entities/selectionCard`, `ArmyViewModel`) mean 4–8 ms.
- `TroopActors.prune` at strategic zoom: p50 1.5–2 ms, p95 4–14 ms.

**Where strategic-zoom `draw` time goes** (V8 profile, `under.cjs`, share of `Renderer.draw` inclusive time):
- 60.2 % is in the per-squad `.map` closure that runs before culling (`Renderer.ts:1443-1497`). Within it: `formationRenderPose` takes 24.8 % self, plus 16.8 % in `formationFootprints` and 6.9 % in its slot closure. `formationEnvelope` → `computeFormationEnvelope` takes 15.7 %, plus `geometryKey` at 5.7 % and envelope self at 7.8 %.
- 13.9 % is the `draw` body itself.
- `strategicFormationBox` and `drawFormationMarker` are 5.6 % and 5.3 %.
- `legacyWeaponStrength` is 1.9 % and `TerritoryLayer.draw` 1.3 %.
- The proxy shim accounted for another 5.7 %, which is an artefact of the no-op context.

**Where `renderer.update` time goes:** `UnitPresentation.update` 35.6 %, `TerritoryLayer.update` 23.2 %, own body 13.4 %, `FormationAngleSamples.update` 12.3 %, `TerritoryLabelViewModel.update` 7 %. Every module this review owns is under 1 % each: `RoadLayer.update`, `BuildingFacts`, `HealthLossTrail`, `combatTargets`, `ImpactPresentation`, `BoatPresentation`. `beginFrame` is 77 % `CombatPresentationTimeline.sample` (07 I2).

### Instanced soldiers or incremental presentation: which wins?

**Instanced soldiers (07 #8) is the bigger win, by about an order of magnitude, but only together with a cheaper choreography pass.** Incremental presentation (ledger P1) is worth doing for network and memory reasons, not for frame time.

- **P1 cannot fix the frame rate.** It removes the main thread's deserialise half of a ~20 ms round trip, about 10 ms per publication: about 50 ms per second at 5 Hz, roughly 5 % of the main thread.
- **Strategic zoom.** The frame alone costs 18–20 ms p50 in real Chrome, already over the 16.7 ms budget: about 50 fps with 40–60 ms p99 hitches. More than half of that is recomputing `formationRenderPose` and `formationEnvelope` for every squad on every frame. Neither instancing nor P1 touches it. Caching the poses per (squad, snapshot) is the cheapest large win at this zoom (issue 3).
- **Soldier zoom over a real battle.** About 190 ms per frame, which is about 5 fps. Half of it is `TroopActors.draw`: per-soldier choreography, engagement and slot sampling in JS. The other half is `TroopActors.flush`: thousands of `save`/`translate`/`rotate`/`drawImage`/`restore` calls. Wiring `InstancedActorSprites` replaces the ~86 ms flush with one or two instanced draws (≈1–3 ms). The choreography half needs its own LOD (issue 4). Even both together leave P1's 10 ms per publication as the smaller item.

## How it works today (the parts round 1 did not cover)

- **Ground bake** (`GroundBake.ts`, `TerrainFields.ts`). `Renderer.setMap` bakes a map-size RGBA colour texture and a fields texture once. The fields texture holds signed coast distance by two chamfer passes, hillshade from blurred elevation, and blurred depth. Road and building clearings re-bake only the touched 16-tile blocks (`rebakeGroundColors`, called from `Renderer.ts:448-455` and from the `BuildingFacts.changed` branch).
- **Roads** (`RoadLayer.ts`). On a new road revision the road map is rebuilt and only the affected 32-tile chunks are invalidated. Chunks are cached per LOD in an LRU with a 12 Mpx budget. Building footprints are recomputed each publication to hide roads under buildings (`RoadLayer.ts:95-120`); measured at 0.9 % of `update`.
- **Effects.**
  - `combatTargets` builds up to 128 crosshair markers per publication (`CombatEffectsViewModel.ts:219-276`).
  - `ImpactPresentation` keeps detonations cosmetically alive after the projectile disappears: at most 128 active, and a `seen` set pruned by live id.
  - `BoatPresentation` interpolates ship and naval-trader poses linearly per packet, with a measured interval EMA and teleport snapping.
  - The three aircraft classes split flight poses (`AircraftPresentation`) from apron and runway choreography (`AircraftGroundPresentation`, six berths per field).
  - `BuildingGunPresentation` turns building volleys (`volley.squadId === building.id`; ids share `Simulation.nextId`) into turret facings.
- **Walls and trenches** (`WallPresentation.ts`). Rebuilt only on `fortificationRevision`. Builds a four-bit mask graph per tile and picks one cosmetic gate per run of five or more tiles.
- **Placement preview** (`PlacementPreview.ts`). A resumable, 2 ms-budgeted scan over 16×16 chunks of the player's territory, cached per mode (at most 4 modes, 128 non-visible chunks). Invalidation is incremental by building key, ownership diff, barrier JSON and troop tiles. `PlacementCoverage` unions the footprints with a difference array.
- **HUD.**
  - `HudView` writes `innerHTML` only when the markup string differs.
  - `EmpireView` re-renders an open panel at most every 500 ms, keyed by HTML string.
  - `EmpireHudView` rebuilds the stock strip and the dock extras when their markup strings change, and appends feed items (40 max).
  - `ResearchOpportunitiesView` re-renders on a JSON fingerprint.
  - `RecruitmentQueueView` diffs cells by key.
  - All player-supplied strings I found are escaped: the faction name in `EmpireView.ts:776`, feed messages in `EmpireHudView.ts:501`, the lobby room title and owner in `LobbyView.ts:93-97, 133`, seats in `LobbyView.ts:150`, flag names in `LobbyView.ts:76, 160`. Room ids and map ids are interpolated unescaped, but they are server-generated or validated by `z.enum(LOBBY_MAP_IDS)` (`multiplayer/Protocol.ts:48`).
- **Troops** (the files round 1 did not read).
  - `TroopRemains` keeps bodies for 20 s and blood for 45 s.
  - `TroopImpacts` caps hits at 512, stains at 1024 and smoke at 384.
  - `TroopVolley` freezes launch geometry per volley id, pruned by live volleys.
  - `CavalryMeleePresentation` freezes cohorts and lanes per melee commitment.
  - `CavalryPoseContinuity` is a bounded, velocity-limited follower used for hand-offs.
  - `CavalryAssaultMotion` plans per-rider arc-length Bézier passes: approach, hold, turn, exit. Each `CavalryRidePath` is built from 64 samples per cubic piece, with curvature-limited speed and forward and backward acceleration passes.
  - `ChargeImpactPresentation` and `TroopMeleeStrike` stage committed facts on soldiers and never feed back into the simulation.
- **Lobby.** It keeps the live name input and the colour `<select>` mounted across directory publications (`replaceAround`, `refreshColorField`), so IME and native dropdowns survive refreshes.
- **Lab.** Balance drafts and experiments are strictly validated: field allow-lists, numeric bounds, a 2 MB import cap, no prototype-path writes, since `experimentDefinition` only writes paths present in `numericStats`.

## Strengths

- Nearly every presentation cache in scope is bounded or pruned by live id. Bounded caches: `RoadLayer` (12 Mpx LRU), `PlacementPreview` (4 modes, 128 chunks), `ImpactPresentation` (128), `TroopImpacts` (512/1024/384). Caches pruned by live id: `BoatPresentation`, `AircraftPresentation`, `AircraftGroundPresentation`, `BuildingGunPresentation`, `TroopVolley`, `CavalryAssaultMotion`. `BuildingSpriteLayout` keys a WeakMap by image. The single exception is issue 2.
- Ownership-change handling is safe in this scope. `PlacementPreview` keys buildings by `tile:playerId:type:age:ready:alive`, so a capture invalidates nearby quotes (`PlacementPreview.ts:169-189`). `AircraftGroundPresentation` falls back to its last berth when an airfield disappears. Nothing here dereferences progression state for owner 0: `ResearchOpportunitiesViewModel`, `TechnologyViewModel` and `EmpireView` only read the local player's progression.
- Expensive one-off work is genuinely one-off or incremental: the ground bake, block re-bakes on road and building clearing, wall topology on revision, and road chunks on revision.
- The resumable placement scan uses a 2 ms deadline and fair chunk ordering ("completed passes move behind waiting work").
- Escaping is consistent across HUD, Empire, lobby and feed markup (above).
- The lab importers are strict and atomic.

## Issues

### 1. Crosshair markers always show player 1's targets: `combatTargets` is called without the local player id
- **Where:** `src/skirmish/client/Renderer.ts:429` (`this.combatMarkers = combatTargets(snapshot);`); the default `playerId = 1` is at `src/skirmish/client/CombatEffectsViewModel.ts:219-222`. The renderer has the correct id: `Renderer.ts:127-129` (`get playerId() { return this.snapshot?.localPlayerId ?? 1; }`).
- **Severity:** medium. **Confidence:** high (CONFIRMED by code trace).
- **Mechanism:** `combatTargets(snapshot, playerId = 1)` filters aircraft targets, missile targets and siege-squad targets by `playerId`. `Renderer.update` never passes `this.playerId`, and `snapshot.localPlayerId` is set before `renderer.update` (`main.ts:631, 848`).
- **Consequence:** in any online match the human seated as player 2–8 never sees crosshairs on their own bombing, missile and siege targets. Instead they see live crosshairs over **player 1's** pending bomb, ICBM, MIRV and warhead targets and siege focus. That is wrong feedback for 7 of 8 humans, and it hands everyone a strategic tell about player 1's strikes. Solo play is unaffected (the human is id 1).
- **Repro:** join an online match in seat 2. Let seat 1 queue a bombing run or ICBM: a crosshair appears at seat 1's target on seat 2's screen. Seat 2's own bombing run shows none.
- **Fix:** `combatTargets(snapshot, this.playerId)`. Add a test that a snapshot with `localPlayerId: 3` returns only player 3's markers. XS.

### 2. Battlefield remains grow without bound while the camera is zoomed out (memory leak)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:486-489` (`visible = this.detailed && …`; `if (before > after && !visible) this.captureOffscreenLoss(…)`), which runs before the `if (!this.detailed) return` on line 495. `captureOffscreenLoss` (`TroopActors.ts:747-760`) calls `this.remains.add(...)`. Expiry exists only in `TroopRemains.sample` (`src/skirmish/client/troops/TroopRemains.ts:39-45`), and the only caller of that is `drawRemains`, which returns early when not detailed (`TroopActors.ts:812-819`). `TroopPresentation.beginFrame` (`troops/TroopPresentation.ts:97-100`) calls `prune` on every new timeline source at every zoom level.
- **Severity:** medium–high at target scale. **Confidence:** high (CONFIRMED by execution).
- **Mechanism:** below the 12 px-per-cell detail cut-off, every casualty on the whole map becomes a `FallenTroop` record: a key string, a spread copy, a colour, and a `formationRenderPose` plus slot sort per losing squad, each publication. Records are deleted only when sampled, and sampling never runs while zoomed out. There is no count cap.
- **Measured:**
  - `remains.bench.test.ts`, with 8 squads losing 1 soldier per 10 s publication: `records` went 8, 16, 24 … 96 at t = 120 s, never dropping despite the 45 s lifetime. A single `sample(now)` then purged it to 40.
  - Target-scale headless run: 997 records after 30 publications (2540 casualties). `prune` at strategic zoom cost p50 1.5–2 ms and p95 4–14 ms per publication.
- **Consequence:** a commander who plays mostly at strategic zoom (the RoN norm) accumulates one record per casualty for the whole match: hundreds of thousands in a 52-faction game, at about 250 B each plus key strings. That is tens of MB of heap and growing GC pauses. The first zoom-in then pays a synchronous `sample` over all of them, allocating a `PresentedRemains` per record, which is a visible hitch. There is also per-publication CPU for map-wide offscreen pose reconstruction that is never displayed.
- **Repro:** run `remains.bench.test.ts` (scratchpad). In game, stay zoomed out through several big battles, then compare heap snapshots: `FallenTroop` objects grow monotonically.
- **Fix:**
  - (a) Skip `captureOffscreenLoss` entirely when `!this.detailed`. Remains are invisible at that zoom, and fresh casualties after zoom-in still get bodies.
  - (b) Make `TroopRemains.add` evict expired records, using a time-ordered queue so it costs O(1) amortised, and cap at, for example, 4,000 records (oldest first).
  - (c) Restrict offscreen capture to squads within one viewport of the camera.
  - Test: zoomed-out prune for 120 s of simulated time leaves `records.size` at or below the cap and expires records older than 45 s without any `sample` call. Effort XS–S.

### 3. Strategic-zoom frames rebuild formation geometry for every squad on every frame (≈60 % of `draw`)
- **Where:** `src/skirmish/client/Renderer.ts:1443-1497`. That is `formationEnvelope(squad,visualTick)` for every squad before the cull (`:1454`) and `formationRenderPose(squad,visualTick, …)` for every visible squad (`:1492`). These go through `FormationRenderPose.ts:24-80`, which calls `formationEnvelope`, `formationSlots` and `formationFootprints` and allocates polygons, and through the `domain/FormationGeometry.ts:311-322` cache. That cache keys on the formation object plus `tick` during transitions, and builds a `geometryKey` string on every call (`:121-141`).
- **Severity:** high at the target load. **Confidence:** high (CONFIRMED and measured).
- **Mechanism:** at strategic zoom every squad is visible, so the pose is rebuilt about 1000 times per frame at 60 fps. Snapshots arrive only every 200 ms, so the inputs change only at those times, except for `visualTick` in transitions. 07 I11 noted the full-population pass but did not measure it.
- **Measured:** real Chrome, 1042 squads: `draw` p50 17.7–19.9 ms, p95 30–33 ms, p99 41–48 ms. The V8 profile attributes 60 % of draw JS to this closure: `formationRenderPose` 49 % of it, `formationEnvelope`/`computeFormationEnvelope`/`geometryKey` 29 %. At soldier zoom with only a few squads visible, `draw` still cost 8–11 ms (first run), dominated by the pre-cull `formationEnvelope` on line 1454.
- **Consequence:** the strategic view cannot hold 60 fps at about 1000 squads on the reference desktop. On ARM-class laptops (about 2.5× slower) it falls to about 20–25 fps with 100 ms hitches. The cost scales linearly with squads, so pop-up factions and larger maps make it worse.
- **Fix:**
  - (a) Memoise `formationRenderPose` per squad id, keyed on (timeline source snapshot, `Math.floor(visualTick)` when a transition is active, otherwise the snapshot only), in a `Map<number, {key, pose}>` cleared when the source changes. The root translation can be applied at draw time, because `root` only shifts the pose.
  - (b) For the pre-cull radius, use a cheap bound such as `squadViewRadius` plus a per-snapshot cached `broadRadius` per squad id, not `formationEnvelope` per frame.
  - (c) At scales below 6 the strategic marker only needs `strategicFormationBox`. Compute that from the cached envelope, not from footprints.
  - Expected: draw at strategic zoom drops from about 18 ms to about 6–7 ms. Test: two consecutive frames on the same source call `computeFormationEnvelope` 0 times (spy). Effort S.

### 4. Soldier-scale battles cost ≈190 ms per frame, split evenly between choreography JS and `drawImage` submission
- **Where:** `troops/TroopActors.ts` `draw` (per visible detailed squad) and `flush` (the `SoldierDrawQueue` passes), wired as `renderer.squadArtworkOverride` and `renderer.squadArtworkFlush` (`troops/TroopPresentation.ts:36-42`).
- **Severity:** high. **Confidence:** high (CONFIRMED by measurement in real Chrome with sheets loaded; 202 detailed squads, 115 fighting).
- **Measured:** `draw` p50 186.6 ms, p95 298 ms, p99 383 ms, max 651 ms. Of that, `TroopActors.draw` (choreography) p50 90.4 ms and `TroopActors.flush` (sprite submission) p50 86.3 ms. Without loaded sheets the same view costs 20.6 ms. At scale 12 (273 detailed squads) `draw` was p50 298 ms (choreography 137 ms, flush 128 ms, remains 4.5 ms) with p95 1.19 s; the p95/p99 tail includes contention spikes.
- **Consequence:** zooming into a large front produces a 3–5 fps slideshow even on the reference desktop, which is exactly where RTS players micro-manage. 07 I12 predicted this but had no numbers.
- **Fix:**
  - (a) Route `SoldierDrawQueue` through the existing `InstancedActorSprites` (WebGL2). That replaces the ~86 ms flush with about 1–3 ms of instance-buffer upload.
  - (b) Add a soldier budget: detailed actors for at most N soldiers (for example 2,500), nearest the screen centre or the selection first, with the rest falling back to era sprites. Promote the 12 px cut-off to "12 px AND budget".
  - (c) Sample choreography at 30 Hz and interpolate between samples, or skip `FormationEngagement.sample` for squads that are not in contact.
  - Test: a frame-budget test in the harness style (scratchpad `measure/`), and a unit test that the budget never selects more than N soldiers. Effort: M for instancing, S for the budget.

### 5. `CavalryAssaultMotion` re-plans every rider in one frame, giving 12–50 ms spikes per squad
- **Where:** `src/skirmish/client/troops/CavalryAssaultPresentation.ts:494-538` (re-plan when `jumped || changed`), `:96-165` (each `CavalryRidePath` evaluates 64 samples per cubic piece × 5 Bézier evaluations for curvature, plus `Math.max(...slice)`), `:224-386` (`planPass` builds an approach and an exit path per rider). Called per frame per assaulting squad from `TroopActors.ts:1213-1215`.
- **Severity:** medium. **Confidence:** high (CONFIRMED by micro-benchmark; contended machine).
- **Measured** (`assault.ts`, re-plans triggered by moving the contact more than 0.5 tile):
  - 6 riders: median 2.3 ms, max 29 ms.
  - 30 riders: median 12.5 ms, max 57 ms.
  - 60 riders: median 23.5 ms, max 56 ms. First plan for 60 riders: 52 ms.
  - Steady-state frames: 0.04–0.2 ms.
- **Consequence:** every new assault pass whose contact moves more than half a tile re-plans the whole squad synchronously. A cavalry wing of several squads charging together produces frame spikes of 50–150 ms, at the visually most important moment. The `jumped` branch (a tick gap over 2 s, for example after the tab was backgrounded) re-plans every visible assaulting squad at once.
- **Fix:**
  - (a) Spread re-planning: re-plan at most K riders per frame (for example 8) and keep the old pass for the others until their turn. The comment already accepts per-rider passes.
  - (b) Cache `CavalryRidePath` curvature tables. Compute curvature analytically at 64 points only, without the four extra one-sided evaluations per sample, or reduce the samples to 24 per piece for exits.
  - (c) Raise the "changed" threshold to `halfWidth` or 1 tile, or re-plan only riders whose remaining phase is approach.
  - Test: no single `sample` call exceeds 4 ms for 60 riders, measured in the harness. Effort S.

### 6. The stock strip is torn down and rebuilt whenever any stock count changes, which eats clicks
- **Where:** `src/skirmish/client/EmpireHudView.ts:265-300`. Each update rebuilds the `#strategic-stocks` markup (counts and per-item tooltips). `if (stock !== this.stockKey) { … strip.innerHTML = stock; … }` is on lines 284–292.
- **Severity:** low–medium (usability). **Confidence:** medium (CONFIRMED mechanism; frequency SUSPECT).
- **Mechanism:** inventories change whenever production or trade completes, so the strip's DOM is replaced at publication cadence (up to 5 Hz online, 8 Hz locally) during a normal economy. The code restores `open` state and focus, but a pointer press that straddles a rebuild loses its `click`: the pressed `<summary>` is detached before `pointerup`. Hover tooltips (`data-dock-tip`) are also re-anchored.
- **Consequence:** clicking a stock group to expand it intermittently does nothing in busy economies. That is a "the UI ignored me" bug that is hard to reproduce.
- **Fix:** build the strip once and update `<b>` text nodes and the `data-dock-tip` attribute in place. Only change structure when the set of groups or items changes. Effort XS–S.

### 7. Several `innerHTML !== markup` comparisons never match when the text contains `'` or `"`, so those nodes are rewritten on every HUD update
- **Where:** `src/skirmish/client/HudView.ts:448` and `:610` (tooltips), `:568` (trade meters), `:572-573` (stats). The escaper is at `HudView.ts:43-50`.
- **Severity:** low. **Confidence:** high (CONFIRMED in Chrome 152: after `innerHTML = "<p>It&#39;s a &quot;test&quot;</p>"`, reading `innerHTML` back returns `<p>It's a "test"</p>`, so the comparison is false; the cost was not measured).
- **Mechanism:** `escape` turns `'` into `&#39;` and `"` into `&quot;`. When the browser serialises `innerHTML`, text nodes print those characters raw, so the stored string never equals the generated one. 38 unit and technology descriptions in `content/*.json` contain apostrophes. An open tooltip, or a selection whose stats contain quotes, is re-parsed on every HUD update, followed by `offsetWidth` reads that force layout (`HudView.ts:613-621`).
- **Fix:** compare against a cached last-markup string, as `ResearchOpportunitiesView` already does (`ResearchOpportunitiesView.ts:73-84`), not against the live `innerHTML`. Effort XS.

### 8. While placement mode is active, `PlacementPreview.update` serialises every barrier and diffs every retained chunk on each publication
- **Where:** `src/skirmish/client/PlacementPreview.ts:190-201` (`JSON.stringify` of all live barriers, including every tile array, plus all alliances), `:245-291` (256-cell owner diff per retained chunk, each with `isValidCoord` and `ref`), `:292-335` (troop-tile set diff over all squads).
- **Severity:** low–medium. **Confidence:** medium (CONFIRMED mechanism; SUSPECT magnitude, not measured).
- **Consequence:** at strategic zoom on 1000×1000 every visible chunk is retained: up to 3,906 chunks × 256 cells ≈ 1 M owner comparisons per publication. Together with late-game wall networks of thousands of tiles stringified each publication, holding a building hotkey while zoomed out can add several ms per publication on top of issue 3.
- **Fix:** key barrier geometry on `expansion.fortificationRevision`, which already exists and is used by `WallPresentation.ts:29-34`, not on JSON. Diff chunk ownership only for tiles in the publication's changed-tile list: the online stream already carries `changedTiles`. Effort S.

### 9. `TechnologyViewModel` rebuilds all trees on every getter access and has latent empty-tree crashes
- **Where:** `src/skirmish/client/TechnologyViewModel.ts:19-64`. `tree()` calls `this.trees` again, and `technologyTreeMarkup` calls both (`TechnologyTreeView.ts:29-31`). `Math.max(...requiredNodes.map(...))` gives `-Infinity`, and `requiredNodes.reduce(...)` with no initial value throws a `TypeError` on an empty array (`:24`, `:30-31`).
- **Severity:** low. **Confidence:** high for the mechanism; the crash is latent. A tsx check (`tech.ts`) found every age × tree pair currently has required nodes.
- **Consequence:** double the work per technology-panel render. If a future content edit leaves a tree with only optional nodes in some age (the carrier and nuclear content is being added right now), opening that age's technology panel throws inside `EmpireView.render`, and the HUD update dies every 500 ms.
- **Fix:** compute `trees` once per view model, give `reduce` a seed, and guard `optionalStart`. Add a unit test for an all-optional tree. Effort XS.

### 10. Smaller items
- **Dead code.** `MatchMetricsViewModel.ts` has no production importer, only `tests/skirmish/MatchMetrics.test.ts`; `main.ts:913-915` reads the same fields directly. Remove it or use it. Low, high confidence.
- **`BattleTuning.battleDefinition` silently ignores a `tuning.attack` patch** for units with split melee/ranged channels: `unit.attack = unit.rangedAttack ?? unit.meleeAttack ?? weapon(unit.attack, tuning.attack)` (`lab/BattleTuning.ts:105-108`). The importer guards this (`BalanceDraft.ts:258-259`), but `editRecipe` (`BalanceDraft.ts:99-120`) does not. Lab only. Low.
- **Rank launch spacing defaults disagree.** `createBalanceDraft` defaults `rankLaunchSpacing = 0.25` (`BalanceDraft.ts:128`), but `parseBalanceDraft` treats an absent value as `1` (`:381-384`). A hand-written or v1 draft without the field replays with four times the spacing. Low.
- **`readExperiment` relabels stored revision 1/2 experiments as revision 3** after validating them against the old baseline (`BalanceExperiment.ts:313-320`). Absolute stat overrides then apply on top of a different baseline. Lab only. Low.
- **`GroundBake.writeTexel` allocates** (`rgbAt` returns arrays, and `[r/n, g/n, b/n]` is built per water texel) for every texel of the one-off bake (`GroundBake.ts:36-63`). That is about 1–2 M short-lived arrays on 1000×1000 during `setMap`. It is a one-off, so it is not a frame cost. Low.
- **Image loads with no repaint callback.** `TrenchArtwork.frame` and `BuildingArtwork` create images with no completion callback (`TrenchArtwork.ts:13-18`, `BuildingArtwork.ts:26-33`). They rely on continuous 60 fps redraw, so they would stay blank if the renderer ever stops redrawing static frames. `RoadArtwork` and `TerrainArtwork` do invalidate. Low.
- **`RecruitmentQueueView` and `HudView` create `ResizeObserver`s that are never disconnected** (`RecruitmentQueueView.ts:13-18`, `HudView.ts:332-336`). Both are long-lived singletons today, so this is not a leak; it becomes one if the views are ever re-created per match. Low.
- **`EmpireView.render` builds a CSS attribute selector from `dataset` values without escaping** (`EmpireView.ts:567-575`). Values are internal ids today; a `"` in any data attribute would make `querySelector` throw inside the HUD update. Use `CSS.escape`. Low.
- **`AircraftGroundPresentation` assigns berths without a bound** (`AircraftGroundPresentation.ts:77-84`, berth slot search at `:81`; apron layout `:142-145`). The apron layout draws six berths (`slot % 3`, `floor(slot/3)`), so a seventh aircraft per field is drawn off the apron. `AirfieldCapacity` probably caps this at six; with carriers sharing berths, verify that. Low, SUSPECT.

## Recommendations (prioritised)

1. **Fix the marker owner (issue 1).** One argument. XS. Ship immediately; it is wrong for every non-host human online.
2. **Stop the zoomed-out remains leak (issue 2).** Skip capture when not detailed, and evict on `add` with a 4k cap. XS–S. A test is described above.
3. **Memoise formation render poses per publication (issue 3).** About 2× faster strategic frames at the target squad count. S. Re-measure with the scratch harness: target `draw` p95 under 12 ms at 1000 squads.
4. **Soldier budget, then instancing (issue 4).** First a hard detailed-soldier budget (S), which bounds the worst case today. Then route `SoldierDrawQueue` through `InstancedActorSprites` (M), which halves the remainder. Choreography LOD (S–M) addresses the other half. Do all three before inviting eight humans to zoom into the same front.
5. **Spread cavalry re-planning across frames (issue 5).** S.
6. **Patch the HUD DOM in place (issues 6 and 7).** XS–S each.
7. **Placement preview on revisions and changed tiles (issue 8).** S.
8. **Defer P1 (incremental presentation).** It is a network and memory item. Measured, it saves about 10 ms per publication on the main thread, which is small next to items 3–4 (18–190 ms per frame).
9. **Make the measurement repeatable.** Commit a version of the scratch harness as `scripts/measureClientFrames.ts` plus an HTML page under `skirmish/`. It already builds 52 factions and about 1000 squads and drives a real `Renderer` in Chrome. Run it on an idle machine to get clean absolute numbers. The checked-in late-game replay fixture also needs regenerating: it fails `Squad manpower does not match its recipe`.

## Open questions

- Is the strategic zoom intended to show every squad's formation box at 3 px per cell? If clusters were aggregated below about 4 px per cell, issue 3 would mostly disappear.
- Should remains appear at all for casualties that happened while the player was zoomed out (issue 2 fix (a) drops them)? RoN shows none.
- `EmpireView.diplomacyContent` shows any faction's gold, land, squads, warships and plane squadrons (`EmpireView.ts:776`, `vm.militaryCounts`). Is full intelligence on opponents intended for 8-human play?
- Should `combatTargets` also show allied targets? Today the intent is "own", but no relation is encoded.
- Is the working-tree carrier feature expected to share berths through `AircraftGroundPresentation` (six berths per field), or does the carrier get its own apron layout?
