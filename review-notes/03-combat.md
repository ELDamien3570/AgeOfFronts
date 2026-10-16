# 03 — Land and naval combat mechanics (review notes)

Reviewer scope: land and naval combat resolution in `src/skirmish/`, judged against the
matured target (8 humans + 14 AI nations + 30 AI tribes, Mediterranean 500x250 and
larger, ~1100 squads / ~300 warships live). Working tree as of 2026-10-15 is the code
under review (branch `1.5.7-10hz-prototype`, 8 ticks/s).

Everything marked **CONFIRMED** was traced end to end in the code and, where stated, also
executed (vitest run or a throwaway `tsx` script under the scratchpad). **SUSPECTED**
means the mechanism is read from the code but the consequence was not exercised.

## Scope read

Fully read (all lines unless a range is given):

- `src/skirmish/domain/Battle.ts` 1-1638 (fight 629-1089, attackStructure 1090-1137,
  advanceProjectiles 1138-1637, fire 327-411, volley 412-466, awardDamage 482-522,
  hybridContacts 582-614, meleeHit 617-627, rebuild 263-301, legalContact 245-255)
- `src/skirmish/domain/Combat.ts`, `CombatGeometry.ts`, `CombatActivity.ts`, `CombatFact.ts`,
  `MeleeDamage.ts` (untracked), `MeleeStrike.ts`, `WeaponAccuracy.ts` (untracked),
  `WeaponTiming.ts`, `FormationContact.ts` 1-732, `ContactFront.ts`, `ChargeImpact.ts`,
  `ChargeStrength.ts`, `CavalryEngagement.ts`, `CavalryMelee.ts`, `ProjectileCollision.ts`,
  `ElevationAdvantage.ts`, `FormationTactics.ts`, `FormationFacing.ts`, `NavalCombat.ts`,
  `MissileInterception.ts`, `StructureTargeting.ts`, `Fortifications.ts`, `TrenchOccupancy.ts`,
  `TrenchFrontage.ts`, `TrenchPositioning.ts`, `BattleLineLayout.ts`, `SkirmishStance.ts`,
  `EngagementManager.ts` 1-972, `HillPositioning.ts` 1-200, `StructureAttackPreparation.ts` 1-140,
  `TacticalEstimate.ts`, `AiCombatPower.ts` 1-62, `TacticalTerrain.ts`, `ResearchEffects.ts` 1-80,
  `Manpower.ts` 1-150
- `src/skirmish/RangedAim.ts`, `FiringPositions.ts`, `SpatialGrid.ts` 1-140, `PhaseSpatialViews.ts`,
  `UnitIndex.ts` 1-300, `BuildingIndex.ts` 240-300, `EntityCollection.ts` 29-95,
  `Protocol.ts` (ArcherVolley 400-417, squad combat fields 257-267), `Conquest.ts` 11-42
- `src/skirmish/Simulation.ts`: 1950-2000, 2236-2262, 2499-2523, 2730-2990 (fightShips,
  resolveNavalDamage), 3190-3366 (stepWarships), 3378-3666 (performTick), 3721-3738,
  4132-4225, 4458-4607 (legacy fight, resolveLandDamage), 4780-4860, 5415-5500
- `src/skirmish/content/BalanceContract.md`, `Units.ts` 1-527, `SoldierWeapons.ts`,
  `TacticalRules.ts`, `Defences.ts`, `WeaponCycles.ts` 1-50, `soldier-weapons.json` (first
  ~300 lines + napoleonic-infantry), `unit-tuning.json` (head), `formation-recipes.json` (head)
- Tests: `tests/skirmish/PreModernBalance.test.ts`, `MeleeDamage.test.ts`,
  `TroopContactCasualties.test.ts`, `CombatBalance.test.ts`, `CavalryImpact.test.ts` 1-200,
  `fixtures/CavalryImpact.ts`
- Evidence: `Optimization Handoff/Evidence/live-match-freeze-20261015.md`,
  grep of `8hz-arm-qualification-20261014.md`

Executed (read-only):

- `npx vitest run --config vite.skirmish.config.ts tests/skirmish/{PreModernBalance,MeleeDamage,
  CavalryImpact,CombatBalance,TroopContactCasualties}.test.ts` -> 62 passed, **3 failed**, all in
  PreModernBalance (details under Issues). Note: the plain `npx vitest PreModernBalance --run`
  named in the task finds nothing because the root vitest config excludes `tests/skirmish/**`;
  the skirmish config is required.
- Scratch scripts (scratchpad only): a 1v1 duel tracer, a charge id-order experiment and a
  per-tick `battle.fight()+advanceProjectiles()` benchmark at 200-1100 squads.

## How it works today

