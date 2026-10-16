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
- Where a round-2 entry re-confirms, supersedes or re-anchors a round-1 entry, it cites the round-1 ID from `08-latent-bugs.md` (H3, H4, H5, M2, M10, M11, L7, P1, P10, P13, P14, P15, P20, P25, P29). Round-1 area-report IDs are cited as, for example, "03 I3".

| | Count |
|---|---|
| Ledger findings | 89 |
| Confirmed | 71 ledger rows, merged into **69 entries** (37 bug/determinism/security, 32 perf) |
| Plausible | 1 |
| Refuted | 17 |
| Unverified | 0 |
| Confirmed entries by verified severity | critical 2 · high 4 (2 + 2 perf) · medium 28 (19 + 9 perf) · low 35 (14 + 21 perf) |

These duplicates were merged; each merged entry names both source rows:

- **R2-H2**: tree-delta "Charge fallback map.ref throw (ledger H3) still present after the delta" + command-fuzz "H3 still live: charge fallback converts off-map x/y with map.ref and kills the match".
- **R2-M17**: naval "Repair state machine livelocks between repairing and returning-to-dock" + naval "Repair livelock and other recovery gaps leave AI fleets permanently degraded".

Round-2 entries that touch round-1 entries:

- **Re-confirmed, unchanged:** H3 (R2-H2, re-anchored and repro corrected), M2 (R2-M9), M10 (R2-M4), M11 (R2-M13, widened), L7 charge half (R2-M2).
- **Superseded severity:** H5 high → medium (R2-M3).
- **Explained:** H4's RiverExpansion and PreModernBalance failures (R2-L2, R2-L1).
- **Extended or re-measured:** L7 anti-air half (R2-M7, fighters), P29 (R2-P3), P1 (R2-P21), P10 (R2-P10), P13 (R2-P15, R2-P17, R2-P22), P14 and P15 (R2-P8), P20 (R2-P5), P25 and the round-1 refuted "Candidate scan indexes world.players by a numeric cursor" (R2-P16).

"Confirmed" below holds the bug, determinism and security findings. Confirmed perf findings are under "Perf findings".

---

## Confirmed

### Critical and high

#### R2-H1. A dead corridor-lead squad crashes MovementAdmission.stepAdmissions and ends the match (load-test)
- **Where:** `src/skirmish/MovementAdmission.ts:942` (column 88), with the split at `343-366` and lazy validation at `806-818`; `src/skirmish/Simulation.ts:1227` (`removeSquad`)
- **Severity:** critical · **Kind:** bug
- **Votes:** code: kept/high (critical) · reach: kept/high (critical)

**Mechanism.** A human selection of more than 10 squads is split into a 1-squad lead admission, whose id equals `corridorId`, plus 10-squad follower cohorts that share that `corridorId`. In the routes phase, while the lead's corridor is not yet published, a follower reads `original = this.pending.get(corridorId)` and dereferences `this.ports.squad(original.members[0].id)!.kind`. Members are validated only when their own admission is visited, and visited admissions rotate to the end of the Map, so a follower can be visited before the dead lead's admission is pruned. Nothing cancels admissions when a squad dies: `removeSquad` only clears `movementClearance` and `playerAttacks`, and a planner "superseded" outcome only resets `requested`. `ports.squad` then returns undefined and a TypeError escapes `Skirmish.step` mid-tick. serverMatchWorker rejects the advance and `src/skirmish/multiplayer/application/LiveMatch.ts:662` calls `end("Match stopped: Cannot read properties of undefined (reading 'kind')")`, so every player loses the match with the simulation half-ticked. The window is open whenever the lead route is pending, which is the normal state with 8 active humans (planner pinned at 115-128 jobs), but it exists without load too. AI orders are never split, so this is a human-only crash. The code is unchanged since d5ba9c40 (HEAD). Reproduced three ways: an in-process Mediterranean run (crash between ticks 3000 and 3200), the same command log through the real ReservedMatchWorker (`Match executor operation failed advance TypeError ... MovementAdmission.ts:942:88`), and `repro-corridor-crash.mts` at tick 7 on both the frozen copy and the live tree; both verifiers re-ran the last one.

- **Evidence:** `if (original && original !== admission && !corridor && this.ports.squad(leader.id)!.kind === this.ports.squad(original.members[0].id)!.kind) {`
- **Fix:** check that the corridor lead's squad exists before dereferencing it, and cancel a squad's pending admissions in `Skirmish.removeSquad`. The same `!` pattern appears at `:845` and `:874`, where the admission's own validation runs first, so those are safer.

#### R2-H2. H3 is still live: a charge fallback with off-map x/y throws in map.ref and ends the match (tree-delta + command-fuzz, security)
- **Where:** `src/skirmish/Simulation.ts:1302-1304` (re-anchors round-1 H3 from `1301-1302`); `src/skirmish/domain/CommandPolicy.ts:63-76`
- **Severity:** critical (command-fuzz verified critical; tree-delta verified high) · **Kind:** security
- **Merged:** tree-delta "Charge fallback map.ref throw (ledger H3) still present after the delta" and command-fuzz "H3 still live: charge fallback converts off-map x/y with map.ref and kills the match"
- **Votes:** tree-delta: code kept/high (high) · reach kept/high (high). command-fuzz: code kept/high (critical) · reach kept/high (critical)

**Mechanism.** Round-1 H3 is unchanged. The charge pre-check at `:1302` fires if any listed squad, of any owner, is non-cavalry and in column or leaving column. When `fallbackOrder` is an attack on a missing target, `:1304` builds `{type:'move', tile:this.map.ref(floor(x/256), floor(y/256))}` before any ownership or bounds check. `GameMap.ref` throws (`GameMap.ts:169`), `CommandApplications.apply` has no catch (`:91-96`), the worker's catch posts an error (`serverMatchWorker.ts:305-314`), and `LiveMatch.scheduleTick` ends the match (`:660-662`). **Correction to round 1's repro:** a negative x is rejected by `commandRejection`, so `x = -10*FIXED` never reaches the simulation. The trigger is a large positive value: the schema allows up to 1,000,000 (tile 3906, beyond the largest 2000-tile world), and `commandRejection` has no upper bound. The attacker can name one of their own marching squads; a foreign one is not needed. The fuzzer found this 5 times independently; the minimal case is off by one, y = 64000 (= H×256) on a 250-tile map. The pre-check also leaks whether a foreign squad is in column ("Deploy before charging" versus another rejection). The tree-delta review found the new transfer-aircraft and cavalryMode paths zod-strict, ownership-checked and free of reachable throws, and Expansion's own charge path is guarded (`Expansion.ts:755`, `763`).

- **Evidence:** `order:command.fallbackOrder.type==='attack' && !this.squad(command.fallbackOrder.targetId)?{type:'move',tile:this.map.ref(Math.floor(command.x/FIXED),Math.floor(command.y/FIXED))}:command.fallbackOrder` → `Error: Invalid coordinates: 3906,3906 at Skirmish.applyCommand (Simulation.ts:1304:127) at CommandApplications.apply (CommandApplications.ts:93:30)`
- **Repro:** `{type:'charge', playerId:1, squadIds:[<any non-cavalry squad in column>], x:1000000, y:1000000, fallbackOrder:{type:'attack', targetId:9999999}}` (scratchpad/command-fuzz/repro-h3.ts)
- **Fix:** check map bounds for top-level and nested x/y/tile in `commandRejection`, restrict the column test to owned squads, and reuse Expansion's fallback helper, which already checks `isValidCoord` (`Expansion.ts:758-767`).

#### R2-H3. Siege breach is unreachable under deferred planning, so AI armies cannot assault a fully walled city (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:448` and `453` (the only entry into breach); `src/skirmish/domain/Armies.ts:216-224` (`finishLeader`), `638-644`
- **Severity:** high (reach verifier: medium) · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (medium)

**Mechanism.** Breach is entered only when `army.state === "blocked"`. Armies sets "blocked" only on formation-space failure, a member route failure or a queued order error (`Armies.ts:944`, `1077`, `1095`), all of which need a march that already exists. The planner only runs with `deferredPlanning`, which the live policy enables (`AiPolicies.ts:5`). In that mode `Armies.order` defers every non-hold move into a leader admission and returns null, which the planner treats as success and sets the phase to "advance". Hostile fortifications make the leader route unreachable, and `completedRoute` calls `finishLeader`, which deletes the admission, cancels the task and emits an event. Nothing sets `army.state`, so breach never starts and the army sits in "advance" until the deadline or troop check sends it to recover. In the same think, the `!enemy` branch can also overwrite a breach phase back to advance (line 494). Measured on a 16-tower, 19-wall ring with 2 bronzeage-siege: 31 `army-order:move` commands in 60 s, the army never left x=42, the phase stayed advance until recover at 60 s, and all 19 walls stayed intact. No test covers entering breach; `RemainingPlans.test.ts:587` seeds phase "breach" directly. **Correction:** each failed order holds a leader admission only until it resolves; `cancelPlanning` keeps at most one per army, so this is temporary contention for the shared 128 cap, not a leak.

- **Evidence:** `} else if(army?.state==="blocked"){` (AiArmyPlanner.ts:448) and `}else this.finishLeader(plan,outcome==="unreachable"?"rejected":"superseded","Army corridor unavailable");` (Armies.ts:216, no `army.state` write)
- **Fix:** surface an unreachable deferred leader route to the planner (for example by marking the army blocked) so the breach logic can run. See also R2-P20 for the repeated re-send.

#### R2-H4. thinkCapabilities sends attack-structure to army and leased siege squads, detaching them from AI armies (ai-tactics)
- **Where:** `src/skirmish/domain/Expansion.ts:1712-1742` (attack issued at `1735-1741`); `src/skirmish/domain/Armies.ts:525-533` (`observeOrder`)
- **Severity:** high (repro verifier: medium) · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: refuted/high · repro: kept/high (medium)

**Mechanism.** The siege loop issues attack-structure every 3 s to every own squad with `attack.bonuses.structure`, filtering only refit, enlargement and modernization holds, never army membership or a mission lease. The target is the nearest hostile building on the whole map, not the mission objective. The command goes through plain `applyCommand` with `armyCommandDepth` 0, so `Simulation.ts:1347` calls `armies.observeOrder`, which detaches a partial selection, or stops the army and sets it to manual if every member is siege. It repeats: every army order clears `structureTarget` (`Armies.ts:671`), so the next think reissues it. The planner's own pickers check exactly what this loop misses (`AiArmyPlanner.ts:134-135`). Repro: an 8-member army fell to 6, both siege squads had `armyOf=false` and `structureTarget {buildingId: 1}`. Breach shooters are drawn from current members (`AiArmyPlanner.ts:449`), so the mission falls back to recover; the engineer doctrine is hit hardest. The breach phase itself (`AiArmyPlanner.ts:438-440`) also detaches a ready subset the same way. The loop is O(siege × B log B) per nation per 3 s. **Dispute:** the reach verifier found that `thinkCapabilities` runs only inside `if (!this.economy.enabled(player))`, that leased armies come only from AiArmyPlanner (which runs only when aiEconomy is true), and that both live entry points set `aiEconomy: true` (`LiveMatch.ts:146`, `client/main.ts:666/696`), so the two paths may never meet for one player in a default match. The repro called `thinkCapabilities` directly. The lease part was not independently measured.

- **Evidence:** `if (target && s.structureTarget?.buildingId !== target.id) this.world.applyCommand({ type: "attack-structure", playerId: player.id, squadIds: [s.id], buildingId: target.id });`
- **Fix:** add `!armies.armyOf(s.id) && !economy.assets.held(\`squad:${s.id}\`)` to the filter, matching `AiArmyPlanner.ts:134-135`.

### Medium

#### R2-M1. A move-long cavalry withdrawal leaves an intercepted rider unable to fight back (tree-delta)
- **Where:** `src/skirmish/Simulation.ts:3748` (reviewer cited 3743); `1716-1720`; `src/skirmish/domain/CavalryAssault.ts:131`; `src/skirmish/domain/Battle.ts:708`; `Simulation.ts:4161`
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/medium (medium)

**Mechanism.** The working tree added `squad.order.type!=='move'` to the clear condition, so a cavalry withdrawal now lasts until the move order completes; at HEAD it cleared on the next tick once contact ended. A move order turns any existing engagement into a withdrawal, even with no contact (`cavalryWithdrawal` returns one whenever an old engagement exists). While withdrawing, `Battle.fight` skips the squad, melee damage from cavalry on a move order is dropped (after `Battle.ts:955`), and the close-encounter move-to-attack conversion is disabled because it needs `!engagement`. Measured: an ambushed rider stayed body-blocked at x=32.6 for 10+ s, dealing 0 and taking 14 HP/s, against a control run dealing 240-290 HP/s. The move never completes while the rider is blocked, so the state does not clear on its own. The new comment at 3746-3747 shows the long withdrawal is intended; the stuck rider is the side effect. A human can recover with an explicit attack or hold order; AI moves cannot. **Not new:** the stale non-withdrawing engagement (filter is alive-and-hostile only, `3740-3744`; still engaged 38.2 tiles away after 15 s) and its side effects existed at HEAD: charge-to-point redirected to the stale target (`Expansion.ts:805-809`, confirmed), AI army resize skipped (`AiArmyPlanner.ts:321`) and column auto-travel skipped (`Simulation.ts:2293`).

- **Evidence:** `if(phase==='withdrawing'&&!targetIds.length&&this.tick>=(old.withdrawUntilTick??0)&&squad.order.type!=='move'){` versus HEAD `if(phase==='withdrawing'&&!targetIds.length){…cavalryEngagement:undefined…}`
- **Fix:** apply the contact filter to "engaged" assaults so they clear once contact ends, or keep a move-withdrawal alive only when the rider had real contact or exposure when the order was given (`withdrawUntilTick > tick` or a target still in contact).

#### R2-M2. Charge disruption is still written in place during the id-ordered fight loop; round-1 L7 holds (tree-delta)
- **Where:** `src/skirmish/domain/Battle.ts:762-765` (write), `710` (skip), `649-651` (id sort)
- **Severity:** medium (reach verifier: low) · **Kind:** determinism, reclassified as an id-order fairness bias
- **Votes:** code: kept/high (medium) · reach: kept/high (low)

**Mechanism.** Re-confirms the charge half of round-1 L7 (03 I3). `fight()` visits squads in ascending id order and `updateSquad` mutates the record the loop holds (`EntityCollection.ts:65`), so the defender's `chargeImpact.disruptedUntilTick` is visible to squads processed later in the same tick. A defender created after the rider skips its attack in the impact tick; one created before it keeps it. Damage goes through DamageLedger; the disruption flag does not. Reviewer measurement with the real step loop: rider-first, the defender's first strike comes 2 ticks after impact; defender-first, in the impact tick; the EM heavy rider dealt 3528 vs 2897 HP over 6 s depending only on id order (verifiers did not re-run the HP figures). Rank-wave writes use `disruptedUntilTick: tick` and are unaffected. Not nondeterminism: the sort is stable and the server is authoritative.

- **Evidence:** `this.world.updateSquad(target.id,{chargeImpact:{tick,role:'defender',sourceId:squad.id, disruptedUntilTick:Math.max(tick+disruption,target.chargeImpact?.disruptedUntilTick??tick),`
- **Fix:** collect defender disruption writes and apply them after the loop, or snapshot disruption at the start of `fight()`, or have the skip ignore an impact whose `chargeImpact.tick === tick`.

