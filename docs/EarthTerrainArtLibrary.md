# Earth terrain art library

The approved library is now integrated into the skirmish renderer. Originals live
in `Art/Terrain/Earth`; `generation-prompts.json` records every exact prompt. New
generations receive new versioned filenames. No original PNG pixels were edited.

## Current map placement

`EnvironmentProfile` is an explicitly approximate map-generation model;
`TerrainEnvironment` projects it into ground colors and reads shared forest cover. The
heightmap uses its generator export's normalized Web Mercator footprint, derived
from the center, output zoom, and original image dimensions; latitude follows
the inverse projection rather than a linear north/south interpolation. The
generator's [stitching implementation](https://github.com/manticorp/unrealheightmap/blob/main/src/processor.ts)
centers a 256-pixel tile grid on `exactPos`. Other maps have no verified
georeference and use a temperate artistic baseline.

Latitude, calibrated elevation (or existing terrain tiers on other maps),
procedural moisture, and water proximity choose candidate families. These are
artistic rules, not a scientific climate classification. Desert/forest boundaries
and wet areas are approximate. Existing water-mask limitations still apply;
there is no inferred river network. Mangroves require a warm, wet, low coast.
No decoration crosses the occupied land-cell bounds, and absent environments
are not forced into a map merely to use every atlas.

Test 1 adds an authored regional climate profile in
`resources/maps/heightmap-test1/climate.json`. Broad elliptical influences raise
moisture and woodland suitability over Germany, France and northern Spain,
feathering into neighboring terrain. Overlaps combine by maximum rather than
addition. The heightmap adapter supplies these generation inputs; ordinary
maps keep their existing profile. Elevation, coast and alpine eligibility still
take precedence. `RegionalClimate` contains no political borders or rendering
colors. This is approximate vegetation for playtesting, not satellite-derived
forest coverage. Replace it with aligned biome/cover data when that is available.

`ForestGeneration` creates coherent stand cover from warped broad noise and
smaller clearings, gated by family, moisture, elevation and coastal conditions.
The byte-per-cell cover is static map data sent to the worker. `ForestField`
adds a match-owned construction-clearance overlay. All three troop types slow
by up to 40% at full cover; exact and hierarchical routes account for the same
cost. No forest damage, vision, collision wall, resource or combat modifier is
introduced. Placement remains approximate until real cover data is imported.

`TerrainDecorations` separates the canopy layer from low open-ground accents.
Staggered, lightly jittered canopy anchors are roughly 1.15 cells apart; dense
variants occupy stand interiors, and open variants feather edges. Clearings
come from the shared cover field, rather than independent stamp rejection.
Canopies retain their maximum 2.1-cell size. Other accents keep authored
1.05-1.7-cell footprints. Alpha bounds and pivots retain transparent padding;
baked lighting is never rotated or mirrored. More canopy silhouette variants
remain a useful art-library follow-up.

As soon as construction starts, every cell touched by a building's maximum
world footprint loses forest cover. The renderer suppresses any silhouette
intersecting that cleared ground, including neighboring trees, and redraws its
ground tint. Domain movement and route costs update at the same time. All six
building types and AI buildings follow this rule. Stacks count as one ground
site; capture and construction progress do not reroll trees. Overlapping sites
keep ground clear until all are absent. Natural cover would return after site
removal; permanent deforestation, harvesting and timed regrowth still require
separate domain rules.

The environment arrays and 16-cell decoration index are built once per map.
Only used atlas families load. Detailed art hides at distant zoom, where cover
still supplies woodland ground color and movement cost. Visible art bakes into
bounded 64-cell chunks with shared gutters; occupancy invalidates only affected
chunks at all zoom levels. Rendering and image loading never alter domain
rules. An aligned cover/biome dataset can replace generation without changing
the art catalog. The current forest review is `/build/review/forests/index.html`.

The local placement review is `/build/review/terrain-placement/index.html`.

## Library structure

Use three independent axes instead of one ever-growing list of named places:

1. **Environment family** narrows the candidate art: woodland, boreal, tropical,
   Mediterranean, steppe, savanna, desert, wetland, alpine, tundra, coast, or polar.
2. **Accent role** determines placement and density: canopy, understory, small
   ground detail, rock, reed/marsh clump, or shore accent.
