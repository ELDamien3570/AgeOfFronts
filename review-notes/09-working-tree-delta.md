# 09 — Post-round-1 working-tree delta and citation remap (round 2, 2026-10-16)

Read-only review of everything under `src/skirmish` and `tests/skirmish` modified after
`review-notes/07-client.md` (2026-10-15 19:36). That is 62 files, the last written at 00:35 on 2026-10-16.
Every line number below was re-checked against the tree as it stands now with `grep -n` / `sed -n`.

Scratch harnesses: `C:/Users/Damien/AppData/Local/Temp/claude/.../scratchpad/delta/`

| Script | Purpose |
| --- | --- |
| `duel.ts` | Real `Skirmish.step()`, real `order`/`charge` commands, catalogue units |
| `engage.ts` | Stale and withdrawing engagement probes |
| `churn.ts` | Assault state churn plus certification cost |
| `ckpt.ts` | Checkpoint continuation plus codec round-trip |
| `units.ts` | Cavalry content table |

## Scope read

- **New domain files, read fully:**
  - `src/skirmish/domain/CavalryAssault.ts` (1-138)
  - `src/skirmish/domain/AirfieldCapacity.ts` (1-15)
- **Changed domain files, read fully with their git hunks:**
  - `src/skirmish/domain/CavalryEngagement.ts` (1-43)
  - `src/skirmish/domain/CavalryMelee.ts` (1-110)
- **`src/skirmish/domain/Battle.ts`:**
  - Full diff.
  - Sections read: 72-80, 221-260, 580-630, 631-1112 (`fight`), 1162-1230, 1300-1385, 1520-1560.
- **`src/skirmish/domain/Expansion.ts`:**
  - Full diff.
  - Sections read: 148-175, 433-913 (command dispatcher, including `transfer-aircraft` 585-607 and charge 749-821), 1189-1192, 1210-1385 (aircraft loop, `operationalAirfield` 1345, `advanceTransfer` 1350-1380), 1093-1103, 1387.
- **`src/skirmish/Simulation.ts`:**
  - Full diff.
  - Sections read:
    - 220-302: `setAiController`, restore validators.
    - 1254-1345 and 1395-1500: `applyCommand`, the order path with `cavalryMode` at 1454-1458.
    - 1695-1730: `activateOrder` withdrawal.
    - 2003-2008: `chargePresentationClear`.
    - 2245-2296.
    - 3463-3630: movement and the raids entry-war loop.
    - 3677-3700.
    - 3730-3756: `advanceCavalryEngagements`.
    - 4083-4162.
    - 4575-4610.
    - 4834, 4888, 4976-5012.
    - 5446-5528: `checkWinner`.
- **Wire and policy files, read fully with their diffs:**
  - `src/skirmish/Protocol.ts`
  - `src/skirmish/multiplayer/CommandSchema.ts` (1-40, 95-105)
  - `src/skirmish/domain/CommandPolicy.ts`
  - `src/skirmish/domain/Definitions.ts`
- **Snapshot files:**
  - `src/skirmish/SnapshotCodec.ts`: 40-110, 390-490.
  - `src/skirmish/SnapshotDetails.ts`: 85-160, plus the diff.
- **Formation and tactics files:** `src/skirmish/domain/FormationGeometry.ts` and `FormationTactics.ts` (diffs).
- **Client files:**
  - `src/skirmish/client/AircraftGroundPresentation.ts` (1-204, full)
  - `src/skirmish/client/troops/CavalryAssaultPresentation.ts` (465-547, plus the export skim)
  - `src/skirmish/client/troops/TroopActors.ts` (147, 359, 492-502, 1212-1215)
  - `src/skirmish/client/main.ts` (1815-1845)
- **Lab files:**
  - `src/skirmish/client/lab/BattleLabModel.ts` (100-340)
  - Lab reachability: `BalanceDraft` / `BalanceExperiment` / `BalanceScenarios` / `BattleTuning` are imported only from `client/lab/*` and the two lab HTML pages (`vite.skirmish.config.ts:132-133`).
- **Content and AI files:**
  - `src/skirmish/content/BalanceContract.md` (80-140)
  - `src/skirmish/content/Catalog.ts` (90-120)
  - `src/skirmish/domain/AiArmyPlanner.ts:316-325`
  - `src/skirmish/domain/Armies.ts:352-360`
- **Tests read:**
  - `tests/skirmish/PreModernBalance.test.ts` (1-80)
  - `tests/skirmish/CavalryDefaultAssault.test.ts` (1-130)
  - `tests/skirmish/fixtures/CavalryImpact.ts`
  - `tests/skirmish/CavalryImpact.test.ts` (1-60)
  - The test lists of `CavalryAssault`, `CavalryAssaultMotion`, `CavalryRankOverlap` and `AirfieldTransfer`.
- **Prior notes:**
  - 03-combat I3 and I6
  - 00-summary Combat section and every Simulation/Battle/Expansion citation
  - 08-latent-bugs H3 and M-client (`selectedAircraft`)
