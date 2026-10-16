# 12 — Air and strategic warfare (aircraft, airfields, missiles, nuclear)

Round 2 reviewer. Read-only review; the only file written is this one. Scratch scripts are in
`C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/air/`
(`aimatch.ts`, `perf.ts`, `peacenuke.ts`, `duel.ts`, `packet.ts`, `start.ts`, `units.ts`).

**The working tree changed under me during this review.** Between about 02:30 and 02:47 on 2026-10-16 the owner
started a refactor of exactly this layer: aircraft carriers, 20-drone FPV swarms (`content/DroneSwarms.ts`), a
shared air-base model (`domain/AirBases.ts`), and changes to `AirfieldCapacity.ts`, `Expansion.ts`, `Battle.ts`,
`Recruitment.ts`, `ModernWeapons.ts`, `Units.ts` and `Simulation.ts`. From 02:30 to about 02:40 the content
catalog did not load (`Missing unlock earlymodern-carrier`, `Catalog.ts:65`).

- Every measurement is labelled **"pre-refactor tree (≈02:00–02:25)"** or **"post-refactor tree (≈02:40–02:50)"**.
- Line numbers are from the post-refactor tree, re-checked with `grep -n` at 02:49.
- A snapshot of the in-flux files is in `scratchpad/air/snap0234/`.
- Findings that only concern the new carrier/swarm code are marked **IN-FLUX**. They may be gone by the time you
  read this.

## Scope read

- `src/skirmish/domain/Expansion.ts`:
  - command handlers 577–660 (`recruit-aircraft`, `transfer-aircraft`, `sortie`, `launch`);
  - `aviationBases` / `launchDroneSwarm` / `advanceDrone` / `recruitAircraft` / `completeAircraft` 932–991;
  - `launch` 993–1100;
  - `afterMovement` 1205–1233 and `advanceAircraft` 1235–1346 (to the end);
  - `advanceTransfer` 1348–1365;
  - `thinkProgression` dispatch about 1484;
  - `thinkAirAndStrategic` 1784–1860 (to the end);
  - checkpoint 148/172 and snapshot 1951–1990.
  - I read the pre-refactor versions of the same functions in full too (advanceAircraft was 1229–1344).
- `domain/AirfieldCapacity.ts`, `domain/AirBases.ts`, `content/DroneSwarms.ts`, `domain/MissileInterception.ts`,
  `domain/NuclearWasteland.ts`: all.
- `content/FlightOperations.ts`, `content/MissileDefense.ts`, `content/ModernWeapons.ts`, `content/Defences.ts`:
  all.
- `content/Units.ts`: 150–185 (anti-air vehicle, mobile MIRV launcher) and 528 (carrier); `Rules.ts` 160–230.
- `domain/Battle.ts`:
  - 142–175 (checkpoint, `permissionsAtLaunch`, `canFire`);
  - 329–415 (`fire`);
  - 631–640 and 800–860 (`fight`, anti-air squads);
  - 1162–1290 (`advanceProjectiles`: interception, aircraft-homing shells, MIRV split);
  - 1405–1430 (drone impact);
  - 1480–1600 (blast and nuclear branch).
- `domain/Combat.ts` 68–160 (`damageAmount`); `domain/Recruitment.ts` 245–280; `domain/Diplomacy.ts` 25–60 and
  125; `domain/Definitions.ts` 355–380 (Projectile and Aircraft).
- `Simulation.ts`:
  - 593–596 (`notifyHostileAction`);
  - 2487–2510 (`stepRecruitment`, `refundRecruitment`);
  - 3388–3676 (tick order);
  - 4481 (`fight`);
  - 4629–4631 (`destroyTradersInBlast`);
  - 4780–4880 (fallout capture, `nuclearBlast`, `changeOwner`);
  - 5499–5501 (aircraft removal on elimination).
- AI: `AiMilitaryDemand.ts` 120–146, `AiPlacementCandidates.ts` 198–245, `Trade.ts` 174–188.
- Encoding: `SnapshotCodec.ts` 160–200 (`selectMetadata`), `SnapshotDetails.ts` 330–340 and 765–775, and the
  Expansion snapshot `aircraft` / `fallout` keys.
- Client: `AircraftLayer.ts`, `AircraftView.ts`, `AircraftGroundPresentation.ts`, `NuclearWastelandView.ts` (all);
  `AircraftPresentation.ts` skimmed.
- Tests, all passing on the pre-refactor tree (8 files, 93 tests): `AirfieldTransfer`, `FlightOperations`,
  `StrategicDefense`, `NuclearWasteland`, `BlastNavalTargets`, `BlastOwnershipLifecycle`, `AircraftLayer`,
  `AircraftPresentation`, plus `strategicDefenseProfile.ts`.
- Round-1 context: `05-balance-economy.md` (issue 1, unit table), `06-simulation-perf.md` row 28 and item 10,
  `08-latent-bugs.md` (L7, M4, H2/I1 neutral towers), `08b` I1/I10, `08c` I1.

## How it works today

**Entities.** `Expansion.aircraft: Aircraft[]` is a plain array, checkpointed whole (`Expansion.ts:148/172`).

