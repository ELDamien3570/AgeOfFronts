# New World map review

New World is implemented as a local review candidate with stable identity and
asset root `new-world`. It uses the supplied calibrated heightmap and real
satellite albedo, the existing shared terrain/environment/forest systems, and
an explicitly curated major-river layer, registered Great Lakes water surfaces,
and a map-scoped snow policy. The shared importer now supports opt-in lake
polygons; other maps retain their existing behavior.

## Source, registration and terrain

- Height source: `HeightMaps/New World/14_606_-99_846_6_6144_8192_16bit.png`
- True 16-bit grayscale PNG, 6144 × 8192, unchanged source bytes
- Height source SHA-256: `430d528c37c5b36c772532a7cf4a701249ddc4113ae9222818f6cc285370f2f3`
- Supplied calibration: −450 to 6501 metres, Regular normalization range 65536
- Sea level 0 m; shared highland threshold 600 m, mountain threshold 1800 m
- Web Mercator footprint: 167.346018° W to 32.346018° W,
  59.888259° S to 71.746855° N
- Sizes: 188 × 250, 375 × 500 and 750 × 1000, preserving the portrait 3:4 footprint

The complete supplied export URL is retained in `HeightMaps/New World/import.json`.
The export includes the Americas, including eastern Brazil, plus the southern
portion of Greenland. It excludes the far northern Arctic.

The matching imagery albedo is 6144 × 8192, SHA-256
`bf644c41d10ff13047d2d697d4c14e864076ffe357694b814056e35024b33017`.
Both albedo source images were already present on the branch and were hydrated
from Git LFS. Visual inspection checked coastlines across Alaska, Greenland,
Central America, the Caribbean and South America, rather than relying solely on
filenames. Before river carving, the 500-size visible-color water hint agrees
with the calibrated sea mask on 98.7072% of cells, with 98.1803% water IoU.
These are diagnostics, not subpixel registration certification or lake mapping.

The OTM image is only a mountain/topography review reference. Its terrain colors,
labels and roads are not classified into vegetation. Calibrated source heights
remain authoritative for the Rockies, Andes and all terrain movement tiers.

## Biomes and vegetation

Real satellite imagery is processed through the unchanged continuous
moisture/vegetation/aridity classifier, with land-weighted smoothing 1.4 at size
500 and green sensitivity 1.1, matching Amazon River's current settings.
The shared environment, forest generator and terrain-art selection consume
these fields. The preview uses those same shared systems and relief module.

Visual review and regression checks distinguish the humid Amazon and eastern
North American woodland from the dry Atacama/western interiors. Height and
latitude still affect mountains and cold regions. Visible-color evidence is an
artistic approximation of vegetation and moisture, not measured rainfall or
scientific land cover; seasons, shadows, cropland and exposed soil can mislead it.
No synthetic satellite image or fallback climate regions were created.

The authored `climate.json` snow policy follows visual-review feedback: Arctic
snow belongs in the far north with exposed grey rock retained, southwestern
North America keeps ordinary grey mountains, and the Andes are predominantly
grey with snow only at their highest elevations. A three-degree, geographically
varied, elevation-shaped transition around 65° N avoids a straight snow border.
Outside the far north, the snowline is max(4000 m, 5000 − 20 × absolute latitude);
northern slopes retain exposed rock when local land relief exceeds 220 m at
500-size equivalent scale. This is art direction, not
measured permanent/seasonal ice coverage. The global default classifier and
other maps are unchanged.

## River pass

The source contains 111 unchanged public-domain Natural Earth 1:10m features:
81 river pieces and 30 lake-centerline pieces, with 74 original names across
27 curated systems. Source Git blob, upstream SHA-256, selection IDs, aliases,
coverage, provenance and license are embedded in `rivers.geojson` and copied
into the manifest. Ambiguous same-name rivers were selected by source IDs.

The final curated LF-byte SHA-256 is
`a9b575054f794164ec747d029995ce4fa5bb679bfd5395a2c1c20f20ebade2a5`.
All original feature properties, coordinates and bounding boxes are preserved.
The exact Cojedes source feature provides the downstream Apure continuation
into the Orinoco; no invented connecting course was drawn.

Channels use the existing explicit one-/two-/three-cell strokes at the three
sizes, with wider bends and overlapping junctions. These are deliberately
exaggerated continental gameplay widths. They are four-connected navigable
water, prevent land walking, clear vegetation and preserve original elevations.
River carving itself preserves heights. The separate lake-surface pass changes
only lake-mask heights to explicit nominal water levels.

Runtime regression tests verify inland-to-ocean paths for Mississippi, Paraná
and Mackenzie at all sizes. Coverage also includes Yukon, Kuskokwim,
Nelson/Saskatchewan, Churchill, Columbia/Snake, Fraser, Sacramento/San Joaquin,
the North and South American Colorados, Rio Grande, St. Lawrence outlets,
Lerma/Santiago, Usumacinta/Grijalva, San Juan, Magdalena, Orinoco, Amazon,
Tocantins/Araguaia, São Francisco, Uruguay, Negro, Chubut, Santa Cruz and Bío-Bío.