- **Tests executed** with `npx vitest run --config vite.skirmish.config.ts`:
  - Files: CavalryAssault, CavalryAssaultMotion, CavalryDefaultAssault, AirfieldTransfer, BalanceDraft, BalanceExperiment, PreModernBalance, CavalryImpact, CavalryRankOverlap, CavalryRush, CavalryFrontageReplication.
  - Result: 135 of 137 tests pass.
  - The two failures are listed under D7.

## How it works today

### Cavalry: three modes, chosen by order shape

1. **Ordinary attack order (the default; what the production client and every AI path send).**
   - In `Battle.fight`, the first committed melee contact of a `meleeCavalry` unit (`CavalryAssault.ts:20-22`) builds an `ordinaryCavalryAssault` (`CavalryAssault.ts:89-95`).
     - It is built only when the unit has no `assault`, no `charge`, the order is not `move`, and the order is not `ranks` (`Battle.ts:937-947`).
   - The result is a `cavalryEngagement` with `assault: {startTick, bonusUntilTick=startTick, strength 0, penetrates, contact geometry, pressure, resistance}`.
   - Penetration is decided by `cavalryResistance` (`CavalryAssault.ts:40-59`):
     - Each side's power is `sqrt(hp per soldier x melee DPS) x sqrt(troops)`.
     - It is then multiplied by stance factors: undeployed .45, square 4, flank .55, rear .3, anti-cavalry front 3.2, mass 1, other front 1.65.
     - Terrain certification comes from `chargePresentationClear` (`Simulation.ts:2003-2008`).
   - On 'hold' the assault is `engaged` with zero depth (`Battle.ts:941-945`).
   - Damage then flows through the ordinary per-weapon-cycle melee path: `burstLimit` / `commitShot` at `Battle.ts:961-962` → `applyHit` → `meleeHit` (`Battle.ts:619-629`) → `MeleeDamageBatch`.
   - Rank waves are not used, because `cavalryUsesRankWaves` (`CavalryMelee.ts:29-33`) now requires `order.cavalryMode==='ranks'` and no engagement.
2. **Charge (unchanged entry, new tail).**
   - The impact resolves once (`Battle.ts:709-801`). Defender disruption is still written in place (`Battle.ts:760-763`).
   - The tail now stores an `assault` whose `bonusUntilTick = tick + bonusDurationTicks` (48 ticks, 6 s, for every cavalry unit) and `strength` (`Battle.ts:776-788`).
   - The charge is cleared (`charge: null`) and the order becomes `attack` on the receiving squad.
   - While `tick < bonusUntilTick`, `assaultWeapon` multiplies damage by `1 + (chargeMultiplier-1) x strength`, i.e. x2 at full strength (`CavalryAssault.ts:121-123`, used at `Battle.ts:951-952` and `:963-968`).
   - Re-issuing a charge on the engaged target arms a pending bonus (`Expansion.ts:805-810` → `armCavalryBonus`, `CavalryAssault.ts:108-113`). The next weapon commit spends it (`commitCavalryBonus`, `CavalryAssault.ts:115-119`; `Battle.ts:963-968`).
   - Charge recovery is frozen while in melee contact: `chargeReadyTick += 1` per tick (`Battle.ts:948-949` without an engagement; `Simulation.ts:3749-3750` with one).
3. **Rank waves (`attack` with `cavalryMode:'ranks'`).**
   - Only the lab sends this mode (`BattleLabModel.ts:282-285`); nothing in `client/main.ts` or any AI module does. The server still accepts it from any seated client (`CommandSchema.ts:25`, `CommandPolicy.ts:101`, `Simulation.ts:1454-1458`).
   - The cycle is now `cavalryRankCycleTicks(launchSpacing)` with `launchSpacing = world.cavalryRankLaunchSpacing?.(squad) ?? .25` (`Battle.ts:1047-1048`).
     - `Skirmish` does not implement the hook, so live matches use .25.
     - That gives a 55-tick (6.9 s) cycle instead of 87 ticks (10.8 s), with waves at +0, +6 and +12 ticks.

### Withdrawal (new)

- Any `move`, `replenish`, or `attack` on a non-engaged target turns an existing engagement into `cavalryWithdrawal(...)` (`Simulation.ts:1714-1720`; `CavalryAssault.ts:127-138`).
- A withdrawing engagement is now kept until all of the following hold (`Simulation.ts:3743-3745`):
  - no engaged target is still within `CONTACT.release`;
  - `tick >= withdrawUntilTick`;
  - the order is not `move`.
- While withdrawing, `Battle.fight` skips the squad entirely (`Battle.ts:708`).
- Close-encounter conversion of a march into combat is disabled (`Simulation.ts:4161`, `!engagement`).
- Melee hits on a withdrawing rider use its travel heading (`FormationTactics.ts` diff), so a fleeing rider takes rear x1.5.

### Aircraft transfer (new)