- An aircraft carries:
  - `airfieldId` (a building id, or since the refactor a carrier ship id);
  - `state` (`ready | outbound | patrolling | returning | transferring`);
  - `fuelTicks` (mission time, not distance), `reloadTick`, `mission`, `atomicPayload`;
  - optional `transfer.destinationId`;
  - since the refactor, optional `drone` {swarmId, index, targetId, targetKind, damage}.
- Capacity:
  - 6 per base (`AIRCRAFT_RULES.airfieldCapacity`) and 32 per faction.
  - Since the refactor a drone swarm (20 entities) counts as one slot (`DroneSwarms.aircraftSlots`).
  - `airfieldAircraftCount` counts an incoming transfer against its destination and releases the source.
  - Queued recruitment jobs are counted in both places.

**Bases.** Before the refactor:

- the per-aircraft base was `world.buildings.find(id, owner, completed)`;
- losing the base, whether destroyed, captured or turned to owner 0, set `health = 0` even while airborne;
- transfers diverted to the nearest free owned airstrip.

After the refactor, `advanceAircraft` builds one `Map` from `airBases(buildings, ships, owners)` per tick
(`Expansion.ts:1238`). Airstrips and drone facilities qualify only if completed, alive and on a tile their owner
owns (`AirBases.ts:12`). Carriers qualify unless refitting.

- Parked aircraft whose base disappears die.
- Airborne aircraft divert to the nearest free base through `advanceTransfer`, or die if none is free
  (`Expansion.ts:1266-1269`).

**Sortie.** Missions are `bombing`, `patrol`, `atomic` and `drone`.

- Validation: ready aircraft, an owned base of the right kind, `flightReachable` (straight distance ≤
  `fuelTicks × speed`) and a valid map point (`Expansion.ts:610-649`).
- Atomic missions consume one `payload:atomic` per bomber up front. The bomb is refunded if the bomber lands
  without having dropped it.
- **There is no diplomacy check on the aim point** (see Issue 1). Area drone swarms filter targets by diplomacy.

**Flight.**

- Speed is `3600/TICKS_PER_SECOND` FIXED units per tick for fighters and bombers (14.06 tiles/s) and half that for
  drones.
- Outbound and patrolling flight burns `fuelTicks`. The return flight is free. Landing refuels and allows an
  immediate re-sortie.
- Fighters on patrol orbit the patrol point with `Math.cos/sin` (`Expansion.ts:1301-1303`) and pursue hostile
  contacts within 24 tiles of the point.
- Bombers fire one `BOMBER_ATTACK` "bomb" projectile at the target: 2500 damage, +2000 vs structures, 20 %
  penetration, 4-tile blast, 1 s fall.
- Atomic bombers fire `ATOMIC_ATTACK`: 24000 damage, 12-tile radius, using the nuclear branch.
- Drones:
  - Pre-refactor, a drone was a single 10000-damage, 3-tile bomb that was immune to every anti-air weapon (it was
    excluded from the target grid).
  - Post-refactor, it is a swarm of 20 × 100 HP members that home on assigned targets. Each member delivers 1/60 of
    the target's maximum health with no splash (`Battle.ts:1411-1424`). Members are now in the anti-air target grid.

**Anti-air.**

- Fighters hit hostile airborne aircraft within 8 tiles for 200 damage every 2 s, applied immediately with
  `enemy.health -= 200` (`Expansion.ts:1283`).
- Warships with `rus-modern-naval-missiles-air-defence` and `anti-air-emplacement` buildings fire
  `NAVAL_AIR_ATTACK`: a 200-damage homing shell, 12-tile range, 2 s reload, through `battle.fire` with
  `targetAircraftId`. The shell re-aims every tick and always hits if the target is still airborne at impact
  (`Battle.ts:1222-1231`).
- Anti-air squads (the `modern-anti-air` vehicle, marked `placeholder: true`, 150 damage, 12 tiles, 2 s) resolve in
  `Battle.fight` by linear scan over all aircraft with immediate damage (`Battle.ts:813-850`).
- Parked (`ready`) aircraft can never be targeted.

**Strategic launch** (`Expansion.ts:993-1100`).

- Launchers: silos (icbm or hydrogen) or MIRV launchers / mobile MIRV launcher squads (mirv).
- Cost: 10000 gold + 1 payload item. Launcher reload is `secondsToTicks(60)`.
- Flight time is a fixed **720 raw ticks** regardless of distance (`Expansion.ts:1092`), which is 90 s at 8 Hz.
- Only a target given as a building id is checked with `canAttackStructure`. A point target is not checked.
- MIRV: the bus splits at 50 % progress into 8 warheads (3000 damage, 3-tile radius each).
  - With a point target, each warhead flies to one of the **8 nearest war-hostile buildings anywhere on the map**,
    with no radius cap (`Battle.ts:1234-1245`).
  - With a building target, all 8 warheads hit that building.

**Interception** (`Battle.ts:1170-1205`).

- Each tick, every unclaimed `icbm`/`warhead` projectile, most imminent first, looks for missile-defence stacks
  (grouped by `owner:tile`) within `missileDefenseRange(10)` = 72 tiles.
