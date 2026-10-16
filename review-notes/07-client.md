# 07 — Browser client: rendering, HUD, controls, decode worker, RTS usability

Reviewer scope: `src/skirmish/client/*` as it stands in the working tree (branch `1.5.7-10hz-prototype`, 8 Hz sim, 5 Hz publish). Everything below is judged against the matured target (8 humans + 14 AI nations + 30 tribes = 52 factions, ~1100 squads / 300 warships / 630 traders / 430 buildings on 500x250 and larger maps), not the current 20-faction lobby cap.

Conventions: **CONFIRMED** = traced end to end in code (and, where stated, measured); **SUSPECT** = mechanism is real but magnitude or user-visible effect not measured.

## Scope read

Fully read:
- `src/skirmish/client/main.ts` 1–2177
- `src/skirmish/client/Renderer.ts` 1–2479
- `src/skirmish/client/multiplayerStateWorker.ts` (all), `PresentationState.ts` (all), `CanonicalStateStream.ts` (all), `OnlineMatchSession.ts` (all), `LocalSnapshotStream.ts` 1–40
- `HudViewModel.ts` (all), `EmpireViewModel.ts` (all), `SkirmishViewModel.ts` (all)
- `Controls.ts`, `OrderGesture.ts`, `ControlGroups.ts`, `SquadSelectionViewModel.ts`, `CameraPanViewModel.ts` (all)
- `InstancedActorSprites.ts`, `StrategicSprites.ts`, `GroundLayer.ts`, `PaintedTerrain.ts`, `TerritoryLayer.ts`, `TerritoryBorders.ts`, `TerritoryLabelViewModel.ts`, `FactionColors.ts`, `LocalSkirmishProfile.ts` (all)
- `troops/TroopPresentation.ts`, `troops/TroopActors.ts` 1–1271, `troops/TroopChoreography.ts`, `troops/TroopCasualties.ts`, `troops/FactionFrames.ts` (all)
- `CombatPresentationTimeline.ts`, `RenderSamples.ts`, `UnitAnimation.ts`, `UnitPresentation.ts`, `FormationSoldierMotion.ts`, `SoldierDrawQueue.ts`, `SoldierSelectionIndex.ts`, `FormationRenderPose.ts`, `EraArtwork.ts`, `BuildingMarkers.ts`, `FormationArtwork.ts`, `TraderPresentation.ts`, `AircraftLayer.ts`, `HealthLossTrail.ts`, `FormationAngleSamples.ts`, `BuildingFacts.ts` (all)
- `src/skirmish/lobby/FactionPalette.ts` (all)

Skimmed / grepped: `style.css` (canvas layering 161–192), `HudView.ts` 43, 470–530, `EmpireView.ts` 23, 169–280, 453, 694–776, `EmpireHudView.ts` 15, 69–160, 269–290, 390–501, `ArmyView.ts` 30–173, `PeaceOfferView.ts` 24, `AllianceRenewalView.ts` 51–55, `src/skirmish/worker.ts` 36–60, 76–90, 150–175, `src/skirmish/multiplayer/application/LiveMatch.ts` 30–60, 720–760, `src/skirmish/domain/FormationGeometry.ts` 316–327 (`formationEnvelope` cache), `src/skirmish/Forest.ts` 86–107, `TerrainDecorations.ts` 248–264, `src/skirmish/FactionRules.ts` 28–38, 95, `src/skirmish/Protocol.ts` 18–29, `vite.config.ts` 320–345, `package.json` scripts.

Tests read: `tests/skirmish/ClientControls.test.ts`, `tests/skirmish/CombatPresentationTimeline.test.ts` (all), `tests/skirmish/HudViewModel.test.ts` (test names).

Tests run (read-only): `npx vitest run --config vite.skirmish.config.ts tests/skirmish/HudViewModel.test.ts tests/skirmish/ClientControls.test.ts tests/skirmish/CombatPresentationTimeline.test.ts` → 3 files, 33 tests, all pass. Note: the default `vitest run` config excludes `tests/skirmish/**` (`vite.config.ts:331-336`); the skirmish suite only runs via `npm run test:skirmish` (`package.json:11`). Running the files through the default config also picks up stale copies under `out/late-game-playability-20261012/baseline/` which fail on missing art manifests.

Measurement script (scratchpad only, not in repo): `clone-cost.ts` builds a 500x250 `Skirmish` with 14 AI + tribes, steps 400 ticks, scales the snapshot to 1100 squads / 300 ships / 430 buildings / 630 traders, and times `structuredClone` of the entity graph (the exact payload shape `multiplayerStateWorker` posts). Results are quoted where used.

