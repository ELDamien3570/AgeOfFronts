# Modern defences, anti-air and MIRV weapons

Design draft, September 30, 2026. Confirmed scope is distinguished from proposed placement and mechanics. Connected plans: [base tree](base-tech-tree.md), [fortifications](fortifications-and-siege.md), [combat](combat-and-promotions.md), [resources](strategic-resources.md), [UI](ui-materials-and-technology.md) and [diplomacy](diplomacy-and-alliances.md).

## Confirmed additions

- Modern uses gun nests and trenches as its replacement defensive tier.
- Older walls remain usable. Modern advancement does not automatically convert them.
- MIRV buildings are fixed launchers and MIRV vehicles are mobile launchers for missiles with multiple warheads.
- Anti-air vehicles target aircraft only. ICBM/MIRV missile and warhead interception belongs to separate missile defence.
- These additions are design scope; new art does not establish simulation implementation.

## Proposed research placement

| Existing technology      | Additional capabilities                                                          | Production boundary                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| M-W2 Combined Arms       | Gun nests, trenches, anti-air vehicles/equipment                                 | Defence construction and vehicle recruitment have separate costs, jobs and definitions. |
| M-W4 Strategic Weapons   | Dedicated fixed MIRV building, mobile MIRV vehicle, MIRV carrier/payload pattern | Launcher creation, payload manufacture and launching are distinct.                      |
| Separate missile defence | Placement still to settle                                                        | Do not advertise anti-air vehicles as a strategic interception answer.                  |

The Modern additions are bundled into existing nodes. With the later Bronze Armies addition, the catalogue now has 85 counted technologies; Modern Warfare still has four. Research still costs only gold; construction, recruitment, payloads and operations require their separately authored recipes. No extra mandatory subresearch is implied. Combined Arms provides anti-air access without requiring a player to research or construct their own aviation first.

Modern Warfare is now a large bundle. Its four-node count preserves the current research budget, but does not establish balanced access or an achievable eight-minute endgame. Measure construction, deployment, payload production and combat together. If these systems warrant separate counted nodes, change slot structure and pacing explicitly.

## Defences need different capabilities

Keep reusable construction, ownership, integrity and capture services. Distinguish an impassable Barrier from a CoverPosition and a DefensiveWeapon. An older wall can remain a barrier in a Modern match while a newly constructed trench follows its own crossing and occupancy policy.

Proposed trenches protect eligible occupying formations through a contextual cover modifier. Exact cover strength, capacity, entry/exit, vehicle/trader crossing, suppressive effects and blast vulnerability remain open. Their rendered footprint must follow a domain placement definition, not create navigation implicitly.

Proposed gun nests are fixed defensive weapon positions. Author target classes, range, reload, line of fire, arc if used, crew/occupancy, capture and destruction. Whether placing nests automatically links trenches is open; do not copy the old tower-to-wall rule silently.

Existing walls retain their earlier behaviour. New older-tier construction, repair and explicit conversions need a lifecycle policy; there is no automatic conversion on age advancement. The existing wall-specific betrayal penalty continues to affect retained walls. Applying it to trench cover or gun-nest effectiveness needs separate agreement.

## Anti-air is aircraft combat

Use an explicit aircraft target capability for anti-air vehicles. Their attacks cannot target strategic carriers or warheads merely because those objects are airborne. Missile defence has its own eligible projectile families, interception timing and capacity.

Proposed recruitment uses the researched vehicle depot and an Arms Factory equipment pattern. Anti-air and mobile MIRV units follow the post-Stone manufactured-equipment requirement. Exact armament, structural steel, oil and reserve quantities remain open; the confirmed tank recipe is not automatically the recipe for every vehicle. Likewise, targeting aircraft does not automatically grant ground attack, radar, shared vision or immunity to tanks.

## MIRV launchers, payloads and flight

The fixed building and mobile vehicle are separate launcher definitions, referencing a shared compatible payload/flight family. Do not merge the launcher into its fired projectile. Existing ICBM silo and hydrogen payload capabilities remain distinct.

Proposed payload manufacture conserves strategic inputs and produces finite inventory. Construction or recruitment does not create free replenishing missiles. Launch validation reserves/consumes payload once and follows an explicit failure/refund policy. Loader location, payload replenishment and physical military transport are not yet specified.

The mobile launcher needs authored movement, deployment, firing, reload and interruption states. Recommend an observable deployment period before launch so mobility has a tactical cost, with cancellation and relocation rules to agree. Do not hard-code that recommendation as an approved duration.

A MIRV carrier references a finite warhead set. Define split timing, permitted targets or spread, child projectile paths and one impact event per surviving payload. Projectile Size and Blast Radius remain separate on the appropriate projectile/payload definitions. Do not add full parent explosion damage to every child by default or duplicate an entire payload on capture/reload.

Bound warhead count, spatial queries and event work. Preserve deterministic ownership, targeting, diplomacy and event IDs across launch, splitting, interception and impacts. Aircraft-only anti-air cannot consume these strategic-projectile events. Separate missile defence must specify whether it engages carriers, individual warheads or both.

Costs, warning time, blast limits, launch cadence, friendly fire, allied targeting, ownership changes and victory effects remain to be authored. MIRV counterplay is an implementation gate: missile defence is confirmed separate, but its research placement, coverage and interception limits are not settled.

## Existing source and architecture boundary

The inherited OpenFront game already contains [MIRV execution](../../src/core/execution/MIRVExecution.ts) and [unit/projectile types](../../src/core/game/Game.ts), including strategic projectile and SAM categories. This is source evidence, not proof that the independent skirmish implements these additions.

Review compatible policies, then integrate through the skirmish domain. Do not directly copy the legacy MIRV's warhead count, economic scaling or territory-damage model into the hour-long troop/material economy.

No MVVM or DDD departure is needed. Domain definitions own target eligibility, cover, launcher/payload compatibility and flight states; application commands validate placement, recruitment, deployment and launch. Snapshots expose allowed state to ViewModels; views render previews/cards and dispatch intent. Keep payload splitting and damage out of the renderer and left-card code.

## Verification before implementation is called complete

Verify retained-wall behaviour through advancement, trench cover/crossing/occupancy, nest targeting, aircraft-only anti-air, ground vulnerabilities, atomic payload spending, launcher versus missile lifecycle, deployment interruption, duplicate launch/impact events, bounded splits, carrier/warhead interception by the separate defence system, relationship changes and readable counterplay. Plan checks and art reports do not establish runtime results.
