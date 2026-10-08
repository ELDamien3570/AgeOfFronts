# Troop level insignias

Standalone transparent overlays for the formation icons. Draw them centered
beneath the marker, preserving their own colors independently of faction tint.
The original formation PNGs and SVGs have not been modified.

| Level | Stars | Arrangement | Fill | Outline |
| --- | --- | --- | --- | --- |
| 1 | 1 | Row | Green | Black |
| 2 | 2 | Row | Green | Black |
| 3 | 3 | Row | Green | Black |
| 4 | 4 | Row | Green | Black |
| 5 | 5 | Row | Green | Black |
| 6 | 5 | Ring | Gold | Black |
| 7 (maximum) | 5 | Ring | Purple | Gold |

The ring is an arrangement of five upright, five-pointed stars around an empty
center, following the five-star example in the supplied rank reference. There
is no extra circular band. Artwork uses flat colors and bold outlines.

`svg/` contains editable masters; `png/` contains matching RGBA sprites.
Green rows use 512 x 128 canvases with fixed star size and spacing. Gold and
purple rings use 256 x 256 canvases. All backgrounds are transparent, and
`asset-manifest.json` records the exact mapping, colors, dimensions, anchors
and validation results.

Suggested overlay sizing: match green-row width to the formation marker width;
use 16 x 16 pixels for the gold/purple rings and leave a 2-pixel gap below the
marker. At 24 to 32 pixels, the rank color and star count read more clearly than
the fine star points. The rings benefit from the extra height. Keeping rank
badges as separate screen overlays allows them to keep a readable size.

`overview.png` shows large placement examples. `small-size-review.png` shows
actual 24- and 32-pixel-wide formation markers, including both ships. These are
raster composition previews, not verification in the game's renderer.

Rebuild with `node build-insignias.cjs`, optionally passing the absolute path to
the Sharp package as its first argument. No application or game code is changed.
