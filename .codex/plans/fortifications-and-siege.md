# Fortifications, walls, and siege

Status: design draft. Updated September 30, 2026.

Related plans: [technology](tech-tree-and-cultures.md), [strategic resources](strategic-resources.md), [diplomacy](diplomacy-and-alliances.md), and [pacing](pacing-and-opening.md).

## Confirmed direction

AI integration is required in the same optimization/army push. The [AI defensive construction plan](<optimization and ai improvement/ai-defensive-construction.md>) specifies protected-site selection, complete tower/link/gate quotes, staged construction, access checks, supporting forces, repairs and Modern counters. AI uses these shared fortification rules; it cannot invent free walls or alternate gate/navigation permissions.

- Add a placeable defence building that is a tower.
- Towers automatically shoot arrows at hostile ground troops passing within their legal firing range. They do not target ships, aircraft, strategic missiles, civilian traders or allied/friendly troops.
- Placing another tower close enough creates a wall between towers.
- Players can use the links to enclose cities and other sites.
- Towers/walls are unlocked and improved through the technology tree through Early Modern. Modern adds gun nests and trenches as its replacement defensive tier; existing older walls remain usable without automatic conversion.
- Ordinary troops can destroy fortifications slowly.
- Siege weapons exist in every age and breach defences more efficiently without requiring infantry to perform the damage.
- Betrayal makes the betrayer's walls weaker and territory easier for enemies to capture.

## Difference from OpenFront

OpenFront has a Defence Post and configuration for defensive effects. It is a useful reference for a placeable defence structure, not an existing tower-link wall implementation. Reviewed sources: [configuration](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/configuration/Config.ts) and [Defence Post execution](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/execution/DefensePostExecution.ts).

The current skirmish exposes DefenceZone movement slowdowns. A slowdown is not a wall: the new system must represent barriers in navigation, attack eligibility, and capture. Painting connecting lines over the map would be a presentation-only implementation and would fail the requested behaviour.

## Existing wall kit and researched tiers

The user confirmed the kit's Stone/Bronze/Classical mapping. These are existing counted unlocks, not additional technologies:

| Age            | Technology                    | Verified art family                                                       |
| -------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Stone          | S-W4 Field Engineering        | Art/Terrain/Wall Kit/Palisades                                            |
| Bronze         | B-W4 Fortified Settlements    | Art/Terrain/Wall Kit/StoneWalls                                           |
| Classical      | C-W4 Masonry Engineering      | Art/Terrain/Wall Kit/MassiveStoneWalls                                    |
| Early Medieval | EMed-W4 Trebuchet Engineering | Wall upgrade remains planned; a distinct tier is not present in this kit. |

The [kit guide](<../../Art/Terrain/Wall Kit/README.md>) specifies sixteen cardinal masks per tier, an independent tower sprite, one-cell footprint and matching centre pivots. The wall is rendered first and the tower over it. Its connection masks describe presentation; the authoritative wall graph still defines blocking/construction/cost.

Art supports cardinal segments only. A proposed tower connection must resolve into an authored valid cardinal path or require additional art; do not stretch/rotate these tiles to imply unprovided diagonal spans. Cross-tier transition sprites and gates are not included. Do not infer a free tower entity from a corner decoration or make mixed-tier connectors seamless without a defined transition.

## Tower-link model proposed for the wall ages

Towers and wall segments are domain entities with stable IDs, owner, construction state, material/tier, and integrity. A segment references two towers and a defined footprint between them. The renderer observes that footprint; it does not invent the connection.

A placement preview should show:

- Valid tower position and its cost/time.
- Arrow weapon range and usable hostile-ground firing coverage, distinct from the wall connection preview.
- Eligible nearby towers and the wall segments that would be created.
- Any blocked connection, terrain restriction, or extra wall cost.
- Whether the intended enclosure remains accessible.

Only compatible, completed, same-owner towers create usable links. Connections should validate range, intervening terrain, buildings, crossings, and existing barriers. The exact connection distance and whether a new tower links to one or several neighbours remain open.

Do not blindly connect every tower within range. Dense automatic links can cut across a city, trap traders, or generate unintended overlapping walls. Recommend automatic candidate links with clear preview and a way to choose or disable individual links; that UI detail needs agreement.

Tower and connecting-wall construction must have a defined payment rule. A free unbounded wall based only on tower placement can favour the longest possible segments. Proposed cost is tower cost plus length/material-based wall cost, reserved/spent consistently with the placement command. Exact pricing is open.

## Tower arrow attacks

Arrow attacks are a confirmed tower capability bundled into each existing tower unlock, not an additional technology. A completed living tower automatically acquires eligible hostile ground combat units in range and fires on its own simulation-tick reload schedule. Retained older towers keep their original definition/weapon after faction age advancement; new Modern defences remain gun nests/trenches rather than an automatic tower conversion.

Author a ranged arrow attack profile per tower tier: damage, range, reload, accuracy, target tags, projectile speed/size and any penetration/bonuses. Arrows normally have zero blast radius as a proposal. Apply the target's Ranged Armour/cover through the shared combat policy. Damage and reload are not inferred from a wall's integrity, a defence slowdown or the arrow animation. Exact values, ammunition/crew rules and firing-over-wall/elevation policy remain open; this note grants no new garrison or weapon-production requirement implicitly.

Use the existing spatial index and a deterministic bounded target policy, proposed nearest eligible threat with stable-ID ties. Recheck hostility, target domain, range and firing eligibility at the appropriate fire/impact stages. Construction, destruction, capture and treaty changes invalidate attacks; they do not reset reload to grant extra shots. No attacks while incomplete or destroyed, and no automatic replenishment of tower health from firing.