## How it works today

### Thread / surface topology
- **Main thread** owns four stacked canvases inside `main.battlefield` (`style.css:161-192`): `GroundLayer` (WebGL2, z 0, full-map quad shader: colour texture + fields texture + noise; animated water), `#battlefield` (Canvas2D, z auto — all territory, buildings, squads, soldiers, text, previews, overlays), `StrategicSprites` (WebGL2, z 1, one instanced draw of formation/ship markers: `StrategicSprites.ts:add/flush`), `AircraftLayer` (Canvas2D, z 2, planes and air volleys). So the renderer is **mixed**: WebGL2 for the ground and for strategic-zoom markers, Canvas2D for everything else including individual soldiers. `InstancedActorSprites.ts` (a WebGL2 soldier batcher) exists but is **not wired into** `TroopActors`/`Renderer` (no import outside itself); soldier sprites are drawn with `ctx.drawImage` from `SoldierDrawQueue` (`TroopActors.ts flush`).
- **Online decode worker** (`multiplayerStateWorker.ts`): receives the binary packet (transferred), `decodeState` → `CanonicalStateStream.apply` (validates and keeps the canonical latest snapshot plus a dirty-tile map) → `presentationState()` → `postMessage({...entities}, transfer:[tiles.buffer])`. Only the sparse tile buffer is transferred; **the entire entity graph (squads, ships, traders, buildings, volleys, projectiles, expansion minus roads/deposits unless changed) is structured-cloned** (`multiplayerStateWorker.ts:100-101`, selected by `OnlineMatchSession.ts:239 entities: true`). A `packed` typed-array path (`presentationPacket`) exists but is unused by the session.
- **Local worker** (`src/skirmish/worker.ts`): runs the sim; at 1x it publishes **every tick** (8 Hz, `worker.ts:83`), at 2x/4x once per 125 ms wall, and immediately (≥30 ms apart) after each command (`worker.ts:156`). Local packets are decoded **on the main thread** (`main.ts:600 decoder.decode`).
- **Server** publishes background state at most every 200 ms wall and 200 ms sim (`LiveMatch.ts:35, 728-734`) plus immediate publications after executed commands.

### Per-snapshot work (main thread; 5/s online, 8/s local)
1. Message deserialization (structured clone receive). Measured on the target-scale graph: ≈1.27 MB JSON-equivalent, ~756 bytes per squad row, `structuredClone` round-trip 16–18 ms in Node (serialize+deserialize; the main thread pays roughly the deserialize half, ≈8 ms, synchronously inside the message event).
2. `PresentationStateDecoder.apply` (`PresentationState.ts`): applies tile pairs into three map-size `Uint8Array`s (shared instances returned in every snapshot).
3. `Renderer.update` (`Renderer.ts:395-535`): combat timeline push; `assignFactionColors` roster string; `squadSamples.update` (one wrapper per squad, segment length = tick span × 125 ms / speed, clamped 50–600 ms); `combatTargets`; `healthLoss.update` (allocates 1100 rows); building-gun update; aircraft art ids; trade payouts; territory text cache; building selection reconcile; roads/walls/trenches/impacts; `new ResourceViewModel`; selection pruning; `UnitPresentation.update` (per-squad angle/clip state, O(squads+volleys+projectiles)); trader/aircraft/boat presentation; camp loss; `TerritoryLayer.update` (changed tiles only once initialised, full map on reset or palette change); `TerritoryLabelViewModel.update` (linked-list ownership index, incremental); `BuildingFacts.changed` → when any of id/owner/type/tile/ticks/age/**health**/**nextAttackTick**/launchReadyTick changed, rebuild `buildingStacks`, `occupiedBuildingTiles` (every footprint cell) and diff forest/decoration clearing (diffed by tile:type, cheap).
4. `localPresentation.update` (stores latest), `groups.prune` (two Sets over all squads/ships), `hudPending = true`.
5. Next frame: `updateHud` (`main.ts:875-955`) builds fresh `SkirmishViewModel`/`EmpireViewModel`/`HudViewModel`, `recruitmentQuotes` for 4 kinds (filters all buildings per kind), `updateSelection` (two more `squads.filter`), `updateGroups` (10 × `groups.recall`, each pruning again), army projection, roster (only when open).

