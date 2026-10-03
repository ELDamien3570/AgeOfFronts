# Down Unda, Old World and Middle East imports

The supplied heightmaps and satellite imagery use the existing map pipeline.
Down Unda and Middle East are added to the central content registry; Old World
retains its ID and replaces its source. Solo selectors, multiplayer validation,
default rooms and lobby cards derive from that registry. No domain/MVVM ownership,
importer algorithm or terrain-renderer changes were needed.

## Sources and assets

| Map / stable ID | Source dimensions | Supplied Regular range | Gameplay dimensions | River features |
| --- | --- | --- | --- | --- |
| Down Unda / `down-unda` | 4096 × 4096 | −450 to 8249 m | 250² / 500² / 1000² | 173 |
| Old World / `old-world` | 4096 × 3072 | −450 to 7188 m | 250 × 188 / 500 × 375 / 1000 × 750 | 109 retained |
| Middle East / `middle-east` | 4096 × 4096 | −450 to 3938 m | 250² / 500² / 1000² | 70 |

Each input folder has an `import.json` pinning original source hashes, supplied
export URL and calibration. All retain sea level 0 m, 600/1800 m terrain thresholds,
16-bit decoding and aspect-preserving area-majority resampling. Albedo imagery
supplies continuous moisture/vegetation/aridity with smoothing 1.4 and green
sensitivity 1.1. OTM imagery is a visual relief reference, excluding labels/roads
from biome fields. Original PNG bytes remain unchanged.

