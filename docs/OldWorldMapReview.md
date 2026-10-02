# Old World map review

Old World is a local review candidate built from the supplied heightmap, using
the existing importer, runtime terrain/environment systems and lobby preview
renderer. Stable identity and asset directory: `old-world`.

## Source and footprint

- Source: `HeightMaps/Old World/17_309_70_313_6_8192_6144_16bit.png`
- Original true 16-bit grayscale PNG: 8192 × 6144, preserved byte-for-byte
- SHA-256: `35faa0fcc24fb51c0b97018d40cf9aeced32f65ab613d56d7f189b49e3f2487e`
- Supplied Regular calibration: −450 to 5353 metres, range 65536, sea level 0
- Movement tiers retain the shared thresholds: highland at 600 m, mountain at 1800 m
- Web Mercator footprint: 19.6868° W to 160.3132° E, 44.5910° S to 64.4725° N
- The source includes Africa, Europe, most of Asia and Australia. It does not
  include the entire northern Old World or the entirety of Oceania
- Sizes: 250 × 188, 500 × 375 and 1000 × 750. The longest edge selects size;
  the smallest height uses the shared positive rounding rule

Source export and calibration metadata live in `HeightMaps/Old World/import.json`.
The original export URL in `rules.txt` is retained exactly in that configuration.

## Climate and rivers

No aligned satellite albedo or mountain-color reference was supplied. The map
therefore uses the existing geographic environment fallback with 25 broad,
blended authored climate regions, rather than a color-derived environment asset.
These guide the Sahara, Arabian and Australian dry interiors; European and
Eurasian woodland; Congo and Southeast Asian humid belts; and coastal vegetation.
They are plausible artistic approximations, not measured rainfall or land cover.
Elevation and water remain authoritative for mountains and passability.

The curated public-domain Natural Earth layer contains 109 features across 23 major systems,
including 108 Natural Earth geometries and the previously authored Congo coastal
extension reused from Africa. An unnamed source delta branch is given the display
label Ganges-Brahmaputra Delta so the high-resolution river reaches the sea.
Its upstream file is byte-identical to the dataset recorded by the other maps.
The curated source records its upstream Git blob, SHA-256, selection and license;
`import.json` pins the actual LF bytes for reproducible cross-platform checkout.

River channels use the same explicit one-/two-/three-cell strokes at the three
sizes. Bends and overlapping junctions can be wider. Channels are four-connected
water and retain the original elevation samples. This is a continental gameplay
layer, not a claim of measured widths or real-world navigability.

## Reproduce

Use the repository's supported Node and npm versions, and install the Python
versions pinned in `scripts/heightmap-requirements.txt`. Hydrate the original PNG
with Git LFS before baking.

```sh
git lfs pull --include='HeightMaps/Old World/*' --exclude=''
python scripts/importSkirmishHeightmap.py 'HeightMaps/Old World/import.json'
node scripts/generateLobbyMapPreview.mjs old-world
python -m unittest discover -s tests -p heightmap_import_test.py
npm run test:skirmish -- --maxWorkers=4
npm run build:skirmish
npm run play
```

The review route is `/skirmish/index.html?map=old-world`. Old World is also
registered in the shared solo/lobby catalog and multiplayer creation schema.
With four maps, the existing three-card lobby rotation now rotates the set.

## Review limits

The sea mask is calibrated elevation, not an independent water dataset. As with
the existing maps, high-elevation lakes can be absent, below-sea-level dry ground
can be misclassified, and small islands/straits can disappear at coarse sizes.
Arctic mouths of Ob, Yenisey and Lena are outside the crop. The Mediterranean,
Black Sea and Sea of Azov can be separate navigable water bodies when their narrow
straits disappear at this scale. Small outlet gaps remain for Dnieper and, at
some sizes, Don, Amur and Murray/Darling; these were not filled with invented
courses. Congo and Ganges/Brahmaputra are checked against ocean connectivity at
all three sizes. No hydrology or
climate changes are applied to any earlier map. Visual acceptance is still needed.

## Verification

- All three map sizes load through the runtime decoder with finite calibrated
  elevations, valid land/water passability and preserved dimensions
- Twenty connected land starts on the smallest map advance successfully
- Climate regression verifies a dry Sahara and humid Congo
- Catalog, multiplayer schema, default room creation, AI link and lobby-card
  rotation tests cover the new identity
- All 499 skirmish tests in 77 files and all 10 Python authoring tests pass
- Two consecutive complete bakes and previews produce byte-identical output
- Production build, TypeScript compilation, and focused
  changed-file Oxlint/ESLint checks pass
- SHA-256 comparison confirms all 34 protected earlier-map assets unchanged
- The rendered lobby preview was inspected visually using the actual shared
  environment/forest/relief modules
- Live browser play was not verified: the cloud browser rejected this workspace's
  local preview address with `ERR_BLOCKED_BY_CLIENT`
- Aggregate repository lint remains blocked by existing nullish-coalescing lint
  findings in untouched source/art scripts; no unrelated lint edits were made

The ordinary runtime/test-map LFS assets must also be hydrated for the full test
suite. Initial pointer-file failures were resolved by fetching those existing
assets. No source-map calibration, importer algorithm or terrain runtime was
changed. No commit, push or deployment was made.

## Compatibility with subsequent branch changes

The combined Old World/New World review was revalidated against Terrain-Merger
`daa589b9b4ba14bd14fc0b1e4ad53061a4df9f11`. Its current SpawnSelection permits
factions on separate viable landmasses. Old World's spawn test now checks that
rule rather than requiring all factions on one connected landmass. All eight
Old World generated files remain byte-identical to the original review above.