### Per-frame work (rAF, capped to 60 fps by `Renderer.ts:1081-1085`)
`frame()` (`main.ts:2140-2170`): HUD flush if pending → WASD pan → right-drag deployment/trench preview (`drawnDeployment`: `layoutBattleLine` + `certifyFootprint` per selected squad, recomputed only when the drag moved or the tick changed) → `localPresentation.beginFrame` → `renderer.combatFrame` = `CombatPresentationTimeline.sample` (**allocates a full copy of `source.squads` and a `Map` of `next.squads` every frame**, `CombatPresentationTimeline.ts:79, 98`) → `actors.prune(latest)` whenever the timeline's source snapshot changed (several O(squads) passes, `TroopActors.ts prune`) → `renderer.draw`:
- GL ground draw (one quad); `PaintedTerrain.draw` blits cached decoration chunks (LOD 16/8/4/2 px per cell at scale ≥12/≥5/≥2/else, 12 Mpx LRU); roads; `TerritoryLayer.draw` (chunk image blits + ~10 Path2D stroke passes over visible chunks); wasteland; soldier remains; territory names (`advance` ≤2 ms budget, incremental generator).
- Players loop (52: zzz/camp-lost text), walls and trenches (all tiles, culled), building stacks (430, culled, `drawBuilding` with era sprites), placement ghost.
- **Squads: one pass over all squads** (`Renderer.ts:1427-1471`) computing `legacyWeaponStrength`, `squadViewRadius`, `formationEnvelope` (cached per formation object), `squadArtworkPose`, era frame lookup, `squadSymbol`, then culling; visible entries get ground indicators (range rings, capture ring, route lines for selected), then either `TroopActors.draw` (scale ≥ 12 and sheets loaded: per-soldier choreography/motion sampling, engagement sampling twice, `FactionFrames.get` string-keyed per soldier, `SoldierDrawQueue` sort, three draw passes), or era sprite `drawImage`, or a strategic marker batched into `StrategicSprites` (fallback: pre-rotated cached heading canvases, `FormationArtwork.heading`).
- For each **fighting melee squad**, `snapshot.volleys.filter(...)` is evaluated per frame (`Renderer.ts:1850`).
- Ships (300, culled; era sprites at scale ≥ 12), deposits (scale ≥ 3), traders (630: `traderActivity` + interpolated `pose()` computed **before** the viewport cull, `Renderer.ts:2093-2103`), projectiles, impacts, armies, volleys, order marker, previews, selection box, paused overlay; `strategic.flush()` (one `drawArraysInstanced`), aircraft layer.

### Interpolation
- Squads: positions, formation facing and headcounts come from `CombatPresentationTimeline` (`CombatPresentationTimeline.ts`): a playhead in ticks advancing at wall rate × speed, clamped to `latest.tick`, interpolating `frames[0]→frames[1]` by tick fraction; history ≤ 4 frames; catch-up bound 600 ms (`:44`). Casualties and discrete facts apply only when the playhead reaches the endpoint (tested). There is **no explicit playout delay**: the playhead starts at the first snapshot's tick and sits exactly at `latest` until the next arrives; lag then grows to the largest arrival jitter seen (each new jitter maximum = a freeze of that length) and never shrinks except via the 600 ms clamp or a pause (snaps to latest). With 8 Hz sim / 5 Hz publish the spans alternate 1 and 2 ticks (125/250 ms), which is handled correctly by tick-fraction interpolation.
- Aircraft/traders/boats: `RenderSamples.progress(now)` (`RenderSamples.ts`), a per-arrival segment of `spanTicks×125 ms/speed` — if a packet arrives late the segment completes early and these entities freeze until the next packet; they jitter more than squads.
- Extrapolation: none for positions. `PresentationClock` extrapolates the animation tick up to one tick (`UnitAnimation.ts sample`).
- Order echo: none. After a right-click the only immediate feedback is an 800 ms ring (`main.ts:1945-1951`); the route line, "Moving" status and actual motion appear after server receipt (~225 ms mean) + the next publication + playhead lag.

### Input / controls (what exists)
Hotkeys (`Controls.ts`): Q/W/E recruit, A/S/D/F/G/H + Z/X/C/V/N construct, B warship, R replenish/repair, T hold, Home fit, Esc cancel, Ctrl/Cmd+A select all land squads, digits recall / Shift+digit add / Ctrl+digit replace control groups, I/O/U/P air missions, Y/L empire panels, Ctrl+U refit upgrade, WASD toggle (Shift+key keeps command keys; Space = batch of five). Mouse: left click/drag select (shift additive, shift-drag prefers ships), double-click selects visible of same type (squad/ship/building), right click move/attack/attack-structure/occupy trench/sail/naval-attack/sortie, Shift+right = queue (append) and ship waypoints, right-drag = battle-line deployment with facing (ghost preview), second right-click within 350 ms = charge (`OrderGesture.ts`). Middle-drag pan, wheel zoom. Selection is capped at 30 squads (`SquadSelectionViewModel.ts:36-42`, worker rejects >30 per order `worker.ts:150-152`). Armies: create/disband/posture/auto/orders via `ArmyView`. Solo: pause, 1x/2x/4x. Online: pause/speed disabled, commands gated by `syncControls`.

