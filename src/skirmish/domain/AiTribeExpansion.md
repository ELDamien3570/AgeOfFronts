# Tribal expansion operations

Goal: nations should prepare and execute viable invasions of nearby tribes.
Tribes should pursue the land promotion requirement through peaceful expansion
first, then attack weaker nearby tribes or vulnerable nations when boxed in.
Tribe elimination and
promotion remain ordinary gameplay outcomes, with no age deadline or free forces.

Extend AiOperations, rather than introducing another strategic controller:

* Observe territorial high-water growth. An unclaimed border alone is not evidence
  of useful expansion: after 30 seconds without material growth, allow planning
  against eligible tribes even if neutral fragments remain. This is an O(1)
  observation per strategic decision, not a terrain flood or pathfinding shortcut.
* Choose a tribe before the army is strong enough. Certify its invasion route via
  existing deferred route quotes. Only certified preparations request additional
  paid recruits, using existing personality composition and economic priorities.
* Estimate the force requirement from combat advantage, reserving personality-
  appropriate home forces for nations and one home squad for small tribes.
  Production may prepare before attack readiness;
  ordinary diplomacy and command validation still authorize war and movement.
* Keep preparations while the available force improves. Abandon failed routes or
  stalled preparations, with bounded target retry cooldowns.
* Tribal campaigns may exceed normal commitment timers while making net progress:
  reducing target territory/cities/health or approaching its objective. Historical
  best values prevent oscillating movement or healing from extending a stalemate.
  Defeated or heavily depleted forces still withdraw.
* Persist observations, preparation and campaign progress through the existing
  operation checkpoint. Bounded candidate work remains sixteen reads per tick.
* Nations may also commit to clearly vulnerable tribes while peaceful expansion
  continues; neutral land does not forbid an otherwise favorable tribal conquest.
* Tribal campaigns use existing squad cohorts, paid recruitment and bounded
  development, without enabling the full nation economic or Army director.
  Military research and procurement take priority under expansion pressure;
  preserve gold for one producible recruit before optional development spending.
  Existing tribe building/population caps and both promotion paths remain intact.
* Campaign pursuit may leave the old tribal patrol radius only for its committed
  target. Alliances, peace protection and third-party transit remain authoritative.
  A significant home invasion interrupts a tribe's offensive commitment.

The Early Medieval outcome is a playtest target, not a guaranteed invariant.

## Initial nation-only validation

112 focused tests pass across operations, recruitment/economy, diplomacy,
strategic routing, defense, shared army travel, tribes and checkpoint restoration.
TypeScript and the skirmish production build pass. The production build reports
its existing large-chunk warning.

Three live smoke runs used a 128x96 land map, Bronze Age start, three balanced
AI nations and four tribes. Neutral territory was allocated to the nearest
nation to create a crowded frontier; original tribal land and normal opening
resources, research and squad counts were retained. No extra military resources
or permissions were supplied. Each run lasted 240 simulated seconds.

| Seed | Tribes eliminated | Surviving tribes | Maximum candidate reads per tick |
| --- | --- | --- | --- |
| 47 | 2 | 2 | 4 |
| 13 | 1 | 3 | 4 |
| 89 | 2 | 2 | 4 |

Traces showed target selection, paid recruitment, supported invasion declarations
and territorial capture. These are execution checks, not paired baseline results
or evidence that every ordinary map meets the Early Medieval target.

For local playtesting, start a fresh match with normal AI policies and tribes.
Watch nations whose neutral expansion has slowed: preparation should lead to
larger committed attacks, with active-offensive borders visible during war.
Check that endangered home territory still receives protection and allied or
peace-protected tribes remain protected. Islands and difficult routes may still
require future naval-policy work.

## Tribal promotion campaign validation

The subsequent tribal policy pass has 122 passing focused tests, including
peaceful growth before war, both categories of vulnerable targets, avoiding
hopeless campaigns, preserving recruitment gold, military research priority,
pursuit beyond the patrol radius and the thirty-tribe strategic work budget.
TypeScript and the production build pass.

The same crowded Bronze Age smoke scenarios (seeds 47, 13 and 89) now show all
four tribes initiating campaigns and earning ordinary promotion within 240
simulated seconds. These scenarios are deliberately boxed in, with no extra
starting military resources. Starting nations fall quickly in these runs, so
this stronger tribal behavior needs normal-map balance playtesting.

An additional seed-47 run retained the normal unclaimed land. It showed tribal
campaigns and two surviving tribes still below promotion at 240 seconds; the
other two had become nations. Neither test configuration imposes a promotion
timer or changes the population/building caps, advancement gate or inheritance
rules. The full nation economic director remains disabled for tribes.
