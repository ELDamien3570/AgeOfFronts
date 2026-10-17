# Pre-modern combat balance

The October 2026 unit-lab export is the baseline for squad counts, HP, armour
and movement. Modern weapon damage and cadence are retained, except as listed
under "Late-age lethality". ATGM teams use one soldier, or two with the
formation upgrade.

Comparisons use unpromoted, contemporary soldiers on level ground, without
charge, cover or flank exposure. Charge adds its authored damage separately.

* A spearman defeats light cavalry with about 30% HP remaining, and kills a
  caught horse archer sooner. Heavy cavalry defeats a spearman with about 50% HP.
* One mainline infantryman defeats three spearmen consecutively, without healing.
* 81 Napoleonic pikemen against 81 pikemen should resolve in about 60 seconds;
  40 Boyar Guards against 40 Boyar Guards in about 30 seconds.
* 60 Bronze Age axemen starting in contact with 60 archers should win with about
  30 survivors. Spearmen should win with about 15–20 survivors. Both are
  currently admitted gaps: axemen win with 36, and spearmen lose with 0
  survivors (see "Admitted gaps").
* Engaged archers cannot fight or fire. Eligible rear ranks can still shoot,
  including at close range. Ranged-only troops have no minimum firing distance.
* Archers must outrun spearmen; mounted archers must outrun heavy cavalry but
  lose to light cavalry or focused foot archers. Heavy cavalry resists ordinary
  bows and infantry; crossbows and ranged siege remain effective at range.
* Javelins retain a melee attack. Later foot archers and all mounted archers do
  not. Grenadiers retain bayonets; musketeers have only ranged fire.
* Bow range advances from 6 in Bronze Age to 9 for Late Medieval crossbows.
  Grenadiers have range 10, musketeers 11. Napoleonic firearm accuracy increases
  toward close range. Grenadiers are quicker than musketeers.
* Rams and siege towers attack only buildings and walls. Ranged siege is fragile
  in contact. Field cannon reach exceeds howitzer reach, with less damage.

Balance measurements must distinguish individual weapon duels, formation damage
estimates and actual simulated engagements. Formation, frontage, rank cycling,
movement, projectile interception and casualties can change aggregate outcomes.

## Measured reference results (historical)

This table predates contact-limited melee (combat revision 10) and the
October 16 promotion. Current values are in "Current measured results" below.

The deterministic tests in `tests/skirmish/PreModernBalance.test.ts` exercise the
real battle, melee-strike and projectile paths, maintain frontal contact as bodies
shrink, and suppress promotion. They exclude approach time and charge.

| Engagement | Result |
| --- | --- |
| 81 Napoleonic pikemen against 81 | Mutual destruction in 60.125 seconds |
| 40 Boyar Guards against 40 | Mutual destruction in 32.625 seconds |
| 60 Bronze axemen against 60 archers, starting in contact | 28 axemen survive |
| 60 Bronze spearmen against 60 archers, starting in contact | 20 spearmen survive |
| Napoleonic pikeman against light cavalry, one each | Pikeman survives with 30 HP |
| Napoleonic pikeman against heavy cavalry, one each | Cavalry survives with 251/500 HP |
| Bronze axeman against three consecutive spearmen | Axeman survives without healing |

Napoleonic firearms use a linear expected-hit contribution from 90% at contact
to 35% at maximum range, with 10-second grenadier and 12-second musket cycles.
Each grenadier and musket hit deals 55 HP (previously 150, which let one volley
erase an equal line). A full-range grenadier volley kills 15–20% of an equal
48-soldier line and a close volley (2–3 tiles) 35–50%
(`tests/skirmish/CombatContractRows.test.ts`). Owner decision OD-18: the
notes' default was 70 HP (05 rec 7), which still lost 450 squads of the
crowded `FormationPerformance` fixture by step 5; 55 HP is the value that
meets the Next #7 exit criterion. It applies to every Napoleonic musket
profile in `skirmish/plans/soldier-weapons.json`, including
`napoleonic-archer` (a musket unit), not only grenadiers and muskets.

