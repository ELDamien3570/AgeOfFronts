# Expanded skirmish

Imported maps default to 500 cells on their longest edge and preserve source
proportions. Mediterranean offers 250×125, 500×250 and 1000×500; Africa offers
250×250, 500×500 and 1000×1000. Movement speed remains measured
in terrain cells per simulation tick, so a larger battlefield means longer
journeys. Territory income is divided by the world's area relative to the
classic map; camp income and each building's normal benefit are unchanged.

The current trial settings allow one human and 19 AI factions, 200 squads per
faction (including embarked squads), and 64 ships per faction. Buildings have
no gameplay count limit. Hardware still limits their practical population.

Buildings of the same type may share their exact terrain tile. Each copy has
its own cost and construction timer and provides its normal completed benefit.
Mixed types cannot share a tile. Separate sites retain the three-cell spacing
rule, and ports still require a coast. Tile capture transfers every copy on the
tile, including construction progress. One map icon and a count badge represent
the stack; its inspection card combines completed income and construction.

## Ownership and architecture

Skirmish architecture is driven by gameplay and measured runtime cost. DDD and
MVVM are not requirements for new features. Prefer a direct function or a small
game system; introduce another interface, adapter or projection only when it
serves an actual independent caller, ownership rule or transport boundary.
Keep deterministic simulation separate from browser timing and rendering, and
keep command authorization and dependent snapshot deltas intact.

The fixed-step domain owns orders, movement, capture, costs, income and combat.
AI and human commands use the same domain validation. View models project the
domain snapshot into recruitment, resource and selection cards. Painted terrain,
camera LOD, marker batching and frame pacing are view concerns and cannot alter
the domain map, travel speed or combat rules. Forest cover is shared map data;
the domain applies its movement cost, and the view models read that same field.

The movement grid is reused while its unit spatial revision is unchanged;
boarding and movement still refresh it before later queries. Avoidance uses
reusable dense live-unit scratch rows, and rollback coordinates are Float64
buffers indexed by tick ordinal rather than lifetime entity IDs. Melee approach
cache invalidation compares exact numeric facts instead of concatenated enemy
strings or collision-prone hashes. Trade requires the simulation's shared
spatial views instead of maintaining fallback grids.
The exact-route scheduler records each eligible cohort's FIFO head in one
queue scan per quantum, preserving player/caller rotation and priority rules.

Snapshot entity details (including ships and volleys) use versioned Float64
buffers and a per-packet string table. Optional and null fields remain distinct;
the decoder also accepts older object packets. Transferable buffers belong to
the packet, including copied road geometry, so worker transfers cannot detach
simulation state. Expansion metadata and players still use structured cloning;
this is not a claim that the entire message is zero-copy.

HUD projections are refreshed in place, displayed totals and queue/badge DOM
writes are guarded by value comparisons, and territory glyph widths are cached
at a reference font size and scaled during drawing. Font loading invalidates
those widths. The renderer targets 60 Hz regardless of population; achievable
frame rate remains dependent on the scene and hardware. Browser verification
is available at `tests/skirmish/browser/DebloatProfile.html` and the canonical
worker regression at `tests/skirmish/browser/P14Projection.html`.

`BuildingIndex` derives tile stacks, placement neighbors and completed income
from independently owned buildings. Land, held formations and naval units have
separate spatial query indexes. `CoastIndex` caches shore edges by both land and
water connectivity; current ownership is evaluated when selecting a meeting.

`PathTopology` supplies one passability and weighted-cost contract to exact A*
and HPA*. Maps above 65,536 cells prepare 32-cell cluster crossings during match
loading. Long terrain-only queries search sampled portals and refine their
paths into contiguous tiles. Group moves and AI raid cohorts share a corridor
with local connectors. Held soldiers remain dynamic local obstacles.

Background AI moves and route repairs use a deterministic FIFO budget of 24
squad requests per tick. A refreshed target keeps its queue priority, old paths
continue while waiting, and replacement orders invalidate stale repairs. Local
blocked-tile repairs stop after 2,048 expansions; the existing fine local-detour
solver is also bounded. Human commands retain synchronous, atomic validation.
The budget limits route requests rather than promising a fixed millisecond cost.

