# Fortifications, walls, and siege

Status: design draft. Updated September 30, 2026.

Related plans: [technology](tech-tree-and-cultures.md), [strategic resources](strategic-resources.md), [diplomacy](diplomacy-and-alliances.md), and [pacing](pacing-and-opening.md).

## Confirmed direction

- Add a placeable defence building that is a tower.
- Placing another tower close enough creates a wall between towers.
- Players can use the links to enclose cities and other sites.
- Towers/walls are unlocked and improved through the technology tree.
- Ordinary troops can destroy fortifications slowly.
- Siege weapons exist in every age and breach defences more efficiently without requiring infantry to perform the damage.
- Betrayal makes the betrayer's walls weaker and territory easier for enemies to capture.

## Difference from OpenFront

OpenFront has a Defence Post and configuration for defensive effects. It is a useful reference for a placeable defence structure, not an existing tower-link wall implementation. Reviewed sources: [configuration](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/configuration/Config.ts) and [Defence Post execution](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/execution/DefensePostExecution.ts).

The current skirmish exposes DefenceZone movement slowdowns. A slowdown is not a wall: the new system must represent barriers in navigation, attack eligibility, and capture. Painting connecting lines over the map would be a presentation-only implementation and would fail the requested behaviour.

## Tower-link model proposed

Towers and wall segments are domain entities with stable IDs, owner, construction state, material/tier, and integrity. A segment references two towers and a defined footprint between them. The renderer observes that footprint; it does not invent the connection.

A placement preview should show:

- Valid tower position and its cost/time.
- Eligible nearby towers and the wall segments that would be created.
- Any blocked connection, terrain restriction, or extra wall cost.
- Whether the intended enclosure remains accessible.

Only compatible, completed, same-owner towers create usable links. Connections should validate range, intervening terrain, buildings, crossings, and existing barriers. The exact connection distance and whether a new tower links to one or several neighbours remain open.

Do not blindly connect every tower within range. Dense automatic links can cut across a city, trap traders, or generate unintended overlapping walls. Recommend automatic candidate links with clear preview and a way to choose or disable individual links; that UI detail needs agreement.

Tower and connecting-wall construction must have a defined payment rule. A free unbounded wall based only on tower placement can favour the longest possible segments. Proposed cost is tower cost plus length/material-based wall cost, reserved/spent consistently with the placement command. Exact pricing is open.

## Enclosures need gates and navigation

A closed city wall also blocks friendly deliveries unless it has a passable gate or an explicitly defined friendly passage rule. Gates are a necessary access design, not decorative trim.

Recommend explicit gate segments or a gate conversion action. Ownership/diplomacy determines passage. Ordinary walls must not become passable merely because an army is friendly; gate access is the permission boundary. Automatic gate-opening, close orders, trader access, and allied gate permissions are still to be settled.

A real barrier must affect movement while under the chosen usable construction state and cease blocking when breached. Navigation needs a shared, versioned obstacle/topology view for soldiers, cavalry, siege, land traders, and resource access. New construction or destruction invalidates affected paths with bounded rerouting.

Do not rebuild the entire map's path graph every tick or create one different wall interpretation per unit system. Keep permanent terrain navigation separate from dynamic barriers while sharing authoritative reachability decisions.

Capture checks need the same barrier information. The current radius-based capture must not claim a city/tower through an intact enclosing wall simply because a soldier is nearby outside it.

## Integrity, combat, and lifecycle

Proposed rules:

- Give towers and segments separate integrity; attacking a segment can open a local breach.
- Ordinary melee attacks reduce integrity slowly, with clear approach positions and attack state.
- Siege definitions have high structure damage, defined range/line-of-fire, and low effectiveness or vulnerability against mobile forces as appropriate.
- Siege can breach without an accompanying melee formation. Whether siege can capture territory is a separate capability, not implied.
- Destroying a tower invalidates its dependent links; define which segments collapse, remain, or become ruins. Recommend losing their blocking effect initially.
- Destroyed segments create a navigable gap. Rebuilding requires explicit construction; nearby towers cannot immediately regenerate a free full-health wall.
- Construction, repair, upgrade, capture, and destruction each produce consistent navigation and presentation changes.

The old ordinary-building tile-capture rule cannot be applied uncritically to intact fortifications. Otherwise a tower could change owner before enemies perform the intended slow destruction. Define destruction versus capture explicitly for defensive structures; the initial recommendation is breach/destruction before hostile replacement.

Automatic tower fire is not specified by the user. If towers attack, author their target types, range, attack rate, and allied exclusions. Do not assume every era tower has OpenFront's weapon behaviour.

## Research and resource progression proposal

Fortifications and siege belong principally in Warfare; Economic supplies extraction/refining/production improvements. Research prerequisites must still preserve the two-tree advancement condition.

| Age            | Fortification direction                  | Siege direction       | Material direction                                   |
| -------------- | ---------------------------------------- | --------------------- | ---------------------------------------------------- |
| Stone          | Wooden watchtowers and palisade links    | Field/battering ram   | Timber abstracted initially; stone where available   |
| Bronze         | Reinforced towers and stronger links     | Reinforced ram        | Stone and bronze fittings                            |
| Classical      | Masonry towers and walls                 | Catapult              | Stone and iron fittings                              |
| Early Medieval | Improved masonry and gates               | Improved ram/catapult | Stone and iron                                       |
| Late Medieval  | Stronger walls and defensive engineering | Trebuchet             | Stone and steel components                           |
| Early Modern   | Gunpowder-era fortifications             | Cannon                | Stone, steel, and gunpowder                          |
| Modern         | Modern defence positions/barriers        | Modern artillery      | Steel, gunpowder/munitions, and oil where applicable |

These are proposed gameplay themes, not historical claims or completed art contracts. Existing siege facility art begins at Bronze; Stone siege and the tower/wall/gate assets require additional art.

For the four-node Stone Warfare draft, replace Warband Organisation with Field Engineering to unlock the first tower/wall and siege capabilities. This avoids adding required nodes accidentally while giving every age access to a siege answer. A larger Warfare tree is still possible if four nodes prove too compressed; that must be a deliberate progression rebalance.

## Betrayal weakness

The alliance plan specifies the OpenFront timing baseline: a 30-second betrayal window. Proposed initial tuning is enemy capture time at 80% of normal and wall damage resistance at 50% while the owner is marked as a betrayer.

Apply wall weakness as a temporary combat modifier, not by halving current stored integrity. Once the status expires, normal resistance returns without healing damage already sustained. Towers are not automatically included in the wall-specific penalty unless that scope is agreed.

The penalty must apply to all affected walls owned by the betrayer, including ones built during the window. It is not local to the clicked tower or the former ally's border.

## Validation and review

Validate placement/link determinism, invalid crossings, dense tower layouts, gate access, enclosed trader routes, allied protection, both types of destruction, navigation invalidation, capture through barriers, repairs, and temporary betrayal modifiers.

Playtest ordinary-troop breach time against same-age siege and the logistics cost of enclosing a city. No invulnerable wall, free instant repair, or unavoidable trader enclosure should survive review.