## Late-age lethality (C3)

A hit not resolved per soldier (a machine-gun burst, a hull gun, a shell) kills
at most the soldier bodies it reaches: one frontage, `ceil(sqrt(capacity))`
bodies, for a direct hit, and the bodies inside the radius for a blast. ATGM
missiles carry a +400 vehicle bonus (one hit is about 27% of a T-14). Hull
weapon damage and cadence are otherwise unchanged. Measured rows:

| Engagement | Result |
| --- | --- |
| One machine-gun crew burst against an AK-47 squad | At most 4 riflemen die |
| Two ATGM teams against a T-14 at 14 tiles | T-14 destroyed within 40 seconds |
The lab combines this with the configurable target accuracy, distance and armour.
Accuracy is committed into projectile contribution at launch and retained by
snapshots. It does not create individual authoritative soldier projectiles.

Foot infantry counter bonuses, cavalry staying power and artillery output need
mixed-army playtesting. Movement/kiting outcomes and large cavalry rank-wave
engagements are not established by these controlled frontal tests. The cavalry
wave cadence remains the existing authored presentation/combat model.

## Contact-limited melee (combat revision 10)

Melee attacks against soldier formations now share a simultaneous budget for
the actual exposed receiving bodies. Bodies behind the contacted edge screen
rear ranks, even when those ranks fall inside nominal weapon range. Ordinary
attacks address at most one defender per contributing attacker. Overkill is
discarded; it cannot spill into untouched ranks or carry to another attack.
Overlapping attacks share the same receiving bodies, with damage credit divided
proportionally. Another edge can expose additional defenders.

Charge impacts can address additional bodies within their bounded penetration
depth. Bracing and blocked entry prevent this additional penetration. Cavalry
rank waves use their current arriving contributors and existing strike depth.
Weapon cadence, authored damage, ranged fire, splash and hull health are
unchanged. This remains a squad simulation: contact addresses and health budgets
exist only during the combat step, with no persistent individual soldier state.
The existing squad wound remainder is deducted once from the shared contact
budget. Layout/count updates expose the next rank for subsequent legal attacks.

Re-running the same controlled fixtures at revision 10 gave (historical; the
Boyar and Bronze rows have since changed, see "Current measured results"):

| Matchup | Contact-limited result |
| --- | --- |
| 81 Napoleonic pikemen against 81 | Mutual destruction in 62.5 seconds |
| 40 Boyar Guards against 40 | Mutual destruction in 37.625 seconds |
| 60 Bronze axemen against 60 archers, starting in contact | Archers win with 22 survivors in 12.75 seconds |
| 60 Bronze spearmen against 60 archers, starting in contact | Spears win with 20 survivors in 24.875 seconds |

The original Boyar timing and axemen-versus-archers balance assertions currently
fail. Those goals and tests are retained: the contact change removes overkill
that previously let slower, high-damage axemen erase several archers per
contributor. Rear archers continue firing under the existing eligibility rules.
No damage, cadence or firing-eligibility retuning is included in this change.
The earlier measurement table above is historical, before this contact change.

## October 16 approved-balance promotion

The tested lab proposal is now authored game content. Mainline melee damage and
infantry bonus are 10 / 14 / 18 / 22 / 28 from Stone through Late Medieval;
cadence is 60 RPM, or 50 for Boyar Guards. Their melee armour is 0 / 4 / 8 / 12 /
16 and ranged armour 0 / 1 / 2 / 3 / 4. Mainline speeds are 80 / 81 / 82 / 84 /
85%; ranged infantry is five points slower, anti-cavalry ten points slower.
Napoleonic retains the approved slower 80 / 70 / 75% exception.

Early Modern mainline / ranged / anti-cavalry infantry uses 87 / 82 / 77% speed;
Modern uses 88 / 83 / 78%. These apply to Mosin / DP-28 / PTRD and AK-47 / RPL-20 /
ATGM soldiers. Support hulls, artillery and vehicles keep their speeds. HP,
counts, recruitment, prices and modern weapons are unchanged.