The worker sends transferable numeric squad/order buffers and tile/building
deltas. The decoder preserves previous snapshot values for interpolation and
inspection. No networking protocol has been introduced by this change.

Painted ground uses disposable 64-cell chunks and generated natural accents.
Ownership overlays and border paths update separately in changed chunks. Shared
gutter cells prevent ground seams. Strategic squad/ship markers use one WebGL2
instanced draw, with the canvas path retained for unavailable or lost contexts.
Detailed soldier animation stays on canvas. Large populations target 30 rendered
frames per second; small matches target 60. Simulation still targets 20 ticks
per second and is independent of those presentation targets.

## Validation and current limits

The review at `/build/review/world-expansion/report.html` records the local
measurements, conditions and screenshots. Full-population stress fixtures
restore casualties and mix crowded fleets with AI armies; they are not complete
multiplayer matches. The integrated 4,000-squad, 1,280-ship, 2,000-building trials
reach approximately 30 rendered FPS but currently miss the 20-tick simulation
target, particularly on 1000 × 500. Keep 500 × 250 as the default for playtesting.
Dense crowd movement needs further optimization before claiming smooth full
population gameplay or raising squad/faction caps again.

`Art/Terrain/painted-accents.png` is an unedited output from the built-in image
generation tool. Its prompt is saved beside it. No TWK third-party terrain
textures were redistributed. The runtime and new terrain art are included in
the corresponding-source archive.

## Imported heightmaps

Select **Mediterranean** in Battlefield and choose the desired World size.
The 8192 × 4096 source is baked into 250 × 125, 500 × 250, and 1000 × 500 variants.
The PNG stays unchanged. Browser loading uses small terrain-byte and calibrated
Float32 elevation assets, rather than decoding 33 million source pixels.

`HeightMaps/Mediterranean/import.json` records the source hash, generator URL, Regular
normalization bounds supplied by the user (-450 to 7819 metres), and provisional
terrain thresholds. Manticorp's Regular implementation scales to 65536, so height
is recovered as `-450 + sample / 65536 * 8269`; sea level corresponds to sample 3566. Source samples at or below that code are water candidates. Averaging only
the majority surface type in each destination cell keeps land and water heights
separate; exact ties become water. Border-connected water is ocean, while other
water remains lake. Small islands and narrow straits can disappear at coarse
resolution, so coast topology needs visual review at each size.

For this test, land below 600 metres uses plains speed, land from 600 to 1800
uses highland speed, and higher land uses mountain speed. Existing domain travel
and combat rules remain in place. There are no new uphill/downhill modifiers,
cliff barriers, elevation attack bonuses, or fog-of-war rules.

The skirmish-owned `ElevatedMap` adds an immutable `ElevationField` without
changing OpenFront's shared map contract. The worker reconstructs the same field
from the start message. `TerrainViewModel` supplies the metres readout. The view
precomputes disposable relief shades with a fixed upper-left light; its visual
exaggeration changes neither elevation nor route costs. Domain values never
depend on texture brightness, zoom, or browser image colour conversion.

Sea-level thresholding is not a water mask: below-sea-level dry land may become
water, while lakes above sea level and rivers may be absent. The source also has
visible block artefacts near the Caspian region. Importing preserves those source
limitations. Accurate hydrology will need an independently aligned water mask.
Africa's current review supplements sea-level classification with geographically
registered Natural Earth major river lines; see `MapReview.md` for provenance,
gameplay widths and remaining lake/stream limitations. Calibrated heights remain
unchanged when inland river cells become water.
The generator's Regular upper endpoint can wrap to zero when written as a u16;
majority-area sampling limits isolated bad-pixel effects, without repairing or
resaving the original heightmap. Heights are calibrated from the reported export
bounds, not certified geographic measurements.

To rebake after verifying new source settings:

```text
python -m pip install -r scripts/heightmap-requirements.txt
python scripts/importSkirmishHeightmap.py "HeightMaps/Mediterranean/import.json"
python -m unittest discover -s tests -p heightmap_import_test.py
```

