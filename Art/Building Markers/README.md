# Building markers

One distinct symbol for each of the **21 current BuildingType values**, shared across all ages. These replace the distant letter markers in the game. SVG masters and 512 × 512 PNGs use black symbols and borders on white square fields. Multiplying all RGB channels by a faction color recolors the field and counterspaces while retaining black shapes.

The current map marker remains **18 × 18 CSS pixels**. `small-size-review.png` compares the old letters and new icons at 18 px and shows the same geometry at 24 and 32 px. `overview.png` labels every building. Those are review images, not sprite atlases.

## Runtime integration

`src/skirmish/client/BuildingMarkers.ts` owns the marker resources in the view layer. `Renderer.drawBuilding` uses them at the existing artwork distance threshold. The manifest is keyed exhaustively by `BuildingType`; TypeScript catches missing mappings when new building types are introduced.

`Building_Markers_Atlas.png` contains 7 × 3 cells of 128 px each (896 × 384 total). `building-markers.json` records the rectangles. Each faction tint is cached as a complete small atlas at the requested display size and device pixel ratio. The cache is bounded to 128 atlases. The normal 18 px / DPR 2 atlas consumes about 106 KiB of pixel storage; 128 entries consume about 13.3 MiB. Marker resources do not own placement, gameplay, age progression or hit testing.

The asset supplies its black border. Selection and construction outlines are drawn by the renderer over the marker. Construction and placement previews apply their existing opacity. While the atlas loads, the renderer shows the existing square pad without a letter.

## Editable sources and rebuild

- `svg/`: 21 editable vector masters; `building-symbol` contains the symbol.
- `png/`: the matching 512 px raster masters.
- `build-markers.cjs`: native vector geometry, atlas assembly and review generation.
- `Asset_Validation.json`: catalog coverage, grayscale/opacity checks and small-raster comparisons. Similarity metrics help find pairs to inspect; they do not prove recognition.

```powershell
node build-markers.cjs "C:/path/to/sharp"
```

These are native SVG designs extending the project's black-on-white marker style; image generation was not used. All sizes use the same geometry, and there are no age variants.

Run the game's Vite server and open `/Art/Building%20Markers/Building_Marker_Preview.html` to inspect all icons through the actual `BuildingMarkers` rendering resource. Change faction color, marker size or ground and filter by building name.

## Verification

The production Vite bundle and six existing marker/tint tests pass. All 21 icons were checked in the browser preview; the live game was inspected at distant zoom. `Integration_Verification.json` records those checks and both saved screenshots.

The default whole-project TypeScript check currently reports four existing `Array.at` library errors in `tests/skirmish/AllianceFeed.test.ts` at lines 80, 91, 97 and 111. Type checking passes when run with `--lib ES2022,DOM`. No compiler configuration or unrelated test source was changed.
