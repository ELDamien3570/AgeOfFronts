# AoE2-Style Terrain & Water Rework

Goal: make the map read like a painted, AoE2-style landscape — turquoise
shallows, layered beaches with animated foam, organic coastlines, and
textured land with soft biome transitions — at near-zero performance cost.
Not photorealism.

## Constraints

- **Client rendering only.** Nothing in `src/core` changes. Terrain bytes,
  `magnitude`, and the simulation stay exactly as they are.
- **Performance budget:** the terrain pass today does 1 texture fetch per
  pixel. The reworked pass may do at most ~6 fetches from small/cache-friendly
  textures plus ALU. No new render passes, no new framebuffers, no extra frames
  (the render loop already redraws every rAF).
- **No new image assets.** Noise textures are generated procedurally at init.
- **Everything is toggleable.** A `terrain.stylized` master switch restores the
  current flat look exactly; `terrain.waterAnimation` disables time-based
  motion (battery / low-end devices).
- **Water nukes must keep working.** All new per-tile data flows through the
  existing `applyTerrainRects` path.

## Architecture

### Data: a second terrain texture ("terrain fields")

Keep the existing RGBA8 colour texture (NEAREST, pixel-crisp) as the base
colour source. Add one **RG8 "fields" texture**, map-sized, **LINEAR**
filtered, built on the CPU:

| Channel | Meaning | Encoding |
|---|---|---|
| R | Signed distance to coastline, in tiles | `clamp(d, -8, 8)` mapped to 0..255 (128 ≈ coast). Negative = land, positive = water. |
| G | Elevation | Land: `magnitude / 30`. Water: 0. Impassable: 1. |

Linear filtering turns both into smooth sub-tile fields: R's zero-isoline is a
rounded coastline, G gives smooth biome blending and hillshade.

Memory: +2 bytes/tile (≈16 MB on the largest map). Acceptable.

**Coast SDF bake** (`src/client/render/gl/utils/TerrainFields.ts`): two-pass
chamfer distance transform (3×3, weights 1 / √2) computed separately from land
and from water, combined into a signed value, clamped to ±8. O(n).
Distance is measured from tile *edges* (a land tile adjacent to water sits at
−0.5, the water tile at +0.5) so the zero-isoline lands between tiles.
Impassable land counts as land for the SDF.

**Incremental update:** on `applyTerrainRects`, recompute the fields for each
rect expanded by 9 tiles (clamped to map bounds), reading terrain bytes from
the existing `terrainSource` provider, and `texSubImage2D` that region.

### Shared GLSL: `shaders/terrain/coast.glsl`

One snippet, injected into both the terrain and territory shaders (simple
string concatenation at program creation — add a tiny `#include`-style helper
or prepend the source), defining:

```glsl
float coastDistance(vec2 worldTile); // SDF sample + noise wobble, in tiles
```

Both passes MUST use the identical function so territory clipping matches the
drawn coastline exactly.

### Noise texture

`createNoiseTexture(gl)`: 256×256 RGBA8, REPEAT, LINEAR_MIPMAP_LINEAR,
mipmapped. Four independent tileable value-noise octaves (one per channel)
generated with a seeded PRNG at init. Used for: coast wobble, water ripples,
large-scale colour patches, land grain, dirt patches.

### Uniforms added to the terrain pass

`uFields`, `uNoise`, `uTime` (seconds from `performance.now()`, wrapped with
`mod(t, 1000.0)` — never `frameTick`, which advances per game tick), `uZoom`
(screen px per tile, from `Camera.zoom`), `uMapSize`, `uStylized`,
`uAnimate`, plus the colours/strengths below.

## Visual layers (terrain fragment shader)

Order of evaluation per pixel, with `d = coastDistance(w)`:

