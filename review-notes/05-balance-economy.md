# 05 — Game balance and economy rules (not AI)

Read-only review of the working tree on branch `1.5.7-10hz-prototype` (8 Hz, uncommitted
pre-modern balance revision included). Numbers below were produced by throwaway scripts
under the scratchpad that import the real catalogue (`content/Units.ts`, `Technology.ts`,
`Economy.ts`, `Buildings.ts`, `domain/Manpower.ts`) and, for the engagement rows, drive the
real `Battle.fight` path with the harness copied from `tests/skirmish/PreModernBalance.test.ts`.
Nothing in the repository was modified except this file.

Legend: **CONFIRMED** = traced end to end in code and/or reproduced in the simulation;
**SUSPECT** = inferred from the catalogue/model without an end-to-end run.

## Scope read

Content (read fully): `src/skirmish/content/Units.ts` 1-527, `UnitTuning.ts`, `SoldierWeapons.ts`,
`FormationRecipes.ts`, `Technology.ts`, `Economy.ts`, `Resources.ts`, `Buildings.ts`, `Production.ts`,
`StartingEconomy.ts`, `Armies.ts`, `Defences.ts`, `Equipment.ts`, `ShoreTransport.ts`, `ModernWeapons.ts`,
`MissileDefense.ts`, `FlightOperations.ts`, `Catalog.ts`, `WeaponCycles.ts`, `RussianRecruitment.ts`,
`BalanceContract.md`; JSON catalogues `unit-tuning.json`, `soldier-weapons.json`, `formation-recipes.json`,
`technologies.json` (head), `russian-recruitment.json` (dumped programmatically: 42 units, 118 technologies).

Domain (read fully): `Trade.ts` 1-1417, `TradeCargo.ts`, `TradeQuote.ts`, `TradeReceiving.ts`,
`TradePublication.ts`, `Manpower.ts`, `Supply.ts`, `Recruitment.ts`, `Refitting.ts`, `RefitQuote.ts`,
`BuildingUpgrades.ts`, `Progression.ts`, `ResearchEffects.ts`, `Gold.ts`, `StartingResources.ts`,
`StartingCamp.ts`, `TribeDevelopment.ts`, `Enlargement.ts`, `NeutralTerritoryClaims.ts`, `Occupation.ts`,
`Roads.ts`, `MilitaryInfrastructure.ts`, `DepositGeneration.ts`, `ResourceSiteIndex.ts`,
`AutomaticProduction.ts` 1-440, `SpawnSelection.ts`, `StartingPositions.ts`, `Combat.ts` 1-180.

Simulation / rules: `Simulation.ts` 1064-1240 (deployPlayer, deployStartingSquads, squadCapacity),
1250-1370 (delete-building, cancel-recruitment, build/recruit dispatch), 1757-1880 (recruit),
2344-2370 (spawnSquad), 2406-2530 (buildingPlacement, build, applyReservePoints, stepRecruitment,
refundRecruitment, replenish), 2525-2600 (recruitShip), 3668-3716 (produceReserves), 4815-4870
(changeOwner/capture), 5415-5500 (promoteTribes/checkWinner); `Expansion.ts` 300-435, 545-580,
683-722, 920-1030, 1110-1150, 1520-1530; `Rules.ts` 1-267; `FactionRules.ts` 1-102; `Construction.ts`
18-60; `Fortifications.ts` 350-364; `TowerPlacement.ts` 60-78; `Battle.ts` 985-1003, 1105-1140,
1175-1195; `Protocol.ts` constants; `scripts/compileFormationRecipes.ts`, `compileRusPackagedRecruitment.ts`
50-66, 138-158.

Tests skimmed: `Ages.test.ts`, `AgesIntegration.test.ts`, `AgeSquadCaps.test.ts`, `FormationManpower.test.ts`,
`TradeFleet.test.ts` (names + harness), `PreModernBalance.test.ts` (full). Ran read-only:
`PreModernBalance`, `AgeSquadCaps`, `FormationManpower` — all live tests pass; the two failures reported
by vitest are stale copies under `out/late-game-playability-20261012/` and `out/crash-investigation-20261015/`
that the name filter also matched (see Open questions).

## How it works today

### Currencies
* **Gold** (`Player.gold`): spent on research, age advances, buildings, units, ships, aircraft, refits,
  enlargements, repairs (`Fortifications.ts:361`, missing HP / 5), wall links (`TowerPlacement.ts:73-77`,
  25 × age per tile). Income (ages mode) `Simulation.ts:3685-3689`: **20 + floor(land / 40) per second**,
  identical for nations and tribes, plus trade deliveries (`Trade.ts:1179-1186`). `BUILDING_RULES.goldIncome`
  (factory 20, port 12) is **only** applied in the legacy non-ages branch (`Simulation.ts:3706-3715`).