- A launcher picks the earliest feasible intercept from `interceptionPoint`, a closed-form quadratic with
  interceptor speed 4 tiles/tick that requires radar contact now. The claim is persisted on the projectile.
- Each launcher reloads for `MISSILE_DEFENSE_RELOAD_TICKS = 400` (50 s at 8 Hz). Range grows with stack size up to
  10.
- The MIRV bus, atomic bombs and conventional bombs can never be intercepted.

**Blasts** (`Battle.ts:1538-1600`).

- `bomb`, `icbm` and `warhead` projectiles are **indiscriminate**: own, allied and peace-protected units and
  buildings are hit. They also destroy every trader in the radius (`Trade.ts:174`).
- Nuclear kinds (`icbm`, `warhead`, `definitionId === "atomic"`):
  - kill every squad and ship inside the radius outright;
  - destroy structures inside 0.8 R;
  - call `Simulation.nuclearBlast`, which scorches land. Each owned tile goes to owner 0 with
    `preserveStructures`, the former owner is charged 100 reserve points per cell, and the cell becomes fallout.
    Fallout can only be cleared by squad capture, at a cost of 10 troops per cell (`Simulation.ts:4790-4836`).
- Conventional bombs have no damage budget and no target cap (`Battle.ts:1569-1571`).
- Aircraft (airborne or parked) are never hit by blasts.

**AI** (`thinkAirAndStrategic`, `Expansion.ts:1784-1860`). Runs every 3 s per AI nation, staggered.

- Recruits up to 4 of each aircraft kind (counted per entity).
- Picks the largest enemy squad and up to 16 enemy structures (cities first).
- Every ready aircraft sorties at the first reachable candidate:
  - fighters patrol over incoming enemy aircraft;
  - drones go first for enemy missile defence;
  - bombers bomb, and use atomic bombs if no "friendly" position is within 16 tiles.
- Launchers fire hydrogen, then icbm (silo) or mirv at the first target with no non-war squad, ship or building
  inside the blast radius.
- Building demand:
  - airstrip, drone facility and nuclear facility get objective 8000 while fewer than 2 exist;
  - silo and MIRV launcher get 7000;
  - an anti-air emplacement gets 8500 only while hostile aircraft are airborne (`AiPlacementCandidates.ts:203-207`);
  - missile defence is wanted up to **10 per city when "wealthy"** (`AiMilitaryDemand.ts:128`,
    `AiPlacementCandidates.ts:239`).

**Replication.**

- `aircraft` and `projectiles` are Expansion metadata keys with no revision. Every packet carries them in full.
- `fallout` has a revision (`Expansion.ts:1951`), and the client redraws the overlay only when the array identity
  changes (`NuclearWastelandView.ts`).

## Strengths

- **Missile interception is closed-form and deterministic.**
  - No sampling or randomness.
  - Persisted claims stop two sites spending a reload on one warhead, and the claims survive restore and
    publication (tests `StrategicDefense.test.ts:89,122`).
  - Most-imminent-first ordering is fair and explicit.
- **Capacity accounting is careful.**
  - Incoming transfers reserve a berth, queued jobs count, and diverted planes compete for the last berth correctly
    (`AirfieldTransfer.test.ts:100,229`).
  - Recruitment refunds escrow when the producer is lost (`Recruitment.ts:262-270`), including fallout edges,
    capture and (post-refactor) carriers.
- **Nuclear land damage is well-specified.**
  - Each prior owner is charged once per cell.
  - Fallout persists through checkpoint and snapshot.
  - Only real squad capture clears a cell, with a troop cost.
  - Covered by `NuclearWasteland.test.ts` (5 tests).
  - The scorch loop is bounded to the blast rectangle; the profile shows an H-bomb's 2453 cells cost well under a
    tick.
- **The refactor fixed the two worst pre-refactor problems:**
  - the O(aircraft × buildings) base scan (see Issue 2);
  - planes dying in the air when their base fell (they now divert).
- **Launch-time diplomacy snapshots** (`permissionsAtLaunch`) are copied onto MIRV children, so a mid-flight treaty
  change cannot retarget an in-flight salvo.
- Tests exist for transfers, flight time, atomic stock, naval anti-air, interception, blast ownership and naval
  blast targets. 93 tests passed on the pre-refactor tree.

## Issues

### 1. Point-targeted strategic launches and bombing sorties bypass raids-v1 diplomacy, so a nuke can take a peace-protected neighbour's land — HIGH, CONFIRMED (executed)

- **Where:**
  - `Expansion.ts:993-1011`: `launch` checks `canAttackStructure` only when `targetBuildingId` is given. The `x,y`
    path checks only `validPosition` and research.
  - `Expansion.ts:610-649`: `sortie` (bombing and atomic) has no target diplomacy check at all.
  - `Battle.ts:1538`: `bomb/icbm/warhead` blasts are indiscriminate.
  - `Battle.ts:1542-1565`: the nuclear branch calls `nuclearBlast`.
  - `Simulation.ts:4825-4836`: every owned tile in the radius goes to owner 0.
  - `Diplomacy.ts:38`: `canCapture(a, 0)` is always true.
