# Trade-route road tiles

Six age-specific painted road sets replace one square terrain cell each. Every
tile includes opaque grassy ground, as requested. All sets use north, east,
south and west connections. Each age has 16 patterns: one isolated patch, four
ends, two straights, four rounded bends, four T-junctions and one crossing.

| Age | Road surface |
| --- | --- |
| Bronze Age | Packed dirt wagon track |
| Classical Age | Compacted sandy gravel |
| Early Medieval | Rough fieldstone paving |
| Late Medieval | Cobblestones |
| Early Modern | Regular dressed stone paving |
| Modern | Asphalt with white edge lines and paired yellow center lines |

These are visual progression choices for the game, not a universal historical
claim about road construction. All share a muted olive grass surface derived
from the current terrain palette. Full ground tiles are authored for that ground
style; they would need ground variants to blend into desert or snow.

Open `Road_Tile_Preview.html` through the existing Art preview server. It shows
assembled routes or all tile pieces, filters by age and lets you change cell size
and reveal cell boundaries. The default overview compares all six surfaces.

## Files and tile selection

Each age folder includes:

- `tiles/`: sixteen individual 256 × 256 opaque RGBA PNGs.
- `Road_Atlas.png`: a 4 × 4 atlas, 1024 × 1024, in mask order.
- `Road_Atlas_Padded.png`: a 1040 × 1040 atlas with two-pixel edge extrusion.
- `tiles.json`: stable mask IDs, source rectangles, connections and source hash.
- `Route_Example.png`: an assembled route preview.

`Ground.png` is the shared ground-only tile. The root manifest lists all six sets.
Each tile covers exactly one world cell; its pixel resolution does not change
its world footprint. Roads occupy about 52% of cell width plus a narrow shoulder.

Connection bits are **N = 1, E = 2, S = 4, W = 8**. Add the bits of the road's
actual cardinal connections and select that mask. For example, N+S is mask 5,
N+E is mask 3, and all four directions is mask 15. Mask 0 is an isolated road
patch; use `Ground.png` for cells with no road. Both sides of a shared connection
must agree. Pixel edges match exactly for every compatible pair within an age.

Use the authored entries without runtime rotation: all tiles sample the same
material orientation. For bilinear atlas sampling use the padded atlas and its
`paddedRect` entries, with filtering clamped to the sprite rectangle. Extrusion
protects the base level; mipmapped atlases require suitable mip-safe padding.

The current land pathfinder permits diagonal steps. These assets intentionally
use cardinal connections, following the user's choice. A future trade-route
renderer must use an explicit cardinal road graph, rather than directly mapping
diagonal movement steps to this mask. Actual road connections should come from
route data; neighboring occupied road cells need not always imply a connection.
The preview's example uses an explicitly connected cardinal grid.

## Source artwork and rebuild

The built-in imagegen tool produced seven material paintings: one shared ground
and six road surfaces. Exact prompts and generation provenance are in
`generation-prompts.json`. Unedited originals remain in `generated/`.
The user authorized assembling the finished tiles directly from shared materials.

`build-road-tiles.py` normalizes the grass palette, pairs material edges, constructs
fixed road shapes and shoulders, adds modern road markings and writes all tiles
and atlases. `materials/` contains the derived periodic material images. The
shared connector profiles keep bends, junctions and ends aligned at cell borders.

With Python, Pillow and NumPy installed:

```powershell
python build-road-tiles.py
python validate-road-tiles.py
```

Validation checks all 96 delivered tiles, mask coverage and exits, opacity,
source hashes, exact atlas crops, padded atlas extrusion, and every compatible
edge pair. `Road_Tile_Validation.json` records the results. The validator also
creates a 24/32/64/128 px review. `road-progression-review.png` compares assembled
routes across all ages.

This delivery is an art library and preview. No game renderer, terrain data,
route rules, movement costs, trade income or pathfinding code was changed.
