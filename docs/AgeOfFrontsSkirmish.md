# Expanded skirmish

World defaults to 500 × 250 terrain cells. The match controls also offer the
classic 250 × 125 and large 1000 × 500 variants. Movement speed remains measured
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

The fixed-step domain owns orders, movement, capture, costs, income and combat.
AI and human commands use the same domain validation. View models project the
domain snapshot into recruitment, resource and selection cards. Painted terrain,
camera LOD, marker batching and frame pacing are view concerns and cannot alter
the domain map, travel speed or combat rules. Visual forests are decorative;
OpenFront's original plains, highlands and mountains still determine speed.

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