- **Mechanism:** a player with Strategic Weapons research and a silo fires `launch` at a point inside the territory
  of a faction they are at peace with, or that is still under raids-v1 peace protection. The warhead lands
  90 s later:
  - every unit in the radius dies;
  - buildings inside 0.8 R are destroyed;
  - every tile goes to owner 0 (fallout).

  Neutral tiles are capturable by anyone. The attacker walks in and takes the land, paying 10 troops per cell.
  No war is ever established. `notifyHostileAction` only alerts AI relations and operations
  (`Simulation.ts:593-596`). The same applies to atomic bombers, and to conventional bombs against units and
  buildings.
- **Repro** (`scratchpad/air/peacenuke.ts`): `diplomacyRules: "raids-v1"`, peace protection {1,2} until tick 1e7.

  | Check | Result |
  |---|---|
  | `protected(1,2)` | true |
  | `canCapture(1,2)` | false |
  | `launch` at a point in player 2's land | `null` (accepted) |
  | the same `launch` with `buildingId` | "Choose an enemy building" |
  | after 740 ticks: owner at target | 0 |
  | after 740 ticks: wasteland cells | 81 |
  | after 740 ticks: `declaredWar(1,2)` | false |
  | `canCapture(1,0)` | true |
- **Consequence:** this breaks the core raids-v1 promise for 8 humans: peace protection cannot be enforced against
  strategic weapons. Griefing a neighbour, or a third party during someone else's war, is free of diplomatic cost.
  The AI checks for bystanders before it launches; humans have no such check.

### 2. Base lookup was O(aircraft × buildings) per tick: 160 ms per tick (desktop) at 1664 aircraft and 1000 buildings — CRITICAL in the pre-refactor tree, FIXED by the refactor; the transfer path still rebuilds bases per aircraft — MEDIUM, CONFIRMED (measured)

- **Pre-refactor:** `advanceAircraft` ran `this.world.buildings.find(b => b.id === a.airfieldId && ...)` for every
  aircraft every tick, parked ones included. Round 1 (`06` item 10) estimated this at 1–2 ms. Measured with
  `scratchpad/air/perf.ts`, airstrips placed late in the building list as they are in a real game (built in the
  Modern age), all aircraft parked, 300 warships, 200 anti-air sites:

  | Buildings | advanceAircraft per tick (desktop) |
  |---|---|
  | 500 | 71 ms |
  | 1000 | 160 ms |
  | 2000 | 318 ms |

  The `find` loop alone was 154 ms at 1000 buildings. At the ARM factor of about 2.5×, even a realistic 400 aircraft
  at 1000 buildings would have cost about 100 ms per tick.
- **Post-refactor** (same script, re-run at 02:45): one `aviationBases()` Map per tick (`Expansion.ts:1238`).

  | Load | advanceAircraft per tick (desktop) |
  |---|---|
  | 1664 aircraft, all parked | 1.2 ms mean |
  | half outbound, firing | 6.6 ms mean (p95 18 ms) |
- **Remaining:**
  - `advanceTransfer` (`Expansion.ts:1348-1350`) calls `this.aviationBases()` (all buildings + all ships, allocating
    an object per base) **for every transferring aircraft every tick**. A diversion also runs `airfieldAircraftCount`
    (O(A)) per candidate base.
  - Measured: 50 transferring planes add 2.6 ms; 200 add 12 ms (desktop, about 30 ms on ARM). Mass transfers by
    8 humans (up to 256 planes) or a carrier fleet re-basing will spike the tick.
- **Fix:** pass the per-tick `bases` map into `advanceTransfer`. Keep a per-tick `occupancy: Map<baseId, count>`
  that is incremented on landing, reservation and recruitment, instead of `airfieldAircraftCount` scans.

### 3. Fighter duels and every immediate anti-air hit are decided by array order — MEDIUM, CONFIRMED (executed)

- **Where:**
  - `Expansion.ts:1272-1291`: a fighter writes `enemy.health -= 200` immediately, and an enemy that is already dead
    is skipped later in the same loop (`if (a.health <= 0) continue`).
  - `Battle.ts:813-850`: anti-air squads, same pattern (round 1 ledger L7).
- **Repro** (`scratchpad/air/duel.ts`): two identical fighters, at war, patrolling the same point.
  - Created first p1, then p2: p1 ends at 200 HP, p2 at 0.
  - Reversed creation order: p2 ends at 200 HP, p1 at 0.
- **Consequence:** with equal fighters, the player whose aircraft entered the array earlier (the older id) always
  wins. That is a systematic bias across 8 humans, and it decides kill credit. Bombers attacked by several fighters
  and anti-air sites die to whichever is iterated first, so XP, kills and stats are order-dependent.
- **Fix:** collect fighter and anti-air-squad hits in a per-tick `DamageLedger` keyed by aircraft. Apply them after
  both loops, the same way projectile impacts already work. Mutual kills then become possible and symmetric.

### 4. Conventional bombers are the dominant late-game weapon: map-wide reach, instant re-sortie, no ordnance cost, indiscriminate uncapped blast, and anti-air that cannot stop a single pass — HIGH (balance), CONFIRMED by arithmetic from source constants

