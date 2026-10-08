# Formation icons

Seven transparent formation markers: melee, ranged, cavalry, ranged cavalry,
siege catapult, warship, and transport ship. There are no health bars.

`png/` contains 512 x 512 RGBA sprites. `svg/` contains the editable vector
masters. Every canvas uses the same center pivot `(256, 256)` and points upward.
The siege marker is circular. Land formations use wide rectangular markers.
Both ships use tall, narrow rectangular markers with overhead hull silhouettes
and their bows pointing upward. The warship has three bold pairs of oars;
the transport has a broader hull with two large cargo crates on its deck.

Unit symbols and facing triangles are black, on solid white marker fields.
The gray sections and diagonal separators have been removed. The symbols are
larger, their strokes are heavier, and the ships have fewer interior details
to help them remain recognizable at marker widths of 24 to 32 pixels.
Multiplying the sprite's RGB by a faction color recolors white while preserving black symbols.
Preserve the sprite's original alpha during tinting. To recolor the black
symbols themselves, edit the `unit-symbol` group in the SVG or use a separate
symbol mask; multiplying black RGB by a color will leave it black.

The imagegen tool generated the design previews. The final SVG artwork was
authored as simple geometric shapes and rasterized with Sharp to obtain clean
contours and exact grayscale pixels. No application code or rendering behavior
was changed. `generation-prompts.json` records the design and recoloring prompts.

`overview.png` is a labeled review sheet; it is not a game sprite.
`small-size-review.png` shows the markers at actual widths of 24, 32, and 48
pixels. If a previous PNG folder was supplied to the builder, it also includes
before/after comparisons. This is a raster artwork check, not an in-game test.
`asset-manifest.json` records dimensions and alpha/grayscale validation.
To rebuild the assets, run `node build-icons.cjs`, supplying an absolute path to
the Sharp package as its first argument when Sharp is not installed locally.
An optional second argument points to a previous version's PNG folder for the
small-size comparison sheet.