Cavalry uses the approved attack curves and mounted bonuses: 50% of base melee
damage for heavy cavalry, 25% for light cavalry, 10% of ranged damage for mounted
archers. Ordinary cavalry attacks use sustained assault without spending the
charge bonus. Double right-click activates that per-unit bonus; wedge remains a
deliberate formation choice.

The approved faster Boyar mirror now resolves in 15.75 seconds at 100 HP. The
Bronze axemen reference currently wins with 36 survivors, above the earlier
roughly-30 target. That calibration assertion remains unresolved; promotion does
not silently retune damage to force the older survivor target.

## Current measured results

Measured on branch aof/next-9 with the `PreModernBalance.test.ts` fixtures
(no approach, charge or promotion). Re-checked at the integrated Next batch
head: the tests that pin these rows pass unchanged.

| Engagement | Result |
| --- | --- |
| 81 Napoleonic pikemen against 81 | Mutual destruction in 62.5 seconds (target about 60: passes) |
| 40 Boyar Guards against 40 | Mutual destruction in 15.75 seconds (approved 14-18: passes) |
| 60 Bronze axemen against 60 archers, starting in contact | Axemen win with 36 survivors in 10.125 seconds (target about 30: admitted gap) |
| 60 Bronze spearmen against 60 archers, starting in contact | Archers win with 50 survivors in 8.375 seconds (target 15-20 spearmen: admitted gap) |
| Bronze axeman against three consecutive spearmen | Axeman survives without healing (passes) |

## Admitted gaps

These contract targets are kept but are not met. Each is an `it.fails` in
`tests/skirmish/PreModernBalance.test.ts`; because `it.fails` also passes on an
unrelated exception, the spearmen row is also pinned by a plain test of its
measured outcome.

* Bronze axemen against archers: 36 survivors, target about 30 (upper bound 33).
* Bronze spearmen against archers: spearmen lose, 0 against 50 archers in
  8.375 s, target 15-20 spearmen survive. Owner decision OD-16: none of the
  balance-table rows (age-up gate, trade, stacking, refits, tribe opening,
  content) covers ranged-versus-spear contact, so this stays an admitted gap
  until the combat lane retunes spear-versus-archer contact or the owner
  replaces the contract row.
* None for `FormationPerformance.test.ts`: its C3 acceptance (more than 1,900
  squads still fighting after 8 steps) is a normal passing test since the
  Napoleonic volley retune (OD-18).

## Economy and age-up rules (balance table)

Each value is one named constant. The owner decision ID is the reference used in
commit messages and in the tests that pin it.