- **Range** (`FlightOperations.ts:11-28`, `flightReachable` 29-36). Range is `fuelTicks × speed` with speed
  14.06 tiles/s.

  | Aircraft | Early Modern range (tiles) | Modern range (tiles) |
  |---|---|---|
  | Bomber | 1687 | 2531 |
  | Fighter | 2531 | 3375 |
  | Drone | 844 | 844 |

  The diagonal of Mediterranean 500×250 is 559 tiles, of 1000×500 is 1118 and of Migration 1000×1000 is 1414. Every
  airstrip therefore reaches the whole map, and **forward airfields and the new carriers have no strategic
  purpose**.
- **Cadence.** Returning burns no fuel and landing refuels instantly (`Expansion.ts:1293`, 1327-1331). There is no
  rearm time, so a bomber 100 tiles from its target strikes about every 15 s.
- **Damage** (`ModernWeapons.ts:15-33`, `Battle.ts:1569-1571`). Each strike hits every unit inside 4 tiles with no
  shared budget and no 64-target cap. Damage falls off from 2500 at the centre to 1250 at the edge, with 20 %
  penetration:

  | Target | HP | Points armour | Damage at centre |
  |---|---|---|---|
  | T-14 | 1500 | 570 | 2500 − 456 = 2044 (one-shot) |
  | Tunguska | 1000 | 0 | 2500 (one-shot) |
  | AK squad | 800 (whole pool) | 25 | one-shot |
  | Machine-gun crew | 200 | 256 | one-shot |

  Cost is 5000 gold once, versus a 5265-gold T-14. The bomb is indiscriminate, so it also kills the bomber owner's
  own engaged troops.
- **Anti-air is too weak to contest a pass.**
  - An anti-air emplacement or warship does 200 damage per 2 s within 12 tiles. A bomber crosses a 24-tile bubble in
    1.7 s, so it takes at most 1–2 shots on the way in and out (200–400 of its 1000 HP). Five passes are needed per
    emplacement.
  - The anti-air vehicle does 150 per 2 s and is a placeholder.
  - A fighter does 200 per 2 s, needs 10 s on target, and has the same speed as a bomber, so it cannot catch a
    retreating one.
  - Atomic bombs cannot be intercepted by missile defence, because the `incoming` filter only accepts
    `icbm`/`warhead` (`Battle.ts:1172`). The atomic bomber is therefore the most reliable nuclear delivery
    (24000 damage, 12-tile radius, about 452 fallout cells) and is stopped only by this weak anti-air.
- **Consequence:** once airstrips exist, the Modern ground game (already "whoever shoots first", see `05` issue 1)
  becomes "whoever has bombers". This is not yet visible in AI matches only because the AI almost never fields
  bombers (Issue 6).

### 5. Missile-defence timing: 08c I1 is half right — reload and cadence shifted, the speed ratio did not — MEDIUM, CONFIRMED (git history + source)

- **Where:** `MissileDefense.ts:3-4` (400 ticks, 4·FIXED per tick); `Expansion.ts:1092` (ICBM flight time is a raw
  `720` ticks); `ModernWeapons.ts:35` (`STRATEGIC_RULES.reloadTicks = secondsToTicks(60)`). At `185be868`
  (20 Hz) the launcher reload was the raw value 1200.
- **Correction to 08c I1:**
  - ICBM flight time is also in raw ticks, so the interceptor-to-missile speed ratio in tick space is unchanged.
    `interceptionPoint` geometry, and which shots are feasible, are identical to 20 Hz.
  - What changed in wall clock: ICBM flight went from 36 s to 90 s, and defence reload from 20 s to 50 s.
  - The launcher reload stayed at 60 s because it was converted to seconds. Per silo salvo, defence shots fell from
    3.0 to 1.2, and two missiles from one silo can now be airborne at once.
  - The MIRV bus splits at 45 s; it used to split at 18 s.
- **Consequence:**
  - Strategic exchanges are 2.5× slower in wall clock, and defence is 2.5× weaker relative to offence.
  - The AI compensates by spamming defence (Issue 6).
  - `StrategicDefense.test.ts` passes because it works in ticks.

### 6. AI air play is almost absent; missile-defence spam and launch spam instead — MEDIUM, CONFIRMED (executed)

**Runs** (`scratchpad/air/aimatch.ts`): 300×200 flat land, 4 AI nations plus 1 idle human, Modern start,
`DEFAULT_AI_POLICIES`, `alliances: true`.

- **Natural, 20 simulated minutes (post-refactor tree):**
  - zero air, anti-air or strategic commands, no wars, 19 builds in total;
  - at the start the AI already has `rus-earlymodern-airfields`, `-bombers` and `-nuclear-weapons`, 76.5k gold and
    a city;
  - after 10 minutes it has 28.5k gold, has researched 2 technologies, and has never built an airstrip (7000 gold).