- Wire command: `transfer-aircraft {aircraftIds (1-200 ids), buildingId}` (`CommandSchema.ts:102`, `Protocol.ts:146-151`). The policy check is at `CommandPolicy.ts:30-31`.
- The handler is `Expansion.ts:585-607`:
  - The destination must pass `operationalAirfield` (type airstrip, owned, complete, alive, tile owned; `Expansion.ts:1345-1348`).
  - Every plane must be owned, alive and `ready`, must not be a drone, must sit at a different operational owned field, and must be within `fuelTicks x speed` of the destination.
  - Capacity: `airfieldAircraftCount + queued recruits + selection <= 6` (`AirfieldCapacity.ts:1-15`). An incoming transfer counts at the destination and stops counting at the source.
  - On success each plane becomes `state:'transferring', transfer:{destinationId}, target=destination`.
- In flight, `advanceTransfer` runs (`Expansion.ts:1350-1380`; dispatched at `:1254-1257`):
  - If the destination is lost, the plane diverts to the nearest available owned field.
  - If no field exists, or every field is full, the plane is destroyed.
  - On arrival it re-bases and refuels.
- Transferring planes are valid AA and fighter targets (`Expansion.ts:1231`, `Battle.ts:815`). A transferring fighter does not shoot.
- Replication goes through the expansion metadata JSON (`Expansion.ts:1984`, `aircraft: this.aircraft`). Checkpointing goes through `Expansion.checkpoint/restore` (`Expansion.ts:148`, `:172`).

## Strengths

- **Default attack orders now fight at weapon cadence.**
  - Measured: the rider's hit events land every 8 ticks, the authored 60 rpm.
  - This removes round-1 I6 for production play and for every AI path.
- **No crash path from a seated client in the new surfaces.**
  - Both `transfer-aircraft` and `cavalryMode` are zod-strict and ownership-checked.
  - Every lookup tolerates unknown ids.
  - The charge handler in Expansion validates coordinates with `validPosition` before `map.ref` (`Expansion.ts:763`).
- **Validators were extended alongside the new state.** Each one runs on checkpoint restore and on every client decode:
  - `validateCavalryEngagement`, which now covers `assault` and `withdrawUntilTick` (`CavalryEngagement.ts:20-29`).
  - `validateCavalryMelee`, which now covers `launchSpacing` (`CavalryMelee.ts:90-93`).
  - The packed attack-mode slot (`SnapshotCodec.ts:458`).
  - `volleyRoots` (`SnapshotDetails.ts:428-435`).
- **Checkpoint continuation matches exactly.** With an armed bonus mid-assault and a second rider, continuation was byte-identical over 160 ticks (`ckpt.ts`; `diverged at -1`). The snapshot encode→decode validators also accepted every frame.
- **CavalryAssault itself is order-independent.**
  - `cavalryResistance` and `assaultContactGeometry` read only geometry, troops and manpower. None of these is written during `fight`: damage resolves at the end through the ledger.
  - Swapping squad creation order gave identical results in assault mode (591 / 1716 HP in both orders, `duel.ts swap`).
- **Airfield capacity is now one function** (`AirfieldCapacity.ts`), shared by transfer, recruitment, auto-producer selection and the client.
  - Diversion, interception, source loss and checkpoint continuity are each covered by a test (`AirfieldTransfer.test.ts:145-245`).

## Issues

### D1. Stale cavalry engagement plus move-long withdrawal leaves riders that never fight back
- **Where:**
  - `src/skirmish/Simulation.ts:3743-3746` (withdrawal now also requires `order.type!=='move'`)
  - `src/skirmish/domain/CavalryAssault.ts:127-138` (`cavalryWithdrawal` returns a withdrawal even with no contact)
  - `src/skirmish/domain/Battle.ts:937-947` (an assault is created on 'hold')
  - `src/skirmish/domain/Battle.ts:708` (withdrawing squads are skipped)
  - `src/skirmish/Simulation.ts:4161` (close-encounter conversion is disabled while engaged)
- **Severity:** high (gameplay, AI). **Confidence:** high. **CONFIRMED** by execution (`engage.ts`).
- **Mechanism, step 1 (a stale engagement forms):**
  - A cavalry squad on 'hold' that is attacked in melee gets an `engaged` assault on its attacker (`Battle.ts:941-946`).
  - Non-withdrawing engagements filter targets only by alive and hostile, not by contact (`Simulation.ts:3737-3740`).
  - So if the attacker leaves alive, the engagement never ends. Measured: still `engaged`, target 38 tiles away, 15 s later.
- **Mechanism, step 2 (the next move becomes a withdrawal that cannot end):**
  - A later `move` converts the stale engagement into `withdrawing` (`Simulation.ts:1716-1720`).
  - That state is now kept for the whole move (`:3743`).
  - Throughout it, `Battle.fight` skips the squad (`:708`), and the "ordinary move becomes combat" path is off (`:4161`).
