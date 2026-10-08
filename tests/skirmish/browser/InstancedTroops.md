# Russian Stone Age instancing prototype

Start the existing local Vite server from the repository root:

```powershell
node node_modules/vite/bin/vite.js --config vite.skirmish.config.ts --host 127.0.0.1 --port 9019 --strictPort
```

Open `http://127.0.0.1:9019/tests/skirmish/browser/InstancedTroops.html`. The **Play Stone Age demo** link opens a local 20-versus-20 battle using real game movement and combat; see [StoneAgeDemo.md](./StoneAgeDemo.md).

## Scope

This is a standalone synthetic browser scene, not integrated into match rendering. It changes no authoritative simulation, protocol, selection, routing, combat, or production artwork. `InstancedActorSprites.ts` is imported only by this review scene. `MapCameraScale.ts` extracts the game's existing camera arithmetic unchanged; both `Renderer.ts` and the scene use those shared functions.

The scene reads the individual Russian Stone Age Clubman, Javelinist, and Mounted Spearman manifests under `Art/Cultures/Russians/Units/StoneAge/`. It follows the manifest filenames, frame pivots, clip scales, and authored frame durations, including cavalry clips without an fps field. It loads idle, running, attack, and death clips. Each six-frame source sheet is baked once into a 384 by 256 atlas page with 128-pixel frames. Twelve GPU pages consume 4.5 MiB of uncompressed texture storage, excluding browser source decoding, CPU canvases, drawing surfaces, and instance buffers.

The WebGL2 pass shares quad geometry and a texture array across all actor types and clips, producing one instanced soldier draw per frame. Typed instance storage and GPU buffer allocation grow as needed and are reused. Canvas renders the same atlas pages and instance records for comparison. Unsupported, failed, or lost WebGL contexts use Canvas; restoration rebuilds the GPU resources from retained atlas pages.

## Review controls

- **Scene** switches between grid review and three separate 20-versus-20 face-offs (120 formations total). Battle preview turns the opposing sides toward each other, fits the encounters into view, and keeps individual actors visible. It uses the same tile size, layouts, and horse sizing, with no combat simulation. Pan and zoom to inspect each encounter. Stress and fixed-comparison controls return to the grid scene.