* **Reserves** (manpower, in soldiers): `produceReserves` adds `base[age] + Σ city[cityAge]` *points* per
  second (`Economy.ts:54-60`, `Simulation.ts:3673-3681`); points are converted at 12/1000
  (`applyReservePoints` `Simulation.ts:2471-2476`, `reserveConversion` `Manpower.ts:126-128`). Tribes get a
  flat 40 points. A soldier squad costs `capacity` reserves, a hull squad costs `reserveCost` 12
  (`scaledRecipeCost` `Manpower.ts:197-215`). Replenish restores 0.6 soldiers/s per squad from reserves
  (`Simulation.ts:2499-2523`). Opening reserves: `STARTING_ECONOMY[age].reserves` points → e.g. 6000 → 72
  soldiers at Stone Age.
* **Items** (`Supply.inventories`): deposits yield 3/s (horses 2/s) × `output` × `extractionYieldMultiplier(mineAge)`
  = 1..4 (`Economy.ts:7`, `Supply.ts:363-372`) **per extraction building on the tile**; refining and equipment
  kits are produced per `Production.ts`/`Equipment.ts` recipes, automatically planned by `AutomaticProduction.ts`.
  Every soldier unit after Stone Age needs one kit (`Units.ts:41-55`, mounted 2), vehicles need a vehicle kit
  **and** a siege kit (`Units.ts:50`).

### Research and ages
* 118 packaged technologies (`russian-recruitment.json`), three trees, one job per tree at a time
  (`Progression.ts:78`), gold paid up front, `ticks` are raw tick counts compiled from seconds with
  `TICKS_PER_SECOND` at compile time (`compileRusPackagedRecruitment.ts:62,154`). All compiled values are
  multiples of 8 (checked) except the optional `formation-capacity-modern` (570 ticks, authored by hand in
  `skirmish/plans/formation-recipes.json`).
* Advancing requires **any two** completed current-age trees plus `ADVANCES[i]` gold/ticks
  (`Progression.ts:101-108`, `Technology.ts:30-40`). Research of earlier-age nodes stays allowed.
* `startingProgression` grants all non-optional nodes of earlier ages, slot 1 of each tree, and the
  current-age frontline unit tech (`Progression.ts:35-66`).
* Buildings have an `age` tier fixed at construction to the latest researched tier (`Expansion.ts:355-359`)
  and auto-modernise when a newer tier tech completes (`MilitaryInfrastructure.ts`). Cost =
  `BUILDING_RULES.cost × (1 + ageIndex) × min(4, 1 + 0.3 × existingCount)` (`Buildings.ts:84-114`).

### Trade (the dominant gold source)
* Every completed factory and port accrues `tradeStockPerSecond(buildingAge) = 2 × (ageIndex + 1)` goods per
  second (`Economy.ts:6`, `Supply.ts:349-355`), capped at 1000 per factory.
* Couriers (max 48 per nation, 8 reserved for land, tribes 16 + 2/age; `Economy.ts:9-10`, `FactionRules.ts:58-60`,
  `Trade.ts:961-968`) load `LAND_TRADE_CAPACITIES[tier] = 20..160` goods (sea: vessel capacity 20..90)
  × handling × stack bonus (`TradeCargo.ts:21-23`), visit up to 8 markets (`Economy.ts:19`) dropping at most
  `marketDropLimit` = 10..50 (by receiver stack) × 150 % foreign / 125 % allied × 2 naval per visit
  (`Economy.ts:26-37`, `TradeReceiving.ts:27-33`). The per-visit limit is **stateless**: a market has no
  per-second intake cap.
* Payout per good = 20 × 100 % domestic / 150 % allied / 200 % foreign, sea × 0.75..1.5 by distance
  (`TradeQuote.ts:27-50`). **Foreign deliveries credit the receiving faction the same gold as the trader**
  (`Trade.ts:1388-1392`). Sea trade is foreign-only.
* Roads/land-trader research raises courier tier; ports research raises handling 5 %/age.

### Units
* Soldier formations: `formation-recipes.json` gives capacity, enlarged capacity and soldier HP (flat, mostly
  100; no era exponential), `soldier-weapons.json` gives per-soldier melee/ranged damage, rpm, magazine and
  bonuses (schema 2), `russian-recruitment.json` gives gold and training seconds. Per-hit damage against
  points armour is `max(1, dmg − armour) + bonus[primary class]` (`Combat.ts:89-131`).
* Hull units (all siege/artillery, all vehicles from EarlyModern): still generated by the **legacy loop** in
  `Units.ts:74-150` and `256-330` with `factor = 1.5 ** ageIndex` on damage, armour and bonuses; their attacks
  are not per-soldier, so one shot applies `dmg − armour + Σ tag bonuses` to the target's whole HP pool
  (`Combat.ts:134-160`, `Battle.ts:995`, `Manpower.damageManpower`).
