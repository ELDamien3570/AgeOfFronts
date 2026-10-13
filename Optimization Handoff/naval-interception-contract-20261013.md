# Naval interception and transport damage

## Gameplay contract

- Automatic naval targeting defaults to intercepting afloat squads. The player can select transport interception or warship engagement for owned warships. Explicit attack and movement orders retain authority.
- Full-health base warships reload every two simulation seconds. Base transports move at 80% of the same-age base warship speed and withstand two effective same-age hits before Late Medieval, three from Late Medieval onward. Research and combat damage retain their existing effects.
- Fire allocation concentrates enough credible damage to sink a hull, then allocates subsequent shots to other legal targets. Damage still resolves simultaneously; allocation must not give a destroyed shooter immunity or change casualty attribution.
- Incoming commitments come from live projectiles, including after checkpoint restoration. Impacted, expired, missing, landed, non-hostile or geometrically missed targets release their commitments. Explicit attacks may deliberately overcommit.
- Naval shells lead authoritative route movement. They retain fixed trajectories and physical collision; they do not home or guarantee a hit. Automatic pursuit includes afloat squads and proposes bounded route interception within the existing patrol leash.
- Actual hull damage causes passenger health damage equal to half its fraction of maximum hull health, measured against passenger health at embarkation. Fractional health damage accumulates across hits. Soldier wounds/casualties and transported vehicle hull damage persist after landing. Sinking kills all remaining passengers exactly once.
- Landing discards the transport hull. Re-embarkation supplies a fresh researched hull and a new passenger-health baseline; existing passenger damage is never repaired by this transition.
- Older checkpoints without passenger accounting initialize from the current surviving passenger health and hull on their first damaging hit. No retroactive casualties are invented.

## Implementation boundaries

Shared naval geometry and fire allocation are deterministic, bounded domain helpers. Ship targeting/pursuit remain squad/hull-level systems. Passenger damage uses existing manpower and casualty accounting. Priority, passenger accounting and projectile target commitments survive checkpoints; priority and passenger accounting also survive text/binary snapshot encoding.

## Acceptance

Verify multi-target allocation for instant fire and incoming shells; explicit-order precedence; both priority modes and ownership rejection; moving targets, missed/expired reservations and landing; fractional passenger damage, vehicles, sinking and re-embarkation; encoded checkpoint continuation and snapshot round trips. Exercise moving unescorted convoy crossings across all ages and compare increasing defender counts. Typecheck and skirmish build must pass. Browser presentation is separate from deterministic simulation evidence.