- **Boosted** (all technologies, 2M gold, payload stock, wars declared at tick 80), 15 simulated minutes:
  - **Pre-refactor:**
    - 21 missile-defence buildings by minute 8, before any enemy had a silo;
    - first drone facility at 9.7 minutes, first airstrip at 12.9 minutes;
    - 16 drone sorties, 3 MIRV launches, 19 "Launcher is reloading" rejections;
    - 1 fighter patrol, no bomber sortie, no anti-air emplacement, no anti-air vehicle.
  - **Post-refactor:** 22 drone-swarm sorties, 2 MIRVs, 19 reload rejections, no airstrip at all, no anti-air.

**Causes:**

- `AiMilitaryDemand.ts:128` and `AiPlacementCandidates.ts:239` want **10 missile-defence buildings per city when
  wealthy**, whatever the threat. With 14 AI nations that is several hundred extra buildings, which inflates every
  O(B) scan.
- The anti-air emplacement is purely reactive and limited to 2 (`AiPlacementCandidates.ts:207`).
- The airstrip objective of 8000 keeps losing to other objectives.
- `thinkAirAndStrategic` re-issues `launch` without checking `launchReadyTick` (`Expansion.ts:1831-1858`).

### 7. AI bombing ignores its own troops; AI atomic check ignores other factions' buildings and ships — MEDIUM, CONFIRMED (code)

- **Where:** `Expansion.ts:1816-1829`.
  - Conventional bombers take `targets.find(reachable)`. The first target is the largest enemy squad, often in melee
    with the AI's own troops, and there is no friendly check even though the bomb is indiscriminate.
  - The atomic check uses `friendly` = squads not at war + the AI's **own** building positions. Allied, peaceful and
    third-party buildings and ships are not checked.
  - Compare the ICBM path, which builds `protectedPositions` including ships and buildings (`Expansion.ts:1836-1839`).
- **Consequence:**
  - AI bombers kill their own front line.
  - An AI atomic strike can raze a peace partner's buildings and neutralise its land (fallout), the AI-side version
    of Issue 1.

### 8. Anti-air squads and homing anti-air shells scan every aircraft linearly; drone swarms multiply the entity count — MEDIUM (perf), SUSPECT magnitude

- **Where:**
  - `Battle.ts:813-822`: every anti-air squad filters and sorts all aircraft every tick.
  - `Battle.ts:1223`: `aircraft.find` per homing projectile per tick.
  - `Expansion.ts:948-955` (IN-FLUX): a swarm creates 20 aircraft entities but counts as 1 of the 32 slots
    (`DroneSwarms.ts:6-10`).
- **Consequence:** a human can have up to 32 × 20 = 640 drone entities. With 8 humans plus AI, A in the thousands
  times hundreds of anti-air squads means 10^5–10^6 distance and diplomacy checks per tick. The
  `airTargets` SpatialGrid (`Expansion.ts:1236`) already exists, but it is built after `fight`.
- **Fix:**
  - Rebuild the airborne grid once at the start of the combat phase and have `Battle.fight` query it.
  - Keep an id → aircraft `Map` for the homing shells.
  - Count drone members against a per-faction entity cap, for example 160.

### 9. Aircraft and projectiles go to every client in full in every packet — LOW–MEDIUM (network), CONFIRMED (measured)

- **Where:** `Expansion.ts:1984` puts `aircraft` (and `projectiles`) into the snapshot. They have no revision in
  replication metadata (ledger line 1155), so `SnapshotCodec.ts:166-175` copies them on every encode.
- **Measured** (`scratchpad/air/packet.ts`, post-refactor tree):
  - about 18–20 base64 characters (about 14 bytes) per moving aircraft per packet after compression;
  - 1664 aircraft add 31 KB per packet, about 155 KB/s per client at 5 packets/s.
- There is no fog of war: enemies see `mission: "atomic"`, `atomicPayload` and the target point of every sortie.
- **Fix:**
  - Add a revision (bumped by any state, position or health change).
  - Send a compact row (id, owner, kind, state, x, y, health, a heading byte) in place of the whole object.
  - Strip `target`, `mission` and `atomicPayload` for non-owners.

### 10. Silos, missile defence and anti-air keep working on neutral fallout while airfields there stop working — LOW, CONFIRMED (code)

- **Where:**
  - `AirBases.ts:12`: an airfield needs `owners[tile] === playerId`.
  - `launch` (`Expansion.ts:1013-1020`) has no tile-owner check.
  - The interception stack (`Battle.ts:1176-1180`) uses `buildingFacts().completed` with no tile check.
  - The anti-air emplacement loop (`Expansion.ts:1250-1258`) has no tile check either.
- **Consequence:** after a blast, an edge silo can still launch and an edge defence can still fight, while an edge
  airstrip grounds its planes, kills the parked ones and refunds its queue. The rules are inconsistent, and players
  will read it as a bug either way.

### 11. MIRV retargeting is global and recomputes distance inside the comparator — LOW, CONFIRMED (code)

- **Where:** `Battle.ts:1234-1245`.
- **Mechanism:** with a point target, the warheads go to the 8 nearest war-hostile buildings on the whole map, with
  no radius cap. A MIRV aimed at an empty field therefore strikes buildings hundreds of tiles away. The sort calls
  `this.position()` and `distance` inside the comparator, which is O(B log B) with allocation, once per split.