* Caps: squads per faction by age 60..200, tribes 10 + 5/age (`FactionRules.ts:7-16, 95-102`); warships 64
  (AI 32, tribes 24); aircraft 32; couriers 48. No upkeep, no attrition, no per-unit price ramp.
* Refit: gold 500 + 300 × targetAge (× enlarged ratio) + target kit, mounts retained (`Refitting.ts:6-15`);
  ships the same gold formula with no items (`RefitQuote.ts:28-34`); surplus soldiers/horses return to stock on
  completion (`Expansion.ts:1137-1147`).

### Starting economy and positions
* `startingEconomy()` (`StartingEconomy.ts:19-47`) returns `max(bank, priced opening)` gold where the opening
  is 2 cities + mine + factory + 2 barracks + smith + 2 frontline squads at that age's prices; tribes get a
  smaller list, with their barracks count pre-set to 1.
* Spawns: `SpawnSelection.resolve()` places humans (reservations or random), then AI, then tribes, uniformly
  among viable tiles with clearance ≥ radius + 4 (`StartingPositions.ts:23-37`, `SpawnSelection.ts:131-139`);
  human-vs-human reservations need only `(2 × 6 + 4)` = 16 tiles. `startingResources()` guarantees each
  faction one deposit of each required mineral within 36 tiles (`StartingResources.ts:140,235-268`); the random
  world roll is terrain-weighted and seed-deterministic.

### Compact balance model

Research gold and the time gate (8 Hz, serial per tree, trees in parallel; cheapest route = two cheapest trees):

| Age | Cheapest two trees + advance | All three trees + advance | Cumulative (cheapest / all) | Serial minutes to advance (cheapest / all three) |
|---|---|---|---|---|
| Stone | 5,250 | 6,600 | 5.3k / 6.6k | 2.2 / 2.3 |
| Bronze | 47,421 | 67,422 | 52.7k / 74.0k | 3.1 / 3.1 |
| Classical | 74,836 | 116,170 | 127.5k / 190.2k | 3.9 / 3.9 |
| Early Medieval | 114,669 | 190,670 | 242.2k / 380.9k | 4.3 / 4.8 |
| Late Medieval | 172,171 | 289,506 | 414.3k / 670.4k | 4.9 / 5.5 |
| Napoleonic | 244,172 | 410,841 | 658.5k / 1,081.2k | 5.4 / 6.1 |
| Early Modern | 410,001 | 803,335 | 1,068.5k / 1,884.5k | 7.0 / 9.5 |
| Modern (complete) | 375,002 | 941,670 | 1,443.5k / 2,826.2k | 6.6 / 11.0 |

Income per minute (gold):

| Age | Land 800 / 1,500 / 6,000 / 20,000 tiles | One factory, domestic | One factory, foreign (trader share; receiver gets the same again) | Courier ceiling (48 × min(cap, 80) goods per 60 s cycle, domestic) | Drop per visit land self/foreign/allied | Sea foreign stack 1 / stack 10 |
|---|---|---|---|---|---|---|
| Stone | 2,400 / 3,420 / 10,200 / 31,200 | 2,400 | 4,800 | 19,200 | 10 / 15 / 13 | 30 / 150 |
| Bronze | same | 4,800 | 9,600 | 28,800 | | |
| Classical | same | 7,200 | 14,400 | 38,400 | | |
| Early Medieval | same | 9,600 | 19,200 | 48,000 | | |
| Late Medieval | same | 12,000 | 24,000 | 57,600 | | |
| Napoleonic | same | 14,400 | 28,800 | 76,800 | | |
| Early Modern | same | 16,800 | 33,600 | 76,800 | | |
| Modern | same | 19,200 | 38,400 | 76,800 | | |

Reserve (manpower) income in soldiers per minute: base 8.6 / 13.0 / 18.7 / 25.9 / 34.6 / 46.1 / 57.6 / 69.1;
per city 5.8 / 8.6 / 13.0 / 18.7 / 25.9 / 36.0 / 50.4 / 64.8; tribes flat 28.8 regardless of age.

Building gold (1st / 3rd / 6th / 11th copy): city 800/1280/2000/3200 at Stone → 6400/10240/16000/25600 at
Modern; factory 1000/1600/2500/4000 → 8000/12800/20000/32000; depot & arms factory 5000..160,000; airstrip
7000..224,000; missile silo 12,000..384,000.

Squad roster (gold / soldiers / HP pool / best dps per 100 gold vs same-age infantry) — full matrix in the
scratchpad run; highlights:

| Age | Frontline | Anti-cavalry | Ranged | Light cav | Heavy cav | Ranged cav | Artillery / Siege |
|---|---|---|---|---|---|---|---|
| Stone | Clubmen 60g/12/1200 (416) | — | Javelins 100g/12/960 (117) | Mounted spearmen 170g/9/1125 (49) | — | — | Field ram 500g (0 vs soldiers) |
| Bronze | Axemen 85g/24/2400 (377) | Spearmen 130g/24/2400 (178) | Archers 145g/24/1920 (306) | Spear riders 245g/16/2400 (37) | — | — | Ram / tower 1000g, 350-450 HP, structures only |
| Classical | Varangians 125g/30/3000 (277) | Heavy spearmen 190g/30/3000 (121) | Recurve 210g/30/2400 (264) | Light horse 355g/20/3500 (28) | — | Horse archers 485g/20/2500 (41) | Mangonel/Onager 1500g, 500 HP, 5-8 |
| Early Med. | Woodsmen 180g/40/4000 (169) | Mail spearmen 270g/40/4000 (32) | Rus bowmen 300g/40/3200 (247) | Lancers 510g/25/5000 (13) | Druzhina 1170g/20/6000 (7) | Cossack archers 690g/25/3750 (36) | Ballista/Trebuchet 2000g, 1000/500 HP, 6-8 |
| Late Med. | Boyar guards 260g/40/4000 (117) | Plate spearmen 385g/40/4000 (22) | Crossbows 430g/40/3200 (150) | Cossacks 730g/32/9600 (10) | Boyar cav 2065g/25/10000 (6.5) | Heavy cossack archers 990g/32/7040 (32) | Organ gun/Bombard 2500g, 1000/500 HP, 5.5-8 |
| Napoleonic | Grenadiers 370g/48/4800 (122) | Pikemen 560g/64/6400 (77) | Musketeers 620g/48/3840 (61) | Lancers 1055g/48/11520 (26) | Cuirassiers 2420g/36/18000 (9) | Streltsy 1425g/36/7200 (26) | Field cannon/Howitzer 3000g, 1000 HP, 3-6 |
| Early Modern | Mosin squad 540g/11/1100 (12) | PTRD 810g/3/300 (1.3) | DP-28 900g/1/100 (2.7) | Gun trucks 1530g/1/1000 (49) | Tsar tank 3510g/1/1000 (29) | T-34 2070g/1/1200 (51) | MG crew 3500g/1/1000 (54), Howitzer 3500g (13) |
| Modern | AK squad 810g/8/800 (5) | ATGM 1215g/1/100 (0.1) | RPL-20 1350g/1/100 (2.5) | Bumerang 2295g/1/750 (49) | T-14 5265g/1/1500 (29) | Tunguska 3105g/1/1000 (51) | MG crew 4000g/1/**200** (70), Howitzer 4000g (17) |

Rock-paper-scissors check (per-hit model, confirmed by sim where noted): pre-modern is closed — infantry
counters ranged (+100 bonus) and spears (+24), spears counter mounted (+20..82), archers out-trade spears and
infantry per gold, siege is killed by anything in contact, walls fall to siege, heavy cavalry is only hurt by
spears, crossbows (90 dmg vs 50-55 armour) and artillery. From Early Modern on it is **not closed**: nothing
with the `infantry`/`ranged` tag can hurt a vehicle (see Issues 1-2).

## Strengths

* The paid-escrow model is consistent: recruitment, ship, aircraft and enlargement jobs carry their exact
  paid cost and refund exactly once on cancel, producer loss or ownership change
  (`Recruitment.ts:210-279`, `Simulation.ts:2488-2497`, `Expansion.ts:685-692`); `paidCost` zeroes gold for
  infinite-gold humans so refunds cannot mint gold (`Gold.ts:17-19`). `FormationManpower.test.ts` covers
  escrow conservation.
* Costs are rounded with `Math.ceil` everywhere they are divided (`researchTerms`, `scaledRecipeCost`,
  `unitRefitCost`, recruitment ticks), so 2×/3× tech speed and enlarged recipes never under-charge.
* Buildings are priced at the tier they are built, and the tier must equal the latest researched one
  (`Expansion.ts:355-359`), closing the "build at Stone price, auto-upgrade for free" hole.
* Trade value is pinned at loading, settled once, and domestic deliveries never pay twice
  (`Trade.ts:910-958`, test "pays domestic deliveries once"); prize cargo is salvage at 100 %.
* Reserve conversion carries a remainder (`reserveRemainder`), so the 12/1000 scale loses nothing to rounding.
* Starting resources guarantee a complete mineral floor per faction with deterministic ordering that favours
  cramped camps first (`StartingResources.ts:78-107`).
* Delete-building gives no refund and cancels its paid jobs with refund — no demolish/rebuild abuse.

## Issues

### 1. Late-age hull weapons one-shot whole soldier squads; Early Modern/Modern infantry classes are dead units
* Where: `src/skirmish/content/Units.ts:75` (`factor = 1.5 ** index`), `:112` (machine-gun reload 1 s keeps
  1823/2734 damage), `:264` (`points()` applies the same factor to vehicle damage/bonuses), `Combat.ts:146-160`
  (non-per-soldier hit = `dmg − armour + Σ bonuses` with no per-body cap), `Battle.ts:995` (full hit added to
  the squad ledger), `formation-recipes.json` (flat 100 HP soldiers).
* Severity: critical. Confidence: high — **CONFIRMED** in simulation (scratchpad `fights.ts`/`fights2.ts`):
  Machine-gun crew → 11 Mosin riflemen: 0.125 s, squad erased by one 1888-HP burst; T-34 → Mosin squad:
  one shot (2551 incl. +1519 infantry bonus); Bumerang → 8-man AK squad: one shot; T-14 → ATGM team: one shot;
  ATGM team → T-14 does 21 HP per 3 s against 1500 HP (214 s); PTRD crew (300 HP) one-shot by Gun Trucks.
* Mechanism: the soldier model was re-based to explicit ~100 HP bodies ("no era exponential",
  `SoldierWeapons.ts:21`), while hull units still carry the legacy exponential (×11.4 Early Modern, ×17.1 Modern)
  that was designed against legacy 1000-point squads scaled by `healthPercent`. Nothing caps a single
  non-per-soldier hit to one body.
* Consequence: in the last two ages the only viable purchases are vehicles, MG crews and howitzers; infantry,
  anti-tank and LMG teams (gold/HP 0.5-13.5 vs 1.5-3.5 for vehicles) are fodder; combat is "whoever shoots
  first". Manpower is irrelevant (hulls cost 12 reserves). The BalanceContract's "Modern weapon damage and
  cadence are retained" is the root decision.

### 2. Pre-modern anti-cavalry has no `vehicle` bonus; vehicles are immune to every pre-modern soldier
* Where: `src/skirmish/content/SoldierWeapons.ts:39,54` (bonuses come solely from `soldier-weapons.json`,
  replacing the `vehicle: points(spearBonus)` the legacy loop set at `Units.ts:273-279`);
  `soldier-weapons.json` `earlymodern-anticavalry` bonuses `{"mounted":82}`; `unit-tuning.json` vehicle
  armour 190-570.
* Severity: high. Confidence: high — CONFIRMED: 64 pikemen vs Tsar Tank: all pikemen dead in 5.75 s, tank at
  1000/1000; muskets (150) vs Gun Trucks/Tsar/T-14 armour 190/380/570 → 1 HP per hit.
* Consequence: the first faction to `rus-earlymodern-mobile` (40k gold, 50 s) cannot be fought by Napoleonic
  or earlier armies at all. With issue 3 this is a rush win condition on 52-faction maps where most factions
  (and all tribes, gated to 75 % of nations) lag an age or more.

### 3. Age-up needs only two trees, so the warfare tree can be skipped entirely
* Where: `src/skirmish/domain/Progression.ts:101-106`; costs in `Technology.ts:30-40` and the compiled
  catalogue: warfare is 2-3× the naval tree in gold (Modern 566k vs 192k) and serial time (11.0 vs 6.6 min).
* Severity: high. Confidence: high (CONFIRMED by reading; the Ages test researches all three so never exercises it).
* Consequence: cheapest Stone→Modern path = 1.44M gold / ~31 min of serial research with naval + economic
  only, reaching Modern vehicles (which need only `mobile`, 50k) long before a balanced player reaches
  Napoleonic warfare. Cross-age unit matchups are not closed (issues 1-2), so age lead is decisive.

### 4. Foreign trade creates gold on both sides with no time-based receiver cap; trade dominates and snowballs
* Where: `src/skirmish/domain/Trade.ts:1388-1392` (receiver credited the trader's full payout),
  `TradeQuote.ts:39-49` (200 %/150 % premium), `TradeReceiving.ts:27-33` (stateless per-visit limit),
  `Economy.ts:6` (goods scale ×8 by Modern), `Simulation.ts:3685-3689` (land income flat per age).
* Severity: high. Confidence: high (CONFIRMED by reading; TradeFleet tests confirm the 1:1.5:2 pricing).
* Mechanism: one good = 20 gold domestic, but a foreign delivery mints 40 + 40 (allied 30 + 30). A single
  Modern factory feeding foreign markets yields 38k/min to its owner and 38k/min to the partner, against
  3.4k/min from 1,500 land tiles. Markets never saturate, so income is bounded only by factory count (cost
  ramp caps at ×4) and the 48-courier cap (~77k/min domestic ceiling per nation).
* Consequence: (a) research pacing is purely a function of factories/ports, not territory; (b) a human with
  a coastal port receives free gold from every AI trader that docks — with 14 AI nations and 30 tribes the
  positional lottery (coast + neighbours) decides the economy; (c) two allies with facing ports generate up to
  300 % of domestic value per good in a closed loop; (d) late-game gold has no sink proportional to it.

### 5. Building stacking (15 per tile) multiplies deposit yield, reserve income and trade stock
* Where: `src/skirmish/Construction.ts:18` (`MAX_BUILDING_STACK = 15`), `:50-53` (only tribes are barred
  from stacking mines), `Supply.ts:363-372` (each mine on the tile adds the deposit's yield),
  `Simulation.ts:3676-3681` (each city adds reserve points), `Supply.ts:349-355` (each factory/port adds goods),
  `TradeReceiving` stack 1..10 raises drop limits.
* Severity: high. Confidence: high (CONFIRMED by reading).
* Consequence: a nation needs exactly one deposit of each mineral; 15 Modern mines on one iron tile produce
  180 ore/s. Reserve income — the only real military damper — is purchasable at 3,200 gold (Stone) to
  25,600 gold (Modern) per stacked city, which trade income covers in seconds. Resource geography, deposit
  density options and conquest of resource land lose meaning for nations.

### 6. Pacing: a 60-90 minute Stone→Modern match is only plausible for a trade economy; research time is the gate
* Where: `Technology.ts` compiled catalogue (serial minutes above), `ADVANCES` 50-85 s, income table.
* Severity: medium. Confidence: high (model; AI reference load of 630 traders corroborates trade-driven play).
* Mechanism: with 4 factories trading domestically the gold needed per age is earned in 2-6 min, below the
  serial research time; the research-time floor is ~31 min (two trees) / ~46 min (three trees) to reach
  Modern, +11 min to finish Modern warfare. A player without factories (land only) needs 7+ hours.
* Consequence: match length target is met only if everyone trades; otherwise factions diverge by ages.
  Secondary 8 Hz notes: `formation-capacity-modern` ticks 570 is not a multiple of 8 (hand-authored),
  `MissileDefense.ts:3` `MISSILE_DEFENSE_RELOAD_TICKS = 400` is a raw tick count (50 s at 8 Hz, 40 s at 10 Hz).

### 7. Napoleonic volleys: one volley kills ~90 % of an equal line
* Where: `soldier-weapons.json` `napoleonic-infantry`/`napoleonic-archer` (150 dmg, 0 armour, 100 HP bodies),
  `Combat.ts:89-131` (per-soldier hits sum without a per-body cap for ranged).
* Severity: medium. Confidence: high — CONFIRMED: 48 grenadiers vs 48 musketeers at 8 tiles: both lines
  fire on tick 1; 42 grenadiers and all 48 musketeers die in 0.125 s; 48 grenadiers one-volley a T-34 (0 armour).
* Consequence: Napoleonic infantry fights are decided by first volley and reload RNG-free timing; range 10 vs 11
  and 10 s vs 12 s cycles decide everything. 1.5 kills per shot is far above the 0.35-0.9 hit model intent.

### 8. Hull and ship refits are cheaper than purchase, independent of target price
* Where: `src/skirmish/domain/Refitting.ts:10` (500 + 300 × age), `RefitQuote.ts:28-34` (ships, no items,
  no port needed), `content/Units.ts:461` (warship 700 × (age+1)), `:135` (siege 500 + 500 × age).
* Severity: medium. Confidence: high (CONFIRMED by reading).
* Consequence: Stone warship 700 + refit 2,600 = 3,300 vs 5,600 Modern; Stone ram 500 + 2,600 + kit vs 4,000
  Modern howitzer; each refit also saves 12 reserves and the port-tier requirement. Optimal play is to buy
  cheap hulls early and refit, which the AI does not model. (Soldier refits are 3× dearer than recruiting,
  the opposite incentive.)

### 9. Data anomaly: Modern machine-gun crew has 200 hull HP, Early Modern 1000
* Where: `src/skirmish/content/formation-recipes.json` `modern-field-support.soldierHp: 200`
  (`earlymodern-field-support`: 1000; `modern-launcher`: 600). Compiled from `skirmish/plans/formation-recipes.json`.
* Severity: medium. Confidence: high that the value is as stated; medium that it is unintended.
* Consequence: the 4,000-gold Modern MG crew (gold/HP 20) dies to any hit; the Early Modern crew is strictly
  better for less gold once refit/age rules allow.

### 10. Tribe reserve income is flat 40 points regardless of age
* Where: `src/skirmish/Simulation.ts:3676`; nations use `RESERVE_GROWTH.base` 12..96 (`Economy.ts:55`).
* Severity: medium. Confidence: high.
* Consequence: Stone tribes recruit 3.3× faster than Stone nations (28.8 vs 8.6 soldiers/min) but Modern
  tribes get 0.42× (28.8 vs 69.1); a tribe promoted at Stone Age loses two thirds of its manpower on
  promotion (`promoteTribes` changes `kind` only). Pop-up nomads/pirates built on this rule will inherit it.

### 11. Starting positions are not symmetric enough for 8 humans
* Where: `src/skirmish/StartingPositions.ts:23-37` (uniform random, clearance radius + 4),
  `domain/SpawnSelection.ts:74-78` (human reservations only need 16 tiles apart), `:131-139` (humans, then AI,
  then tribes), `StartingResources.ts:140-268` (floor guarantees presence, not richness or coast).
* Severity: medium. Confidence: high.
* Consequence: on Mediterranean 500×250 with 52 factions, a human may spawn 16 tiles from three tribes and
  inland, another on an open coast with foreign ports in reach (issue 4). No parity on coast access, land area
  or deposit count; `horses` deposits are not part of the floor at all except by ownership.

### 12. Opening bank is dead content for late starts; tribe barracks priced as a second copy
* Where: `src/skirmish/content/StartingEconomy.ts:27` (`counts` pre-set `barracks → 1` for tribes), `:44`
  (`max(bank, ceil(opening/500)*500)`).
* Severity: low. Confidence: high.
* Consequence: Modern nation opening prices at 76,500 vs bank 45,000, so `STARTING_ECONOMY.gold` never
  applies after Classical; tribes pay 1.3× for their first barracks. Fair across players, but the authored
  numbers mislead tuning.

### 13. No upkeep, attrition or per-unit ramp; land gold is linear and uncapped
* Where: `Simulation.ts:3685-3689`, `FactionRules.ts:7-16` (only cap is squads per age), `Buildings.ts:84-86`
  (building ramp capped ×4).
* Severity: medium (design). Confidence: high.
* Consequence: a faction holding 20,000 tiles earns 31k/min from land alone plus unlimited trade, with nothing
  that scales against it except the squad cap. Rich-get-richer is unopposed; the only "comeback" mechanic is
  that squads cost reserves which do not scale with land.

### 14. Mounted and ranged-cavalry classes are 4-10× less cost-effective than foot per gold
* Where: catalogue (`russian-recruitment.json` gold vs `soldier-weapons.json` damage).
* Severity: low-medium (balance). Confidence: medium — SUSPECT: the per-hit model ignores charge impacts,
  mobility and kiting, which the harness cannot drive for mounted attackers (every mounted-attacker row in the
  scratchpad run stalled without contact for 240 s, so these rows were discarded).
* Consequence: Light horse 28-49, horse archers 26-41, heavy cavalry 6-10 dps/100 gold against 120-416 for
  infantry and 60-306 for archers; horses (capacity each) add scarcity. Cavalry's value must come from charge
  and movement, which should be measured in mixed-army playtests.

### 15. Pre-modern artillery/siege per-gold output is very low (SUSPECT)
* Where: `Units.ts:74-150`; hull HP 350-1000 for 1,000-3,000 gold.
* Severity: low. Confidence: medium — blast multi-hit (radius 1-1.5 tiles) is not modelled by the per-hit
  table, so real output against dense formations may be several times higher.
* Consequence: if blast does not compensate, Mangonel..Field cannon (3-8 dps/100 gold vs soldiers) are dead
  units except against walls, where only `siege` (not `field-support`) has structure bonuses.

### 16. Enlargement research is very weak for one-body late units
* Where: `formation-recipes.json` (`modern-archer` 1→3, ATGM 1→2), `Manpower.ts:216-243` (gold difference
  = base gold × ratio), `formation-capacity-modern` 52k gold.
* Severity: low. Confidence: high.
* Consequence: +2 RPL-20 gunners cost 2,700 gold after a 52k research; with issue 1 these units are not worth
  fielding at any size.

## Recommendations (prioritised, concrete)

1. **Fix the late-age damage scale (issues 1, 2, 9) — ~2-4 days incl. retuning tests.**
   * Remove the legacy exponential from hull units: author hull `attack.damage`/bonuses in `unit-tuning.json`
     at the soldier scale (e.g. MG crew 60 dmg × 10 rounds per 2 s with `infantry` +20; T-34 150 dmg/3 s +300 vs
     infantry; T-14 400 dmg/4 s), and cap any non-per-soldier hit on a soldier formation to
     `min(hit, bodiesInBlast × soldierHp)` in `Battle.ts` near `:995` (ranged) the way contact-limited melee
     already caps overkill.
   * Give anti-tank bonuses that matter: ATGM `vehicle` +400 (one hit = 27 % of a T-14), PTRD +150; give
     Napoleonic pikes/grenades a small `vehicle` bonus (+60) so Early Modern vehicles are costly, not immune.
   * Set `modern-field-support.soldierHp` to 1000 (or 1200) in `skirmish/plans/formation-recipes.json` and
     recompile.
   * Add `PreModernBalance`-style contract rows for Early Modern/Modern: "one MG burst kills ≤ 4 riflemen",
     "two ATGM teams kill a T-14 in ≤ 40 s", "AK squad beats ATGM team".
   Trade-off: vehicles stop being raid-proof; AI force estimates (`AiCombatPower`) must be re-weighted.

2. **Close the age-up gate (issue 3) — ½ day.** Require warfare slot 1-3 (or `treeCompletion(warfare) ≥
   workload − 1`) in `advanceRejection`, or price the advance at `ADVANCES[i] + 50 % of the uncompleted
   current-age tree gold`. Trade-off: slower peaceful traders; keep the "any two trees" rule for tribes.

3. **Rebalance trade into a commerce cap (issue 4) — 1-2 days.**
   * Pay the receiver a fixed tariff (e.g. 25 % of the trader's payout) instead of 100 %.
   * Add a per-market intake rate in `TradeReceiving` (e.g. `marketDropCapacity(stack)` goods per 20 s, refilled
     continuously) so a receiver saturates; keep per-visit limits.
   * Replace per-factory stock with a per-faction commerce cap by age (RoN style): `goods/s = 2 × (age+1) ×
     min(factories, 3 + age)`; or make `tradeStockPerSecond` decline per additional factory like the building
     cost ramp.
   * Scale land income with age (`20 × (age+1)/2 + land/40`) so territory remains relevant in Modern.
   Trade-off: AI economic planner expects linear factory ROI (`AiEconomicPlanner`); update its quote.

4. **Limit stacking of economic buildings (issue 5) — ½ day.** `MAX_BUILDING_STACK` 15 → mines 1 per
   deposit for everyone (as tribes), cities 3, factories/ports 5 (keep military stacking for defence depth).
   Alternatively make stacked yield diminishing like `stackCargoPercent` (√ curve, ×3 at 10).

5. **Price refits off the target (issue 8) — 1 hour.** `unitRefitCost`/`vesselRefitCost` gold =
   `max(current formula, 60 % × (target gold − source gold))` and require an owned port of the target tier
   for ships.

6. **Tribe reserve curve (issue 10) — 10 minutes.** `tribe ? Math.round(baseReserveIncome(age) × 2)` (24..192
   points) keeps the early horde feel and removes the promotion cliff; reuse for nomads/pirates.

7. **Napoleonic volleys (issue 7) — 1 hour of data.** Musket/grenadier `damageHp` 150 → 70 with `rpm` 6-8 and
   `reloadMs` 8,000; or give Napoleonic bodies 150 HP. Target: a full-range volley kills 15-20 % of an equal
   line, close range ~45 %.

8. **Spawn parity for humans (issue 11) — 1-2 days.** In `SpawnSelection.resolve()` place humans with a
   larger clearance (`CAMP_RADIUS × 3`), reject candidate sets whose Voronoi land area or coast-access flag
   differ by > 30 % across humans, and add `horses` to the starting floor. Expose a lobby toggle "balanced
   human starts".

9. **Snowball dampers (issue 13) — pick one, 1-2 days each.** (a) Attrition: squads standing on hostile-owned
   land out of friendly building range lose 1 % HP/10 s (RoN); (b) per-unit price ramp: gold × (1 + 0.05 ×
   owned squads of that class), capped ×2; (c) land income soft cap: `land/40` → `40 × ln(1 + land/1600)`;
   (d) gold sinks: wonders/age capstones (e.g. "Great Library" −20 % research time, "Harbour" +1 courier tier)
   priced at 2-3× an advance so late-game trade gold has somewhere to go.

10. **Measurement hygiene.** Add a `BalanceMatrix.test.ts` that prints the per-age dps/gold matrix (the
    scratchpad model) and fails when any same-age counter pair drops below a threshold; drive cavalry
    through a real attack order rather than `formationApproach` so mounted rows become measurable.

## Open questions

* Is the one-shot behaviour of Early Modern/Modern hulls intended as "modern lethality", with squads meant
  to be spread into many 1-body teams? The 1-3 body recipes (DP-28, ATGM, RPL-20) suggest an intermediate
  design state rather than a decision.
* Should the receiving faction share foreign trade gold at all? `BalanceContract.md` is silent; the 400 %
  minting looks like a legacy of "unlimited unload economy" the ADVANCES comment refers to.
* Are stacked mines on a single deposit a deliberate nation privilege (tribes are explicitly barred)?
* `vitest <name>` also runs copies under `out/**`; two stale `FormationManpower` baselines fail there
  ("restores a paid operation…"). Consider excluding `out/` in `vitest` config so balance test runs are
  trustworthy.
* The reference ARM load had 630 traders for 20 factions; with 52 factions the global courier cap (48 × 52 =
  2,496 plus tribe pools) is far above that. Is the trade cap meant to be global rather than per faction?
* How much of cavalry's value is in charges? The per-hit model and the harness cannot measure it; a
  mixed-army playtest or an order-driven test is needed before touching cavalry prices.