3. **Conditions and regional variants** refine the candidates: sparse/dense,
   wet/dry, exposed/sheltered, sandy/rocky, snow cover, and regional plant forms.

These twelve folders are practical art groups, not a formal or complete scientific
biome classification. In particular, coast, wetland, alpine, and snow/ice features
can overlay several climate biomes. A future map classifier must retain those
conditions instead of forcing every cell into one exclusive category.

| Art family            | Starter accents                                                 | Useful follow-up generations                                                                    |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Temperate woodland    | Dense broadleaf grove, open grove, understory, mossy stones     | Mixed forest, oak/beech/birch forms, regional evergreen forest, autumn and bare winter trees    |
| Boreal conifer        | Dense and open conifers, lichens/shrubs, granite                | Pine/spruce/larch variants, bog margins, snow-covered variants                                  |
| Tropical moist forest | Dense and open rainforest, broadleaf understory, humid rocks    | Regional canopy shapes, seasonal/dry tropical forest, tropical conifer forest                   |
| Mediterranean scrub   | Evergreen grove, open pine, maquis scrub, limestone             | Olive/oak forms, chaparral, southern African shrubland, Australian heath                        |
| Grassland/steppe      | Green grasses, dry tussocks, low shrubs, stones                 | Prairie, Eurasian steppe, pampas, seasonal dry/green variants                                   |
| Savanna/dry woodland  | Dense/open acacias, dry grass and thorn scrub, ochre rocks      | Broadleaf dry woodland, thorn woodland, African/Australian/South American variants              |
| Desert/xeric          | Sand ripples, sparse shrubs, sandstone, gravel                  | Stony desert, cold desert, salt flats, red dunes; region-restricted succulents and oasis assets |
| Wetland/riparian      | Reeds, willow grove, marsh grasses, river stones                | Bogs, floodplains, swamp trees, seasonal wet/dry variants                                       |
| Alpine                | Scree, dwarf pine, cushion grasses, snow-patched rock           | Geology variants, bare exposed ridges, snowline transitions                                     |
| Tundra                | Moss/lichen, dwarf shrubs, frost-weathered rock, snowy tussocks | Wet/dry tundra, summer/autumn variants, patterned ground                                        |
| Coastal               | Beach grass, shoreline rocks, dune ripples, mangrove canopies   | Rocky/sandy/muddy shore variants, salt marsh, region-specific coastal plants                    |
| Polar ice/snow        | Snow ridges, fissured ice, exposed rock, broken ice             | Glacier edges, snow accumulation, coast ice; ice shelves require separate larger-shape art      |

The first atlas in each family contains four slots in reading order. Slots have
stable descriptive IDs; placement must never infer meaning from an image's colour
or its position on a contact sheet. The generated images remain whole and unedited.
Their four source rectangles are recorded separately in `manifest.json`.

Some generated PNGs contain extremely faint alpha noise in otherwise empty
space. Bounds are measured at alpha 8/255 for sizing and margin checks; pixels
are not thresholded or rewritten. Original files and previews retain the full
alpha channel. Earlier candidates with clipped or insufficiently padded slots
are excluded from the manifest and identified in the prompt registry.

## Generation contract

- Fixed orthographic overhead camera, fixed upper-left light, short contact
  shadows, muted painted colours, broad readable silhouettes.
- Four equal cells per atlas, one isolated cluster per cell, generous transparent
  gutters. No text, UI, buildings, square ground panels, or baked surrounding sea.
- Canopy clusters use about **2.1 terrain cells** as their starting display width;
  small ground details use about **1.05 cells**; stones and other low accents are
  generally **1.3–1.7 cells**. The renderer uses those same visible footprints.
- Generated pixel resolution is independent of world footprint. A high-resolution
  tree image must not become a geographically enormous tree stamp.
- Preserve alpha. Validate image dimensions, transparent margins, slot isolation,
  and readability at small display sizes. Automated checks cannot certify species
  identity, artistic consistency, or accurate geographic placement.
- Variation should come from additional silhouettes and density variants. Arbitrary
  rotation or mirroring would rotate the baked lighting; disable both unless an
  asset is deliberately authored without directional shading.
