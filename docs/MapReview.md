# Map review and sequential rollout

## Current review: Amazon River

Amazon River now uses the supplied matching 8192x2048 heightmap and satellite
albedo. The export's -450 to 4160 metre range is recorded in
`HeightMaps/Amazon River/import.json`. Its original 4:1 proportions produce
250x63, 500x125 and 1000x250 variants. The shifted OTM image is only a visual
reference, not a registered terrain source. Smooth albedo fields retain the
Africa green sensitivity of 1.1. No fictional relief or runtime image decoding
is used.

The river layer contains 18 Natural Earth features for the Amazon and selected
major tributaries. Channels use the agreed one-/two-/three-cell strokes by size,
with wider connected bends and junctions. Both ends of the main Amazon line
belong to ocean-connected water at every resolution. Coastlines, forest fields
and passability are baked together; original elevations remain unchanged.

Validation: production build, TypeScript check, 35 targeted gameplay/lobby/terrain
tests and 10 Python authoring tests passed. A 20-faction start was checked on
Amazon's smallest variant. All six prior Africa/Mediterranean elevation files
retain their original hashes. The live review is at
`/skirmish/index.html?map=amazon-river`; screenshot: `build/map-review/amazon-river-review.png`.

Westeros development was cancelled at the user's request. Its map catalog
entry, import configuration, generated assets and fictional importer changes
were removed. The rebuild contains no Westeros map directory. Original supplied
artwork remains in the local source folder; pre-existing Westeros faction content
was outside this map task and remains unchanged. Review Amazon River before
starting New World, Old World or Valles Kairulia.

### Earlier Africa and Mediterranean review

Mediterranean is the display name of the existing imported map. Its original
`heightmap-test1` ID and asset directory remain stable for stored links and rooms.
Its calibrated elevation and western-European climate profile are retained. The source
configuration now lives at `HeightMaps/Mediterranean/import.json`.
Mediterranean also demonstrates the new albedo-to-environment converter; this
demonstration does not begin the next map in the approval queue.

Africa remains available after its river review. Amazon River is the next new
map awaiting review; this work remains local and undeployed. World and Four Islands have been removed from the
skirmish/lobby selectors as requested. Training Square remains a development map.

| Source / rule      | Africa review 3                                                                       |
| ------------------ | ------------------------------------------------------------------------------------- |
| Source             | `HeightMaps/Africa/-18_147_30_234_7_4096_4096_16bit.png`                              |
| Footprint          | Southern Africa and Madagascar, matching the supplied square export                   |
| Input              | Original 4096×4096, true 16-bit grayscale PNG; SHA-256 pinned in import config        |
| Calibration        | Supplied export range −450 to 2577 metres; Regular normalization                      |
| Resolutions        | 250×250, 500×500, 1000×1000; longest edge selects resolution                          |
| Movement tiers     | Plains below 600 m, highlands 600–1800 m, mountains above 1800 m                      |
| Mountain reference | Calibrated elevation, checked visually against the supplied OTM topographic image     |
| Biomes             | Supplied satellite albedo, same smooth color-gradient pipeline as Mediterranean       |
| Vegetation         | Existing shared forest field and terrain-object families use Africa's own environment |
| Review status      | Awaiting user feedback before beginning Amazon River                                  |

The satellite-driven pass has dry Namib/Kalahari interiors, greener Congo and
miombo regions and an eastern Madagascar belt. The original geographic climate
patches are no longer included in Africa's manifest; the albedo gradients provide
its moisture/vegetation/aridity inputs. These are plausible approximations, not measured land cover. Source
heights/terrain remain the domain authority; disposable render shading does not
move mountain cells or change passability.

Africa now adds an explicit geographic river layer for Congo, Zambezi, Limpopo,
Orange and Okavango, including their supplied lake-centerline segments. The
curated `HeightMaps/Africa/rivers.geojson` comes from Natural Earth's public-domain
1:10m dataset. Upstream Git blob and SHA-256, curated SHA-256, projection and
gameplay-width settings are recorded in the import config/manifest. Lines use
the original Web Mercator footprint rather than guessing rivers from blue pixels.
Every rasterized bend is four-connected for the existing water pathfinder.