### Entities and the resolution step

The squad is the atomic combat entity. A soldier-model squad has `troops`, a `manpower`
record (`hp` per soldier, `wounds` remainder, both in HEALTH_SCALE=1000 units) and an
immutable `formation` container (shape, facing, frontage, transition). Hull-model squads
(siege, vehicles, launchers) have `hullHealth`. Ships have scalar `health`. A squad afloat
in a transport is a hull with `afloat.hull`.

Every tick `Simulation.performTick` runs movement, then `fight()` -> `fightShips()` ->
`Expansion.afterMovement()` (`advanceProjectiles`) -> capture -> `checkWinner`
(`Simulation.ts:3618-3660`). `Battle.fight` (`Battle.ts:629`) iterates all unembarked squads
in ascending id order and writes damage into one `DamageLedger`; `resolveLandDamage`
(`Simulation.ts:4554`) applies the whole ledger simultaneously, so dead squads still land
the hit they earned ("iteration order cannot win a duel", 4556). Side effects inside the
loop (charge impacts, cavalry entry, `lastCombatTick`, weapon state) are, however, applied
immediately - see Issue I3.

### Acquisition

Per squad: explicit `order.type==='attack'` target first, then the retained previous
`combatTargetId` (kept only if frontal for melee, `Battle.ts:897-904`), then the nearest
eligible body from a bounded `spatial.queryOverlaps` (radius = max effective range +
CONTACT.release + envelope broad radius, `Battle.ts:864-870`). Eligibility = diplomacy
hostile, target-tag match, `legalContact` (exact formation-vs-formation gap via convex hulls,
wall/tower line-of-sight through `Fortifications.clear`). Results are cached per squad in
`acquisition` keyed by a *local activity epoch* (`CombatActivity`, 4-tile cells, epochs bump
when any body of another owner moves/changes in the neighbourhood), pose revision, barrier
and fort versions, diplomacy signature, order identity and profile identity
(`Battle.ts:877-916`). `quietOwners` (raids mode) skips acquisition entirely for factions
with no hostile owner (`Battle.ts:638, 814`).

### Formation geometry and contact

