# 20 — Naval combat and naval balance (round 2)

Reviewer scope: naval combat resolution, warship AI behaviour on the ship itself, naval balance per age,
land/sea interplay, trade raiding, as a prerequisite for a pirate pop-up faction (04-ai.md design).
Tree read on 2026-10-16 (after the round-1 drift). All line numbers below were re-checked with
`grep -n`/`sed -n` on the current working tree.

Measurements come from throwaway harnesses that drive the **real** `Skirmish` (`game.step()`, full
tick, `runAi:false`, ruleset `ages-v1`) on synthetic open-sea maps:
`C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/naval/`
(`common.ts`, `duel.ts`, `trace.ts`, `bias.ts`, `bombard.ts`, `transports.ts`, `piracy.ts`,
`research.ts`, `livelock.ts`, `entry.ts`, `entry2.ts`, `subpick.ts`, `costs.ts`). Run with
`npx tsx <file> [args]` from the repo root. Existing naval tests were run read-only and pass
(`NavalInterception`, `WarshipPatrolRepair`, `BlastNavalTargets`, `CoastalPatrol`, `TransportHandoff`,
`RaidDiplomacy`: 6 files, 83 tests).

## Scope read

- `src/skirmish/domain/NavalCombat.ts` 1-160 (all)
- `src/skirmish/Simulation.ts`: 193-195 (warship constants), 411-445 (transportVessel/amphibious),
  511-516 (aiCanPursue), 1228-1265, 2357-2400 (spawnSquad afloat), 2535-2618 (recruitShip),
  2620-2692 (sail/setShipVoyage/quietPatrolWindow), 2693-2738 (moveShip), 2740-2745 (navalVelocity),
  2746-2964 (fightShips), 2966-2992 (resolveNavalDamage), 3000-3160 (dock search, patrol wander,
  recovery voyage, autonomousVoyage, hasNavalOpponents, autonomousNavalPursuit), 3200-3366
  (stepWarships), 3368-3445 (performTick ship phase incl. raids entry/protection), 3600-3670 (land
  entry rule, fight order, coastal territory, stepWarships call), 3755-3775 (afloat speed),
  4575-4625 (resolveLandDamage afloat hull), 5300-5325 (legacy AI ship recruit).
- `src/skirmish/ShipMovementAdmission.ts` 119-400 (finish, recover/resume, valid, completed, step).
- `src/skirmish/content/Units.ts` 58-73 (profile), 438-528 (VESSELS, TRANSPORT_CAPACITIES, submarines).
- `src/skirmish/content/ShoreTransport.ts` 1-17, `content/CoastalTerritory.ts` 1-33,
  `content/Defences.ts` 1-26 (GUN_NEST_ATTACK), `content/ModernWeapons.ts` 1-47,
  `content/Buildings.ts` 95-125 (cost, buildingIntegrity).
- `src/skirmish/domain/RefitQuote.ts` 1-120, `Refitting.ts` 1-15, `CoastalPatrol.ts` 1-53,
  `CoastalReach.ts` 1-41, `AiNavalBombardment.ts` 1-243, `TransportHandoff.ts` 1-88,
  `CoastalTerritory.ts` 1-156, `ResearchEffects.ts` 1-70, `Combat.ts` 1-240 (damageAmount,
  scaledAttack, SHIP_DEFENCE), `Diplomacy.ts` 30-130 (canSteal, recordTheft, establishWar, hostile).
- `src/skirmish/domain/Trade.ts` 100-235 (sea index, raidTargets), 1187-1300 (capture loop).
- `src/skirmish/domain/Battle.ts` 300-320 (afloat tags), 329-400 (fire, naval aim), 520-563
  (structuralHit), 1055-1110 (gun nests), 1490-1620 (projectile impact, splash budget).
- `src/skirmish/domain/Expansion.ts` 333-343 (transport/vessel), 650-708 (refit-ships, naval-priority,
  naval-attack), 1140-1150 (ship refit tick), 1228-1245 (naval AA), 1770-1795 (fallback recruit).
- `src/skirmish/domain/AiNavalPlanner.ts` 75-92 (navalPower/navalReady), 636-700 (raid-trade,
  intercept), 840-860 (vessel choice).
- `src/skirmish/PortWaterAccess.ts`, `LandingOccupancy.ts`, `BuildingFootprint.ts` 1-60,
  `FactionRules.ts` 1-36, `Rules.ts` 232-260, `PhaseSpatialViews.ts` 85-130.
- Context notes: `03-combat.md` (naval section, I11, I12, rec. 9), `04b-ai-economy-naval.md`,
  `05-balance-economy.md` issue 8, `04-ai.md` pirate design, `08-latent-bugs.md` (L8, P35, refuted table).

## How it works today

### Catalogue (`content/Units.ts:438-528`)
One warship class per age (plus EarlyModern/Modern submarines that are byte-identical clones at
1.25x cost), one transport class, one merchant class. Formulae for age index `i`:

| | warship | transport | merchant |
|---|---|---|---|
| gold | 700(i+1) (`:462`) | 300(i+1) (only legacy hull purchase; shore embark is free) | 300(i+1) |
| health | 1000·1.3^i (`:486`) | 2 (i<4) or 3 (i≥4) same-age warship hits vs ship armour (`:466-484`) | 600·1.3^i (**unused**: traders are `TradeActor`s with no health) |
| attack | ranged 160·1.3^i, range 7+i tiles, reload 2 s, targets `["ship","structure"]` (`:494-513`); shells with 1-tile blast from LateMedieval (i≥4) | none | none |
| speed (tiles/s) | 4.30 + 0.47i | 80 % of warship+ | 5.47 + 0.47i (faster than warships) |