### Colours
`COLORS[playerId]` (`FactionColors.ts`): index 0 neutral grey, 20 authored hues (`FactionPalette.ts`), then `regularColor()` for regular factions beyond 20, `tribeColor()` (chroma 0.30, lift 0.35) for tribes; reassigned per roster change (`assignFactionColors`), which bumps `factionColorRevision` and forces a full territory repaint. Diplomatic relation is encoded only on territory borders (`TerritoryLayer.updateRelations`: allied/neutral/declared war/offensive) — never on unit markers, health bars or the roster.

## Strengths
- Clean authority boundary: the client never simulates; every presentation class is documented as disposable and most prune by live id each snapshot (`UnitPresentation`, `TraderPresentation`, `HealthLossTrail`, `FormationAngleSamples`, `ControlGroups.prune`, `TroopActors.prune`). I found no unbounded id-keyed cache; `FactionFrames` (32 MB), `PaintedTerrain` (12 Mpx), `FormationArtwork.headings` (1600), `BuildingMarkers` (128 atlases), `commandOutcomes` (2048) are all bounded.
- Decode is off the main thread online, flow-controlled (`SNAPSHOT_QUEUE_LIMITS`), coalesces presentations while the renderer is busy (`pendingView`/`scheduleLatestPresentation`), and the dirty-tile obligation is fenced by presentation ACK so dropped views cannot lose tiles (`CanonicalStateStream.acknowledge`). Recovery/resync paths are explicit.
- Territory rendering is chunked with cached `Path2D` borders, diplomatic classification cached per relation key, and label layout is an incremental generator with a 2 ms per-frame budget — good large-map hygiene.
- Combat timeline keeps casualties on the authoritative endpoint and is unit-tested for sparse publications, terminal roots, pause and same-tick republish.
- Strategic zoom is a single instanced WebGL draw with a graceful Canvas2D fallback and context-loss handling; the GL ground keeps CPU copies to survive context loss.
- User-visible strings from players are escaped everywhere I checked (`main.ts:995` roster, `HudView.ts:43`, `EmpireView.ts:23`, `EmpireHudView.ts:15`, `ArmyView` escape; `PeaceOfferView`/`AllianceRenewalView` use `textContent`).
- HUD view-models are pure and tested; `HudView` diffs `innerHTML` before writing.

## Issues

Severity: critical / high / medium / low. Confidence: high / medium / low.

### I1. Per-frame O(fighting squads × volleys) scan for melee hit effects — `src/skirmish/client/Renderer.ts:1850`
- Severity **high**, confidence **high** (CONFIRMED mechanism; magnitude estimated).
- Inside the per-visible-squad draw loop, every fighting melee squad runs `snapshot.volleys.filter(v => v.squadId === squad.id && v.melee && ...)` on the whole volley list, every frame. With a few hundred fighting squads and a volley list of similar size this is ~10^5 closure calls per frame at 60 fps during big battles, exactly when the frame is already most expensive.
- Fix: build `Map<squadId, latestMeleeVolley>` once per snapshot in `Renderer.update` (or lazily per frame) and look it up. Effort: XS.

### I2. `CombatPresentationTimeline.sample` clones every squad and rebuilds a Map per frame — `src/skirmish/client/CombatPresentationTimeline.ts:79, 98-125`
- Severity **high**, confidence **high** (CONFIRMED; measured 0.37 ms/frame for the squad copy alone at 1100 squads in Node, before GC).
- `targets = new Map(next.squads...)` and `squads: source.squads.map(s => ({...s, x, y, formation}))` run on every rAF even though `source`/`next` change only 5×/s. Each squad row is ~750 bytes of nested objects; 1100 copies × 60 fps ≈ 40–60 MB/s of short-lived garbage plus the Map. Minor-GC pauses land inside the frame.
- Fix: cache `targets` per `(source, next)` identity; return unchanged squads by reference (already done when x/y/formation unchanged) and, for moving squads, write interpolated positions into a reusable `Float64Array` indexed by squad order that the renderer and `TroopActors` read through an accessor instead of cloning rows; or at minimum reuse the output array and only re-spread when the fraction changed. Effort: S–M.

