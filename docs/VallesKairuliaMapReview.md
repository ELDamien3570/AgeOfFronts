# Valles Kairulia map review

## Source and calibration

The requested display name is preserved. The supplied source files are a real
central-Mediterranean Manticorp export, covering southern Italy, Sicily,
Corsica/Sardinia, Tunisia and a clipped northeastern Adriatic edge. Both actual
satellite and topographic images were inspected before importing. No fictional
continents, climate regions, rivers or water bodies were invented.

- Input folder: `HeightMaps/Valles Kairulia`
- Original height source: true 16-bit grayscale, 4096 × 4096
- Original satellite albedo: RGB, 4096 × 4096; used for continuous moisture,
  vegetation and aridity fields, with the existing 1.1 green sensitivity
- Original OTM source: visual registration/relief reference only; its roads and
  labels are not sampled into the environment
- Supplied range: −450 to 1,819.473 m, Regular 65536 normalization
- Sea level: 0 m; movement tiers: plains below 600 m, highlands 600–1800 m,
  mountains above 1800 m
- Gameplay sizes: 250 × 250, 500 × 500, 1000 × 1000
- Source URL and exact SHA-256 hashes are pinned in `import.json` and the manifest

The recorded [export URL](https://manticorp.github.io/unrealheightmap/#latitude/38.61705122131377/longitude/13.579123531324512/zoom/5/outputzoom/9/width/4096/height/4096/outputformat/png16)
registers the source at 38.61705122131377° N, 13.579123531324512° E with output
zoom 9. The Web Mercator footprint spans longitude 7.9541235313–19.2041235313° E
and latitude 34.0892529072–42.8761336376° N. This follows the explicit supplied
metadata, not an inference from the map name.

Before adding rivers/lakes, the medium-size satellite color-water hint agreed
with the calibrated sea mask on 99.31% of cells (IoU 99.06%). A red shoreline
overlay was checked visually against the supplied satellite image. This is a
registration diagnostic, not an independent water mask or scientific land-cover
claim. The importer never derives terrain height or hydrology from color alone.

## Environment and relief

Wooded uplands remain greener than the dry southern lowlands. Albedo fields
blend smoothly through the existing shared environment/forest renderer. The
map uses its actual latitude and supplied heights; it needs no invented regional
climate patches. Peaks that reach the mountain threshold use the existing grey
alpine palette. No land reaches the applicable snowline, and no blanket snow
layer is added.

The export itself has a low elevation ceiling: some summit areas saturate at
about 1,819.438 m. It also contains visible rectangular bathymetric tile seams
in the northeastern water area. Those are source limitations, not new terrain.
The original PNG bytes and every non-lake resampled height are preserved. No
external summit values are substituted and no claim is made that this is a
complete, unsaturated modern DEM. Most undersea seams do not affect the common
water rendering or create false land.

## Rivers and lake surfaces

Seven unchanged Natural Earth features supply Tevere/Tiber, Ofanto, Simeto,
Volturno, Salto (with its source aliases Velino/Nera), Sacco (Liri/Garigliano),
and the in-frame part of Morača. Coordinates are projected from the same
recorded Web Mercator footprint. The agreed one-/two-/three-cell widths at
250/500/1000 are retained and visually checked. They are gameplay exaggerations,
not physical widths; output cells already span about 3.9/2.0/1.0 km near the
source center. Bends and junctions can be wider. Rivers retain sampled source
heights; they are not excavated to sea level.

All represented portions of the first six river features connect to the main
sea at every size. Morača is cropped by the northeast/east boundary and is not
connected to the main sea within this map; no off-map or invented connector is
added. There is no complete drainage-network claim. The selected source supplies
no river features for Sardinia, Corsica or Tunisia within this footprint.

Three original lake polygons use the shared positive-elevation lake pipeline:

- Lago di Bolsena: 305 m, from [Regione Lazio's water protection plan](https://www.regione.lazio.it/sites/default/files/2021-10/DCR-18-23112018.pdf), section 4.1.2
- Lago di Bracciano: 164 m, the [municipal lake description](https://www.comune.bracciano.rm.it/il-lago-di-bracciano/il-lago-di-bracciano/)
- Lake Skadar: 6 m, [FAO's Albania inland-fisheries profile](https://www.fao.org/4/t0798e/T0798E01.htm), section 5.2; only the northwestern portion lies inside the export

These are rounded nominal reference surfaces, not current levels. Their sources
do not establish an exact common vertical datum or conversion to this DEM.
Bracciano's preserved Natural Earth `altitude` attribute says 161 m; the explicit
model surface uses the municipality's published 164 m separately. Skadar varies
seasonally; a small negative median in the original height pixels is not evidence
that it is a sea-level lake.

The correctly named European-supplement Bolsena and Bracciano polygons were
selected after checking their actual locations. The global Natural Earth feature
named Bracciano incorrectly overlaps Bolsena and was excluded, avoiding a wrong
lake elevation. Drina was also excluded because only its bounding box intersects
the map. Unnamed, unvalidated or below-sea-level lake candidates were not added.

Exact upstream commit, dataset hashes, IDs, license, source references and
selection notes are embedded in the GeoJSON and manifest. All selected feature
coordinates/properties are unchanged from [Natural Earth v5.0.0 global/European
rivers](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/)
and [lakes](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/).
These public-domain datasets are generalized small-scale cartography, not exact
shore surveys. The supplied polygons do not retain all small islands or bays.

The final lake masks resolve Skadar/Bolsena/Bracciano to 3/8/3 cells at 250,
13/34/15 at 500, and 53/129/61 at 1000. All are flat at their configured positive
levels, boat-passable, blocked to land movement and vegetation-free. Heights
outside these masks are byte-for-byte equal to the original calibrated bake.

## Integration

Stable ID and asset root: `valles-kairulia`. The central map registry supplies
gameplay selectors, multiplayer validation, default rooms and lobby cards. All
three sizes have elevation, terrain, environment and manifest assets. The lobby
preview is generated from the same environment, forest cover and relief
functions consumed by the game.

Review route: `/skirmish/index.html?map=valles-kairulia`.

## Verification

- Final full suite: 535/535 tests across 84 files passed
- 19 Python authoring tests passed
- Production build, TypeScript and changed-file Oxlint/ESLint passed
- Repository-wide lint still reports unrelated pre-existing art/UI/spawn findings
- Every lake mask was independently reproduced from its polygon; all nine
  lake/size surfaces, counts and water-path checks passed
- Six river features connect to the main sea at every size; the source crop
  limitation is preserved for Morača
- All 104 protected prior source/assets and all three original Valles PNGs are
  unchanged; all non-lake Valles heights reproduce the original calibrated bake
- Repeated full bake and preview produce identical hashes for all 11 output files
- Actual gameplay `loadMap` succeeds at all sizes with 20 viable starts and
  no forest or desert-resource flags on water
- Static shared-renderer preview inspected visually; live browser play remains
  unverified because the available cloud browser blocks the workspace's local app

The earlier multiplayer WebSocket/fake-clock race did not reproduce in either
Valles full-suite run. No multiplayer transport logic was modified.

## Reproduce

Use supported Node/npm and the pinned `scripts/heightmap-requirements.txt`
dependencies. Hydrate the original LFS source PNGs before baking.

```sh
git lfs pull --include="HeightMaps/Valles Kairulia/*"
python scripts/importSkirmishHeightmap.py "HeightMaps/Valles Kairulia/import.json"
node scripts/generateLobbyMapPreview.mjs valles-kairulia
python -m unittest discover -s tests -p '*_test.py'
npm run test:skirmish -- --maxWorkers=2
npm run build:skirmish
npm run play
```

No commit, push or deployment is performed. Technical and static-renderer checks
do not replace final in-game visual acceptance.