- Decorative accents should disappear or merge into subtle ground colour at distant
  zoom. Giant continent-level canopy stamps are not an acceptable fallback.

The library preview includes a large inspection view and a terrain-cell-scale
view. The separate placement review records runtime screenshots and preparation
measurements; those measurements do not establish full-match FPS or simulation
capacity.

## Replacing approximate placement with geographic data

The Earth footprint helps identify regions, but the heightmap alone contains no
forest type, rainfall, land cover, or river network. The current renderer uses an
approximate climate model and procedural moisture; that is decorative
distribution, not geographic truth.

The next domain data should be a static, aligned environment field: climate/biome
family plus independent land-cover fractions and water/coast/snow conditions.
Keep this separate from calibrated elevation and movement terrain. Keep generated
sprite IDs, sizes, colours, caches, and zoom rules in the presentation layer.
No image generation should create collision, slow travel, or alter combat.

Use the heightmap's exact projected footprint, not a linear guess from latitude
and longitude. Reproject and aggregate any geographic input offline into the
gameplay grid. Retain fractions for mixed cells so forest edges can blend instead
of becoming square walls. All imported fields must agree on origin, extent,
orientation, dimensions, and land/water mask.

ESA WorldCover provides real land-cover classes including tree cover, grassland,
bare ground, water, wetland, mangroves, cropland, and built-up areas. It is a useful
candidate for cover and water evidence, but it does not distinguish all these art
families. The [official data access page](https://esa-worldcover.org/en/data-access)
describes its geographic GeoTIFF tiles and eleven-class product. A separate
ecoregion or climate source is needed to distinguish boreal, temperate, and tropical
tree cover. Download only the required regions and bake compact local assets;
do not ship full-resolution global GIS data to the browser.

Modern land cover also includes human changes. For a Stone Age opening, prefer a
natural biome baseline and let the game add cities, roads, farms, factories, and
later-age changes. Modern cropland or city footprints should not automatically
be painted into the starting world. NASA's
[discussion of human ecosystems](https://earthobservatory.nasa.gov/images/40554/human-ecosystems)
explains why modern human-altered cover differs from a natural biome description.

Once that field exists, choose accents deterministically from family, role,
conditions, and a stable world seed. Use regional masks for plants such as cacti,
and require coast/wetland conditions for mangroves or reeds. Blend neighbouring
families with cover fractions and vary spacing without repeating a visible grid.
Draw through the existing disposable terrain chunks, with a bounded texture and
cache budget. Buildings and units remain the readable foreground.

## Future generation batches

1. Add three to six silhouette variants for frequently repeated canopy and rock
   slots; review at tactical and distant sizes before increasing detail.
2. Split regional plant forms where they change the map's character. Add temperate
   conifer and tropical dry forest coverage; avoid country-named rendering rules.
3. Expand shoreline, riverbank, and forest-edge accents after masks exist. Long
   coastlines and cliffs need oriented segments, with lighting authored correctly.
4. Add seasonal, snowline, and dry/wet versions using the same footprints and IDs.
5. Add human land-use accents through game progression, separately from the
   baseline environment library.

Record biome/condition tags, source rectangles, intended footprint, variant weights,
alpha bounds, generation provenance, and exact prompts with each batch. The art
catalog remains stable while candidate pools grow.

## Reusable prompt template

Start from the saved `commonStyle` and `packingRevision` in
`Art/Terrain/Earth/generation-prompts.json`. Supply exactly four descriptions in
reading order. For each description specify the environment, accent role,
density, regional forms if relevant, and season or moisture condition. Change
one axis at a time when building variants so differences can be judged clearly.
For example, generate three more Mediterranean open-canopy silhouettes before
adding their summer-dry or winter variants.

Keep camera, light direction, transparent gutters, and intended world footprint
fixed. After saving each new original under a versioned filename, select it in
the prompt registry and run:

```text
python -B Art/Terrain/Earth/build-library.py
```

This rebuilds the manifest and alpha/dimension validation report without editing
the images. When selecting a new atlas filename, update the explicit selected
URL list in `src/skirmish/client/TerrainArtwork.ts`; superseded generations stay
outside the runtime bundle. Open `/Art/Terrain/Earth/index.html` through the local dev
server for visual review. Numeric checks validate packing, not ecological or
artistic quality.