Down Unda's export covers Australia, Southeast Asia, southern China, parts of
India and Papua New Guinea; New Zealand is outside the eastern crop. Bounds:
67.499698–157.499698° E, 45.088823° S–36.598130° N. Middle East spans
25.927665–70.927665° E and 9.622657–47.872309° N. The actual footprint controls
content. [Old World's updated source review](OldWorldMapReview.md) records its extent.

## Hydrology

### Himalayan snow refinement

Old World and Down Unda reference `snow-climate.json` for a regional Himalayan/
Tibetan mountain snowline. The 5700 m core blends smoothly to the original
latitude-based baseline across an ellipse centered at 32° N, 87° E with
10° latitude and 22° longitude radii. Most plateau land now shows grey alpine
rock, while the highest peaks retain snow. This is authored art direction.
Outside the region, existing environment families are unchanged. Terrain,
heights and baked biome arrays remain byte-identical. Six map/size regressions
verify retained snow, reduced coverage and preserved outside-region inputs;
snow-policy, New World climate and map-content checks pass (28 tests total).
Production build, TypeScript and changed-file lint also pass.

The new river layers select named permanent River and Lake Centerline features
from Natural Earth v5.0.0 1:10m base-layer scale ranks 0–8 whose actual line
geometry intersects each footprint. Original coordinates/properties are retained.
Old World's reviewed selection is retained and reprojected. Selection policy,
upstream commit `ace5fed0eaf3c6c03c951e75b439ba8fffbc218e`, dataset hash and
public-domain license are embedded in the GeoJSON. These are major cartographic
networks, not every stream. [Natural Earth](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/)
documents generalization and incomplete intermittent-river coverage.

Rivers use the existing four-connected one-/two-/three-cell gameplay strokes.
They preserve heights, block land movement and clear environment fields on water.
Permanent lakes with referenced nonnegative surfaces use the shared polygon pass:
Down Unda includes Toba, Middle East includes Van, and Old World includes both
plus Victoria, Tanganyika, Malawi and Baikal. Fixed nominal surface references:

- [Toba, ILEC](https://wldb.ilec.or.jp/Display/html/3527): 905 m
- [Van, Kaden et al., Water Resources Research](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2009WR008555): 1649 m
- [Victoria, Global Change Research Data Publishing](https://www.geodoi.ac.cn/weben/doi.aspx?Id=221): 1134 m
- [Tanganyika, FAO](https://www.fao.org/fishery/static/LTR/GEN.HTM): 773 m
- [Malawi, African Great Lakes Information Platform](https://africangreatlakesinform.org/article/lake-malawiniassanyasa): 474 m
- [Baikal, GEF/UNDP lake atlas](https://archive.iwlearn.net/bic.iwlearn.org/bic.iwlearn.org/bic.iwlearn.org/en/atlas/atlas/01-satellite-image-map.html): 455.5 m

Lake geometries come from the pinned [Natural Earth lakes dataset](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/).
Only lake-mask heights are replaced by explicit levels. This does not certify
current levels or a shared vertical datum. Negative lakes and seasonal playas
are excluded from the polygon pass. Caspian/Dead Sea and other negative terrain
retain calibrated sea-threshold behavior; accurate negative inland surfaces
require separate shared renderer work. No fabricated sea-level override is added.

## Verification and limitations

- Runtime checks load all nine variants, verify finite calibrated heights,
  water/land path rules, cleared water vegetation and flat lake surfaces.
- Twenty faction starts and a simulation step pass on all three smallest maps.
- Shared catalog tests cover dimensions, preview links, multiplayer schemas and
  default rooms for all registered maps.
- Independent rebake verifies exact preservation of all heights outside lake
  masks and zero water biome channels. Source hashes match pinned originals.
- Repeated bakes reproduce identical terrain/elevation/environment/manifest hashes.
- All 1024 skirmish tests across 157 files, the 19 Python authoring tests, production build, TypeScript
  check and changed-file Oxlint/ESLint pass.
- Registered coastline overlays and all shared-renderer previews were inspected.
  Live browser checks cover 500-size loading/rendering, with no reported console
  errors; they are not exhaustive navigation, multiplayer or balance playtests.

Before hydrology, 500-size albedo water-hint agreement is 98.68% Down Unda,
98.29% Old World and 95.61% Middle East. This does not certify subpixel alignment
or scientific biomes. Negative dry basins and elevated lakes contribute to Middle
East's disagreement. Visible-color fields remain an artistic land-cover guide.

Toba has zero majority cells at Down Unda size 250 and Old World sizes 250/500.
Other small lakes, islands, outlets and straits can disappear at coarse sizes.
River widths are exaggerated; not every river is guaranteed to reach the sea.
No invented connecting courses are drawn. Final art/gameplay acceptance remains
a user review.

## Reproduce

```sh
python scripts/importSkirmishHeightmap.py "HeightMaps/Down Unda/import.json"
python scripts/importSkirmishHeightmap.py "HeightMaps/Old World/import.json"
python scripts/importSkirmishHeightmap.py "HeightMaps/Middle East/import.json"
node scripts/generateLobbyMapPreview.mjs down-unda
node scripts/generateLobbyMapPreview.mjs old-world
node scripts/generateLobbyMapPreview.mjs middle-east
python -m unittest discover -s tests -p '*_test.py'
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=2
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
```

Local routes: `/skirmish/index.html?map=down-unda`, `?map=old-world` and
`?map=middle-east`. Assets live under `resources/maps/<id>`. The original import
review was local; the subsequent workspace integration is recorded below.

## Workspace integration, 3 October 2026

Down Unda, Middle East and the replacement Old World are integrated with the
current multiplayer, AI, transport and crowd-recovery implementation. Their
existing shared content registry supplies solo selection, lobby cards, default
rooms and multiplayer validation. No alternate map loader or domain authority
was introduced.

New regressions verify identical solo and multiplayer world identities at all
nine map/size combinations, including terrain, elevation, generated forests and
biome-derived resource inputs. The online smoke harness now accepts validated
`--map` and `--size` options so the same checks can exercise each registered map.

The combined workspace passed:

- 1,159 skirmish tests across 173 files in one full suite.
- 19 Python map-authoring tests, TypeScript and the production build.
- TypeScript test ESLint; smoke harness syntax and changed-file Oxlint checks.
- Exact source/build byte comparisons for all 33 regional map assets.
- Git LFS object verification for the workspace and current main revisions.
- Three independent authenticated local online matches at size 500, one per map,
  with two human clients, 10 regular AIs and 25 tribes. Both human players and all
  10 regular AIs physically moved on every map; construction, command rejection,
  reconnect and 13 common canonical-state samples passed in each match. All five
  AI policy defaults were enabled.

Evidence is retained locally under `out/maps-merge-20261003/`, including the
suite/build logs, packaged-map comparison and per-map smoke results. Repository
ESLint's TypeScript project service does not include the existing `.mjs` smoke
harness; its executed smoke tests, syntax check and Oxlint check passed.

These checks used a dedicated local production server. They do not establish
long-match performance, native browser qualification or a new Oracle deployment.