Printed per age by `costs.ts` (frontline squad gold for scale: 60 Stone … 810 Modern).
Ship armour is `SHIP_DEFENCE` 10 % melee / 20 % ranged (`Combat.ts:208-213`); structures take
35 % (`Simulation.ts:2920-2930`). Caps: humans 64 warships, AI 32, tribes 24 (`FactionRules.ts:31-36`,
`Rules.ts:259`). Research: Stone "coastal navigation" (+10 % speed, -10 % reload, +25 % capacity), each
later age "ship improvements" (+10 % health, -5 % reload), Modern missiles (+15 % damage, +1 range)
(`ResearchEffects.ts:28-70`).

### Tick order (`performTick`, `Simulation.ts:3368-3670`)
ships move (`moveShip`, with raids-rules protection revert and "entry" war at `:3436-3444`) → land
movement → `fight()` (land, gun nests) → `fightShips()` → captures / coastal territory →
`stepWarships()` (repair state machine, autonomous pursuit, patrol) → recruitment. Trade
(`Trade.step`, capture-by-contact) runs inside `expansion.beforeStep`.

### fightShips (`Simulation.ts:2746-2964`)
Ships iterate by id (`:2763`). A ship with no explicit target and no naval opponent skips. Effective
damage is **scaled by the shooter's own health fraction** (`scaledAttack(profile, ship.health,
vessel.health)` `:2772`, `damageAmount(..., Math.round(1000*health/maxHealth))` `:2785`). Candidate
targets: hostile ships and afloat squads within range on the same water component, LOS-clear;
rank = navalPriority (transports first by default), then distance, then id (`:2803-2813`). Overkill
avoidance: `incomingNavalDamage` rebuilds reservations from in-flight shells each tick and instant
hits are added to `committed` (`NavalCombat.ts:101-160`). Pre-LateMedieval ships hit instantly through
a `DamageLedger` (simultaneous); later ships fire shells with constant-velocity lead (`navalAim`).
Explicit `naval-attack` targets (ship, afloat squad or structure) bypass committed checks and
synchronously re-plan an approach every 3 s when out of range/LOS (`:2852-2893`).

### Damage application
Ships: `resolveNavalDamage` (`:2966-2992`), sinking removes embarked legacy cargo. Afloat squads:
`resolveLandDamage` hull branch (`:4583-4605`): the hull absorbs every hit, passengers take 50 % of
hull damage proportionally, hull 0 kills everyone aboard.

### Warship self-management (`stepWarships`, `:3200-3366`)
States `patrolling → returning-to-dock → repairing → returning-to-patrol`, plus `waiting-for-dock`.
**Any** damage (`health < max`, `:3212`) plus 3 s out of combat sends the ship to the nearest free
friendly port (one ship per port, `:3328-3348`); repair is free, 10 %/s (`:3240-3244`). Healthy idle
ships run autonomous pursuit within 32 tiles of their patrol anchor (16-tile sample, every 0.5 s,
transports first, then ships, then enemy sea traders, `:3153-3198`), else wander ±2 tiles.

### Trade raiding (`Trade.ts:1225-1257`)
Every non-retired sea trader queries warships within 1.2 tiles each tick; the lowest-id hostile
warship that `canSteal` captures instantly: cargo value is moved to `capturedValue`, ownership flips,
state `prize`, 1 s handling wait. Under raids-v1, `canSteal` = non-allied, not peace-protected, and
(war, or the captor is a human warship, or an embargo exists) (`Diplomacy.ts:41-47`). Merchants
cannot be shot (they are not `Ship`s).

### What can hurt what (verified)
| attacker → target | warship | afloat squad (transport) | land troops | structures |
|---|---|---|---|---|
| warship | yes | yes | **no** (`Units.ts:503`, splash also 0 via tag check) | yes |
| land troops (any age) | no | **no** (afloat → `ship` tag, `Battle.ts:306-312`) | yes | yes |
| gun nest (Modern) | **no** (queries ground spatial only, `Battle.ts:1072`) | yes | yes | – |
| tower (all ages) | no weapon (03 I11) | no | no | – |
| bombers / drones / nukes (Modern) | yes (`ModernWeapons.ts:15-33`) | yes | yes | yes |

So **before Modern aircraft, the only thing that can damage a warship is another warship.**

## Measurements

### M1. Same-age duels (`duel.ts mirror`, `trace.ts`)
1v1, 16-tile start gap, both ships autonomous:

| age | 1v1 outcome | time |
|---|---|---|
| Stone, Bronze, Classical | both sink on the same tick | 93.5 / 95.3 / 97.1 s |
| EarlyMedieval | **both stuck at 1 HP forever** (still fighting at 300 s) | ∞ |
| LateMedieval…Modern (shells) | decided by which first shell lands (see M3) | 23-30 s |

Trace (Stone): hits 128 → 111 → 97 … → 1 per volley; health 1000·0.872^k; 47 volleys.

4v4 / 12v12 same-age: 19-56 s, typically 1-7 survivors on the winning side, i.e. near-mutual
annihilation.

### M2. Equal-gold fleet matrix (`duel.ts matrix 16800`)
Budget 16 800 gold per side (fleet sizes `floor(16800/cost)`), rows = side A age, cols = side B age.
Cell: `nA v nB : winner, time, survivors A/B, eff = gold B lost / gold A lost`.

| A \ B | Bronze | Classical | EarlyMed | LateMed | Napoleonic | EarlyModern | Modern |
|---|---|---|---|---|---|---|---|
| **Stone** (24) | 24v12 A 14 s 22/0 eff 12 | 24v8 A 11.8 s 23/0 eff 24 | 24v6 A 11.4 s 22/0 eff 12 | 24v4 A 13.3 s 16/0 eff 2.5 | 24v4 B 38.8 s 0/2 | 24v3 B 18.6 s 0/3 | 24v3 B 22.8 s 0/2 |
| **Bronze** (12) | – | 12v8 A 23.6 s 8/0 eff 3 | 12v6 A 21.4 s 8/0 eff 3 | 12v4 A 17.5 s 9/0 eff 3.3 | 12v4 B 17 s 0/4 | 12v3 B 19 s 0/3 | 12v3 B 14.6 s 0/3 |
| **Classical** (8) | – | – | 8v6 B 43 s 0/1 | 8v4 B 33 s 0/2 | 8v4 B 27 s 0/3 | 8v3 B 29 s 0/2 | 8v3 B 16.6 s 0/3 |
| **EarlyMed** (6) | – | – | – | 6v4 A 19 s 4/0 eff 2.5 | 6v4 B 41 s 0/2 | 6v3 B 25 s 0/2 | 6v3 B 16.8 s 0/3 |
| **LateMed** (4) | – | – | – | – | 4v4 B 18.8 s 0/3 | 4v3 B 20.8 s 0/2 | 4v3 B 12.8 s 0/3 |
| **Napoleonic** (4) | – | – | – | – | – | 4v3 A 32.6 s 1/0 | 4v3 B 20.6 s 0/2 |
| **EarlyModern** (3) | – | – | – | – | – | – | 3v3 B 18.6 s 0/2 |

Anomalies: (a) Stone and Bronze spam beat **every** pre-gunpowder fleet of equal gold with 2.5-24x
gold efficiency, and Stone beats Bronze 12:1. (b) Classical is the worst age in the table (loses to
everything after it, beats nothing). (c) EarlyMedieval beats LateMedieval at equal gold. (d)
Napoleonic beats EarlyModern at equal gold (shell blast on clustered fleets plus cheaper hull).
(e) The gunpowder transition (LateMed → Napoleonic, shells + 1-tile blast) is the only place where
the newer age reliably wins. Because a port of tier ≥ the vessel's age may build any researched
older hull at its old price (`Simulation.ts:2565`), anomaly (a) is reachable in real games until
the 64-ship cap binds.

### M3. Id-order / geometry sensitivity (`duel.ts mirror`, `bias.ts`)
Same geometry, only id allocation swapped: the winner flips in **7 of 24** mirrored cases
(Stone 4v4, EarlyMed 12v12, LateMed 12v12, EarlyModern 1v1/4v4/12v12, Modern 1v1). Stationary
in-range 1v1 (`bias.ts`, ships 6 tiles apart): when A has the lower id, A's first shell misses and A
is sunk while B keeps 3-22 % hull; with ids swapped both shells hit and both are still alive at
1-2 % after 60 s. Mechanism: id-derived sub-cell lanes (`Simulation.ts:2706`, `ship.id%4` when no AI
lane), pursuit cadence `(tick+id)%4` (`:3156`), patrol wander phase (`:3104`) change where the target
is when a shell lands; the health-scaled damage (I1) turns any first-hit asymmetry into a decisive
result.

### M4. Warship vs coastal structures (`bombard.ts`)
One warship, explicit `naval-attack`, same-age structure at `buildingIntegrity` health:

| age | port / city | gun nest | tower | warship damage taken |
|---|---|---|---|---|
| Stone…EarlyMed | 42-45 s | 41-45 s | 70 s | **0** |
| LateMed…Modern | 57-60 s | 57-59 s | 93-98 s | **0** |

The gun nest never fires at the ship (it only queries ground squads). A lone 700-gold Stone warship
levels a coastal city in 45 s with no possible response from land.

### M5. Warships vs transports (`transports.ts`)
3 warships vs 12 afloat frontline squads parked in range: Stone…EarlyMed all 12 sunk in 14.1 s
(17 hulls/min/warship); LateMed…Modern all 12 sunk in 24.3 s (9.9 hulls/min/warship). Every squad
aboard a sunk hull is lost. With transport speeds 3.4-6.1 tiles/s and warship range 7-14 tiles, a
landing wave crossing one warship's full engagement diameter is exposed ~4-4.6 s, i.e. 2-3 volleys per
warship → roughly one squad lost per defending warship per crossing (derived from the measured rate).
Land troops on the beach cannot shoot the transports at all.

### M6. Trade raiding (`piracy.ts`)
- Unescorted Stone merchant, raider 6 tiles ahead on its lane: captured after 1.4 s.
- Same with an escort warship 1 tile from the merchant: captured after 2.25 s anyway; escort and
  raider then spend 60 s grinding each other to 19 HP (M1 decay); the prize sails off to the raider's
  port. The escort's presence has no effect on capture.
- Escort and raider both within 1.2 tiles of a merchant, trade-only stepping: ownership flips 5 times
  in 6 s; `capturedValue`/`lostValue` grow to 10x the cargo's value (`{"1":3500,"2":5000}` for a 500
  gold cargo).

### M7. Research and refit health (`research.ts`)
- Four full-health Bronze warships on station; owner completes Bronze ship improvements: within 8 s all
  four have left station (`waiting-for-dock`/`returning-to-dock`) because max health rose 1300 → 1430;
  they cycle through the single port for ~60 s.
- Stone → Modern refit: 2 358 gold net (2 600 list) and the ship comes out at **1000 / 6275** health,
  dealing 16 % damage until it has been repaired (free) at a port.

### M8. Repair livelock (`livelock.ts`)
Damaged ship (400/1000) in `returning-to-dock`; player orders a `naval-attack`; target disappears.
For the next 120 s the ship alternates `repairing` ↔ `returning-to-dock` every tick (480 ticks each),
health stays 400, and it keeps its port's repair slot. Same result with `deferredPlanning` on and off.

### M9. Raids-rules "entry" by ships (`entry.ts`, `entry2.ts`)
raids-v1, player 1 human, player 2 AI owning a 4-10 tile band of coastal water:
- `sail` across the band: war `{cause:"entry", initiator:1}` on the first tile entered.
- A human warship left idle one tile outside the band with **no orders**: war declared after 1.4 s by
  its own ±2-tile patrol wander.

## Strengths

- Overkill avoidance from canonical projectiles (`incomingNavalDamage`) is replay-safe, cheap and
  releases reservations for known misses; it is checkpoint-reconstructible (tested).
- Instant-hit naval damage is ledgered and simultaneous, so processing order does not decide
  pre-gunpowder exchanges (M3 flips there come from geometry, not resolution order).
- Clear separation of player priority (`navalPriority`), explicit attacks and autonomous pursuit; the
  autonomous pursuit is leashed (32 tiles from the anchor) and sampled at 0.5 s with bounded candidate
  sets; intercept geometry (`navalInterceptTile`) is bounded to 24 path tiles.
- Ships are never re-owned, so the 2026-10-15 stale-reference class does not reach ship records:
  `repairPortId`, `navalTargetId`, `attackTargetId` are ids re-validated on every use
  (`:3222-3232`, `:3164-3167`, `:2837-2849`). Captured ports drop the repair claim
  (`b.playerId === ship.playerId`). I found no cached mutable building reference in the naval code.
- The amphibious "every squad is its own hull" model is simple, deterministic and well validated on
  restore (`validateTransportDamage`).

## Issues

### N1. Health-proportional ship damage makes naval fights slow, mutually destructive and first-hit decided — high (gameplay/balance), CONFIRMED (executed)
- `src/skirmish/Simulation.ts:2772` (`scaledAttack(profile, ship.health, vessel.health)`), `:2785` and
  `:2927` (`Math.round(1000*ship.health/vessel.health)` as `troops`), `Combat.ts:41-63,151`.
- Mechanism: a ship's damage is multiplied by its own remaining health fraction. Each instant hit
  removes 12.8 % of the *remaining* health (128/1000 at Stone), so health decays geometrically
  (1000·0.872^k) and only reaches 0 through the `Math.max(1, …)` floor.
- Consequence: an equal 1v1 takes 93-98 s and both ships sink on the same tick (M1); equal fleets end
  in near-total mutual destruction; any early asymmetry (a missed first shell) compounds into a
  decisive win (M3). Naval combat is ~5x slower than the 16-20 s the raw numbers suggest and is
  barely controllable by the player (retreating a half-health ship does nothing useful because its
  opponent is equally weak).

### N2. EarlyMedieval warships become immortal, harmless 1-HP zombies — high (bug), CONFIRMED (executed)
- `src/skirmish/Simulation.ts:2785`, `src/skirmish/domain/Combat.ts:77-81` (`troops <= 0 → return 0`).
- Mechanism: for instant-hit vessels whose max health exceeds 2000 (EarlyMedieval 2197, 2417 with
  improvements), `Math.round(1000*1/2197) = 0` at 1 HP, so `damageAmount` returns 0. Two such ships
  meet at 1 HP and exchange 0-damage volleys forever; both stay `fighting`, never satisfy the
  out-of-combat retreat rule and never heal (M1: still alive at 300 s).
- Consequence: permanently locked ships (they still capture traders and still count in the 64/32/24
  caps), AI `navalPower` treats them as ~0 but they occupy mission slots; the AI's 120 s mission abort
  is the only thing that moves them.
- Repro: `npx tsx scratchpad/naval/trace.ts earlymedieval-warship 16`.

### N3. Repair state machine livelocks when a dock voyage ends away from the port — high (bug), CONFIRMED (executed)
- `src/skirmish/Simulation.ts:3236-3239` (repairing: `distToPort > 8 → "returning-to-dock"`, no
  voyage started), `:3284-3292` (returning-to-dock: `destination === null || path ended →
  "repairing"`), triggers at `:2897-2898` (explicit attack clears `destination`/`path`), `:3439-3440`
  (peace-protected coast revert clears `path`), and an unreachable/limited recovery admission
  (`ShipMovementAdmission.ts:338-341`, `finish` leaves the ship with `destination` and an empty path).
- Mechanism: neither branch ever re-issues `startRecoveryVoyage`, so the ship alternates the two states
  every tick without moving or healing.
- Consequence: the ship never heals, holds its port's single repair slot (`occupiedPorts`, `:3201-3206`)
  so other damaged ships queue in `waiting-for-dock` forever, and AI ships are never re-tasked because
  `navalReady` excludes these states (`AiNavalPlanner.ts:85-91`). Humans escape only by issuing a
  `sail`. Measured: 120 s with zero healing (M8). Tests: `WarshipPatrolRepair.test.ts` does not cover an
  interrupted recovery.

### N4. Human warships declare war by transit or idle patrol drift into any non-allied coastal water (raids-v1) — high (gameplay), CONFIRMED (executed)
- `src/skirmish/Simulation.ts:3441`; routing deliberately ignores ownership (`:2711-2712` comment);
  coastal claims are 8 tiles at 500 width, 16 at 1000 (`content/CoastalTerritory.ts:3-10`).
- Mechanism: after `moveShip`, if the ship's tile owner changed and the owner is non-allied, a human
  ship calls `establishWar(...,"entry")`. Autonomous pursuit, patrol wander (±2 tiles) and lane offsets
  all move ships without player intent. AI ships never trigger it (asymmetric).
- Consequence: on the Mediterranean with ~50 coastal factions, a human cannot sail anywhere, or leave a
  ship parked near a neighbour's claim, without declaring war on every faction whose coastal band the
  route touches (M9: war after 1.4 s with no orders). This also contradicts the land rule's intent
  (land entry is a deliberate march into territory). `RaidDiplomacy.test.ts:67` covers only land entry.

### N5. No land↔sea counterplay before Modern aircraft — high (gameplay), CONFIRMED (executed + read)
- Gun nests query only ground squads: `src/skirmish/domain/Battle.ts:1072`; towers unarmed
  (`content/Defences.ts:5-6`, 03 I11); warships target `["ship","structure"]` only
  (`content/Units.ts:503`); afloat squads take only `ship`-tagged weapons (`Battle.ts:306-312`) and
  ground weapons lack `ship` (03 I12).
- Consequence (measured, M4/M5): a single warship destroys ports, cities, towers and Modern gun nests
  with zero return fire (42-98 s each); landings can only be opposed by warships; a fleet cannot support
  its landing against defenders. For pirates this means a coastal faction without a navy (all tribes in
  practice, landlocked or poor nations) has **no** counterplay to raids or coastal bombardment.

### N6. Trade capture is instant on contact and ignores escorts — high (gameplay), CONFIRMED (executed)
- `src/skirmish/domain/Trade.ts:1227-1257` (1.2-tile query, lowest-id hostile captor, instant flip),
  merchant `health` unused (`content/Units.ts:486` for `kind:"trade"`; `TradeActor` has no health,
  `Definitions.ts:275-309`).
- Consequence: escorts cannot protect a merchant (M6: captured with an escort 1 tile away); a single
  700-gold warship parked at an enemy port berth captures every outbound sea trader; convoys are
  meaningless. Raiding has no risk/skill component, so a pirate faction would be either trivially
  dominant (if it can reach lanes) or irrelevant (if it cannot).

### N7. Prize ping-pong inflates trade statistics and records the victim as an embargo initiator — low (bug), CONFIRMED (executed)
- `src/skirmish/domain/Trade.ts:1239-1256`, `Diplomacy.ts:48-54`.
- Mechanism: with hostile warships of both owners adjacent, the prize flips every handling second;
  each flip adds the full cargo value to `capturedValue`/`lostValue` and calls `recordTheft`, so the
  original owner recapturing its own cargo becomes the embargo "initiator" and fires
  `onAutomaticAction(...,"raid")`.
- Consequence: HUD stats (`Expansion.ts:1990-1991`) show 10x the real value (M6); AI raid
  notifications and embargo rows misattribute aggression. No gold is duplicated (only one delivery).

### N8. Naval research sends whole fleets to port; new hulls spawn "damaged" — medium (bug), CONFIRMED (executed)
- `src/skirmish/domain/ResearchEffects.ts:53` (+10 % max health), `src/skirmish/Simulation.ts:3212`
  (`isDamaged = health < max`), `:2602` (`health: rules.health`, base not research-adjusted),
  `:3328-3348` (any damage → retreat).
- Consequence: completing "ship improvements" (every age from Bronze, plus Modern fleet improvements)
  makes every warship leave station and queue for one-ship-per-port repair (M7: 4/4 ships left within
  8 s); blockades and AI patrols collapse at the moment of research; every later recruit spawns at
  91 % and first sails to port.

### N9. Older hulls are far more gold-efficient and remain purchasable at old prices — medium (balance), CONFIRMED (executed)
- `src/skirmish/content/Units.ts:462` (cost linear 700(i+1)), `:486`/`:497` (health and damage
  1.3^i each, so damage×health 1.69^i), `src/skirmish/Simulation.ts:2565` (port tier ≥ vessel age is
  the only age gate).
- Consequence: M2 anomalies (Stone spam beats Bronze-LateMed at 2.5-24x efficiency, Classical is a dead
  age, EarlyMed beats LateMed). Square-law fleet strength per gold² is 1, .42, .32, .30, .30, .36, .45,
  .61 for ages 0-7. Together with 05 #8 (flat refit price) the optimal naval play is to mass old hulls
  and refit later.

### N10. Ship refit keeps absolute health, so a refit + free repair is a half-price new hull — medium (balance), CONFIRMED (executed)
- `src/skirmish/domain/Expansion.ts:1148` (`{definitionId, xp:0, refit:null}`, health untouched),
  `RefitQuote.ts:28-35`, free repair `Simulation.ts:3240-3244`.
- Consequence: Stone→Modern 2 600 gold yields a 1000/6275 ship that is then repaired for free in ~9 s
  (M7): a Modern warship for 46 % of its 5 600 price, with no port-tier requirement. Extends 05 #8.

### N11. AI buys submarines (identical stats, +25 % cost) in preference to better warships — medium (AI bug), CONFIRMED (executed selection logic)
- `src/skirmish/domain/AiNavalPlanner.ts:845-852` and fallback `Expansion.ts:1774-1779`: both take the
  first researched warship-kind vessel from `VESSELS.slice().reverse()`; submarines are appended last
  (`content/Units.ts:518-527`).
- Consequence: with EarlyModern submarines researched and Modern warships available, the AI buys
  `earlymodern-submarine` (6 125 gold, EarlyModern stats) instead of `modern-warship` (5 600 gold,
  +30 % health/damage, +1 range) (`subpick.ts`). Submarines have no distinct behaviour anywhere in
  `src/skirmish` (grep), so they are strictly dominated for everyone. Reach depends on whether the AI
  researches submarines (generic research utility can); code path confirmed.

### N12. Transports are two- or three-hit kills with total loss, and embarking resets hull damage — medium (gameplay) / low (exploit), CONFIRMED (measured + read)
- `content/Units.ts:466-484` (hull = 2-3 warship hits), `Simulation.ts:4591-4593` (hull 0 → all lost),
  `domain/TransportHandoff.ts:24-33` (every embark creates `hull: vessel.health`).
- Consequence: M5 (3 warships delete a 12-squad army in 14-24 s); the only defence is naval. Touching a
  beach for one movement step and re-embarking fully repairs a damaged hull (passenger wounds persist).

### N13. Symmetric naval engagements are decided by id-derived geometry — medium (fairness), CONFIRMED (executed)
- `src/skirmish/Simulation.ts:2706` (lane `ship.id%4` without an AI fleet lane), `:3156` (pursuit
  cadence `(tick+id)%4`), `:3104` (wander phase), amplified by N1.
- Consequence: 7/24 mirrored battles flip winner on id assignment (M3). Deterministic (no replay
  risk), but it reads as randomness the player cannot influence, and in 1v1/small fights it decides the
  outcome. Related: splash budget id order 08 L8 (`Battle.ts:1548-1590`).

### N14. Explicit naval attacks re-plan synchronously, outside the deferred planner — low (perf), SUSPECT (read, not measured)
- `src/skirmish/Simulation.ts:2852-2893`: every 3 s per out-of-range/out-of-LOS explicit attacker, an
  `(2·extent+1)²` tile scan (extent up to `ceil(14·0.85)=12` → 625 tiles at Modern) each running
  `structureAim` (segment LOS) or `fortifications.clear`, then `waterPaths.find(..., 4096)`.
- Consequence: an AI bombardment of 8-32 ships whose shots are blocked repeats up to 20 000
  `structureAim` calls per 3 s; it also bypasses `ShipMovementAdmission` that the recovery path was
  explicitly moved to (`WarshipPatrolRepair.test.ts` asserts no synchronous search for recovery only).

### N15. Explicit projectile shots can launch with 0 damage — low (bug), CONFIRMED (read)
- `src/skirmish/Simulation.ts:2902-2909` passes `scaledDamage` (can floor to 0 at low health) while
  the autonomous path uses `Math.max(1, scaledDamage)` (`:2949`); the reservation still adds
  `navalDamage()` to `committed`. Harmless today except that a near-dead ship "occupies" a target's
  reservation with a 0-damage shell, delaying other shooters by one flight time.

### N16. Retreat threshold is "any damage", with free, fast, exclusive repair — low (design), CONFIRMED (read + M7)
- `src/skirmish/Simulation.ts:3212`, `:3328-3348`, `:3240-3244`.
- Consequence: a single 1-HP scratch pulls a ship off a blockade after 3 s quiet; repair is free and
  10 %/s, so attrition never accumulates; a fleet with fewer ports than ships spends long stretches in
  `waiting-for-dock`. Combined with N1 (fights leave everyone at a few %), naval wars become "fight to
  near-death, all go home, return full".

### N17. AI naval power ignores hull durability — low (AI), CONFIRMED (read)
- `src/skirmish/domain/AiNavalPlanner.ts:75-84`: power = damage × health-fraction × min(range,16) /
  reload; max health is not a factor, so a Modern ship (6.3x health of Stone) is valued only ~12.5x a
  Stone ship while it is worth ~39x in damage×health. Also the 1.3x interception margin compares
  linear power, while fights follow a square law. AI under-commits against late fleets and over-commits
  against Stone spam.

### Not issues (checked)
- Ship/squad/building ids share one allocator (`allocateId`/`nextId`), so `this.ship(id) ??
  this.squad(id)` in `fightShips`/`incomingNavalDamage` cannot cross-resolve.
- `incomingNavalDamage` uses `SHIP_DEFENCE` for both ships and afloat squads, consistent with the
  impact path (`Battle.ts:1586-1591`).
- Trade capture re-validates diplomacy every tick; a raider's `navalTargetId` on a captured trader is
  dropped by `legal()` because the trader is now its own (`Simulation.ts:3158-3167`).

## Recommendations (prioritised)

### R1. Fix the damage model (N1, N2, N13) — 0.5 day + tests
- Ships and afloat hulls: replace the health-proportional multiplier with a floor:
  `effective = damage × (0.6 + 0.4 × health/max)`. In `Simulation.ts:2772/2785/2927` pass a
  dedicated `navalStrength(ship)` = `Math.max(600, Math.round(1000*health/max) * 4/10 + 600)` (in
  1/1000) to `damageAmount`/`scaledAttack`. Predicted same-age 1v1 (Stone): `(h+1500)` decays by
  0.9488 per volley → 10 volleys ≈ 20 s, both sink; with any health or numbers edge the edge wins
  without being decisive. Also removes the zombie (min 60 %).
- Independently guard the zombie: `Math.max(1, Math.round(...))` in the three call sites.
- Optional (fairness): drop the `ship.id%4` lane fallback for combat geometry (only spread when
  `repairState==="patrolling"` and no hostile within range+4), and make the pursuit cadence
  `(tick + fleetIndex)` where `fleetIndex` is assigned per owner, not per id.
- Contract test `tests/skirmish/NavalBalance.test.ts` (style of `PreModernBalance.test.ts`, using the
  real `Skirmish` and `step()` on an open-sea map):
  - `same-age 1v1 warships resolve in 15-30 s for every age and never exceed 60 s`.
  - `a 1-HP warship of every vessel deals at least 1 damage` (iterate `VESSELS`, call the naval damage
    helper at health 1).
  - `mirrored 4v4 same-age: winner is invariant under id swap in ≥ 7/8 ages` (guards N13 drift).

### R2. Repair/retreat state machine (N3, N8, N16) — 0.5 day
- `stepWarships` repairing branch (`:3236`): when `distToPort > 8` and not executing, call
  `startRecoveryVoyage(ship, berth)` (berth from `portWaterTiles` filtered to the ship's component) and
  count attempts in a new `repairAttempts` field; after 3 failures set `patrolling`, clear
  `repairPortId`. Returning-to-dock (`:3286`): only switch to `repairing` when `distToPort <= 8`;
  otherwise re-voyage.
- `naval-attack` on a ship in a recovery state must reset it to `patrolling` (like `setShipVoyage`
  does, `:2676-2681`) or be rejected.
- Retreat when `health < 0.6 × max` (or `< max` only if idle 20 s and a free port within 24 tiles); top
  up opportunistically otherwise. Store research max-health changes proportionally: when
  `shipMaxHealth` rises, scale `health` by the same ratio (or treat `health >= baseMax` as full), and
  spawn recruits at `shipMaxHealth` (`:2602`). On refit set `health = ceil(health × newMax / oldMax)`
  (`Expansion.ts:1148`).
- Repair cost (anti-N10): charge 25 % of the hull's gold price per 100 % repaired, paid per second;
  pause repair when the owner cannot pay.
- Tests: extend `WarshipPatrolRepair.test.ts` with "interrupted recovery reaches full health within 90 s"
  (the `livelock.ts` scenario) and "completing ship improvements does not move a full-health patrol".

### R3. Innocent passage for ships under raids-v1 (N4) — 0.25-0.5 day
- In `performTick` (`:3441`) exempt warships from "entry" unless (a) the ship fires on or captures
  something of that owner (already a war/embargo path), or (b) it is an afloat squad (a landing) — keep
  land-unit entry as is. Alternative: only declare when the ship's *commanded* destination lies inside
  that owner's territory. Make patrol wander (`pickPatrolWanderTile`) and pursuit intercept tiles skip
  tiles owned by protected or non-hostile factions.
- Test (RaidDiplomacy): `a human warship sailing through or patrolling beside foreign coastal water does
  not declare war; an afloat squad entering does`.

### R4. Land↔sea interplay (N5, N12, 03 I11/I12) — 2-3 days content + small code
Numbers below are per age index `i` and keep warships able to siege, but at a price:
- **Coastal tower weapon**: `TOWER_ATTACK(i)` ranged, damage `0.5 × warship damage(i)` (80·1.3^i),
  range `7+i` tiles (equal to the same-age warship), reload 2.5 s, targets
  `["ship","infantry","ranged","mounted","siege"]`, resolved in the gun-nest loop with a naval query
  (`Battle.ts:1062-1105`). Expected: 1 warship vs 1 tower — tower (2000·1.3^i hp, takes 0.35×dmg/2 s)
  survives ~70 s while the ship (takes 0.8×80·1.3^i/2.5 s = 25.6·1.3^i/s) dies in ~39 s → ship loses;
  2 warships kill the tower in ~35 s and lose ~0.9 ship. Contract test: `one same-age warship cannot
  destroy a same-age tower; two can`.
- **Gun nest** also queries `this.naval` (ships) — 1 line in `Battle.ts:1072` plus a second loop.
- **Ranged troops vs hulls**: add `"ship"` to archer/musket/artillery `targets` with a hull penalty
  (`bonusResistance.ship` negative or a 40 % multiplier for `perSoldier` weapons against `SHIP_DEFENCE`);
  target: a same-age ranged squad sinks one transport in 6-10 s, a warship in 60-90 s.
- **Warship anti-personnel**: secondary weak profile vs ground tags at 25 % damage (pre-gunpowder) / the
  existing shell splash (gunpowder+), so a fleet can support its landing; keep `structure` damage.
- **Transport hull persistence**: store `afloat.hull` damage on the squad (`hullDamage`) and restore it
  on the next embark until repaired at a friendly port/coast for 10 s (`TransportHandoff.ts:24-33`).
- Contract tests: `3 same-age warships sink 4-8 of 12 transports crossing a 2-range band` (moving
  landing), `a beach held by 2 ranged squads sinks ≥ 1 of 6 landing transports`.

### R5. Escorts and boarding for trade (N6, N7) — 1 day
- Replace instant capture with boarding progress per actor: `boarding: {captor, progressTicks}`; needs
  3 s (24 ticks) of continuous contact within 1.2 tiles; progress resets if an armed friendly
  (owner/ally) warship is within 3 tiles ("escort screen"), or the captor takes damage that tick.
  Captor choice by distance then id. Checkpoint the field (TradeActor is checkpointed already).
- A recapture by the original owner returns the actor to `returning` with its original route and does
  **not** add to `capturedValue`/`lostValue` or call `recordTheft`; stats count only the first transfer
  per shipment.
- Optional for pirates: give merchants hull (`VESSELS` trade health, already authored) and allow
  sinking only when at declared war, so escorts matter against wars too.
- Tests (TradeFleet): `an escorted merchant is not captured while an armed escort is within 3 tiles`,
  `an unescorted merchant is captured after 3 s of contact`, `recapture restores the owner's route and
  counts the theft once`.

### R6. Naval economy (N9, N10, N11, N17) — 0.5 day + matrix re-run
- Age gate purchases: allow only `AGES.indexOf(vessel.age) >= factionAge - 1` in `recruitShip`
  (`Simulation.ts:2561-2566`), or charge `max(vessel cost, 0.6 × current-age cost)`.
- Re-price warships as `700 × 1.3^i` (700, 910, 1183, 1538, 1999, 2599, 3379, 4392) **or** keep the
  price and raise damage×health growth to (i+1)² — pick one so square-law strength per gold² is flat
  ±20 % across ages; validate with `duel.ts matrix`. Contract test: `adjacent ages at equal gold:
  newer wins with gold efficiency 1.1-2.0; never more than 4x either way across the whole matrix`.
- Refit price `max(500+300·age, 0.6 × (target cost − source cost))` and proportional health (R2).
- Submarines: either give them a real role (e.g. invisible to autonomous targeting beyond 4 tiles,
  +50 % vs ships, cannot attack structures) or remove the clones. Fix the AI pickers to sort by
  `navalPower × hull / cost` rather than catalogue order (`AiNavalPlanner.ts:845`,
  `Expansion.ts:1774`).
- `navalPower` → `damage × maxHealth × fraction² × range / reload` (square law); interception margin
  then 1.3 on that.

### R7. Explicit-attack planning (N14, N15) — 0.5 day
Route explicit-attack approaches through `ShipMovementAdmission` (as recovery does) and cap the
firing-tile scan with `approachCandidate` (already used by `AiNavalBombardment.ts:125`) instead of the
full square. Apply `Math.max(1, …)` to explicit projectile damage.

### Pirate counterplay summary (ties to 04-ai.md design)
With R1-R5, a pirate faction (ships only, ≤ 6 ships, spawns on lanes from `AiNavalFacts`) has
meaningful counterplay: convoy escorts block boarding (R5), coastal towers and gun nests punish
shore raids and bombardment (R4), port berths inside tower range are safe havens, ranged troops can
sink pirate landing boats, and fights take 20-40 s so players can react (R1). Without them pirates
either capture everything they touch and raze coasts unopposed (today's rules) or must be tuned to
irrelevance. Pirates should be exempt from R3's innocent passage (their entry is hostile by
definition) and from peace protection; `canSteal` short-circuit as 04-ai.md proposes.

Effort total: ~5-6 days including the matrix re-run and the contract tests.

## Open questions

1. Is the health-scaled damage for hulls an intended "damaged ships fight worse" mechanic? If so, a
   floor (R1) keeps the flavour without the 90 s mutual-destruction duels.
2. Is human "entry by ship" (N4) intended at all? The land rule was written for marching into territory;
   ships patrol autonomously.
3. Should merchants be sinkable (authored 600·1.3^i health is currently dead data)?
4. Should older hulls remain buildable at newer ports (cheap pickets/blockade runners) — if yes, give
   them upkeep or count them double against the cap.
5. Gun nests are Modern-only; should earlier ages get a coastal battery building rather than arming
   towers?
6. Not measured here: naval tick cost at the 300-warship reference load with the R4 tower loop added
   (the gun-nest loop is O(buildings) per tick; a naval query per armed tower would need the same
   empty-skip telemetry the nests have).