- **Formation** defaults to line and offers infantry line, shield wall, or outward-facing square. Cavalry remains in line regardless of infantry selection. Wedge is reserved for charge. Infantry uses a compact filled triangle with one tip soldier and widening ranks containing interior soldiers; cavalry uses widening triangle ranks (1-2-3 when six actors are selected), with spacing adjusted for horse size. **Action > Charge preview** reshapes into wedge, walks/attacks, then automatically returns after five seconds to the selected infantry formation (cavalry returns to line). The formation tour cycles the three manual choices and a charge preview. Each soldier keeps a stable cosmetic identity with staggered curved walking tracks, preserved world size, and interrupted movements starting from current poses. Line preserves column pitch and compresses rank spacing; partial ranks sit at the rear. Block, marching, and the original authored preview choices have been removed.
- **Formation footprint** chooses fixed world size: one tile at full strength (default), or the smaller world footprint matching the old 55-pixel size at maximum zoom. Both magnify linearly with camera zoom and use full-strength capacity to establish their footprint; casualties never shrink surviving actors. Detailed actors switch to icons below 28 nominal pixels unless forced visible.
- **Horse & rider size** scales mounted actors from 0.5 to 3 times the template size, defaulting to the chosen 1.25 times. The horse and rider are baked together, so the whole actor scales around its authored pivot. Mounted slot spacing scales with the same multiplier to make room for the larger horses. Cavalry now uses the same representative actor count as infantry: the default is 12 soldiers for every full formation. Infantry and ranged actors and the physical squad core do not change. Slight overlaps are allowed. Culling includes the larger mounted sprites and their rotated frame bounds.
- Drag the scene to pan; scroll over it or use the slider to zoom. Inspection overlays and the performance panel are hidden by default; **Show inspection overlays and performance** restores collision/artwork bounds, selection graphics, labels, and timings.
- Select a troop type or mix all three. Choose idle, march, or front-rank attacks.
- Choose 5, 12, 24, or 48 representative soldiers per formation.
- **Lose one front soldier** queues one casualty for each formation, including cavalry. **Drain front rank** queues a rank of casualties, processed one at a time. **Play death & fill sequences** continuously queues losses and restores the preview three seconds after all shown formations have died; **Cycle formation transitions** tours normal formations and the charge preview. Deaths choose left, right, or center front actors with per-formation timing variations; replacements walk into the vacancy and subsequent ranks follow. Corpses retain their death pose and fade within 2.6 seconds. The strength slider queues enough losses to reach the selected strength. **Restore** restores soldiers and clears pending losses.
- **Map fit** uses the selected game map and world size with the game's 52-pixel fit padding and optional HUD bottom inset. **Spawn zoom** uses the game's 48-tile starting-camera rule. **Maximum zoom** sets the game's 96 CSS pixels per tile.
- **Stress scene** bypasses distant icon LOD deliberately, using 1,000 formations of 24 actors at 6 CSS pixels per tile (clamped to the map's allowed range). Offscreen formations still emit no soldier instances.
- **Test context recovery** forces WebGL loss, exercises Canvas fallback, and requests restoration after 1.5 seconds.
- **Run fixed comparison** locks controls and camera while comparing WebGL and Canvas using identical visible instance counts. Each renderer receives 600 ms warmup followed by 2.6 seconds of observation, with a rolling maximum of 240 samples. A lost context, hidden tab, or changed visible count invalidates the comparison.

## Game-scale calibration

One grid square is exactly one game tile. The scene uses the real map catalog and dimension calculation for 250/500/1000 worlds. Camera scale is in CSS pixels per tile and clamps between the shared fit scale and 96; wheel zoom uses the game's 1.15 factor and preserves the world point under the cursor. Pixel ratio follows the game and is not capped. The control panel overlays the scene rather than reducing its viewport width, and can be hidden. The optional HUD inset affects fit, starting zoom, and vertical camera centering using the same rules as the game; a shaded reserved area represents the occluding HUD. Zero inset is explicit because this standalone scene has no game HUD.

Formation centers occupy adjacent tile centers, one formation per grid cell. The grid retains the real game tile size; march animation does not displace the formation center. Actual gameplay can place formations differently; these are synthetic inspection placements. The scene uses `squadSpriteSize` at maximum zoom and full-strength capacity to establish a fixed world footprint. `squadSymbol` and `squadViewRadius` remain marker/culling helpers. For reference, the original game calibration behaved as follows: full-strength 1,000-troop squads enter detailed art at 14 pixels per tile, reach the nominal 55-pixel cap at 27.5 pixels per tile, and stay capped at maximum zoom. Fewer troops reduce size using the game's existing formula. The full artwork frame includes the same 4/3 transparent-margin extent, so 55 nominal pixels correspond to a 73.3-pixel frame canvas.

Actor scales are calibrated from the original Formation/formation.json member scale and representative count. Those authored source assets remain unchanged; the prototype uses the new line, shield-wall, square, and charge-only wedge layouts. Higher representative counts pack smaller actors into the fixed world footprint; zoom and casualties do not resize them in world space. Optional blue bounds show the physical core, white shows the artwork frame, and gold shows the cosmetic selection underlay. The physical squad core remains unchanged.

Scene strength is a global synthetic input. There are no per-soldier collision bodies, AI, network records, or gameplay entities. No ranged projectiles are generated. Russian art remains experimental and this is not footage of a running match.

## Local evidence

The following historical comparison was verified in the Codex in-app browser on October 7, 2026, before game-scale calibration. It used the earlier enlarged inspection layout at approximately 731 by 884 CSS pixels and is not a measurement of the current calibrated scene:

| Fixed scene                         |   WebGL2 | Canvas 2D |
| ----------------------------------- | -------: | --------: |
| Visible actor instances             |    9,384 |     9,384 |
| Soldier drawing calls               |        1 |     9,384 |
| Mean CPU preparation and submission |  3.43 ms |  24.46 ms |
| Mean CPU preparation                |  3.34 ms |   3.47 ms |
| Mean frame interval                 | 10.01 ms |  26.06 ms |
| Frame interval p95                  | 10.10 ms |  30.10 ms |
| Samples                             |      240 |       101 |

These are one short local comparison, not GPU execution timings or release/capacity certification. Frame interval depends on browser scheduling and refresh. The stress mode intentionally shows actors much smaller than normal detailed zoom. Formation icon switching, casualties, transparent composition, all three actor types, and forced context-loss fallback/restoration were also inspected in the browser. No browser warnings or errors were observed during the initial scene review.

Focused animation/layout/culling/camera-calibration tests, formation artwork, and existing unit animation checks pass (36 tests total). Repository TypeScript checking passes. Browser review confirms the actual 55-pixel formation at maximum zoom, starting zoom, map-fit icon LOD, map catalog dimension switching, HUD-inset fit, the supported normal formations and charge-only wedge, and cavalry scaling. `InstancedTroops-preview.jpg` shows five actors at game maximum zoom; `InstancedTroops-game-scale-48.jpg` shows 48 actors in that same frame envelope. `InstancedTroops-formations-preview.jpg` shows the compact layered square in one-tile proposal mode. These are synthetic presentation experiments, not approved formation art or live-match footage.

## Next integration gate

Connect the pass to actual squad state behind an experimental switch, then prove camera and authored registration fidelity, strength/capacity mapping, bounded death presentation after squad removal, and transparent ordering relative to buildings, selection overlays, ships, projectiles, and explosions. The existing strategic marker overlay is a useful precedent but cannot simply become an always-on-top soldier layer. Benchmark actual matches at ordinary detailed zoom before selecting final actor counts or replacing the Canvas troop path.