- **Measured, ambush on the march:**
  - The rider was body-blocked at x=32.6 for 10+ s. It dealt 0 damage and took 14 HP/s, phase=withdrawing.
  - The control run without the stale engagement dealt 240-290 HP/s.
- **The same trap without a stale engagement:**
  - A genuine withdrawal from melee that gets blocked never fights back until the move completes.
  - This is a regression from HEAD, where the engagement cleared as soon as no target was in contact (HEAD `Simulation.ts:3725`).
- **Second symptom, charge to a point:**
  - A charge command with no `targetId` on a stale-engaged rider is silently converted into `attack` on the stale, far-away target (`Expansion.ts:805-809`).
  - Measured: the result is `null` and the order becomes `{type:'attack',targetId:10}`. No charge happens.
- **Knock-on effects:**
  - The AI army planner never resizes or merges an army while a member has any `cavalryEngagement` (`AiArmyPlanner.ts:321`).
  - Column auto-travel skips these squads (`Simulation.ts:2293`).
  - The assault on the old target blocks a new assault on the next attacker (`Battle.ts:937`, `!assault`).
  - Infantry hit stale-engaged riders at the wider tolerance (`Battle.ts:252`, `!b.cavalryEngagement`).
- **Consequence:**
  - Any defensive cavalry that ever repels a melee attacker becomes a liability for the rest of the match.
  - AI cavalry is ordered around constantly, so it is exposed systematically.
  - At 52 factions with many skirmishes this is common, not an edge case.
- **Repro (`engage.ts` scenario C):**
  1. Heavy cavalry holds. Infantry attacks it.
  2. After the assault exists, teleport the infantry 40 tiles away. Step 5 s.
  3. Order the rider to move past a second infantry squad that attacks it.
  4. The rider stops, deals 0, and stays `withdrawing`.

### D2. Rank-wave mode is accepted from any client and delivers 1/5 to 1/12 of default DPS
- **Where:**
  - `src/skirmish/domain/Battle.ts:1045-1049` (interval)
  - `src/skirmish/domain/Battle.ts:658-704` (wave payment)
  - `src/skirmish/domain/CavalryMelee.ts:29-33`
  - `src/skirmish/multiplayer/CommandSchema.ts:25`
  - `src/skirmish/Simulation.ts:1454-1458`
- **Severity:** low today (no shipping UI sends it), medium if it is exposed. **Confidence:** high. **CONFIRMED** by execution.
- **Measured** (`duel.ts`, durable target, 20 s after first contact):

  | Matchup | Assault HP/s | Ranks HP/s | Ranks / assault | Charge HP/s |
  |---|---:|---:|---:|---:|
  | EM heavy cavalry vs EM infantry | 270.6 | 27.0 | 1/10 | 365.9 |
  | LM cavalry vs LM infantry | 82.2 | 7.1 | 1/11.6 | 103.2 |
  | Bronze cavalry vs Bronze infantry | 70.9 | 9.6 | 1/7.4 | 84.6 |
  | EM-modern heavy (24 rpm) vs pikes | 192.5 | 41.8 | 1/4.6 | 258.6 |

- **Mechanism:**
  - The wave budget is one weapon commitment, paid over a 55-tick cycle while the weapon cycle is 8 ticks.
  - The arrival scaling (`hit *= arrivals/rankCount`, `waveContributors`, `Battle.ts:681-683`) cuts it further.
  - Rider losses are lower in this mode: 20/20 and 19/20 survive vs 13/20 under assault in the LM matchup, because the parked body cannot be struck (`Battle.ts:252-253`).
- **Consequence:**
  - An unreviewed rules surface that a crafted packet can select.
  - It is harmless today (worse in every matchup), but if a UI exposes it before the budget is fixed, it becomes a trap option.
  - The comment at `Battle.ts:75` ("ordinary matches use the authored timing") is wrong: live matches use the `?? .25` fallback at `:1047`.

### D3. Charge resolution order bias (round-1 I3) still holds
- **Where:**
  - `src/skirmish/domain/Battle.ts:760-763` (in-place `chargeImpact.disruptedUntilTick` write)
  - `:708` (`chargeDisrupted(squad,tick)` skip)
  - `:649-651` (id-ordered loop)
- **Severity:** medium (fairness). **Confidence:** high. **CONFIRMED** by execution (`duel.ts swap`).
- **Measured:**
  - With the rider at the lower id, the defender's first strike lands 2 ticks after impact (tick 21 vs impact 19 for Bronze; 22 vs 20 for EM heavy).
  - With the defender at the lower id, it strikes in the impact tick.
  - Over the first 6 s the EM heavy rider dealt 3528 HP (rider lower id) vs 2897 HP (defender lower id), an 18 % swing from id order alone.
  - The difference from round 1's "3 ticks" comes from the new disruption formula (`Battle.ts:760`, braced 2 / flank / 0.75 x `CHARGE_IMPACT.disruption`, times strength).
