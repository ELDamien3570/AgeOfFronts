# Skirmish Terrain & Water Rendering

Goal: make the skirmish map read like a painted, AoE2-style landscape (soft
turquoise shallows, animated water, foam, narrow beaches, rounded coastlines)
without changing the existing look of the land: biome colours, forest
darkening, noise shade, relief, tree and decoration placement, and territory
shading all stay as they were.

This describes the skirmish product (`npm run play`, `npm run build:skirmish`,
code in `src/skirmish/`). The inherited OpenFront renderer under `src/client/`
is not used by it and is untouched.

## What exists

| File                                    | Role                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/skirmish/client/GroundLayer.ts`    | WebGL2 canvas behind `#battlefield`: textures, shader, camera uniforms, context loss handling                  |
| `src/skirmish/client/TerrainFields.ts`  | CPU bake of the fields texture: coast SDF, smoothed hillshade, water depth                                     |
| `src/skirmish/client/GroundBake.ts`     | CPU bake of the per-tile base colour texture and incremental forest re-bake                                    |
| `src/skirmish/client/NoiseGen.ts`       | Tileable procedural noise (RGBA8) generated at init, no image assets                                           |
| `src/skirmish/client/PaintedTerrain.ts` | Canvas2D chunks. `paintedRgb` is the one colour function; `setDecorationsOnly` switches chunks to accents only |
| `src/skirmish/client/Renderer.ts`       | Owns the layer, draws it inside `draw()` with the same camera and frame throttle                               |
| `src/skirmish/client/main.ts`           | "Ground style" select in the top bar (stored in `localStorage` as `skirmish.groundStyle`)                      |

Tests: `tests/skirmish/TerrainFields.test.ts`, `GroundBake.test.ts`,
`NoiseGen.test.ts`, and a decorations-only case in `PaintedTerrain.test.ts`
(run by `npm run test:skirmish`).

Nothing in `src/core` or the simulation changes. `TerritoryLayer` is untouched.

## Layering

```
.battlefield (background #102331)
  canvas.ground-layer      WebGL2, z-index 0, clears to #102331, one quad
  canvas#battlefield       Canvas2D, transparent when the GL ground is active:
                           decoration accents, roads, territory, buildings, units
  canvas.strategic-sprites WebGL2 overlay (existing)
```

`Renderer.draw()` calls `groundLayer.draw(scale, offsetX, offsetY, now)` right
where it used to draw the painted chunks, so the ground is always in step with
the 2D canvas and inherits the existing 30/60 fps throttle. Sizing and DPR
handling mirror `StrategicSprites`.

## Data

All textures are map-sized and built on the CPU once per map. Nothing derives
from the quantized 0 to 31 terrain-byte magnitude.

**Colour texture, RGBA8, LINEAR.** Baked from `paintedRgb`, the function the
Canvas2D chunks use, so land texels are exactly today's colours (a unit test
compares the bake with `paintedCell`). Water is drawn procedurally, so water
texels that touch land hold the average of their land neighbours; this keeps
blue from bleeding onto land when the shader samples near the smoothed
coastline.

**Fields texture, RGBA8, LINEAR.**

| Channel | Meaning                                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R       | Signed coast distance in tiles, clamped to +-8, from a two-pass 3x3 chamfer transform (weights 1 and sqrt 2) run from land and from water. Measured from tile edges: a coast land tile is -0.5, the water tile across +0.5, so the zero isoline lies between tiles. Impassable land counts as land. |
| G       | Hillshade, 128 = flat. Computed from continuous elevation, clamped to at least sea level so inland river beds retain their calibrated heights, after a separable box blur (radius 2, two passes). Light from the upper left, same scale and clamp as `terrainRelief`. 128 everywhere on maps without elevation. |
| B       | Water depth, `sqrt(clamp((seaLevel - height) / 400 m))`, blurred. 0 on land and on maps without elevation (the shader then uses coast distance only).                                                                                                                                               |
| A       | 255                                                                                                                                                                                                                                                                                                 |

**Noise texture, RGBA8, REPEAT, mipmapped.** 256x256, four independent
two-octave value-noise channels whose lattice wraps (R wobble, G ripples, B
broad tint, A grain). Deterministic for a seed.

**Forest updates.** The only runtime terrain change is forest cover when
buildings are placed. `PaintedTerrain.updateBuildings` returns the changed
tiles; `rebakeGroundColors` re-bakes those texels plus a one-tile ring and
`texSubImage2D` uploads one small rect per 16-tile block, so scattered edits
never upload a large bounding box. The CPU copy of the colour array is kept for
context restore.