Share a defensive-weapon execution path with gun nests, using definition-specific profiles and source state rather than copying a separate AI-only damage loop. Firing/impact belongs to the domain; snapshots and animations display committed events. Use domain-qualified source identity so a tower ID cannot award damage XP or conquest credit to an unrelated squad with the same numeric ID. Tower promotion is not introduced by this rule.

Firing-origin and obstruction need deliberate integration. Current `Fortifications.clear` tests the starting tile, while tower tiles are themselves blocked; applying it unchanged would make a tower block its own arrows. Exclude the source's own footprint through the shared weapon-origin policy while retaining terrain/other-barrier checks. Whether elevated tower arrows clear attached walls needs an explicit shared height/arc policy; do not bypass all friendly walls or all barriers just to enable fire. Placement previews and AI scoring must use the same legal firing result.

For AI layouts, score marginal usable arrow coverage over approaches, crossings and gates alongside wall delay, supporting troops and real cost. Range circles alone cannot prove a shot is legal or that several towers add useful coverage. Siege remains an efficient counter, and armour must keep obsolete arrows from becoming an unscaled answer to every later ground unit.

Validate moving enemies entering/leaving range, armour/cover, blocked and self-origin paths, paired/overlapping towers, incomplete/destroyed/captured towers, treaty expiry/betrayal, reload preservation, target death, source attribution, retained older towers and bounded work across many AI layouts. Ground-only targeting must reject ships, aircraft, strategic projectiles and civilians even when nearby.

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

## Modern gun nests and trenches

Gun nests and trenches are the confirmed replacement for new Modern walls; proposed placement is M-W2 Combined Arms. Older walls remain separate usable entities with their existing blocking/gate rules. Empire advancement neither destroys them nor changes their definitions. Availability of new older-tier wall construction, repair and explicit refits remains a lifecycle policy to settle.

A trench is a defensive position with authored cover, occupancy, access and damage rules. It must not inherit wall impassability merely because it occupies the same research role. Whether troops, traders and vehicles can cross or enter it needs an explicit movement policy. Proposed gun nests are fixed defensive weapon positions with independent targeting and attack profiles; firing arcs, crew requirements, joining trenches, capture and destruction are still to be authored.

Recommend shared construction/ownership/integrity services with separate Barrier, CoverPosition and DefensiveWeapon capabilities. Shared navigation queries consume the actual obstacle policy; combat queries the actual cover/weapon policy. Do not implement this by giving the existing wall entity a new Modern texture. [The Modern plan](modern-defences-and-strategic-weapons.md) records anti-air and MIRV integration alongside these defences.

## Research and resource progression proposal

Fortifications and siege belong principally in Warfare; Economic supplies extraction/refining/production improvements. Research prerequisites must still preserve the two-tree advancement condition.

| Age            | Fortification direction                  | Siege direction               | Material direction                                   |
| -------------- | ---------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| Stone          | Wooden watchtowers and palisade links    | Field/battering ram           | Timber abstracted initially; stone where available   |
| Bronze         | Stone walls and round towers             | Battering ram / assault tower | Stone and bronze fittings                            |
| Classical      | Massive stone walls and square bastions  | Mangonel / heavy Onager       | Stone and iron fittings                              |
| Early Medieval | Improved masonry and gates               | Ballista / Trebuchet          | Stone and iron                                       |
| Late Medieval  | Stronger walls and defensive engineering | Organ Gun / Bombard           | Stone, steel, early gunpowder                        |
| Early Modern   | Gunpowder-era fortifications             | Field cannon / Early Howitzer | Stone, steel, and gunpowder                          |
| Modern         | Gun nests and trenches                   | Modern Howitzer               | Steel, gunpowder/munitions, and oil where applicable |

These are proposed gameplay themes, not historical claims or completed art contracts. Existing siege facility art begins at Bronze. The newly delivered Weapon Icons pack supplies twelve post-Stone field-artillery/siege animation proposals, including assault towers, catapults, trebuchets and gunpowder pieces. Stone siege still needs art. Stone/Bronze/Classical wall/tower art now exists; gates, construction/breach states and later wall tiers remain outstanding. Modern gun-nest/trench art is announced and unverified. See [the current art audit](base-tech-tree-art-audit.md) for exact placement; this does not establish runtime weapon or assault-tower behaviour.

The four-node Stone Warfare draft uses Field Engineering for the first tower/wall/gate and siege capabilities. Later ages bundle field-artillery capabilities with the ranged branch and dedicated siege with the final Warfare node. This gives every age a siege answer within the proposed advancement workload. If four nodes prove too compressed, a larger tree requires a deliberate progression rebalance.

## Betrayal weakness

The alliance plan specifies the OpenFront timing baseline: a 30-second betrayal window. Proposed initial tuning is enemy capture time at 80% of normal and wall damage resistance at 50% while the owner is marked as a betrayer.

Apply wall weakness as a temporary combat modifier, not by halving current stored integrity. Once the status expires, normal resistance returns without healing damage already sustained. Towers are not automatically included in the wall-specific penalty unless that scope is agreed.

The penalty must apply to all affected walls owned by the betrayer, including retained older walls in Modern and ones built during the window. Gun nests/trenches have no automatically inherited wall penalty: whether betrayal reduces their protection or effectiveness needs explicit agreement. It is not local to the clicked tower or the former ally's border.

## Validation and review

Validate placement/link determinism, invalid crossings, dense tower layouts, gate access, enclosed trader routes, allied protection, both types of destruction, navigation invalidation, capture through barriers, repairs, temporary betrayal modifiers, retained walls after Modern advancement, trench crossing/cover/occupancy and gun-nest targeting.

Playtest ordinary-troop breach time against same-age siege and the logistics cost of enclosing a city. No invulnerable wall, free instant repair, or unavoidable trader enclosure should survive review.