- **Fix:**
  - Limit candidates to `spatial structures.query(toX, toY, 24·FIXED)`.
  - Precompute the distances.
  - If there are no candidates, fall back to the aim point plus `droneOffset`-style dispersion.

### 12. Anti-air emplacement volleys bypass the 4096 volley cap — LOW, CONFIRMED (code)

- `Expansion.ts:1256` pushes to `world.volleys` unconditionally. Fighter guns (`Expansion.ts:1284`) and
  `Battle.ts:1429` check `< 4096`.

### 13. Losses not recorded when parked aircraft die with their base, or drones expire — LOW, CONFIRMED (code)

- `Expansion.ts:1268` (and pre-refactor 1262) sets `health = 0` without `recordMilitaryLosses`. Military-loss and
  conquest stats undercount air losses from airfield capture, bombing and nukes.

### 14. Floating-point trigonometry in authoritative flight — LOW (determinism), CONFIRMED (code)

- `Expansion.ts:1301-1303` (`Math.cos/sin` patrol orbit) and `Math.hypot` steering everywhere. This is fine for one
  authoritative server process, but a checkpoint resumed on a different engine or CPU (for example, the planned
  desktop to ARM moves) is not guaranteed to reproduce bit-identical aircraft positions. Use a 64-entry integer
  sine table indexed by `(tick·k + id) & 63`.

### 15. Shared 4096 projectile cap can block strategic launches and bombs — LOW, SUSPECT

- `Battle.ts:172` `canFire` counts every projectile, arrows and shells included, plus reserved warheads. In a
  52-faction battle peak, `launch` returns "Strategic flight capacity reached". Bombers at the target `continue`
  without firing (`Expansion.ts:1323-1338`), circling until their fuel runs out. Reserve a separate budget, for
  example 256 for `bomb/icbm/mirv/warhead`.

### 16. IN-FLUX: carrier-based aircraft have no ground presentation; AI counts swarm members, not slots — LOW, SUSPECT (refactor in progress)

- `AircraftGroundPresentation.ts:48-51` builds `fields` from airstrip buildings only. An aircraft whose
  `airfieldId` is a carrier gets no ground state, so `pose()` returns the full-size flying pose. Parked carrier
  planes are drawn in the air over the ship.
- `Expansion.ts:1795-1798` caps the AI at fewer than 4 per kind using `this.aircraft.filter(...).length`. While a
  swarm (20 members) is airborne, the AI stops recruiting drones. This may be intended; `aircraftSlots` is the
  consistent measure. The AI never uses carriers.

### 17. Design notes (no defect)

- Parked aircraft, and airborne aircraft inside a nuclear radius, are untouched by blasts. Losing the base is the
  only ground threat.
- ICBM flight time does not depend on distance (720 ticks for 10 tiles or 1000).
- A hydrogen bomb (28-tile radius, 2463 cells) kills every unit of every faction inside it. With 52 factions on
  500×250 that is likely to hit bystanders. The protection check is AI-only, see Issue 1.

## Recommendations (prioritised)

1. **Gate strategic and air strikes by diplomacy (Issue 1). Effort S (half a day + tests).**
   - In `launch`, and in `sortie` for `bombing`/`atomic`, compute the blast radius (`STRATEGIC_PAYLOADS[p]` or
     `ATOMIC_ATTACK`/`BOMBER_ATTACK.projectile.blastRadius`).
   - Reject with "Target area includes protected or allied forces" if any tile owner, squad, ship or building inside
     the radius belongs to a faction `f` with `diplomacy.allied(player, f) || diplomacy.protected(player, f)`.
   - For a non-allied, non-protected faction that is not at war, call `diplomacy.establishWar(player, f, tick,
     "strike")` before launching. The AI's `protectedPositions` check becomes a server rule.
   - Tests in `StrategicDefense.test.ts`:
     - (a) point launch into peace-protected land is rejected and changes no state;
     - (b) a point launch at a neutral, non-war faction declares war;
     - (c) an atomic sortie over an ally is rejected.
2. **Per-tick ledger for fighter and anti-air-squad hits (Issue 3). Effort S.** Stage hits in a `DamageLedger`, apply
   them after `advanceAircraft` and `fight`, and credit kills in id order of the attacker. Contract test: a mirrored
   fighter duel ends identically when creation order is swapped (both die, or both survive at equal HP).