| Row | Rule | Constant (file) | Decision |
| --- | --- | --- | --- |
| Age-up gate | A nation advances with all three current-age trees, or two trees with warfare at most one technology short. Tribes keep any two trees (plus the 75% rule). | `ADVANCE_WARFARE_SHORTFALL = 1` (`domain/Progression.ts`) | OD-1 |
| Age-up time | Advancement takes 90, 105, 120, 135, 150, 165, 180 s (was 50-85 s). Gold unchanged. | `ADVANCES` (`content/Technology.ts`) | OD-2 |
| Trade tariff | A foreign market owner earns 75% of the trader's payout (was 100%; 25% before the owner's change). The trader keeps the full payout. | `RECEIVER_TARIFF_PERCENT = 75` (`content/Economy.ts`) | OD-3 (owner) |
| Market intake | A market accepts at most one largest foreign visit (sea, foreign acceptance) of foreign goods per 5 s (owner; was 20 s), refilled continuously. Domestic deliveries are exempt; per-visit limits are unchanged. | `MARKET_INTAKE_WINDOW_SECONDS = 5` (`domain/TradeReceiving.ts`) | OD-4 (owner) |
| Commerce cap | Removed by the owner: every completed factory and port produces trade stock (more infrastructure means more trade). | none | OD-5 (owner: removed) |
| Land income | `20 x (age + 1) / 2 + land / 40` gold per second: 10 at Stone, 20 at Bronze ... 80 at Modern, plus the land term (was a flat 20 + land / 40). The notes' default (05 rec 3). | `LAND_INCOME_BASE_GOLD = 20`, `landGoldIncome` (`content/Economy.ts`) | OD-6 |
| Stacking | Mine 1 per deposit for every faction, city 3; every other type, including factories and ports (owner), 15. | `STACK_LIMITS`, `MAX_BUILDING_STACK` (`Construction.ts`) | OD-7 |
| Refit price | Gold per squad or hull is max(per-age price, ceil(60% x (target recruit gold - source recruit gold))). A Stone warship's Modern refit is 2,940 (was 2,600); squad refits are unchanged for current content. | `REFIT_FLOOR_PERCENT = 60` (`domain/Refitting.ts`) | OD-8 |
| Tribe opening | Tribe squad cap 6 + 4 per age; tribe reserve income 2 x the nation base (24..192 points/s, was a flat 40); no tribal campaign against a nation before minute 8 and Bronze Age, unless retaliating. | `TRIBE_SQUAD_CAP`, `TRIBE_SQUADS_PER_AGE`, `TRIBE_RESERVE_MULTIPLIER`, `TRIBE_NATION_CAMPAIGN_TICKS`, `TRIBE_NATION_CAMPAIGN_MIN_AGE` (`FactionRules.ts`) | OD-9 |
| Tribe start | 3 starting squads, the notes' default (13 R1(2); was 4). The playtest-v1 opening uses the same horde. | `TRIBE_STARTING_SQUADS = 3` (`FactionRules.ts`) | OD-10 |
| Vessel refit port | A vessel refit needs an owned, completed port of at least the target vessel's age (05 rec 5, the notes' default). | `vesselRefitPortReady` (`domain/RefitQuote.ts`) | 05 rec 5 |

OD-4 deviates from the notes' example (`marketDropCapacity(stack)` goods per
20 s for all intake), which is smaller than the authored foreign and sea
per-visit allowances and would have cut every first delivery and the domestic
economy. Tests: `AgeUpGate`, `ResearchPacing`, `TradeFleet`, `TradeReceiving`,
`StackLimits`, `RefitQuote`, `TribeOpening`, `AiTribeExpansion`,
`LandIncome`.

## Content decisions

`tests/skirmish/BalanceMatrix.test.ts` ("content decisions") pins OD-12 to
OD-15; OD-18 is pinned by the combat tests named in its row.

| ID | Unit | Current | Alternative | Status |
| --- | --- | --- | --- | --- |
| OD-12 | Modern machine-gun crew (`modern-field-support`) | 1000 HP, as the Early Modern crew (was 200) | 1200 HP (05 rec 1) | Applied: the notes' recommended default |
| OD-13 | RPL-20 crew (`modern-archer`) | 100 HP, enlarged size 3 | 80 HP, enlarged size 1 (earlier contract text) | Kept pending the owner |
| OD-14 | Bronze cavalry (`bronzeage-cavalry`) | 16 riders, 20 enlarged, 16 horses | 8 riders, 12 enlarged, 8 horses | Kept pending the owner |
| OD-15 | Medieval infantry 40/50; Napoleonic cavalry 48/64 | As authored | Revert to 36/48 and 24/36 | Kept pending the owner |
| OD-18 | Napoleonic musket hits (grenadier, musket, `napoleonic-archer`) | 55 HP (was 150) | 70 HP (05 rec 7) | Applied by the combat lane; pinned by `CombatContractRows` and `FormationPerformance` |

The "unchanged HP and counts" statement under "October 16 approved-balance
promotion" is superseded by OD-12 for the Modern machine-gun crew only.

## Analytic counter matrix

`tests/skirmish/BalanceMatrix.test.ts` computes, per same-age pair, the
equal-gold exchange value of a counter (dps per HP pool, both ways, scaled by
gold). It fails when a recorded pair falls below 0.9 x its recorded value
(`COUNTER_RATCHET_FACTOR`, OD-17). It is analytic: no charge, kiting, blast or
losses during the fight. Spearmen are 9-15x better gold-for-gold against light
cavalry and mainline infantry 7-8x against spearmen; heavy cavalry (0.09-0.13)
and foot archers against infantry (0.19-0.33) are not equal-gold counters.