### I3. Main thread deserialises the full entity graph every publication — `src/skirmish/client/multiplayerStateWorker.ts:100-101`, `src/skirmish/client/OnlineMatchSession.ts:239`
- Severity **medium**, confidence **high** (CONFIRMED path; measured scale).
- `presentationState()` transfers only the tile buffer; the entity graph goes through structured clone. At target scale the graph is ≈1.27 MB JSON-equivalent; `structuredClone` round trip 16–18 ms (Node 24), i.e. ≈8 ms of synchronous deserialize on the main thread 5×/s, followed in the same task by `PresentationStateDecoder.apply`, `Renderer.update` and (next frame) `updateHud`. That is a near-guaranteed dropped frame every 200 ms independent of what the renderer does, and ~1.3 MB × 5/s of allocation.
- Fix: switch the session to the existing `packed` path (`presentationPacket` → typed-array rows + `snapshotTransfers`) and decode rows lazily on the main thread into reusable structures; or keep the entity graph only for selected/inspected/visible-detailed squads and ship a compact `Float32Array` of (id, owner, x, y, facing, strength, kind) for the rest. Effort: M–L (touches `SnapshotCodec` consumers in the renderer).

### I4. No playout-delay target; jitter becomes freezes, traders/aircraft freeze on late packets — `src/skirmish/client/CombatPresentationTimeline.ts:60-66`, `src/skirmish/client/RenderSamples.ts:40-45`
- Severity **medium**, confidence **medium** (CONFIRMED mechanism; SUSPECT visibility without a network trace).
- The squad playhead is clamped to `latest.tick`; its lag self-tunes upward to the largest arrival jitter seen, so every *new* jitter maximum is a visible stall of that length, and the lag never shrinks (until 600 ms). Server p99 tick time (255 ms) already exceeds the 200 ms publish period, so publication spacing on the ARM host is irregular by design. Traders/aircraft/boats use arrival-time segments (`RenderSamples.progress`) and clamp at 1 when a packet is late — 630 traders visibly stop-and-go.
- Fix: a single `PlayoutClock` with an explicit target delay (e.g. 1 publish interval + measured jitter p95, 250–400 ms), slow shrink (≈10 ms/s) when the buffer stays full, and the same clock driving `RenderSamples.progress`. Trade-off: adds ~250 ms visual latency on top of ~225 ms receipt; must be paired with I5. Effort: S.

### I5. No local feedback for orders beyond an 800 ms ring — `src/skirmish/client/main.ts:1945-1951`, `src/skirmish/client/Renderer.ts:2360-2370`
- Severity **high** (RTS feel), confidence **high** (CONFIRMED).
- A move/attack order shows a ring; the dotted route (`Renderer.ts:1497-1540`) and status text come only from the echoed snapshot. End-to-end, a unit visibly reacts after receipt (~225 ms mean) + up to one publish interval (≤200 ms) + playhead lag (≥0, up to 600 ms) ≈ 0.4–1.0 s. No audio acknowledgement. Build placement likewise: the ghost disappears at click and the construction site appears only on echo; recruit clicks give no immediate queue feedback.
- Fix (no prediction of movement needed): keep a `pendingOrders: Map<squadId, {order, issuedAt}>` on the client; draw its route line/attack line and a "…" status immediately; clear when the snapshot's `squad.order` matches or after 2 s; same for pending builds (keep the ghost at the tile until a building appears) and recruits (optimistic queue cell). Add a short acknowledgement sound per order type. Effort: S–M.

### I6. Second right-click within 350 ms issues a charge — `src/skirmish/client/OrderGesture.ts:26-35`, `src/skirmish/client/main.ts:1931-1943`
- Severity **medium**, confidence **high** (CONFIRMED).
- Repro: select any charge-capable squad (cavalry; infantry in some ages), right-click the ground twice quickly (<350 ms, <10 px). The second click sends `{type:"charge"}` which supersedes the move. RTS players spam-click destinations; this burns charge cooldown/stamina and breaks formation unintentionally, and there is no undo.
- Fix: make charge an explicit modifier (Alt+right-click or a C hotkey/button with a charge-ready indicator) and let a repeated click simply re-issue the order. Effort: XS.