Major channels are water: land troops cannot walk through them, boats can sail
along them, vegetation is removed, and banks receive the ordinary coast treatment.
Original height samples are preserved; inland water is allowed above sea level.
Relief uses that inland elevation instead of inventing sea-level cliffs.
Widths are authored per size: Small uses a one-cell centerline with connected
two-cell bends, Medium uses two-cell strokes, and Large uses three-cell strokes.
Bends and overlapping river junctions can be wider. This is a first
visual review, not an assertion that every real river segment is navigable.
Currents, waterfalls, broad inland lake shorelines and minor decorative streams
are not represented. The underlying sea mask still misses lakes above sea level,
may classify below-sea-level dry ground as water and loses small islands at low
resolution. Mediterranean's original elevation and albedo settings are unchanged;
its water, coast and environment assets now include the river pass below.

River crossings use the agreed automatic shore transports rather than fixed
bridges. After Cargo Canoes research, a move to reachable land can coordinate
shore approach, embarkation, a physical boat voyage and onward movement. No port
or payment is needed. Whole squads are grouped into temporary transports;
researched hull tiers grant 10 / 12 / 14 / 16 / 18 / 20 / 25 spaces. Embarkation
works from neutral/enemy shores as well as owned land, respects terrain/walls,
and does not grant shore ownership. Boats remain attackable; sinking kills cargo.
They disappear after successful unloading and cannot be repurposed as free
permanent naval units. Port-built transports remain separate paid vessels.

Routes can chain separate water bodies. A faster candidate river crossing may
also be chosen when walking around the headwaters is possible; actual terrain
travel costs are compared with candidate sailing costs. Candidate coast selection
and HPA routing do not guarantee the globally shortest multimodal route.
Occupied or newly blocked landings wait for safe placement; no units are forced
through blockers. Army membership and queued squad moves survive transport.
Review river thickness/alignment and shore behavior on Africa before extending
the pipeline to the next map. This review remains local and undeployed.

Initial Africa review 3 validation: TypeScript compilation, production Vite build, all 370
skirmish tests in 50 files, and 9 Python authoring tests passed. Transfer checks
cover research gating, capacity grouping, real water positions, free embarkation,
successive rivers, faster crossings with connected banks, cancellation, queued
orders, retained army membership, blocked landing, sinking and presentation
snapshot isolation. Hash comparison confirmed all 15 protected Mediterranean
assets/Africa elevation files unchanged. Browser review showed Africa's river
banks with no captured console errors; screenshots and hash proof live under
`build/map-review`. Technical checks do not replace the user's map acceptance.

### Congo outlet and Mediterranean river review

Congo's top-left downstream endpoint now has a short authored extension to the
Atlantic coast, following an approximate downstream course. Its route is connected
and navigable at all three resolutions. Closed inland systems remain closed.

Mediterranean now has 61 curated Natural Earth features covering major rivers
across its complete export footprint. These include Nile, Danube, Rhine, Rhone,
Po, Ebro, Loire, Seine, Tigris/Euphrates, Dnieper, Don and Volga, plus relevant
branches and lake centerlines. Features include aliases and branches, so this is
not a count of distinct rivers. Both maps use the agreed modest per-size widths
rather than proportional dilation that made high-resolution rivers excessive.

Current validation: production build, 26 targeted terrain/routing/transport tests,
and 10 Python authoring tests passed. The explicit width test checks one-, two-
and three-cell straight channels at 250/500/1000 respectively. Congo connectivity
and Mediterranean land/water passability were checked at all three sizes. All six
elevation files match their pre-pass hashes. Browser screenshots in
`build/map-review` show the revised widths. This remains local review; subsequent maps were pending at that review.