`FormationContact.formationContact` computes the closest pair of points between two convex
footprints (travel columns are unions of row capsules), returning `gap`, `source`/`target`
contact points, a `normal`, the overlapped `frontage` along the tangent and `facing`
(cosine of the attacker's forward against the normal). Geometry is memoised in WeakMaps
keyed by immutable formation containers (`FormationContact.ts:293-318`) and by
`CombatGeometry` poses (`CombatGeometry.ts:54-99`). Melee is legal when
`gap <= weaponReach + 4 units` (CONTACT.enter), and is retained up to `gap <= reach + 32`
(CONTACT.release) for the already engaged target (`Battle.ts:252`). Walls block melee by
root-to-root segment (`Battle.ts:246`).

### Participants ("rank cycling")

There is no literal rotation of soldiers. `contactParticipants`
(`FormationContact.ts:467-494`) returns `min(troops, files-in-contact x activeRanks)` where
files = `ceil(frontage / spacing)` bounded by the layout grid and `activeRanks` = authored
`ranks` (1 or 2 in `soldier-weapons.json`) unless the body is transitioning, modern-loose,
or the contact is oblique (`facing < 0.5` -> 1 rank; `facing < 0.25` -> 0 unless it is an
edge-defence contact). Ranged contributors (`Combat.attackContributors:391-413`): all
troops in a settled line, 75 % in other shapes, two rows in a column, all occupants in a
trench. `RANGED_CONTACT` (`Battle.ts:67`) reserves contacted ranged-only soldiers so they
cannot fire.

### Melee damage (combat revision 10)

`damageAmount` (`Combat.ts:275`) for per-soldier weapons: per-hit damage (after promotion
scaling and elevation) minus *points* armour (clamped at 1 HP minimum) plus the single
primary-class bonus (`primaryCounterClass` picks the highest-priority tag of the target),
times contributors, times a tactical multiplier (facing exposure front 1.0 / flank 1.25 /
rear 1.5 for melee only; shield-wall, square, loose shape protections; trench cover
2000 bp). Legacy aggregate weapons (ships, nests, old siege) use the percentage/points path
at 341-371.

The hit is then not applied directly. `meleeHit` (`Battle.ts:617-627`) computes
`meleeReceivers` (`MeleeDamage.ts:21-104`): the exposed target slots - slots not screened
by a nearer body across their width (a depth/side sweep, O(T^2) in target size) and within
`reach + penetration + release` of any attacker body - sorted by distance. The claim
carries `contributors x bodies` slots (bodies = 1 for ordinary attacks, `ceil(penetration /
bodyDepth)` for charges). `MeleeDamageBatch.resolve` (`MeleeDamage.ts:135-174`) splits every
claim's damage evenly across its slots, caps each slot's total at one soldier's hp (the
first slot additionally absorbs the squad's existing `wounds` remainder), scales the claim
down proportionally and **discards the excess**. Overlapping claims from several attackers
on the same slots share the budget proportionally. Only then is the surviving damage added
to the ledger and `resolveLandDamage -> damageManpower` converts it to deaths + a wound
remainder on the squad.

### Edge defence and hybrid weapons

A melee squad with spare soldiers also strikes every other contacted enemy on other edges
(four edge pools, `Battle.ts:1004-1022`) in the same weapon commitment. Soldiers with both
weapons (javelins, grenadiers) run `hybridContacts` first (`Battle.ts:582-614`): contacted
soldiers strike in melee, the remainder fire; `engagement.participants = min(participants,
hybrid.remaining)` prevents a second full-squad budget (937).

### Weapon timing, accuracy, projectiles

`commitWeaponShot` (`WeaponTiming.ts:213-248`) keeps a rational remainder so a 51 rpm
weapon fires at ticks 0, 10, 19, 29, 38... (no catch-up bursts; at most
`ceil(rpm/480)+1` shots per tick, `Battle.ts:949`). Magazines (`shotsPerReload`,
`reloadMs`) model reload pauses. `weaponAccuracy` (`WeaponAccuracy.ts`) is a linear
near->far hit fraction (only Napoleonic firearms have one) multiplied into contributors at
launch. Pre-Napoleonic archers and all artillery/warships from Late Medieval fire one
**projectile per squad shot** carrying `attackScale = contributors x accuracy`; Napoleonic
and later soldiers have no projectile and hit instantly. `predictiveAim` adds deterministic
hashed Gaussian scatter; `navalAim` leads moving hulls. In flight (`advanceProjectiles`), a
shell sweeps against formation hulls / ship circles / wall tiles / structure tiles and
**stops at the first hostile body or wall**; blast weapons then damage up to 64 bodies
within the radius under a damage budget of `4 x (damage + bonuses)`; nuclear kills
everything inside the radius outright.

### Charge and cavalry

A committed charge resolves once (`Battle.ts:707-803`): `resolveChargeImpact` budgets
`(damage+max bonus) x frontage x 1.5` over <=3 nearest targets; unbraced foot targets get a
bounded penetration depth (<=384 units) which admits deeper receiver slots; defenders get a
`chargeImpact` disruption (3 ticks) and the rider enters a `cavalryEngagement`
(penetrating -> engaged, 2 s) during which overlap with the contacted enemy is permitted.
Ordinary multi-row cavalry attacks instead use **rank waves** (`cavalryUsesRankWaves`): one
weapon commitment is split into three timed waves across 10.8 s
(`CAVALRY_RANK_MOTION.cycle = secondsToTicks(16.2/1.5)`), each wave paying the share of the
budget for riders whose stored contact path still reaches the stored target hull
(`Battle.ts:655-704`). The cycle, lunge lengths, lane widths, strike depth and the target
hull polygon are persisted on the squad (`cavalryMelee`).

### Elevation, trenches, walls, structures

Elevation (`ElevationAdvantage.ts`) gives per-soldier ranged weapons at most +10 % range and
+10 % damage at >=40 m height advantage (`TacticalRules.ts:55`); melee and hull weapons are
neutral. Trench occupancy grants 2000 bp cover from the front only (`TrenchOccupancy.ts:835-847`)
and the cover multiplies both melee and ranged damage for soldier targets (`Combat.ts:331-333`).
Walls/towers block enemy line of sight and movement; only `gun-nest` buildings (Modern) have
a weapon (`Defences.ts:72`, `Battle.ts:1039-1082`) - plain towers never shoot. Structures use
a flat `STRUCTURE_DEFENCE` (5000/6500 percentage armour) and betrayal doubles wall damage.

### Naval

`fightShips` (`Simulation.ts:2736-2954`) iterates ships by id. Each warship picks the
nearest hostile ship or afloat squad (transports first by `navalPriority`), skipping targets
whose incoming committed projectile damage (`incomingNavalDamage`) already exceeds their
health. Pre-Late-Medieval ships hit instantly through a ledger (simultaneous); later ships
fire shells with naval lead. Warships target only `["ship","structure"]` (`Units.ts:502`).
Hull damage on afloat squads is routed to `resolveLandDamage`, which converts hull loss into
proportional passenger casualties (`PASSENGER_DAMAGE_PERCENT = 50`) and kills everyone when
the hull reaches 0 (`Simulation.ts:4562-4582`). Sunk legacy transports remove their embarked
squads (`resolveNavalDamage:2975-2979`). Warships retreat to ports for repair when damaged
and out of combat (`stepWarships`).

### Missiles

ICBM/MIRV projectiles are intercepted by `missile-defence` stacks: `interceptionPoint`
solves the reachability interval analytically; one claim per warhead, imminent impacts first
(`Battle.ts:1146-1178`); interception survives checkpoints because it is stored on the
projectile.

### Checkpoint

`Battle.checkpoint` stores only projectiles; all caches (`acquisition`, `hybridAcquisition`,
`definitions`, `structureBodies`, `activity`, launch permissions) are cleared on restore
(`Battle.ts:141-153`). Per-squad combat state (`weaponState`, `cavalryMelee`,
`cavalryEngagement`, `chargeImpact`, `meleeStrike`, `combatFact`) lives on the squad record
and is checkpointed/replicated with validators. The cavalry test "continues physical entry
identically after checkpoint restoration" passes.

### Determinism

No `Math.random` in the simulation (only `LiveMatch.ts:150` for the match seed). Aim
scatter uses a hash PRNG seeded by `sourceId*65537+tick`. The combat model is **floating
point** throughout (hypot/sqrt/cos/sin/atan2 in geometry; damage values like 37.25 HP;
`xp`, `afloat.hull`, `ship.health`, `building.health` accumulate floats across ticks).
Manpower is the only integer-scaled store (`Math.round(dealt*HEALTH_SCALE)`,
`Simulation.ts:4584`). This is deterministic on one V8 build (V8 ships its own fdlibm) and
the checkpoint-equality tests prove replay, but it is not the "integer/fixed-point only"
contract; a Node major upgrade could in principle change `Math.sin/cos/atan2` results.

## Strengths

- Simultaneous ledger resolution (`resolveLandDamage`) removes id-order wins for ordinary
  attacks, and the batch melee budget makes overlapping attackers order-independent
  (`MeleeDamage.test.ts:52-63`).
- Launch-time permission snapshots on projectiles (`permissionsAtLaunch`, `Battle.ts:157-168`)
  correctly freeze hostility for in-flight shots across peace/capture transitions.
- Building bodies are rebuilt on `producerRevision`, which `BuildingIndex.changed` bumps on
  owner change (`BuildingIndex.ts:253-279`), so Battle does not repeat the Trade freeze bug.
- Every persisted combat fact has a validator (`validateWeaponState`, `validateCavalryMelee`,
  `validateChargeImpact`, `validateCombatFact`, `validateMeleeStrike`) wired into snapshot
  decoding (`SnapshotCodec.ts:485-486`).
- Acquisition reuse via local activity epochs is effective: in the benchmark 900 idle squads
  cost ~3 ms/tick, and all 1100 squads reuse their acquisition when nothing nearby moves.
- Naval overkill avoidance via `incomingNavalDamage` is a cheap, replay-safe design.
- Deterministic hashed aim scatter instead of RNG; no per-soldier projectiles.
- EngagementManager carries only ids, revalidates `legal()` on every use, and reconciles
  merge sources (`EngagementManager.ts:334-346`); I found no stale-membership path left.

## Issues

Severity: critical / high / medium / low. Confidence: high / medium / low.

### I1. Undocumented failing balance contract test (axeman vs three spearmen)
- `tests/skirmish/PreModernBalance.test.ts:59-67`; `src/skirmish/content/BalanceContract.md:89-90`
- Severity medium (balance/contract), confidence high. **CONFIRMED by running.**
- Mechanism: BalanceContract.md says only the Boyar timing and axemen-vs-archers
  assertions fail after combat revision 10. Running the file gives three failures: those two
  plus "lets melee infantry survive three consecutive spearmen without healing"
  (expected `[1,0]`, got `[0,1]`). The 1v1 trace (scratch script) shows the axeman winning
  the first duel with 15 HP after taking five 17-point spear hits at ticks 0,10,19,29,38
  (51 rpm rational cadence) and landing 48-point hits at 0,20,40; the second spearman then
  kills him with its first hit. With the authored numbers the "three consecutive" goal is
  arithmetically unreachable, so the contract table and test disagree with the content.
- Consequence: the contract document is not trustworthy as the gate it claims to be.

### I2. Contact-limited melee silently throws away class-bonus damage
- `src/skirmish/domain/MeleeDamage.ts:160-172`, `src/skirmish/domain/Battle.ts:619-622`,
  `soldier-weapons.json` (bronzeage-infantry: damage 30, bonus ranged 100; archers 80 hp)
- Severity high (gameplay/balance), confidence high. **CONFIRMED** (test result +
  arithmetic).
- Mechanism: an ordinary attacker addresses exactly one receiver slot (`bodies = 1`), and
  the slot budget is one soldier's hp. An axeman's 130-point hit on an 80-hp archer wastes
  50 points (38 %) every strike; a spearman's 21-point hit wastes nothing. This is why "60
  axemen vs 60 archers" flipped from 28 axemen surviving to archers winning with 22, while
  the spear fixture is unchanged. The whole counter-bonus design (`classProfiles`,
  `Units.ts:188-243`) assumed overkill carried.
- Consequence: anti-ranged infantry no longer counter archers; the role chart in
  BalanceContract.md is inverted for the 0-4 age bracket. High-damage/low-rpm weapons
  (heavy cavalry 45, Napoleonic muskets 150 vs 100-hp targets) are systematically weaker
  than their authored DPS implies.

### I3. Charge resolution depends on squad id order
- `src/skirmish/domain/Battle.ts:706` (skip when `chargeDisrupted`), `:762-765` (defender
  `disruptedUntilTick = tick + 3` written mid-loop), `:647-649` (ascending id iteration)
- Severity medium (fairness), confidence high. **CONFIRMED by experiment**: with the
  cavalry fixture, rider id 9 / defender id 10 -> defender strikes at ticks 4 and 24; rider id
  10 / defender id 9 -> defender strikes at 1 and 21. The lower-id defender gets a whole
  strike cycle three ticks earlier because it attacked before the charge disrupted it.
- Consequence: older squads (earlier-created factions, long-lived veterans) win charge
  exchanges slightly more often; AI nations created before human lobby slots (or vice
  versa) get a systematic bias. Same pattern: aircraft AA damage is applied immediately in
  loop order (`Battle.ts:842`, `:1202`), so the lowest-id AA squad always takes the kill xp.

### I4. Blast splash chooses victims and spends its budget in id order, not by distance
- `src/skirmish/domain/Battle.ts:1532-1535`, `:1555-1558`, `:1524-1527`
- Severity low-medium, confidence high (read).
- Mechanism: eligible bodies are `.sort((a,b)=>a.id-b.id).slice(0,64)` and the
  `4 x damage` budget is consumed in that order; distance only affects the falloff fraction.
  In a dense 50-faction crowd the lowest-id squads inside the radius absorb the budget.
- Consequence: artillery is biased against old squads; a budget-exhausting shell can miss
  the body at its centre.

### I5. A whole formation's volley lands on the first hostile body in the sweep
- `src/skirmish/domain/Battle.ts:1289-1312` (first `t`), `:372-374` (`attackScale` = all
  contributors), `:499-501` and `Manpower.damageManpower` (overkill capped by health)
- Severity medium (gameplay exploit), confidence high (read).
- Mechanism: pre-Napoleonic archers and crossbows fire one projectile per squad shot with
  the whole squad's contribution. The shell stops at the first hostile formation hull it
  sweeps; excess over that squad's health is discarded. Friendly bodies never block.
- Consequence: a one-soldier picket in front of a formation soaks an 81-bow volley every
  2.5 s; conversely a volley aimed at a weak target can be absorbed by any bigger body the
  arrow crosses. Legible to players as "arrows vanish".

### I6. Rank-wave cavalry deals one strike per 10.8 s instead of per weapon cycle
- `src/skirmish/domain/CavalryMelee.ts:7-12` (`cycle = secondsToTicks(10.8)`),
  `Battle.ts:1025-1027` (`interval = max(cycle, nextAttackTick - tick)`), `:946-947`
  (no further attacks until the cycle ends), `:990` (budget = one strike's damage)
- Severity high (balance), confidence high (read; the CavalryImpact test "still pays all
  three waves" asserts >=3 strikes in 17.5 s).
- Mechanism: any multi-row cavalry body attacking without a committed charge (and without an
  active `cavalryEngagement`) commits one 36-rpm strike and then waits 87 ticks before the
  next commitment, i.e. ~1/6.5 of authored melee DPS. The file's own comment says
  "Damage balance is deliberately deferred until the motion is approved".
- Consequence: cavalry that is attack-ordered rather than charge-ordered is nearly harmless;
  AI wings only charge in the `strike` phase (`Armies.ts:371-372`), so AI cavalry mostly
  fights at wave cadence. Human players who spam charge get 6x the DPS.

### I7. Presentation geometry is persisted in authoritative squad state and replicated
- `src/skirmish/domain/CavalryMelee.ts:134,194` (`targetBody` up to 1152 points per contact,
  <=8 contacts), `MeleeStrike.ts:178-189`, `CombatFact.ts:186-190` (modifier strings),
  `Protocol.ts:262-267`, `SnapshotCodec.ts:394,485`
- Severity medium (perf/scalability at the 52-faction target), confidence high (read).
- Mechanism: every `Skirmish.checkpoint()` `structuredClone`s all squads, and snapshots
  ship `squadDetails` whenever any squad carries `meleeStrike`/`cavalryMelee`. With ~300
  cavalry squads each holding several hundred points of stored hull plus eight strike
  records, checkpoint cloning and binary encoding scale with presentation data that the
  simulation only needs for wave-path replay.
- Consequence: avoidable per-tick allocation and snapshot bytes; combat explanations
  (`combatFact.modifiers`) are English strings inside the deterministic state.

### I8. Combat is float-based; "integer/fixed-point only" is not true
- `Battle.ts:519` (xp float), `:508` (volley damage rescale), `:541` (building health),
  `Simulation.ts:4563-4567` (hull floats), `:2960` (ship health), `FormationContact.ts`
  (hypot/sqrt/atan2 everywhere), `CavalryMelee.ts:11-12` (fractional tick constants
  8.53, 2.13, 10.67 ticks)
- Severity low (design), confidence high.
- Consequence: deterministic within one runtime (checkpoint tests prove it), but
  per-tick results are not reproducible across Node/V8 majors, and the 8 Hz vs 20 Hz
  cadence rounding (already noted in the ARM qualification) changes balance outcomes.
  Fractional tick constants in wave timing mean waves fire on `floor` boundaries that drift
  relative to the 125 ms step.

### I9. Melee wall test uses root-to-root, not the contact segment
- `src/skirmish/domain/Battle.ts:246` vs `:252` (`forts.clear(contact.source, contact.target)`)
- Severity low, confidence medium. **SUSPECTED.**
- Mechanism: `intactWallAt` is tested along the segment between the two squad roots; large
  bodies wrapped around a wall end can have roots on opposite sides while their contact
  points touch on one side (melee denied), or the reverse (melee allowed through the wall
  tip). Also note `intactWallAt` ignores ownership, so a faction's own wall blocks its own
  sortie against enemies standing on the far side - probably intended.

### I10. Live `Squad` references are cached across ticks in `hybridAcquisition`
- `src/skirmish/domain/Battle.ts:628` (`hits:{target:Squad}`), `:587-588`, `:608-612`
- Severity low today, confidence high (read); same bug class as the 2026-10-15 freeze.
- Mechanism: the cache stores record references, not ids. It is safe only because
  `EntityCollection.apply` mutates records in place (`EntityCollection.ts:65`) and
  `CombatActivity.update` bumps the epoch when a body disappears. The non-hybrid cache stores
  `target: id` and re-fetches. If entities ever become copy-on-write (the `copy` flag already
  exists) the hybrid path would strike stale snapshots.

### I11. Towers have no weapon; forts cannot defend themselves before Modern
- `src/skirmish/content/Defences.ts:70-72` ("Tower arrow values are still an open design
  decision"), `Battle.ts:1039-1045` (only `gun-nest` fires)
- Severity medium (gameplay), confidence high.
- Consequence: a tower+wall line is a passive obstacle; the Rise-of-Nations border-fort role
  (attrition + fire) does not exist for seven of eight ages.

### I12. Land forces cannot engage transports; warships cannot bombard troops
- `src/skirmish/content/Units.ts:30-38` (ground tags lack `ship`), `Battle.ts:306-307`
  (afloat -> ship tags), `Units.ts:502` (warship targets `["ship","structure"]`)
- Severity medium (gameplay), confidence high.
- Consequence: an amphibious landing is unopposable by archers/artillery on the beach
  (only warships and Modern gun nests can touch the hulls), and a fleet cannot support a
  landing against infantry on the shore. Both directions remove the naval-land interplay
  that makes coastal maps like Mediterranean interesting.

### I13. Elevation and trench effects are below the perception threshold
- `src/skirmish/content/TacticalRules.ts:53,55` (trench 2000 bp; elevation max 1000 bp)
- Severity low (design), confidence high.
- A +10 % ranged bonus at >=40 m and a 20 % trench reduction are not legible at strategic
  zoom; players will not learn to seek hills. Trench cover also applies to melee
  (`Combat.ts:331-333` multiplies both channels), which is not what a trench should do.

### I14. Perf profile (measured) and the first-contact spike
- `src/skirmish/domain/MeleeDamage.ts:50-100` (O(T^2) receiver sweep per claim),
  `Battle.ts:647-649`, `CombatGeometry.ts:92-95` (body builds)
- Severity medium (perf), confidence medium (desktop measurement, not ARM).
- Measured with the scratch benchmark (`battle.fight([])` + `advanceProjectiles`, steady
  state after warm-up, desktop Node 24):
  - 1100 squads, 200 in melee contact: median 6.2 ms/tick
  - 1100 squads, 600 in melee contact: median 8.4 ms, max 12 ms
  - 1100 idle squads: median 3.2 ms
  - 586 archer squads exchanging arrows at 4 tiles: median 2.6 ms
  - `meleeReceivers` 60-490 us per call (40-64 soldiers)
  - first tick of a new 200-600-body contact: 150-280 ms (JIT warm-up plus
    600-1200 `bodyBuilds`); second tick 37-53 ms.
  On the ARM host (~3x slower) the steady state fits the 125 ms budget easily; the
  cold-contact tick is the plausible source of the p99 255 ms spikes and should be measured
  on ARM with a warm JIT.

### I15. Engagement planner capacity at 52 factions
- `src/skirmish/content/TacticalRules.ts:49-52` (`maxArmies:12`, `engagementDetect:32`,
  `engagementPlan:48`), `EngagementManager.ts:414-421, 445-467`
- Severity low, confidence medium. **SUSPECTED.**
- With ~200 armies each army is detected every ~6 ticks and the planning queue is FIFO by
  `nextPlanTick` (human engagements only break ties), so no starvation, but a 12-army cap
  per engagement means a multi-faction melee of >12 armies splits into several engagements
  with inconsistent axes/centres.

### I16. Under-modelled systems (for the design question)
Confirmed absent in the simulation: morale/rout (fights are to the last soldier; only AI
armies "withdraw" via `EngagementManager` postures), fatigue, supply/attrition in enemy
territory (`Supply.ts` is goods production; `replenish` only works on owned tiles,
`Simulation.ts:2506`), finite ammunition (only reload pauses), terrain cover other than
elevation (forest reduces speed only, `Terrain.ts:21-25`), weather, merging of depleted
squads (only replenish/enlarge), garrisons (buildings have HP only), generals/leaders.
Present: flank/rear melee exposure (`TacticalRules.ts:60-61`), seven xp promotion levels
(`Combat.ts:213-216`, up to +20 % damage), trench cover, elevation.

## Recommendations (prioritised)

1. **Restore counter-bonus value under contact-limited melee** (I2; ~2 days). Let an
   ordinary attacker address `ceil(perHitDamage / targetSoldierHp)` adjacent exposed slots
   (a "cleave" count) instead of exactly one, keeping the slot budget cap. Touch
   `Battle.ts:619-622` (`bodies`), `MeleeDamage.ts:120-134`, add cases to
   `MeleeDamage.test.ts`, regenerate the BalanceContract table. Balance risk: brings back
   some of the pre-revision overkill against very low-hp targets; cap `bodies` at 2-3 so
   deep ranks still screen.
2. **Make the contract test and document agree** (I1; hours). Either retune the
   bronze spear (`soldier-weapons.json`) or change the goal to "two consecutive spearmen";
   record the third failing test in `BalanceContract.md`; add the skirmish config note to
   the test instructions in CLAUDE.md.
3. **Decide cavalry cadence** (I6; 1-3 days). Either scale the wave budget by
   `cycle / sustainedInterval(weapon)` so three waves pay the authored DPS, or let every
   wave be its own weapon commitment. Touch `Battle.ts:990,1025-1027`, `CavalryMelee.ts`,
   `CavalryImpact.test.ts` ("pays exactly one attack budget" must change). Balance risk: AI
   cavalry becomes 6x deadlier overnight; pair with the pike brace rule so spears still win.
4. **Order-independent charge and AA effects** (I3; 1 day). Collect `chargeImpact`
   disruptions and aircraft hits in per-tick ledgers applied after the loop (like damage),
   or evaluate `chargeDisrupted` against the previous tick's state. Add a test that swaps
   squad ids and asserts identical strike ticks.
5. **Distance-ordered splash** (I4; hours). Sort blast victims by `formationPointContact`
   gap then id before slicing/budgeting (`Battle.ts:1532-1558`).
6. **Volleys that spread** (I5; 1-2 days). For projectile volleys with `perSoldier`, resolve
   the impact as a small blast (radius = target frontage) with the existing budget logic, or
   split `attackScale` across every hostile body the sweep crosses in proportion to swept
   frontage. Balance risk: archers get splash against clumps; cap total at `attackScale`.
7. **Move presentation facts out of authoritative state** (I7; 2-4 days). Keep
   `cavalryMelee` ids/budgets/rank counts, derive `targetBody` from the live target at wave
   time (the test "does not pay a committed wave whose stored paths no longer intersect"
   needs a tolerance), and emit `meleeStrike`/`combatFact` through the volley stream rather
   than squad fields. Reduces checkpoint clone and snapshot size proportionally to cavalry
   count.
8. **Cold-contact cost** (I14; 1 day). Pre-warm `CombatGeometry.body` for squads entering
   `ENGAGEMENT.joinTiles` range during the engagement detect pass, spreading hull/slot builds
   over several ticks; measure on ARM with `RuntimeDiagnostics`.
9. **Fort teeth and coastal interplay** (I11, I12; 2-3 days content + small code). Give
   towers an age-scaled `AttackProfile` (Defences.ts) resolved in the gun-nest loop
   (`Battle.ts:1039`), give archers/artillery `ship` in `targets` with a hull-armour
   penalty, and give warships a weak anti-personnel profile (`targets` + `infantry` bonus)
   so beaches are contested both ways. Balance risk: towers become must-build; keep range
   short (3-4 tiles) and cost high.
10. **Id-free caches** (I10; hours). Store target ids in `hybridAcquisition.hits` and
    re-fetch via `world.squad(id)` with an alive/afloat check.

### Gameplay proposals for legible, decisive battles (Rise of Nations as reference)

- **Attrition in enemy territory** (design 1-2 days): in a per-second pass next to
  `Simulation.replenish`, squads on hostile-owned tiles beyond N tiles from a friendly
  supply building lose `k` wounds/s (scale with age; halved by a general or supply wagon).
  Files: `Simulation.ts` (new `attrition()`), `Protocol` for an "unsupplied" flag the HUD
  can show, `TacticalRules`. Risk: punishes slow sieges; make it visible (icon + tooltip)
  and give forts/supply depots a radius.
- **Border forts that fire** (above): towers with an arrow profile and a capture-progress
  slowdown aura; the AI `TrenchPositioning`/`HillPositioning` missions already know how to
  hold terrain.
- **Morale and rout** (3-5 days): a per-squad `morale` 0-1000 driven by losses/s, flank/rear
  hits, charges received, nearby routs and leader presence; below a threshold the squad gets
  a forced `move` order away from the contact for ~10 s with `fighting=false` and a damage
  multiplier against it; recovers in own territory. Resolve in a ledger after `fight()`.
  This is what makes outcomes decisive instead of mutual annihilation (the I1/I2 fixtures end
  with mutual destruction in 60 s). Risk: cascading routs; cap rout contagion radius.
- **Generals** (2-3 days): a hull-model unit with no attack granting +morale, -attrition and
  a flank-exposure reduction in a 6-tile radius; killable, high xp reward. Hooks:
  `tacticalDefence` modifiers list, `damageAmount` bonus path, HUD modifier string.
- **Ambush / forest cover** (1-2 days): reuse `forestOf(map).coverAt(tile)` to grant
  ranged cover (like trenches) and to hide stationary squads from `acquisition` beyond 3
  tiles unless `fighting`; first strike from concealment counts as a rear arc.
- **Siege phases**: formalise structure attack as "invest" (attrition on garrison/defender
  replenish disabled), "breach" (walls), "assault" (capture); `StructureAttackPreparation`
  already stages positions. Show phase in the HUD instead of per-hit facts.
- **Legibility**: replace `combatFact.modifiers` strings with a small enum set that the
  client renders, and surface three numbers per engaged squad: exposure arc, effective DPS
  ratio (from `engagementEstimate`), and estimated seconds-to-break. These exist today for
  the AI only (`TacticalEstimate.ts`).
- **Over-engineering to consider removing or hiding**: per-slot receiver geometry and
  cavalry lunge lanes are invisible at 500x250 zoom; the strategic layer would be served by
  frontage-based participant counts plus the morale/attrition loop above. Keep the convex
  contact geometry (it is cheap and drives movement) but consider replacing
  `meleeReceivers` with a frontage-slot count (O(1)) once cleave/morale exist.

## Open questions

1. Is the 10.8 s rank-wave cadence intended to stay as the cavalry balance model (I6), or
   was it only a motion prototype? The contract text and the code comment disagree.
2. Should trench cover apply to melee (`Combat.ts:331-333`)? Current code says yes.
3. Is the "three consecutive spearmen" goal still owned by someone, or should the test be
   relaxed to match the authored spear numbers?
4. Should friendly bodies block (or be hit by) volleys? Today only hostile bodies stop a
   shell, which makes screening asymmetric.
5. What is the intended behaviour for neutral (owner 0) buildings created by raid-mode
   defeat (`Simulation.ts:5442`)? They cannot be shot (`Diplomacy.canAttackStructure`
   rejects owner 0) but can be captured by walking in.
6. Are there plans to make `Math.cos/sin/atan2` usage robust to Node upgrades (e.g.
   pinned Node major for the match worker), given the float-based combat (I8)?