### I7. Control-group recall leaves aircraft selected, so right-click sends a sortie — `src/skirmish/client/main.ts:1146-1152` vs `main.ts:1828-1836`
- Severity **medium**, confidence **high** (CONFIRMED).
- `controlGroup(...,"recall")` replaces `selected`/`selectedShips` and clears building/inspection/deposit but never `renderer.selectedAircraft`. The right-click handler checks `selectedAircraft.size` first and returns. Repro: click a friendly aircraft, press `1` (a bound land group), right-click ground → a bombing/patrol sortie is sent (or "No ready selected aircraft…" toast) and the group never moves. `selectArmy` and `selectAll` do clear it.
- Fix: clear `selectedAircraft` in recall. Effort: XS.

### I8. Silent 30-squad selection cap — `src/skirmish/client/SquadSelectionViewModel.ts:36-42`, `src/skirmish/client/main.ts:881, 1165-1180`
- Severity **medium**, confidence **high** (CONFIRMED).
- Drag-selecting or Ctrl+A over more than 30 squads keeps the 30 strongest and drops the rest with no toast; the HUD count just reads "30 squads". In a 1100-squad match a human with 80 squads cannot address them except via the army panel. The worker also rejects >30-squad orders, so splitting on the client is possible today.
- Fix: toast "Selection limited to 30 squads (N dropped)"; let the client fan out orders in batches of 30 (same destination, with a per-batch offset or the battle-line layout) so the cap becomes an order-size limit rather than a selection limit; make "create army from selection" a hotkey. Effort: S.

### I9. Overlay canvases paint above selection box, paused dim, route lines and previews — `src/skirmish/client/style.css:169-183` (z-index 1/2) vs `#battlefield` `style.css:185-192` (no z-index); `Renderer.ts:2396-2412`
- Severity **medium** (polish), confidence **high** (CONFIRMED by CSS + DOM order `StrategicSprites.ts base.after`).
- At strategic zoom every formation marker is composited above the drag-selection rectangle, deployment/trench ghosts, order route lines and the "Paused" dim, and aircraft above everything. Symptoms: bright markers over a dimmed paused map; the selection box disappears behind dense markers.
- Fix: draw selection box / previews / paused overlay on the top `AircraftLayer` context (already the topmost 2D surface), or add a dedicated overlay canvas. Effort: XS.

### I10. Tribe palette is not distinguishable; no relation encoding on units; no colour-blind mode — `src/skirmish/client/FactionColors.ts:5-7, 44-48, 101-106`
- Severity **high** (52-faction target), confidence **high** (CONFIRMED by computation).
- `tribeColor` = golden-angle hue at chroma 0.30, lift 0.35 → every channel in [89,166]. Computed over the 30 tribe colours: minimum RGB distance 8.1 (indices 8 and 29: `#a69f59` vs `#a2a659`), 34 of 435 pairs under 25 RGB units; at `TERRITORY_ALPHA` 0.35 over painted ground these are the same colour. Regular slots 21–22 (`regularColor`) yield `#cc5740`/`#40cc80`, close to Coral/Crimson and Lime/Forest. Relation (ally/enemy/neutral/at war) is shown only as border styling (`TerritoryLayer.updateRelations`); unit markers, health bars, roster and selection cards use faction colour only, so "is this squad hostile?" cannot be read from the marker at any zoom.
- Fix: (a) a diplomatic colour mode (self / ally / neutral / enemy / tribe = 5 colours, Rise of Nations style) toggled by a key; (b) relation ring/outline on markers and health bars regardless of mode; (c) tribe identity by lightness band × 6–8 hues plus a glyph, and reserve the 20 authored hues for nations/humans only (14 AI + 8 humans = 22, so add two authored hues rather than computed ones); (d) a deuteranopia-safe palette preset. Effort: S (mode) / M (palette rework + lobby validation).

### I11. Full-population passes before culling each frame and on every pointermove — `src/skirmish/client/Renderer.ts:1427-1440, 2093-2103`, `main.ts:1546`
- Severity **medium**, confidence **high** (CONFIRMED mechanism; SUSPECT magnitude).
- `draw` evaluates strength/view-radius/envelope/pose/era-frame for all 1100 squads and `traderActivity` + interpolated `pose()` for all 630 traders before the viewport test; `squadAt` (hover, every pointermove) iterates all squads computing `squadSymbol`, `eraArtwork.get`, formation pose/contains; `depositAt` iterates all deposits. At 1100 squads this is a few hundred µs to ~1 ms per frame/pointermove, worst at strategic zoom when most are visible anyway.
- Fix: a uniform spatial grid (e.g. 16-cell buckets) rebuilt per snapshot in `Renderer.update` and used by `draw`, `squadAt`, `squadIntersectsBox`, `depositAt`, `buildingAt`; cull by bucket before any per-entity work. Effort: M.