## Shader layers

One fragment shader, no extra passes or framebuffers. Per pixel: fields (1
fetch), colour (1, land only), noise (1 for wobble/ripples/grain/tint, plus a
second ripple layer and a very low frequency ocean tint on water, 3 at most on
water). That is within the budget of about six fetches. Time comes from
`performance.now()` wrapped at 1000 s, never from game ticks, and is frozen
when "Still sea" is selected.

1. **Coast.** `sd` from the fields texture plus a wobble of at most +-0.35 tile
   (faded in from about 1 to 3 px per tile). Land/water is anti-aliased over
   about one screen pixel, so the coast is crisp at every zoom.
2. **Land colour.** Linear sampling softened to about one pixel: tile edges
   stay crisp when zoomed in (today's look) and blend smoothly when tiles are
   only a few pixels wide. Then a small hillshade term, +-2.5% broad tint, and
   +-4% grain faded by zoom.
3. **Beach.** Narrow and soft: 22% dry sand blended over 0.8 tile, plus a thin
   darker wet strip in the last 0.18 tile. It is a tint on the existing colours,
   not a gated band, so it cannot read as a contour.
4. **Water ramp.** Shore, mid (the existing shallow colour) and deep (the
   existing ocean colour). Driven by coast distance over about 5.5 tiles, mixed
   60/40 with the depth channel where elevation exists.
5. **Ripples.** Two scrolling samples of the G channel, rotated against each
   other, with lattice cells of about 0.3 to 0.4 tile (features of roughly 0.6
   to 0.8 tile; the texture repeats every 9 to 12 tiles). Amplitude is about
   +-4% and fades out below about 2.5 to 7 px per tile. Larger swirls would
   read as clouds, so the only large-scale variation is a smooth +-2.5% tint.
6. **Foam and waves.** A broken foam line in the first 0.4 tile of water and
   faint wave bands that roll toward the shore over the first 3.6 tiles. The
   bands appear only when zoomed in.

## Settings and fallbacks

- Top bar select: **Animated sea** (default), **Still sea** (no time-based
  motion), **Classic** (the original Canvas2D painted ground).
  Stored per browser in `localStorage`; unavailable storage is ignored.
- No WebGL2, shader compile/link failure, or context loss: `GroundLayer.ready`
  is false, the Canvas2D chunks paint the full ground again (including water
  strokes) and fill `#102331` themselves. The path is the original one and was
  checked in a browser started with 3D APIs disabled. On context restore the
  textures are re-uploaded from the CPU copies, including a replacement map
  selected while the context was lost.

## Chunk cost

With the GL ground active, `PaintedTerrain` chunks hold only the decoration
accents on transparent canvases, at detail greater than 1 (detail 1 chunks are
skipped). There is no per-tile `fillRect`, no per-tile `paintedCell`, and no
water squiggle strokes; accent placement, sort order and alpha are unchanged.
Measured in headless Chromium with software GL on the heightmap map at 1600x950
(chunks built while zooming, total build time): about 30 ms per chunk drops to
about 6.6 ms at mid zoom (19 chunks, 574 ms to 126 ms) and from about 15.7 ms to
5.9 ms per chunk when zoomed in (9 chunks, 141 ms to 59 ms); the fit view builds
no chunks at all instead of 32 (322 ms). The one-off GL bake adds about 35 ms
at map load on 500x250. These are software-GL numbers and indicative only.

## Known limitations

- **Territory vs coast.** Territory tint and borders stay tile-crisp (they are
  Canvas2D and deliberately unchanged). The drawn coast is the smoothed
  isoline of the SDF plus up to 0.35 tile of wobble, so against a stepped tile
  border it differs by up to about half a tile at corners: owned coastal tiles
  show tint over a sliver of sea, and the water side of some corners shows
  between the border and the sand.
- Land stays tile-textured when zoomed in (per-tile noise shade is part of the
  look); only the edges are anti-aliased.
- The hillshade term is deliberately small because `terrainRelief` is already
  part of the baked colour.
- Maps without elevation (the OpenFront world maps) have no hillshade term and
  take the shallow-to-deep ramp from coast distance alone (about 5.5 tiles).
- The animation time wraps every 1000 s, which can cause one small jump in the
  ripple drift.
- The whole map texture is resident: about 2 x 4 bytes per tile (4 MB each for
  500x250; 8 MB each at 1000x500 plus the CPU copy).
- Forest re-bake in the live game was verified through unit tests of the bake
  and rect output, not by watching a building clear trees in a browser.
