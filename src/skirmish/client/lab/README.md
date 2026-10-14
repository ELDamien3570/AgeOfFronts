# Soldier lab and approved presentation changes

The approved cavalry controls multiply the previous live geometry: body and
individual actor artwork by 0.9, deployed and travel pitch by 0.7. Existing
global soldier scale stays 0.5. Existing deployed cavalry spacing 0.8 becomes
0.56. Cavalry body envelopes and navigation radii follow the smaller body.
Infantry, vehicles, movement speed and combat timing stay unchanged.

The approved projectile controls affect arrows, javelins and bolts only:
0.45 of previous size in flight and grounded, 0.7 embedded. Bullets, artillery,
rockets and bombs keep their current sizes. Collision diameters, damage, targets and timing do not
change. No random flight-duration variation is added to live volleys.

The inspection tab uses cloned content definitions. Draft edits never mutate
live catalogue objects, recipes, upgrades or doctrines. Export includes draft
definitions and per-recipe formation access. Base/enlarged capacities remain
associated with the recipe's existing capacity technology. Hull recipes do
not become soldier formations.

eDPS is an estimate against a configurable target, with hypothetical accuracy.
Damage/armour and sustained cadence reuse domain functions; stationary full
strength is assumed. Melee/ranged estimates are separate because shared
weapon commitments and contact geometry prevent simply adding both rates.
Aircraft mission payloads are estimated using an explicit editable sortie
cycle, not their payload's one-tick reload field. Charge, splash victim count,
elevation, pathing and replenishment are excluded.

The inspector presents a comparison grid with category, age and unit-type
filters and age/name/eDPS/health sorting. Opening a card attaches the shared
editor beneath its summary. Drafts are stored under a content-hash namespace
check; older content drafts are not silently applied. Soldier primary attack
aliases are restored after JSON round trips. Formation-access overrides use a
cloned doctrine passed to the shared slot generator, never the live registry.

Tighter cavalry geometry exposed premature dropping of approach intent at the
first in-range tick. Rank-wave cavalry now retains its admitted standoff goal
while braking. Existing acceleration, speed and braking profiles are unchanged.

The inspector presents a comparison grid with category, age and unit-type
filters and age/name/eDPS/health sorting. Opening a card attaches the shared
editor beneath its summary. Drafts are stored under a content-hash namespace
check; older content drafts are not silently applied. Soldier primary attack
aliases are restored after JSON round trips. Formation-access overrides use a
cloned doctrine passed to the shared slot generator, never the live registry.

Tighter cavalry geometry exposed premature dropping of approach intent at the
first in-range tick. Rank-wave cavalry now retains its admitted standoff goal
while braking. Existing acceleration, speed and braking profiles are unchanged.