- **Not affected:** ordinary assault and rank waves; their defender writes use `disruptedUntilTick: tick`, which never disrupts.
- **Consequence:** as in round 1, older squads win charge exchanges. The fix (stage disruption in a per-tick ledger applied after the loop) is unchanged.

### D4. Assault presentation geometry is rewritten on every strike and replicated
- **Where:**
  - `src/skirmish/domain/Battle.ts:986-989`
  - `src/skirmish/domain/CavalryAssault.ts:63-74`
  - `src/skirmish/Simulation.ts:2003-2008`
- **Severity:** medium (perf and bandwidth at target scale). **Confidence:** high. **CONFIRMED** by measurement (`churn.ts`).
- **Mechanism:**
  - Every committed melee shot of an assaulting rider runs `assaultContactGeometry` and its `chargePresentationClear` certification, then calls `updateSquad` with a fresh `cavalryEngagement` object even when the values are identical.
  - Fields that no authoritative code reads: `x, y, nx, ny, halfWidth, approach, pressure, resistance`.
    - `grep '.assault'` finds only `ChargeReadiness`, `HudViewModel`, `Renderer`, `TroopActors` and `CavalryAssaultPresentation` reading them.
    - The authoritative readers use only `startTick`, `bonus*`, `strength`, `depth` and `penetrates`.
  - The floats are stored unrounded, e.g. `"x":12289.888200938309`.
- **Measured:**
  - 21 object replacements in 20 s, only 1 actual geometry change.
  - About 429 B of JSON per replacement.
  - Certification costs 91 us per call on desktop (~230 us on ARM).
- **Consequence at the target:** ~200 engaged cavalry squads gives
  - about 25 certifications per tick, roughly 2.3 ms desktop / 5-6 ms ARM;
  - about 86 KB/s raw (~10 KB/s gzip) of extra squad-detail churn per client.
  - Same class as round-1 I7 (presentation geometry persisted in authoritative state).

### D5. Client right-click on an own airstrip always means transfer, so planes based there cannot patrol it
- **Where:** `src/skirmish/client/main.ts:1826-1833`; `src/skirmish/domain/Expansion.ts:589-593`
- **Severity:** medium (UX). **Confidence:** high (read).
- **Mechanism:**
  - With aircraft selected, a right-click on any own airstrip sends `transfer-aircraft` and returns.
  - The server rejects the whole selection if any plane is already based there (`a.airfieldId === destination.id`), or if any selected plane is not `ready` or is a drone.
  - The client does not pre-filter the selection, unlike `sortieCommand`.
- **Consequence:**
  - A fighter patrol over its own base, the most natural defensive order, is impossible by clicking the base.
  - A mixed selection with one plane in flight cannot be transferred at all.
  - The ledger's existing `selectedAircraft` recall bug (08 M-client) makes this worse.

### D6. Aircraft state is restored without validation; the new `transferring` state widens the surface
- **Where:**
  - `src/skirmish/domain/Expansion.ts:172` (`restoreArray(this.aircraft, state.aircraft)`)
  - `:1254-1257` (falls through when `state==='transferring'` but `transfer` is absent)
  - `:1328-1340` (bomber fires on arrival)
- **Severity:** low (only server-produced checkpoints reach it). **Confidence:** medium (read).
- **Mechanism:**
  - A `transferring` plane without `transfer` runs the sortie branch.
  - On arrival a bomber drops a bomb on the destination airfield point, and a fighter starts patrolling.
  - `transfer.destinationId`, `state`, `fuelTicks` and `flightBudgetTicks` have no validator, and aircraft have none at all (this part is pre-existing).
- **Consequence:** robustness only. Add a `validateAircraft` before pop-up factions start creating and handing over aircraft.

### D7. Balance and test status of the delta
- **Where:** `tests/skirmish/PreModernBalance.test.ts:72`; `src/skirmish/content/BalanceContract.md:116-119`; `tests/skirmish/BalanceExperiment.test.ts:336`
- **Severity:** low-medium. **Confidence:** high. **CONFIRMED** by running.
- **Round-1 I1 has changed:**
  - "three consecutive spearmen" now passes.
  - The axemen vs archers calibration now fails the other way: 39 survivors vs the 27-33 target (archers previously won).
  - The contract document now records this honestly (`BalanceContract.md:116-119`).
- **BalanceExperiment:** "builds all 48 scenario/size/vehicle combinations" times out at the 5 s default (6.6 s alone, 9.8 s total file). So the working tree has a second red skirmish test.
- **Default-mode cavalry is about 7-10x stronger in sustained melee than at round 1.** That is the intended fix, but it is a large balance shift for AI armies. No 52-faction or AI-vs-AI balance run accompanies it.

### D8. Minor delta items
- **Charge recovery freezes in any melee for Napoleonic infantry too.**
  - Where: `Battle.ts:948-949`. Confidence: high (read).
  - The rule applies to any `definition.charge` unit without an engagement. The only non-cavalry unit with a charge is `napoleonic-infantry` (`duel/chargeunits.ts`), whose bayonet charge cannot recover while it fights in melee.
  - Probably intended. Document it in `BalanceContract.md`.