### Known water limitations for visual review

The new opt-in lake importer reconstructs the five Great Lakes plus Lake Saint
Clair from six unchanged Natural Earth 1:10m lake polygons, retaining 47 island
holes. Source hash: `b02a290debcb3dd995f751cb5338c5fa231d74d1391efd43c655732946babbe6`.
An 8×8 true-centre-sampled union mask establishes authoritative water independently
of sea level and imagery. It preserves source PNGs and every height outside the
lake mask, flattens the selected water surfaces, regenerates shores and clears
vegetation. Touching named polygons share coverage before majority selection;
mixed shoreline cells take their dominant lake's level.

Nominal IGLD1985 chart/low-water datums are Superior 183.2 m, Michigan/Huron
176.0 m, Saint Clair 174.4 m, Erie 173.5 m and Ontario 74.2 m. These are reference
levels, not current or average water levels, and no precise datum transformation
to the source DEM is asserted. Provenance is embedded in `lakes.geojson` and the
manifest. See [LakeSurfaceImport.md](LakeSurfaceImport.md) for reuse instructions,
source links, validation and the runtime contract.

All five Great Lakes have flat, navigable water interiors at every map size.
Saint Clair is below majority-cell resolution at size 250; its existing river
water remains. Narrow straits and small islands remain resolution-limited, and
not all lakes are guaranteed connected to each other or the Atlantic. The
Superior–Huron St. Marys channel is not part of the lake polygons and was not
invented or flattened across its rapids. Below-sea-level dry basins and unrelated
above-sea-level lakes retain the old sea-mask limitations.

Natural Earth linework and the calibrated shoreline leave outlet gaps for
Churchill, Sacramento/San Joaquin, St. Lawrence and Tocantins at all sizes.
Additional gaps occur at size 1000 for Yukon, Kuskokwim, North-American Colorado,
Orinoco, Amazon, Uruguay and Santa Cruz. Amazon and Xingu remain separate at
size 1000; Santa Cruz also has a gap at size 250. No claim is made that all rivers
connect to the sea or represent real-world navigability.

## Registration and reproduction

New World is registered in the shared gameplay and lobby catalog, supported by
multiplayer creation, default rooms, AI links and the rotating three-card
selection. The local review route is `/skirmish/index.html?map=new-world`.

```sh
git lfs pull --include='HeightMaps/New World/*' --exclude=''
python scripts/importSkirmishHeightmap.py 'HeightMaps/New World/import.json'
node scripts/generateLobbyMapPreview.mjs new-world
python -m unittest discover -s tests -p '*_test.py'
npm run test:skirmish -- --maxWorkers=4
npm run build:skirmish
npm run play
```

Use repository-supported Node/npm and the Python versions pinned in
`scripts/heightmap-requirements.txt`. Runtime/test artwork must also be hydrated
from LFS before running the full suite or visually playing the app.

## Verification and base revision

Validation targets `Terrain-Merger` commit `daa589b9b4ba14bd14fc0b1e4ad53061a4df9f11`
(the current SEO/UI branch changes). The earlier local review at `bb8cf1c` was
preserved separately. The current branch's SpawnSelection supports separated
viable landmasses; its 20-faction New World start succeeds at the smallest size.
The older one-landmass spawn implementation could not fit that full roster.
Old World's spawn regression was updated to reflect the current branch's
intended viable-landmass rule; its generated assets were not changed.

- All three variants decode with finite calibrated heights and coherent water,
  land passability and water-cleared vegetation
- Twenty viable faction starts advance the simulation on the smallest size
- Runtime ocean-connectivity and biome/elevation regressions pass
- All 19 Python authoring tests and all map-specific runtime regressions pass
- Final full skirmish run: 527 of 528 tests pass (82 of 83 files); the unchanged
  OnlineMatchTransport test intermittently dispatches an empty batch before its
  WebSocket research command arrives. The identical failure was reproduced with
  both changed runtime modules restored to HEAD in a separate diagnostic copy.
  No unrelated multiplayer code or assertions were changed
- Production build, TypeScript compilation, and focused changed-file Oxlint/ESLint checks pass
- Aggregate repository lint remains blocked by pre-existing findings in untouched
  UI/spawn/coordinator and artwork scripts; no unrelated fixes were included
- Two consecutive complete bakes and previews produce identical bytes
- All 42 protected prior-map files, including Old World, remain byte-identical
- Original height/albedo files remain unchanged
- Shared-renderer preview and source-registration overlay were inspected visually
- Live browser play was not verified; the cloud browser rejected the
  workspace's local preview address with `ERR_BLOCKED_BY_CLIENT`

The assets are a visual-review candidate. No commit, push or deployment was made.