### I12. Soldier-level draw path cost structure at scale ≥ 12 — `src/skirmish/client/troops/TroopActors.ts draw/flush`, `FactionFrames.ts:get`
- Severity **medium**, confidence **medium** (CONFIRMED structure; SUSPECT numbers — no profile).
- Per visible detailed squad per frame: `FormationEngagement.sample` twice, `FormationSoldierMotion.sample` (per-soldier integrator, O(n²) separation only in lane travel), `TroopChoreography.formationSoldiers` (allocates), per-soldier `FactionFrames.get` with a string key built per call, `draw()` closures, `SoldierDrawQueue.sort`, three Canvas2D passes with save/translate/rotate/drawImage/restore per soldier. At 1920 px wide and scale 12 the viewport holds ~160×90 cells: 50–150 squads × 12–40 soldiers = 1–5k sprites/frame, each a state-changing `drawImage`. `InstancedActorSprites` (WebGL2 instanced soldier quads, tinted via vertex colour) is complete but unused.
- Fix: route the sorted `SoldierDrawQueue` through `InstancedActorSprites` (atlas pages of the actor sheets; faction tint via mask layer instead of pre-tinted canvases), keep Canvas2D only for impacts/rings; precompute `FactionFrames` keys as integers. Effort: M–L.

### I13. HUD refresh does redundant full passes per publication — `src/skirmish/client/main.ts:875-955, 1100-1128`
- Severity **low**, confidence **high** (CONFIRMED).
- Each publication: three view-model constructions, `recruitmentQuotes` (4 × building filter), two `squads.filter` in `updateSelection`, and `updateGroups` → 10 × `groups.recall` each calling `prune` (two Sets over all squads and ships) + a squad filter — ≈30 passes over 1400 entities, on the same task as I3. Cheap (~1–2 ms) but avoidable.
- Fix: recall/compare groups only for digits whose membership changed; memoise quotes per snapshot. Effort: XS–S.

### I14. `BuildingFacts.changed` keys on `health` and `nextAttackTick` — `src/skirmish/client/BuildingFacts.ts:3`, `Renderer.ts:470-535`
- Severity **low**, confidence **high** (CONFIRMED).
- During sieges or whenever any gun nest fires, every publication rebuilds `buildingStacks` and `occupiedBuildingTiles` (all footprint cells) and re-diffs forest/decoration clearing (diffed by tile:type, so cheap). O(430) per publication; acceptable, but the stack/occupancy rebuild should key on structural fields only. Effort: XS.