1. **Base colour** from the NEAREST colour texture (unchanged for impassable).
2. **Land (d < 0):**
   - **Smooth biome blend:** replace the hard plains/highland/mountain steps
     with a colour ramp driven by the LINEAR elevation G channel, so biome
     edges are soft.
   - **Hillshade:** sample G at ±0.75 tile offsets, compute a gradient, light
     from the upper-left. Subtle (≤ ±12% brightness). This gives AoE2-ish
     relief for mountains and highlands.
   - **Macro variation:** low-frequency noise (period ~40 tiles) shifting
     hue/brightness slightly, so big plains aren't flat.
   - **Dirt patches:** noise thresholded with a soft edge in plains, blending
     toward a dry-earth colour (AoE2's brown grass patches).
   - **Micro grain:** high-frequency noise ±4%, faded out by zoom.
3. **Beach bands (−1.6 < d < 0):** dry sand → darker wet sand at the water's
   edge. This replaces the 1-tile sand shoreline.
4. **Water (d ≥ 0):**
   - **Turquoise→deep ramp** over d ∈ [0, 6] (beyond 6 tiles, also darken
     slightly using the existing magnitude-based colour so open ocean still
     shows depth).
   - **Foam line** at d ∈ [0, 0.3], broken up by noise, plus wave bands
     rolling toward the shore: `fract(uTime * 0.25 - d * 0.6)`.
   - **Ripples:** two noise samples scrolling in different directions,
     ±7% brightness.
   - **Large-scale patches:** very low-frequency noise ±10% (not zoom-gated).
5. **Zoom fade:** all sub-tile detail (foam waves, ripples, grain) is
   multiplied by `smoothstep(zoomFadeStart, zoomFadeEnd, uZoom)` to prevent
   shimmer when tiles are only a few pixels on screen. Colour ramps, beaches
   and macro variation stay visible at every zoom.
6. Output alpha is always `1.0`.

## Territory interaction

- **Fill clipping:** `territory.frag.glsl` samples the same `coastDistance`
  and `discard`s where `d > 0`, so the tint follows the smooth coastline
  instead of square tiles poking into the sea.
- **Coastal borders (decision):** the border compute currently treats water
  (owner 0) as a foreign neighbour, so every owned coast gets a solid,
  stepped border stroke that would hide the new beaches. New setting
  `terrain.coastalBorders` (default **false**): when false, water neighbours
  do not make a tile a border. Borders between players, and between owned and
  unowned land, are unchanged. Setting it true restores current behaviour.
  This is a readability change and needs a playtest.
- Border stamp pixels on coastal tiles (when coastalBorders is true) are also
  clipped with `d > 0` → discard.

## Settings

New keys under `terrain` in `render-settings.json` (+ `RenderSettings`
interface, `GraphicsOverrides`, and the debug EffectEditor for live tuning):

`stylized` (bool, true), `waterAnimation` (bool, true), `coastalBorders`
(bool, false), `shallowColor`, `deepColor`, `foamColor`, `wetSandColor`,
`dirtColor` (hex), `rippleStrength`, `foamStrength`, `hillshadeStrength`,
`grainStrength`, `macroVariation`, `zoomFadeStart`, `zoomFadeEnd` (numbers).

Defaults tuned toward the AoE2 reference: deep `#2f9fd0`, shallow `#5cc8e0`,
oceanColor updated to match. Existing presets that override `oceanColor`
continue to work (oceanColor becomes the deep colour).

Player-facing toggles in `GraphicsAdvancedSettings`: "Stylized terrain",
"Animated water", "Coastline borders" — all via `translateText()` with keys
added to `resources/lang/en.json` only.

## Consumers to keep working

- `Renderer.ts` (main game) and `render/preview/CosmeticPreviewRenderer.ts`
  both construct `TerrainPass` — both must supply the new inputs.
- `setTerrainColors` full re-bake must also rebuild the fields texture.
- `stylized = false` must render pixel-identical to the current output.

## Phases

1. **Colour ramp (CPU only):** new shallow/deep ramp in `encodeTerrainTile`.
2. **Fields texture + SDF bake + incremental update**, with unit tests.
3. **Noise texture + terrain shader water layers** (ramp, foam, ripples).
4. **Beaches + coast wobble** via shared `coast.glsl`.
5. **Land layers** (biome blend, hillshade, macro, dirt, grain).
6. **Territory fill clipping + coastal border setting.**
7. **Settings plumbing, UI toggles, i18n, EffectEditor entries.**

## Tests

- `TerrainFields` bake: sign correctness, ±0.5 at coast edges, clamping,
  diagonal distances ≈ √2, impassable treated as land, incremental rect
  recompute equals a full rebake.
- Noise generator: tileable (edge texels wrap), deterministic for a seed.
- Existing test suite, lint, and typecheck pass.

## Known limitations

- Sub-tile shores are only visible when zoomed in; zoomed out the look is
  carried by colour ramps, beaches and macro variation.
- Territory and inter-player borders remain tile-crisp. Smoothing those is a
  separate, larger follow-up.
