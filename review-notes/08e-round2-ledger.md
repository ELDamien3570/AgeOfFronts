# 08e — Round-2 latent bugs and technical findings (verified ledger)

## How these were verified

Twelve round-2 area reviewers produced **89** technical findings: bugs, determinism, security and perf. The areas were tree-delta, test-baseline, mapgen, air-strategic, gameplay-design, popup-spec, ai-tactics, load-test, client-unread, command-fuzz, movement-core and naval. gameplay-design contributed no technical findings to this ledger.

The method is the same as round 1 (`08-latent-bugs.md`). Two independent verifiers checked each finding:

- **code**: does the code path do what the claim says?
- **reach**: can a real match get into the triggering state?

When those two disagreed, a third **repro** verifier ran the scenario.

Status meanings:

- **confirmed**: the majority did not refute it, and at least one verifier kept it with medium or high confidence.
- **plausible**: kept only with low confidence.
- **refuted**: the majority refuted it.
- **unverified**: the verifiers failed to complete.

Other conventions:

- Severities are the **verified** severities. Where the reviewer's severity, or one verifier's, was different, the entry says so.
- Line numbers use the verifiers' corrected lines where they gave one.
- Vote summaries read `lens: kept|refuted/confidence (that verifier's severity)`.
- Where a round-2 entry re-confirms, supersedes or re-anchors a round-1 entry, it cites the round-1 ID from `08-latent-bugs.md`. IDs from the round-1 area reports are cited with their report number, for example "02 N1".

| | Count |
|---|---|
| Ledger findings | 89 |
| Confirmed | 71 ledger rows, merged into **69 entries** (39 bug/determinism/security, 30 perf) |
| Plausible | 1 |
| Refuted | 17 |
| Unverified | 0 |
| Confirmed entries by verified severity | critical 2 · high 7 (3 + 4 perf) · medium 21 (15 + 6 perf) · low 39 (19 + 20 perf) |

These duplicates were merged; each merged entry names both source rows:

- **R2-H2**: tree-delta "Charge fallback map.ref throw (ledger H3) still present after the delta" + command-fuzz "H3 still live: charge fallback converts off-map x/y with map.ref and kills the match".
- **R2-H5**: naval "Repair state machine livelocks between repairing and returning-to-dock when the dock voyage ends early" + naval "Repair livelock and other recovery gaps leave AI fleets permanently degraded" (verified low as a standalone row; both verifiers called it downstream of the livelock).

Round-2 entries that touch round-1 entries:

- **Re-confirmed:** H3 (R2-H2, re-anchored and its repro corrected), M2 (R2-M6), M10 (R2-M2, wider than first reported), M11 (R2-M10, more trigger paths).
- **Superseded severity:** H5 high → medium (R2-M1).
- **Narrowed:** L7 charge half (R2-L1: an id-order fairness issue, not a determinism break); L7 anti-air half (R2-L8: the real bias is fighter-vs-fighter; anti-air squads only shift kill credit and XP).
- **Explained:** H4's PreModernBalance failure (R2-L2) and RiverExpansion failure (R2-L4).
- **Extended or re-measured:** P1 (R2-P8), P10 (R2-P4), P13 (R2-P15, R2-P16, R2-P20), P14 and P15 (R2-P7), P20 (R2-P3), P29 (R2-P11, reviewer cited it as "round-1 I7").

"Confirmed" below holds the bug, determinism and security findings. Confirmed perf findings are under "Perf findings".

---

## Confirmed

### High (including critical)

#### R2-H1. A dead corridor-lead squad crashes MovementAdmission.stepAdmissions and ends the match (load-test)
- **Where:** `src/skirmish/MovementAdmission.ts:942` (split at `343-366`, lazy validation at `806-818`); `src/skirmish/Simulation.ts:1227` (`removeSquad`); match end at `src/skirmish/multiplayer/application/LiveMatch.ts:661-662`
- **Severity:** critical · **Kind:** bug
- **Votes:** code: kept/high (critical) · reach: kept/high (critical)

