# Cardinal wall kit

Transparent wall and tower art that follows the road kit's four-direction connection pattern.

| Unlock age | Wall tier | Matching tower |
|---|---|---|
| Stone Age | Timber palisades | Timber watch platform |
| Bronze Age | Stone walls | Round stone tower |
| Classical Age | Massive stone walls | Square stone bastion |

The kit contains **48 wall pieces and 3 separate towers**. Each tier has 16 connection patterns, including isolated, ends, straights, corners, T junctions and a cross. Production sprites are 256 × 256 RGBA with transparent terrain around them. The ground in the preview and review images is for presentation only.

## Connections and towers

Use the same bits as the roads: **N = 1, E = 2, S = 4, W = 8**. Add the bits for the desired connections. North is the top of the image. Mask 5 is a north/south span; 10 is east/west; 3 is a northeast corner. Mask 0 is an isolated post or stone pier. For an empty cell, draw no wall sprite.

Every wall and tower uses a one-cell footprint and the same center pivot, **(128, 128)** in source pixels. Wall spans run from the cell center to the centers of connected cell edges. Choose connections from the wall graph; the PNGs do not define gameplay adjacency.

Draw the wall first, then the tower at exactly the same cell position and scale. Tower slots are available at **all four bends: masks 3, 6, 9 and 12**. Towers can also cover junctions 7, 11, 13, 14 and 15. Towers remain independent assets so their placement or upgrade does not require replacing the underlying wall piece. The wall remains continuous when the tower is hidden.

Tiers become thicker and their towers grow larger. Their connector centers and world footprint stay the same. Adjacent pieces of the **same tier** share exact RGBA edge pixels. Cross-tier wall transitions require an explicit transition asset and are not included.

## Export files

Each tier directory contains:

- `tiles/`: 16 individual transparent PNGs, named by mask.
- `Wall_Atlas.png`: a 1024 × 1024 atlas in mask order, four columns by four rows.
- `Wall_Atlas_Padded.png`: a 1040 × 1040 atlas with two pixels of edge extrusion per sprite. Use `paddedRect` from the metadata, excluding the extrusion.
- `Tower.png`: the independent centered tower sprite.
- `tiles.json`: connections, atlas rectangles, pivots, tower slots, unlock-age labels and source hashes.
- `Corner_Fit_Review.png` and `Enclosure_Review.png`: visual review images, not additional production pieces.

`Wall_Kit_Manifest.json` is the catalog entry point. Atlas padding protects base-level filtering; mipmapped imports still need an appropriate sprite importer or sampling policy.

## Preview and editable sources

Open `Wall_Kit_Preview.html` through the project's local art server. Its overview shows enclosures for all three ages. Inspect all 16 pieces or the four tower joins, toggle towers, change cell size, and compare grass, sand, snow, checkerboard or dark backgrounds.

The six immutable paintings in `generated/` were made with the **built-in image_gen tool**. `generation-prompts.json` records the exact prompts and reference paths. `materials/` holds the prepared shared wall materials and the timber post. `kit-authoring.json` controls tier widths, battlement sizes and tower footprints. `build-wall-kit.py` assembles the repeatable wall pieces and atlases from those shared paintings.

Rebuild and validate with Python, Pillow and NumPy:

```powershell
python build-wall-kit.py
python validate-wall-kit.py
```

`Wall_Kit_Validation.json` reports transparency, all 1,536 compatible same-tier edge pairings, atlas/extrusion agreement, 12 tower corner fits and retained source hashes. `wall-small-size-review.png` shows the art at 24, 32, 64 and 128 pixels per cell.

This delivery is an **art kit and review page**. Unlock ages are catalog metadata. Game rendering, construction rules, movement blocking, collision, combat and actual unlock logic have not been implemented or verified.
