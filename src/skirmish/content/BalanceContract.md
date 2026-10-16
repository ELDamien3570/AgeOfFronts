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
  30 survivors. Spearmen should win with about 15–20 survivors.
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

## Measured reference results

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
(`tests/skirmish/CombatContractRows.test.ts`).

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

Re-running the same controlled fixtures gives:

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
Bronze axemen reference currently wins with 39 survivors, above the earlier
roughly-30 target. That calibration assertion remains unresolved; promotion does
not silently retune damage to force the older survivor target.

## Authoring sources

`skirmish/plans/formation-recipes.json` and `skirmish/plans/soldier-weapons.json`
are compiled with their corresponding scripts into the runtime catalogues.
`unit-tuning.json` is the direct authored source for movement and hull armour and
weapon overrides; it is not generated from the player's browser drafts.
Soldier weapon schema 2 has nullable channels and independent bonus maps. Rules
version 12 and the content hash prevent older combat state being silently reused.