**Mechanism.** A human selection of more than 10 squads is split into a 1-squad lead admission plus 10-squad cohorts that share `corridorId` (the lead's id). In the routes phase, while the lead has not published a corridor, a follower reads `original = this.pending.get(corridorId)` and dereferences `this.ports.squad(original.members[0].id)!.kind`. Members are validated only when their own admission is visited, and visited admissions rotate to the end of the Map, so a follower can be visited before the dead lead's admission. `removeSquad` does not cancel the squad's admissions, and squads are removed by combat (`Simulation.ts:4631`), fallout (`:4814`) and sunk transports (`:2992`). `ports.squad` then returns undefined and a TypeError escapes `Skirmish.step` mid-tick. serverMatchWorker rejects the advance and LiveMatch calls `end("Match stopped: Cannot read properties of undefined (reading 'kind')")`, so every player loses the match with the simulation half-ticked. The window is open whenever the lead is pending without a published corridor; 8 active humans make that the normal state (planner pinned at 115-128 jobs), but low load does not close it. The reviewer saw no split for AI orders; the code verifier noted that AI orders above 30 squads also share a `corridorId` across cohorts, so the AI path may be exposed too (not verified). The code is unchanged since d5ba9c40 (HEAD). Reproduced three ways: an in-process Mediterranean run (crash between ticks 3000 and 3200), the same command log through the real ReservedMatchWorker, and `repro-corridor-crash.mts` (crash at tick 7 on the frozen copy and the live tree; both verifiers re-ran it).

- **Evidence:** `if (original && original !== admission && !corridor && this.ports.squad(leader.id)!.kind === this.ports.squad(original.members[0].id)!.kind) {` → `TypeError: Cannot read properties of undefined (reading 'kind') at MovementAdmission.stepAdmissions (MovementAdmission.ts:942:88)`
- **Repro:** 160x100 all-land Skirmish with LiveMatch options, human with 12 squads, `game.routePlanner.request = () => true`, one move for all 12, step 6 ticks, `removeSquad` the lead admission's member, step once.
- **Fix:** guard line 942 with `?.` and treat a missing lead as "no original", and/or cancel a squad's pending admissions in `removeSquad`.

#### R2-H2. H3 is still live: a charge fallback with off-map x/y throws in map.ref and ends the match (tree-delta + command-fuzz, security)
- **Where:** `src/skirmish/Simulation.ts:1302-1304` (re-anchors round-1 H3); `src/skirmish/domain/CommandPolicy.ts:63-77`; `src/skirmish/CommandApplications.ts:92-96`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:305-314`; `src/skirmish/multiplayer/application/LiveMatch.ts:661-662`
- **Severity:** critical (tree-delta row verified high) · **Kind:** security
- **Merged:** tree-delta "Charge fallback map.ref throw (ledger H3) still present after the delta" and command-fuzz "H3 still live: charge fallback converts off-map x/y with map.ref and kills the match"
- **Votes:** tree-delta: code kept/high (high) · reach kept/high (high). command-fuzz: code kept/high (critical) · reach kept/high (critical)

**Mechanism.** The charge pre-check at `:1302` fires if any listed squad, of any owner, is non-cavalry and in column or leaving column. When `fallbackOrder` is an attack on a missing target, `:1304` evaluates `this.map.ref(floor(x/FIXED), floor(y/FIXED))` on the raw client coordinates. The schema allows x/y up to ±1,000,000 and `commandRejection` only rejects negatives and unsafe integers, with no map-bounds check. `GameMap.ref` throws, `CommandApplications.apply` has only try/finally, the worker posts an error, ReservedMatchWorker rejects the advance, and `scheduleTick`'s catch ends the match for everyone. The worker thread itself survives. **Correction to round 1's repro:** a negative x is rejected by `CommandPolicy.ts:75`, so `x = -10*FIXED` never reaches the simulation; the trigger is a large positive value (x = 1,000,000 is tile 3906). Any seated, non-eliminated human can send it; the squad can be an enemy's or a tribe's marching column, since the pre-check never checks ownership. That also leaks whether a foreign squad is in column ("Deploy before charging" versus another reply). The fuzzer found it independently 5 times; the minimal case is off by one, y = 64000 (= H×256) on a 250-tile map. The tree-delta review found the new transfer-aircraft and cavalryMode paths zod-strict, ownership-checked and free of reachable throws, and Expansion's charge path guarded (`Expansion.ts:755`, `763`).

- **Evidence:** `order:command.fallbackOrder.type==='attack' && !this.squad(command.fallbackOrder.targetId)?{type:'move',tile:this.map.ref(Math.floor(command.x/FIXED),Math.floor(command.y/FIXED))}:command.fallbackOrder` → `Error: Invalid coordinates: 3906,3906 at Skirmish.applyCommand (Simulation.ts:1304:127) at CommandApplications.apply (CommandApplications.ts:93:30)`
- **Repro:** StoneAge live options, tick ~2656: `{type:'charge', playerId:1, squadIds:[<any marching non-cavalry squad>], x:1000000, y:1000000, fallbackOrder:{type:'attack', targetId:9999999}}` (scratchpad/command-fuzz/repro-h3.ts)
- **Fix:** check map bounds for top-level and nested x/y/tile in `commandRejection`, restrict the column test to owned squads, and reuse Expansion's fallback helper, which already checks `isValidCoord` (`Expansion.ts:758-767`).

#### R2-H3. A move order on engaged cavalry keeps it "withdrawing" for the whole move, so an intercepted rider never fights back (tree-delta)
- **Where:** `src/skirmish/Simulation.ts:3748` (new `order.type!=='move'` guard), `3742-3746` (stale-engagement filter), `1716-1720`; `src/skirmish/domain/CavalryAssault.ts:130`; `src/skirmish/domain/Battle.ts:709-710`; `src/skirmish/Simulation.ts:4164-4165`
- **Severity:** high (reach verifier: medium) · **Kind:** bug (regression from HEAD)
- **Votes:** code: kept/high (high) · reach: kept/high (medium)

**Mechanism.** A holding cavalry squad attacked in melee gets an "engaged" assault (`Battle.ts:941-946`). While not withdrawing, `advanceCavalryEngagements` filters targets only by alive and hostile, never by contact, so the engagement goes stale: measured still "engaged" with a target 38 tiles away after 15 s. Any later move order turns it into a withdrawal, because `cavalryWithdrawal` returns one whenever an old engagement exists. The working-tree delta now keeps the withdrawal until the move order ends (HEAD cleared it as soon as no target was in contact). While withdrawing, `Battle.fight` skips the squad and the move-to-attack conversion is blocked because an engagement exists. A body-blocked rider therefore never fights back and never completes the move. Both verifiers reproduced it: the rider stayed at phase=withdrawing, order=move for 10-13 s, dealt 0 damage and took 14 HP/s; the control run converted to attack and dealt 240-290 HP/s. **Corrections:** a stale engagement is one way in but not required, since any move order on cavalry with a `cavalryEngagement` now behaves this way. No teleport is needed: an enemy cavalry squad that charges a holding rider and then moves off leaves the stale state (gap 43.8 tiles). Other effects of the stale engagement: a charge-to-point becomes an attack on the far target (`Expansion.ts:805-809`), AI armies are never resized (`AiArmyPlanner.ts:321`), and column auto-travel is skipped (`Simulation.ts:2293`). The player can escape with a hold order or an attack on a new target, which is why the reach verifier rated it medium. No test covers it.

- **Evidence:** `if(phase==='withdrawing'&&!targetIds.length&&this.tick>=(old.withdrawUntilTick??0)&&squad.order.type!=='move'){` (HEAD: `if(phase==='withdrawing'&&!targetIds.length){this.updateSquad(squad.id,{cavalryEngagement:undefined});continue;}`) and `... || squad.cavalryEngagement?.phase==='withdrawing') continue;` (Battle.ts:710)
- **Repro:** scratchpad/delta/engage.ts scenario C; no-teleport variant scratchpad/verify2-tree-delta/cav2.ts.
- **Fix:** not proposed by the reviewer. The verifiers locate the two causes: the move-order guard at `:3748`, and the missing contact check for non-withdrawing engagements at `:3742-3746`.

#### R2-H4. Siege breach is unreachable for a fully walled target, so AI armies cannot assault it (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:448-453` (the only entry into breach); `src/skirmish/domain/Armies.ts:217-224` (`finishLeader`), `638-644`, `651-652`; `blocked` writers at `Armies.ts:944`, `1077`, `1095`
- **Severity:** high (reach verifier: medium) · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (medium)

**Mechanism.** Breach is entered only when `army.state === "blocked"`, and Armies sets "blocked" only on formation-slot failure, a member reroute failing mid-march, or a queued order error, all of which need a march that already exists. The leader route treats hostile walls and towers as impassable (`Simulation.ts:3802`, `Fortifications.ts:102-109`), so a closed ring makes the objective unreachable at route time. Under `deferredPlanning` (the live policy, and required for the planner to run at all), `Armies.order` defers the move into a leader admission and returns null, which the planner treats as success; the route then completes as unreachable and `finishLeader` only deletes the admission and emits an event. Nothing writes `army.state`. The planner re-sends the move every 2 s (all members still on hold) until the commitment timeout sends the army to recover. Measured on a 16-tower, 19-wall ring with 2 bronzeage-siege: 31 `army-order:move` commands in 60 s (re-run: 30, with 29 "Army corridor unavailable" rejections), the army never left x=42 and all 19 walls kept full health. The only breach test (`RemainingPlans.test.ts:587`) injects phase "breach" directly. **Corrections:** the reach verifier found the sync path is broken too (`Armies.ts:651-652` returns "Army route is blocked" without setting the state), so "under deferred planning" is too narrow. Repeated orders do not pile up leader admissions: `cancelPlanning` (`Armies.ts:639`) keeps at most one per army, so the 128 cap is only touched transiently. Gameplay impact only; no crash or desync.

- **Evidence:** `} else if(army?.state==="blocked"){` (AiArmyPlanner.ts:448) and `}else this.finishLeader(plan,outcome==="unreachable"?"rejected":"superseded","Army corridor unavailable");` (Armies.ts:217, no `army.state` write)
- **Repro:** `npx tsx siege.ts BronzeAge bronzeage-siege deferred 150`
- **Fix:** not proposed by the reviewer. The verifiers' finding implies surfacing an unreachable leader route to the planner (for example by setting the army blocked). See also R2-P19 for the re-send loop.

#### R2-H5. The naval repair state machine livelocks between repairing and returning-to-dock, and the AI never recovers the ship (naval)
- **Where:** `src/skirmish/Simulation.ts:3238-3242` (repairing) and `3286-3297` (returning-to-dock); triggers at `2898-2899` and `3439-3444`; `src/skirmish/domain/AiNavalPlanner.ts:85-91` (`navalReady`); `src/skirmish/Simulation.ts:930`
- **Severity:** high (reach verifier: medium; the merged AI row verified low) · **Kind:** bug
- **Merged:** naval "Repair state machine livelocks…" and naval "Repair livelock and other recovery gaps leave AI fleets permanently degraded"
- **Votes:** livelock row: code kept/high (high) · reach kept/high (medium). AI-fleet row: code kept/medium (low) · reach kept/high (medium)

**Mechanism.** In "repairing", a ship more than about 2.8 tiles from its port (`distToPort > 8`) is switched to "returning-to-dock" without starting a voyage. In "returning-to-dock", a null destination or a finished path switches it back to "repairing" and clears destination and path again. The ship flips state every tick, never heals (the heal sits after the distance check) and keeps `repairPortId`, so its port stays in `occupiedPorts` and other damaged ships wait in "waiting-for-dock". Triggers: an explicit naval-attack on a recovering ship clears destination/path when in range (`:2898-2899`) and nothing restarts the dock voyage after the target dies; the raids-v1 peace-protection rollback clears any ship's path (`:3439-3444`); an unreachable or early-ending recovery path (`:3120`). Reproduced with deferredPlanning on and off: 120 s, health 400 → 400, 480 ticks in each state, `repairPortId` kept. **Human vs AI:** the naval-attack trigger is human-only, and a human escapes with a move or stop order (`setShipVoyage` `:2680-2684`, stop-ships `:1404-1408`). An AI ship can enter only through the peace-protection rollback or a bad recovery path (the reach verifier reproduced the rollback case with an AI-controlled player, 150 s, ~560 ticks per state), and then stays stuck for good: `navalReady` accepts only idle/patrolling ships, `thinkNavy` skips recovering ships (`:5401`), the planner sends stop-ships only to ready ships, and AI sail orders to recovering ships are refused (`:930`). A human-livelocked ship handed to the AI on disconnect (`serverMatchWorker.ts:247`) is likewise lost. No crash.

- **Evidence:** `if (distToPort > 8) { this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-dock" }); continue; }` and `if (distToPort <= 8 || ship.destination === null || ship.nextPathIndex >= ship.path.length) { … repairState: "repairing" … destination: null … path: [] }`
- **Repro:** `npx tsx scratchpad/naval/livelock.ts`; AI variant `scratchpad/verify2-naval/peace-livelock.ts`
- **Fix:** have "repairing" call `startRecoveryVoyage` to a berth instead of only changing state, or have "returning-to-dock" re-path when the destination is null and the ship is still far from the port.

### Medium

#### R2-M1. The AI's 100-kit troop reserve floor still delays strategic payloads; supersedes H5's severity (test-baseline)
- **Where:** `src/skirmish/domain/AutomaticProduction.ts:203` and `266-270`; sort at `328-334`
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Round-1 H5 is unchanged in the code: the troop target is `Math.min(600, Math.max(100, troopCapacity*3, Math.ceil(squadCount/3)))` (HEAD: cap 180 and an AI floor of 12), and under `aiDemand` the `targets.clear()`/`continuous.clear()` calls were removed, so demand only raises the baseline with Math.max. The allocation sort always ranks recipes with an equipment kind ahead of null-kind payload recipes, so troop kits take the arms factory before make-hydrogen and make-mirv. Reachable for every AI through `Supply.ts:442`. `AiLateGame.test.ts:142` fails (1 failed, 10 passed) and passes at HEAD; the test file differs from HEAD only in CRLF. **Correction:** payloads are delayed, not permanently blocked: they get the factory once every troop recipe's share of the 100-kit reserve is stocked, or when a second arms factory is idle. No crash.

- **Evidence:** `const troopTarget = Math.min(600, Math.max(100, troopCapacity * 3, Math.ceil(squadCount / 3)))` and `(equipmentKind(a) === null ? 1 : 0) - (equipmentKind(b) === null ? 1 : 0)`
- **Repro:** `npx vitest run --config vite.skirmish.config.ts tests/skirmish/AiLateGame.test.ts`
- **Fix:** not proposed in this round; the verifiers point at the floor at `:203` and the removed clears at `:266-270`.

#### R2-M2. The doctrine compiler still rejects mounted frontage; M10 unchanged and wider than reported (test-baseline)
- **Where:** `scripts/FormationDoctrineSchema.ts:56-57`; `src/skirmish/content/TacticalRules.ts:45`; `skirmish/plans/formation-recipes.json:66-69`; `scripts/compileFormationDoctrines.ts:5`
- **Severity:** medium · **Kind:** bug (content build and tests)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `FlexibleFrontage.test.ts:73-74` still throws "Mounted frontage exceeds infantry ratio: bronzeage-cavalry capacity 1.8894230769230769". The uncommitted recipe change raised bronzeage-cavalry from 8/12 to 16/20 against `mountedWidthRatioMax` 1.35, and nothing re-ran the compilers. The code verifier dumped every ratio: 20 of the 24 mounted variants exceed 1.35, the worst being napoleonic-cavalry capacity at 2.034, then bronzeage-cavalry 1.889 and latemedieval-rangedcavalry enlarged 1.875. The same throw blocks `scripts/compileFormationDoctrines.ts`, so compiled doctrines cannot be regenerated. Live matches load the existing compiled `formation-doctrines.json`, so nothing crashes, though bronze cavalry's line now breaks the intended width limit.

- **Evidence:** `if(ratio>FRONTAGE.mountedWidthRatioMax)throw new Error("Mounted frontage exceeds infantry ratio: "+id+" "+variant+" "+ratio);`
- **Repro:** `npx vitest run --config vite.skirmish.config.ts tests/skirmish/FlexibleFrontage.test.ts`
- **Fix:** fix the content, or deliberately raise the ratio to at least 2.05 (worst case 2.034) and recompile in order. Changing only bronze cavalry is not enough.

#### R2-M3. The map hash depends on the engine's libm; only Float32/byte quantisation keeps browsers in sync (mapgen)
- **Where:** `src/skirmish/multiplayer/application/MapIdentity.ts:25-37`; rejection at `src/skirmish/client/OnlineMatchSession.ts:355-356`; generators e.g. `MigrationCoast.ts:9,105-151`, `ContinentsLayout.ts:556-561`, `RegionalTopography.ts:166-211`, `TerrainFormation.ts:85-119`, `ResourceGeography.ts:61-108`
- **Severity:** medium (both verifiers: medium to low) · **Kind:** determinism
- **Votes:** code: kept/medium (medium) · reach: kept/medium (medium)

**Mechanism.** The Node server generates the procedural map from a fresh random seed (`LiveMatch.ts:150`, `ServerMap.ts:17`) and hashes it; each browser regenerates it (`Terrain.ts:50`, via `client/main.ts:814`) and hashes it with the same function, which covers the raw Float32 elevation bytes plus terrain, forest and resource bytes. The generators call `Math.sin/cos/atan2/exp/tanh/hypot` and `**` at more than 100 sites (121 counted), with no deterministic math library and no fallback that sends the server's map. Measured over 200,000 inputs, Firefox 155 differs from Node 24 on hypot in 35.4% of inputs, `x**3` in 26.2% and sin/cos in 2.4%; Chrome/Edge 155 differ on atan2 (17.9%), exp (9.8%), tanh (9.5%) and sin/cos (3.4%). All 13 test maps still matched in Firefox, Chrome and Edge, because Float32 and byte rounding absorb 1-2 ulp. With every libm result forced 1 ulp off, 6 of 120 maps hashed differently (Continents 500: 3 of 8, terrain bytes included). An affected player gets "Map versions differ" with no fallback and cannot join; the simulation stays server-authoritative, so nothing desyncs. **Caveat:** no real-browser mismatch has been seen; 6/120 is a worst-case stress bound, not a failure rate. Safari and an ARM64 server are untested. A sweep of several hundred random seeds per map in headless Firefox would settle it.

- **Evidence:** `parts.push(map.terrain); if (map.elevation) parts.push(new Uint8Array(map.elevation.values.buffer, …))` and `if (identity !== message.manifest.mapHash) throw new Error("Map versions differ. Reload after deployment.");`
- **Repro:** `npx tsx scratchpad/mapgen/perturb.mts orig 1.0 continents 500 4 5 6` vs `perturb 1.0 continents 500 4 5 6`; browser harness in scratchpad/mapgen/xb.
- **Fix:** not proposed by the reviewer; the verifiers note the missing deterministic math and the missing server-map fallback.

#### R2-M4. Point-targeted launches and bombing ignore diplomacy; nukes neutralise a non-war faction's land (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1007-1019` (launch), `610-646` (sorties, drone-only check at `613-617`); `src/skirmish/domain/Battle.ts:1538-1565`; `src/skirmish/Simulation.ts:4825-4841`; `src/skirmish/domain/Diplomacy.ts:38`
- **Severity:** medium (reviewer: high) · **Kind:** security (rule exploit)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `launch` checks `canAttackStructure` only when a `targetBuildingId` is given; the x,y path checks payload, `validPosition` and research. Bombing and atomic sorties check diplomacy only for drone building/unit targets. Bomb, ICBM and warhead blasts are indiscriminate, and the nuclear branch calls `nuclearBlast`, which hands every owned tile in the radius to owner 0 through `changeOwner(tile, 0)`, skipping the raids guard because the new owner is 0. `canCapture(a, 0)` is always true. `notifyHostileAction` only alerts AI relations; no war is declared. Both client launch UIs send a point launch when the player clicks land rather than a building (`EmpireView.ts:484-494`, `EmpireHudView.ts:558-569`), and every live match runs raids-v1. Reproduced: point launch accepted (null) during peace protection, the buildingId launch rejected with "Choose an enemy building"; after 740 ticks the target is owner 0 with 81 wasteland cells, `declaredWar(1,2)` false and `canCapture(1,0)` true. **Corrections:** this applies to every faction not at war with the attacker, allies included, not only the 60 s peace-protection window. It breaks the raids contract ("new attacks require current permissions"), while blast collateral damage itself is intended. Capturing the wasteland still needs squads to reach it and costs troops for fallout. No crash or desync.

- **Evidence:** `if (targetBuildingId !== undefined) { … !this.diplomacy.canAttackStructure(player.id, target.playerId)) return "Choose an enemy building"; … }` then only `!this.validPosition(x, y) || !this.progression.has(player.id, "modern-strategic-weapons")`
- **Repro:** scratchpad/air/peacenuke.ts (raids-v1, peaceProtection {1,2}).
- **Fix:** check the owner at the aim point with `canAttackStructure` when a launch or sortie is accepted.

#### R2-M5. Any fighting army member freezes the whole army's advance creep (ai-tactics)
- **Where:** `src/skirmish/domain/Armies.ts:1148` (creep at `1150`), `1116`/`1125` (`available`); `src/skirmish/domain/CommandPrecedence.ts:20-21`
- **Severity:** medium (reviewer: high) · **Kind:** bug (AI tactics)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** After deployment the creep is the only thing that moves an AI army's anchor toward the enemy, one tile every `ENGAGEMENT.refreshTicks` (3 s), and it requires `!available.some(s=>s.fighting)`. Wing cavalry in the "engaged" phase is not domain-controlled (only "penetrating" and "withdrawing" are), so it stays in `available` and its `fighting` flag stops the creep. Line squads are leashed to their slots (frontLeash 3, rangedLeash 1), so a static anchor keeps the line and ranged out of range. Measured: in an EarlyMedieval run, posture stayed "advance" for about 36 s while only the mounted wing fought, and the creep was blocked on 259 of 263 eligible ticks; the anchor stayed ~15 tiles from the enemy and the nearest ranged squad ~13.9 tiles away against range 9. With posture forced to "advance" in the LateMedieval repro, `lastAdvanceTick` stayed at 126 from 17 to 41 s, then jumped when the last rider stopped fighting. **Correction:** in the cited LateMedieval run the plan posture was "hold" from about 22 to 41 s, which also stops the creep, so the reviewer's "posture advance most of that time" holds for EarlyMedieval, not that seed. AI quality only.

- **Evidence:** `if(plan?.posture==='advance'&&army.posture!=='defend'&&…ai&&this.world.tick-(army.lastAdvanceTick??march.started)>=ENGAGEMENT.refreshTicks&&!available.some(s=>s.fighting)){`
- **Repro:** `npx tsx wingprobe.ts LateMedieval idle:ai 45`; verifier harnesses lineprobe2/lineprobe3.
- **Fix:** gate on frontline or ranged members fighting (or exclude mounted wing roles), not on any member.

#### R2-M6. One annihilated army still disbands every sibling army in contact; M2 still present (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:309-315` (guard calls `release(player.id)`), `113` (`release`), `109-110` (`releaseMission`)
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Round-1 M2 is unchanged. The per-plan failure guard in `stepMission` (no live members, army gone outside replenish/refit, or a lost lease) calls the player-wide `release(player.id)`, which runs `invasion.release` and `releaseMission` on every plan the player has; each issues `disband-army` and frees leases, routes, trench and hill positions. When all members of one army die, `Armies.detach` auto-disbands it (`Armies.ts:559`), so the guard fires mid-battle. Several plans per player are normal: `missionCap = min(capacity, 1 + floor(squads/40), 4)` and large offensives are split. The freed members fall back to the thinkAi attack-nearest loop and lose their L3 plans and wings; because attack-nearest currently out-fights the line, playtests hide the bug. Two neighbouring per-plan exits (`:172`, `:201-203`) already call `releaseMission(plan)`. No test covers an annihilated army with active siblings.

- **Evidence:** `if (!members.length || (!army && plan.phase !== "replenish" && plan.phase !== "refit") || members.some((s) => !this.economy.assets.owns(\`squad:${s.id}\`, plan!.id))) { this.release(player.id); return this.diagnostics.work; }`
- **Fix:** call `releaseMission(plan)` at line 313.

#### R2-M7. Combat crosshair markers always show player 1's targets (client-unread)
- **Where:** `src/skirmish/client/Renderer.ts:429`; `src/skirmish/client/CombatEffectsViewModel.ts:219-222`, filters at `239`, `246`, `253`
- **Severity:** medium · **Kind:** bug (presentation, information leak)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `Renderer.update` calls `combatTargets(snapshot)` with no player id, so the default `playerId = 1` filters outbound aircraft targets, ICBM/MIRV/warhead targets and siege squad targets. `main.ts` sets `snapshot.localPlayerId` before `renderer.update` (`main.ts:851-854`, also `634/640`), and the Renderer already exposes it through its `playerId` getter. Online, every human in seats 2-8 never sees crosshairs for their own strikes and instead sees player 1's pending bomb, ICBM and MIRV targets and siege focus; the snapshot carries those targets to every client unredacted. Solo play and seat 1 are unaffected. The only tests (`CombatPresentation.test.ts:199-201`) use the default id.

- **Evidence:** `this.combatMarkers = combatTargets(snapshot);`
- **Repro:** online match in seat 2; seat 1 launches a bombing run or ICBM.
- **Fix:** `combatTargets(snapshot, snapshot.localPlayerId ?? 1)`. Both verifiers prefer this over `this.playerId`, which at line 429 still reads the previous snapshot. Add a test with localPlayerId 3.

#### R2-M8. Remains records grow without bound while zoomed out (client-unread)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:488-489` (capture), `747-760` (`captureOffscreenLoss`), `819-823` (`drawRemains`, the only `sample` caller); `src/skirmish/client/troops/TroopRemains.ts:39-45`; `src/skirmish/client/troops/TroopPresentation.ts:97-100`
- **Severity:** medium (reviewer: high) · **Kind:** bug (client memory/CPU)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `prune` forces `visible` false when not detailed, so at strategic zoom every squad that loses soldiers goes through `captureOffscreenLoss` (pose, slots, sort, then one `remains.add` per lost sprite). `beginFrame` calls `prune` on every new source at every zoom. TroopRemains expires records only inside `sample()`, which only `drawRemains` calls, and `drawRemains` returns early when not detailed. `setDetailed(false)` clears many maps but not remains, and there is no count cap. Executed: 8 squads losing 1 soldier per 10 s publication gave 8, 16 … 96 records at t=120 s despite the 45 s lifetime, and one `sample()` then purged to 40; at target scale, 997 records after 30 publications. A player who stays zoomed out accumulates one record (~250 B) per lost sprite for the match, and the first zoom-in pays one synchronous pass over all of them. Each publication also spends 1.5-14 ms rebuilding poses that are never shown (not re-measured by the verifiers). **Correction:** one record is added per lost sprite, not per raw troop point.

- **Evidence:** `const visible=this.detailed&&this.completedDetail.has(old.id)&&this.motions.has(old.id); if(before>after&&!visible)this.captureOffscreenLoss(…)` and `if (!this.detailed || !this.ready) return;` (drawRemains)
- **Repro:** scratch `remains.bench.test.ts`: `setDetailed(false)`, 12 publications 10 s apart with losses, check `remains.records.size`.
- **Fix:** expire records in `add()` or `prune` when not detailed, skip offscreen capture while not detailed, or cap the count.

#### R2-M9. An occupy command suppresses another faction's skirmish stance (command-fuzz, security)
- **Where:** `src/skirmish/domain/Expansion.ts:439`; `src/skirmish/domain/SkirmishStance.ts:116-128`, `110`, `134-141`, `199-212`; `src/skirmish/domain/TrenchOccupancy.ts:472-477`
- **Severity:** medium · **Kind:** security
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `TrenchOccupancy.command` admits only owned, eligible squads but returns success if at least one was accepted. Expansion then passes the unfiltered `command.squadIds` to `SkirmishStance.observe`, which has no ownership check: it sets `suppressed = true` and calls `finish(id, false)`, aborting an active withdrawal. The flag is sticky until the owner re-issues a stance command or a non-hold army order, and a suppressed squad skips its withdrawal logic every tick while its `stance` still reads "skirmish" in the UI. Nothing upstream filters foreign ids for occupy: the schema, CommandPolicy and LiveMatch only check shapes and the sender's seat, and occupy never reaches the "You can only command your own squads" gate that `order` has. Reproduced through the real `commandSchema` and `commandApplications.apply`: outcome "executed", the victim's state went from `suppressed:false` to `true`. A player with any completed trench can repeat it each command (needs a modified client).

- **Evidence:** `if(command.type==="occupy") {const result=this.trenches.command(command);if(!result)this.skirmish.observe(command);return result;}`
- **Repro:** `trenchLineScene()`; p2 sends `{type:'occupy', squadIds:[p2Defender, 16], tile:ref(30,32)}` (scratchpad/command-fuzz/repro-occupy-stance.ts).
- **Fix:** pass only the admitted ids, or filter `SkirmishStance.observe` by `c.playerId`. **Correction:** `TrenchOccupancy.observe` is not called on the occupy path, so filtering it is optional hardening.

#### R2-M10. Order observers still mutate trench and stance state before rejection; M11 still live and wider (command-fuzz)
- **Where:** `src/skirmish/Simulation.ts:1467-1468`; later rejections at `1471-1475`, `1500`, `1506-1513`, `1513-1522`, `1537-1570`; `src/skirmish/domain/TrenchOccupancy.ts:615-643`, `654-662`; `src/skirmish/domain/SkirmishStance.ts:124-127`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Round-1 M11 is unchanged. In the order branch, `skirmish.observe` and `trenches.observe` run before several rejections: unwalkable or water tile, deferred queue cap, append room, unconnected or unreachable destination, replenish off friendly land, a rejecting `armyOrder`, and no formation room. `TrenchOccupancy.observe` calls `leave()` for any non-hold order, which sets phase "leaving", writes a new formation with an `occupationReform` transition and publishes occupancy; `SkirmishStance.observe` sets `suppressed` and finishes any withdrawal. Nothing rolls back (`HostedRuntime.ts:112-113`). The charge, attack-structure and army paths observe only on success (`Simulation.ts:1341-1347`, `Expansion.ts:442`). The fuzzer logged it in ClassicalAge, Napoleonic, EarlyModern and Modern; on EarlyModern seed 34, squad 2717 got an occupation-leave transition from a rejected replenish. The most common real trigger is a misclick: right-clicking water before Cargo Canoes with an entrenched squad selected. No crash or desync. No test covers it.

- **Evidence:** `this.expansion?.skirmish.observe(command); if(!append)this.expansion?.trenches.observe(command);` followed by `return this.waterPaths.walkable(order.tile) ? "Research Cargo Canoes to take squads onto water" : "Choose passable land or navigable water";`
- **Repro:** `{type:'order', playerId:2, squadIds:[<entrenched or skirmish-stance own squad on enemy land>], order:{type:'replenish'}}`
- **Fix:** run both observers once after all rejecting validation. **Correction to the reviewer's fix:** moving them only into the commit loop (`:1573-1585`) would skip the successful early returns at `:1476-1483`, `:1487-1505` and `:1518-1520`.

#### R2-M11. Live states fail the restore validator: transport landing and refits leave preferredFrontage without deployedShape (command-fuzz)
- **Where:** `src/skirmish/domain/TransportHandoff.ts:60`, `67` (and the column fallback at `74`); `src/skirmish/Simulation.ts:1195-1197`; validator `src/skirmish/domain/FormationGeometry.ts:538-540`; restore check `src/skirmish/Simulation.ts:270`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** When a manual column (`shape "column"`, not automatic) with no `deployedShape` lands from transport, `:60` computes `preferredFrontage` for `doctrine.defaultShape`, but `:67` stores `deployedShape: old.deployedShape`, which stays undefined. `validateFormation` then checks that width against `deployedShape ?? shape` = "column", which has no shape profile, and throws "Invalid formation frontage". The starting state is reachable: `Simulation.ts:1708` clears `deployedShape` when a move carries a column intent, and `2193/2196/2202` clear it when `eligibleShape` falls back to column. A second path: a definition change (refit or enlargement) computes `preferredFrontage` for `eligibleShape(old.deployedShape ?? shape)` at `:1195` but drops `deployedShape` at `:1197` when the new doctrine lacks it; 390 of 2,086 same-line definition changes gave an invalid formation. Instrumented runs: ClassicalAge seed 32 tick 9872 (squad 2350, bronzeage-infantry) and Modern seed 25 tick 8134. A synthetic call reproduced it for bronzeage-infantry, earlymodern-anticavalry and bronzeage-anticavalry. **Correction on consequence:** the check runs in pre-install validation, so `restore()` throws but does not set `restoreFailure`; every restore of a checkpoint taken while the bad formation is live fails (diagnostic replay at `worker.ts:115`, CommitVerifier rollback via `HostedRuntime.ts:93`, any future rejoin or server checkpoint). `SnapshotDetails.ts:515` and `SnapshotCodec.ts:487` run the same validator on decoded details (not traced). The fuzz round-trip failed in ClassicalAge, Napoleonic, EarlyModern and Modern.

- **Evidence:** `deployedShape: intent==="column"?old.deployedShape:intent,` and `if(…||!formationProfile(d,shape))throw new Error("Invalid formation frontage");`
- **Repro:** snap/formcheck.ts (instrumented), snap/refit-frontage.ts (synthetic), scratchpad/verify2-command-fuzz/land.ts.
- **Fix:** at `:67` use `deployedShape: intent==='column' ? (old.deployedShape ?? formationDoctrine(id).defaultShape) : intent`; at `Simulation.ts:1197` store the same `eligibleShape` result; add an end-of-tick `validateFormation` assertion in tests.

#### R2-M12. Engagement planner state fails its own restore validator at a multi-army quantum boundary (command-fuzz)
- **Where:** `src/skirmish/domain/EngagementManager.ts:622-627` (stale projections), `174-180` (validator), `465-478` (budget loop), `517`/`555` (rebuild)
- **Severity:** medium (reach verifier: low) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (low)

**Mechanism.** The reviewer saw one EarlyModern fuzz round-trip (seed 34, ~tick 12,000) fail with "Invalid engagement planning cursor" and could not isolate it; both verifiers did. After publishing one army's plan, `planQuantum` clears `memberIds` and `enemyIds` but not `projections`, then returns false while more armies remain. `projections` is only rebuilt in `startArmy` on the next quantum. If the per-tick budget (`ENGAGEMENT.quantum` 12, or the global `BUDGETS.engagementPlan`) runs out on exactly that quantum, the job persists with `enemyIds = []` and `projections.length > 0`, `checkpoint()` serialises it, and `restore()` rejects it at the `projections.length !== enemyIds.length` check. This is deterministic in any engagement with 2+ armies when the budget boundary falls right after an army's plan; the reach verifier reproduced it with two opposing armies (N=14 and N=29). The live simulation is unaffected because `startArmy` overwrites projections before reading them. **Scope:** the live server never calls `Skirmish.restore`; it is reached by diagnostic-replay loading and by HostedRuntime/CommitVerifier, which only tests use today.

- **Evidence:** `j.armyCursor++; j.memberIds = []; j.enemyIds = []; if (j.armyCursor >= j.armyIds.length) return this.finishJob(e); return false;` and `j.projections.length !== j.enemyIds.length || … throw Error("Invalid engagement planning cursor");`
- **Repro:** scratchpad/verify2-command-fuzz/eng.ts (checkpoint → restore every tick).
- **Fix:** also set `j.projections = []` at line 625.

#### R2-M13. EarlyMedieval warships stall as 1-HP ships that deal 0 damage (naval)
- **Where:** `src/skirmish/Simulation.ts:2789` (instant-hit `navalDamage`; same expression for structure hits at `2931`); `src/skirmish/domain/Combat.ts:77-81`; retreat gate `Simulation.ts:3331-3334`
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Instant-hit vessel damage passes `troops = Math.round(1000*health/maxHealth)` to `damageAmount`. For max health above 2000 (earlymedieval-warship 2197, 2417 improved; the only instant-hit hull above 2000), a ship at 1 HP gets troops 0 and `damageAmount` returns 0 before its `Math.max(1, …)` floor. At 2 HP troops is 1, so matched ships grind each other down to 1 HP together and then trade 0-damage volleys. The target filter never excludes them (committed damage is 0), each tick sets `fighting` and `lastCombatTick`, and the repair retreat requires `!ship.fighting`, so neither ship ever repairs. Re-run: both ships at 1 HP from 98.75 s to the end of the 120 s trace (reviewer: still alive at 300 s). **Correction:** not immortal. A healthier ship, projectile fire or a structure attack still sinks them; the deadlock needs symmetric fights (mirror matchups). The reviewer also reported they still count against ship caps and still capture traders (not separately verified).

- **Evidence:** `Math.round((1000 * ship.health) / vessel!.health),` and `if (troops <= 0 || …) return 0;`
- **Repro:** `npx tsx scratchpad/naval/trace.ts earlymedieval-warship 16`
- **Fix:** clamp the troops argument to `Math.max(1, …)` while `ship.health > 0`, as the legacy and projectile paths already do.

#### R2-M14. Naval research sends whole fleets to port, and new hulls spawn below max health (naval)
- **Where:** `src/skirmish/Simulation.ts:3215-3216` (`isDamaged`, reviewer cited 3212), `3330-3352` (retreat), `2591-2606` (recruit at base health); `src/skirmish/domain/ResearchEffects.ts:41`, `53`; `src/skirmish/domain/Expansion.ts:340-344`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Max health is computed live from completed research, and each age's ship-improvements (Bronze through Industrial, plus Modern fleet improvements; not Stone Age coastal-navigation) raise it by 10%. Nothing raises current health when the research completes, so every full-health warship of that tier is "damaged" on the next tick. `recruitShip` spawns from the raw VESSEL definition at base health, so every later recruit is damaged too. Out of combat for 3 s (a ship that never fought already counts), any damage triggers a retreat to a one-ship-per-port repair, and this runs before the mission-hold check, so AI mission ships leave station as well. Reproduced: four 1300/1300 Bronze warships were 1300/1430 eight seconds after the research, in waiting-for-dock, returning-to-dock and returning-to-patrol at the port tile, and all four were back on patrol at 1430 after 68 s. Blockades and AI patrols collapse each time such research completes. It fixes itself after one repair cycle per ship. No test combines this research with patrol and repair.

- **Evidence:** `const maxHealth = this.shipMaxHealth(ship); const isDamaged = ship.health < maxHealth;` and `health: rules.health,` (recruit)
- **Repro:** `npx tsx scratchpad/naval/research.ts`
- **Fix:** scale current health by the new/old max ratio when the research completes, and spawn at `shipMaxHealth`.

#### R2-M15. The AI buys identical but 25% dearer submarines ahead of warships (naval)
- **Where:** `src/skirmish/domain/AiNavalPlanner.ts:845-852`; `src/skirmish/domain/Expansion.ts:1766-1785`; `src/skirmish/content/Units.ts:518-527`; `src/skirmish/domain/AiResearchUtility.ts:124-127`
- **Severity:** medium (code verifier: low to medium) · **Kind:** bug (AI economy)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Both AI pickers take the first researched warship-kind vessel from `VESSELS.slice().reverse()`. Submarines are pushed after every age's vessels (just before the carrier) as `{...ship}` copies of the same-age warship with only id, name, technologyId and cost (×1.25) changed, and nothing in src/skirmish gives them distinct behaviour (`RusPackagedRuntime.test.ts:100` treats them as normal warships). The AI researches them: any naval tech that unlocks a warship-kind vessel scores +8000 when sea threat is present. With EarlyModern submarines researched, the AI buys earlymodern-submarine (6125 gold, EarlyModern stats) instead of modern-warship (5600 gold, about +30% health and damage, +1 range). **Wider than reported:** once Modern submarines are researched (the last naval gate), both pickers always choose modern-submarine (7000) over an identical modern-warship (5600), and within any age the submarine always wins over the same-age warship. AI gold and fleet strength only; no crash or desync.

- **Evidence:** `const definition = VESSELS.slice().reverse().find((v) => v.kind === "warship" && progression.has(player.id, v.technologyId) && AGES.indexOf(v.age) <= AGES.indexOf(port.age ?? "StoneAge"));`
- **Repro:** `npx tsx scratchpad/naval/subpick.ts`
- **Fix:** not proposed by the reviewer; the verifiers locate the ordering in both pickers.

### Low

#### R2-L1. Charge disruption is written in place during the id-ordered fight loop; round-1 L7 charge half holds (tree-delta)
- **Where:** `src/skirmish/domain/Battle.ts:763-765` (reviewer cited 761) and skip at `710`; loop order `649-651`; `src/skirmish/EntityCollection.ts:64-65`
- **Severity:** low (reviewer: medium) · **Kind:** fairness (reviewer filed it as determinism)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** `fight()` goes through squads in ascending id order, and `updateSquad` mutates the live record in place. The committed-charge branch writes the defender's `chargeImpact.disruptedUntilTick = tick + disruption`, which the skip at `:710` reads for squads processed later in the same tick. A defender with a higher id than the rider loses its strike in the impact tick; one with a lower id has already struck. Measured with the real step loop and re-run by both verifiers: the defender's first strike comes 2 ticks after impact when the rider has the lower id and in the impact tick otherwise, and its whole cadence shifts by 2 ticks. Damage over 6 s: earlymedieval-heavycavalry 3528 vs 2897, bronzeage-cavalry 905 vs 999. Rank-wave and assault defender writes use `disruptedUntilTick: tick` with a strict `<`, so they are order-independent. **Correction:** not a determinism or desync break (deterministic, server-authoritative); an order-of-evaluation fairness asymmetry costing at most one strike per charge.

- **Evidence:** `this.world.updateSquad(target.id,{chargeImpact:{tick,role:'defender',sourceId:squad.id, disruptedUntilTick:Math.max(tick+disruption,target.chargeImpact?.disruptedUntilTick??tick),`
- **Repro:** scratchpad/delta/duel.ts swap (rider-first vs defender-first creation order).
- **Fix:** stage defender disruption and apply it after the loop, or compare against a tick-start snapshot.

#### R2-L2. PreModernBalance is red at line 72, but on a cavalry-free matchup and as documented; round-1 H4 explained (tree-delta)
- **Where:** `tests/skirmish/PreModernBalance.test.ts:68-72`; `src/skirmish/content/BalanceContract.md:112-119`
- **Severity:** low (reviewer: medium) · **Kind:** bug (test baseline)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The reviewer reported that default attack orders now strike at weapon cadence (measured 1.05 hits/s, versus one commitment per 87 ticks in round 1), with no AI or 52-faction balance run, and that "three consecutive spearmen" now passes while axemen vs archers gives 39 survivors against the 27-33 target. Both verifiers confirmed the one red assertion: 1 failed of 32 in the combined run, "expected 39 to be less than or equal to 33". **Corrections:** the failing matchup (bronzeage-infantry vs bronzeage-archer) has no cavalry, so the title's link to cavalry DPS is not shown; the faster ordinary cavalry attack is an intended change ("Ordinary cavalry attacks use sustained assault without spending the charge bonus"); the 39-survivor result is already recorded as unresolved in BalanceContract.md; and BalanceExperiment's 48-combination test passed in 3.3-3.7 s, under the 5 s default (no `testTimeout` override), so there is one red test, not two. The 7-10× DPS figure was not reproduced.

- **Evidence:** `expect(axes.survivors[0]).toBeLessThanOrEqual(33);` → `AssertionError: expected 39 to be less than or equal to 33 ❯ tests/skirmish/PreModernBalance.test.ts:72:31`
- **Repro:** `npx vitest run --config vite.skirmish.config.ts tests/skirmish/PreModernBalance.test.ts tests/skirmish/BalanceExperiment.test.ts`
- **Fix:** resolve or re-target the documented calibration assertion.

#### R2-L3. Aircraft restore has no validator; a "transferring" plane without `transfer` bombs its destination (tree-delta)
- **Where:** `src/skirmish/domain/Expansion.ts:174` (reviewer cited 172); transfer guard `1268-1271`; bomber fire `1325-1346`; `src/skirmish/StateTransfer.ts:2-5`; `src/skirmish/Simulation.ts:261-285`
- **Severity:** low · **Kind:** bug (robustness)
- **Votes:** code: kept/high (low) · reach: refuted/medium (low) · repro: kept/high (low)

**Mechanism.** `restoreArray(this.aircraft, state.aircraft)` copies records verbatim, and `Simulation.restore` validates squads, ships, buildings, barriers, recruitment and players but never aircraft (ids, playerId, state, `transfer`, fuel and flight budget are all unchecked). A plane with state "transferring" but no `transfer` skips `advanceTransfer`, takes the sortie branch with `target` still set to the destination airfield, and a bomber or drone fires there on arrival. The repro verifier showed it with a crafted checkpoint: restore accepted, the plane bombed its own destination airstrip (health 5000 → 1800) and flew home; the control with `transfer` intact landed normally. Live play cannot produce the state: every writer sets state and `transfer` together (`602-604`, `1275`) and the only `delete a.transfer` also sets "ready" (`1367`). Only malformed checkpoints reach it: a local diagnostic replay (`worker.ts:115`) or `CommitVerifier.verify`, whose comment makes restore the validator for host-proposed state but which only tests use today. The reach verifier rated it a hardening note for that reason.

- **Evidence:** `restoreArray(this.aircraft,state.aircraft);` and `if (a.state === "transferring" && a.transfer) { this.advanceTransfer(a); continue; }`
- **Repro:** scratchpad/verify2-tree-delta/repro-aircraft.ts (control.ts for the intact case).
- **Fix:** add aircraft invariants to restore (transferring requires `transfer`, finite fuel and flight budget, valid airfieldId, unique ids), before any host-delta verification goes live.

#### R2-L4. The RiverExpansion reinforcement test reads a world frozen after victory; round-1 H4 explained (test-baseline)
- **Where:** `tests/skirmish/RiverExpansion.test.ts:81-90` (assertion at `89`); `src/skirmish/Simulation.ts:3392-3393` (reviewer cited 3389)
- **Severity:** low (reviewer: medium) · **Kind:** bug (test design)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The fixture gives the tribe 100000 reserves against two nations with one 1000-HP city each, and every scenario ends with the tribe winning: loop tick 747 on the working tree and 872 at HEAD, out of 900. After that `performTick` returns early, so line 89 checks squad positions in a frozen world. Reinforcement itself works on both trees (afloat at 6-7, across at 11-12, intruder dead at 32 vs 46). On the working tree no tribe squad was across after tick 656; at HEAD one happened to be across when the game froze, so HEAD passed by luck. Reverting only the October 16 stoneage-infantry retune (soldier-weapons.json damage/rpm/bonuses/melee armour and `unit-tuning.json` speedPercent 80) restores a passing state; the verifiers' partial revert gave winner 844 with 2 squads across. Reviewer bisection: Simulation.ts, AiOperations+Expansion, AI economy, Battle.ts, recipes, Supply/Trade and formation files have no effect. **Note:** `unit-tuning.json` and `BalanceContract.md` are new untracked files, so "reverting" the speed means removing the override.

- **Evidence:** `private performTick(): void { if (this.winner !== null) return;` and `expect(game.squads.some(s=>s.playerId===tribe.id&&map.x(game.tileOf(s))>=41)).toBe(true);`
- **Repro:** scratchpad/test-baseline/scripts/river.mts (working tree `{crossings:2, across:12, enemyDead:32, winner:747, lastAcross:656}`; HEAD `{winner:872, lastAcross:899}`).
- **Fix:** assert during the loop (a tribe squad landed across and the intruder died before any winner), or weaken the nations so the game does not end in the window.

#### R2-L5. RussianTroopSources baked hashes match only a CRLF checkout (test-baseline)
- **Where:** `tests/skirmish/RussianTroopSources.test.ts:10-11`, `20`; `.gitattributes`; `scripts/prepareRussianArtwork.py:84`; `scripts/prepareAgeArtwork.py:32`
- **Severity:** low · **Kind:** determinism (asset pipeline)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The test hashes the raw on-disk bytes of each TopDownReview `animations.json` and compares them with the baked `metadataHash`. With `core.autocrlf=true`, the working copies are CRLF (`git ls-files --eol`: `i/lf w/crlf attr/text=auto eol=lf`), while the committed blobs are LF. The baked hashes committed in HEAD equal the CRLF hashes: RiverArcher cdd17176 (disk) vs 0263590c (blob), RecurveArcher 4beeb91c vs 12078da8, BronzeSpearman d9a6d3b4 vs 6f5d8b2e. A `git archive` export of HEAD fails all three tests, and any LF checkout (Linux CI, a fresh clone honouring eol=lf) would too. The bake scripts also hash raw bytes, so recorded hashes depend on the checkout. PNGs are LFS binaries and unaffected. No effect on the game.

- **Evidence:** `const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");` and `expect(baked.metadataHash).toBe(hash(baked.source));`
- **Repro:** `git archive HEAD | tar -x`; `vitest --config vite.skirmish.config.ts tests/skirmish/RussianTroopSources.test.ts` → 3 failed.
- **Fix:** `git add --renormalize` plus a re-bake, or normalise line endings before hashing.

#### R2-L6. Black Forest layout and spawn attempt 0 share the same unsalted PRNG stream (mapgen)
- **Where:** `src/skirmish/BlackForestLayout.ts:44`; `src/skirmish/domain/SpawnSelection.ts:115-117` (reviewer cited 154-156); `src/skirmish/StartingPositions.ts:31`; `src/skirmish/Simulation.ts:789`
- **Severity:** low · **Kind:** RNG independence (reviewer filed it as determinism)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The server passes the match seed to both map generation and the simulation. `blackForestLayout` builds `new PseudoRandom(seed)` with no salt, and `SpawnSelection.resolve` attempt 0 builds `PseudoRandom(seed + Math.imul(0, 104729))`, the same seed and so the same sfc32 stream. Human reservations draw nothing, so the k-th AI/tribe camp pick (`nextInt(0, count)`) reuses the layout's k-th raw draw; for k = 0 that is clearing 0's `extent`. Every other generator XOR-salts its stream (BlackForestMap, Continents, Migration, RegionalTopography, TerrainFormation, FactionRoster). **Correction:** `Simulation.random` (`:789`) is never drawn from at all, only checkpointed (`242`) and restored (`340`), so it is dead state on the same stream rather than "consumed only at construction". Not a desync: every executor derives the same values. A trap for future runtime use.

- **Evidence:** `const random = new PseudoRandom(seed),` (layout) and `const random = new PseudoRandom(this.options.seed + Math.imul(attempt, 104729),);` (spawn)
- **Fix:** XOR-salt the layout seed and the spawn seed.

#### R2-L7. Unlucky-seed and range invariants throw during prepare and end the match with no re-roll or seed log (mapgen)
- **Where:** `src/skirmish/MigrationLayout.ts:256-257`, `330`; `src/skirmish/TerrainDrainage.ts:104-106`; `src/skirmish/Elevation.ts:41-45`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:138`, `308`; `CoordinatorServer.ts:475-482`; `LiveMatch.ts:150`
- **Severity:** low · **Kind:** bug (robustness/observability)
- **Votes:** code: kept/medium (low) · reach: kept/low (low)

**Mechanism.** These throw during the worker's prepare: "Migration could not separate the mainland" after 12 channel attempts, no mainland, land without a coastal drainage outlet, and elevation outside the calibrated range (for example the Black Forest pond bed at height − 3 against minimum 0, `BlackForestMap.ts:164/185`, while `formTerrain` clamps to 5800 rather than 1200). Nothing catches or re-rolls; `CoordinatorServer` sends the error to every member and ends the not-yet-started match, and the worker log (`:308`) omits the `Math.random` seed and the matchId, so a failure cannot be reproduced. No failing seed was found: 375 seeds at 250 and 8 at 500 per map (reviewer), plus 400 more Migration 250 seeds and 30 each of migration/continents/black-forest at 1000 (reach verifier); Black Forest heights stayed in [21, 1000] against [0, 1200]. Size 2000 was barely or not sampled. **Correction:** "Not enough room" (`StartingPositions.ts:27-30`) is a deliberate settings error, already retried 16 times, and fits the maximum faction counts on the smallest map. A failure ends only that match, cleanly.

- **Evidence:** `if (majorPieces < 2) throw new Error("Migration could not separate the mainland");` and `console.error("Match executor operation failed",message.request.type,error);`
- **Fix:** log the seed and diagnostic context on prepare failure, and optionally retry generation with a derived seed.

#### R2-L8. Fighter duels are decided by aircraft array order; round-1 L7 anti-air half narrowed (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1286-1297` (reviewer cited 1283), loop at `1265-1266`; `src/skirmish/domain/Battle.ts:813-850`
- **Severity:** low (reviewer: medium; reach verifier: medium) · **Kind:** bug (fairness)
- **Votes:** code: kept/high (low) · reach: kept/high (medium)

**Mechanism.** A fighter applies `enemy.health -= 200` inside the aircraft loop, and a victim killed earlier in the loop skips its own turn (`if (a.health <= 0) continue`). Fighters are created with `reloadTick: 0`, the engagement range is symmetric, and reloads stay locked at +2 s, so identical fighters trade four hits and on the fifth exchange the one earlier in `this.aircraft` (creation order, the older id) wins with 200/1000 HP. Re-run on the current tree: "p1 created first: p1 hp=200 vs p2 hp=0", reversed when p2 is created first. **Correction:** anti-air squads (`Battle.ts:813-850`, round-1 L7) also apply hits immediately, but aircraft never shoot back at squads, so there is no survival bias there; order only decides kill credit, XP and which AA squad retargets. Anti-air emplacements use delayed projectiles and are unaffected. No test covers simultaneous fighter duels.

- **Evidence:** `if (enemy && this.world.tick >= a.reloadTick) { if (enemy.health <= 0) continue; const health = enemy.health; enemy.health -= 200;`
- **Repro:** scratchpad/air/duel.ts
- **Fix:** collect fighter hits for the tick and apply them (and record losses) after the loop, so mutual kills can happen.

#### R2-L9. Anti-air emplacement volleys skip the 4096 volley cap (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1260-1262` (reviewer cited 1256); compare `1290`, `Battle.ts:459`, `1429`, `1464`; `src/skirmish/Simulation.ts:4534`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** `world.volleys.push` for anti-air emplacements runs whenever `battle.fire` succeeds, and `fire` only checks the projectile cap, not `volleys.length`. Fighter guns and Battle check `volleys.length < 4096`. **Corrections:** the overshoot is small, bounded by the number of emplacements firing in one tick (each reloads every 2 s) on top of a list already near 4096, and volleys are pruned after `ARCHER_ARROW_TICKS` (0.6 s, `Simulation.ts:3414-3418`). Archer volleys at `Simulation.ts:4534` are uncapped too, so 4096 is not a global invariant, and no codec enforces a maximum. Cosmetic or bandwidth only.

- **Evidence:** `this.world.volleys.push({id:this.world.allocateId(),squadId:b.id,…definitionId:"naval-air-defence",…});` vs `if (this.world.volleys.length < 4096) this.world.volleys.push({…definitionId:"fighter-guns"…});`
- **Fix:** wrap the push in `if (this.world.volleys.length < 4096)`, and consider the archer push too.

#### R2-L10. The shared 4096 projectile cap can refuse strategic launches and hold bombers at their target (air-strategic)
- **Where:** `src/skirmish/domain/Battle.ts:172-173`, `352`, `567`; `src/skirmish/domain/Expansion.ts:1057-1059`, `1301`, `1324-1346`
- **Severity:** low · **Kind:** design (priority inversion)
- **Votes:** code: kept/medium (low) · reach: refuted/medium (low) · repro: kept/medium (low)

**Mechanism.** `canFire` counts every live projectile (arrows and shells included) plus reserved MIRV warheads against one 4096 budget. At saturation a launch returns "Strategic flight capacity reached", and a bomber or drone at its target `continue`s without firing. The repro verifier filled the array in the GameplayTuning fixture: the launch was refused with no gold or payload spent and succeeded once the array cleared; the bomber stayed "outbound" at the target, fuel −1 per tick, and fired as soon as pruning freed a slot; with the cap held permanently full it returned "ready" after 1201 ticks having dropped nothing. **Corrections:** the bomber hovers and retries every tick rather than circling; impacted projectiles are pruned 0.5 s after impact, so the usual effect is a few ticks' delay; an atomic payload is refunded on return. The shared cap is deliberate and tested (`GameplayTuning.test.ts:106-118`), which is why the reach verifier refuted it as a defect. No crash, desync or resource loss.

- **Evidence:** `canFire(warheads = 0): boolean { return this.projectiles.length + this.reservedWarheads + 1 + warheads <= 4096; }` and `const fired=this.battle.fire(…); if(!fired)continue;`
- **Repro:** scratchpad/verify2-air-strategic/cap.mts
- **Fix:** optional: reserve a separate budget for bomb/icbm/mirv/warhead.

#### R2-L11. The "flank" phase is dead; flank-left/right doctrine only sets wing iteration order (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:400-403`, `469`; `src/skirmish/domain/EngagementManager.ts:759-761`; `src/skirmish/content/AiDoctrines.ts:72-77`
- **Severity:** low · **Kind:** bug (dead code / unmet doctrine)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** Nothing assigns `plan.phase = "flank"`; the only other mentions are the type union (`:38`) and the restore whitelist (`:93`), so the branch at `:400` is unreachable outside a hand-crafted snapshot. The doctrine engagement "flank-left/right" only sets `army.wingPreference` (`:469`), whose sole reader orders the left/right wing loop; each side is planned independently, so neither is suppressed or weighted. The rider personality's "Stage reachable mounted wings with infantry support" contract therefore gets only the generic wing behaviour every army gets.

- **Evidence:** `} else if (plan.phase === "flank") {` and `for (const side of (a.wingPreference === "right" ? ["right", "left"] : ["left", "right"]) …`
- **Fix:** not proposed; either wire the phase or remove it and the unmet contract.

#### R2-L12. A lost trench sends the mission to recover without a regroup order (ai-tactics)
- **Where:** `src/skirmish/domain/TrenchPositioning.ts:66-74`; recover branch `src/skirmish/domain/AiArmyPlanner.ts:507-519`; skip at `349`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**Mechanism.** When any of up to 32 tracked segments within radius 16 (including ones never occupied) is destroyed or captured, `step()` releases the squads and sets `plan.phase = "recover"` without the regroup order to `plan.home` and without `plan.since = world.tick`, which every other recover transition in AiArmyPlanner includes (`359-362`, `418`, `427`, `447`). In the same think the recover branch usually finds `since` (the advance tick) more than 40 s old, because a trench hold returns early at `:369`, and disbands the army at the front with no move home; otherwise the squads idle up to 40 s. Released squads stay "leaving" until something moves them. For defence missions `home` is the defended tile, which limits the damage. Modern defence missions only. **Correction:** the reviewer's "stacks all occupants on one tile" is wrong: `segment.tiles[0]` is only where allocation starts, and `TrenchOccupancy.allocate/available` give each squad distinct reserved slots across neighbouring segments (`AiTrenchOccupation.test.ts:29` expects 2 occupants).

- **Evidence:** `this.release(plan, members); plan.phase = "recover"; plan.reason = "Trench lost; regrouping survivors"; return false;`
- **Fix:** issue the regroup order and set `plan.since` on this transition, as the other recover paths do.

#### R2-L13. Carrier landings leave a ghost ground berth at the old airstrip, pushing a later plane off the apron (client-unread)
- **Where:** `src/skirmish/client/AircraftGroundPresentation.ts:48-52`, `71-84` (reviewer cited 81), `142-145`; `src/skirmish/domain/Expansion.ts:1367`
- **Severity:** low · **Kind:** bug (cosmetic)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The reviewer flagged the unbounded `while (used.has(slot)) slot++` against a 3×2 apron (`slot%3` by `floor(slot/3)`) and guessed AirfieldCapacity normally prevents overflow. It does for real aircraft (6 per base, enforced on recruit, transfer and divert), but both verifiers found a different path past it. `fields` holds only airstrip buildings, so an aircraft that transfers to a carrier never matches a field, and `fieldId = field?.id ?? old!.fieldId` keeps its old airstrip. After landing it takes a berth there and keeps reserving it every snapshot. The simulation no longer counts it at that airstrip, so the airstrip legally fills to 6 real aircraft and the last one gets slot 6, drawn below the apron. The Renderer draws the carrier plane itself via CarrierAircraftPresentation, so only the airstrip plane is visibly misplaced. Reproduced with the real class (new airstrip aircraft at slot 6). No test covers it.

- **Evidence:** `if (!field && !old) continue; const fieldId = field?.id ?? old!.fieldId;` and `if (!keepsBerth) { slot = 0; while (used.has(slot)) slot++; } used.add(slot);`
- **Repro:** scratchpad/verify2-client-unread/berth.ts (and ghost.ts).
- **Fix:** drop the ground state when `a.airfieldId` is not an airstrip and not the old field; optionally clamp the slot to 0-5.

#### R2-L14. A rejected fire-retreat army order permanently flips the army posture to skirmish (command-fuzz)
- **Where:** `src/skirmish/domain/Armies.ts:610`; rejections at `619`, `624-625`, `627`, `630-631`, `643`, `653-655`; commit at `663`; re-apply at `1154`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** `Armies.order` sets `army.posture = 'skirmish'` for fire-retreat before every validation, so a rejected order (stale or non-hostile target, unwalkable, queue full, unreachable, planning full, route blocked) still changes the posture, and it persists until the player issues an army-posture command. A queued (append) fire-retreat also flips it immediately instead of on dequeue. CommandPolicy only checks that `targetId` is a positive integer; a target dying between click and arrival is enough. Stance behaviour then changes (`SkirmishStance.ts:170,192`). Logged 1-3 times in every fuzz run with armies. **Correction:** the slot caches do not stay stale: `syncSlots` (`:309-311`) notices `layoutPosture !== posture`, relays out, bumps `slotRevision` and invalidates engagements within `gapCheckTicks` (2 s).

- **Evidence:** `if(order.type==='fire-retreat')army.posture='skirmish';` (line 610) then `if (!target) return "Choose a hostile land squad";`
- **Repro:** `{type:'army-order', playerId:2, armyId:<own>, order:{type:'fire-retreat', targetId:65536}}`
- **Fix:** delete line 610; `:663` (immediate), the prepared re-entry at `:176` (deferred) and `:1154` (dequeue) already set it on accepted orders.

#### R2-L15. restoreShared resets clusterRevision but keeps start trees from a used instance (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:200-206`; revision-checked reads at `416-428`, `699-702`, `886-891`; invalidation listener `334-345`
- **Severity:** low · **Kind:** determinism (latent)
- **Votes:** code: kept/medium (low) · reach: refuted/high (low) · repro: kept/high (low)

**Mechanism.** `restoreShared` clears shared trees, pins and backbones and sets `clusterRevision` from the checkpoint, but leaves `startTrees`. On restore into an already-used instance, `forest.restore` first publishes the forest diff (bumping revisions), then `restoreShared` rewinds them, so a start tree cached on the abandoned branch can pass a later revision check under different costs. The repro verifier showed it directly: after rollback and a different forest change, the used instance returned the abandoned branch's route (cost 515) while a fresh restore chose cost 373. **Corrections:** portal crossing trees and `crossingBytes` are fine, because the onCostsChanged listener drops portal trees whenever the forest diff is published; `Pathfinding.restoreRevision` is a different cache and already clears. **Scope:** the only restore into a used instance is HostedRuntime (`:93`) via CommitVerifier, which has no production caller, and `verify()` never steps afterwards; only the uncalled `fallback()` would. The live server and the local worker restore only into fresh instances. That is why the reach verifier refuted it.

- **Evidence:** `this.clusterRevision.set(saved.clusterRevisions);` (no `startTrees.clear()`) and `const hit = this.startTrees.get(start); if (hit && hit.revision === revision) { … return hit.tree; }`
- **Repro:** scratchpad/verify2-movement-core/repro.mts
- **Fix:** call `this.startTrees.clear()` in `restoreShared`, or make revisions monotonic across restore.

#### R2-L16. The CohortAdmission 3000-tick deadline is a 20 Hz literal, now 375 s (movement-core)
- **Where:** `src/skirmish/domain/CohortAdmission.ts:253-258`; `100` (128 cap); `240-243`; `src/skirmish/Simulation.ts:649-651`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The check `routes.tick() - plan.created >= 3000` came in with commit a4145f42 (2026-10-03), when `TICKS_PER_SECOND` was 20 (150 s). Commit a0d02507 ("8hz") moved to 8 Hz and converted many literals but not this one, so it is now 375 s, and a stuck cohort holds one of the 128 pending slots 2.5× longer. The per-player deadline applies only when `deadlineTicks` returns a value; it is undefined for humans and committed routes. **Disagreement on AI scope:** the code verifier says AI plans are rejected after 16 ticks first, but the reach verifier found production never sets `autonomousRouteDeadlineTicks` (only tests do), making this literal the only time bound for every army cohort, human or AI, in live matches. No test exercises "Cohort admission deadline reached". Other guards (revision change, dead members) still finish plans early.

- **Evidence:** `if (plan.created !== undefined && this.ports.routes.tick() - plan.created >= 3000) { this.finish(plan, "rejected", "Cohort admission deadline reached");`
- **Fix:** `>= secondsToTicks(150)`.

#### R2-L17. Symmetric naval battles are decided by id-derived lanes, cadence and wander phase (naval)
- **Where:** `src/skirmish/Simulation.ts:2709-2712` (lane, reviewer cited 2706), `3160` (pursuit cadence, cited 3156), `3108` (wander, cited 3104); `src/skirmish/domain/AiNavalPlanner.ts:105-108`
- **Severity:** low (reviewer: medium) · **Kind:** fairness (reviewer filed it as determinism)
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**Mechanism.** Patrolling warships not in an AI fleet mission (every human warship) take their sub-cell lane from `ship.id % 4`, which offsets their real position by ±FIXED/4 with signs that do not mirror with the geometry. Pursuit re-evaluates on `(tick + id) % 4`, and the wander pick uses `(tick + tile)`. Health-scaled damage amplifies any first-hit edge. Measured (re-counted from mirror.txt): with geometry mirrored and only id allocation swapped, the winner flips in 7 of 24 cases. In bias.ts at LateMedieval, Napoleonic and Modern, the A-low-id ordering sinks A on the first exchange (B keeps 102, 271 and 820 HP) while the swapped ordering is a no-damage draw after 60 s, with final separations differing by about a cell. **Corrections:** there is no consistent "lower id loses" bias; the ids decide whether the ships end up in range at all. The outcome is deterministic, so this is fairness, not desync. bias.ts swaps creation order, so ids and array order both change. Perfectly mirrored battles are rare and no player side is favoured.

- **Evidence:** `const lane=spread ? this.expansion?.economy.naval.fleetLane(ship) ?? ship.id%4 : 0;`
- **Repro:** `npx tsx scratchpad/naval/duel.ts mirror`; `npx tsx scratchpad/naval/bias.ts`
- **Fix:** not proposed.

#### R2-L18. Prize ping-pong inflates capture stats and creates a reverse embargo row (naval)
- **Where:** `src/skirmish/domain/Trade.ts:1229-1258` (capture at `1239`); `src/skirmish/domain/Diplomacy.ts:34-35`, `48-54`, `296`; `src/skirmish/domain/AiOperations.ts:421`; HUD at `src/skirmish/domain/Expansion.ts:1982-1983` (reviewer cited 1990-1991)
- **Severity:** low · **Kind:** bug (stats and diplomacy metadata)
- **Votes:** code: kept/medium (low) · reach: kept/high (low)

**Mechanism.** After a capture the prize keeps its position with a 1 s handling wait; when it ends, the same captor query runs again with no exemption for the previous owner. With hostile warships of both owners within 1.2 tiles, the prize changes hands every second, and each flip adds the full cargo value to `capturedValue` and `lostValue` again. Measured: 5 flips in 6 s with `capturedValue` at 10× a 500-gold cargo (trade-only stepping); the reach verifier got 17 flips in 20 s in the full simulation with parked warships, while the reviewer's escorted full-sim case gave 1 flip. No gold is duplicated (cargo pays only on unload). **Corrections:** recapture does not fire a new raid notification, because `embargo()` is pair-symmetric and the first theft's row already makes it active. Under raids-v1 each recapture adds a second, reversed row with the original victim as initiator, which skews AI raid attribution (`AiOperations.ts:421`) and doubles "raid-expire" notifications. With raids off `recordTheft` returns early.

- **Evidence:** `this.lostValue[a.playerId] = … + value; this.capturedValue[captor.playerId] = … + value; a.playerId = captor.playerId; a.state = "prize"; … a.waitTicks = TICKS_PER_SECOND;`
- **Repro:** `npx tsx scratchpad/naval/piracy.ts` case (a); full-sim scratchpad/verify2-naval/pp.ts
- **Fix:** not proposed by the reviewer; the verifiers point at the missing previous-owner exemption.

#### R2-L19. Explicit naval projectile shots can launch with 0 damage (naval)
- **Where:** `src/skirmish/Simulation.ts:2905-2912` (`scaledDamage` at `2910`, reviewer cited 2905), reservation at `2914`; autonomous clamp at `2953`; `src/skirmish/domain/Battle.ts:1568-1611`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**Mechanism.** The explicit-target projectile path passes the raw `scaledDamage = floor(profile.damage × health/maxHealth × promo)`, while the autonomous path uses `Math.max(1, scaledDamage)`. Only EarlyModern+ warships and submarines fire projectiles, and they floor to 0 below about 6 HP (~0.2% of max). With empty bonuses Battle's impact budget is `(damage + bonuses) × 4 = 0`, so the shell deals nothing, and the reload is still spent. **Correction on reservation:** the `navalDamage()` added at `:2914` lasts only the current tick's local map; on later ticks `incomingNavalDamage` reserves 1 HP per in-flight shell (through `damageAmount`'s `Math.max(1, …)`), so other shooters skip only targets already at about 1 HP.

- **Evidence:** `this.expansion.battle.fire({ ...ship, domain: "ship" }, p, effectiveAttack!, scaledDamage, …)` vs `effectiveAttack!, Math.max(1, scaledDamage),`
- **Fix:** pass `Math.max(1, scaledDamage)` at line 2910.

---

## Plausible (needs a repro)

#### R2-P31. 8 active humans put the 52-faction target at about 0.25× real time on the ARM host (extrapolated) (load-test)
- **Where:** `src/skirmish/Simulation.ts:3382-3390` (`step`/`performTick`; reviewer cited 3388); clock-debt policy `src/skirmish/multiplayer/application/LiveMatch.ts:717-726`
- **Severity:** high (reach verifier: medium) · **Kind:** perf (capacity)
- **Votes:** code: kept/low (high) · reach: kept/low (medium)

**What happens.** Desktop ticks (quiet batch, calibrated within ~20% of 06's uncontended probe): Mediterranean 198 ms mean (p99 464, max 851), Migration 206 ms mean (p99 497, max 1063), against 154 ms for an idle-seat control with the same armies. Increase over idle: routing +18/+41 ms, combat +18/+11 ms, movement +9/+5 ms. The desktop runs at 0.61-0.63× real time (the real ReservedMatchWorker run reached 0.60×). Multiplying by 2.4 gives 475-495 ms per tick on ARM, about 0.25× real time with p99 about 1.1-1.2 s, against round 1's 0.5× estimate. LiveMatch keeps at most four ticks of clock debt, so over-budget ticks slow the game rather than catch up, and tick-denominated latencies (move commit p95 34-51 ticks) become 17-25 s of wall time on ARM.

**Why only plausible.** Both verifiers kept it with low confidence. There is no code defect at the cited line. The idle-seat control alone is already over the 125 ms budget (about 0.81× on desktop, about 0.34× on ARM by the same factor), so the 52-faction AI load is the main cost and humans add roughly 20-35%. The control is not "identical armies" after tick 1200: the idle runs lose factions faster (52 → 30 alive, 1177 → 912 squads) while the human runs keep 43 factions and ~1100 squads, which confounds the delta; matching early windows still gives about +52 ms. The ×2.4 ARM factor is an assumed argument (`queuemodel.mjs`), not measured, and batch means varied about 1.5× between runs. `docs/OracleLateGameHardwareTest.md` requires measuring on the A1 host.

- **Repro:** `inproc.mts med|mig humans` vs idle; `worker.mts` with `mig-humans-log.commands.json`.
- **To settle:** run the same checkpoint and command log with `scripts/profileV11Oracle.sh` on the A1 host, with an idle control whose faction count matches.

---

## Perf findings

These are all confirmed perf-kind findings. Each entry's **Expected impact** uses only the numbers the reviewer or verifiers measured or estimated.

### High

#### R2-P1. Procedural prepare at 2000 always exceeds the 30 s worker timeout; 1000 on ARM is an unmeasured risk (mapgen)
- **Where:** `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts:67-72`; `serverMatchWorker.ts:131-147`; `src/skirmish/lobby/LobbyDirectory.ts:87-92`; `src/skirmish/client/main.ts:128`, `811`
- **Severity:** high
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**What happens.** Generation (`generateProceduralMap`, no cache), `SpawnSelection.resolve` and `mapIdentity` all run in one "prepare" request under a fixed 30 s timer; LiveMatch passes no pre-built map. The lobby accepts 2000 for procedural maps and the UI offers "2000 cells · procedural maps only". On timeout the worker is terminated and `CoordinatorServer.ts:475-482` ends the match for the whole lobby. The client runs the same generation on the browser main thread (`main.ts:811`), counted against the 60 s load deadline. Reviewer hotspots: migrationCoastDistance ~38% (`MigrationLayout.ts:124-131` checks every other island for every tile), RegionalTopography ~20%, priority-flood heap with object allocation ~20%, GC ~19%.

**Expected impact.**
- Desktop (Ryzen 3700X, 384 MB worker): Migration 1000 10.8 s, Continents 1000 15.3 s, Black Forest 1000 18.2 s.
- Desktop at 2000: 47 / 81 / 67 s; verifier re-runs of migration seed 3: 41.5 s and 41.8 s (generation alone 36-37 s). Every 2000 lobby fails at startup.
- ARM at 1000 (desktop × 2.5, extrapolated, not measured): about 27, 38 and 46 s.
- Per-seed variance at 250 is about 3×. The client freezes for seconds at 1000 and tens of seconds at 2000 (not re-verified).

- **Evidence:** `const timeout = setTimeout(() => { … this.fail(new Error(\`Match executor timed out during ${request.type}\`), "timeout"); void this.worker.terminate(); }, 30_000);`
- **Repro:** `npx tsx scratchpad/mapgen/prep.mts continents 1000 1` (15298 ms); `prep.mts migration 2000 1` (47028 ms).
- **Fix:** not proposed beyond the hotspots.

#### R2-P2. A mixed army/non-army human move runs synchronous HPA* on the never-warmed amphibious graph (movement-core)
- **Where:** `src/skirmish/Simulation.ts:1480-1483`, `1543-1553` (findGroup at `1546`), `3412` (live warm-up, land and water only; reviewer cited 3408); `src/skirmish/domain/Armies.ts:403-411`; `src/skirmish/HierarchicalPaths.ts:433-440`, `1123`/`1215-1217`; `src/skirmish/Pathfinding.ts:317-324`
- **Severity:** high
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**What happens.** A non-append move goes to deferred admission only when no selected squad is in an army, and `Armies.groupOrder` returns undefined unless the selection is exactly one whole army. A partial army, or an army plus loose squads, therefore falls through to the legacy synchronous branch: `Formations.plan`, then `squadPaths.findGroup`, then `HierarchicalPaths.find`, whose `crossing()` builds every missing portal tree synchronously with no budget. The amphibious graph is built unprepared (`Simulation.ts:800`) and only warmed when `autonomousRouteDeadlineTicks === secondsToTicks(2)`, which live config never sets; 49-52 of 52 factions are amphibious from Napoleonic on. The client sends selections unsplit (`main.ts:1916-1936`) and the server does not reject them. One click stalls the tick for every player (same class as the 2026-10-15 freeze). Built trees stay cached and the deferred planner fills them over time, so it is worst early in a match or on the first move into a new region.

**Expected impact.**
- HEAD, Mediterranean 500: 535 ms inside `applyCommand`, 666 trees built synchronously; Mediterranean 1000: 2,612 ms, 2,787 trees (about 6 s on ARM, extrapolated).
- Working tree (verifiers), heightmap-test1 500: 309 ms and 359 ms, 666 trees.
- Plain-squad control: 0 ms. A prepared graph answers 40 squads in 36 ms.

- **Evidence:** `if(this.options.deferredPlanning && !append && order.type==="move" && selected.every(s=>!this.expansion?.armies.armyOf(s!.id) && …))` and `if (!portal.tree) { portal.tree = this.localTree(portal.tile, portal.cluster); …`
- **Repro:** Napoleonic, 1 human + 3 AI, heightmap-test1, `DEFAULT_AI_POLICIES`; at tick 40 create-army [A,B], then time a move of [C,A] to the farthest connected land tile (scratchpad/movement-core/mixedsel-head.mts).
- **Fix:** send mixed selections through movementAdmission or groupOrder (or reject them), and cap cold-tree builds in `HierarchicalPaths.find`.

#### R2-P3. Planner job slots are monopolised by per-member interactive requests; AI and trade routing are starved (load-test)
- **Where:** `src/skirmish/RoutePlanner.ts:520-532` (job limit 128 at `167`); `src/skirmish/MovementAdmission.ts:946-955` (per-member request; reviewer cited 961); `src/skirmish/Simulation.ts:822`, `434-437`, `953`; extends round-1 P20
- **Severity:** high (reach verifier: medium; code verifier: medium-high)
- **Votes:** code: kept/high (high) · reach: kept/medium (medium)

**What happens.** Every member of every human cohort submits its own exact planner job. Interactive (human, non-trade/strategy) requests may fill all 128 slots; background requests are refused at 120 and uncommitted ones at 104. There is no per-player or aggregate interactive cap, and a refused member is retried on the next pass (only a "limited" outcome gets a backoff). Orders of up to 30 squads and up to 20 humans are legal, and the per-player rotation in `nextJob` only applies after admission. **Corrections:** followers wait for the leader and nearby members reuse its spine, so each job is lighter than a full search; reserving slots for interactive work is intended. The idle-seat control's background work alone reaches its own 104 cap from about tick 4400, so part of the AI/trade refusals is a baseline. The real defect is unbounded interactive admission plus immediate retries, which lets one or more humans hold the 104-128 band.

**Expected impact.**
- 8 active humans: planner averaged 115-124 jobs (max 128 in every 400-tick window) for 10 minutes, with 274-635 movement admissions pending; idle-seat control: 62-85 jobs, 33-66 admissions.
- Refusal rates: human 68-88%, AI 86-97%, trade 96-97%; the real worker counted 1.03M refusals in 6000 ticks (~171 per tick).
- Routing phase +18 ms (Mediterranean) and +41 ms (Migration) mean on desktop, p99 126-337 ms, single ticks 529-919 ms. Move commit latency p50 7-12 ticks, p95 34-51 ticks.

- **Evidence:** `if (!this.jobs.has(request.key) && this.jobs.size >= this.jobLimit) { this.diagnostics.admissionDeferred++; return false; }` and `member.requested = this.ports.request(id, admission.playerId, member.id, start, goal);`
- **Repro:** scratchpad/load-test/inproc.mts med|mig humans 1272661902 1200 4800 vs the idle control; `PROFILE=1` adds refusal counters.
- **Fix:** not proposed by the reviewer; the verifiers point at the missing per-player/aggregate interactive cap and the immediate retry.

#### R2-P4. Soldier-scale battle frames cost about 190-300 ms, split between choreography JS and per-soldier drawImage (client-unread)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:896-1280` (per-soldier loop from `1226`; reviewer cited 1215), `271-321` (`flush`); `src/skirmish/client/troops/TroopPresentation.ts:13`, `97`; extends round-1 P10
- **Severity:** high (reach verifier: medium; code verifier: high only if the timings reproduce)
- **Votes:** code: kept/medium (high) · reach: kept/medium (medium)

**What happens.** Once `pixelsPerCell >= TROOP_DETAIL_CUTOFF` (12) and sheets are loaded, every on-screen squad goes through `TroopActors.draw` (choreography, engagement and slot sampling, per-squad cavalry planners, allocation-heavy spreads, and `unitDefinition`/`weaponCycle`/`throwTiming` recomputed per soldier although they are per-squad), then `flush` sorts the queue and runs save/translate/rotate/drawImage/restore per soldier plus two `impacts.member` passes. Viewport culling is the only limit: there is no detailed-soldier budget or choreography LOD. `InstancedActorSprites` is imported only by the test scene `tests/skirmish/browser/InstancedTroops.ts`. Squad caps up to 200 per faction in Modern make 200+ visible detailed squads reachable in large late-game fronts.

**Expected impact.**
- Real Chrome, 1600×900, densest fight, scale 16 with 202 detailed squads: draw p50 186.6 ms, p95 298, p99 383; `TroopActors.draw` p50 90.4 ms, `flush` p50 86.3 ms.
- Scale 12 with 273 squads: p50 298 ms (137 + 128). Without loaded sheets: 20.6 ms. A 3-5 fps slideshow on the reference desktop.
- Reviewer ranking: instancing plus a soldier budget is about 10× the win of round-1 P1 (~10 ms per publication). The timings were not reproduced by the verifiers (harness outside the repo).

- **Evidence:** `for (const [soldierIndex,soldier] of soldiers.entries()) {` … `const definition = this.options?.unitDefinition?.(squad)??UNIT.get(…)` and `ctx.save(); ctx.translate(…); ctx.rotate(entry.angle); ctx.drawImage(…); ctx.restore();`
- **Repro:** tree2/measure/index.html?squads=40&modes=soldier16,soldier12
- **Fix:** instance via `InstancedActorSprites` for the flush half; a detailed-soldier budget (for example 2,500 soldiers nearest the centre or selection) and choreography LOD (30 Hz sampling, skip engagement sampling when not in contact) for the other half. Cheap first step: hoist the per-soldier lookups out of the loop.

### Medium

#### R2-P5. Each spawn click reruns the full 52-faction placement on the serial worker; queued clicks can hit the 30 s timeout (mapgen)
- **Where:** `src/skirmish/StartingPositions.ts:16-36`; `src/skirmish/domain/SpawnSelection.ts:82-88`, `110-146`; `src/skirmish/multiplayer/application/LiveMatch.ts:510-523`; `ReservedMatchWorker.ts:64-72`; `src/skirmish/client/main.ts:1622`
- **Severity:** medium (reach verifier: high)
- **Votes:** code: kept/medium (medium) · reach: kept/high (high)

**What happens.** `SpawnSelection.select` runs a full `resolve()` on every click: a new `StartingPositions` with a w×h Float64Array, one `add()` per human (a pass over every candidate) and one `next()` per AI and tribe (two passes each), with up to 16 retries on failure. Requests run one at a time on the worker; each 30 s timer starts at enqueue; a timeout terminates the worker and ends the match at the spawn screen. The only limit is a backlog of 8. The client posts on every valid click and LiveMatch has no per-guest rate limit (only the coordinator's 50 messages/s per session). **Disagreement:** at 1000 the code verifier found 8 queued clicks finish in ~16-19 s on desktop, so a timeout needs a host about 2× slower or retry-heavy resolves; the reach verifier measured Black Forest 2000 (allowed for procedural maps) at ~14.5 s per select, where three clicks push a queued request past 30 s.

**Expected impact.**
- Black Forest 1000 (976,144 candidates): reviewer select 2.4 s desktop (~6 s ARM, extrapolated); verifiers 1.86-1.90 s.
- Reviewer worst case: 8 humans clicking in the 10 s window queue 8 requests; the last waits ~42 s.
- Black Forest 2000 (3,952,144 candidates): select ~14.5 s. Migration 1000: 0.49 s per click.

- **Evidence:** `select(…) { … this.reservations.set(playerId, tile); try { this.resolve(); }` and `add(tile, radius) { for (const candidate of this.candidates) this.clearance[candidate] = Math.min(…)`
- **Repro:** `npx tsx scratchpad/mapgen/resolve.mts black-forest 1000` (ctorMs 2139, resolveMs 2359, selectMs 2393).
- **Fix (verifier):** coalesce or rate-limit select-spawn per guest; validate a reservation cheaply instead of re-placing every faction; start the timeout when the worker begins the request.

#### R2-P6. MovementAdmission priority selection is O(P²): it spreads the whole pending map on every loop iteration (load-test)
- **Where:** `src/skirmish/MovementAdmission.ts:801-804` (spread at `803`), `795`, `788`; idle exits `930`, `943`, `945`, `975`; callers `src/skirmish/Simulation.ts:623`, `626`, `627`, `632`
- **Severity:** medium (reviewer: high; verifiers: medium-high)
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**What happens.** With `priority = true`, every loop iteration evaluates `[...this.pending].find(...)`, materialising P entries. When human admissions wait on the planner, the loop spends no budget and only exits when `idle >= this.pending.size`, which counts all pending admissions, AI included, so one call costs about P iterations × P entries (a single waiting human among hundreds of AI admissions is enough). **Correction:** it runs up to 4 times per tick, not 3: `stepInteractive` twice and the 2/3 priority pass inside each of two `movementAdmission.step` calls; `:795` adds another full spread per `stepInteractive`. Nothing caps P. CPU only.

**Expected impact.**
- Reviewer micro-benchmark: 4 ms per call at P=150, 17-23 ms at P=320-500. Verifier benchmarks: 1.4-1.7 ms at 150, 5.4-6.0 ms at 300, 12.7 ms at 450-500.
- Contended match profile: 10-16 ms of thread CPU per tick (6-7% of the tick), 93-97% in the priority path, at mean P = 271-467; about 25-40 ms per tick on ARM (extrapolated).

- **Evidence:** `const entry = priority ? [...this.pending].find(([, admission]) => this.ports.priority?.(admission.playerId)) : this.pending.entries().next().value;`
- **Repro:** scratchpad/load-test/spread-bench.mjs; `PROFILE=1 inproc.mts med humans 1272661902 1200 1600 -prof`
- **Fix (verifier):** iterate the Map in place with an early exit, or keep a separate insertion-ordered index of priority admissions and bound `idle` by the priority count.

#### R2-P7. Publish-on-command raises publications to about 6.5 Hz, and streamed publications lag one advance under saturation (load-test)
- **Where:** `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:282-285`, `265-266`, `82-84`; `src/skirmish/multiplayer/application/PublicationQueue.ts:18`, `26-30`; `LiveMatch.ts:727-731`; extends round-1 P14 and P15
- **Severity:** medium (reach verifier: low)
- **Votes:** code: kept/high (medium) · reach: kept/medium (low)

**What happens.** The worker ORs "any command executed" and "any cohort committed" into the publish decision, while LiveMatch schedules its 5 Hz cadence without counting those extra publications, so the total exceeds 5 Hz (up to one per advance, 8 Hz). Encoding happens on a separate thread, but the result is forwarded only when the sim thread yields; under saturation the next advance starts before the encoder reply is handled, so the publication reaches the coordinator one advance late. **Corrections:** the delay affects every streamed publication, background ones included, and only once the simulation is already over budget. Publishing on commands is intended (code comment; `ReservedMatchWorker.test.ts:33` pins it), and egress is bounded by PublicationQueue capacity 2 and ClientStateFlow's window of 4, which is why the reach verifier rated it low.

**Expected impact.**
- 6.45-6.59 publications per simulated second vs 5.00 idle.
- At full speed 426 KB/s (Mediterranean) and 332 KB/s (Migration) per client vs 285/259 idle: 21-27 Mbit/s egress for 8 clients.
- About 1.5 × 7 ms extra sim-thread capture, 1.5 × 12 ms encoding and ~70 ms of client CPU per second of game time.
- Real-worker run: saturated delivery delay 208 ms mean, 472 ms p99, vs 5-10 ms unsaturated.

- **Evidence:** `const publish = request.publish || commandProgress || outcomes.some(outcome => outcome.status === "executed");`
- **Repro:** worker.mts with the mig humans command log (`measured.delay`, `pubsPerSimSec`).
- **Fix:** not proposed by the reviewer.

#### R2-P8. The client's per-publication cost is dominated by the structured clone of the full entity view (load-test)
- **Where:** `src/skirmish/client/CanonicalStateStream.ts:133-152` (`presentationState`); the clone is the implicit postMessage at `src/skirmish/client/multiplayerStateWorker.ts:99-103` (and `:34`); `src/skirmish/client/OnlineMatchSession.ts:239`, `411`, `458-460`; extends round-1 P1 (reviewer cited 02 N1)
- **Severity:** medium (reach verifier: low)
- **Votes:** code: kept/medium (medium) · reach: kept/medium (low)

**What happens.** Production always asks for the entities projection, and `presentationState()` shallow-spreads every entity row of the latest snapshot. Only the tile buffer is transferred, so `postMessage` structured-clones the whole squad/order/building graph on every presented publication, scaling with total squads, not changed rows. A transferable `presentationPacket()` path exists but is unused in production. **Corrections:** there is no explicit `structuredClone` on this path (the reviewer's replay used one as a stand-in); the cost is split between worker serialisation and main-thread deserialisation. Presentation is coalesced while one is in flight (`OnlineMatchSession.ts:411`), and flow credit is sent after decode, not after presentation, so the claimed slide into the 4-frame-window baseline-recovery loop (02 N1) is not shown. Frame hitching and CPU, not correctness.

**Expected impact.**
- Replay of 3000-3950 real publications: decode 5.4-6.2 ms, apply 5.5-6.3 ms, projection 0.03 ms, clone 25-29 ms; total 37-40 ms per publication (p99 ~54 ms), at 1100-1250 squads with 255-334 changed rows.
- About 255-260 ms of CPU per second at 6.5 Hz, roughly half of it main-thread deserialisation; about 650 ms/s on a 2.5× slower laptop (extrapolated).

- **Evidence:** `const { owners, claims, progress, changedTiles, expansion, ...entities } = source; const snapshot = { ...entities, …` and `self.postMessage({ …, ...state, … }, { transfer: [state.view.tiles.buffer] });`
- **Repro:** `replay.mts out-<map>-humans.pubs.bin W H`
- **Fix (verifier):** use the existing transferable `presentationPacket()` path, or send only changed rows.

#### R2-P9. Strategic-zoom frames re-derive formation pose and envelope for every on-screen squad every frame (client-unread)
- **Where:** `src/skirmish/client/Renderer.ts:1442` (`formationPoses.clear()`), `1454` (pre-cull envelope), `1492` (`formationRenderPose`); `src/skirmish/client/FormationRenderPose.ts:24-80`; `src/skirmish/domain/FormationGeometry.ts:311-322`; `src/skirmish/client/CombatPresentationTimeline.ts:~112`
- **Severity:** medium (reviewer: high; code verifier: high if the Chrome numbers hold)
- **Votes:** code: kept/medium (medium) · reach: kept/medium (medium)

**What happens.** Each draw (60 fps cap) clears the pose map, calls `formationEnvelope` for every squad to get a view radius, then `formationRenderPose` for every visible squad, which rotates every footprint polygon into new arrays with trig per point and rebuilds bounds. At strategic zoom every squad is visible. **Corrections:** envelopes, slots, footprints and `geometryKey` are each cached and `geometryKey` builds no new string per call, but CombatPresentationTimeline creates interpolated squad/formation objects each frame, so the x/y- and object-keyed caches miss for moving or turning squads, and during transitions they key on the fractional tick. Inputs change every frame (8 Hz sim plus interpolation), not every 200 ms. Only lobbies of about 1000 squads at strategic zoom are affected.

**Expected impact.**
- Real Chrome with 1042 squads: draw p50 17.7-19.9 ms, p95 30-33 ms, p99 41-48 ms, already over the 16.7 ms budget; ARM-class laptops about 20-25 fps (extrapolated). Not reproduced by the verifiers.
- V8 profile (verifier re-read): the closure is 60% of draw; inside it `formationRenderPose` 52%, `formationEnvelope` 29%.
- Even at soldier zoom with few squads visible, the pre-cull envelope costs 8-11 ms.

- **Evidence:** `squad.formation && !squad.afloat ? (formationEnvelope(squad,visualTick).broadRadius/FIXED+1)*this.scale : 0);` and `const formationPose=squad.formation && !squad.afloat ? formationRenderPose(squad,visualTick,this.world(p.x,p.y)) : undefined;`
- **Repro:** tree2/measure/index.html?modes=strategic in Chrome; jsdom bench with `BENCH_PROFILE=1` plus under.cjs on prof/strategic.cpuprofile.
- **Fix:** cache the pose shape per squad id, formation identity and integer tick (floor only during transitions) and translate/rotate it per frame; cache broadRadius per snapshot; derive the strategic box from the cached envelope.

#### R2-P10. A failed reorientation is retried every tick with no backoff, with up to two O(n³) Hungarian solves each time (movement-core)
- **Where:** `src/skirmish/Simulation.ts:2269-2273` (reviewer cited 2271); `src/skirmish/domain/FormationGeometry.ts:113-120` (solve #1 at `117`), `435`, `454-467`, `481`; `src/skirmish/domain/FormationSlotAssignment.ts:8-60`
- **Severity:** medium
- **Votes:** code: kept/high (medium) · reach: kept/medium (medium)

**What happens.** When the target bearing differs from the facing by 30°+ (or a hold has an explicit facing), `advanceFormationStates` calls `reorientedFormation` and certifies the result. On failure nothing is written (no transition, retryTick or blocked flag), so the next tick repeats the whole attempt; squads holding with an explicit facing skip the 30° filter and can retry indefinitely. Each attempt runs one uncached Hungarian solve used only to size the duration, and certification runs a second one in `assignedTransitionSources` on the same inputs. **Correction:** the WeakMap pair cache misses (fresh `fromSlots` each time), but the geometry-keyed `transitionAssignments` cache (128 entries, FIFO) can serve solve #2 on retries with unchanged geometry, so a failed attempt costs one to two solves, not always two.

**Expected impact.**
- Med 500, 52 factions: the phase took 6-11% of tick time; attempts rose from 5.6 to 29 per tick, up to 6.7 failures per tick, 99.4% retried the next tick; p99 65-157 ms (contended).
- Hungarian at n=144: 13.6 ms (reviewer, contended), 7.4 ms (verifier, uncontended); a full 144-troop reorientation 12-38 ms.

- **Evidence:** `const formation=reorientedFormation(s,this.tick,facing),candidate={...s,formation}; if(this.emptyTransitionTerrain(…) || this.certifyFormationPolygon(candidate,…,'deploy'))this.squadEntities.updateOwned(s.id,{formation}); continue;`
- **Repro:** scratchpad/movement-core/formations.mts heightmap-test1 500 3200
- **Fix:** compute the assignment once (seed `assignmentPairs` from `reorientedFormation`), add a `reorientRetryTick` backoff (not `retryTick`, which `columnDecision` reads), and optionally an O(n log n) assignment for large n.

### Low

#### R2-P11. Assault presentation geometry is recertified and rewritten on every melee strike; extends round-1 P29 (tree-delta)
- **Where:** `src/skirmish/domain/Battle.ts:989-992` (inside the shot loop at `964-965`; reviewer cited 988); `src/skirmish/domain/CavalryAssault.ts:71-73`; `src/skirmish/Simulation.ts:2003-2008`
- **Severity:** low (reviewer: medium)
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** Each committed melee shot of an assaulting rider runs `assaultContactGeometry` with one `chargePresentationClear` terrain certification and replaces `cavalryEngagement` with a new object even when nothing changed. Authoritative code never reads x, y, nx, ny, halfWidth, approach, pressure or resistance (only validation and the client do), and the floats are unrounded. Reviewer: same class as round-1 I7 (08 P29). **Correction:** the bandwidth claim is wrong. Engaged squads are already in the delta every tick (the `lastCombatTick` write at `Battle.ts:956-957`), the detail string table is rebuilt per packet, and identical geometry gives identical bytes; the only snapshot cost is a SquadDetailCache identity miss that re-runs `JSON.stringify`. The waste is server CPU only.

**Expected impact.**
- 21 replacements in 20 s with 1 real geometry change; ~429 B of JSON each; 91 µs per certification on desktop.
- At ~200 engaged cavalry: ~25 certifications per tick, about 2.3 ms desktop and 5-6 ms ARM (verifiers: 2-6 ms against a 125 ms tick). The reviewer's ~86 KB/s per-client churn figure is refuted.

- **Evidence:** `if(activeAssault && … targetIds.includes(target.id)) this.world.updateSquad(squad.id,{cavalryEngagement:{...squad.cavalryEngagement, assault:{...activeAssault,...assaultContactGeometry(…)}}});`
- **Repro:** scratchpad/delta/churn.ts
- **Fix (verifier):** skip the recomputation or update when target, pose and tick-relevant inputs are unchanged, reuse the previous object when the geometry is equal, or move the geometry to the client.

#### R2-P12. Large map fields are copied 2-3 times during generation and map construction (mapgen)
- **Where:** `src/skirmish/Elevation.ts:46`, `82-86`; `src/skirmish/Forest.ts:35` (reviewer cited 100); `src/skirmish/MigrationMap.ts:~127-141`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:58-66`, `144-145`, `176`, `184`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** ElevationField slices values, SkirmishMap slices the resource arrays, and ForestField slices cover. Migration builds a throwaway "bare" SkirmishMap and then a full one, and `serverMatchWorker.makeMap` builds yet another from the RuntimeMap arrays. During spawn selection, `preparedMap`'s raw arrays plus two SkirmishMaps (setup's and the new match's) are alive together at `:176`. The suitability table is 8 bytes per tile (32 MB per copy at 2000). Most copies are short-lived, so the cost is peak memory and GC churn during generation and startup. The browser also builds maps through `loadMap`.

**Expected impact.** Peak RSS about 500 MB at 2000 and 236-256 MB at 1000 (reviewer; not re-verified). The worker cap held; low-memory browsers at 1000/2000 are at risk.

- **Evidence:** `this.values = data.values.slice();` and `const makeMap = (map: RuntimeMap) => createSkirmishMap(map.width, map.height, map.terrain, map.elevation, map.forest, map.resourceTerrain);`
- **Fix:** not proposed.

#### R2-P13. advanceTransfer rebuilds all air bases per transferring plane per tick (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1354-1362` (reviewer cited 1349), called from `1269` and `1275`; per-tick map at `1244`; `src/skirmish/domain/AirBases.ts:12-14`; `src/skirmish/domain/AirfieldCapacity.ts`
- **Severity:** low (reviewer: medium)
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** Pre-refactor, `advanceAircraft` ran `world.buildings.find` per aircraft per tick; the refactor builds one `aviationBases()` map per tick. `advanceTransfer` still calls `aviationBases()` (all buildings and ships, allocating) for every transferring aircraft every tick: O(T×(B+S)). **Corrections:** the O(bases×A) `airfieldAircraftCount` scan runs only on a tick where no destination resolves (first diversion tick, or after the destination is lost). Simultaneous transfers are bounded by human micro (32 ids per command, 6 per destination, no AI transfers) and carrier-loss diversion (~6 per carrier), and the 200-transfer benchmark used an over-capacity synthetic setup. Reusing the per-tick map must also apply the owned-tile filter.

**Expected impact.**
- Pre-refactor (1664 parked aircraft, airstrips late in the list): 71 ms at 500 buildings, 160 ms at 1000, 318 ms at 2000 desktop (~2.5× on ARM). Post-refactor: 1.2 ms all parked, 6.6 ms half airborne.
- Transfers: +2.6 ms at 50 and +12 ms at 200 desktop (verifier re-run 1.9 / 4.1 / 13.8 ms at 0 / 50 / 200, partly anti-air). Realistic counts: about 1-3 ms per tick.

- **Evidence:** `const transfer=a.transfer!,bases=this.aviationBases().filter(b=>b.playerId===a.playerId&&baseAccepts(b,a.definitionId));`
- **Repro:** scratchpad/air/perf.ts with `LATE=1 ALLREADY=1 [TRANSFER=200]`, args 1664 1000 200 300.
- **Fix:** pass the per-tick bases map (with the owner filter) and an occupancy map into `advanceTransfer`; add a perf contract.

#### R2-P14. Anti-air squads and homing anti-air shells scan all aircraft linearly; drone swarms multiply the entity count (air-strategic)
- **Where:** `src/skirmish/domain/Battle.ts:813-822`, `1222-1223`; `src/skirmish/content/DroneSwarms.ts:4-10`; `src/skirmish/domain/Expansion.ts:950-959`, `985`, `1242-1244`
- **Severity:** low (reviewer: medium)
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** For each anti-air squad (only the modern anti-air vehicle profile targets aircraft) `Battle.fight` filters every aircraft each tick, computing distance and `effectiveRange` per hostile airborne aircraft; homing shells do `aircraft.find` per tick. A drone swarm creates 20 entities but uses 1 of 32 slots, so a faction can field about 640 airborne drones (120 s fuel). The airborne SpatialGrid is rebuilt only in `advanceAircraft`, after `fight`. **Corrections:** the sort covers only the in-range subset; homing finds come only from warship and emplacement AA shells (2 s reload), so they are minor; `rangedElevation` is cheap for these hull weapons; 640 needs mass simultaneous launches from multiple sites.

**Expected impact.** Reviewer: hundreds of AA squads × thousands of aircraft = 10⁵-10⁶ checks per tick (not measured). Verifiers: realistic worst case about 10⁵ cheap checks per tick, a few ms of a 125 ms tick.

- **Evidence:** `const target = aircraft.filter((a) => a.health > 0 && a.state !== "ready" && this.diplomacy.hostile(squad.playerId, a.playerId) && this.distance(squad, a) <= effectiveRange(this.world,squad,profile,a) ** 2,).sort(…)[0];`
- **Fix:** build the airborne SpatialGrid before `fight` and query it, use an id → aircraft Map for homing shells, and add an entity cap for swarm members.

#### R2-P15. Aircraft and projectiles are re-sent in full in every packet; extends round-1 P13 (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1935-1944` (`replicationMetadata`; reviewer cited 1984), `1975-1976`; `src/skirmish/SnapshotCodec.ts:166-176`; `serverMatchWorker.ts:41`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** `aircraft` and `projectiles` have no revision, so `selectMetadata` copies both arrays into every packet from one shared encoder. **Corrections:** a revision alone would save only parked aircraft, since moving ones change every tick; the real saving needs per-entity deltas or compact rows. ~1664 aircraft is reachable only through drone swarms; the repro's 1664 bombers on one airstrip ignore both capacity limits. Enemies seeing mission "atomic", `atomicPayload` and the target point matches the game having no fog of war anywhere, so it is not a separate defect.

**Expected impact.** About 14 compressed bytes (18-20 base64 characters; verifier 19.88) per moving aircraft per packet: 1664 aircraft add ~31 KB per packet, ~155 KB/s per client at 5 packets/s.

- **Evidence:** `const revision=metadata?.revisions[key]; if(full || revision===undefined || this.metadataRevisions[key]!==revision)Object.assign(output,{[key]:source[key]});`
- **Repro:** scratchpad/air/packet.ts 300|1664
- **Fix:** per-entity deltas or compact rows; the reviewer also proposed a revision and stripping target and mission for non-owners.

#### R2-P16. The full, fixed player list is sent in every publication; extends round-1 P13 (popup-spec)
- **Where:** `src/skirmish/SnapshotCodec.ts:390`; `src/skirmish/Simulation.ts:5603`; `serverMatchWorker.ts:41`
- **Severity:** low (reviewer: medium)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `players: source.players.map(p => ({...p}))` runs on every packet from one shared encoder, including eliminated players and the private gold, reserves, reserveRemainder and base fields. **Corrections:** the roster is fixed at construction (no player spawns mid-match, at most 64), so it does not grow with "lifetime ids"; the roster colour key is stable and `COLORS` is already sized to `MAX_PLAYER_ID + 1`, and `TerritoryLayer.setColors` returns early unless a colour changes, so no territory repaint happens after the first snapshot. Other factions' gold is shown on purpose in the diplomacy panel (`EmpireView.ts:776`); only reserves are sent without being shown.

**Expected impact.** 52 players: 13,396 B JSON / 1,686 B gzip per packet; 68 players: 17,797 / 1,930 (68 is above the cap); identity fields alone 971 B gzip. About 1-2 KB compressed per publication at 8 Hz.

- **Evidence:** `players: source.players.map((p) => ({ ...p })),`
- **Fix (verifier):** send static identity fields only on reset or change, and strip or round private economy fields for non-owners.

#### R2-P17. Measured AI cost per pop-up faction: squad count dominates; round 1's "+10% at 6 pop-ups" had no basis (popup-spec)
- **Where:** `src/skirmish/Simulation.ts:4892-5060` (`thinkAi`; per-squad loop from `5013`; reviewer cited 4961)
- **Severity:** low (reviewer: medium) · informational capacity note
- **Votes:** code: kept/medium (low) · reach: refuted/medium (low) · repro: kept/medium (low)

**What happens.** A probe on Migration 500 (seed 1272661902, 52 factions, all AI) wrapped `AiOperations.step/enabled` and `Skirmish.thinkAi`. Per-faction work is small; `thinkAi` iterates every autonomous squad with a spatial query and a `hostile()` check per nearby enemy, so cost scales with squads. Pop-up and nomad factions exist only in `.codex/1.5 Update Plans/Nomad Factions/PLAN.md` and are not implemented, which is why the reach verifier refuted it as a defect.

**Expected impact.**
- Reviewer (ARM-equivalent, shared machine): AiOperations 0.05-0.10 ms per AI record per tick; thinkAi 0.011-0.016 ms per squad; AI phase 10-12.6% of the tick; `Diplomacy.hostile` 11-22k calls per tick. 6 pop-ups ≈ +1 ms AI and +2-4% tick; PLAN.md's 20 nomads at cap 10 ≈ +12-28 ms per tick, at 40 squads each ≈ +50-110 ms.
- Repro verifier (idle local x64): AI phase 9.5-10.9% in every window; thinkAi 0.0045-0.0071 ms per squad; AiOperations 0.006-0.021 ms per record; hostile 2.7-11.5k calls by tick 1600. Adding 6 real tribes added 0.8-1.2 ms of AI and 17-34% to the tick at ticks 1200-1600, from 110-150 extra squads.
- **Corrections:** the "0.06-0.14 ms per squad" figure is whole-tick cost per squad, not AI cost, so the nomad projections are whole-tick costs; the AI part of +6 pop-ups is about 0.4-0.7% of the tick.

- **Repro:** `npx tsx scratchpad/popup/aicost.ts 30 3200`
- **Fix:** none; a planning input for the nomad feature.

#### R2-P18. SkirmishStance spends its 8-per-tick global budget on every registered skirmish-army member (ai-tactics)
- **Where:** `src/skirmish/domain/SkirmishStance.ts:169-185`, `249-251`; `src/skirmish/content/TacticalRules.ts:52`, `54`; posture set at `src/skirmish/domain/AiArmyPlanner.ts:468`, `src/skirmish/domain/Armies.ts:610/663/1154`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** `step()` walks every skirmish-posture army's members each tick to register states (calling `eligible()` before the cheap `states.has()`), then evaluates only `min(BUDGETS.skirmish = 8, states.size)` squads in one global round-robin. Idle squads with no threat, and suppressed or entrenched ones, take slots like engaged ones. A withdrawal can only start while `remaining >= minRemainingTicks` (1 s), and finishing a withdrawal (return to slot) also waits for the squad's turn. The AI already uses skirmish posture, so this is reachable today. **Correction (reach):** this is an effectiveness problem from budget dilution more than CPU; registering states on army-posture/army-members commands would not fix it.

**Expected impact.** With ~300 ranged in skirmish posture at the 52-faction target, each is visited about every 4.7 s, against reload windows of 2.5-12 s. Above about 96 registered states, a 2.5 s reload's 12-tick trigger window can fall between visits.

- **Evidence:** `const ids = [...this.states.keys()]; for (let n = 0; n < Math.min(BUDGETS.skirmish, ids.length); n++) { const id = ids[this.cursor++ % ids.length]`
- **Fix:** evaluate only reloading squads with a threat nearby, or scale the budget with the number of states.

#### R2-P19. Engage re-sends the identical army move every 2 s (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:492-493`, `184`, `557-558`; `src/skirmish/domain/Armies.ts:225-227`, `638-644`
- **Severity:** low
- **Votes:** code: kept/medium (low) · reach: kept/high (low)

**What happens.** The guard `plan.targetTile !== objective.tile || members.every(hold)` re-issues the move on every 2 s think. Two causes: when the route is rejected (for example a walled city, see R2-H4) members stay on hold and the move is re-sent with no backoff; and `step()` at `:184` resets `plan.targetTile` to the theatre tile on every pass, so the guard is usually true even after an accepted order, superseding in-flight leader admissions and cohorts and restarting route jobs (not run). **Correction:** `cancelPlanning` keeps at most one leader admission per army, so re-sends do not accumulate toward the shared 128 cap and do not starve human admissions; the cost is wasted pathing and restarted planning.

**Expected impact.** Siege scenario: 31 re-sends (re-run 31, of which 29 were rejected as "Army corridor unavailable").

- **Evidence:** `if (objective && (plan.targetTile !== objective.tile || members.every(s => s.order.type === "hold"))) { if (this.order(plan, {type:"move",tile:objective.tile})) {`
- **Repro:** siege.ts command log (`army-order:move` ×31).
- **Fix (verifier):** keep the objective tile in a field that `:184` does not overwrite, and skip the order when the army already targets that tile or a leader admission for it is pending.

#### R2-P20. Metadata JSON is 68-74% of every raw publication; extends round-1 P13 (load-test)
- **Where:** `src/skirmish/multiplayer/StateCodec.ts:345-362` (encode) and `428-468` (decode); root cause `src/skirmish/domain/Expansion.ts:1935` with emission at `src/skirmish/SnapshotCodec.ts:172-173` (reviewer cited 166)
- **Severity:** low
- **Votes:** code: kept/medium (low) · reach: kept/high (low)

**What happens.** `metadataBytes` is the JSON envelope of the whole packet (everything that is not a typed array). Its size comes mostly from expansion keys without a revision in `replicationMetadata()` (armies, inventories, production, recruitment, projectiles, aircraft, tradeSites, deliveredGold, winners, activeOffensives and similar), which `selectMetadata` sends in full on every delta, plus `players`. **Corrections:** the share is the same in idle and 8-human replays (68-70% idle), so humans do not drive it; client JSON.parse is only about 6 ms per publication, and the larger clone (R2-P8) was never attributed to metadata. It supports 02's revision and delta recommendations (N3/N4) ahead of interest management.

**Expected impact.** 384-416 KB of metadata in 519-601 KB of raw payload; 51-65 KB gzipped on the wire, so not the bandwidth driver; a large share of server stringify, client parse and the view clone.

- **Evidence:** `const metadata = … JSON.stringify({ value: valueTree, lengths: … })`
- **Repro:** replay.mts (`metadataBytes` vs raw).
- **Fix:** add revisions or deltas for the unrevisioned metadata keys.

#### R2-P21. CavalryAssaultMotion re-plans every rider of a squad in one frame (client-unread)
- **Where:** `src/skirmish/client/troops/CavalryAssaultPresentation.ts:518-528` (with `490-491`, `512-517`), path building `96-165`, `224-386`
- **Severity:** low (reviewer: medium)
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** `sample()` re-plans every rider in the same call when the contact moves more than 0.5 tile, turns, changes penetration or shrinks, or after a tick gap over 2 s. `planPass` builds two `CavalryRidePath`s per rider, each with 64 samples per cubic piece plus four extra curvature Bezier evaluations per sample and a spread `Math.max` over slices. The trigger is real: `Battle.ts:989-992` rewrites the contact geometry from a moving target every cycle, and a background tab returning skips more than 16 ticks. **Correction:** the spike is one frame per material contact change, not sustained, because the frozen geometry resets to the new contact.

**Expected impact.**
- Reviewer (contended): 6 riders median 2.3 ms (max 29), 30 riders 12.5 ms (max 57), 60 riders 23.5 ms (max 56), first plan for 60 riders 52 ms; steady frames 0.04-0.2 ms; claimed 50-150 ms frame spikes.
- Verifiers (uncontended): about 0.15-0.35 ms per rider; 6 riders ~1.3-2 ms, 30-32 riders ~4.6-7.7 ms, 60-64 riders ~9-11 ms (max ~21); steady 0.02-0.09 ms. Realistic: occasional 5-10 ms one-frame hitches per large engaged squad.

- **Evidence:** `const changed = Math.hypot(a.x - frame.x, a.y - frame.y) / FIXED > 0.5 || …; if (jumped || changed) { rider.pass = planPass(a, rider.pose, time, ++rider.serial, …`
- **Repro:** tsx scratch assault.ts (contact shifts 0.6 tile per call); verifier bench.ts.
- **Fix:** re-plan at most K riders per frame, use cheaper curvature tables, and raise the change threshold.

#### R2-P22. HudView compares escaped markup against serialised innerHTML, so some cards are rewritten on every update (client-unread)
- **Where:** `src/skirmish/client/HudView.ts:43-48` (`escape`), `447-450`, `568-576`, `609-621`; `src/skirmish/client/ResourceIcon.ts:26`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `escape()` emits `&#39;` and `&quot;`, but innerHTML serialisation writes those characters back raw in text nodes (and `'` raw in attribute values), so the guards `el.innerHTML !== markup` never match when content has quotes or apostrophes; 38 content descriptions contain apostrophes. An open tooltip, deposit tooltip or selection card is re-parsed on every HUD update (~8 Hz), followed by forced layout from `offsetWidth`/`offsetHeight` reads. Confirmed in Chrome 152: `<p>It&#39;s a &quot;test&quot;</p>` reads back as `<p>It's a "test"</p>`. **Addition:** `resourceIcon` emits a self-closing SVG `<path …/>`, which serialises as `<path …></path>`, so resource-kind cards never match either, even without quotes. Client-only.

- **Evidence:** `const markup = cardMarkup(card); if (tooltip.innerHTML !== markup) tooltip.innerHTML = markup;`
- **Fix:** compare against a cached last-markup string per element, as `ResearchOpportunitiesView.ts:73-84` does.

#### R2-P23. Active placement preview re-diffs every retained chunk and JSON-stringifies all barriers on each publication (client-unread)
- **Where:** `src/skirmish/client/PlacementPreview.ts:163`, `190-201`, `243-266`, `497-503`; `src/skirmish/client/Renderer.ts:422`, `1202-1210`
- **Severity:** low
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** While a build type is active, `update()` runs on every snapshot. It JSON-stringifies every live barrier with its full tile array plus alliances, and compares 256 owner cells (plus fringe tiles) for every retained chunk, which is all visible chunks plus 128 recent ones; there is no zoom gate on the overlay, so a zoomed-out 1000×1000 view retains about 3,969 chunks (~1M comparisons). `snapshot.changedTiles` is available but unused. **Correction:** the troop-tile diff (`292-335`) is O(squads) and immaterial; the owner/fringe diff is the main cost and the barrier stringify secondary.

**Expected impact.** Several ms per publication with late-game wall networks, on top of the strategic draw cost (not measured).

- **Evidence:** `JSON.stringify(snapshot.expansion?.barriers.filter((b) => b.health > 0).map((b) => [b.id, b.playerId, b.kind, b.tiles]) ?? [])`
- **Fix:** key barrier geometry on `expansion.fortificationRevision` (as `WallPresentation.ts:30-34` does), and diff ownership only for the publication's changed tiles.

#### R2-P24. Up to 10,000 buildingIds are checked with Array.includes per building (command-fuzz)
- **Where:** `src/skirmish/Simulation.ts:2473-2477`; `src/skirmish/domain/Expansion.ts:982`; caps at `src/skirmish/multiplayer/CommandSchema.ts:92-132` and `src/skirmish/domain/CommandPolicy.ts:45`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** recruit, recruit-ship and recruit-aircraft accept `buildingIds` up to 10,000 entries (any positive integers, duplicates allowed). `automaticRecruitmentBuilding` and `Expansion.recruitAircraft` filter candidates with `buildingIds.includes(b.id)` before the cheaper owner/completion checks, and before any rejection. cancel-recruitment already builds a Set (`Simulation.ts:1359`). **Correction:** candidates are the sender's own buildings of one type (`buildingIndex.byType`), not all buildings in the match.

**Expected impact.**
- Reviewer: ~4.3M comparisons per command at 430 buildings; up to ~0.2-0.4 s/s of worker CPU at the 50/s per-session limit across 8 seats.
- Verifier benchmark: 0.46 ms per command at 50 same-type buildings, 5.4 ms at 430 (possible because `MAX_BUILDINGS` is Infinity); about 23 ms/s per seat at 50 buildings.

- **Evidence:** `this.buildingIndex.byType(playerId, type).filter(b => (!buildingIds || buildingIds.includes(b.id))`
- **Fix:** build a Set once per command (or run the cheap checks first), and cap `buildingIds` at about 1,024.

#### R2-P25. The amphibious hierarchy is built eagerly but never warmed in live config, and is missing from residency diagnostics (movement-core)
- **Where:** `src/skirmish/Simulation.ts:800`, `804`, `3408-3412`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:96`; `src/skirmish/Pathfinding.ts:93-94`, `272`, `316-324`, `344`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**What happens.** With `autonomousRouteDeadlineTicks` unset (live), the amphibious corridor gate is Infinity, the planner never starts an amphibious corridor, and warming covers only land and water; residency diagnostics report only land and water. AmphibiousPaths and its HierarchicalPaths are still built for every ages-v1 match. **Corrections:** the hierarchy is not unused: synchronous finds over 48 tiles (army orders at `Armies.ts:646/998/1055`, and R2-P2) go through it, so skipping it would change routes; build it lazily instead. Its own cost is small; most of the measured heap is `AmphibiousPaths.largestComponent`, a JS number array covering the whole map. The full-map scratch arrays also back unbounded `findExact` (legs of 48 tiles or less, and the blocked-route fallback), so a hashed bounded workspace is not a safe replacement.

**Expected impact.**
- Reviewer: 1.3 / 2.8 / 6.0 / 13.3 MB of heap (whole AmphibiousPaths) on Med500 / Mig500 / Med1000 / Mig1000, 0.09-0.39 s construction; all three graphs keep 16 B/tile of scratch (48 MB on Mig1000).
- Verifier: HierarchicalPaths alone 0.55 MB (Mig500, ~7 ms) and 2.15 MB (Mig1000, ~16 ms).

- **Evidence:** `amphibious: options.autonomousRouteDeadlineTicks===secondsToTicks(2) ? water+ticks(this.amphibiousPaths) : Infinity` and `paths: { land: m.paths.residency, water: m.waterPaths.residency },`
- **Repro:** scratchpad/movement-core/static.mts <map> <size>
- **Fix:** build the amphibious hierarchy lazily (first amphibious faction or first find), add amphibious residency to diagnostics, and store `largestComponent` as an Int32Array or compute it lazily.

#### R2-P26. The formation template cache key includes seed%16 for shapes that ignore it (movement-core)
- **Where:** `src/skirmish/domain/FormationGeometry.ts:689-699` (key), `367-371` (only seed use), `715-720` (eviction), `670`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** The template key includes `seed % 16` (the squad id) for every shape, but `buildSlots` reads the seed only for mass and modern-loose jitter, so line, column, square, wedge and shield-wall templates are stored up to 16 times. The 512-entry cache fills and churns. **Corrections:** eviction is FIFO by insertion, not LRU (hits do not refresh a key), so hot templates are evicted too; the Map is module-global, shared by every match in a worker process. Per-formation slot and envelope caches sit in front, bounding the cost. Output is deterministic either way.

**Expected impact.** With 52 factions the cache fills at about tick 2,800; cumulative misses then go 1,196 → 15,605 (Med500) and 2,222 → 12,308 (Mig500), 5-16 misses per tick. Miss cost: line 0.026 ms, mass 0.25 ms; a hit is 0.004 ms. All 768 calls for line across 16 seeds missed.

- **Evidence:** `const key = [count, shape, d.spacing, d.mounted, d.bodyWidth, d.bodyDepth, seed % 16, frontage, doctrineTemplateId(d)].join(':');`
- **Repro:** scratchpad/movement-core/tmpl.mts; dyn.mts (`formationTemplateDiagnostics` per window).
- **Fix:** key the seed only for jittered shapes, and raise the cap to 2,048 (or move keys to the end on a hit for real LRU).

#### R2-P27. Water backbone reuse checks only the start side; a goal-side failure is late and deletes the backbone (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:937-938` (reuse), `1074` (segment fail), `808`, `812-815` (`fail` deletes), `1035`; `src/skirmish/RoutePlanner.ts:752`
- **Severity:** low
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** Backbones are keyed `startCluster:goalCluster:revision`. Before reuse only `backbone[0]` is tested against the start tree. If the goal lies in a different water component of the goal cluster, the corridor refines every leg, fails at the segment step, deletes a backbone still valid for other goals, and the job falls back to the exact search; the next query rebuilds the backbone. Routes stay correct.

**Expected impact.** Mig500: 3 fail-deletes in 67 lookups. **Caveat:** the probe's counter also counts `fail()` deletions from dynamic-block validation and abstract-search failure, so this is an upper bound for this cause.

- **Evidence:** `if (backbone && tree.cost[this.index(this.clusters[startCluster], this.portals[backbone[0]].tile)] !== INFINITY) {`
- **Repro:** scratchpad/movement-core/backbone.mts migration 500 2800
- **Fix:** check that the goal-side portal tree reaches the goal before using the chain, or skip the delete when the final leg is what failed.

#### R2-P28. Any cost change anywhere cancels every in-flight corridor on that graph (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:854-855`; `src/skirmish/Pathfinding.ts:57`, `224-226`; per-cluster revisions at `HierarchicalPaths.ts:334-339`; `src/skirmish/RoutePlanner.ts:751-772`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `step()` fails any unfinished corridor whose revision differs from `TilePaths.costRevision`, a single per-graph counter bumped by every forest change anywhere. HierarchicalPaths already tracks per-cluster revisions but does not use them here. A failed corridor makes RoutePlanner drop to the slower exact search with no corridor retry; the move is not cancelled. Land and amphibious graphs only (water topology never fires cost changes). **Caveat on the fix:** the abstract search reads live boundary costs in clusters outside the final chain, so a per-cluster check must cover every cluster the corridor has read, not only the chain.

**Expected impact.** Med500: land revisions changed 45-106 times per 400 ticks, but only 1 of 219 corridors was cancelled because most finish within 1-2 ticks. Exposure grows with slower corridors (big maps, saturated budgets).

- **Evidence:** `if (s.revision !== revision && s.phase !== "done" && s.phase !== "failed") fail();`
- **Repro:** scratchpad/movement-core/revs.mts and corridorrev.mts heightmap-test1 500
- **Fix:** record the cluster revisions the corridor has read and fail only when one of them changes.

#### R2-P29. geometryKey still includes charge.phase although slots no longer depend on it (movement-core)
- **Where:** `src/skirmish/domain/FormationGeometry.ts:129`, `140`, `142` (`physicalKey`), `143`, `175-180` (`shapeOf`), `313`; also `CombatGeometry.ts:28/43-50`, `LandingOccupancy.ts:20-21`, `UnitIndex.ts:209-212`
- **Severity:** low
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `shapeOf` no longer reads `s.charge`, and nothing else in the geometry path does, but `geometryKey` (and `physicalKey`, which only drops the revision) still includes `s.charge?.phase`. Every charge phase change (preparing, approach, committed, recovery, none) re-keys envelopes, body facts, approach shapes, landing occupancy and combat-geometry reuse, and UnitIndex flags a geometry change, without any geometric change. **Corrections:** the wedge-override removal is already committed in HEAD 0d1783ce, not a working-tree change; CombatGeometry, LandingOccupancy and UnitIndex each check the charge phase separately and would keep invalidating unless changed too. A few extra rebuilds per charge.

- **Evidence:** `s.charge?.phase,` (key values) and `function shapeOf(s) { const d = formationDoctrine(s.definitionId); return s.formation?.shape ?? d.defaultShape; }`
- **Fix:** drop the charge phase from `geometryKey` and its cached facts after checking the consumers keyed on it, together with the separate checks listed above.

#### R2-P30. Explicit naval attacks re-plan with a synchronous LOS scan and A* every 3 s per ship (naval)
- **Where:** `src/skirmish/Simulation.ts:2858-2896` (scan at `2881-2884`, A* at `2890-2891`); `src/skirmish/domain/Expansion.ts:713-715`; `src/skirmish/domain/StructureTargeting.ts:32-50`
- **Severity:** low
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** An explicit attacker out of range or out of LOS re-plans every 3 s by scanning a square around the target, running `structureAim` or `fortifications.clear` for candidates, then a synchronous `waterPaths.find` with a 4096-node budget, bypassing ShipMovementAdmission. **Corrections:** extent is up to 13, not 12, by the code verifier (Modern range 14, +1 with missiles; about 531 tiles in the circle), or 12 without missiles by the reach verifier (~450 tiles). The checks short-circuit (distance < best, in circle, water-connected), so the full count is reached only when no legal tile exists, and then no A* runs. Ships ordered together all get `lastPlanTick = -60` and so re-plan on the same tick, making it a periodic one-tick spike. The realistic trigger is a human order: AI bombardment certifies `structureAim` before ordering and sends stop-ships when readiness is lost.

**Expected impact.** Reviewer: an 8-32 ship blocked bombardment could cost up to ~20k `structureAim` calls per 3 s (not measured). Verifier: about 15k calls in one tick for 30 ships, repeating while the order stands.

- **Evidence:** `if (this.distanceSquared(ship, p) > range ** 2 || !legalShot) { if (this.tick - (ship.lastPlanTick ?? -60) >= secondsToTicks(3)) {`
- **Repro:** order 30 Modern warships to naval-attack a building behind a wall and profile `fightShips`.
- **Fix (verifier):** stagger `lastPlanTick`, or send the attack approach through ShipMovementAdmission.

---

## Refuted during verification

These 17 findings were refuted by a majority of verifiers. They are listed so the owner can see what was considered.

| Area | Title | path:line | Why refuted |
|---|---|---|---|
| air-strategic | Aircraft lost with their base, and expiring drones, are not recorded as military losses | `src/skirmish/domain/Expansion.ts:1268` | `recordMilitaryLosses` keeps only completed cities (Simulation.ts:1963-1970, deliberately excluding aircraft) and no aircraft loss counter exists, so adding the call would record nothing. |
| air-strategic | Floating-point trigonometry in authoritative patrol orbits and flight steering | `src/skirmish/domain/Expansion.ts:1302` | Server-authoritative with no lockstep re-simulation; a checkpoint restores full state rather than replaying; positions are rounded each step; float trig is the established pattern (~191-236 sites). |
| air-strategic | IN-FLUX: carrier-based aircraft have no ground presentation | `src/skirmish/client/AircraftGroundPresentation.ts:48` | CarrierAircraftPresentation handles carrier aircraft and the Renderer asks it first (Renderer.ts:253), giving a parked deck pose. (A related ghost-berth bug was confirmed separately as R2-L13.) |
| popup-spec | Player-id range exhausted and id-indexed structures disagree on the bound | `src/skirmish/FactionAdjacency.ts:7` | Players are created only at construction with ids up to 20+14+30 = 64 = MAX_PLAYER_ID; no runtime spawning or nomad code exists. A design note for the nomad plan. |
| popup-spec | deployPlayer mutates world state before a throwing placement check | `src/skirmish/Simulation.ts:1114` | Only the constructor calls it, so a throw means no Skirmish exists; every base is pre-validated by the same pure `startingCamp` at the same radius 6. |
| popup-spec | New faction kinds silently inherit nation/tribe rules at ~12 sites | `src/skirmish/domain/AiOperations.ts:101` | `FactionKind` is the closed union "regular" \| "tribe" and nothing creates another kind; a maintainability note for the nomad plan. |
| popup-spec | Ships do not count for survival: a ships-only pirate faction is eliminated on its first tick | `src/skirmish/Simulation.ts:5449` | No pirate or ships-only faction exists; excluding fleets is the documented, tested survival rule (PlaytestStability.test.ts:141, Conquest.test.ts:138/168). |
| popup-spec | Prizes captured by an owner without a market never complete | `src/skirmish/domain/Trade.ts:445` | Intended and tested wait-for-receiver design: a new owned port wakes the prize and full value is paid (TradeFleet.test.ts:430-450). Pirates and yurts do not exist. Residual: stranded prizes occupy the owner and global actor cap. |
| popup-spec | AI candidate scan and sleep key scale with lifetime players | `src/skirmish/domain/AiOperations.ts:408` | The roster is fixed at construction and capped, so the scan cost does not grow with match age; no pop-up players exist. Related round-1 P25; round 1 had already refuted the correctness variant. |
| popup-spec | Faction-name roster throws on deck exhaustion and has no pop-up decks | `src/skirmish/domain/FactionRoster.ts:79` | The roster is local to construction, draws are capped at 14 regular and 30 tribe against 400+ identities (tested with 19 and 40), and nothing draws during `step()`. |
| ai-tactics | thinkCapabilities sends attack-structure to army/leased siege squads | `src/skirmish/domain/Expansion.ts:1712` | `thinkCapabilities` runs only when `economy.enabled(player)` is false, while AiArmyPlanner missions and leases exist only when it is true (aiEconomy defaults to true), so the paths never meet for one player; the repro called the private method directly. Residual low note: with aiEconomy=false, a human-turned-AI player's manual armies can lose structure-bonus squads. |
| load-test | Human admissions never expire or coalesce: 33-45% of human planning work is superseded | `src/skirmish/Simulation.ts:944` | No deadline for humans is deliberate; a newer order cancels the old admission and its planner jobs in the same tick (MovementAdmission.ts:229-235, 340; RoutePlanner.ts:503-509), leaving only bounded workspace reclamation. The counts measure order churn. |
| client-unread | TechnologyViewModel recomputes all trees on every access and has a latent reduce-on-empty crash | `src/skirmish/client/TechnologyViewModel.ts:31` | `validateTechnologies()` runs at module load and throws unless every age × tree has required slots 1..count, so the empty case cannot reach render; the double compute is a cheap nit. |
| client-unread | Lab: battleDefinition silently drops tuning.attack for split-channel units; draft rankLaunchSpacing defaults disagree | `src/skirmish/client/lab/BattleTuning.ts:105` | No producer emits an attack patch for split-channel units; an absent spacing restores as 0.25, not 1 (tested); the revision relabel validates against revision 3 and is a tested, deliberate migration. |
| command-fuzz | Army planning cap rejection cancels the army's existing pending plan | `src/skirmish/domain/Armies.ts:639` | Each army holds at most one leader plan; `cancelPlanning` removes it first, freeing a slot, so the cap can only reject an army with no pending plan. |
| movement-core | CohortAdmission.start refuses at 128 pending before superseding the caller's own plans | `src/skirmish/domain/CohortAdmission.ts:100` | Every Armies path cancels or skips the army's existing cohort before `start` (Armies.ts:227, 639, 916, 1127), so the supersede loop never has anything to free. |
| movement-core | withinShoreline fails open on NaN or degenerate polygons | `src/skirmish/domain/ShorelineTolerance.ts:55` | Production calls pass softDepth 0, returning false at line 43; a NaN polygon already fails open earlier in `certifyFootprint` (FormationContact.ts:591-620), where its loops never run, so any hardening belongs there. |

---

## Unverified

None: all 89 findings got a verdict from at least two verifiers. Sub-claims that the verifiers explicitly left unmeasured are flagged in their entries, notably:

- ARM timings derived from desktop × 2.4-2.5 (R2-P1 at 1000, R2-P2, R2-P5, R2-P6, R2-P31).
- The 7-10× cavalry DPS figure (R2-L2).
- Chrome draw timings (R2-P4, R2-P9), peak RSS (R2-P12), the anti-air check counts (R2-P14) and the placement-preview cost (R2-P23).
- The AI exposure of the corridor crash for orders above 30 squads (R2-H1).