### I15. Aliased ownership buffers across timeline frames — `src/skirmish/client/PresentationState.ts:apply` returns shared `owners/claims/progress`; `CombatPresentationTimeline.ts` retains up to 4 snapshots
- Severity **low**, confidence **medium** (latent; no consumer reads old frames' owners today).
- Every online snapshot object references the same three `Uint8Array`s that `apply` mutates in place; the timeline keeps 4 such snapshots and hands `frame.snapshot`/`frame.source` to `TroopActors`. Any future per-frame ownership read (e.g. interpolating capture, friendly-land checks from the presented frame) would silently read the newest ownership for an older frame — the same class as the trade freeze (cached references crossing an ownership change). Recommend documenting the alias in `PresentationState` and reading ownership only from `renderer.snapshot`. Effort: XS (doc) / S (copy-on-reset only for the timeline).

### I16. Ctrl+digit for "replace group" collides with browser tab switching — `src/skirmish/client/Controls.ts:76-84`
- Severity **low**, confidence **low** (SUSPECT; browser-dependent, not tested).
- Chrome on Windows/Linux does not let pages cancel Ctrl+1…8 in all versions; the key may switch tabs mid-match. Offer Ctrl+Shift+digit or Alt+digit as the replace binding and document it. Effort: XS.

### I17. Default `npm test` never runs the skirmish suite — `vite.config.ts:331-336`, `package.json:11`
- Severity **low**, confidence **high** (CONFIRMED).
- `tests/skirmish/**` is excluded from the default config; only `npm run test:skirmish` runs it. If CI calls `npm test` only, every client/HUD test above is skipped. Open question whether CI runs `test:skirmish`.

### I18. RTS feature gaps versus Rise of Nations / AoE (grep-confirmed)
- Severity **medium** collectively, confidence **high**.
- Missing: attack-move (no command type, `Protocol.ts`), ground patrol (patrol exists only as an air mission), unit stance/aggression (only army posture), rally points, idle-unit cycling, minimap (none; `minimap` 0 hits), map pings, chat, edge-scroll, camera bookmarks/follow, select-all-of-type-on-screen hotkey (double-click only), "next army" hotkey, keyboard zoom. Present: control groups, shift-queue, ship waypoints, hold, formation shapes, right-drag line deployment with facing, armies with posture, pause/speed in solo, world-events feed, per-faction diplomacy panel, alliance/peace cards.

## Recommendations (prioritised)

1. **Order feedback now** (I5) — pending-order overlay + ack sound. S–M. Biggest perceived-latency win; independent of networking.
2. **Fix the two gesture bugs** (I6 charge-on-spam, I7 aircraft recall) and the overlay z-order (I9). XS each. Ship together.
3. **Per-frame allocation cuts** (I1, I2) — Map of melee volleys per snapshot; cache `targets`, stop cloning squad rows per frame. XS + S–M. Measurable within a day with the existing `browser-runtime-diagnostics` log.
4. **Playout clock** (I4) — one clock with target delay + slow shrink driving both the timeline and `RenderSamples`. S. Do after (1) so added delay is masked by local feedback.
5. **Diplomatic colour mode + relation outlines** (I10) — S for the mode, M for palette rework. Required before 52-faction play is readable.
6. **Selection cap UX** (I8) — toast + client-side order fan-out + army hotkey. S.
7. **Packed presentation transport** (I3) — move the session to `presentationPacket` and decode rows lazily. M–L. Pair with a spatial grid (I11) so per-row work is cull-first. M.
8. **Instanced soldiers** (I12) — wire `InstancedActorSprites` behind `SoldierDrawQueue`. M–L. Profile first with the diagnostics overlay at scale 12 on Mediterranean.
9. Minor: I13, I14, I15 docs, I16 binding, I17 CI check. XS each.

### What 8 humans in one lobby need from the HUD (explicit)
- **Chat**: team/all text with the existing `editingText` guard (`main.ts:2017-2021`) so hotkeys stay dead while typing; Enter to open, Esc to close; messages in the world-events feed with sender colour. Needs a relayed, rate-limited server message (not a sim command).
- **Pings**: Alt+click → `{tile, kind}` relayed to allies; render a 2 s expanding ring on the map (reuse `renderer.marker` style), a feed line "Name pinged (jump)", and a blip on the minimap once one exists.
- **Minimap with alerts**: ownership texture (reuse `TerritoryLayer` chunk images downscaled), own units as dots, blips for "building under attack" / "squad lost" / "ally pinged"; click to jump, drag to pan. The ownership data already lives in `renderer.territory`.
- **Diplomacy overview**: one panel listing all 52 factions grouped by relation (ally / at war / raid / neutral / tribe) with sortable columns (age, land, army size, trend) and inline offer/accept buttons; today `inspectPlayer` is one faction at a time via clicking territory or the roster (`EmpireView.ts:201-229`). Add alliance chat and shared-vision toggles later.
- **Player list / status**: connection state and latency per human (today only "zzz" on the map and territory label, `Renderer.ts:1178-1190, 848-859`), elimination state, team colour swatches, and a resign/observe flow (observer mode after elimination is absent).
- **Team-aware colours**: diplomatic colour mode (I10) and ally-tinted unit outlines so eight humans plus 44 AI are readable at strategic zoom.
- **Notifications**: the events feed exists (`EmpireHudView.ts:128-134, 489-501`) but carries no map position; add "jump to" on conquest/attack/diplomacy events.

## Open questions
- Does CI run `npm run test:skirmish`? (`npm test` excludes `tests/skirmish/**`.)
- Is the `packed` presentation path (`CanonicalStateStream.presentationPacket`) maintained and tested against the renderer, or is it dead code to be removed?
- Has the soldier-level path been profiled at scale ≥ 12 on the 1100-squad reference match? The diagnostics log records `frame`, `presentation`, `decode` but I found no per-layer breakdown (`TroopActors.sortMs`/`drawnSoldiers` are computed but not logged).
- Is `InstancedActorSprites` intended to replace Canvas2D soldiers, or kept as a lab-only experiment?
- Intended semantics of the 30-squad order cap at the 1100-squad scale: hard design limit (push players to armies) or a transport limit the client should fan out?
- Will pop-up factions (nomads/pirates) reuse tribe colour slots? If so I10(c) must guarantee a free, distinguishable slot per pop-up.