The input hash must match before importing. The map footer links the generator's
Mapzen/Nextzen attribution guidance. The corresponding-source archive includes
the original source, import configuration, authoring tool, requirements, and
baked map assets.

## Earth terrain accents

The approved 48-sprite Earth library replaces the original four-accent atlas in
the skirmish. The heightmap export's Mercator footprint supplies latitude;
elevation, baked albedo moisture where available, procedural fallback, and coast proximity guide approximate biome
placement. Other maps use a temperate baseline until their projection is known.
These are provisional environment rules, not measured rainfall, forest coverage,
or hydrology. Original PNGs, elevation samples, and terrain bytes stay unchanged.
Forest cover now adds a movement cost; combat rules are unchanged.

Small silhouettes retain their authored 1.05–2.1-cell size. Deterministic placement
is cached in bounded terrain chunks, with detailed accents hidden at distant
zoom. As soon as a building is placed, every terrain cell touched by its world
footprint is cleared, including overlapping neighboring-tree silhouettes. Same-type stacks clear one
site, ownership changes keep it clear, and unchanged building snapshots do not
invalidate terrain chunks. See `docs/EarthTerrainArtLibrary.md` for the architecture,
limitations, and future real-biome import contract.

## Continuous forests

Mediterranean has a blended western-European vegetation profile, authored in
`resources/maps/heightmap-test1/climate.json`: Germany, France and northern Spain
receive greener woodland ground and more continuous stands. This profile is
approximate; it preserves the calibrated height field and does not alter other
maps. Mountain eligibility and open clearings still apply.

The Mediterranean demonstration now also bakes its registered colored satellite
image into smooth moisture, vegetation and aridity fields. Green/brown gradients
guide continuous ground colors and shared forest cover; biome families guide
terrain accents. This is approximate color interpretation, with height and water
authority preserved. Africa uses its supplied satellite albedo with an Africa-only
1.1 green sensitivity review setting; Mediterranean retains its original settings.
The converter, registration limits and map approval queue are documented
in `docs/MapReview.md`.

`EnvironmentProfile` supplies approximate latitude/elevation/moisture/coast
inputs. `ForestGeneration` builds a deterministic byte-per-cell cover field:
warped broad stand noise, smaller edge variation, and a separate clearing field.
Woodland, conifer, and rainforest families can become dense; dry woodland and
scrub stay sparse. Deserts, open steppe, alpine ground, tundra, ice and water do
not acquire forests. This baseline can be replaced by an aligned cover dataset
without changing recruitment, commands, rendering, or the art catalog.

`SkirmishMap` owns immutable natural cover and a `ForestField` building-clearance
overlay. Both are separate from the elevation/terrain samples. The loader sends
the cover DTO to the worker; the view mirrors building occupancy from snapshots.
All land troop types use `round(base terrain speed * (1 - 0.4 * cover))` before
their existing type modifiers. Dense forest reduces movement by up to 40%; clear
land uses the existing terrain tier. The terrain hover readout shows effective
speed, forest cover and the forest penalty. Ships and combat damage are unchanged.

Exact A* and HPA* read the same effective speed. Construction updates costs in
cleared cells and retires cached crossing trees only in affected 32-cell HPA
clusters. Connectivity is unchanged. Starting barracks clear ground before HPA
warming. Existing routes remain valid; new route queries use the changed costs.
Same-type building stacks occupy one ground site; tile capture keeps it clear.
The overlay supports restoring natural cover if a site is removed, but gameplay
currently has no building-demolition or forest-regrowth command.

Canopy-only sprite pools follow the cover field, using dense artwork inside
stands and open artwork at edges. Small staggered/jittered anchors overlap at
roughly 1.15-cell spacing while retaining the 2.1-cell maximum silhouette. Low
rocks and understory accents are concentrated on open ground. Woodland ground
is darker even at distant zoom. The decoration query index uses 16-cell buckets;
art is still cached in bounded 64-cell chunks under buildings and units.

The forest review lives at `/build/review/forests/index.html`. Map-preparation
and clearance timings are separate from browser FPS and full-population match
performance. The earlier 4,000-squad stress results were measured before this
forest change; they do not establish its full-population performance.