- **Charge-tail assault rebuild drops two fields.**
  - Where: `Battle.ts:780-787`.
  - It copies only `startTick`, `bonusUntilTick` and `strength` from `previous`, losing `bonusStartTick` and `pendingBonusStrength`.
  - If `previous` could exist with a bonus started more than 114 s after `startTick`, `validateCavalryEngagement` (`CavalryEngagement.ts:24`) would reject it on every client decode.
  - It is unreachable today, because the charge command clears the engagement (`Expansion.ts:815`) and `Battle.ts:937` requires `!squad.charge`. Copy the fields anyway, or assert.
- **New combat files are untracked but imported by tracked ones.** `CavalryAssault.ts`, `AirfieldCapacity.ts`, `MeleeDamage.ts`, `WeaponAccuracy.ts`, `TradeCargo.ts` and `content/UnitTuning.ts` (+ `unit-tuning.json`) are untracked, but imported by tracked `Battle.ts`, `Expansion.ts`, `Simulation.ts`, `CavalryEngagement.ts`, `Units.ts`, `Supply.ts`, `Trade.ts` and `EmpireViewModel.ts`. A partial commit breaks the build. Commit them together.
- **Transferring fighters never shoot**, and transfers cannot be cancelled or redirected (`Expansion.ts:1254-1257`, `:602`). This is a design choice; flag it in the UI.

## Answers to the brief

**(a) Round-1 cavalry claims.**
- **I6 (rank waves at ~1/6.5 of authored DPS): no longer true for production play.**
  - Default attack orders use the sustained assault at weapon cadence (measured: hits at +0, 8, 16 ... ticks; 270.6 HP/s for EM heavy cavalry).
  - Rank waves exist only as an explicit `cavalryMode:'ranks'` that no shipping client or AI sends. There they deliver 1/4.6-1/11.6 of assault DPS, on a 55-tick cycle (not 87).
  - The 00-summary sentences "Multi-row cavalry fights in three rank waves per 10.8 s" and "Rank-wave cavalry deals about 1/6.5 of authored DPS unless the player spams charge" are obsolete. So is 03 I6's AI remark.
- **I3 (charge order bias): still true.** Measured 2-tick defender shift and an 18 % damage swing over 6 s (D3).
- **Round-1 cadence fix (scale the wave budget by `cycle / sustainedInterval`):**
  - Moot for default play.
  - Only needed if the ranks mode is to ship. For EM heavy cavalry the factor would be 55/8 ≈ 6.9, before the arrival scaling.
  - Otherwise gate the mode server-side (R3).

**(b) Security and robustness.**
- No unvalidated ids, missing ownership checks or reachable throws were found in either the `transfer-aircraft` path or the `cavalryMode` path. The path traced was `CommandSchema.ts:102 / :25` → `CommandPolicy.ts:30-31 / :101` → `Simulation.applyCommand` (owner check `:1420-1428`, ranks checks `:1454-1458`) → `Expansion.command:585-607`.
- `CommandPolicy` does not bound the length or element type of `aircraftIds` for internal callers. Zod bounds it on the wire.
- H3 (the charge fallback calling `map.ref` on unbounded x/y) is still present at `Simulation.ts:1303-1304`. The Expansion charge path is guarded (`Expansion.ts:755`, `:763`).

**(c) Checkpoint and replication.**
- Complete for the new squad state:
  - `cavalryEngagement.assault`, `withdrawUntilTick`, `cavalryMelee.launchSpacing` and `order.cavalryMode` are carried as squad fields or JSON squad details.
  - They are validated on restore (`Simulation.ts:272-275`, `:300-301`) and on client decode (`SnapshotCodec.ts:458`, `:486`; `SnapshotDetails.ts:515`).
  - `volleyRoots` is new optional packed data under detail version 4/5. No version bump is needed: older decoders ignore it, and the runtime hash gates mixed builds.
  - Continuation and codec round-trip were verified (`ckpt.ts`).
- Aircraft `transfer` is replicated through metadata JSON and checkpointed by `structuredClone`, but has no validator (D6).

**(d) Determinism and order independence.**
- The CavalryAssault computations are order-independent and replay-identical (swap test identical; checkpoint continuation identical).
- The remaining order dependence is the pre-existing charge disruption (D3) and AA immediate damage (`Battle.ts:838`, unchanged).
- Floats (`Math.sqrt`, `Math.hypot`) are stored in state. They reproduce only on the same V8 build, which is acceptable for the server-authoritative model.

## Citation remap (00-summary → current tree)

"current" means the summary already cites the current line.

### Simulation.ts