3. **Air balance pass (Issue 4). Effort M.**
   - Concrete numbers:

     | Parameter | Today | Proposal |
     |---|---|---|
     | Combat radius (new `FLIGHT_RULES[kind].radiusTiles[age]`, used by `flightReachable` for sorties; transfer = 2× radius) | whole map (fuel × speed) | fighter 120 / 180, bomber 160 / 240, drone 60 / 90 (Early Modern / Modern) |
     | Rearm/turnaround after landing (`a.rearmTick`; `sortie` rejects until then) | none | bomber 20 s, fighter 8 s |
     | Ordnance per bombing sortie | none | `payload:bomb` item, 400 gold equivalent at the arms factory, or 400 gold |
     | Conventional bomb budget (`Battle.ts:1569`) | Infinity, no target cap | `(damage + bonuses) × 6` = 27k, target cap 24 |
     | Conventional bomb damage | 2500 | 1800 (two-shots a T-14, one-shots infantry pools) |
     | Anti-air emplacement | 200 dmg / 2 s, 12 tiles | 350 dmg / 1 s, 14 tiles (about 3–4 shots per pass, so one site kills one bomber per in-and-out pass) |
     | Naval anti-air | 200 / 2 s | 250 / 1 s |
     | Anti-air vehicle (`Units.ts:170-178`; and remove `placeholder`) | 150 / 2 s | 250 dmg / 1 s, 14 tiles |
     | Fighter | 3600/TPS speed, 200 / 2 s | 4500/TPS speed, 250 dmg / 1 s |
     | Atomic bombs | not interceptable | add `definitionId === "atomic"` bombs as interceptable targets in the `incoming` filter (`Battle.ts:1172`), or require fighter escort |
   - Contract tests, in the style of `PreModernBalance.test.ts`, as a new `tests/skirmish/AirBalance.test.ts`:
     - (a) `damageAmount(BOMBER_ATTACK, defenceOf(T-14))` is below T-14 HP and above HP/2;
     - (b) a bomber flying straight through one anti-air emplacement's 14-tile radius and back dies (real
       `game.step()` loop);
     - (c) a fighter on intercept kills a bomber in ≤ 5 s;
     - (d) a sortie beyond `radiusTiles` is rejected;
     - (e) after landing, a re-sortie before `rearmTick` is rejected;
     - (f) a per-gold table (bomber vs T-14 vs howitzer: damage per 60 s against a 10-unit Modern stack) stays
       within a 2× band.
4. **Express strategic timing in seconds (Issue 5). Effort XS.**
   - `STRATEGIC_FLIGHT_TICKS = secondsToTicks(36)` (replacing the raw `720`, `Expansion.ts:1092`).
   - `MISSILE_DEFENSE_RELOAD_TICKS = secondsToTicks(20)`.
   - `MISSILE_DEFENSE_SPEED = 80 * FIXED / TICKS_PER_SECOND` (10 tiles/tick at 8 Hz).
   - This restores 20 Hz wall-clock behaviour exactly: 36 s flight, 3 defence shots per silo cycle.
   - Extend `SimulationTiming.test.ts` "preserves … rates in seconds" with all three, and assert that
     `interceptionPoint` returns the same feasibility at 8 and 20 Hz for a scripted 400-tile ICBM.
5. **Fix AI strategic sanity (Issues 6, 7). Effort S–M.**
   - Missile-defence demand should be `min(5, 1 + enemyStrategicThreat)` per city, where the threat is the number of
     enemy silos, MIRV launchers and launcher squads, or payload stock seen. Drop "wealthy → 10".
   - Proactive anti-air emplacement: 1 per city once any war enemy owns an airstrip, drone facility or carrier;
     2 per frontier city once enemy aircraft are seen.
   - Bomber target filter: reject a target with own or non-war squads within `BOMBER_ATTACK` blast radius + 2 tiles.
   - Atomic: reuse `protectedPositions`.
   - Skip launchers with `launchReadyTick > tick`.
   - Raise the airstrip objective to 9000 once an enemy is at war and gold exceeds 20k.
   - Tests: an AI with bombers adjacent to its own engaged squad does not sortie on it; an AI with a reloading silo
     issues no `launch`.
6. **Transfer path and anti-air scans (Issues 2, 8). Effort S.** Thread the per-tick `bases` map and an occupancy
   map into `advanceTransfer`. Build the airborne SpatialGrid before `fight` and have anti-air squads query it.
   Use an id → aircraft Map for homing shells. Add a perf contract: 1664 aircraft + 1000 buildings + 200 transfers,
   `advanceAircraft` under 5 ms desktop (the `scratchpad/air/perf.ts` scenario).
7. **Replication of aircraft (Issue 9). Effort S.** Revision plus a compact row; hide mission and target from
   non-owners.
8. **Consistency fixes (Issues 10–13, 15). Effort XS each.**
   - A tile-owner check for silos, missile defence and anti-air on fallout (or document the difference).
   - A MIRV radius cap.
   - The volley cap.
   - `recordMilitaryLosses` on base-loss deaths.
   - A separate strategic projectile budget.

## Open questions

- Is the global reach of aircraft intended, given that "fixed flight time by class/age" is tested in
  `FlightOperations.test.ts:66`? If so, carriers and forward airfields need another purpose, such as rearm time or
  sortie rate.
- Should a strategic strike on a non-war, non-allied faction declare war automatically, or be refused outright
  under raids-v1?
- Pre-refactor drones were deliberately immune to fighters and naval defence (`FlightOperations.test.ts:178`). The
  swarm refactor puts them in the target grid. Is that intended? If so, that test needs updating.
- Should parked aircraft be destroyable by bombing or nukes on their airfield, without destroying the airfield
  itself?
- Is the 720-tick (90 s) ICBM flight a deliberate slowdown after the move to 8 Hz, or a leftover from 20 Hz?