#### R2-M3. The AI's 100-kit troop reserve floor still delays strategic payloads; supersedes H5's severity (test-baseline)
- **Where:** `src/skirmish/domain/AutomaticProduction.ts:203`, `266-270`, allocation sort `~333-336`; live caller `src/skirmish/domain/Supply.ts:441-442`
- **Severity:** medium (reviewer: high; round-1 H5: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Round-1 H5 is unchanged. The floor is still `Math.max(100, …)` (HEAD: `context.ai ? 12 : 100`, cap 180), and `targets.clear(); continuous.clear();` is gone from the aiDemand block, which now only raises targets with `Math.max`. The allocation sort ranks every equipment recipe ahead of null-kind payload recipes, so an AI arms factory makes kits until troop, vehicle and siege buffers are met before starting make-hydrogen or make-mirv. `tests/skirmish/AiLateGame.test.ts:142` fails (1 failed / 10 passed) and passes at HEAD; the test file is identical to HEAD apart from CRLF. **Correction:** payloads are delayed, not blocked outright; unaffordable equipment recipes are skipped via `blocked` (`:344-350`), and starvation lasts only while recruitment keeps kit stocks below the buffers. The rewrite carries a "Shared ready reserves" comment, so it may be deliberate and the real problem may be that code and test disagree. No crash or desync.

- **Evidence:** `const troopTarget = Math.min(600, Math.max(100, troopCapacity * 3, Math.ceil(squadCount / 3)))` → `tests/skirmish/AiLateGame.test.ts:142:83 AssertionError: expected false to be true`
- **Fix:** as H5: restore the AI exemption, or deliberately change the payload-vs-kit ordering and update AiLateGame.test.ts:142.

#### R2-M4. The doctrine compiler still rejects bronzeage-cavalry frontage; M10 unchanged (test-baseline)
- **Where:** `scripts/FormationDoctrineSchema.ts:57`; `src/skirmish/content/TacticalRules.ts:45`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Re-confirms round-1 M10. `FlexibleFrontage.test.ts:73` still throws `Mounted frontage exceeds infantry ratio: bronzeage-cavalry capacity 1.8894230769230769` (1 failed / 13 passed), because the uncommitted recipe raised bronze cavalry from 8/12 to 16/20 against `mountedWidthRatioMax` 1.35. `scripts/compileFormationDoctrines.ts:5` would throw too. **Correction:** the recipe compiler has already run (`src/skirmish/content/formation-recipes.json:66-69` holds 16/20); only the doctrine compiler fails. This is a build and test failure, not a runtime crash, but live matches field bronze cavalry wider than the 1.35 rule. The 2.034 napoleonic-cavalry worst case was not re-verified in round 2, because the validator stops at the first violation.

- **Evidence:** `if(ratio>FRONTAGE.mountedWidthRatioMax)throw new Error("Mounted frontage exceeds infantry ratio: "+id+" "+variant+" "+ratio);`
- **Fix:** fix the content, or raise the ratio deliberately to at least 2.05 and recompile in order.

#### R2-M5. The map hash depends on the engine's libm; only Float32/byte quantisation keeps browsers in sync (mapgen)
- **Where:** `src/skirmish/multiplayer/application/MapIdentity.ts:26-33` (elevation bytes; line 25 is the terrain push); generators `MigrationCoast.ts`, `ContinentsLayout.ts`, `RegionalTopography.ts`, `TerrainFormation.ts`, `ResourceGeography.ts`; rejection at `src/skirmish/client/OnlineMatchSession.ts:346-356`
- **Severity:** medium (both verifiers said low would also be defensible) · **Kind:** determinism
- **Votes:** code: kept/medium (medium) · reach: kept/medium (medium)

**Mechanism.** The server (Node, `ServerMap.ts:17`) and each client (browser, `client/main.ts:811` → `Terrain.ts:50`) run `generateProceduralMap` independently from the same seed and hash the raw bytes, including the Float32 elevation buffer. The generators call `Math.sin/cos/atan2/exp/tanh/hypot` and `** 3` at more than 100 sites with no deterministic-math shim, and ECMAScript allows these to differ between engines. Reviewer measurement over 200,000 inputs: Firefox differs from the server's Node 24 on hypot in 35.4% of inputs, on `x**3` in 26.2% and on sin/cos in 2.4%; Chrome/Edge differ on atan2 (17.9%), exp (9.8%), tanh (9.5%) and sin/cos (3.4%). All 13 test maps still matched in Firefox, Chrome and Edge, because rounding absorbs 1-2 ulp. With every libm result 1 ulp off, 6 of 120 maps hashed differently (Continents 500: 3 of 8). An affected player gets "Map versions differ" with no fallback and cannot join. Safari and the ARM64 server are untested. The failure is latent: no real browser mismatch has been seen.

- **Evidence:** `if (identity !== message.manifest.mapHash) throw new Error("Map versions differ. Reload after deployment.");`
- **Fix:** not proposed by the reviewer or verifiers. The verifiers place the root cause in the generators' libm calls, not in MapIdentity.

#### R2-M6. Point-targeted launches and bombing ignore diplomacy; nukes neutralise a non-war faction's land (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1001-1013` (launch; reviewer cited 1010), `610-649` with the drone-only check at `614-617` (sortie); `src/skirmish/domain/Battle.ts:1538`, `1542-1565`; `src/skirmish/Simulation.ts:4825-4832`
- **Severity:** medium (reviewer: high; code verifier: medium-high) · **Kind:** security, reclassified as a gameplay/diplomacy rule bypass
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `launch` checks `canAttackStructure` only when a `buildingId` is given; a point launch checks only `validPosition`, research, launcher, cost and capacity. Bombing and atomic sorties check diplomacy only for drone targets. Bomb, icbm and warhead projectiles are indiscriminate, and the nuclear branch calls `nuclearBlast`, which sets every owned tile in the radius to owner 0 (the `changeOwner` guard is skipped when the id is 0). No war is established; `notifyHostileAction` only updates AI relations. All multiplayer matches run raids-v1 (`LiveMatch.ts:147`). Repro: with raids-v1 and peace protection between players 1 and 2, a point launch returned null while a buildingId launch returned "Choose an enemy building"; after 740 ticks the target owner was 0, there were 81 wasteland cells, `declaredWar(1,2)` was false and `canCapture(1,0)` was true. **Corrections:** the scope is wider than peace protection, which lasts only 60 s: any non-war faction can be hit, including neutral factions (the default relationship) and allies. Capturing the land is inferred, not shown: wasteland is taken only by a squad doing cleanup, at a fallout cost. The collateral blast is intended per the design contract ("Preserve existing strategic-blast collateral semantics"); the missing check is on the target and aim point. No crash or state corruption.

- **Evidence:** `if (targetBuildingId !== undefined) { … !this.diplomacy.canAttackStructure(player.id, target.playerId)) return "Choose an enemy building"; … }` then only `!this.validPosition(x, y) || !this.progression.has(player.id, "modern-strategic-weapons")`
- **Fix:** add the same war/hostility gate on the aim point for point launches and for bombing and atomic sorties.

#### R2-M7. Fighter duels are decided by aircraft array order (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1260`, `1280-1290` (reviewer cited 1283)
- **Severity:** medium (reach verifier: low) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (low)

**Mechanism.** Extends the anti-air half of round-1 L7 to fighters. A fighter applies `enemy.health -= 200` immediately inside the aircraft loop, and an aircraft killed earlier in the loop skips its own turn (`if (a.health <= 0) continue`). With 1000 HP fighters and a 2 s reload, two identical fighters trade four hits each, then the one earlier in the array lands the fifth first; it ends at 200 HP and takes the kill credit. Repro: "p1 created first: p1 hp=200, p2 hp=0", swapped when p2 is created first. **Corrections:** "earlier wins" holds when both get in range on the same tick; during an approach the later entry can get the first shot, because positions also update one after another. The Battle.ts:813-850 anti-air path is not the same kind of bug: aircraft do not shoot back at AA squads, so squad order only moves kill credit and XP (as L7 already says). No crash.

- **Evidence:** `const health = enemy.health; enemy.health -= 200; … if (health > 0 && enemy.health <= 0) { … this.world.recordMilitaryLosses([enemy], damage); } a.reloadTick = this.world.tick + secondsToTicks(2);`
- **Fix:** stage fighter-vs-fighter hits in a per-tick DamageLedger and apply them after the loop.

#### R2-M8. Any fighting army member freezes the whole army's advance creep (ai-tactics)
- **Where:** `src/skirmish/domain/Armies.ts:1148`; also `1134-1136`, `1146`, `1150`
- **Severity:** medium (reviewer: high; reach verifier: low) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/medium (low)

**Mechanism.** The advance creep, the only thing that moves an AI army's anchor toward the enemy in the deploy/hold branch, requires `!available.some(s=>s.fighting)`. `available` includes wing cavalry, which in strike phase engages on a 14-tile leash well ahead of the line (`Armies.ts:354`). Slot leashes (frontLeash 3, rangedLeash 1, `TacticalRules.ts:51`) keep the line from closing in by itself, so one engaged wing parks the infantry and ranged. Reviewer probe against a passive Late Medieval defender: wing engaged from 16 s, the line held about 10 tiles back for 50 s, range-9 ranged never got into range, and the cavalry was worn down alone. **Reach verifier's trace corrects the cause of the long stall:** the gate blocked the creep for only about 5 s (15-21 s) while the plan was "advance"; from 22-41 s the plan was "hold"; from 42 s the creep fired every 3 s with no member fighting, yet the anchor stayed put and the line stayed 11.7 tiles away, because each creep clears `march.deployment` and the anchor falls back to the route end. Gating on frontline members alone would not fix that stall.

- **Evidence:** `if(plan?.posture==='advance'&&army.posture!=='defend'&&…ai&&this.world.tick-(army.lastAdvanceTick??march.started)>=ENGAGEMENT.refreshTicks&&!available.some(s=>s.fighting)){`
- **Fix:** gate on frontline/ranged slot members fighting (or exclude mounted wing roles in route or strike phase). Separately, look at why the creep does not accumulate (`Armies.ts:1146/1150`) and why the plan flips to hold.

#### R2-M9. One annihilated army still disbands every sibling army in contact; M2 still present (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:309-315` (release at `313`); `113`; `Armies.ts:559`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Re-confirms round-1 M2. When all members of one army die, `members` is empty and Armies auto-disbands the army, so the three-way failure guard fires (no members, army gone outside replenish/refit, or a lost lease) and calls `this.release(player.id)`. That releases every mission of the player, issues `disband-army` for each sibling mid-battle and also calls `invasion.release(playerId)`. Siblings exist: `missionCap` allows up to 4 missions from 40 live squads. Their members fall back to the thinkAi attack-nearest loop and their L3 plans and wings are dropped. Because attack-nearest currently out-fights the line, playtests hide it. The other per-plan release paths (`:172`, `:201`) already use `releaseMission`.

- **Evidence:** `if (!members.length || (!army && plan.phase !== "replenish" && plan.phase !== "refit") || members.some(…)) { this.release(player.id); return this.diagnostics.work; }`
- **Fix:** call `this.releaseMission(plan)` at line 313.

#### R2-M10. Combat crosshair markers always show player 1's targets (client-unread)
- **Where:** `src/skirmish/client/Renderer.ts:429`; `src/skirmish/client/CombatEffectsViewModel.ts:219-222`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `Renderer.update` calls `combatTargets(snapshot)` with no player id, so the default of 1 filters bombing targets, missile and warhead targets and siege focus. main.ts sets `snapshot.localPlayerId` before update (`main.ts:631`, `634`, `848-851`), and the draw loop renders every marker with no owner filter (`Renderer.ts:1437-1440`). Online, every human in seats 2-8 sees no crosshairs on their own strikes and live crosshairs over player 1's pending strikes: wrong feedback for 7 of 8 humans and a strategic tell about the host. There is no fog of war or per-viewer filtering. Solo play is unaffected. The only tests (`CombatPresentation.test.ts:199-201`) use the default id. Visual only.

- **Evidence:** `this.combatMarkers = combatTargets(snapshot);` with `export function combatTargets(snapshot: Snapshot, playerId = 1,): TargetMarker[]`
- **Fix:** pass `snapshot.localPlayerId ?? 1`. Not `this.playerId`: that getter reads the previous `this.snapshot`, which is reassigned only at line 430, so it would lag a frame. Add a test with localPlayerId 3.

#### R2-M11. Remains records grow without bound while zoomed out (client-unread)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:488-489` (capture), `495`, `756`, `819` (`drawRemains` early return); `src/skirmish/client/troops/TroopRemains.ts:37-45`
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `prune()` computes `visible = this.detailed && …`, so at strategic zoom every squad that lost soldiers goes through `captureOffscreenLoss` (pose, slots, sort, then `remains.add` per casualty), and `TroopPresentation.beginFrame` calls prune for every new timeline source at all zooms. TroopRemains deletes expired records only in `sample()`, whose only caller is `drawRemains`, which returns early when `!this.detailed`. `setDetailed(false)` does not clear remains; only reset does. There is no cap. Executed: 8 squads losing 1 soldier per 10 s publication went 8, 16 … 96 records at 120 s despite the 45 s lifetime, and one sample() purged to 40; at target scale, 997 records after 30 publications. A player who stays zoomed out accumulates about 250 B per casualty for the whole match, with growing GC pressure, and the first zoom-in pays one synchronous sample over all of them. Each publication also spends 1.5-14 ms on poses that are never shown. Capturing offscreen poses is deliberate; only the expiry is missing. Client memory only, no crash or desync; "hundreds of thousands" of records is extrapolated.

- **Evidence:** `const visible=this.detailed&&this.completedDetail.has(old.id)&&this.motions.has(old.id); if(before>after&&!visible)this.captureOffscreenLoss(…)` and `if (!this.detailed || !this.ready) return;` before `this.remains.sample(this.clock())`
- **Fix:** expire old records in `add()` or `prune()` regardless of zoom (or call `remains.sample()` there), cap the map size, or skip `captureOffscreenLoss` when not detailed.

#### R2-M12. An occupy command suppresses another faction's skirmish stance (command-fuzz, security)
- **Where:** `src/skirmish/domain/Expansion.ts:439`; `src/skirmish/domain/SkirmishStance.ts:116-129`, `199-212`; `src/skirmish/domain/TrenchOccupancy.ts:472-477`, `518`
- **Severity:** medium · **Kind:** security
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `TrenchOccupancy.command` admits only owned, eligible squads into a local list and returns null once any is accepted. `Expansion.ts:439` then passes the original, unfiltered `command.squadIds` to `skirmish.observe`, which has no owner check: it sets `suppressed = true` and calls `finish(id, false)`. Nothing upstream filters squad ids for occupy. Suppression is sticky until the owner re-issues a stance command or a non-hold army order (`SkirmishStance.ts:110`, `136`), and `squad.stance` stays "skirmish", so the owner's UI still shows the stance. A player with any completed trench and one eligible squad of their own can repeatedly disable an enemy's reload-retreat micro. Repro: p2's occupy listing p1's squad 16 returned "executed", and squad 16 went from `suppressed:false` to `suppressed:true`. **Correction:** in the repro, squad 16 was in phase "ready", so no active withdrawal was aborted; the lasting effect is the suppressed flag. The same unfiltered pass exists for charge and attack-structure (`Simulation.ts:1347`), outside this finding.

- **Evidence:** `if(command.type==="occupy") {const result=this.trenches.command(command);if(!result)this.skirmish.observe(command);return result;}`
- **Fix:** pass only the admitted ids, and add a playerId filter to `SkirmishStance.observe` and `TrenchOccupancy.observe`.

#### R2-M13. Order observers still mutate trench and stance state before rejection; M11 still live and wider (command-fuzz)
- **Where:** `src/skirmish/Simulation.ts:1467-1468` (observers); rejections at `1472-1475`, `1505-1512`, `1534`, `1544`, `1559`, `1565`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Re-confirms and widens round-1 M11: nine rejections follow the observer calls, not two. `TrenchOccupancy.observe` calls `leave()` (phase "leaving", `clearLayout` writes an occupationReform formation transition, row published) and `SkirmishStance.observe` suppresses the stance; nothing rolls this back. For appended orders only the stance side effect happens. The fuzzer logged it in ClassicalAge, Napoleonic, EarlyModern and Modern; on EarlyModern seed 34, squad 2717 got an occupation-leave transition from a rejected replenish. The most ordinary trigger is not a fuzzer case: clicking water with an entrenched non-army squad before Cargo Canoes is researched. The squad then leaves its trench and, since it does not move, stays in "leaving" (released only once it moves more than FIXED away, `TrenchOccupancy.ts:786-793`).

- **Evidence:** `this.expansion?.skirmish.observe(command); if(!append)this.expansion?.trenches.observe(command);` followed by `if (order.type === "move" && !squadPaths.walkable(order.tile)) return this.waterPaths.walkable(order.tile) ? "Research Cargo Canoes to take squads onto water" : …`
- **Fix:** move both calls after the last rejection, just before `movementAdmission.cancel` and the commit loop (about `1567-1572`), and also call them on the deferred-planning early-success returns (`1476-1483`), as `Expansion.ts:442` does.

#### R2-M14. Live states fail the restore validator: transport landing and refits leave preferredFrontage without deployedShape (command-fuzz)
- **Where:** `src/skirmish/domain/TransportHandoff.ts:60`, `67` (and its column fallback); `src/skirmish/Simulation.ts:1195`, `1197`; validator `src/skirmish/domain/FormationGeometry.ts:538-540`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** When a manual column (`shape: 'column', automatic: false`) with no `deployedShape` lands from transport, `:60` computes `preferredFrontage` for `old.deployedShape ?? doctrine.defaultShape`, but `:67` stores `deployedShape: old.deployedShape`, which stays undefined. `validateFormation` then checks `preferredFrontage` against `deployedShape ?? shape` = "column", which has no shape profile, and throws "Invalid formation frontage". The column fallback spreads the same `preferred` object. Manual columns without `deployedShape` are normal live state (`Simulation.ts:1708`, `2193`, `2196`). A second path: `updateSquad` on a definition change (refit or enlargement) computes the frontage for `eligibleShape(old.deployedShape ?? shape)` at `:1195` but drops `deployedShape` at `:1197` when the new doctrine lacks it; 390 of 2,086 same-line definition changes gave an invalid formation (synthetic: bronzeage-anticavalry shield-wall column → earlymodern-anticavalry). `restore()` validates every formation (`Simulation.ts:270`), and a failure sets `restoreFailure` (`:290`) so `assertAvailable` (`:209`) refuses all later use. Restore consumers are `src/skirmish/worker.ts:115` (local recovery), CommitVerifier and `HostedRuntime.ts:93`. Fuzz round-trips failed in ClassicalAge, Napoleonic, EarlyModern and Modern; the first invalid write was `Simulation.ts:3552` (transport proposal). Both verifiers reproduced the landing path. `SnapshotDetails.ts:515` runs the same validator on client snapshot decode; if that error is not contained, severity could rise (unverified).

- **Evidence:** `deployedShape: intent==="column"?old.deployedShape:intent,` → `{"shape":"column",…,"preferredFrontage":384,"automatic":false,…}` → `Invalid formation frontage`
- **Fix:** at `:67` use `deployedShape: intent==='column' ? (old.deployedShape ?? formationDoctrine(id).defaultShape) : intent`; at `Simulation.ts:1197` store the same `eligibleShape` result that `:1195` measured. Add an end-of-tick `validateFormation` assertion in tests.

#### R2-M15. Engagement planner state fails its own restore validator after a multi-army quantum boundary (command-fuzz)
- **Where:** `src/skirmish/domain/EngagementManager.ts:623-626` (root cause), `174` / `180` (check), `474-480` (quantum loop)
- **Severity:** medium (reviewer: low) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** The reviewer saw one EarlyModern fuzz round-trip fail with "Invalid engagement planning cursor" and could not isolate it. Both verifiers found the cause. When a non-final army in a multi-army job finishes, `planQuantum` clears `memberIds` and `enemyIds` but not `projections`; `startArmy` refills them only on the next quantum (`:555`). If the per-engagement quantum (`ENGAGEMENT.quantum` 12) or the global budget (48) runs out right at that boundary, the job is checkpointed (`:110`) with `enemyIds=[]` and a non-empty `projections`, and restore fails the `projections.length === enemyIds.length` check. Live ticking continues, but any restore of that checkpoint throws and poisons the instance (CommitVerifier, `HostedRuntime.ts:93`). The reach verifier reproduced it deterministically with the Phase8BattleLines fixture: 14- and 29-squad armies throw (`armyCursor=1 enemy=0 proj=14 members=0`); the other counts 2-31 pass. In large battles the trigger is routine. The patched fuzzer now dumps the failing job condition.

- **Evidence:** `j.armyCursor++; j.memberIds = []; j.enemyIds = []; if (j.armyCursor >= j.armyIds.length) return this.finishJob(e); return false;` and `j.projections.length !== j.enemyIds.length ||` → `throw Error("Invalid engagement planning cursor");`
- **Fix:** also set `j.projections = []` (and ideally `j.candidates = []`) at line 625, or make the validator accept the cleared between-armies state.

#### R2-M16. EarlyMedieval warships become immortal 1-HP zombies that deal 0 damage (naval)
- **Where:** `src/skirmish/Simulation.ts:2789` (navalDamage closure `2776-2794`); structure path `~2931`; `src/skirmish/domain/Combat.ts` (`damageAmount`)
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** Instant-hit vessels pass `troops = Math.round(1000 * health / maxHealth)` to `damageAmount`. EarlyMedieval warships (index 3) have 2197 HP (2417 improved) and no projectile, so at 1 HP troops rounds to 0 and `damageAmount` returns 0 from its `troops <= 0` early return, before the `Math.max(1, …)` floor. At 2 HP or more they still deal at least 1. Damage resolves simultaneously, so a mirrored 1v1 decays to both ships at exactly 1 HP and stays there: each keeps targeting the other (`navalHealth(enemy) <= committed` is false), both stay "fighting" and refresh `lastCombatTick` (`:2942-2943`), so the retreat gate (`~3331-3336`) never opens and neither heals. They still count against ship caps and still capture traders. Reviewer measurement: an EarlyMedieval 1v1 was still alive at 300 s with both at 1 HP. A 1-HP ship also deals 0 to structures. **Correction:** it needs every hostile ship in range at 1 HP; a third damage source or a manual move order breaks it. Verifiers confirmed the damage arithmetic in isolation (`2197 1 0 0`, `2197 2 1 1`); the full trace could not be re-run because the current tree throws at module load ("Missing unlock earlymodern-carrier", `Catalog.ts:65`).

- **Evidence:** `damageAmount(profile, {tags:["ship"], meleeArmour:1000, rangedArmour:2000, bonusResistance:{}}, Math.round((1000 * ship.health) / vessel!.health), ship.xp)` with `if (troops <= 0 || …) return 0;`
- **Fix:** `Math.max(1, …)` on the troops argument while `ship.health > 0`, matching the projectile path's `Math.max(1, scaledDamage)`.

#### R2-M17. The repair state machine livelocks between repairing and returning-to-dock, and the AI never recovers the ship (naval)
- **Where:** `src/skirmish/Simulation.ts:3236-3239` (repairing), `3284-3292` (returning-to-dock); `src/skirmish/domain/AiNavalPlanner.ts:85-91` (`navalReady`); `Simulation.ts:930`
- **Severity:** medium (reviewer: high). The merged AI-fleet row: low (reviewer: medium)
- **Merged:** naval "Repair state machine livelocks between repairing and returning-to-dock when the dock voyage ends early" and naval "Repair livelock and other recovery gaps leave AI fleets permanently degraded"
- **Votes:** livelock: code kept/high (medium) · reach kept/high (medium). AI fleets: code kept/medium (low) · reach kept/medium (low)

**Mechanism.** In "repairing", a ship more than √8 tiles from its port only flips to "returning-to-dock" without starting a voyage. "returning-to-dock" flips back to "repairing" whenever `destination` is null or the path has ended, and clears both, so the two branches alternate every tick. Healing happens only inside repairing after the distance check, so it never happens, and `occupiedPorts` is rebuilt each tick from `repairPortId`, so the ship keeps its port's single repair slot and others wait in "waiting-for-dock". Measured: 120 s, 0 healing, 480 ticks in each state, with deferredPlanning on and off. Triggers: a naval-attack on a ship returning to dock (`Expansion.ts:712-714` leaves repairState alone; fightShips clears destination and path at `2897-2898`/`2901`, and a retarget voids the deferred recovery admission, `ShipMovementAdmission.ts:317`); a refit-ships order (`Expansion.ts:677`); the peace-protected coast revert, which clears the path (`3439-3440`); and, without deferred planning, an unreachable recovery path. The unreachable/limited admission trigger is mostly not reachable with deferred planning, because execution admissions pause and retry. Normal docking is safe (berths are within squared distance 5 of a 2×2 port). Humans escape with a sail or stop-ships order (`2675-2679`, `1407`). AI ships do not: `navalReady` and the admission `available` check exclude recovery states and the AI has no watchdog, so each stuck ship is a permanent loss of a hull and a port repair slot. **Verifiers disagree on how AI ships get stuck:** the AI-fleet verifiers found AI-native factions cannot trigger it themselves (AI naval-attack only goes to ready ships, `AiNavalBombardment.ts:39`; no AI refit-ships), so it reaches the AI through a human→AI handover (`serverMatchWorker.ts:247`); the livelock reach verifier says the coast-revert trigger can hit AI ships directly. Separately, a ship in "waiting-for-dock" with no friendly port stays stuck until a port exists again (`3299-3307`).

- **Evidence:** `if (distToPort > 8) { this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-dock" }); continue; }` and `if (distToPort <= 8 || ship.destination === null || ship.nextPathIndex >= ship.path.length) { … repairState: "repairing" … destination: null … }`
- **Fix:** in "repairing", when `distToPort > 8`, call `startRecoveryVoyage` to the berth instead of only changing state; or have naval-attack and refit-ships reset repairState. An AI watchdog would only work around it.

#### R2-M18. Naval research sends whole fleets to port, and new hulls spawn below max health (naval)
- **Where:** `src/skirmish/Simulation.ts:3215-3216` (reviewer cited 3212), retreat `3336-3351`, spawn health `2606-2609`; `src/skirmish/domain/ResearchEffects.ts:53`; `src/skirmish/domain/Expansion.ts:340-344`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Mechanism.** `isDamaged = ship.health < shipMaxHealth(ship)`, and max health is recomputed from the owner's current research (+10% per ship-improvement). Nothing rescales stored health when research completes; the only health writes are combat damage and port repair. `recruitShip` builds its rules from the raw definition and spawns at `rules.health`. Out of combat for 3 s, any shortfall triggers a retreat to a one-ship-per-port repair, and that retreat runs before the mission-held check, so AI missions are pulled too. Executed: four 1300/1300 Bronze warships became 1300/1430 when Bronze ship improvements completed; within 8 s they were all at the port (waiting-for-dock, returning-to-dock, one repaired) and cycled through it for about 60 s before patrolling again at 1430/1430. Blockades and AI patrols collapse whenever such research completes, and every later recruit first sails to port. The same root cause leaves a Stone→Modern refit at 1000/6275.

- **Evidence:** `const maxHealth = this.shipMaxHealth(ship); const isDamaged = ship.health < maxHealth;` and `health: Math.round(vessel.health * (general ? 1.1 : 1)),`
- **Fix:** keep stored ship health consistent with max-health changes (rescale on research and refit, and spawn at the researched maximum). The verifiers named the missing rescale as the root cause; no other fix was proposed.

#### R2-M19. The AI buys identical but 25% dearer submarines ahead of better warships (naval)
- **Where:** `src/skirmish/domain/AiNavalPlanner.ts:845-852`; `src/skirmish/domain/Expansion.ts:1758-1779`; `src/skirmish/content/Units.ts:518-527`; `src/skirmish/domain/AiResearchUtility.ts:125-127`
- **Severity:** medium (reach verifier: low) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (low)

**Mechanism.** Submarines are built by spreading the same-age warship (`...ship`), so they keep kind "warship" and identical stats, with 1.25× gold cost, and nothing in `src/skirmish` treats them differently. They are pushed after the age loop. Both AI pickers walk `VESSELS` in reverse and take the first researched warship-kind vessel, so a researched submarine always wins. With EarlyModern submarines and Modern warships researched, the AI buys the EarlyModern-stat submarine over the Modern warship (+30% health and damage, +1 range); with Modern submarines researched it pays 25% more for an identical hull. The AI researches submarines readily, because submarine techs get the +8000 warship sea-threat benefit, and `rus-modern-warships` does not require them, so the mixed state is reachable. **Cost figures disagree:** the reviewer and the reach verifier's runtime dump give earlymodern-submarine 6125 vs modern-warship 5600 (modern-submarine 7000); the code verifier's reading of the static formula (`Units.ts:462`) gives 1750 vs 4200 (modern-submarine 5250). The 1.25× ratio holds either way. AI economy and combat inefficiency only.

- **Evidence:** `const definition = VESSELS.slice().reverse().find((v) => v.kind === "warship" && progression.has(player.id, v.technologyId) && AGES.indexOf(v.age) <= AGES.indexOf(port.age ?? "StoneAge"));`
- **Fix:** not proposed beyond the mechanism; the cause is the reverse-order, first-match picker in both places.

### Low

#### R2-L1. The two red balance tests are test hygiene, not a cavalry DPS regression (tree-delta)
- **Where:** `tests/skirmish/PreModernBalance.test.ts:72`; `tests/skirmish/BalanceExperiment.test.ts:336`; `src/skirmish/content/BalanceContract.md:116-119`
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**Mechanism.** The reviewer claimed default attack orders now strike at weapon cadence (1.05 hits/s vs one commitment per 87 ticks in round 1), raising default cavalry DPS 7-10× with no AI or 52-faction balance run. Both red tests reproduce: PreModernBalance gives 39 survivors against a 27-33 target ("expected 39 to be less than or equal to 33"), and the 48-combination BalanceExperiment test times out at 5000 ms (6.1-8.6 s; `vite.skirmish.config.ts` sets no testTimeout). Round-1 combat 03 I1 ("three consecutive spearmen") now passes. **Corrections:** the failing assertion is Bronze axemen vs archers, with no cavalry involved; all 8 cavalry contract cases pass in the same run; the sustained cavalry assault is documented design (BalanceContract.md:111-113); and BalanceContract.md:116-119 already records the 39-survivor result as unresolved. The 7-10× DPS figure was not verified. Both test files and BalanceContract.md are new, untracked files. This refines round-1 H4's PreModernBalance item.

- **Evidence:** `tests/skirmish/PreModernBalance.test.ts:72:31 AssertionError: expected 39 to be less than or equal to 33`; `tests/skirmish/BalanceExperiment.test.ts:336:3 Error: Test timed out in 5000ms`
- **Fix:** resolve or retune the documented calibration; raise that test's timeout or speed it up.

#### R2-L2. The RiverExpansion reinforcement test reads a world frozen after victory (test-baseline)
- **Where:** `tests/skirmish/RiverExpansion.test.ts:87-89`; `src/skirmish/Simulation.ts:3393` (reviewer cited 3389)
- **Severity:** low (reviewer: medium; reach verifier: medium) · **Kind:** bug (test design)
- **Votes:** code: kept/high (low) · reach: kept/high (medium)

**Mechanism.** Explains one of round-1 H4's regressions. The fixture gives the tribe 100000 reserves against two nations with one 1000-HP city each and an idle human seat. The tribe wins at loop tick 747 on the working tree (872 at HEAD) out of 900, after which `performTick` returns early on `winner`. Line 89 then checks whether any tribe squad stands at x ≥ 41 in that frozen world. Reinforcement itself works on both trees: 2 afloat, landed at tick 12, intruder dead at tick 32 (46 at HEAD). The test passed at HEAD by luck. Bisection points at the deliberate October 16 balance promotion (soldier-weapons stoneage-infantry 18@30 rpm → 10@60 rpm, and the new, untracked `unit-tuning.json` speedPercent 80 applied at `Units.ts:412`). The reviewer's revert restored HEAD exactly (winner 872); a verifier's partial revert gave winner 844 but did make the assertion pass. Gameplay is unaffected.

- **Evidence:** `expect(game.squads.some(s=>s.playerId===tribe.id&&map.x(game.tileOf(s))>=41)).toBe(true);` after `if (this.winner !== null) return;` — trace `{"lastAcross":656,"winner":747,"acrossAtEnd":0}`
- **Fix:** assert the across-river landing or the intruder's death during the loop, or stop the loop when `winner` is set.

#### R2-L3. RussianTroopSources baked hashes match only a CRLF checkout (test-baseline)
- **Where:** `tests/skirmish/RussianTroopSources.test.ts:10-11`, `20`; `Art/Runtime/Russians/Troops/*/animations.json`
- **Severity:** low · **Kind:** determinism, reclassified as test and asset-pipeline portability
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The test hashes raw on-disk bytes. On this disk the three source `animations.json` files are CRLF (`git ls-files --eol`: `i/lf w/crlf`), although `.gitattributes` says `* text=auto eol=lf` and `core.autocrlf=true`. The baked `metadataHash` values in HEAD are the hashes of those CRLF bytes (RiverArcher cdd17176…, 21957 B) rather than of the LF blobs git stores (0263590c…, 21039 B). Any checkout that honours `.gitattributes` writes LF and fails all three tests: a fresh clone on any OS (Windows included), Linux CI or `git archive`. The bake and mask scripts hash raw bytes too (for example `scripts/buildRussianStoneAgeFactionMasks.cjs:12`). No match impact.

- **Evidence:** `const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");` and `expect(baked.metadataHash).toBe(hash(baked.source));`
- **Fix:** `git add --renormalize` plus a re-bake, or normalise line endings before hashing in both the baker and the test.

#### R2-L4. Black Forest layout and spawn attempt 0 share the same unsalted PRNG stream (mapgen)
- **Where:** `src/skirmish/BlackForestLayout.ts:44`; `src/skirmish/domain/SpawnSelection.ts:115-116` (reviewer cited 154-156); `src/skirmish/StartingPositions.ts:31`
- **Severity:** low · **Kind:** determinism, reclassified as RNG stream independence
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**Mechanism.** `BlackForestLayout` seeds `new PseudoRandom(seed)` with the bare match seed, and spawn attempt 0 uses `seed + imul(0, 104729)`, which is the same seed. So on Black Forest the k-th AI/tribe camp pick `floor(r_k*count)` reuses the k-th clearing-shape draw, coupling spawn choice to map layout. Every other generator XOR-salts its stream (for example `ContinentsLayout.ts:530`, `BlackForestMap.ts:47`). **Correction:** `Simulation.random` (`Simulation.ts:789`) is never drawn from at all, only checkpointed and restored, so it is not coupled to anything today; it is a trap only if someone later draws from it. Fully deterministic; no desync.

- **Evidence:** `const random = new PseudoRandom(seed),` (BlackForestLayout.ts:44) vs `new PseudoRandom(seed ^ 0x2b573c21)` (BlackForestMap.ts:47)
- **Fix:** XOR-salt the BlackForestLayout seed, as the other generators do.

#### R2-L5. Anti-air emplacement volleys skip the 4096 volley cap (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1256`; also `src/skirmish/Simulation.ts:4534`
- **Severity:** low · **Kind:** bug (consistency)
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**Mechanism.** The AA emplacement path pushes onto `world.volleys` unconditionally, while fighter guns (`Expansion.ts:1284`) and Battle (`459`, `1429`, `1464`) check `volleys.length < 4096`. **Correction:** this is a consistency gap, not a reachable overflow. Each push needs a successful `battle.fire()` (capped at 4096 projectiles), each emplacement fires at most once per 2 s reload, volleys expire after 0.6 s (about 5 ticks), the decoder accepts up to 51000 rows, and archer volleys (`Simulation.ts:4534`) are uncapped too. No crash and no simulation effect.

- **Evidence:** `this.world.volleys.push({id:this.world.allocateId(),squadId:b.id,…definitionId:"naval-air-defence",…})` vs `if (this.world.volleys.length < 4096) this.world.volleys.push(…)`
- **Fix:** add the same length guard at `Expansion.ts:1256`, and consider it at `Simulation.ts:4534`.

#### R2-L6. The shared 4096 projectile cap can refuse strategic launches and hold bombers at their target (air-strategic)
- **Where:** `src/skirmish/domain/Battle.ts:172-173`; `Battle.ts:567`; `src/skirmish/domain/Expansion.ts:1051-1053`, `1328-1340`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/low (low) · reach: refuted/medium · repro: kept/medium (low)

**Mechanism.** `canFire` counts every projectile, arrows and shells included, plus reserved MIRV warheads, against one 4096 budget. When full, `launch` returns "Strategic flight capacity reached" and a bomber at its target does `continue` without firing. **Corrections:** a refused launch is checked before spending, so it costs nothing; the bomber hovers in place (it does not circle) and retries every tick, bombing as soon as a slot frees (repro: 0 bombs while full, bombed the tick after 50 fillers were removed); it returns home without striking only if the cap stays full for its whole remaining fuel (120 s or more), and an atomic payload is refunded. The reach verifier refuted it as unreachable: the highest recorded live projectile count in out/ and the optimisation evidence is 55, and the cap is deliberate and tested (`GameplayTuning.test.ts:106-119`). Transient back-pressure under extreme load.

- **Evidence:** `canFire(warheads = 0): boolean { return this.projectiles.length + this.reservedWarheads + 1 + warheads <= 4096; }` and `if(!fired)continue;`
- **Fix:** reserve a small separate budget for bomb/icbm/mirv/warhead projectiles.

#### R2-L7. The "flank" phase is dead; flank-left/right doctrine only sets wing iteration order (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:400-403`, `469`; `src/skirmish/domain/EngagementManager.ts:759`; `src/skirmish/content/AiDoctrines.ts:73-77`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** No code assigns `plan.phase = 'flank'`; it appears only in the type union (`:38`), the restore allowlist (`:93`) and the branch at `:400`. The doctrine engagement "flank-left/right" only sets `army.wingPreference`, whose sole reader picks whether the left or right wing is processed first. Every army with mounted slots gets wing planning anyway, so the rider doctrine's contract ("Stage reachable mounted wings with infantry support") is met only through its mounted-first roster preference and the generic wing logic; it has no staging of its own.

- **Evidence:** `} else if (plan.phase === "flank") {` and `if(doctrine.engagement==='flank-left'||doctrine.engagement==='flank-right')army!.wingPreference=…`
- **Fix:** implement the staged mounted-wing phase or remove the dead branch.

#### R2-L8. A lost trench sends the mission to recover without a regroup order (ai-tactics)
- **Where:** `src/skirmish/domain/TrenchPositioning.ts:66-74`; `src/skirmish/domain/AiArmyPlanner.ts:369`, `506-519`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**Mechanism.** Only the recovery half of the claim holds. On a lost trench, `TrenchPositioning.step` releases the trench and sets `plan.phase = 'recover'` with the reason "Trench lost; regrouping survivors", but issues no regroup order and leaves `plan.since` stale. The same planner call then reaches the recover branch, which disbands the army in place if the mission's last `since` is more than 40 s old, or otherwise leaves the squads without orders until 40 s pass. Every other transition to recover issues a regroup and resets `since`, as HillPositioning does (`:184`, `:191`). `AiTrenchOccupation.test.ts:40` checks only the phase. **Refuted part:** the stacking claim at line 128 is wrong; the occupy tile is only the starting point, and `TrenchOccupancy.allocate` gives each squad its own free slots across up to 4 neighbouring segments. Modern, defence-purpose missions only.

- **Evidence:** `this.release(plan, members); plan.phase = "recover"; plan.reason = "Trench lost; regrouping survivors"; return false;`
- **Fix:** issue a regroup order home and reset `plan.since`, as HillPositioning does.

#### R2-L9. A rejected fire-retreat army order permanently flips the army posture to skirmish (command-fuzz)
- **Where:** `src/skirmish/domain/Armies.ts:610`; rejections at `619`, `624`, `626`, `630`, `641`, `650/653`; commit at `663`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** `Armies.order` sets `army.posture = 'skirmish'` before the target, walkability, queue, connectivity, planning-cap and route checks, and none of those rejections roll it back. A real trigger is a fire-retreat order whose target dies or stops being hostile before the tick that applies it. The posture shows in the UI and puts members into the skirmish evaluator (`SkirmishStance.ts:170`). A queued or deferred fire-retreat also applies it early. Logged 1-3 times in every fuzz run with armies. **Correction:** slot caches do not stay stale; `syncSlots` (`:309-311`) notices the posture change and re-lays out, bumps `slotRevision` and invalidates engagements.

- **Evidence:** `if(order.type==='fire-retreat')army.posture='skirmish';` at 610, before `if (!target) return "Choose a hostile land squad";`
- **Fix:** delete line 610; lines 663 and 1154 already set it on commit and deploy.

#### R2-L10. restoreShared resets clusterRevision but keeps start trees from a used instance (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:200-206`; cache hits at `417-423`, `699-702`, `886-891`
- **Severity:** low · **Kind:** determinism
- **Votes:** code: kept/medium (low) · reach: refuted/medium (low) · repro: kept/high (low)

**Mechanism.** `restoreShared` rolls `clusterRevision` back to the checkpoint without clearing `startTrees`, and a start tree is accepted on revision equality alone. After a restore into a used instance, a tree cached at revision r on an abandoned branch is accepted on a new branch that reaches r again under different forest costs. Repro: the used instance routed along rows 3-8, a fresh restore along rows 8-13 (`IDENTICAL: false`); the control without the reset matched. **Corrections:** only start trees are affected; portal crossing trees are dropped by the forest diff that `ForestField.restore` publishes. `restoreRevision` is in `Pathfinding.ts:153` and does not touch the hierarchy. **Reach:** production always restores into a fresh Skirmish (`worker.ts:114-115`); the only in-place restore is HostedRuntime/CommitVerifier, used only by tests, and the verifier never re-simulates host steps, so nothing is rejected. Latent hygiene.

- **Evidence:** `restoreShared(saved?) { this.sharedTrees.clear(); this.sharedPins.clear(); this.sharedBackbones.clear(); … this.clusterRevision.set(saved.clusterRevisions);`
- **Fix:** call `this.startTrees.clear()` in `restoreShared`.

#### R2-L11. The CohortAdmission 3000-tick deadline is a 20 Hz literal, now 375 s (movement-core)
- **Where:** `src/skirmish/domain/CohortAdmission.ts:254-258`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** `tick - plan.created >= 3000` was added on 2026-10-03 (a4145f42), when `TICKS_PER_SECOND` was 20 (150 s). At 8 Hz it is 375 s, so stuck cohorts hold one of the 128 pending slots 2.5× longer. The "8hz" commit converted other literals but not this file. The per-plan `deadlineTicks` does not help: it returns undefined for interactive human army routes, and in default matches `autonomousRouteDeadlineTicks` is never set, so this cap is the only time limit on any pending army cohort. Timing only; no crash.

- **Evidence:** `this.ports.routes.tick() - plan.created >= 3000` → `this.finish(plan, "rejected", "Cohort admission deadline reached");`
- **Fix:** `secondsToTicks(150)`.

#### R2-L12. Symmetric naval battles are decided by id-derived lanes, cadence and wander phase (naval)
- **Where:** `src/skirmish/Simulation.ts:2710` (lane; reviewer cited 2706), `3160` (pursuit cadence), `3108` (wander phase)
- **Severity:** low (reviewer: medium) · **Kind:** determinism, reclassified as a fairness/tie-break sensitivity
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**Mechanism.** Sub-cell lanes fall back to `ship.id % 4` when a ship has no AI fleet-mission lane, pursuit re-evaluates on `(tick + id) % 4`, and the wander tile depends on `tick + tile`. These change where a target is when a shell lands, shells hit only on overlap, and health-scaled damage amplifies any first-hit edge. Reviewer: swapping only id allocation flipped the winner in 7 of 24 mirrored cases. Verifier re-run of the LateMedieval 1v1: with A as the lower id, A is sunk and B keeps 102/2856 HP; with B as the lower id, the ships tie at 48/48; the settled separation differs by a tile (6.5 vs 7.5). **Corrections:** "the lower-id side's first shell missed" is false (with A lower both opening shells hit; with B lower both missed); "decisive" is overstated; some mirror cases are decided by player/geometry asymmetry in the harness. Deterministic and server-authoritative; real matches never present exactly mirrored geometry.

- **Evidence:** `const lane=spread ? this.expansion?.economy.naval.fleetLane(ship) ?? ship.id%4 : 0;`
- **Fix:** not proposed beyond the mechanism.

#### R2-L13. Prize ping-pong inflates capture stats and creates a reverse embargo row (naval)
- **Where:** `src/skirmish/domain/Trade.ts:1229-1255`; `src/skirmish/domain/Diplomacy.ts:34-35`, `50-53`, `291-296`; `src/skirmish/domain/AiOperations.ts:421`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Mechanism.** The captor filter never excludes an actor that is already a prize, and capture holds the prize still for a 1 s handling wait. With hostile warships of both owners within 1.2 tiles, the prize changes hands after every wait, and each flip adds the full cargo value to `capturedValue` and `lostValue`. Repro: 5 flips in 6 s for a 500-gold cargo (`capturedValue {1:3500, 2:5000}`); in a full-simulation run the ships stayed adjacent while fighting and the same 5 flips occurred, while an escorted case with drifting ships gave 1 flip. No gold is duplicated (HUD stats, `Expansion.ts:1990-1991`). **Correction:** the original owner's recapture does not fire a raid notification, because `recordTheft` checks the pair-symmetric `embargo()` and the pair is already active. It does push a reverse embargo row with the victim as initiator, which makes the AI retaliation test (`AiOperations.ts:421`) treat the victim as a raider and produces an extra "raid-expire" notification. With a declared war, only the stats inflate.

- **Evidence:** `this.diplomacy.recordTheft(captor.playerId,a.playerId,this.world.tick); … this.capturedValue[captor.playerId] = (this.capturedValue[captor.playerId] ?? 0) + value; a.playerId = captor.playerId; a.state = "prize";`
- **Fix:** not proposed beyond the mechanism (the missing prize exclusion in the captor filter).

#### R2-L14. Explicit naval projectile shots can launch with 0 damage (naval)
- **Where:** `src/skirmish/Simulation.ts:2906-2914` (explicit fire), vs `2952-2953` (autonomous clamp)
- **Severity:** low · **Kind:** bug
- **Votes:** code: refuted/high (low) · reach: kept/high (low) · repro: kept/high (low)

**Mechanism.** The explicit-target path passes raw `scaledDamage`, which floors to 0 at about 6 HP or less for projectile warships, while the autonomous path passes `Math.max(1, scaledDamage)`. Repro: a latemedieval-warship at 5 HP fired three explicit shells with `damage=0` and the target stayed at 1000; the autonomous shooter's shells did 1 each (1000 → 997). The in-flight shell still reserves about 1 damage for its whole flight time (`incomingNavalDamage` clamps to at least 1), so a target at 1 HP or less can be skipped by other shooters until the dud lands. **Dispute:** the code verifier argued hits still deal 1 through `damageAmount`'s floor and the difference is cosmetic (no detonation effect, `ImpactPresentation.ts:50`); the reach and repro verifiers showed the blast-radius splash budget becomes 0, so the shell really deals 0.

- **Evidence:** `this.expansion.battle.fire({ ...ship, domain: "ship" }, p, effectiveAttack!, scaledDamage, …)` vs `effectiveAttack!, Math.max(1, scaledDamage),`
- **Fix:** pass `Math.max(1, scaledDamage)` at line 2910.

---

## Plausible (needs a repro)

#### R2-L15. Unlucky-seed and range invariants throw during prepare and end the match with no re-roll or seed log (mapgen)
- **Where:** `src/skirmish/MigrationLayout.ts:256-257`, `330`; `src/skirmish/TerrainDrainage.ts:104-106`; `src/skirmish/Elevation.ts:39-45`; `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:475-482`; `serverMatchWorker.ts:308`; `LiveMatch.ts:150`
- **Severity:** low · **Kind:** bug (latent robustness gap)
- **Votes:** code: kept/low (low) · reach: kept/low (low)

**Mechanism.** Generator invariants throw during prepare: "Migration could not separate the mainland" after 12 channel attempts, no mainland, land without a drainage outlet, and elevation outside the calibrated range. `CoordinatorServer.ts:475-482` then ends the not-yet-started match for every member, and the worker's error log (`serverMatchWorker.ts:308`) omits the `Math.random` seed from `LiveMatch.ts:150`, so the failure cannot be reproduced. No failing seed was found: 375 seeds at 250 and 8 at 500 per map (reviewer), plus Migration 1000 ×20, Migration 2000 ×3, Black Forest and Continents 1000 ×8 (verifier). The Black Forest pond-bed path needs terrain height below 3; measured heights stayed in [21, 1000] against [0, 1200]. **Correction:** "Not enough room" (`StartingPositions.ts:27-30`) is an intended rejection of the chosen settings, not an unlucky-seed failure. The impact is a failed match start, not a mid-match crash. A seed that actually fails would settle it.

- **Evidence:** `if (majorPieces < 2) throw new Error("Migration could not separate the mainland");` and `console.error("Match executor operation failed",message.request.type,error);`
- **Fix:** re-roll the seed a few times on a generation error, and include the seed in the failure log.

---

## Perf findings

These are all confirmed perf-kind findings. Each entry has an **Expected impact** line, which uses only the numbers the reviewer or verifiers measured or estimated.

### High

#### R2-P1. Procedural prepare at 2000 always exceeds the 30 s worker timeout; 1000 is marginal on ARM (mapgen)
- **Where:** `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts:67-72`; `serverMatchWorker.ts:131-147`; `src/skirmish/lobby/LobbyDirectory.ts:91-92`; `src/skirmish/client/main.ts:811`
- **Severity:** high (verifiers: high for 2000, medium for 1000)
- **Votes:** code kept/high (high) · reach kept/high (high)

**What happens.** Generation, SpawnSelection and mapIdentity all run in one "prepare" request under a fixed 30 s timer that starts when the request is posted. LiveMatch passes no pre-generated map, there is no cache and no progress signal. The lobby UI offers "2000 cells · procedural maps only". On timeout the worker is terminated and CoordinatorServer ends the match for the whole lobby ("Unable to initialize match"). The client runs the same generation on the browser main thread, counted against the 60 s load deadline. Reviewer hotspots: migrationCoastDistance about 38% (every other island checked per tile, `MigrationLayout.ts:124-131`), RegionalTopography about 20%, the priority-flood heap with object allocation about 20%, GC about 19%.

**Expected impact.**
- Desktop (Ryzen 3700X, 384 MB worker): Migration 1000 10.8 s, Continents 1000 15.3 s, Black Forest 1000 18.2 s.
- Desktop at 2000: 47 / 81 / 67 s; verifier reruns 56.1 s (migration seed 3) and 49.3 s for load alone (seed 7). Every 2000 lobby fails.
- ARM (desktop × 1/0.4, an extrapolation, not measured): about 27, 38 and 46 s at 1000.
- Per-seed variance at 250 is about 3×. The client UI freezes for seconds at 1000 and tens of seconds at 2000.

- **Evidence:** `const timeout = setTimeout(() => { … this.fail(new Error(\`Match executor timed out during ${request.type}\`), "timeout"); void this.worker.terminate(); }, 30_000);`
- **Fix:** not proposed beyond the hotspots; the measurements point at the generation cost inside the single timed prepare request.

#### R2-P2. A mixed army/non-army human move runs synchronous HPA* on the never-warmed amphibious graph (movement-core)
- **Where:** `src/skirmish/Simulation.ts:1480-1483`, `1543-1553` (findGroup at `1546`), `3407-3412` (live warm, reviewer cited 3408); `src/skirmish/domain/Armies.ts:403-411`; `src/skirmish/HierarchicalPaths.ts:433-440`, `1123`/`1217`
- **Severity:** high
- **Votes:** code kept/high (high) · reach kept/high (high)

**What happens.** A non-append move goes to deferred admission only when every selected squad is outside an army, and `Armies.groupOrder` returns undefined unless the selection is exactly one whole army. Any other selection containing an army member (a mixed selection, one squad picked out of an army, a partial army, or two armies) falls through to the legacy synchronous `Formations.plan` + `squadPaths.findGroup`, which reaches `HierarchicalPaths.find`. That builds every missing crossing tree synchronously with no budget. In live config the amphibious graph is never warmed (only land and water are), and 49-52 of 52 factions are amphibious from Napoleonic on. Box-select, shift-click and badge-click all produce such selections in the real UI. Built trees stay cached and background planning fills them in, so the worst stall is early in a match or in regions not yet visited.

**Expected impact.**
- Reviewer at HEAD: Mediterranean 500 took 535 ms inside applyCommand and built 666 trees; Mediterranean 1000 took 2,612 ms and built 2,787 (about 6 s on ARM). A plain-squad control took 0 ms; a prepared graph answers 40 squads in 36 ms.
- Verifier reruns on the working tree (Mediterranean 500): 808 ms and 590 ms, 666 trees each.
- One click freezes the match for everyone (the same class as the 2026-10-15 freeze).

- **Evidence:** `if(this.options.deferredPlanning && !append && order.type==="move" && selected.every(s=>!this.expansion?.armies.armyOf(s!.id) && …)) { this.movementAdmission.start(…);return null; }` → `groupPaths = squadPaths.findGroup(…, order.tile, this.obstacleTest(player.id));`
- **Fix:** send these selections through movementAdmission or groupOrder (or reject them), and cap cold-tree builds in `HierarchicalPaths.find`.

### Medium

#### R2-P3. Assault presentation geometry is recertified and rewritten on every melee strike (tree-delta)
- **Where:** `src/skirmish/domain/Battle.ts:989-992` inside the per-shot loop at `964-965` (reviewer cited 988); `src/skirmish/domain/CavalryAssault.ts:71-73`; `src/skirmish/Simulation.ts:2003-2008`
- **Severity:** medium (reach verifier: low)
- **Votes:** code kept/high (medium) · reach kept/medium (low)

**What happens.** Same class as round-1 P29 (03 I7). Each committed melee shot of an assaulting rider runs `assaultContactGeometry`, which does one `chargePresentationClear` terrain certification (convex hull plus `certifyFormationPolygon` over every footprint), and writes a new `cavalryEngagement`/assault object with no equality check. Authoritative code never reads x, y, nx, ny, halfWidth, approach, pressure or resistance; only the client and the validator do. The new object defeats SquadDetailCache's `Object.is` check, forcing re-stringify. A failed certification also zeroes depth, which then stays 0 because `activeAssault.depth` is fed back in (presentation only). **Correction (reach):** the network half is wrong; engaged squads are already dirty every tick (`lastCombatTick`, `Battle.ts:956`) and their full detail string is sent anyway, so replacing the object adds no bytes on the wire.

**Expected impact.** Reviewer: 21 replacements in 20 s with 1 real geometry change, about 429 B of JSON each, 91 µs per certification on desktop. At about 200 engaged cavalry: about 25 certifications per tick, 2.3 ms desktop and 5-6 ms ARM. The claimed 86 KB/s of churn per client is refuted.

- **Evidence:** `if(activeAssault && squad.cavalryEngagement && squad.cavalryEngagement.targetIds.includes(target.id)) this.world.updateSquad(squad.id,{cavalryEngagement:{…squad.cavalryEngagement, assault:{…activeAssault,…assaultContactGeometry(…)}}});`
- **Fix:** skip the update and the certification when the target or contact pose has not changed, or round the values and keep the old object when they are equal.

#### R2-P4. Each spawn click reruns the full 52-faction placement; the serial worker queue can hit the 30 s timeout (mapgen)
- **Where:** `src/skirmish/StartingPositions.ts:16-38`; `src/skirmish/domain/SpawnSelection.ts:82-88`, `114-147`; `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts:64-72`; `src/skirmish/multiplayer/application/LiveMatch.ts:510-523`
- **Severity:** medium (reach verifier: high)
- **Votes:** code kept/high (medium) · reach kept/high (high)

**What happens.** `add()` loops over all candidates for every placed camp and `next()` makes two more full passes. `select()` calls `resolve()` on every valid click, which rebuilds placement for every faction with up to 16 retries. Requests run one at a time, and each request's 30 s timer starts when it is queued (backlog cap 8). LiveMatch.selectSpawn has no per-guest in-flight guard; the only throttle is 50 requests/s per session, so one guest can fill the queue alone. A timeout terminates the executor and kills the match at the spawn screen.

**Expected impact.**
- Black Forest 1000 (976,144 candidates): one select 2.4-2.7 s on desktop, about 6 s on ARM (estimate). Eight queued clicks take about 19-21 s on desktop; the reviewer's 42 s figure rests on the ARM estimate.
- Black Forest 2000 (3,952,144 candidates, verifier-measured): one select 12.2-12.6 s, so about 3 queued clicks, even from one player, pass the timer on desktop.
- Migration 1000: 0.49 s per click.

- **Evidence:** `add(tile, radius) { for (const candidate of this.candidates) this.clearance[candidate] = Math.min(…) }` and `this.reservations.set(playerId, tile); try { this.resolve(); }`
- **Fix:** not proposed beyond the mechanism (full re-placement per click, no per-guest guard, timer started at queue time).

#### R2-P5. Planner job slots are monopolised by per-member interactive requests; AI and trade routing are starved (load-test)
- **Where:** `src/skirmish/RoutePlanner.ts:519-532`; `src/skirmish/MovementAdmission.ts:946-961`; `src/skirmish/Simulation.ts:822`, `953`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/medium (medium) · reach kept/medium (medium)

**What happens.** Related to round-1 P20. Every member of every human cohort holds its own planner job (key `admission:id:squadId`, priority = interactive). Interactive requests may fill all 128 slots, while background requests are refused at 120 and uncommitted ones at 104. Nothing caps interactive jobs per player or in total; the identity port only drives round-robin scheduling. A refused request is retried on the next tick with no backoff (`retryAt` is set only after a "limited" outcome). **Corrections:** members do not all submit at once (the leader goes first; nearby members then request only short entry connectors to the shared spine), but each still holds a slot. Admitted background work keeps about a third of scheduling turns; new AI and trade requests are refused. Human priority is deliberate; the defect is that it has no limit. No crash.

**Expected impact.** Reviewer: with 8 active humans the planner averaged 115-124 jobs (max 128 in every 400-tick window) for 10 minutes, with 274-635 pending admissions; idle-seat control 62-85 jobs and 33-66 admissions. Refusal rates 68-88% human, 86-97% AI, 96-97% trade; the real worker counted 1.03M refused requests in 6000 ticks (about 171/tick). Routing phase +18 ms (Mediterranean) and +41 ms (Migration) mean on desktop, p99 126-337 ms, single ticks 529-919 ms. Move commit latency p50 7-12 ticks, p95 34-51 ticks. Not reproduced by the verifiers.

- **Evidence:** `if (this.ports.priority && !this.priorityOf(request) && this.jobLimit >= 16 && this.jobs.size >= this.jobLimit - 8) { … return false; }` (no interactive branch)
- **Fix:** add a per-player or aggregate interactive quota and a retry backoff.

#### R2-P6. MovementAdmission priority selection is O(P²): it spreads the whole pending map on every loop iteration (load-test)
- **Where:** `src/skirmish/MovementAdmission.ts:801-808` (spread at `803`), `795`, `788`; idle exits at `930`/`943`/`945`/`975`; callers `src/skirmish/Simulation.ts:623`, `626`, `627`, `632`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.** With `priority=true`, every iteration evaluates `[...this.pending].find(...)` over all P entries, including AI admissions. Human admissions waiting on the planner take the routes branch, which increments only `idle`, never `used`, so the budget never stops the loop; it ends only when `idle >= this.pending.size` (total P, not the priority count). One call is P iterations × P entries; queued admissions cost about 320 × P. `:795` adds one more full spread per stepInteractive call. **Correction:** up to four priority passes run per tick, not three (stepInteractive at 623 and 626, plus the 2/3 priority pass inside `step()` at 627 and 632). With no human admission pending, the cost is O(P). CPU only.

**Expected impact.** Reviewer micro-benchmark: 4 ms per call at P=150, 17-23 ms at P=320-500. Contended match profile: 10-16 ms of thread CPU per tick (6-7% of the tick), 93-97% of it in the priority path, at mean P=271-467; roughly 25-40 ms per tick on ARM (extrapolated). Verifier benchmark (2 human entries at the tail): 0.95 ms at P=150, 3.3 ms at P=300, 8.7 ms at P=450.

- **Evidence:** `const entry = priority ? [...this.pending].find(([, admission]) => this.ports.priority?.(admission.playerId)) : this.pending.entries().next().value;`
- **Fix:** iterate a separate insertion-ordered priority index (or scan `pending.entries()` lazily once per call), and bound `idle` by the priority count.

#### R2-P7. 8 active humans push the 52-faction target well below real time on the ARM host (load-test)
- **Where:** `src/skirmish/Simulation.ts:3381-3392` (`step`/`performTick`; a whole-tick finding, not a line-level defect); `src/skirmish/multiplayer/application/LiveMatch.ts:717-726`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/medium (medium) · reach kept/low (medium)

**What happens.** The tick runs synchronously with no budget, and LiveMatch's clock-debt policy slows game time rather than dropping ticks, so every tick-denominated latency stretches in wall time. 8 humans + 14 AI + 30 tribes is a legal lobby. **Corrections:** the reviewer applied the ×2.4 ARM factor to contended wall time. The harness's own thread-CPU numbers show the main thread was descheduled about 45% of the time (the med, mig and worker runs ran concurrently), and the uncontended probe (`perf52.json`, 80-113 ms) matches thread CPU, not wall time. Most of the shortfall is the baseline 52-faction load; active humans add about 25-40%. The humans-vs-idle delta is not a clean control: idle runs lose more factions (52 → 30 vs 52 → 43/46). The ×2.4 factor itself is inherited from round 1 and unverified.

**Expected impact.**
- Reviewer (desktop wall time, quiet batch): Mediterranean 198 ms mean, p99 464, max 851; Migration 206 ms mean, p99 497, max 1063; idle seats 154 ms. Routing +18/+41 ms, combat +18/+11 ms, movement +9/+5 ms over idle. Desktop at 0.61-0.63× real time; real ReservedMatchWorker run 0.60×. ARM extrapolation 475-495 ms per tick (0.25×), p99 1.1-1.2 s; move commit p95 of 34-51 ticks becomes 17-25 s of wall time.
- Code verifier (thread CPU): 110-114 ms with humans vs 78 ms idle; ×2.4 gives about 265-340 ms per ARM tick, roughly 0.35-0.45× real time, with latencies stretched about 2.2-2.9×, not 4×.
- The p99/max and 0.60× figures come from a contended batch and should be re-measured alone before quoting.

- **Evidence:** `tickCpuMeanAll` 109.58 vs `tickAll` mean 198.02 (out-med-humans.json); 114.28 vs 206.06 (mig-humans); 78 vs 154 (idle)
- **Fix:** not proposed beyond re-measuring alone; R2-P5 and R2-P6 cover the human-specific routing and admission costs.

#### R2-P8. Publish-on-command raises publications to about 6.5 Hz, and every streamed publication lags one advance under saturation (load-test)
- **Where:** `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:282`, `269`; `src/skirmish/multiplayer/application/PublicationQueue.ts:26-30`; `src/skirmish/multiplayer/application/LiveMatch.ts:727-731`
- **Severity:** medium (reach verifier: low)
- **Votes:** code kept/high (medium) · reach kept/medium (low)

**What happens.** Re-measures round-1 P15 and P14. Any advance with an executed command or committed cohort progress publishes, regardless of the coordinator's 5 Hz gate, and LiveMatch does not push its next background snapshot back after a command publication, so the two streams are not coalesced. The rate is bounded at 8 Hz (one per 1-tick advance). The higher rate is documented design (comments at `serverMatchWorker.ts:277-281`, `LiveMatch.ts:727-730`). **Correction:** the one-advance lag under saturation is not specific to command publications; it applies to every streamed publication, because the encoder's result is posted only when the synchronous `match.step()` yields (round-1 P14).

**Expected impact.** Reviewer: 6.45-6.59 publications per simulated second against 5.00 idle (reviewer worker logs show 6.16-6.47). At full speed 426 KB/s (Mediterranean) and 332 KB/s (Migration) per client vs 285/259 KB/s idle, about 21-27 Mbit/s of egress for 8 clients. Extra cost per game second: about 1.5 × 7 ms of capture, 1.5 × 12 ms of encoding and about 70 ms of client CPU. Delivery delay 5-10 ms unsaturated vs 208 ms mean (472 ms p99) saturated.

- **Evidence:** `const publish = request.publish || commandProgress || outcomes.some(outcome => outcome.status === "executed");`
- **Fix:** coalesce command publications with the background cadence, for example by returning a "published" flag so LiveMatch defers its next background snapshot; for the lag, see round-1 P14's fix.

#### R2-P9. Strategic-zoom frames re-derive formation pose and envelope for every on-screen squad (client-unread)
- **Where:** `src/skirmish/client/Renderer.ts:1442-1497` (clear at `1442`, envelope at `1454`, pose at `1492`); `src/skirmish/client/FormationRenderPose.ts:24-80`; `src/skirmish/client/CombatPresentationTimeline.ts:115-127`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/medium (medium) · reach kept/medium (medium)

**What happens.** `draw` clears `formationPoses` each frame, calls `formationEnvelope(squad, visualTick)` for every non-embarked formation squad to cull, then `formationRenderPose` for every visible one, with no cross-frame memo. **Corrections:** for squads in a steady formation the domain caches hit (envelope, slots, footprints and `geometryKey`, which returns a cached string rather than rebuilding it), so their cost is lookups, a geometry spread and fresh footprint polygons. Full recomputes happen for squads that are moving (interpolated x/y miss the footprint cache, `FormationContact.ts:309`), turning (CombatPresentationTimeline makes new formation objects, missing every formation-keyed cache) or transitioning (fractional `visualTick` misses tick-keyed caches). Snapshots arrive every 125 ms (8 Hz), not 200 ms. Frame time only.

**Expected impact.** Reviewer, real Chrome, 1042 squads: draw p50 17.7-19.9 ms, p95 30-33 ms, p99 41-48 ms, already past the 16.7 ms budget; ARM-class laptops about 20-25 fps. V8 profile: 60% of draw JS in this closure (formationRenderPose 49% of it, envelope and geometryKey 29%). At soldier zoom with few squads visible, the pre-cull envelope still costs 8-11 ms. The verifiers did not reproduce the 60% share.

- **Evidence:** `const formationPose=squad.formation && !squad.afloat ? formationRenderPose(squad,visualTick,this.world(p.x,p.y)) : undefined;`
- **Fix:** memoise poses per squad id per (timeline source, floor(visualTick) during transitions), cache `broadRadius` per snapshot, and derive the strategic box from the cached envelope.

#### R2-P10. Soldier-scale battle frames cost about 190-300 ms, split between choreography and per-soldier drawImage (client-unread)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:1209-1280` (per-soldier loop; invariant work at `1231-1237`), `271-317` (flush); `src/skirmish/client/troops/TroopPresentation.ts:13`, `38-46`; `src/skirmish/client/Renderer.ts:1592-1600`
- **Severity:** medium (reviewer: high; reach verifier: high)
- **Votes:** code kept/medium (medium) · reach kept/medium (high)

**What happens.** Measures round-1 P10. The only gate on detailed soldiers is scale ≥ 12 with a loaded sheet; there is no soldier budget and no distance or selection LOD, so every viewport-visible squad gets the full choreography pass in `TroopActors.draw`, and `flush` then does save/translate/rotate/drawImage/restore plus two `impacts.member` passes per soldier on Canvas2D. Per-squad values (unitDefinition, weaponCycle, throwTiming, reload ticks) are recomputed for every soldier. InstancedActorSprites is imported only by the standalone review scene. Formation capacities reach 20-64 soldiers, so 200+ visible squads is about 4,000-6,000 actors per frame.

**Expected impact.** Reviewer, real Chrome at 1600×900 on the densest fight with sheets loaded: scale 16 with 202 squads, draw p50 186.6 ms, p95 298, p99 383 (TroopActors.draw 90.4 ms + flush 86.3 ms); scale 12 with 273 squads, p50 298 ms (137 + 128). The same view without sheets costs 20.6 ms. A 3-5 fps slideshow where players micro-manage. The reviewer ranks instancing plus a soldier budget at about 10× the gain of round-1 P1 (about 10 ms per publication). The verifiers could not re-run the harness, which is not in the repo.

- **Evidence:** `for (const entry of entries) { ctx.save(); ctx.translate(…); ctx.rotate(entry.angle); ctx.drawImage(…); ctx.restore(); }`
- **Fix:** instancing via InstancedActorSprites for the flush half; a detailed-soldier budget (for example 2,500 soldiers nearest the centre or selection) and choreography LOD (30 Hz sampling, skip engagement sampling when not in contact) for the draw half. Hoisting the per-squad values out of the soldier loop is a cheap partial fix.

#### R2-P11. A failed reorientation is retried every tick with no backoff, with an uncached Hungarian solve each time (movement-core)
- **Where:** `src/skirmish/Simulation.ts:2266-2273` (reviewer cited 2271); `src/skirmish/domain/FormationGeometry.ts:113-120`, `433`, `454-482`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/medium (medium)

**What happens.** When the target bearing differs from the facing by more than 30° (or a hold order gives a facing), `reorientedFormation` runs an O(n³) Hungarian solve used only to size the duration, then certification. A failed certification records nothing (no retry tick, no blocked marker), so the same attempt repeats every tick; with a hold-facing order next to blocked ground, until the order changes. The in-transition branch has a `retryTick` backoff; this one does not. **Correction:** the second solve (`assignedTransitionSources`) misses the WeakMap pair cache, but a content-keyed 128-entry FIFO cache (`transitionAssignments`) can skip it when coordinates are unchanged, so "two solves per attempt" is an upper bound; it recurs when the heading changes or the cache thrashes under load.

**Expected impact.** Reviewer, Mediterranean 500 with 52 factions: the phase took 6-11% of tick time; attempts rose from 5.6 to 29 per tick, up to 6.7 failures per tick, 99.4% retried on the next tick, p99 65-157 ms (contended). Hungarian at n=144 takes 13.6 ms; a full reorientation of 144 troops 12-38 ms.

- **Evidence:** `const formation=reorientedFormation(s,this.tick,facing),candidate={...s,formation}; if(this.emptyTransitionTerrain(…) || this.certifyFormationPolygon(…))this.squadEntities.updateOwned(s.id,{formation}); continue;`
- **Fix:** compute the assignment once (seed `assignmentPairs` from `reorientedFormation`), add a `reorientRetryTick` backoff (not `retryTick`, which columnDecision reads), and optionally an O(n log n) assignment for large n.

### Low

#### R2-P12. Large map fields are copied 2-3 times during generation and map construction (mapgen)
- **Where:** `src/skirmish/Elevation.ts:46`, `82-86`; `src/skirmish/Forest.ts:35` (reviewer cited 100); `src/skirmish/MigrationMap.ts:127`, `141`; `serverMatchWorker.ts:58-66`, `144-145`, `176`, `183-184`; `src/skirmish/worker.ts:105`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** ElevationField, SkirmishMap and ForestField all `slice()` their arrays; generators build `bare` and then `map`, and the server worker builds another SkirmishMap per SpawnSelection and Skirmish. These are deliberate defensive copies. `bare` stays alive through EnvironmentProfile during generation; two worker copies coexist from spawn selection until start, then steady state is one copy per thread. Typed-array buffers are off-heap, so the 384 MB `maxOldGenerationSizeMb` cap does not bound them. On the client, the main-thread map plus the worker copy remain.

**Expected impact.** At 2000 the suitability table is 32 MB per copy; elevation is Float32, so about 16 MB per copy (correcting the reviewer). Reviewer peak RSS about 500 MB at 2000 and 236-256 MB at 1000 (not reproduced). The worker cap held; low-memory browsers at 1000/2000 are at risk.

- **Evidence:** `this.values = data.values.slice();` and `bare = createSkirmishMap(size, size, terrain, elevation, forest),` … `map = createSkirmishMap(size, size, terrain, elevation, forest, resources);`
- **Fix:** an ownership-transfer contract would be needed to drop the copies; not otherwise proposed.

#### R2-P13. advanceTransfer rebuilds all air bases per transferring plane per tick (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1349` (rebuild), `1238` (per-tick map), `1352` (diversion)
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** The refactor fixed the pre-refactor `world.buildings.find` per aircraft (71 / 160 / 318 ms at 500 / 1000 / 2000 buildings with 1664 parked aircraft; now 1.2 ms all parked, 6.6 ms half airborne) by building one `aviationBases()` map per tick. advanceTransfer does not use it: it calls `aviationBases()` (all buildings and ships, allocating) for every transferring aircraft every tick. **Corrections:** the O(bases × A) diversion filter runs only when a plane must pick a destination, not every tick; concurrent transfers are capped by 32 aircraft slots per faction; and the reviewer's ms increases include anti-air firing at the airborne planes.

**Expected impact.** Reviewer: +2.6 ms for 50 transfers and +12 ms for 200 on desktop (confounded). Verifier microbenchmark of the rebuild alone: about 1.8-3.5 ms per tick at 200 transfers with 1000-3000 buildings.

- **Evidence:** `const transfer=a.transfer!,bases=this.aviationBases().filter(b=>b.playerId===a.playerId&&baseAccepts(b,a.definitionId));`
- **Fix:** pass the per-tick bases map (and optionally an occupancy map) into advanceTransfer; add a perf contract.

#### R2-P14. Anti-air squads scan all aircraft linearly every tick, even while reloading (air-strategic)
- **Where:** `src/skirmish/domain/Battle.ts:813-822`, `1223`; `src/skirmish/content/DroneSwarms.ts:4-9`; `src/skirmish/domain/Expansion.ts:948-955`, `1236-1237`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Each anti-air squad runs `aircraft.filter(...).sort(...)` over all aircraft every tick, before the reload check. A drone swarm creates 20 aircraft entities for 1 of 32 slots, so a faction can field about 640. The airborne SpatialGrid already built in advanceAircraft (`Expansion.ts:1236`) is not reused here. **Corrections:** homing-shell `aircraft.find` (`:1223`) is negligible (only naval-air-defence shells, living about 0.5 s); drones are transient (fuel or impact).

**Expected impact.** Reviewer: 10⁵-10⁶ checks per tick for hundreds of AA squads × thousands of aircraft (not measured). Verifier microbenchmark: about 22 ms per tick at 300 squads × 3000 aircraft; about 2-3 ms for realistic states.

- **Evidence:** `const target = aircraft.filter((a) => a.health > 0 && a.state !== "ready" && this.diplomacy.hostile(squad.playerId, a.playerId) && this.distance(squad, a) <= effectiveRange(...) ** 2).sort(...)[0]; if (target && tick >= (squad.nextAttackTick ?? 0))`
- **Fix:** check `nextAttackTick` before the filter; query the existing airTargets grid; an id→aircraft Map for homing lookups; optionally an entity cap for swarm members.

#### R2-P15. Aircraft and projectiles are re-sent in full in every packet (air-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1928-1937` (no revision), `1968-1969`; `src/skirmish/SnapshotCodec.ts:172-173`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** Part of round-1 P13: `aircraft` and `projectiles` have no metadata revision, so every encode copies both arrays, including parked "ready" aircraft. With no fog of war, enemies see `mission`, `atomicPayload` and the target point. **Corrections:** an array-level revision would bump on almost every packet because movers change every tick; per-entity deltas are the real fix. The mission/payload visibility follows from the game-wide absence of fog of war (one verifier: an information leak separate from bandwidth; the other: a design choice, not a defect).

**Expected impact.** Reviewer: about 14 compressed bytes per moving aircraft per packet; 1664 aircraft add 31 KB per packet, about 155 KB/s per client at 5 packets/s. Realistic (tens to a couple of hundred aircraft; 1664 needs about 277 airfields): about 0.5-3 KB per packet. Byte figures not reproduced.

- **Evidence:** `if(full || revision===undefined || this.metadataRevisions[key]!==revision)Object.assign(output,{[key]:source[key]});`
- **Fix:** per-entity journal rows or deltas that skip idle "ready" aircraft and send compact position rows; optionally strip target and mission for non-owners.

#### R2-P16. The AI candidate scan and sleep key spend budget on eliminated players (popup-spec)
- **Where:** `src/skirmish/domain/AiOperations.ts:406-410`, `309`, `325-326`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach refuted/high · repro kept/high (low)

**What happens.** Relates to round-1 P25 and to round-1's refuted "Candidate scan indexes world.players by a numeric cursor" (that refutation covered only correctness). The loop charges `this.work++` before skipping eliminated, own or ineligible rivals (global cap 16 reads per tick, 4 per slice), and `ageKey` covers every player and every force count, so any change breaks every AI's peace sleep. **Correction:** the roster is fixed at construction (`Simulation.ts:1024`, `1102`) and capped at 64, so the cost is bounded and does not grow with match age today; the reach verifier refuted it on that basis. It becomes medium once pop-up factions append ids mid-match (the popup-spec plan).

**Expected impact.** Today at most about 16 slices per full scan. Repro with appended eliminated players: 4 players → 1 tick / 4 reads; 52 → 13 ticks / 148 reads; 100 → 25 ticks / 292 reads.

- **Evidence:** `while (r.cursor < world.players.length && this.work < 16 && slice++ < 4) { const rival = world.players[r.cursor++]; this.work++; … if (rival.id === player.id || rival.eliminated || …) continue;`
- **Fix:** keep a liveRivalIds list from the lifecycle bus, store cursors as ids, and leave eliminated players and pop-ups out of ageKey.

#### R2-P17. The full player list, including eliminated factions and private values, is sent every publication (popup-spec)
- **Where:** `src/skirmish/SnapshotCodec.ts:390`; `src/skirmish/client/FactionColors.ts:42-49`, `77-80`; `src/skirmish/client/TerritoryLayer.ts:80-88`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** Part of round-1 P13: `players: source.players.map(p => ({...p}))` runs on every packet and carries every faction's gold, reserves, reserveRemainder and base tile. **Corrections:** players are never added mid-match and ids are capped at 64, COLORS/RGB are already pre-sized, and the colour roster key stays the same after construction, so the full territory repaint happens once on the first snapshot, not on every spawn. One verifier notes that ExpansionSnapshot already broadcasts inventories, progression and production for every player, so the values expose nothing new in a game with no hidden-information model.

**Expected impact.** Reviewer: 52 players 13,396 B JSON / 1,686 B gzip; 68 players 17,797 B / 1,930 B (68 is not reachable today); identity fields alone 971 B gzip. About 14 KB/s per client at 8 Hz.

- **Evidence:** `players: source.players.map((p) => ({ ...p })),`
- **Fix:** a revisioned roster plus live-only standings sent as deltas; keep other factions' gold and reserves out of the broadcast.

#### R2-P18. Measured AI cost per pop-up: squad count dominates, and round 1's "+10% at 6 pop-ups" had no basis (popup-spec)
- **Where:** `src/skirmish/Simulation.ts:4888-4965` (gate at `4960-4962`; anchor `4965` per repro verifier, reviewer cited 4961); `src/skirmish/domain/Diplomacy.ts:125-130`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach refuted/medium (low) · repro kept/medium (low)

**What happens.** Informational. thinkAi runs every tick for every AI player and the per-player body runs almost every tick once a faction has 6 or more squads (`decisionInterval` = 6 ticks), so AI cost scales with squad count. The probe (Migration 500, seed 1272661902, 52 AI-controlled factions) reproduced exactly on re-run: squad counts and `hostile()` call counts matched the original. **Corrections:** the "ai" diagnostic phase also contains `movementLand`; thinkAi alone is 6.9-9.8% of the tick; the ARM factor and the PLAN.md extrapolations are not derived in the probe; the probe had 0 declared wars, so pop-up war rows' effect on `declaredWar`'s linear scan is unmeasured; 4 nomads × 10 squads is about 40 squads, not 50. The reach verifier refuted it as a capacity estimate for an unimplemented feature, not a defect.

**Expected impact.** Measured: AiOperations 0.05-0.10 ms per AI record per tick (verifier: 0.053-0.144), thinkAi 0.011-0.016 ms per AI squad (verifier: 0.010-0.028, rising over the match), AI phase 10-12.6% of the tick, `Diplomacy.hostile` 11-22k calls per tick late game (3-16k across the run). Derived: 6 pop-ups add about 1 ms of AI (about 4% of the AI phase); the reviewer's +2-4% of the whole tick is disputed (a verifier computes about 0.5% of a 200 ms tick). PLAN.md's 20 nomads at cap 10: +12-28 ms per tick; at 40 squads each: +50-110 ms (unsupported extrapolations).

- **Evidence:** `const policy = this.expansion?.operations.enabled(player); if(!develop && (policy || …) && !own.some(s=>(this.tick+s.id)%decisionInterval===1))continue;`
- **Fix:** none; planning input for the pop-up spec.

#### R2-P19. SkirmishStance evaluates 8 states per tick globally after walking every skirmish-army member (ai-tactics)
- **Where:** `src/skirmish/domain/SkirmishStance.ts:169-185`; `src/skirmish/content/TacticalRules.ts:52`, `54`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Each tick, `step()` walks every non-hold skirmish-posture army's members and calls `eligible()` before `states.has()`, so registered squads are re-checked every tick. It then evaluates only `BUDGETS.skirmish` = 8 states per tick globally, and stale hold or suppressed states still consume slots. The AI already assigns skirmish posture (`AiArmyPlanner.ts:468`). **Correction (reach):** the 4 s cooldown and 4/min cap mean the withdrawal rate is mostly unaffected; the real effects are late starts and squads staying in "withdrawing" (army slot control suppressed via advisoryMovement) until their next visit.

**Expected impact.** About 300 ranged in skirmish posture at the 52-faction target means each is visited about every 4.7 s, against reload windows of 2.5-12 s. Not measured.

- **Evidence:** `for (let n = 0; n < Math.min(BUDGETS.skirmish, ids.length); n++) { const id = ids[this.cursor++ % ids.length]`
- **Fix:** check `states.has` before `eligible()`; register states on army-posture/army-members changes; skip suppressed and hold states; finish a withdrawal when the tick passes `state.until`; raise the budget.

#### R2-P20. Engage re-sends the identical army move every 2 s when the objective is unchanged (ai-tactics)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:492-495`, `557`; `src/skirmish/domain/Armies.ts:638-644`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** The condition `plan.targetTile !== objective.tile || members.every(hold)` stays true while a deferred move is pending (squads keep "hold" until the cohort commits), after an asynchronous rejection (which leaves member orders and army state untouched), and after arriving at an uncaptured objective. Every think re-issues the move, and each re-send calls `cancelPlanning`, superseding the in-flight leader and cohort admission. Under heavy route load this can stop the army from ever setting off. **Correction:** re-sends do not pile up against the 128 cap (at most one admission per army), so starving human admissions is not credible. Related to R2-H3.

**Expected impact.** The siege scenario logged 31 `army-order:move` re-sends in 60 s; one new exact route search every 2 s per stuck AI army.

- **Evidence:** `if (objective && (plan.targetTile !== objective.tile || members.every(s => s.order.type === "hold"))) { if (this.order(plan, {type:"move",tile:objective.tile})) {`
- **Fix:** skip the re-send while the army has pending planning or is already at the objective.

#### R2-P21. The client's per-publication cost is dominated by the structured clone of the full entity view (load-test)
- **Where:** `src/skirmish/client/multiplayerStateWorker.ts:34`, `99-103`; `src/skirmish/client/CanonicalStateStream.ts:141-146` (reviewer cited 133); `src/skirmish/multiplayer/application/ClientStateFlow.ts:17-27`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Re-measures round-1 P1. `presentationState()` spreads the whole decoded entity snapshot into the view and postMessage structured-clones it; only the tiles buffer is transferred. The clone scales with total squads, not changed rows. **Corrections:** the cost is the implicit postMessage clone, not an explicit structuredClone at line 133. While the main thread is still presenting, the worker takes the `presentation === false` path and skips the clone, and flow credit is acked on canonical apply (`OnlineMatchSession.ts:411`, `458-466`), so the effect is dropped or late frames, not exhaustion of the 4-frame window and the round-1 H1 baseline loop. Self-limiting.

**Expected impact.** Reviewer replay of 3000-3950 real publications: decode 5.4-6.2 ms, apply 5.5-6.3 ms, presentationState 0.03 ms, clone 25-29 ms (scales with about 1100-1250 squads, not 255-334 changed rows); total 37-40 ms per publication (p99 54 ms), about 255-260 ms of CPU per second at 6.5 Hz; about 650 ms/s on a laptop 2.5× slower (extrapolated). About 12-15 ms of that is main-thread deserialisation per presented frame.

- **Evidence:** `const state = stream.presentationState(); self.postMessage({ …, ...state, … }, { transfer: [state.view.tiles.buffer] });`
- **Fix:** send changed entity rows, or use the packed presentationPacket path with transferables.

#### R2-P22. Metadata JSON is 69-74% of every raw publication (load-test)
- **Where:** `src/skirmish/multiplayer/StateCodec.ts:345-352` (stringify), `~434` (parse); `src/skirmish/SnapshotCodec.ts:173` (reviewer cited 166); `src/skirmish/domain/Expansion.ts:1935-1943`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Supports round-1 P12/P13 (02 N3/N4). The measured "metadata" is StateCodec's whole JSON envelope: every SnapshotPacket field that is not a typed array. **Corrections:** it is not `selectMetadata`'s output, which already sends revisioned keys as deltas; the recurring bulk is the unrevisioned expansion keys (armies, inventories, production, recruitment, activeOffensives, projectiles, aircraft, tradeSites, tradeEnemies, winners…) plus per-tick players and details. The share is the same in idle runs (68-70%), so it is not specific to 8 humans.

**Expected impact.** 384-416 KB of metadata in 519-601 KB of raw payload (verifier means: med-humans 416,321 of 600,889; mig-humans 383,925 of 518,517). Gzip brings it to 51-65 KB on the wire, so it is not the bandwidth driver, but it is a large share of server stringify, client JSON.parse and the full-view clone.

- **Evidence:** `const metadata = diagnostics.measure("json", () => enc.encode(JSON.stringify({ value: valueTree, lengths: … })));`
- **Fix:** revisions and deltas for the unrevisioned keys (02 N3/N4) ahead of interest management.

#### R2-P23. CavalryAssaultMotion re-plans every rider of a squad in one frame (client-unread)
- **Where:** `src/skirmish/client/troops/CavalryAssaultPresentation.ts:489-490`, `509-526` (reviewer cited 518), `96-165`; trigger `src/skirmish/domain/Battle.ts:989-992`
- **Severity:** low (reviewer: medium; reach verifier: medium)
- **Votes:** code kept/high (low) · reach kept/high (medium)

**What happens.** `sample()` re-plans all riders when the contact moves more than 0.5 tile, turns, changes penetration or shrinks, or after a tick gap over 16 ticks. `planPass` builds two CavalryRidePaths per rider, each with 64 samples per cubic piece plus four extra one-sided curvature Bezier evaluations and a `Math.max` over slices. The server rewrites the contact geometry on every committed melee hit (R2-P3), so this fires once per material change per squad, plus the first plan of each new assault; it is not continuous. Detailed rendering of visible squads only.

**Expected impact.** Reviewer (contended): 6 riders median 2.3 ms (max 29), 30 riders 12.5 ms (max 57), 60 riders 23.5 ms (max 56), first plan for 60 riders 52 ms; steady frames 0.04-0.2 ms. Verifiers: 2.5 / 9.4 / 17.5 ms median at 6 / 30 / 60 riders (max about 40); 19 ms median (max 36) at 64 riders. The reviewer's 50-150 ms spike needs several large squads re-planning in the same frame.

- **Evidence:** `const changed = Math.hypot(a.x - frame.x, a.y - frame.y) / FIXED > 0.5 || … ; if (jumped || changed) { rider.pass = planPass(…`
- **Fix:** re-plan at most K riders per frame, use cheaper curvature tables (which also help the first plan, which a K-limit does not), and raise the change threshold.

#### R2-P24. HudView compares escaped markup against serialised innerHTML, so some cards are rewritten on every update (client-unread)
- **Where:** `src/skirmish/client/HudView.ts:43-50`, `448`, `568`, `572-573`, `610`, `613-621`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** `escape()` emits `&#39;` and `&quot;`, but innerHTML serialisation prints those characters raw in text nodes (Chrome 152 confirmed), so the guards never match for content with quotes or apostrophes. An open tooltip or selection card is re-parsed every HUD update (about 8 Hz), followed by forced layout from offsetWidth reads. **Corrections:** the cited 38 content descriptions with apostrophes (russian-recruitment.json) do not appear to reach HUD cards; strings that do include build-action rejections ("Research this building's technology first", `Expansion.ts:357`), player and faction names in enemy squad subtitles (for example "K'iche'"), and Simulation rejection text. Wider than claimed: every resource-kind card always fails too, because resourceIcon's self-closing `<path/>` serialises as `<path></path>`.

**Expected impact.** A small fragment re-parse plus forced layout at about 8 Hz, only while a tooltip, deposit hover or selection card is visible. Not measured.

- **Evidence:** `if (tooltip.innerHTML !== markup) tooltip.innerHTML = markup;`
- **Fix:** compare against a cached last-markup string per element, as `ResearchOpportunitiesView.ts:73-84` does.

#### R2-P25. Active placement preview re-diffs every retained chunk and JSON-stringifies all barriers on each publication (client-unread)
- **Where:** `src/skirmish/client/PlacementPreview.ts:189-201` (stringify; reviewer cited 193), `243-290` (chunk diff), `292-336` (troop diff); `src/skirmish/client/Renderer.ts:422`, `1206`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** While a build type is active, `update()` stringifies every live barrier with its tiles plus alliances, compares 256 owner cells (plus fringe) per retained chunk against the full `snapshot.owners` without using `changedTiles`, and diffs the troop-tile set over all squads. Visible chunks are never evicted, so at fitScale on 1000×1000 all 3969 chunks are retained. **Correction (reach):** the chunk ownership diff dominates, not the barrier stringify. **Correction to the fix:** `fortificationRevision` is not bumped when a barrier's health reaches 0 (`updateBarrier` does not reindex) and does not cover alliances, so a cheaper key still needs those components. Only while placing.

**Expected impact.** Verifier standalone benchmark of the chunk loop: about 15 ms per publication (about 120 ms/s at 8 Hz) at 3969 chunks; barrier stringify about 0.3 ms even with 12k wall tiles. The reviewer did not measure it.

- **Evidence:** `JSON.stringify(snapshot.expansion?.barriers.filter((b) => b.health > 0).map((b) => [b.id, b.playerId, b.kind, b.tiles]) ?? [])` and `for (const [key, chunk] of this.chunks) { … snapshot.owners[this.map.ref(x, y)] …`
- **Fix:** diff only `snapshot.changedTiles` when present, keeping the full scan for solo snapshots; key barrier geometry on a revision that also covers health-zero and alliances.

#### R2-P26. Up to 10,000 buildingIds are checked with Array.includes per building (command-fuzz)
- **Where:** `src/skirmish/Simulation.ts:2473-2474` (reached from recruit `1779` and recruitShip `2551`); `src/skirmish/domain/Expansion.ts:975-978`; `src/skirmish/multiplayer/CommandSchema.ts:92-132`; `src/skirmish/domain/CommandPolicy.ts:44`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** The schema and policy allow 10,000 buildingIds on recruit, recruit-ship, recruit-aircraft, repair and cancel-recruitment. `automaticRecruitmentBuilding` and `recruitAircraft` filter with `buildingIds.includes(b.id)`. **Correction:** the scan covers only the sender's own buildings of the requested type (`buildingIndex.byType(playerId, type)`) or matching air bases, not all buildings in the match. cancel-recruitment already uses a Set and upgrade-building is capped at 200, as precedents.

**Expected impact.** Reviewer: about 4.3M comparisons per command at 430 buildings, up to about 0.2-0.4 s/s at 50 req/s across 8 seats. Verifier benchmark: 0.2-0.5 ms per command at 20-50 same-type buildings (about 80-200 ms/s across 8 seats at 400 commands/s), 4.2-4.5 ms only at 430 buildings of one type. Comparable to the existing zod parse of a 10,000-id array.

- **Evidence:** `this.buildingIndex.byType(playerId, type).filter(b => (!buildingIds || buildingIds.includes(b.id))`
- **Fix:** build a Set once per command, and cap buildingIds at 1,024.

#### R2-P27. The amphibious hierarchy is built eagerly but never warmed in live config, and is missing from residency diagnostics (movement-core)
- **Where:** `src/skirmish/Simulation.ts:800`, `804`, `3407-3412`; `src/skirmish/Pathfinding.ts:93-95`, `317-324`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:96`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Every ages-v1 match builds an AmphibiousPaths with its own HierarchicalPaths. The amphibious corridor gate is Infinity unless `autonomousRouteDeadlineTicks === secondsToTicks(2)`, which live config never sets, and live warming covers only land and water. Diagnostics report only land and water residency. **Corrections:** it is not unusable: synchronous `find()` calls for routes over 48 tiles (Armies.ts:646, 998, 1055-1065) use it, and shared preparation is checkpointed. Skipping it would push those finds onto uncapped full-map A*, a regression; a lazy build must happen before `restoreSharedPreparation` (`Pathfinding.ts:220`). The 16 B/tile scratch arrays also back uncapped `findExact` from `find()`/`search()`, not only the 2,048-capped call, so a hashed workspace is questionable.

**Expected impact.** Reviewer: 1.3 / 2.8 / 6.0 / 13.3 MB of JS heap on Med500 / Mig500 / Med1000 / Mig1000, plus 0.09-0.39 s of construction (Mig1000 13.3 MB and 387 ms confirmed from the logs); all three graphs keep 16 B/tile of scratch arrays (48 MB on Mig1000).

- **Evidence:** `if (options.ruleset === "ages-v1") this.amphibiousPaths = new AmphibiousPaths(map, false);` and `amphibious: options.autonomousRouteDeadlineTicks===secondsToTicks(2) ? water+ticks(this.amphibiousPaths) : Infinity`
- **Fix:** build the amphibious hierarchy lazily on first use (handling restore), and add `amphibiousPaths.residency` to diagnostics.

#### R2-P28. The formation template cache key includes seed%16 for shapes that ignore it (movement-core)
- **Where:** `src/skirmish/domain/FormationGeometry.ts:688-699` (key; reviewer cited 689), `367-371`, `715-722`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** The template key includes `seed % 16` for every shape, but `buildSlots` reads the seed only for mass and modern-loose jitter, so line, column, square, wedge and shield-wall templates are stored up to 16 times. Every caller passes the squad id. **Correction:** the 512-entry cache is FIFO, not LRU (hits never refresh entries), which makes the churn somewhat worse. The overall hit rate stays about 97-99%.

**Expected impact.** The cache fills at about tick 2,800 with 52 factions; cumulative misses then go 1,196 → 15,605 (Med500) and 2,222 → 12,308 (Mig500), 5-16 misses per tick. Miss cost: line 0.026 ms, mass 0.25 ms; a hit is 0.004 ms. All 768 calls for line across 16 seeds missed. Roughly 0.5-4 ms per tick late game.

- **Evidence:** key `[count, shape, d.spacing, d.mounted, d.bodyWidth, d.bodyDepth, \`seed % 16\`, frontage, doctrineTemplateId(d)].join(':')` and `if (shape === "mass" || shape === "modern-loose") { const hash = (seed * 1664525 + i * 1013904223) >>> 0; …`
- **Fix:** key the seed only for jittered shapes, raise the cap to 2,048, and consider refreshing entries on hit.

#### R2-P29. Water backbone reuse checks only the start side; a goal-side failure is late and deletes the backbone (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:808`, `937-939`, `1074`, `811-815`; `src/skirmish/RoutePlanner.ts:752`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Backbones are keyed `startCluster:goalCluster:revision`; before reuse only `backbone[0]` is tested against the start tree. If the goal cluster's water is split, the last portal may not reach this goal: the corridor refines the whole path, fails at the segment step, deletes the backbone and falls back to exact search with no corridor retry; the next query rebuilds it. **Correction:** the fail-delete counter counts every `fail()` while a backbone exists, including validate (dynamic blocked tiles, `1101`), across mismatch (`1044`/`1047`), revision mismatch (`858`) and capacity limits (`834-837`), so it is an upper bound for the goal-side case. Correctness is unaffected.

**Expected impact.** Mig500: 3 fail-deletes in 67 lookups (14 in 509 by tick 2800), as an upper bound.

- **Evidence:** `if (backbone && tree.cost[this.index(this.clusters[startCluster], this.portals[backbone[0]].tile)] !== INFINITY) {`
- **Fix:** before reuse, check that the goal side is reachable (the last portal's crossing tree reaches the goal, which may not be prepared yet), or tag the backbone with the goal's water component; consider not deleting the backbone on a dynamic validate failure.

#### R2-P30. Any cost change anywhere cancels every in-flight corridor on that graph (movement-core)
- **Where:** `src/skirmish/HierarchicalPaths.ts:854-855`; `src/skirmish/Pathfinding.ts:57`, `226`; `src/skirmish/RoutePlanner.ts:751-752`, `779-788`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** `step()` fails any unfinished corridor whose revision differs from the graph-wide `costRevision`, which every forest change bumps, although HierarchicalPaths already tracks per-cluster revisions and drops only the touched clusters' portal trees. A cancelled job falls back to the budgeted exact search and does not retry the corridor; the fail path also evicts the shared water backbone. No correctness impact. **Correction to the fix:** recording only the final chain's clusters is not enough; the start and search phases have no chain yet, and the abstract search expanded other clusters too.

**Expected impact.** Mediterranean 500: land revisions changed 45-106 times per 400 ticks, yet only 1 of 219 corridors was cancelled (about 0.5%), because corridors usually finish in 1-2 ticks. Exposure grows with slower corridors (big maps, saturated budgets).

- **Evidence:** `if (s.revision !== revision && s.phase !== "done" && s.phase !== "failed") fail();`
- **Fix:** record the revisions of every cluster the corridor has used or expanded, and fail only when one of those changes.

#### R2-P31. geometryKey still includes charge.phase although slots no longer depend on it (movement-core)
- **Where:** `src/skirmish/domain/FormationGeometry.ts:121-143` (phase at `129`, `140`, `143`), `175-180`; `src/skirmish/domain/CombatGeometry.ts:28`, `43`; `src/skirmish/LandingOccupancy.ts:20`; `src/skirmish/UnitIndex.ts:140`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** The working tree removed the charge-wedge override from `shapeOf`, so charge phase no longer affects slots or envelopes, but `geometryKey` and `physicalKey` still include `s.charge?.phase`. Every charge transition re-keys the envelope cache and the physicalGeometryKey consumers (FormationContact `300`/`503`, CombatGeometry, LandingOccupancy, UnitIndex `212`), forcing a full envelope build instead of reuse. CombatGeometry and LandingOccupancy also check `charge===s.charge?.phase` themselves, so dropping it from geometryKey alone only partly helps; UnitIndex records `chargePhase` separately.

**Expected impact.** A few extra envelope rebuilds per charging squad per charge; not per tick. Not measured.

- **Evidence:** `s.charge?.phase,` (FormationGeometry.ts:140) and `const key=values.join(':'),physicalKey=values.filter((_value,index)=>index!==4).join(':');`
- **Fix:** drop the phase from the key and from the CombatGeometry and LandingOccupancy guards, after checking any client `envelope.revision` consumer.

#### R2-P32. Explicit naval attacks re-plan with a synchronous LOS scan and A* every 3 s per ship (naval)
- **Where:** `src/skirmish/Simulation.ts:2857-2894` (reviewer cited 2858); `src/skirmish/domain/Expansion.ts:712-714`; `src/skirmish/domain/AiNavalBombardment.ts:198-217`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** An explicit attacker that is out of range or has no legal shot re-plans every 3 s, including while already sailing (there is no destination guard), scanning a (2·extent+1)² box (extent 12 at Modern: 625 tiles, of which about 450 lie inside the circle), then calls `waterPaths.find` synchronously with a 4096-node budget, bypassing ShipMovementAdmission. All ships from one order re-plan on the same tick (`lastPlanTick = -60`). **Corrections:** structureAim runs only on water-connected circle tiles closer than the current best and checks one footprint tile (about one 14-tile segment walk); the AI bombardment scenario is unlikely, because AiNavalBombardment certifies every shooter's shot before issuing naval-attack and sends stop-ships when it is lost. Practical triggers: a human mass naval-attack on a structure behind walls, or chasing an out-of-range enemy ship. The water finds at `2739` and `3120` are also synchronous.

**Expected impact.** Reviewer: up to about 20k structureAim calls per 3 s for an 8-32 ship blocked bombardment (not measured). Verifier: about 450 short segment walks per ship per 3 s, about 200k simple tile checks for 30 ships, in a spike every 24 ticks.

- **Evidence:** `if (this.distanceSquared(ship, p) > range ** 2 || !legalShot) { if (this.tick - (ship.lastPlanTick ?? -60) >= secondsToTicks(3)) {` … `path: this.waterPaths.find(this.tileOf(ship), goal, undefined, 4096) ?? []`
- **Fix:** not proposed explicitly. The gaps the verifiers named are the missing destination guard and the synchronous find that bypasses ShipMovementAdmission.

---

## Refuted during verification

These 17 findings were refuted by a majority of verifiers. They are listed so the owner can see what was considered.

| Area | Title | path:line | Why refuted |
|---|---|---|---|
| tree-delta | Aircraft restore has no validator; a transferring plane without transfer bombs its destination | `src/skirmish/domain/Expansion.ts:174` | Every writer keeps state "transferring" and `transfer` together (602-604, 1268, 1360); checkpoints are structuredClones of that state, and no live path restores client-supplied aircraft. At most a hardening note. |
| air-strategic | Aircraft lost with their base, and expiring drones, are not recorded as military losses | `src/skirmish/domain/Expansion.ts:1268` | `recordMilitaryLosses` keeps only completed cities (Simulation.ts:1963-1971, deliberately excluding aircraft), and no aircraft loss counter exists, so adding the call would record nothing. |
| air-strategic | Floating-point trigonometry in authoritative patrol orbits and flight steering | `src/skirmish/domain/Expansion.ts:1302` | Server-authoritative with no lockstep re-simulation or hash comparison; restore resumes from stored integer positions; positions are rounded each step; float math is the accepted design across about 236 sites. |
| air-strategic | IN-FLUX: carrier-based aircraft have no ground presentation | `src/skirmish/client/AircraftGroundPresentation.ts:48` | CarrierAircraftPresentation handles carrier aircraft and is asked first (Renderer.ts:253), giving a parked deck pose. The AI remarks are design choices. |
| popup-spec | Player-id range exhausted and id-indexed structures disagree on the bound | `src/skirmish/FactionAdjacency.ts:7` | Players are created only at construction, ids are capped at 20+14+30 = 64 = MAX_PLAYER_ID, and no nomad code exists; a design note for the pop-up feature. |
| popup-spec | deployPlayer mutates world state before a throwing placement check | `src/skirmish/Simulation.ts:1114` | Only the constructor calls it, so a throw means the Skirmish is never built; every base is pre-validated by the same `startingCamp` with the same radius 6. |
| popup-spec | New faction kinds silently inherit nation/tribe rules at ~12 sites | `src/skirmish/domain/AiOperations.ts:101` | `Player.kind` is the closed union "regular" \| "tribe" and nothing creates another kind; a design note for a future kind. |
| popup-spec | Ships do not count for survival: a ships-only pirate faction is eliminated on its first tick | `src/skirmish/Simulation.ts:5449` | No pirate or ships-only faction exists; excluding fleets is deliberate and tested (TradeFleet.test.ts:83-88); already tracked in 14-popup-factions-spec.md (P5). |
| popup-spec | Prizes captured by an owner without a market never complete | `src/skirmish/domain/Trade.ts:445` | Intended wait-for-receiver design: a new owned port wakes the prize, which delivers full value (TradeFleet.test.ts:431); pirates and nomads do not exist. One verifier kept it as a low balance note. |
| popup-spec | Faction-name roster throws on deck exhaustion and has no pop-up decks | `src/skirmish/domain/FactionRoster.ts:79` | The roster is local to construction; at most 14 regular and 30 tribe draws from decks of 224 and 241; nothing draws during `step()`. |
| load-test | Human admissions never expire or coalesce: 33-45% of human planning work is superseded | `src/skirmish/Simulation.ts:944` | A replacing human order cancels the old admission and its planner jobs synchronously (MovementAdmission.ts:337 → 246 → 229, RoutePlanner.ts:503); only bounded workspace reclamation remains. The counts measure order churn. |
| client-unread | TechnologyViewModel recomputes all trees on every access and has a latent reduce-on-empty crash | `src/skirmish/client/TechnologyViewModel.ts:31` | `validateTechnologies()` runs at module load and throws unless every age × tree has at least one required node, so the empty case cannot reach render; the recompute is a perf nit. |
| client-unread | Lab: battleDefinition silently drops tuning.attack for split-channel units; draft rankLaunchSpacing defaults disagree | `src/skirmish/client/lab/BattleTuning.ts:105` | No caller produces an attack patch for split units; an absent spacing replays at 0.25, not 1; the revision relabel is a tested, deliberate migration. |
| client-unread | AircraftGroundPresentation berth assignment is unbounded while the apron draws six berths | `src/skirmish/client/AircraftGroundPresentation.ts:81` | Every path that puts an aircraft on a base enforces `airfieldCapacity` 6, so slots stay in 0-5; carrier aircraft never go through this class. |
| command-fuzz | Army planning cap rejection cancels the army's existing pending plan | `src/skirmish/domain/Armies.ts:639` | `cancelPlanning` removes the army's own leader plan first, so a full map drops to 127 and the new order is admitted; the cap can only reject an army with no pending plan. |
| movement-core | CohortAdmission.start refuses at 128 pending before superseding the caller's own plans | `src/skirmish/domain/CohortAdmission.ts:100` | Both Armies callers cancel or skip the army's existing cohort before `start`, so the supersede loop never has anything to supersede. |
| movement-core | withinShoreline fails open on NaN or degenerate polygons | `src/skirmish/domain/ShorelineTolerance.ts:55` | Production calls pass softDepth 0, so it returns false at line 43 first; a NaN polygon already fails open earlier in `certifyFootprint` (FormationContact.ts:592-597, 620), which is where any hardening belongs. |

---

## Unverified

None. All 89 findings got a verdict from at least two verifiers.