## Tribes and home territory

Browser skirmishes enable 10, 20 or 40 tribes based on the actual map extent,
independently of regular faction count: 250×125, 500×250 and 1000×500 maps use
those respective counts. Legacy maps use their actual dimensions, with tier
boundaries halfway between the supported extents. One human and 19 regular AI
on the largest map deploy 40 tribes, for 60 hostile factions and 280 starting
squads. The regular faction cap remains 20
and the regular squad cap remains 200. `MatchOptions.tribes` explicitly enables
minor factions; isolated domain fixtures can omit it.

Tribes begin with a radius-three camp, a completed barracks and five infantry
squads. The domain enforces their ten-squad limit across all recruits, including
embarked squads. They earn existing reserve income, reinforce damaged squads
and rebuild losses from reserves at their owned camp. They do not develop an
economy or navy. Their expansion has no radius limit: they keep filling gaps and
extending the connected frontier nearest their starting camp, approximately in
outward rings. They intercept nearby enemies and invading squads on their land,
and abandon distant pursuit outside their land. Tribes participate in victory.

Regular AI prioritizes gaps and frontier land connected to its starting camp.
`HomeTerritory` caches that connected frontier for at most three seconds, ranks
it by distance from home, and spreads goals among squads. Disconnected outposts
do not seed further exploration. Nearby combat and camp recovery still take
priority. Once the local home area is consolidated, an army of at least eight
squads can commit one quarter to raids after the first minute; remaining squads
continue consolidation. Tribes share the same commands, navigation and combat.

`StartingPositions` maintains incremental camp clearance rather than repeatedly
comparing every candidate with every earlier camp. It places regular camps
first, then tribes, preserves non-overlapping initial land and reports insufficient
space explicitly. Every owner ID has a presentation color. The new startup
and AI checks do not establish 30 FPS at maximum population.

## Automatic shore transport

Cargo Canoes unlocks free temporary transports from any reachable shore, without
a port. A normal land move order coordinates approach, embarkation, real water
navigation, landing and onward movement. Transport hull research supplies
10 / 12 / 14 / 16 / 18 / 20 / 25 whole-squad capacity; larger selections split
into groups. Age advancement alone does not unlock a hull. Port-built permanent
transports use the same base capacities but retain their purchase/port rules.

`ShoreRoutes` owns static land/water component connectivity and coast candidates.
`ShoreTransport` owns transfer phases and atomic route planning. `Skirmish`
provides existing physical movement, boarding, landing, combat and formation
placement; the renderer consumes phase/capacity projections. No MVVM/DDD
exception or parallel movement simulation is introduced. Internal routes/queues
are excluded from presentation snapshots. A future recovery checkpoint must
include these authoritative states rather than using presentation snapshots.

Temporary transports cannot be manually sailed, stopped, refitted or reused.
They disappear after landing, remain vulnerable during the voyage and preserve
queued squad moves and army membership. Dynamic blocked/occupied landing areas
wait for safe placement. Candidate land/water travel costs allow faster river
crossings even with connected banks, without claiming globally optimal routing.

## Conquest and territory inheritance

A faction is defeated only after it has no buildings and no squads, including
embarked squads. Taking its original camp is insufficient while another building
or squad remains. The faction completing the defeat receives every remaining
owned cell in the same fixed simulation step. Building stacks all change owner
with their occupied tile, and buildings under construction count too. Other
attackers retain territory and buildings they already captured.

`ConquestCredit` records the last building capture and lethal combat batches.
If multiple factions deliver simultaneous lethal damage, the highest combined
damage contribution to the killed units wins credit; equal contributions resolve
by lower faction ID. Sinking the final embarked defenders' transport awards credit
to its naval attacker. Empty ships do not block land-faction defeat and are removed,
as before. Remaining reserves stay in the eliminated faction's accounting.

Terminal eligibility is evaluated for the entire batch before inheritance. Credit
follows any simultaneously defeated conqueror to its surviving conqueror; cycles
or extinction return the remaining land to neutral. Ownership counts, capture
overlays and snapshot deltas update through the domain's ownership transition.
The renderer adds no special flood-fill or cosmetic ownership correction.