## Pacing

`scripts/pacingProbe.ts` (heightmap-test1 at 500, 8 idle human seats, 14 AI
nations, 30 tribes, Stone start, technology speed 1, 60 simulated minutes)
records the minute regular factions first reach each age. Values are leader /
median minute over the factions that reached the age (count in brackets). "Base"
is branch aof/next-6 (before these rows), "After" is aof/next-9. A recording,
not a gate. Seed 47 was not run.

| Age | Target leader / median (13 R8) | Base 424242 | After 424242 | Base 9001 | After 9001 |
| --- | --- | --- | --- | --- | --- |
| Bronze | 5 / 6 | 4 / 4 (22) | 5 / 5 (17) | 4 / 4.5 (22) | 5 / 5 (19) |
| Classical | 12 / 14 | 8 / 9 (14) | 9 / 11 (15) | 8 / 11 (14) | 9 / 13 (15) |
| Early Medieval | 20 / 23 | 13 / 14 (13) | 15 / 17 (12) | 13 / 15 (13) | 16 / 19 (11) |
| Late Medieval | 28 / 32 | 19 / 20 (10) | 23 / 25 (10) | 19 / 21 (13) | 23 / 29 (9) |
| Napoleonic | 37 / 42 | 26 / 27 (7) | 32 / 33 (8) | 26 / 28 (13) | 35 / 38.5 (8) |
| Early Modern | 47 / 53 | 33 / 34 (7) | 43 / 47.5 (6) | 34 / 36 (12) | 50 / 53.5 (4) |
| Modern | 58 / 65 | 44 / 46 (6) | not reached by 60 | 46 / 47 (7) | not reached by 60 |

Other measurements at minute 60 (base / after): squads alive 827 / 79 (424242)
and 1,055 / 100 (9001); regular factions 30 / 25 and 31 / 27; tribes promoted
8 / 3 and 9 / 5. Idle human seats: 1 / 1 and 3 / 4 alive at minute 10, none at
minute 20 in either build. A 30-minute diagnostic run of seed 424242 shows
regular-faction gold 2.1M / 0.44M at minute 15 and 6.7M / 0.82M at minute 30,
with regular squads 290 / 236 at minute 30: the trade rows cut gold about
8x, and the army gap opens after minute 30. That late collapse in army size is
not explained by these measurements and needs a playtest before the trade
constants are confirmed.

Integrated build (30 minutes, seed 424242, idle seats). "Head" is the Next
batch integration head (eadf217f); "follow-up" adds OD-6 (land income by
age), OD-10 (3 tribe squads) and the routing remediation (one planner job
per cohort, AI cohorts included):

| Minute 30 | Head | Follow-up |
| --- | --- | --- |
| Leader minute: Bronze / Classical / Early Med / Late Med | 4 / 9 / 15 / 23 | 5 / 9 / 16 / 23 |
| Regular squads | 120 | 164 |
| Regular gold | 0.72M | 0.70M |
| Cities / factories | 66 / 47 | 61 / 43 |

Napoleonic is not reached by minute 30 in either. Idle human seats alive at
minutes 10 / 20 / 30 in the follow-up: 4 / 1 / 1. Seeds 9001 and 47 and the
60-minute run were not repeated; the army size is still below the lane's 236
and the pre-trade-row 290, so the trade rows (OD-3/4/5) remain unconfirmed.

## Authoring sources

`skirmish/plans/formation-recipes.json` and `skirmish/plans/soldier-weapons.json`
are compiled with their corresponding scripts into the runtime catalogues.
`unit-tuning.json` is the direct authored source for movement and hull armour and
weapon overrides; it is not generated from the player's browser drafts.
Soldier weapon schema 2 has nullable channels and independent bonus maps. Rules
version 12 and the content hash prevent older combat state being silently reused.