| Summary cite | Construct | Now |
|---|---|---|
| "5617 lines" | file length | 5638 lines |
| `Expansion.ts` "1930 lines" | file length | 1997 lines |
| `Simulation.ts:33` | upward import `./lobby/FactionPalette` | 34 |
| Naval `:2525-3367` | `recruitShip` … end of `stepWarships` | 2535-3377 |
| Faction AI `:4867-5424` | `thinkAi` … before `promoteTribes` | 4888-5435 |
| Ownership `:4608-4866` | `destroyTradersInBlast` … end of `changeOwner` | 4629-4887 |
| Roster `:1027-1169` | `createPlayers` / `deployStartingSquads` | 1032-1174 |
| Roster `:5415-5508` | `promoteTribes` + `checkWinner` | 5436-5528 |
| Command dispatch `:1245-1756` | `applyArmyCommand` … `finishOrder` | 1250-1766 |
| Land navigation `:3849-4457` | `navigationGoal` … `requestNavigationRoute` | 3874-4478 |
| `:4813-4866` | `changeOwner` | 4834-4887 |
| `:226-240` | `setAiController` | 227-241 |
| `:4867` | `thinkAi` | 4888 |
| `:3431` | ship entry war `diplomacy.establishWar(ship.playerId…` | 3441 |
| `:3604` | land entry-war loop / `establishWar(...,"entry")` | 3606 / 3614 |
| `:245-246` | restore tile-array `instanceof Uint8Array` check | 254-255 |
| `:254-255` (owners vs roster) | same tile-array check; faction loop follows | 254-262 |
| `:414-424` | `amphibiousFactions` | 414-424 (current) |
| `:3676` | tribe reserve `player.kind === "tribe" ? 40` | 3686 |
| `:3685-3689` | land gold `player.gold += 20 + floor(land/40…)` | 3695-3699 |
| `:3481-3616` | land movement: intents … `advanceNavigation` loop | 3463-3623 |
| `:610-612`, `:604-612` | `drainRouteBatch` with `limit: ROUTE_EFFORT_LIMIT` | 604-612 (current) |
| `:4083-4131` | `repairNavigation` (`localDetours.find` 4092, `findExact` 4107) | 4083-4135 (current) |
| `:4603` | `resolveLandDamage` allocation (`damageManpower`) | 4605; method at 4575 |
| `:4683` | capture key `${this.paths.revision}` | 4683 (current) |
| `:4970-4976` | `homeNeedsLand = frontier.some(...)` | 4991-4997 |
| `:5162, 5175` | raid `spatial.nearest` | 5162, 5175 (current) |
| `:5465-5491` | elimination tile-transfer loop | 5483-5491 |
| `:1302-1305` (H3) | charge `fallbackOrder` `map.ref` | 1303-1304 |
| `:5463`, `:5493-5494` | `recipient`; building re-owner to `recipient` | 5463; 5494-5495 |
| `:1467-1468` | skirmish/trench observers before rejection | 1467-1468 (current) |
| `:5006` / `:226` | handover `controllerOf(...)` / `setAiController` | 5006 (current) / 227 |
| `:5456` | `player.eliminated = true` batch | 5456 (current) |
| `:5440-5474` | `checkWinner` blast-edge reassignment | 5446-5528 (reassign 5494-5495) |
| "182 conditional `this.expansion` branches" | count | 148 `this.expansion?` + 38 `if(this.expansion` (364 total references) |

### Battle.ts

| Summary cite | Construct | Now |
|---|---|---|
| `:629` | `fight(aircraft)` | 631 (id sort 651) |
| `:1025-1027` | rank-wave `interval = max(cycle, …)` | 1046-1049 (`?? .25` at 1047) |
| `:762-765` | defender `disruptedUntilTick` write | 760-763 (skip at 708) |
| `:1524-1558` | blast splash id order and budget | 1548-1559 squads; 1580-1601 ships; 1615-1623 structures |
| `:1289-1312` | projectile first-body sweep | 1313-1336 |
| `:619-622` | `meleeHit` / `meleeReceivers` | 619-629 (current) |
| `:990` | rank-wave budget | 990 (`waves`), budget 1010-1014 |
| `:842` | AA immediate `target.health -= hit` | 838 (842 = `afterWeaponShot`) |
| `:1039` | gun nests only (towers never fire) | 1062-1070 |
| `:995` | full ranged/hull hit (`legacyWeaponStrength`) | 1019-1024; `damage.add` at 1017 |
| `:1112`, `:1653` | `resolveLandDamage` calls | 1112, 1653 (current) |
| `:918` | `hybridContacts` guard removal | 914 |
| `:248` | wall test root-to-root | 248 (current) |
| (03 I6) `:946-947` | `nextAttackTick = tick + interval` | 1049 |
| `CavalryMelee.ts:7-12` | `CAVALRY_RANK_MOTION.cycle` | 7-12 (current); live cycle via `cavalryRankCycleTicks` 22-27 |

### Expansion.ts

