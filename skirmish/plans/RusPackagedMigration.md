# Rus packaged progression: normal skirmish migration

Normal skirmish now uses the saved `russians-rus-eight-age-rework` civilization from `technology-plan.json`: 125 research packages and 42 troop definitions. The other planner civilizations remain available as design references.

## Content and progression

- The runtime prerequisite graph matches the saved draft, including the edited nuclear and Modern missile infrastructure dependencies. Compilation rejects unsupported package names and unrecognized building folders.
- Reaching the next age still requires two **complete** current-age branches. Specialist side branches count toward their branch; there is no hidden waiver.
- Research costs and times use the Base civilization's existing tier/role pattern. Napoleonic and Pre-modern align with the corresponding Base eras; the eighth tier extrapolates the final Base tier by 25%, rounded to whole-second research durations. Existing age-up prices and durations are retained.
- Cities can be built immediately. Stone Age Settlement Administration is a statistical improvement: 10% city health, reserve income and receiving capacity (integer rounding applies).
- Packaged building research automatically updates existing eligible buildings, preserving their damage ratio. New construction uses the latest researched tier; obsolete cheap construction cannot bypass tier costs.
- Road upgrades govern physical road generation. Land trader upgrades govern trader tiers/cargo and horse breeding. Port tiers improve receiving capacity, cargo stock, health and both land/sea cargo per trip. Modern fleet improvements also apply to existing submarines and older ships.
- Troops, equipment recipes, ships, resource extraction, production and building gates resolve to the same canonical packages. Removed individual unlock tolls do not remain as hidden prerequisites.

## Air and strategic operations

| Action | Key | Behavior |
|---|---|---|
| Dispatch | I | Fighters patrol the target area and engage hostile fighters/bombers. |
| Bombing Run | P | Conventional bomber attack. |
| A-Bomb Run | O | Bomber attack using one manufactured atomic payload per bomber. |
| Drone Strike | U | Slower, single-use drone attack; currently cannot be intercepted. |

Shift orders up to five eligible aircraft. The targeting cursor quotes the greatest travel percentage among the aircraft selected for that order; orders beyond remaining flight time are rejected by both client and authority. Return travel consumes no additional flight time and remains vulnerable to interception. Ready aircraft refill at home.

| Class | Pre-modern flight time | Modern flight time | Movement per tick |
|---|---:|---:|---:|
| Fighter | 180 seconds | 240 seconds | 180 fixed units |
| Bomber | 120 seconds | 180 seconds | 180 fixed units |
| Drone | unavailable | 120 seconds | 90 fixed units |

Modern Airfields upgrades fighter and bomber endurance. Bombers retain their separate research branch. Airstrips remain 2x2. Air capacity remains six aircraft per launch site and 32 per faction.

Atomic payloads are manufactured at the nuclear facility with actual steel/gunpowder/oil consumption. Atomic attacks use the existing hydrogen artwork, with a 24,000-damage, 16-cell blast. Drones cost 3,000 gold and inflict a 10,000-damage, three-cell blast; these are editable first-pass balance values. Strategic blasts affect friendly and hostile targets.

Submarines currently use ordinary warship combat. Modern naval air defence fires homing rockets against hostile aircraft. Ground anti-air emplacements share the air-defence weapon. Neither intercepts drones.

Supplies moved to **L** and building upgrades/refits to **Ctrl+U**, avoiding collisions with the new mission keys. Technology remains **Y**.

## AI

AI research scores the remaining paid prerequisite closure for pairs of age-up branches and for useful future military capabilities. It can buy prerequisite packages even when their own immediate recruitment benefit is small or current army capacity is full. Air/strategic decisions use the existing staggered planning pass and bounded candidate target lists, with squared-distance flight-budget checks. Payload production and recruitment consume normal resources.

## Verification and limits

- The final migration validation run passes **37 files / 395 tests**, including exact saved-DAG matching, city upgrades, air operations, payload consumption, drone immunity, naval rocket cooldown snapshot persistence, trade unlocks, research pacing and multiplayer join/reclaim.
- The production build passes. A headless Chrome normal-skirmish smoke shows each I/O/P/U targeting mode with no page errors. The earlier Modern troop rendering smoke loaded the runtime assets and verified the icon/detail LOD cutoff.
- A supplied-resource AI progression sandbox reaches Modern through paid research and age advancement. This checks dependency routing, **not** live-match economy balance or a long soak.
- The earlier full-suite run was not green. Many old unlock fixtures have since been migrated and rerun, but the entire suite has not been rerun after those updates; older detached-research/paid-building-upgrade expectations and art/demo fixtures still need review.
- TypeScript validation is blocked by the missing source-art Javelinist manifest referenced by `tests/skirmish/TroopVolley.test.ts`; the runtime artwork smoke passes. This migration does not restore deleted authoring assets.
- Drone art remains a labelled aircraft silhouette until a dedicated sprite/animation set is supplied.

The new content hash identifies this catalogue and combat revision. Start a fresh match when reviewing this migration; old replay/checkpoint content revisions are not silently rewritten. No deployment is included.