The [generator source](https://github.com/manticorp/unrealheightmap/blob/main/src/processor.ts)
defines the Regular 65536 scaling used to decode the supplied calibrated export.
The game retains a link to the generator's
[data attribution guidance](https://manticorp.github.io/unrealheightmap/rights.html).

## Review order

1. **Africa — review now.** Approve it or request changes before the next map.
2. Amazon River.
3. New World.
4. Old World.
5. Valles Kairulia.
6. Westeros.

The remaining source folders have only been inventoried. They are not exposed as
playable placeholders. `HeightMaps/World` currently contains an empty rules file
and is outside this requested rollout.

For each next map, inspect the actual height/albedo/red reference files and their
calibration/projection first. Confirm that references share an aligned footprint;
matching filenames or image dimensions alone do not prove alignment. Some export
reference filenames indicate different centers, so registration must be checked
before sampling them. Use red references to verify mountain regions against the
height field, and albedo as a biome/placement guide rather than encoding place
labels, roads or lighting into gameplay terrain. Preserve original source files.

Westeros has a JPEG height reference rather than a calibrated 16-bit export. Its
relative elevation scale, coastline and plausible fantasy biomes require their
own documented authoring decisions when its review begins; Earth calibration
must not be silently applied to it.

## Shared asset pipeline

`content/Maps.ts` owns stable map identity, name, source dimensions and asset root.
Gameplay and lobby selectors share that registry. The offline importer preserves
source proportions at each longest-edge resolution, calibrates heights, classifies
terrain and embeds the map's climate profile. Runtime decoding validates dimensions,
height bounds and climate inputs. Each map has its own environment; Mediterranean's
profile is no longer globally assigned to every heightmap.

The importer is an authoring adapter; environment, forest cover, movement and
simulation remain shared domain systems. Views consume their projections. No
MVVM or DDD departure is needed.

## Albedo converter: Mediterranean demonstration

The importer can bake a registered colored image into three continuous byte
fields per terrain cell: moisture, vegetation and aridity. Visible green/brown
ratios provide approximate color evidence; land-weighted smoothing blends gradients
without letting ocean samples spread into neighboring forests. Mediterranean's
`Colored_satelitte.png` has matching 8192×4096 dimensions and aligns plausibly with
the heightmap coastline in this review. At 500 cells the color water hint agrees
with the heightmap land/water mask on about 96.6% of cells. That is a diagnostic,
not a hydrology mask or proof of perfect registration.

The manifest records the pinned image hash, classifier version, registration,
smoothing and per-resolution diagnostics. Runtime decoding rejects missing,
truncated or incompatible declared fields rather than silently changing the map.
`EnvironmentProfile` consumes the fields with latitude/elevation/climate; the
shared forest generator uses vegetation evidence to shape cover and clearings.
The existing cover field still drives forest movement costs in both the main
thread and simulation worker. Ground colors blend continuously, and semantic
biome families select trees, scrub, rocks and other existing terrain accents.
The thumbnail generator consumes the same environment and forest systems.

The converter leaves calibrated terrain/elevation bytes unchanged. Elevation
still controls mountain tiers, snow and passability; albedo colors cannot create
lakes, rivers, cliffs or new movement tiers. Mountains are not inferred from dark
pixels. Existing red references remain mountain review aids, not biome inputs.
Brightness/shadows, cropland, exposed soil and decorative map colors can mislead
visible-color classification. The output is deliberately plausible rather than
scientific vegetation or rainfall data, and needs visual acceptance.

For each later map with a usable albedo, add an `albedo` object to its import
config containing `source`, `sourceSha256`, `registration: "same-footprint"` and
`smoothingCellsAt500` (Mediterranean uses 1.4). Confirm projection and footprint
before setting that registration. The current adapter requires matching source
dimensions and an explicit registration declaration; shifted/cropped references
need registration before use. It does not automatically warp them. Old World currently
has no colored reference; Westeros requires its own fantasy-map interpretation.

## Africa albedo review 2

Africa uses `-18_146_30_234_7_4096_4096_albedo_imagery.png` for its biome fields.
The matching-size `albedo_otm.png` is a visual mountain reference; its labels,
roads and elevation colors are not passed to the vegetation classifier. The
albedo filenames round the latitude differently from the older heightmap. Visual
coastline inspection and the 500-cell diagnostics (99.4% water-hint agreement,
98.8% water-hint IoU) support alignment at gameplay resolution; they do not
certify subpixel geographic registration or inland hydrology.

Africa sets `greenSensitivity: 1.1`, while the importer default stays `1.0`.
This multiplies the green response before saturation, giving a small increase in
moisture and vegetation while keeping the aridity and water-hint rules unchanged.
At 500 cells the mean baked vegetation field rises approximately 2.4% versus the
same image at sensitivity 1.0; this is not a promise of exactly 10% more trees.
The existing deterministic stand/clearing generator still controls natural forest
placement. Source/albedo files, calibrated terrain and elevation are preserved.
All Mediterranean assets stay byte-for-byte unchanged. The setting is an
Africa-only review candidate; promote it to later maps only after user approval.

```powershell
python scripts/importSkirmishHeightmap.py HeightMaps/Mediterranean/import.json
node scripts/generateLobbyMapPreview.mjs heightmap-test1
```

Review the Mediterranean game for broad green/dry gradients, natural forest
edges and unchanged coastline/mountain locations. Adjust the source or documented
classifier/authoring settings if a region needs correction, then rebake all
variants. Do not implement a second classifier inside a view.

```powershell
python scripts/importSkirmishHeightmap.py HeightMaps/Africa/import.json
node scripts/generateLobbyMapPreview.mjs africa
python -m unittest discover -s tests -p heightmap_import_test.py
npm run test:skirmish
npm run build:skirmish
```

Homepage rotation cycles up to three featured map cards every 60 seconds. The
custom holder/queue and entered rooms remain intact. Mediterranean and Africa are
the current review pool, so both are visible; later approved maps extend it.
The coordinator will eventually publish a common schedule and preserve room
lifecycle independently of which map cards are featured.

## Validation and acceptance

Before review, verify calibrated land/water, exact proportions at each resolution,
coastline orientation, biome plausibility, mountain/height agreement, terrain art
placement, valid starts and ordinary play. Technical checks do not replace user
visual acceptance. Run the combined revision again before any deployment because
gameplay work is also in progress in this checkout.

The first Africa implementation passed all 293 skirmish tests across 40 files,
all five Python importer tests and the TypeScript typecheck. Coverage includes
all three square variants, source-proportion rounding for wide/portrait maps,
per-map dry/humid climate, twenty connected faction starts, and featured-card
rotation without changing identity/queue state or stealing keyboard focus.

The Mediterranean converter revision passed all 330 current skirmish tests across
44 files with four test workers, all seven Python importer tests, TypeScript
typechecking and the production Vite build. The unconstrained parallel run first
hit two five-second gameplay test timeouts while typechecking/thumbnail generation
were running; the bounded full rerun passed without changing those tests or their
timeouts. New checks cover continuous green/dry evidence, land-only smoothing,
environment field ownership/validation and all Mediterranean asset resolutions.
Git confirms Mediterranean's terrain/elevation assets remain unchanged.

The local production preview loaded both maps, ran and paused their matches, and
showed coherent terrain objects at detailed zoom without browser console errors.
The directory visibly rotated from Mediterranean/Africa to Africa/Mediterranean
on its 60-second cycle. Review screenshots are in `build/map-review/`; these
generated proof files are local, not production assets. User visual acceptance
and deployment are still pending.

Africa's satellite-driven review 2 passed 30 targeted terrain/environment tests
across six files, eight Python importer tests, the TypeScript typecheck and the
production build. These checks include all three Africa environment variants,
calibrated land/water, dry/humid separation and twenty connected faction starts.
The local game ran with the new assets, and detailed zoom showed humid woodland
stands, clearings and smooth dry-ground transitions without console errors.
SHA-256 comparisons against the pre-revision assets confirmed unchanged Africa
terrain/heights and unchanged Mediterranean assets. Review screenshots and the
sensitivity comparison are saved locally under `build/map-review/`.