| Summary cite | Construct | Now |
|---|---|---|
| `:431-888` | `command()` dispatcher | 433-913 |
| `:1067-1077` | `thinkPeace` / `willing` | 1093-1103 |
| `:1386-1387` | `(player.id * 3) % secondsToTicks(3)` stagger | 1387 (current) |
| `:540` | full-map tile sweep on alliance/peace | 540 (current) |

## Recommendations

### R1. Fix stale engagement and blocked withdrawal (D1). About 1 day.
- **Changes:**
  - In `advanceCavalryEngagements` (`Simulation.ts:3737-3746`), require contact for every phase: keep a target only while `gap <= CONTACT.release + FIXED`. Clear `engaged` engagements with no target in contact for more than `secondsToTicks(1)`.
  - In `cavalryWithdrawal` (`CavalryAssault.ts:127-138`), return `undefined` when no target is within release and no rank is exposed.
  - Replace `&& squad.order.type!=='move'` at `:3743` with a bounded guard: `withdrawUntilTick = max(existing, tick + secondsToTicks(2))` set at withdrawal time. The anti-reacquire intent survives, but a body-blocked rider fights after 2 s.
  - In `Expansion.ts:805`, take the "arm instead of charge" branch only when `command.targetId !== undefined` and that target is within release.
- **Tests:**
  - A hold-defended rider whose attacker leaves clears its engagement within 2 s.
  - A withdrawing rider blocked by an attacker deals damage after 2 s.
  - A charge to a point after a stale engagement produces a charge.
  - An AI army whose cavalry member repelled an attack can be resized again.

### R2. Stop rewriting presentation geometry every strike (D4). About ½ day.
- In `Battle.ts:986-989`, compare the new geometry with the stored one and write only when the change is more than 0.5 tiles, more than 0.2 in the normal, or `penetrates`/`depth` changes. These are the thresholds the client already uses (`CavalryAssaultPresentation.ts:509-513`).
- Round `x, y, halfWidth, depth, approach` to integers and `pressure`/`resistance` to 3 significant figures. Keep `nx, ny` at 1e-4.
- Expected effect: 20 of 21 replacements removed, ~2-5 ms/tick ARM at 200 engaged cavalry, and ~80 % less detail churn.
- Test: a 20 s sustained assault produces at most 3 engagement replacements.

### R3. Gate `cavalryMode:'ranks'` (D2). About 2 h.
- Add a match option, `rankCavalryAttacks?: boolean`, which only `BattleLabModel` sets. Reject the field in `Simulation.applyCommand` otherwise. Leave `CommandSchema` unchanged so lab packets still parse.
- Fix the comment at `Battle.ts:75-76`, or make Skirmish implement the hook so the `.25` default is explicit.
- If ranks mode is meant to ship, scale `waveDamage` by `interval / weaponIntervalTicks`, capped at 8x, and re-run the `duel.ts` table. The target is ranks DPS between 0.6x and 0.8x of assault, in exchange for the lower losses.

### R4. Charge disruption ledger (D3, round-1 R3 unchanged). About 1 day.
- Collect `{targetId, untilTick, impact}` during `fight` and apply it after the squad loop. Read `chargeDisrupted(squad, tick)` against the start-of-tick state.
- Test: the `duel.ts swap` scenario gives identical defender strike ticks and damage in both id orders.

### R5. Aircraft UX and validation (D5, D6). About ½ day.
- **Client:** treat a right-click on an own airstrip as a transfer only for selected planes that are `ready`, not based there, and not drones. If none qualify, fall through to `sortieCommand` (patrol / bombing). Show "N planes cannot transfer" when the selection is mixed.
- **Domain:** add `validateAircraft` to `Expansion.restore`: state enum, `transfer` present exactly when `transferring`, a safe-integer `destinationId`, `fuelTicks` and `flightBudgetTicks` in range.

### R6. Hygiene (D7, D8). About 2 h.
- Commit the untracked domain and content files together with their importers.
- Raise the timeout on, or split, the 48-combination BalanceExperiment test.
- Decide the axemen target (`BalanceContract.md:116-119`).
- Copy `bonusStartTick` and `pendingBonusStrength` in the charge-tail rebuild (`Battle.ts:780-787`).
- Record the Napoleonic-infantry recovery freeze in `BalanceContract.md`.

### R7. Re-baseline AI military balance. About 1 day of measurement.
- Default-mode cavalry DPS rose about 7-10x relative to round 1.
- Re-run the 52-faction AI probe and an AI-vs-AI age-matched army fight set (cavalry share, losses, time to resolve) before tuning anything else in 05-balance.

## Open questions

- Is a withdrawal meant to be immune to fighting for its whole move (current behaviour), or only to re-acquisition? R1 assumes only re-acquisition.
- Should a holding cavalry squad get an assault at all? Today the hold variant is a zero-depth `engaged` assault, which is what produces D1. Normal melee without an engagement may be enough.
- Is the 6 s x2 bonus per unit intended to be identical across all ages (`bonusDurationTicks` 48 everywhere)?
- Should transfers be redirectable mid-flight, and should transferring fighters defend themselves?
