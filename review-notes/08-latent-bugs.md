# 08 — Latent bugs and technical findings (verified ledger)

## How these were verified

Thirteen area reviewers produced **112** technical findings: bugs, determinism, security and perf. The areas were structure, network, server-lifecycle, combat, ai-strategic, ai-economy-naval, simulation-perf and client, plus four sweeps (simulation, ownership, determinism, working tree).

Two independent verifiers checked each finding:

- **code**: does the code path do what the claim says?
- **reach**: can a real match get into the triggering state?

When those two disagreed, a third **repro** verifier ran the scenario.

Status meanings:

- **confirmed**: the majority did not refute it, and at least one verifier kept it with medium or high confidence.
- **plausible**: kept only with low confidence.
- **refuted**: the majority refuted it.
- **unverified**: the verifiers failed to complete.

Other conventions:

- Severities are the **verified** severities. Where the reviewer's severity was different, the entry says so.
- Line numbers use the verifiers' corrected lines where they gave one. The working tree has drifted about 10–20 lines from what the reviewers cited.
- Vote summaries read `lens: kept|refuted/confidence (that verifier's severity)`.

| | Count |
|---|---|
| Ledger findings | 112 |
| Confirmed | 88 ledger rows, merged into **81 entries** (40 bug/determinism/security, 41 perf) |
| Plausible | 0 |
| Refuted | 24 |
| Unverified | 0 |
| Confirmed entries by verified severity | high 6 (5 + 1 perf) · medium 31 (11 + 20 perf) · low 44 (24 + 20 perf) |

These duplicates were merged; each merged entry names both source areas:

- **M5**: network "Rate limit is applied after JSON.parse and Zod" + server-lifecycle "Rate limit evaluated after JSON.parse and zod parse".
- **M6**: network "match-state-resync has no cooldown" + server-lifecycle "Client-requested full baselines have no per-guest cooldown".
- **M10**: structure "Content compile step is manual and unguarded" + sweep-working-tree "Formation doctrine compiler rejects the new bronzeage-cavalry recipe".
- **L1**: ai-strategic "Eliminated nations leak army missions…" + ai-economy-naval "Elimination never releases a faction's AI economic state".
- **L18**: sweep-ownership "amphibiousFactions transport cache keyed only by research count" + the amphibiousFactions sub-claim of sweep-simulation "Fields outside checkpoint()".
- **L19**: sweep-ownership "Restore does not validate owners[] tile values" + the owner-validation sub-claim of sweep-simulation "Fields outside checkpoint()".
- **P1**: network "Browser main thread receives the complete entity set" + client "Main thread deserialises the full entity graph".
- **P35**: simulation-perf "stepWarships scans all buildings per repairing ship" + sweep-simulation "stepWarships scans all buildings per ship per tick".

"Confirmed" below holds the bug, determinism and security findings. Confirmed perf findings are under "Perf findings".

## Round 2 additions

The round-2 ledger is in [`08e-round2-ledger.md`](08e-round2-ledger.md): 89 findings, of which 71 were confirmed (merged into 69 entries: 2 critical, 4 high, 28 medium, 35 low; 32 of them perf), 1 is plausible, 17 were refuted and 0 are unverified. It re-confirms H3, M2, M10 and M11 and lowers H5 to medium.

---

## Confirmed

### High

#### H1. Every client recovery triggers another full baseline (network)
- **Where:** `src/skirmish/multiplayer/application/ClientStateFlow.ts:21-23` (the `recovering` branch of `offer()`), together with `LiveMatch.ts:889`
- **Severity:** high · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**The loop.**

1. `resync()` calls `flow.beginBaseline()`, which sets recovering=true and dirty=false. It then awaits a worker `client-baseline` request.
2. While it waits, publications keep arriving (onPublication → broadcast → sendState → `flow.offer`).
3. `offer()` refuses each one because `recovering` is true, and in doing so sets `dirty=true`.
4. `baseline()` only ORs `dirty`, so dirty stays set.
5. When the client acks the baseline, `applied()` returns `"baseline"` and `stateApplied` calls `resync()` again.

**Why the second baseline is wasted.** The worker runs every request on one promise chain, awaits `publications.flush()` before capturing, and posts publications and responses on the same port in FIFO order. So every publication refused during recovery already has tick ≤ the baseline tick. The `changedSinceCapture` argument (`LiveMatch.ts:907`) is effectively always false on this path.

**Extra damage while looping.** As long as dirty stays set, `offer()` also refuses every delta until the ack. A looping client gets only full baselines and no deltas.

**Cost per iteration.** A synchronous capture on the simulation thread, a full encode, and a full client decode and reset.

**Triggers.** A client-side pending overflow (`OnlineMatchSession.ts:136-139`), or a server-side 4-frame window overflow. The loop keeps going whenever at least one publication lands in the recovery window. With the 200 ms `SNAPSHOT_MS` cadence plus per-command publications, that is likely but not guaranteed on every iteration. A fake-executor repro produced 7 client-baseline requests from a single resync before hitting the loop cap.

**Tests.** `tests/skirmish/ClientStateFlow.test.ts:40-51` asserts this behaviour as intended. No LiveMatch test acks a rebased baseline.

- **Evidence:** `if (this.dirty || this.outstanding.length >= this.window || this.recovering) { this.dirty = true; return false; }` and `if(flow.applied(sequence,epoch)==="baseline")this.resync(guest);`
- **Fix:** when `offer()` refuses a frame only because `recovering` is true, it must not set dirty; the baseline captured after the flush already contains that frame. Update ClientStateFlow.test.ts:40-51, and add a LiveMatch test that acks a rebased baseline.

#### H2. Neutral (owner-0) towers become permanent, indestructible obstacles for every faction (sweep-ownership)
- **Where:** `src/skirmish/domain/Fortifications.ts:102-107` (`blocked`), with `src/skirmish/Simulation.ts:5463` and `5494-5495`
- **Severity:** high · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**How towers end up owned by 0.** checkWinner sets `recipient=0` in two cases:

- Under raids-v1 (the default, `LiveMatch.ts:147`), when the beneficiary cannot capture the victim.
- Under any rules, when `Conquest.beneficiary` returns 0: an uncredited defeat, or a credit chain that ends at an eliminated faction.

Surviving towers are then re-owned to 0.

**Why nothing can remove them.**

- `Fortifications.step` indexes every tower with health > 0, whatever its owner. `blocked()` returns true when `!allied(towerOwner, owner)`, and `allied(0,X)` is false for every X. So the tile blocks every faction.
- `canAttackStructure(a,0)` is false (because of `!!b`). So attack-structure, `Battle.attackStructure` and projectile structure damage all refuse the tower. Only indiscriminate bomb/icbm/warhead projectiles can damage it.
- `captureEligible` ends in `fortifications.clear(squad, tileCentre)`. That segment includes the destination tile, so the tower's tile can never be captured.
- TerritoryAbsorption skips pockets that contain buildings.
- No code removes or decays owner-0 buildings.

**Effect.** Permanent scars that block movement, army planning, construction and capture for every faction, and they accumulate over a long match.

**Not new in the working tree.** At HEAD, `changeOwner(tile,0)` already re-owned buildings on the victim's own land to 0. The working-tree loop at 5494 extends this to towers on fallout land.

**Reproduced** in a scratch script: the tower ends up owned by 0, blocked for players 1 and 3, attack-structure returns "Choose an enemy structure", and nothing changes after 30 s.

- **Evidence:** `canAttackStructure(a:number,b:number):boolean{return !!b&&a!==b&&this.canCapture(a,b);}` (Diplomacy.ts:40) and `if (!this.diplomacy.allied(towerOwner, owner)) return true;`
- **Fix:** in checkWinner, remove towers and walls (and call `fortifications.forgetBuilding`) when the recipient is 0. Alternatively, treat owner-0 towers as non-blocking and capturable in `Fortifications.blocked` and `captureEligible`. Add a test for an eliminated faction's surviving tower.

#### H3. A charge with off-map coordinates throws in map.ref; one packet ends a live match for everyone (sweep-simulation, security)
- **Where:** `src/skirmish/Simulation.ts:1301-1302`
- **Severity:** high · **Kind:** security
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**When the branch runs.** The charge pre-check fires when any squad listed in `squadIds` is a non-cavalry squad in column or leaving column. Ownership is never checked, so an enemy squad marching in column is enough.

**What it does.** If `fallbackOrder` is an attack on a target id that no longer exists, it converts `command.x/y` with `this.map.ref(floor(x/256), floor(y/256))`.

**Why nothing catches the bad input.**

- The wire schema only bounds x/y to ±1,000,000, and `commandRejection` has no upper bound.
- This branch runs before `expansion.command`, so Expansion's own charge validation never runs.
- `GameMap.ref` throws on off-map coordinates.

**How the throw ends the match.** `CommandApplications.apply` is try/finally with no catch. The worker's catch posts `{error}`. `LiveMatch.scheduleTick` turns the rejected advance into `end("Match stopped: Invalid coordinates…")`. Any seated client can therefore end a live match for every player.

**Secondary issue (low).** "Deploy before charging" versus the fallback's own rejection text reveals whether an arbitrary squad id is in column.

- **Evidence:** `order:command.fallbackOrder.type==='attack' && !this.squad(command.fallbackOrder.targetId)?{type:'move',tile:this.map.ref(Math.floor(command.x/FIXED),Math.floor(command.y/FIXED))}:command.fallbackOrder`, plus GameMap.ts:167-170 `` throw new Error(`Invalid coordinates: ${x},${y}`) ``
- **Fix:** restrict the column check to squads the player owns. Clamp or reject off-map x/y before `map.ref` (or in `commandRejection`). Consider turning per-command exceptions into rejections instead of ending the match.

#### H4. The working tree introduces 12 skirmish test regressions, plus 1 admitted calibration failure (sweep-working-tree)
- **Where:**
  - Admitted failure: `src/skirmish/content/BalanceContract.md:115-119`.
  - Regressing sources, for example `src/skirmish/client/troops/TroopActors.ts:476`, and the retargeting path exercised by `tests/skirmish/FormationPerformance.test.ts:167`.
- **Severity:** high (reviewer: critical) · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (high)

**These are regressions, not old failures.** Eleven test files are unchanged from HEAD: Ages, AiLateGame, CombatPresentation, FlexibleFrontage, FormationPerformance (×2), FormationRepairContracts, PresentationTuneUps, ResponsiveGameplay, RiverExpansion, SoldierDetailMode, TechnologyDetails.

- Against the working tree, in isolation: 12 failed / 93 passed.
- Against a `git archive HEAD` extraction: 105/105 pass.

So the failures come from the uncommitted src/skirmish changes (45 files, +1737/−759).

**What kind of failures.**

- Clear code faults:
  - SoldierDetailMode: `snapshot.volleys is not iterable` (see L24).
  - FormationPerformance: `combatTargetId` becomes null after removeSquad instead of retargeting, and only 450 of 2000 squads are fighting.
- Value drift: reload 160 vs 100; ranged armour 68 vs 48; ResponsiveGameplay restore-vs-live sleep facts (see L22).

**Corrections to the reviewer's numbers.**

- PreModernBalance fails only 1 test (axemen survivors 39 > 33), and BalanceContract.md:115-118 already admits it. The Boyar assertion passes, so BalanceContract.md:89, which says it "currently fails", is stale.
- The full-suite count (~35 failed) includes about 20 load-induced timeouts that should not be counted.
- There is no CI config in the repo, and `npm test` excludes tests/skirmish (vite.config.ts:334). So it is `npm run test:skirmish` that is red, not CI.

- **Evidence:** working tree `Tests 12 failed | 93 passed (105)` versus HEAD extraction `Tests 105 passed (105)`.
- **Fix:** before merging, decide for each of the 12 regressions whether it is a code fault or an intended rebalance. Update expectations only where the change is deliberate, and correct BalanceContract.md:89.

#### H5. The AI's 100-kit troop reserve floor delays strategic payload production (sweep-working-tree)
- **Where:** `src/skirmish/domain/AutomaticProduction.ts:203`, `266-271`, `335-338`
- **Severity:** high · **Kind:** bug
- **Votes:** code: kept/high (high) · reach: kept/high (medium)

**What changed.**

- `troopTarget` changed from `max(context.ai ? 12 : 100, …)` to `max(100, …)`, so AI players now get the same floor.
- With aiDemand set, targets are no longer cleared but merged with Math.max, so the 100..600-kit floor survives.

**Why payloads stall.**

- The allocation sort ranks every equipment recipe ahead of every payload recipe (payloads have equipmentKind null).
- make-hydrogen, make-mirv and make-icbm are arms-factory recipes, so they compete with troop kits for the same producers.
- Every regular AI takes this path: DEFAULT_AI_POLICIES sets aiEconomy:true, and the AI never issues explicit produce orders for payloads.

Result: no payload job starts until kit stock plus kits in flight reach `troopTarget`. While recruitment keeps draining kits, that can mean never.

**What is diverted.** Production spends only the recipe's input items (`Supply.ts:52-56`, `456-460`). That means steel, gunpowder, oil, copper and tin are diverted, but not gold.

**Probe.**

- Inventory at the demand quote → `[[11,"make-modern-equipment"]]`.
- Equipment stock 1000 → `[[11,"make-hydrogen"]]`.

**Tests disagree.** `tests/skirmish/AiLateGame.test.ts:142` (unmodified) fails. Meanwhile AutomaticProduction.test.ts was edited to codify the AI floor. The design change looks half-finished.

- **Evidence:** `const troopTarget = Math.min(600, Math.max(100, troopCapacity * 3, Math.ceil(squadCount / 3)))`; at HEAD the floor was `context.ai ? 12 : 100`.
- **Fix:** either restore the AI exemption (12-kit floor, and `targets.clear()` under aiDemand), or deliberately change the payload-vs-kit ordering and update AiLateGame.test.ts:142 to match.

### Medium

#### M1. Every fleet mission aborts at a fixed 120 s deadline (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiNavalPlanner.ts:306` (deadline), `317-319` (check), `237-262` (abort)
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: refuted/medium (low) · repro: kept/high (medium)

**What happens.** The deadline is creation time + 120 s and is never extended. The deadline check runs before the port, bombard, assessment and patrol logic. So healthy patrols, interceptions and bombardments all end on a timer through `transition("abort")`. The abort releases routes, assets, lanes and the ledger, and sets `nextAssessment` to +20 s. `step()` then leaves that faction's naval AI idle until it releases the mission and runs `chooseTheater` from scratch.

**Repro.** A quiet single-ship patrol stays in stage/patrolling through t=115 s, aborts at exactly 120 s, sits idle for 20 s, and a new mission starts at 140 s.

**Verifier disagreement on stop-ships.**

- Reach: ship leases have `expiresTick = m.deadline`, and `AiEconomicDirector.step` runs `expireOwnership()` before `naval.step`. In the live tick order `owned` is therefore empty, no stop-ships is sent, and ships keep their last order.
- Repro: calling `planner.step` directly did send stop-ships.

Either way, the naval AI loses about 20 s of every ~140 s.

**Tests.** The abort itself is intended and tested (`AiNavalPlanner.test.ts:387-389`). The patrol test at `:166-178` only runs for 50 s, so it never reaches 120 s.

- **Evidence:** `if (world.tick >= m.deadline) { this.transition(m, "abort", "mission deadline expired"); return 0; }`
- **Fix:** extend `m.deadline` while the mission is making progress (a patrol leg completed, a contact still valid), or rotate healthy expired missions without the abort cooldown. Lengthen the patrol test past 120 s.

#### M2. One inconsistent mission makes stepMission release every mission the faction has (ai-strategic)
- **Where:** `src/skirmish/domain/AiArmyPlanner.ts:309-315` (release call at 313)
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**When it fires.** stepMission calls `this.release(player.id)` when a single mission has any of:

- no live members;
- no army, outside replenish/refit;
- a member whose lease belongs to another controller.

**What gets released.**

- The non-blocking invasion response. (Blocking responses are never stepped, because of the `runnable` filter.)
- Every other mission of the faction, each with a disband-army.
- The `byPlayer` entry.

**Ordinary combat triggers it.**

- `Armies.step` detaches casualties and auto-disbands an empty army.
- A higher-priority controller (defense, city-defense, emergency-defense) can overwrite an 'operation' lease, which produces a foreign lease.

**Effect.** missionCap goes up to 4, so one annihilated army can disband all of the faction's armies and discard their rally and advance progress. step() recreates missions on later passes, so the visible effect is repeated disband/re-select churn. Also, `runnable` is a snapshot, so sibling plans that were just deleted can still be stepped in the same tick.

The code already exists at HEAD. No test checks that sibling missions survive.

- **Evidence:** `this.release(player.id); return this.diagnostics.work;`, whereas lines 201 and 203 use the per-mission `this.releaseMission(plan)`.
- **Fix:** call `this.releaseMission(plan)` at line 313, matching lines 201 and 203. Add a test that releasing one mission leaves its siblings intact.

#### M3. After a human→AI handover, the human's armies are orphaned and never used (ai-strategic)
- **Where:** `src/skirmish/Simulation.ts:227-240` (setAiController); thinkAi skip at `Simulation.ts:5006`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**What happens.** On disconnect, `serverMatchWorker.ts:245-248` calls `setAiController(id,true)`. That bumps the generation and releases economy, operations and commandApplications state, but it never touches armies.

**Why the AI can't use them.**

- Every AI selector excludes army members: AiArmyPlanner.eligible:134, AiDefenseDirector:325, AiInvasionResponse:147-148, AiCoastPlanner:314, AiModernFronts:229, AiRecovery:184/276.
- thinkAi skips any squad whose `controllerOf` is not "none", and CommandPrecedence returns "army" for army members.

**Effect.** Each army finishes its current order and then holds. With autoTactics on it still fights locally through EngagementManager. But everything the human grouped is unavailable for AI re-tasking for the rest of the match.

**Context.** The reverse direction (AI→human) does disband AI missions. Keeping the armies is partly deliberate, per the comment at `Simulation.ts:226`: a reconnecting human gets intact armies back. No test covers this.

- **Evidence:** `if(controllerOf({armyOf:id=>this.expansion?.armies.armyOf(id),...},squad)!=="none")continue;` and `!this.expansion.armies.armyOf(squad.id) &&` (AiArmyPlanner.ts:134).
- **Fix:** after a handover, let AI planners adopt or disband orphaned armies, mirroring `AiArmyPlanner.releaseMission`. Don't clear them in setAiController, so the reconnect case keeps working.

#### M4. Recalling a control group leaves aircraft selected, so the next right-click sends a sortie (client)
- **Where:** `src/skirmish/client/main.ts:1146-1153` (recall branch of `controlGroup`)
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**What happens.** The recall branch replaces `renderer.selected` and `selectedShips` and nulls the building, inspection and deposit selections. It never clears `renderer.selectedAircraft`:

- `selectedAircraft` is a plain Set.
- `ControlGroups.UnitSelection` has no aircraft field.
- `Renderer.update` only prunes dead or foreign aircraft.

The right-click handler checks `selectedAircraft.size` first and returns after one of: transfer-aircraft, a sortie, or the "No ready selected aircraft" toast (`main.ts:1826-1842`). So the recalled group never receives the order. The formation drag gesture is also suppressed while aircraft are selected (`main.ts:1465`).

**Contrast.** selectAll (1175), the non-shift left-click (1691) and selectArmy (1989) all clear `selectedAircraft`. Both the keyboard shortcut and the HUD group buttons go through `controlGroup`. No test covers this.

- **Evidence:** the recall branch does `renderer.selected = members.selected; renderer.selectedShips = members.selectedShips;` with no `renderer.selectedAircraft.clear()`.
- **Fix:** add `renderer.selectedAircraft.clear()` to the recall branch, and add a client-controls test with a non-empty aircraft selection.

#### M5. Each frame is cloned, parsed and Zod-validated before the rate limit applies, and abusive sockets are never closed (network + server-lifecycle, security)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:245-247` (work done before the limit), `297-310` (limiter), `182` (maxPayload)
- **Severity:** medium · **Kind:** security
- **Merged:** network "Rate limit is applied after JSON.parse and Zod, and state receipts are exempt" (`:247`) and server-lifecycle "Rate limit evaluated after JSON.parse and zod parse of 512 KB frames; unlimited sockets per IP" (`:305`)
- **Votes:** network: code kept/high (medium) · reach kept/high (medium). server-lifecycle: code kept/high (medium) · reach kept/high (medium)

**Work done before the limiter.** Every frame, up to `maxPayload` 512 KB, first runs `rooms.snapshot()` (a structuredClone of the coordinator state) and then `clientMessageSchema.parse(JSON.parse(…))`. Only after that does the 50/s per-session window apply.

**Gaps in the limiter.**

- It only replies with an error. It never closes the socket (asserted by `CoordinatorServer.test.ts:104-117`).
- A Zod failure rebuilds a RoomCoordinator from the clone inside the catch, which is a second clone.
- Large frames of any type fail the `.strict()` schemas and never reach the limiter at all.
- Small valid match-state-applied and match-sync-applied frames are exempt from the counter.
- `authenticate` frames sent on an already-authenticated socket also bypass the counter.

**Before authentication.**

- Unauthenticated sockets get a 5 s window, and `trustedOrigin` accepts a missing Origin header.
- In ws 8.21, a socket that was closed for sending junk keeps emitting messages until the peer's close frame arrives or a 30 s timer fires.
- There is no per-IP socket cap anywhere: not in the code, nginx.conf or server.ts.

**Why it matters.** The simulation runs in per-match workers, but LiveMatch tick scheduling, command relay and snapshot fan-out all run on the coordinator's main thread. One flooding socket raises tick-dispatch lateness (the "scheduler" diagnostic) and delays publications for every concurrent match. This is availability only, and it is limited by the attacker's bandwidth.

**Correction.** Each guest can have only one authenticated socket, so authenticated sockets per IP are bounded by guest-token issuance (20/min/IP).

- **Evidence:** `let previousState = rooms.snapshot();` then `const message = clientMessageSchema.parse(JSON.parse(data.toString()));`, both before `if (!stateReceipt && ++session.count > 50) {`.
- **Fix:**
  - Enforce a bytes/s and frames/s budget per socket, and per IP before authentication, ahead of parsing.
  - Lower maxPayload toward the 100 KB command ceiling.
  - Close sockets after repeated violations.
  - Move the snapshot clone after the auth and limit checks.
  - Cap sockets per IP at upgrade.

#### M6. match-state-resync has no per-guest cooldown, so a client can make the simulation worker build full baselines back to back (network + server-lifecycle, security/perf)
- **Where:** `src/skirmish/multiplayer/application/LiveMatch.ts:891-896` (resync), `904-907` (client-baseline request; `recovering` cleared here)
- **Severity:** medium · **Kind:** security + perf
- **Merged:** network "match-state-resync has no cooldown" (security, `:891`) and server-lifecycle "Client-requested full baselines have no per-guest cooldown and block the simulation worker" (perf, `:904`)
- **Votes:** network: code kept/high (medium) · reach kept/high (medium). server-lifecycle: code kept/high (medium) · reach kept/high (medium)

**No brake on the client side.** `CoordinatorServer.ts:337-338` forwards every match-state-resync after only the generic 50/s limiter. resync's only guard is `flow.beginBaseline()`, which refuses only while `recovering` is true. `flow.baseline()` clears `recovering` as soon as the baseline is sent, without waiting for an ack. So the next resync is accepted immediately.

**Cost on the worker.** client-baseline runs on the single serialised `pending` chain that `advance` also uses. It:

1. awaits `publications.flush()`;
2. runs a synchronous `replicationSource()` + `encodeBaseline` on the simulation thread;
3. awaits the off-thread encode.

RecoveryBaselineCache is invalidated on every advance (`canonicalVersion++`), so the cache never helps across ticks.

**Rate.** `drainRecovery` serialises recoveries (`recoveringClient`). The real ceiling is one full baseline per recovery round trip, not 50/s. That is still about one full baseline per 125 ms tick, and each one delays the next advance.

**Honest clients too.** Slow but honest clients reach the same path through `applied()==="baseline"` after a 4-frame overflow (see H1). Tests only exercise a single resync.

- **Evidence:** `resync(guest){ … if(!flow.beginBaseline())return; this.recoveryQueue.push(guest);void this.drainRecovery(); }` and `} else if (request.type === "advance") { invalidateBaselines();`
- **Fix:** add a per-flow minimum interval, or a cap on consecutive rebases, in `LiveMatch.resync` (or in CoordinatorServer's resync case).

#### M7. A failed match initialisation is silent on the lobby page and strands the players (server-lifecycle)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:475-482`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**Why players see nothing.** When `initialize()` rejects:

- Each member gets `{type:'error'}` with no requestId. `OnlineLobbyConnection.ts:79-86` routes requestId-less errors to `onMatch`, and lobby `main.ts:296-298` only acts on `type==='match'`, so the error is dropped.
- `LiveMatch.end` broadcasts match-ended only to seats in `loaded`. That set is empty, because initialize never announced the match.
- `RoomCoordinator.advance` has already emptied the room (`members=[]`). For a custom room, `removeEmptyCustoms` then deletes it outright; default rooms stay listed with zero members.

**Real triggers.**

- `StartingPositions.next` throws "Not enough room for these factions and tribes…", which `SpawnSelection.resolve` rethrows during prepare. Camp limits exist only for amazon-river and migration at size 250 (`src/skirmish/lobby/LobbyRules.ts:31-33`), so oversized rosters on other maps get through lobby validation.
- `SpawnSelection` throws "No viable land" on maps with zero candidate tiles.
- Map asset errors.
- The 30 s executor timeout.

No test covers a rejecting prepare.

- **Evidence:** `void match.initialize().catch(async (error) => { for (const member of reservation.members) sendGuest(member.guestId, { type: "error", message: … }); await match.end("Unable to initialize match"); });`
- **Fix:** show requestId-less errors (or a dedicated match-failed message) in the lobby UI, and put the members back in their room when initialisation fails. Add a test with a prepare that rejects.

#### M8. cancelSync can delete a newer admission of the same guest and send it a stale error (server-lifecycle)
- **Where:** `src/skirmish/multiplayer/application/LiveMatch.ts:466-469` (finally), with `578-579` and `597-601`
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (low)

**The race.**

1. `disconnect()` deletes the guest's admission synchronously, then awaits `cancelSync`.
2. The rollback in `cancelSync` awaits `this.advancing` plus a set-controller round trip to the worker.
3. During that window, `connected()` and `isAdmitting()` are both false. So a reconnecting socket authenticates without going through the disconnect-before-register path.
4. `watch()` creates a fresh admission. (`assertAvailable` only guards against other guests during a sync.)
5. When set-controller resolves, the finally block deletes whatever admission is stored under that guest and sends "Join canceled because the connection closed" to the new socket.
6. The retried match-ready then gets "Loading timed out. Return to the lobby and try again." The client's retry regex at `OnlineMatchSession.ts:330` doesn't match that, so the player is bounced to the lobby.

Reproduced with a fake executor that holds set-controller open.

**How likely (reach verifier).**

- Clients never reconnect sooner than about 500 ms (OnlineLobbyConnection backoff), and the reload and second-tab paths are already handled. So the race needs a stalled worker, for example one stuck behind a join-barrier.
- For an in-session reconnect, the stale error is only shown as status text. Only a fresh page (lastTick<0) fails on it directly (`OnlineMatchSession.ts:116-118`).
- The seat is kept, so the player can rejoin from the lobby.

- **Evidence:** `} finally { this.admissions.delete(sync.admission.guest); this.send(sync.admission.guest, { type: "error", message }); this.finishSync(sync); }`
- **Fix:** in the finally block, delete and notify only when `this.admissions.get(guest) === sync.admission`. Alternatively, have `watch()` refuse or wait while `this.sync?.restoring` belongs to the same guest.

#### M9. docs/ is gitignored, so new documentation is silently never committed (structure)
- **Where:** `.gitignore:37`
- **Severity:** medium (reviewer: high) · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**What happens.** The bare pattern `docs/` sits in the "Debug / Log Outputs" block. It came in with commit 54eae25f ("more docs", 2026-10-01). Already-tracked docs keep committing, but every new file under docs/ is ignored.

**Currently excluded.** Three real files, none of them generated output:

- docs/OracleLateGameHardwareTest.md
- docs/perf/PacingAiNavalValidation.md
- docs/perf/TickBudgetOptimization.json

docs/perf/V11MovementBenchmarks.md was force-added after the rule went in, which shows people are working around it.

**Impact.** No runtime effect. Both verifiers dropped the reviewer's guess that this is why writing piled up in Optimization Handoff/; that link is unproven.

- **Evidence:** `git check-ignore -v docs/newfile.md` → `.gitignore:37:docs/	docs/newfile.md`
- **Fix:** delete line 37, or replace it with the specific generated-output path it was meant to cover. Then `git add` the three ignored files.

#### M10. The uncommitted recipe change breaks the compile-time mounted-frontage check, and nothing runs the compilers (structure + sweep-working-tree)
- **Where:** `scripts/FormationDoctrineSchema.ts:57`; `skirmish/plans/formation-recipes.json:66-69` (bronzeage-cavalry)
- **Severity:** medium (sweep-working-tree reviewer: high) · **Kind:** bug
- **Merged:** structure "Content compile step is manual and unguarded; working tree has already drifted" (`scripts/compileFormationDoctrines.ts:5`) and sweep-working-tree "Formation doctrine compiler rejects the new bronzeage-cavalry recipe" (`:57`)
- **Votes:** structure: code kept/high (medium) · reach kept/high (medium). sweep-working-tree: code kept/high (medium) · reach kept/high (medium)

**What changed.** The working-tree recipe edit raised bronzeage-cavalry capacity 8→16 and enlargedCapacity 12→20. It lowered bronze infantry enlargedCapacity 48→30.

**What breaks.** `validateFormationDoctrineData` divides the mounted line width by the widest same-era infantry line. The ratio is now 1.889, above `FRONTAGE.mountedWidthRatioMax` = 1.35 (`TacticalRules.ts:45`), so it throws. As a result:

- `scripts/compileFormationDoctrines.ts` aborts before writing anything.
- The `tests/skirmish/FlexibleFrontage.test.ts` test "rejects malformed profile data and mounted width exploits in the compiler" fails. It passes at HEAD.

The violation is wider than the error message suggests. Against the working-tree recipes, 21 mounted doctrine/variant pairs across every era exceed the cap; the worst is napoleonic-cavalry at 2.034. bronzeage-cavalry is just the first one in iteration order.

**Corrections.**

- The committed `src/skirmish/content/formation-doctrines.json` is not stale. The doctrine compiler only validates and passes data through (`data = schema.parse(input)`), and all three content JSONs are semantically identical to their plans.
- `mountedWidthRatioMax` is not enforced anywhere at runtime. Matches are unaffected, except that shipped content now allows mounted lines up to about 2× wider than infantry.

**The process gap is real.** No npm script, hook or CI step runs `scripts/compile*.ts`, and no test asserts that `compile(plans)` equals the content files.

- **Evidence:** `if(ratio>FRONTAGE.mountedWidthRatioMax)throw new Error("Mounted frontage exceeds infantry ratio: "+id+" "+variant+" "+ratio);` → `bronzeage-cavalry capacity 1.8894230769230769`
- **Fix:** either lower cavalry capacities across all eras, or deliberately raise the ratio (or scope it per era), then re-run the compilers. Add an npm script and a compile-equality test so drift gets caught.

#### M11. Trench and skirmish observers act before an order can still be rejected (sweep-simulation)
- **Where:** `src/skirmish/Simulation.ts:1467-1468` (observers); rejections at `1472-1475` and later
- **Severity:** medium · **Kind:** bug
- **Votes:** code: kept/high (medium) · reach: kept/high (medium)

**What happens.** For `type: 'order'`, `skirmish.observe(command)` and (unless appended) `trenches.observe(command)` run right after the ownership checks. The order can still be rejected afterwards, for:

- an unwalkable tile;
- the deferred queue cap;
- no room for the formation;
- an unreachable destination;
- replenish ordered off friendly land.

**What the observers have already done by then.**

- `TrenchOccupancy.observe` calls `leave(id)` for any non-hold order: phase 'leaving', layout cleared, change published.
- `SkirmishStance.observe` suppresses and finishes the stance.

Nothing rolls this back; `CommandApplications.apply` just records the rejection. By contrast, charge, attack-structure and Expansion's army path only observe on success.

**Common trigger.** A non-Shift right-click on water or impassable ground with entrenched squads selected. The client does not check walkability (`main.ts:1933`). The squad then sits in 'leaving' with no layout until it is ordered to occupy again. For appended orders, only the skirmish stance is dropped.

This is not a desync (the server is authoritative), but the behaviour is wrong.

- **Evidence:** `this.expansion?.skirmish.observe(command); if(!append)this.expansion?.trenches.observe(command);` followed by `if (order.type === "move" && !squadPaths.walkable(order.tile)) return … "Choose passable land or navigable water";`
- **Fix:** move both observer calls after the last rejection, as the charge/attack-structure path does at `Simulation.ts:1343-1347`.

### Low

#### L1. Eliminated nations keep their AI planner state until the match ends, but it is bounded (ai-economy-naval + ai-strategic)
- **Where:** `src/skirmish/Simulation.ts:5456` (checkWinner); `src/skirmish/domain/AiEconomicDirector.ts:231-236`
- **Severity:** low · **Kind:** bug
- **Merged:** ai-strategic "Eliminated nations leak army missions, defense projects and economy maps until match end" (`AiArmyPlanner.ts:189`) and ai-economy-naval "Elimination never releases a faction's AI economic state" (`Simulation.ts:5435` → 5456)
- **Votes:** ai-strategic: code kept/high (low) · reach kept/high (low). ai-economy-naval: code kept/high (low) · reach kept/high (low)

**What happens.** checkWinner sets `eliminated` and cleans up buildings, tiles, ships, aircraft and defense zones. It never calls `economy.release` or `operations.release`; the only caller of those is setAiController.

Every step path checks `enabled()` first, and `enabled()` is false for eliminated players. So:
- the release branch in `decide()` (`AiEconomicDirector.ts:260-262`) is never reached;
- AiArmyPlanner housekeeping only runs for the selected enabled player, and `runnable` filters eliminated owners out;
- AiDefenseDirector, AiNavalPlanner and AiCoastPlanner skip them.

**What is left behind.** Missions and `byPlayer`, defense projects, invasion responses, demands/saving/nextDecision, naval missions and coast goals all stay. They are serialised in every checkpoint.

**Correction: this is not unbounded.** Players are created only in `createPlayers()` at construction, `eliminated` is never reset, and there is no respawn. The leftover per eliminated faction is at most about 4 missions, 1 project and a few map entries. Leases and the ledger expire, and armies disband themselves. No gameplay effect.

- **Evidence:** `for (const player of defeated) player.eliminated = true;`, with no release anywhere in the rest of checkWinner; `if (!this.enabled(player) || …) continue;` comes before `this.decide(player)`.
- **Fix:** in checkWinner, call `this.expansion?.economy.release(player.id)` and `operations.release(player.id)` for each newly defeated player.

#### L2. Fleet recovery still uses raw tick counts (400/800/200) written for 20 Hz (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiNavalPlanner.ts:573-575`; comment at `AiLossWindow.ts:26-27`
- **Severity:** low · **Kind:** determinism, reclassified as timing
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `age>=400` (complete), `age>=800` (abort) and `age<200` (hold) are raw tick counts. They were written for TICKS_PER_SECOND = 20, where they meant 20 s, 40 s and 10 s; the same literals are at e372a87e and a0d27b15. At the current 8 Hz they mean 50 s, 100 s and 25 s. Recovery therefore completes, aborts and consolidates 2.5× slower than designed. Every other timer in the file uses `secondsToTicks`.

**Related stale comment.** AiLossWindow still says "50-tick bins … 49 ticks early". The bins are now `secondsToTicks(2.5)` = 20 ticks; the code itself is correct.

**Classification.** This is a timing regression, not a determinism problem. The old rate was 20 Hz, not 10 Hz as the reviewer said.

- **Evidence:** `if(age>=800 && !enough){this.transition(m,"abort","Recovery deadline reached; …`
- **Fix:** use `secondsToTicks(20)`, `secondsToTicks(40)` and `secondsToTicks(10)`. Update the AiLossWindow comment to 20-tick bins and 19 ticks.

#### L3. A mission parked in recover while waiting for naval credit never re-checks the credit (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiNavalPlanner.ts:575` (recover branch); `883-888` (fund → recover); `574`
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** `fund()` moves the mission to recover when `investmentCredit < costGold`, or during a loss pause. The recover branch returns early whenever `!enough`, before it reaches the `fund()` call at 579-587. So credit that refills while the mission waits is never spent by that mission. With enemy power present it aborts after 100 s (`age>=800`); otherwise it completes at 400 ticks.

**Correction: churn is not compounded.** The 120 s mission deadline (M1) already forces the same abort, cooldown and re-scan, so this adds only about 15 s of churn per ~140 s cycle.

**The real effect is purchase throughput.** A credit-limited AI buys at most one funding window per mission cycle. No test covers this.

- **Evidence:** `if(!enough || repairPending || age<200){if(ships.length)this.sail(m,ships,a.anchor);…return;}`
- **Fix:** re-check credit in the recover branch, and go back to fund once `investmentCredit` covers the next vessel.

#### L4. A second right-click within 350 ms turns a move into a charge, and the game never tells the player (client, design/UX)
- **Where:** `src/skirmish/client/OrderGesture.ts:23-34`; wired up at `main.ts:1936-1946`; controls popover at `HudView.ts:176`
- **Severity:** low (reviewer: medium) · **Kind:** bug; both verifiers reclassified it as design/UX
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** A second nearby right-click on the same selection, within 350 ms and 10 px, calls the charge callback. That sends `{type:"charge"}` for every selected squad that passes `canCharge`; mounted squads pass whatever their stamina. The server cancels the pending move and starts a 20 s cooldown.

**This is intended.**
- It is documented in BalanceContract.md:113 and BalancePreview.md:218-220.
- It is tested in tests/skirmish/OrderGesture.test.ts.
- A third click resets the gesture, so spam-clicking doesn't re-charge.
- It only fires within `charge.maximumDistance` (10 tiles for cavalry, 6 for the Napoleonic frontline), so spam-clicking a distant destination is safe.

**The gap.** Neither the in-game hint (`main.ts:1070`) nor the Battlefield controls popover (`HudView.ts:176`) mentions the gesture.

- **Evidence:** `if (previous && charge && previous.context === order.context && order.time - previous.time < this.interval && …) { this.recent = undefined; charge(); return; }`
- **Fix:** list the double-right-click charge in the controls popover and the hint (through translateText/en.json), or move charge to an explicit modifier as a product decision.

#### L5. The strategic-marker and aircraft canvases draw over the selection box, previews and Paused label (client)
- **Where:** `src/skirmish/client/style.css:169-184`; drawing at `Renderer.ts:2384-2429` and `1382-1412`
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** `.strategic-sprites` (z-index 1) and `.aircraft-layer` (z-index 2) are positioned siblings of `#battlefield`, which has no z-index, so they always composite on top of it. The drag-selection rectangle, the deployment and trench previews, and the "Paused" label are all drawn on the main canvas. At strategic zoom they are hidden wherever instanced formation markers or aircraft overlap them. Drag selection only resolves on mouseup, so while the rectangle is hidden there is no live feedback.

**Corrections.**
- The pause dim still works: markers and aircraft already render at 0.67 opacity when paused (`Renderer.ts:1735`, `1764`, `2000`, `2433`).
- Aircraft drawing above everything is by design and tested (`AircraftLayer.test.ts:45-47`).
- The placement ghost is meant to sit beneath units (`:1281`).
- No route lines are drawn there.

- **Evidence:** `.strategic-sprites { position: absolute; … z-index: 1; }` vs `#battlefield { display: block; position: absolute; inset: 0; … }`
- **Fix:** draw the selection box, previews and Paused label on the aircraft layer's context, or on a dedicated top overlay canvas.

#### L6. Timeline frames share the same ownership buffers, which keep being mutated (client, determinism)
- **Where:** `src/skirmish/client/PresentationState.ts:45`; `CombatPresentationTimeline.ts:37-39`
- **Severity:** low · **Kind:** determinism (latent hazard)
- **Votes:** code: kept/high (low) · reach: refuted/high (low) · repro: kept/high (low)

**What happens.** `PresentationStateDecoder.apply` returns the same three Uint8Arrays (owners, claims, progress) on every call and mutates them in place on each non-reset packet. The timeline keeps up to 4 such snapshots. Repro: the frame for tick 10 reports tick 11's owner (`sameBuffer` true).

**Why nothing renders wrong today.**
- No consumer reads ownership from an older frame. TroopActors never reads owners; Renderer and the territory layers use the latest snapshot.
- The latest-only contract is already documented at `SnapshotCodec.ts:474-477`.
- The same sharing already exists on `main.ts:847` (`decoder.decode(packet,false)`).
- An older frame would see newer ownership, never older, and it cannot crash.
- This is client presentation only.

- **Evidence:** `return { ...snapshot, owners: this.owners, claims: this.claims, progress: this.progress, changedTiles, expansion };`
- **Fix:** document on the CombatPresentationFrame type that owners, claims and progress always reflect the latest publication. Copy the buffers per frame only if someone adds a per-frame ownership read.

#### L7. Who wins a charge or an anti-air kill depends on squad id order (combat, fairness)
- **Where:** `src/skirmish/domain/Battle.ts:762-765` (charge write), `708` (disruption check), `838`/`842` (anti-air)
- **Severity:** low (reviewer: medium) · **Kind:** determinism, reclassified as fairness
- **Votes:** code: kept/high (low) · reach: kept/medium (low)

**Charges.** `fight()` visits squads in ascending id order, and `updateSquad` mutates records in place (`EntityCollection.ts:65`). A committed charge writes the defender's `chargeImpact.disruptedUntilTick` partway through the loop. So:
- a defender with a **higher** id than the rider is skipped at line 708 on the impact tick;
- a defender with a **lower** id has already struck that tick.

The difference is at most one defender action per charge impact. Damage itself is deferred through a DamageLedger, so the immediate chargeImpact write is the odd one out.

**Anti-air.** The AA branch does `target.health -= hit`, and later AA squads skip aircraft that are already dead. The lowest-id AA squad in range therefore always gets the kill XP.

**Not a desync.** The order is a stable sort and the server is authoritative, so this is a fairness bias only. The reviewer's line 1202 citation points at projectile interception, which has an explicit tie-break and is unrelated. No test swaps the rider and defender ids.

- **Evidence:** `this.world.updateSquad(target.id,{chargeImpact:{tick,role:'defender',…disruptedUntilTick:Math.max(tick+disruption,…`
- **Fix:** collect defender chargeImpact writes and apply them after the loop, as DamageLedger does. Alternatively, check disruption against values captured at the start of the tick.

#### L8. Blast splash damage is shared out in id order, not by distance from the impact (combat)
- **Where:** `src/skirmish/domain/Battle.ts:1524-1558`
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: kept/medium (low)

**What happens.** For conventional shells:
1. Eligible squads are sorted by id and capped at 64.
2. Each takes `min(budget, hit)` from a shared budget of 4×(damage + all bonuses).
3. Ships are processed after all squads, and structures after ships.

Distance only sets the falloff. The body at the centre, or the warship that took the direct hit, gets no priority.

**How often it bites.** The budget includes structure and wall bonuses that never apply to squads, so it is large:
- field artillery only runs out with about 6+ overlapping hostile squads;
- siege needs about 18+;
- the most plausible case is a warship shell (radius 1, no bonuses), where 4–5 afloat enemy squads are processed before the warship that was hit.

Bombs (infinite budget) and nukes (per-victim path) are unaffected. The result is deterministic and nothing crashes. No test covers ground-blast budget ordering.

- **Evidence:** `for (const target of this.nearby.filter(eligible).sort((a, b) => a.id - b.id).slice(0, targetLimit)) { const hit = Math.min(budget, hitDamage(scaled(target), …`
- **Fix:** sort eligible squads and ships by distance (formation gap or centre distance), then by id, before the slice and the budget. Ideally do squads and ships in one pass.

#### L9. Melee wall blocking checks the line between squad centres and ignores who owns the wall (combat)
- **Where:** `src/skirmish/domain/Battle.ts:248` (see also `252`/`254`)
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: refuted/medium (low) · repro: kept/high (low)

**What happens.** `legalContact` rejects melee if any intact wall tile lies on the segment between the two squads' root points. `intactWallAt` ignores ownership. The contact-point check at 252/254 uses `forts.clear()` instead, and that skips allied walls.

**Reproduced.**
- A wall tile on the root segment but off the actual contact segment blocks melee in both directions (damage goes from 48000 to 0).
- A wall owned by the attacker, on the attacker's own root tile, also blocks.

Squads can stand on their own or allied walls (`clearMovement` uses `blocked()`, which skips allied walls), so this happens in real play near walls.

**The reverse case.** Melee across a wall tip is already blocked for enemy walls by line 252; only own or allied walls get through.

**Disagreement.** The reach verifier argued the ownership-blind rule is intentional: it prevents one-way melee across a defender's own wall, and ranged checks are root-to-root too.

**Weak test.** The existing FormationContact wall test proves nothing, because its squads are out of reach even without a wall.

- **Evidence:** `if(melee && this.forts.hasObstacles && this.forts.segmentTiles(a,b).some(tile=>this.forts.intactWallAt(tile)))return false;`
- **Fix:** test walls on the contact segment instead (keep the ownership-blind behaviour if it is intended). Fix the FormationContact wall test so its squads are actually within reach.

#### L10. Duplicate-tab and quick-reload cases end with misleading messages (server-lifecycle)
- **Where:** `src/skirmish/client/lobby/OnlineLobbyConnection.ts:102-114`; `CoordinatorServer.ts:260`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**Close code 4001.** The client only recognises the reason "Match already open". For every other reason it shows "This guest is active in another tab. Close that tab and reload to return.", then calls `stop()` and `onExhausted`.
- `OnlineMatchSession.ts:155` maps `onExhausted` to `fail("Reconnection timed out…")`, which overwrites that status.
- Mid-match, the tab message is never shown at all, because `OnlineMatchSession.ts:88-96` replaces disconnected statuses first.
- "Close that tab" is shown to the tab that is being replaced, which is the wrong one.

**Quick reload.** A second `authenticate` arriving while the first is still awaiting `match.disconnect` gets 4001 "Connection handoff in progress". That wait can include cancelSync's set-controller round trip. The client treats this as permanent.

This affects UX text only. Tests only cover "Match already open".

- **Evidence:** `this.onStatus(event.code === 4001 ? event.reason === "Match already open" ? "…" : "This guest is active in another tab. Close that tab and reload to return." : …, false); this.stop(); this.options.onExhausted?.();`
- **Fix:** handle "Opened in another tab" and "Connection handoff in progress" separately, with the second one retryable. Don't route 4001 through the "reconnection timed out" failure.

#### L11. Internal exception text is broadcast to every client when a match is stopped (server-lifecycle, security)
- **Where:** `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:306-314`; also `:84`, `:309`, `CoordinatorServer.ts:477-482`
- **Severity:** low · **Kind:** security
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**How the text reaches players.**
1. The worker posts `error.message` verbatim for any Error.
2. ReservedMatchWorker rejects with `new Error(message.error)`.
3. advanceWorld has no catch.
4. `LiveMatch.ts:661-662` and `CoordinatorServer.ts:485-487` call ``end(`Match stopped: ${message}`)``, which broadcasts match-ended to every guest.
5. The client displays it (`OnlineMatchSession.ts:128-129`).

The comment promising a "safe message" is only half true: it withholds the stack, not the message.

**Other leaks of the same kind.**
- The fatal branches post `Snapshot publication failed: …` and ``Simulation recovery failed: ${match.failureReason}``.
- Failed `initialize()` errors are sent to every reservation member.

What leaks is internal error text and property names only.

- **Evidence:** `error: error instanceof Error ? error.message : "Match executor failed",`
- **Fix:** map worker errors to a fixed public string before posting them. Keep the raw message only in the server-side `console.error`.

#### L12. No cap on sockets or queued rooms, and directory fan-out is O(sessions × state) (server-lifecycle, security)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:213-226` (publish), `494`; `RoomCoordinator.ts:111-115`; `CoordinatorStore.ts:29-31`
- **Severity:** low · **Kind:** security
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.**
- `publish()` sends every session a directory containing the full CoordinatorState, on every change and every second.
- There is no cap on concurrent sessions or on queued custom rooms. The only limits are one custom room per guest and 3 visible custom rooms.
- Each spam room needs a live socket to survive (`removeEmptyCustoms`). So N guest sockets with N queued rooms make every publish cost O(N²) bytes. That work runs on the coordinator thread, which also schedules every match.
- Guest tokens cost 20/min/IP.
- The guests and guest_profiles tables are never pruned.

**Correction.** The requests table *is* pruned, to 256 rows per guest (`CoordinatorStore.ts:86-90`), so it only grows with the guest count.

**Mitigations already in place:** the per-IP guest limit, the 8 MB backpressure close, and the heartbeat.

- **Evidence:** `const publish = () => { const state = rooms.snapshot(); for (const [client, session] of sessions) send(client, { type: "directory", …, state, … }); };`
- **Fix:** cap total sockets and queued rooms, overall and per IP, and prune old guest rows.

#### L13. A worker that dies during an empty pause goes unnoticed until the grace period expires (server-lifecycle)
- **Where:** `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts:58-59`; `LiveMatch.ts:639-646`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** The worker's exit and fatal handlers flip `lifecycle` and reject pending requests. But `lifecycle` isn't part of the MatchExecutor interface, and LiveMatch never reads it. `advance()` returns before making any request while `emptyDeadline` is set, and advanceWorld returns before spawn when no guest is loaded. So a worker that dies with nothing in flight is never noticed. Ways that can happen: an async publication encode failure, or hitting the 384 MB memory limit.

**Consequences.**
- The lobby summary keeps advertising the match as "paused", with a rejoinPlayerId, for up to 120 s.
- A returning owner's rejoin fails immediately, because `request()` rejects synchronously. The match then ends with "Match executor unavailable during synchronization". That is a wasted round trip, not a 30 s timeout.

**Correction.** /healthz does not report "paused"; it simply leaves the match out of running, stalled and preparing.

- **Evidence:** `if ( this.advancing || this.sync || this.emptyDeadline !== undefined || !this.initialized ) return;`
- **Fix:** expose `lifecycle` or an `onExit` hook on MatchExecutor and end the match when it fires (or check it at the top of `advance()`).

#### L14. Checkpoints carry no content, tick-rate or rules fingerprint (sweep-determinism)
- **Where:** `src/skirmish/Simulation.ts:242` (checkpoint), `250-252` (restore check) and installCheckpoint; `DiagnosticReplay.ts:26`
- **Severity:** low (reviewer: medium) · **Kind:** determinism
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What is checked today.** `checkpoint()` writes only `version: 11`. restore and installCheckpoint compare the version, map size, JSON options and whether an expansion is present.

**What is not checked.**
- TICKS_PER_SECOND (`Protocol.ts:18`) is not part of the options.
- CONTENT_HASH is written only into presentation snapshots.
- FORMATION_RULES_VERSION only guards presentation packets.

So a checkpoint from a 20 Hz build, or with different unit or recipe content, restores with every tick-based timer taken at face value. `TacticalFeatureIndex.restore` shows the pattern that does reject mismatches.

**Exposure today.**
- Production restores reuse checkpoints from the same process and build. HostedRuntime and CommitVerifier are test-only, and the foreign-state `CommitVerifier.restore` has no caller.
- Only DiagnosticReplay fixtures (dev client, `?diagnostics` plus `/out/`) and future crash recovery are exposed.
- No checked-in checkpoint fixture exists, so the "continuation tests still pass" scenario is hypothetical.

- **Evidence:** `if (saved.version !== 11 || saved.width !== this.map.width() || … || Boolean(saved.expansion) !== Boolean(this.expansion)) throw new Error("Checkpoint does not match this simulation");`
- **Fix:** record CONTENT_HASH, TICKS_PER_SECOND and a rules version in the checkpoint, and reject mismatches in restore and DiagnosticReplay.

#### L15. LocalAvoidance checkpoints CrowdRecovery but restores it empty; AiRecovery saves `known` but never reads it (sweep-determinism)
- **Where:** `src/skirmish/LocalAvoidance.ts:116`, `125-126`; `src/skirmish/domain/AiRecovery.ts:243`, `251`
- **Severity:** low · **Kind:** determinism (hygiene)
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**CrowdRecovery.** `CrowdRecovery.frame()` has no caller in src/ (only tests), so `waiting` and `leases` are always empty. The checkpoint saves empty collections, and the argument-less restore rebuilds the same empty state; the comment at line 125 says that is intentional. Nothing diverges today. If `frame()` is ever wired back in, though, resumed matches would silently differ.

**AiRecovery.** The Simulation.ts:389-396 hooks keep `known` in sync with buildings, and it is rebuilt on restore. Saving it only adds checkpoint size: about 430 tuples at scale.

This is hygiene, not a determinism bug.

- **Evidence:** `recovery: this.recovery.checkpoint(),` vs `this.recovery.restore();`
- **Fix:** drop the CrowdRecovery field and its checkpoint entry (or pass `saved.recovery` if `frame()` comes back). Drop `known` from `AiRecovery.checkpoint`.

#### L16. The root vitest config picks up stale copies of the tree under out/ (sweep-determinism)
- **Where:** `vite.config.ts:331-337`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** The root `test.exclude` has configDefaults.exclude and a root-anchored `"tests/skirmish/**"`, but no `**/out/**`. So `out/<run>/…/tests/skirmish/` copies are collected:
- The CLAUDE.md single-file recipe (`npx vitest tests/skirmish/X.test.ts --run`) runs only the stale out/ copies, which fail with "Invalid checkpoint tile array" under jsdom.
- Plain `npm test` picks up about 1218–1222 stale test files.

**Who is affected.** out/ is gitignored (`.gitignore:5`), so a clean CI checkout is fine. Local developers and agents are the ones misled. The correct runner is `npm run test:skirmish` (vite.skirmish.config.ts, node environment).

- **Evidence:** `npx vitest list tests/skirmish/CavalryImpact.test.ts --filesOnly` lists only the `out/crash-investigation-20261015/…` and `out/late-game-playability-20261012/…` copies.
- **Fix:** add `"**/out/**"` to the exclude list. Point the CLAUDE.md single-file recipe at `-c vite.skirmish.config.ts` for skirmish tests.

#### L17. Couriers keep travelling to ports that turned neutral and deliver nothing (sweep-ownership)
- **Where:** `src/skirmish/domain/Trade.ts:440-443` (allowedMarket), `1367-1397` (arrival)
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** allowedMarket only rejects owners whose Player record is eliminated. Owner 0 has no record, `permitted(a,0)` is true and `enemy(a,0)` is false. Committed naval legs skip `permitted()` entirely.

So a courier already heading to a building that becomes owner 0 keeps going (this happens on defeat with recipient 0, per `Simulation.ts:5463/5495`). On arrival, `receiving.take("0:tile")` returns 0, but the tile is still pushed to `visited`/`visitedTiles` and one of `maximumStops` is used up. The cargo is kept and goes elsewhere.

**Corrections.**
- Cities can't trigger it. Defeat requires that no completed, healthy city remains, so any city that reaches owner 0 is already rejected by `ready()`. Only ports are affected.
- It does not happen "repeatedly". New dispatch never includes owner-0 buildings, and `visitedTiles` prevents revisits.

- **Evidence:** `if (!this.ready(b) || this.world.players.find((p) => p.id === b.playerId)?.eliminated) return false;`
- **Fix:** in allowedMarket, reject `!b.playerId` (or owners missing from `world.players`) before the committedSeaLeg exemption.

#### L18. The amphibiousFactions transport cache is keyed only by research count and survives restore (sweep-ownership + sweep-simulation)
- **Where:** `src/skirmish/Simulation.ts:414-424`
- **Severity:** low · **Kind:** bug / determinism
- **Merged:** sweep-ownership "amphibiousFactions transport cache keyed only by research count" (`:415`) and the amphibiousFactions sub-claim of sweep-simulation "Fields outside checkpoint() that change behaviour after restore()" (`:592`)
- **Votes:** sweep-ownership: code refuted/medium (low) · reach kept/medium (low) · repro kept/high (low). sweep-simulation: code kept/medium (low) · reach kept/medium (low)

**What happens.** `transportVessel` caches each faction's vessel keyed on `completed.length`, but `Expansion.transport` depends on what is *in* `completed`. `Skirmish.restore` never clears the cache.

**Why normal play is safe.** Within one timeline, `completed` only grows: `push` is guarded by "already completed", and `inheritCompleted` is a union. Equal length therefore means an equal set.

**The one trigger.** An in-place restore of a checkpoint from a different timeline, with a research set of the same size but different contents.
- Reproduced: the cache returned a stale "stoneage-transport", and `amphibious` was true here but false on a fresh instance.
- Only CommitVerifier and HostedRuntime restore in place, and both are test-only today. worker.ts builds a fresh Skirmish.
- The effect would be a determinism mismatch (commits failing verification), not a crash.
- The code verifier pointed out that triggering it needs a forged delta, and a malicious host could already do worse.

**Other sweep-simulation sub-claims.**
- The pathsWarm/warmGraph versus corridorReady mismatch on a fresh-process restore is a perf-only cold start, accepted by design.
- The navalOwners and routeClassificationEpoch sub-claims were refuted: UnitIndex.rebuild bumps membershipRevision, and RoutePlanner.restore resets its identity-keyed WeakMaps.

- **Evidence:** `if (cached?.completed !== completed.length) { cached = { completed: completed.length, vessel: this.expansion!.transport(playerId) };`
- **Fix:** clear `amphibiousFactions` in installCheckpoint, or key the cache on array identity plus the progression revision.

#### L19. restore() doesn't validate owners[] tile values, so an unknown owner id throws later (sweep-ownership + sweep-simulation)
- **Where:** `src/skirmish/Simulation.ts:254-255` (the check), `4824` (dereference in nuclearBlast), `4848` (dereference in changeOwner)
- **Severity:** low · **Kind:** bug
- **Merged:** sweep-ownership "Restore does not validate owners[] tile values; orphan owner ids crash on first capture" (`:4827`) and the owner-validation sub-claim of sweep-simulation "Fields outside checkpoint()" (`:254`/`4848`)
- **Votes:** sweep-ownership: code kept/high (low) · reach refuted/high (low) · repro kept/high (low). sweep-simulation: as L18

**What happens.** restore checks squad, ship, building and barrier playerIds against the roster (built at 256-261). It checks owners and claims only for type and length, and `rebuildOwnedTiles` indexes any id it finds.

**Reproduced with owner byte 200:**
- restore accepts it;
- `nuclearBlast` then throws "Cannot read properties of undefined (reading 'reserveRemainder')";
- without raids, `changeOwner` throws on `.land`;
- under raids-v1, `canCapture(1,200)` is false, so the tile simply can never be captured.

**Exposure.** Normal checkpoints never contain unknown ids, because players are never removed. `CommitVerifier.verify` already rejects owners greater than players.length on the commit path. What remains is a corrupt or hand-edited checkpoint loaded through a raw restore: `CommitVerifier.restore`, `HostedRuntime.restore`, or the dev diagnostics replay in worker.ts:115.

- **Evidence:** `for (const tiles of [saved.owners, saved.claims, saved.progress]) if (!(tiles instanceof Uint8Array) || tiles.length !== this.owners.length) throw …` (no value check); `if (old && land) this.player(old)!.land--;`
- **Fix:** in restore, check every non-zero owner and claim byte against the roster and reject the checkpoint if one is unknown.

#### L20. A Shift-queued replenish activates on land the squad doesn't own and never finishes (sweep-simulation)
- **Where:** `src/skirmish/Simulation.ts:1488-1504` (append path), `1508-1512` (friendly-land check); `replenish()` at `2513-2518`; finishOrder at `1749-1751`
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/medium (low) · reach: refuted/medium (low) · repro: kept/medium (low)

Only the replenish half of the original claim holds.

**What happens.**
1. An appended replenish is queued before the friendly-territory check runs.
2. `finishOrder` later activates it at a neutral or enemy destination.
3. `replenish()` skips squads that are off friendly land every second, without ever calling `finishOrder`, and navigation returns null for replenish.

The squad then holds with a 'replenish' order until it is re-ordered or the tile becomes friendly. Further Shift orders pile up behind it, because the append path only treats 'hold' as idle.

**Reachability.** The reach verifier found that no client or AI path sends an appended replenish (the client's `replenish()` has no append flag). Triggering it needs a hand-crafted command, and it only affects the sender's own squad.

**Refuted half.** The attack half of the claim does not hold. Alliance and peace remove queued attacks on targets that are no longer hostile (`Expansion.ts:531-538`), and retargeting after a raid expires is the designed attack-continuation behaviour.

- **Evidence:** `if (append && selected.every(s=>s!.order.type!=="hold")) {` queues and returns before `order.type === "replenish" && selected.some((s) => this.owners[this.tileOf(s!)] !== player.id)) return "Move every selected squad onto friendly territory before replenishing";`
- **Fix:** apply the friendly-territory check to appended replenish orders too, or check it when finishOrder activates the order.

#### L21. A melee strike the contact check approved can find no soldier to hit and is silently dropped (sweep-working-tree)
- **Where:** `src/skirmish/domain/MeleeDamage.ts:141`, `162` (the drop); geometry at `74-85`; `Battle.ts:254`, `610`/`962`, `621-624`
- **Severity:** low (reviewer: high) · **Kind:** bug
- **Votes:** code: refuted/medium (low) · reach: kept/medium (low) · repro: kept/high (low)

**The mismatch.** Two different geometries decide melee:
- `legalContact` and `contactParticipants` use the gap between convex hulls;
- `meleeReceivers` uses per-slot rectangles within reach + penetration + release.

When they disagree, `commitShot` has already spent the attack, MeleeDamageBatch skips the empty claim, and nothing is recorded: no damage, no volley, no meleeStrike, no contribution. The strike doesn't even animate, because volleys only come out of resolve.

**Reproduced in two cases.**
- A target in the middle of a formation transition, e.g. column from line at gap 4.19. Its hull covers empty space.
- The engaged-hysteresis band (gap between range+4 and range+32), with column sources or with cavalry targets in wedge, column or line.

**How rare.**
- 0.12% of uniformly sampled approved contacts.
- Infantry mass and shield-wall targets never disagree.
- The oblique-wedge cases from the original claim were not reproduced.
- The code verifier fuzzed more than 12,000 contacts and found zero empties; it treats this as a hardening note.
- Dropping empty contact is intended in general (`MeleeDamage.test.ts:89`).

- **Evidence:** `if (!claim.slots.length) continue;` (MeleeDamage.ts:141)
- **Fix:** when the slot list is empty at `Battle.ts:622-624`, fall back to the non-slot damage path. Or make `meleeReceivers` use the same hull geometry as `formationContact`. At minimum, count empty claims in diagnostics.

#### L22. The new strategic sleep key breaks a committed restore-equivalence test, because the fixture bypasses changeOwner (sweep-working-tree)
- **Where:** `src/skirmish/domain/AiOperations.ts:324-325` (trigger); `tests/skirmish/ResponsiveGameplay.test.ts:35-36` (cause)
- **Severity:** low (reviewer: high, as determinism) · **Kind:** determinism, reclassified as a test regression
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** The working tree added `expansionBlocked()` to `sleepKey`. That calls `world.hasUnclaimedFrontier()`, which reads `FactionAdjacency.unclaimedEdges`. The test fixture fills `game.owners` directly, bypassing changeOwner, so:
- the live adjacency counters are stale, while the restored clone rebuilds them;
- the live key ends `:false:0` and the restored one ends `:true:5`;
- nextThink is 1480 live versus 1426 restored.

**Why production is fine.** Every production write to `owners[]` goes through changeOwner → `adjacency.changed`, or installCheckpoint → `adjacency.rebuild`. `PathTopology.passable` is immutable, and `adjust()` corrects itself. Live and restored matches therefore compute identical keys: there is no AI divergence, and the failure is deterministic, not flaky. This is one of the 12 regressions in H4.

- **Evidence:** ``const blocked = this.expansionBlocked(player, r); const sleepKey=`…:${blocked}:…`;`` and, in the fixture, `game.owners.fill(player.id);`
- **Fix:** set ownership in the fixture through the simulation API, or rebuild the indexes after the direct fill.

#### L23. oxlint: 3 new prefer-nullish-coalescing errors on a lint that was already failing (sweep-working-tree)
- **Where:** `scripts/compileSoldierWeapons.ts:25`; `src/skirmish/client/lab/UnitLabSheet.ts:73`, `482`
- **Severity:** low (reviewer: medium) · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What is new.** `.oxlintrc.json` sets `typescript/prefer-nullish-coalescing` to error. Of the 10 errors cited, only 3 are new:
- `compileSoldierWeapons.ts:25`, inside a changed hunk;
- the new, untracked `UnitLabSheet.ts`, at lines 73 and 482.

**What already existed.** `Battle.ts:659` (×4), `Renderer.ts:1030`, `AiArmyPlanner.ts:321` and `AiOperations.ts:420` are identical at HEAD. `npm run lint` already fails at HEAD, with about 149 oxlint errors in unchanged tracked files under Art/, tmp/, scripts/ and several src/skirmish files. This change does not turn the lint red.

**Caution.** Blindly applying `??` to the boolean chain at `Battle.ts:659` would change what it does.

- **Evidence:** `scripts/compileSoldierWeapons.ts:25:41 error typescript(prefer-nullish-coalescing)` on `.strict().refine(value => value.melee || value.ranged, …)`
- **Fix:** fix the 3 new sites. Deal with the existing lint debt separately.

#### L24. TroopActors.prune loops over snapshot.volleys before the detail early return (sweep-working-tree)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:476` (new loop), `497` (early return)
- **Severity:** low · **Kind:** bug
- **Votes:** code: kept/high (low) · reach: kept/high (low)

**What happens.** The working tree adds `for(const hit of snapshot.volleys)` ahead of the `if (!this.detailed) … return;` that used to shield the only access to volleys. The partial fixture at `SoldierDetailMode.test.ts:86` (`{localPlayerId:1, squads:[]}`) now throws "snapshot.volleys is not iterable", so 1 of that file's 3 tests fails. This is one of the 12 regressions in H4.

**Why production doesn't crash.** `Snapshot.volleys` is a required field, and every producer fills it in: Simulation, SnapshotCodec, and the timeline via `...source`. `Renderer.ts:429/2342/2434` already loop over it without a guard.

- **Evidence:** `TypeError: snapshot.volleys is not iterable ❯ StoneAgeDemoActors.prune src/skirmish/client/troops/TroopActors.ts:476:31`
- **Fix:** add `volleys: []` to the fixture, as `MassFormation.test.ts:268-273` does. A `?? []` guard is optional extra hardening.

---

## Plausible (needs a repro)

None. No finding in the ledger was kept only at low confidence.

---

## Perf findings

These are all confirmed perf-kind findings. There were no plausible ones. Each entry has an **Expected impact** line, which uses only the numbers the reviewer or verifiers measured or estimated.

### High

#### P1. The main thread receives and deserialises the complete entity graph on every publication (client + network)
- **Where:** `src/skirmish/client/CanonicalStateStream.ts:141-147`; `multiplayerStateWorker.ts:99-104`; `Renderer.ts:412-417`
- **Severity:** high per the network verification. The client-area verification rated it medium.
- **Merged:** network "Browser main thread receives the complete entity set on every publication" (verified high) and client "Main thread deserialises the full entity graph every publication (unused packed path exists)" (verified medium)
- **Votes:**
  - network: code kept/high (high) · reach kept/high (medium)
  - client: code kept/high (medium) · reach kept/high (medium)

**What happens.**
- OnlineMatchSession always requests `entities: true` (lines 239, 293, 504). No client path ever sends `packed: true`.
- `presentationState()` copies every non-tile field of the canonical snapshot into the view: squads, ships, buildings, players, volleys and most of the expansion state.
- The worker transfers only the tile buffer. Everything else is structured-cloned to the main thread on every presented publication.
- Renderer.update then walks every squad several times.

**Why it is built this way.** This is deliberate (CanonicalStateStream.ts:156/161-162): sending full rows means any latest-only view can be applied on its own. The only mitigation today is that OnlineMatchSession coalesces to one in-flight presentation, which does nothing to reduce the cost of each view.

**Corrections from the verifiers.**
- Publications arrive at 5 Hz or more, because commands trigger extra publications.
- PresentationStateDecoder.apply does not walk squads, and presentationState() itself costs under 0.1 ms. The cost is the clone plus Renderer.update.
- Reaching 900 squads takes 5 or more players near the late-age caps.

**Expected impact.**
- Reviewer measurement at 900–1100 squads: about 1.2–1.27 MB JSON-equivalent and 16–20 ms structuredClone per publication.
- Independent re-measure: 569–697 KB and about 9.7–19.7 ms round trip. The main thread pays roughly the deserialise half (~7–10 ms), plus Renderer.update in the same task.
- Result: a likely dropped 60 fps frame every 200 ms in large late-game matches. At 200 squads the clone is about 2.2 ms.

- **Evidence:** `const { owners, claims, progress, changedTiles, expansion, ...entities } = source; const snapshot = { ...entities, expansion: … };` and `{ transfer: [state.view.tiles.buffer] }`
- **Fix:** build a lazy row-view decoder, or a compact typed-array view for squads that are not selected (M–L effort). Simply switching to the existing packed path does not help: per the client code verifier, on the main thread it needs SnapshotDecoder.decode, which rebuilds every squad object. That rebuild is exactly what the entities path was introduced to avoid.

### Medium

#### P2. Naval planner: fixed 16-unit budget and one faction per tick, so assessment latency grows with the number of factions (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiEconomicDirector.ts:214`; `AiNavalPlanner.ts:265-279`, `355-360`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/medium (medium)

**What happens.**
- `naval.step(16)` is called once per tick with a fixed budget.
- Each call serves exactly one enabled faction, round robin. Idle factions still use up their tick: no ports, in cooldown, or assessment not yet due. Tribes count too when aiEconomy is on.
- Each fact read costs one unit.

So assessment latency is about ceil(R/16) × N_enabled ticks. R is the faction's own coastal buildings plus all ships and all ship jobs in the sea. Only chooseTheater reads every building, in up to 8 seas. Nothing moves fleets between assessments. Under very heavy load, the 120 s mission deadline (M1) can abort a mission before its first assessment even finishes.

**Expected impact.**
- Measured with 45 factions in Bronze/Classical: 40–44 ticks mean per assessment, 83 max. That is about 5–10 s, against an intended 5 s.
- The reviewer's ~170 s figure (about 300 warships in one sea) is arithmetic extrapolation. The reach verifier's re-estimate is about 115 s at roughly 330 reads.
- Combat in Battle is not affected. The cost is that fleet decisions arrive late.

- **Evidence:** `const controllerWork = world.options.aiNaval && world.options.deferredPlanning ? this.naval.step(16) : 0;` and `// One faction per tick; entity work inside it shares one fixed allowance.`
- **Fix:** skip idle factions without spending their turn, and/or scale the budget or turns with the backlog or the number of enabled factions.

#### P3. Coast acquisition can never finish its scan before the 300 s deadline on large maps (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiCoastPlanner.ts:158`, `188`, `194-209`
- **Severity:** medium (reviewer: high). The reach verifier reclassified it as a liveness problem rather than perf.
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- `edges` holds every port-anchor × water-edge pair: 12,203 on heightmap-test1 500, 29,831 on Migration 1000.
- A goal reaches "quote" only after scanning every edge.
- One player is served per call. The cursor also lands on humans and tribes, which return 0 and waste the turn.
- 8 edges are scanned per turn, against a 2400-tick deadline.

So a goal can scan at most 19200 / players.length edges. It always aborts with "Coastal acquisition deadline reached" and restarts from cursor 0 after 40 s. The 8-candidate shortlist is full long before the deadline.

Reproduced: edges = 12,203; at tick 2500 every goal was in abort with its cursor between 408 and 480. Correction to the reviewer: AiCoastPlanner does have tests (RemainingPlans.test.ts:340-440), but none of them runs a full scan on a real map.

**Expected impact.** CPU cost is bounded (8 evaluations or fewer per tick). The feature simply never produces a result on large maps: landlocked or port-less AI never gains coast through this planner. Coastal nations still get ports through ordinary placement.

- **Evidence:** `const edge = this.edges[g.cursor++]; if (!edge) { g.phase = "quote"; …` and `deadline: world.tick + secondsToTicks(300),`
- **Fix:** move to quote once the shortlist is full, or when the deadline is close and the shortlist is non-empty. Skip non-enabled players without spending their turn.

#### P4. AiModernFronts restarts its assessment whenever the global squad count changes (ai-strategic)
- **Where:** `src/skirmish/domain/AiModernFronts.ts:244-253` (reset), `544-551` (one assessment per tick; advance is gated on a complete scan)
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- assessment() throws away all progress when `section.assessment.length !== world.squads.length`.
- world.squads is a frozen view whose length changes on every spawn and death, and removals run every tick.
- step(32) runs once per tick and stops after the first assessment, so only one section on the whole map advances per tick. Each visit scans at most 31 squads. The per-player slot rotation spreads visits across up to 3 sections.
- advance() only runs when `cursor === world.squads.length`. advance() is the only place where garrison-loss and overmatched-front withdrawals happen.

**Refinements.**
- The reset only fires if the count differs at the *next* visit. When churn nets to zero, the scan doesn't reset, but the index-based cursor then silently skips or double-counts squads.
- "Never completes" is too strong, but at target scale Modern trench sections stay stuck in staffing, and holding sections never re-evaluate.
- The tests use about 10 squads.

**Expected impact.** At about 1100 squads, with 14 Modern nations and 3 sections each, one section needs about 36 visits × ~42 ticks ≈ 1500 ticks (~3 min) with no net change in squad count. In practice the AI's modern-front feature does nothing at scale.

- **Evidence:** `if (!section.assessment || section.assessment.length !== world.squads.length) section.assessment = { cursor: 0, length: world.squads.length, … }`
- **Fix:** make the scan tolerate churn instead of resetting on any length change, for example by snapshotting squad ids when the scan starts, or keeping a squad-index revision per owner.

#### P5. Diplomacy.hostile does unmemoised linear scans and allocates two strings per row (ai-strategic)
- **Where:** `src/skirmish/domain/Diplomacy.ts:125-127` (hostile), `31-36` (protected/embargo), `89` (pair)
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach refuted/medium (low) · repro kept/medium (medium)

**What happens.**
- `hostile = nonAllied && (!raids || !protected && (declaredWar || embargo))`. Each term is a `.some()` over a state array.
- `protected()` and `embargo()` call `pair()`, which builds two template strings for every row.
- Under raids-v1, which live matches use, the full path runs for every non-allied pair.
- Callers include collisionHostile (Formations, LocalAvoidance, LocalDetours, squadSeparation), thinkAi once per nearby enemy, and AiFrontRecords.
- `step()` prunes expired embargoes and protections, so the cost scales with the number of currently active rows.

**Corrections.**
- Trade.ts:1234 uses canSteal under raids, not hostile.
- PairRelations.ts is 70 lines; the projection is at lines 31–65, not line 641. It is not a drop-in cache: it has no peaceProtection semantics and is rebuilt every tick.

**Verifier disagreement.**
- Reach, organic 52-faction run: at most 16 wars, 2 embargoes and 1 protection. hostile() took about 1–2.5 ms of a 36–82 ms step (2–3%).
- Repro, with tens to hundreds of injected embargo/protection rows: 35–60% of tick time (13–70 ms).

**Expected impact.** Negligible when few raids are active. Tens of milliseconds per tick if active embargo and peace-protection rows build up into the tens or hundreds. How many build up in organic play has not been measured.

- **Evidence:** `protected(…){ return !!this.state.peaceProtection?.some(p=>this.pair(p.a,p.b)===this.pair(a,b)&&p.untilTick>tick); }`
- **Fix:** compare min/max ids as numbers instead of building strings, and/or cache a pair set keyed on diplomacy.revision / permissionRevision.

#### P6. thinkAi raid branch: an uncapped spatial.nearest scan runs when no land target exists (ai-strategic)
- **Where:** `src/skirmish/Simulation.ts:5159-5165`, plus a second uncapped call at `5175`
- **Severity:** medium (reviewer: low; code verifier medium, reach verifier low)
- **Votes:** code kept/high (medium) · reach kept/medium (low)

**What happens.**
- Each idle, holding, raid-slotted squad comes due every 6 ticks. It filters the enemy's cities through aiFootprintAllowed and sorts them by distance from its own tile.
- That part is cheap: it's only cities, and the footprint checks are cached. The sort is per squad, so it can't be hoisted wholesale.
- When no city qualifies, spatial.nearest runs with no radius cap. It walks rings out to the full grid and allocates for every empty bucket.

**How it is reached.** checkWinner keeps an enemy alive through embarked squads, which the nearest predicate rejects. Unfinished or unenterable cities are filtered out too. In that state, every due raider does a full-grid miss every tick until the enemy is eliminated.

**Expected impact.**
- Measured miss cost: about 3.4 ms per call on a 1000-tile map and about 16 ms on a 2000-tile map. A hit costs 0.01–0.08 ms.
- Ten due squads → 30–160 ms per tick on large maps, overrunning the 125 ms tick for the rest of that war.
- Negligible on 250–500 maps.

- **Evidence:** `const lastSquad = !remaining.length ? this.spatial.nearest(squad.x, squad.y, candidate => … candidate.embarkedOn === null && …) : undefined;` and SpatialGrid.ts:218 `for (let ring = 0; ring < Math.max(this.columns, this.rows); ring++) {`
- **Fix:**
  - Cache the filtered city list, and the "no land candidate" result, per (player, enemy) per tick.
  - Replace the sort with a min scan.
  - Give nearest a radius bound.

#### P7. Every frame scans all volleys once per visible fighting melee squad (client)
- **Where:** `src/skirmish/client/Renderer.ts:1863`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.** Inside the draw loop over visible squads, every fighting melee squad runs `snapshot.volleys.filter(…)` across the whole volley list and keeps only the last match. This happens on every 60 fps frame. Volleys are capped at 4096 and kept for about 5 ticks, and the outer loop only covers squads in the viewport. The same line exists at HEAD (line 1838), so this is not new.

**Expected impact.** Roughly 1e5–1e6 predicate calls (a few ms) per frame, only when a large melee is on screen.

- **Evidence:** `const shots=snapshot.volleys.filter(v=>v.squadId===squad.id && v.melee && !v.impact && …);`
- **Fix:** build a `Map<squadId, latest melee volley>` once per snapshot in Renderer.update (as buildingGuns.update does) and look it up.

#### P8. CombatPresentationTimeline.sample rebuilds a Map and a snapshot wrapper on every animation frame (client)
- **Where:** `src/skirmish/client/CombatPresentationTimeline.ts:54-59` (cache key), `79`, `81`, `96-131`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/high (low)

**What happens.**
- The sample cache is keyed on the exact rAF timestamp, so it only deduplicates the two callers within the same frame.
- Whenever a next frame exists, it rebuilds `targets = new Map(next.squads…)`, runs a `some()` scan, spreads the snapshot and maps every squad. A next frame normally exists, because the playhead trails up to 600 ms behind.

**Corrections.**
- Squads that haven't changed return their original row. Only moving or turning squads are shallow-cloned, and nested objects are shared rather than copied (so not ~750 bytes each).
- Because each frame gets a fresh snapshot object, Renderer.highGround's rangeTargets cache (Renderer.ts:322) is also defeated every frame.

**Expected impact.** About 0.1–0.4 ms per frame at roughly 1100 squads (1–2% of a 60 fps budget), plus short-lived garbage.

- **Evidence:** `targets = new Map(next.squads.map((s) => [s.id, s]));` inside `if (next && this.tick > source.tick) {`
- **Fix:** memoise targets and terminalRoots per (source, next) identity, or key the cache on the derived tick. Optionally use a reusable position buffer.

#### P9. Hit testing on every pointermove walks the whole squad population (client)
- **Where:** `src/skirmish/client/Renderer.ts:634-668` (squadAt), `685-689` (currentFormationPose); `main.ts:1546`
- **Severity:** medium
- **Votes:** code kept/medium (medium) · reach kept/medium (medium)

**What happens.** squadAt runs on every pointermove with no throttle. For every squad it calls squadArtworkHitTest, screen(), squadArtworkDetailed, eraArtwork.get and squadSymbol, with no cheap distance check first. For off-screen formation squads it is worse: currentFormationPose misses the formationPoses cache, because that cache only holds squads that survived the last draw's culling. It then recomputes formationRenderPose, building per-soldier slot arrays.

**Corrections.**
- In draw(), the work done before culling is small: screen, legacyWeaponStrength, squadViewRadius, squadArtworkViewRadius and a cached formationEnvelope. squadArtworkPose, the era frame and squadSymbol already run after the cull.
- The trader loop's pre-cull work is trivial.
- depositAt and buildingAt are linear but simple.
- There is no spatial index.

**Expected impact.** The reviewer estimated a few hundred µs to about 1 ms per frame and per pointermove at 1100 squads. Not profiled.

- **Evidence:** `for (const squad of (this.presentedCombat?.snapshot??this.snapshot)?.squads ?? []) { … if(squad.formation && !squad.afloat){const pose=this.currentFormationPose(squad); …`
- **Fix:** in squadAt, reject squads by viewport or radius before calling currentFormationPose and squadSymbol. Alternatively, build a uniform grid per snapshot and use it for squadAt, squadIntersectsBox, depositAt and buildingAt.

#### P10. Soldier rendering draws each soldier with Canvas2D drawImage; InstancedActorSprites is not wired in (client)
- **Where:** `src/skirmish/client/troops/TroopActors.ts:271-319` (flush), `892`+ (draw); `FactionFrames.ts:18-22`
- **Severity:** medium
- **Votes:** code kept/medium (medium) · reach kept/medium (low)

**What happens.** At scale ≥ TROOP_DETAIL_CUTOFF (12), each visible squad:
- samples engagement twice and walkers once;
- builds two string keys per soldier (assets.get and FactionFrames, which also does an LRU delete+set on every hit);
- allocates a spread object per soldier.

flush() then sorts, and makes four passes: rings, impacts before, sprites (save/translate/rotate/drawImage/restore for each), impacts after. There is no soldier budget between scale 12 and 96. drawnSoldiers and sortMs are computed but never logged to browser-runtime-diagnostics.

**Correction.** InstancedActorSprites is used, but only by the standalone review scene tests/skirmish/browser/InstancedTroops.ts. It is deliberately not integrated yet (see InstancedTroops.md, "Next integration gate"). Its shader tints the whole sprite by multiplication, and it clears its own canvas, so integrating it is L effort.

**Expected impact.** Not profiled. The prototype's synthetic comparison (9,384 instances: Canvas2D 24.46 ms vs WebGL2 3.43 ms CPU) suggests roughly 3–13 ms for 1–5k soldiers at the widest detailed zoom.

- **Evidence:** `ctx.save(); ctx.translate(…); ctx.rotate(entry.angle); ctx.drawImage(entry.image, frame.x, frame.y, …); ctx.restore();`
- **Fix:** first log drawnSoldiers, sortMs and flush time. Then work through the documented integration gate (a separate WebGL layer with mask-based tinting), and switch FactionFrames to integer keys.

#### P11. Synchronised melee strikes cost tens of ms in a single tick (combat)
- **Where:** `src/skirmish/domain/MeleeDamage.ts:50-72` (sort and O(T²) slot sweep on every call), called from `Battle.ts:621-622`
- **Severity:** medium
- **Votes:** code kept/medium (medium) · reach kept/medium (low)

**What happens.** Steady-state combat is fine: the reviewer measured 6.2–8.4 ms/tick median with 200–600 squads in contact. The spike comes from cooldowns lining up. When many soldier-model melee squads have the same cooldown phase (on the contact tick, then once every cooldown period), each committed strike calls meleeReceivers with nothing cached: a convexHull per source body, a sort, and an O(T²) sweep, followed by damage application. Volley counts per tick showed the pattern: 200, 0, …, 0, 200.

**What it is not.**
- Not body building. Pre-warming 600 bodies cost only about 2–30 ms in total, and the pose cache is dropped on every move anyway, so pre-warming wouldn't help.
- The reviewer's 150–280 ms first-tick figure is mostly a cold JIT (once per worker) and/or squads spawned on that same tick.

**Expected impact.**
- Desktop Node 24, warm: about 26–50 ms on later strike ticks, and 35–95 ms on first contact, for 200 simultaneous strikes.
- Roughly 0.25–0.3 ms per pair, so about 70–93 ms for 300 pairs.
- Expect about 3× that on the ARM host. Whether this explains the ARM p99 255 ms spikes needs a warm-JIT measurement there.

- **Evidence:** the profile of the spike tick shows top samples in meleeReceivers, structuredClone, fight, convexHull and GC; the loop is `for (const p of slots) { … for (const q of bySide) {`
- **Fix:** cache the receiving bodies and slot ordering per (source pose, target pose) across strikes, or stagger first strikes and cooldowns.

#### P12. About 110 KB of raw progression metadata is resent on every publication (network)
- **Where:** `src/skirmish/domain/Progression.ts:196`; `Expansion.ts:1880`, `1901`; `SnapshotCodec.ts:166-173`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- Progression.step bumps one revision for the whole record every tick, whenever any non-eliminated player has an active advancement or research job. With 47–52 factions and AI researching continuously, that is essentially every tick.
- selectMetadata only tracks changes per key, so the entire progression record for every player goes into nearly every delta.

**Why it's wasted.** Only the local player's remainingTicks is rendered each tick. Other factions' progression is read only for age and completed techs, which rarely change. Only the no-active-jobs case is tested (RoadmapCompletion.test.ts:263-264).

**Expected impact.** Mean 109,869 raw bytes per publication (about 1.7 KB gzipped). The cost is CPU and GC rather than bandwidth: a structured clone plus JSON.stringify on the server, and JSON.parse plus structuredClone on every client, 5 times a second.

- **Evidence:** `if(state.advancement || TREES.some(tree=>state.research[tree]))this.revision++;`
- **Fix:** use per-player revisions, or send a start tick plus total ticks so the client derives remainingTicks. Keep per-tick remainingTicks available for the local player's own UI.

#### P13. Metadata keys without a revision, and the players list, are sent in full on every publication (network)
- **Where:** `src/skirmish/domain/Expansion.ts:1878-1887` (revision list) vs `1888-1933` (snapshot keys); `SnapshotCodec.ts:173`, `390`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- replicationMetadata() has no revision for these keys: armies, inventories, production, recruitment, activeOffensives, projectiles, aircraft, winners, deliveredGold, tradeSites, tradeCapturedValue, tradeLostValue, tradeEnemies.
- selectMetadata includes any key whose revision is undefined.
- `players` is copied on every encode.
- The server pipeline packs, JSON-encodes and gzips with no memory of the previous packet.

The client decoder (SnapshotCodec.ts:577-583) already keeps keys that are omitted, so omitting unchanged ones would be safe. The tests only assert that progression, diplomacy and events are left out of quiet deltas.

**Expected impact.** The floor for an idle delta, scaling with factions and queued jobs:
- about 19 KB raw / 2 KB gzipped in a fresh 35-faction game;
- about 35 KB raw / 3.2 KB gzipped with 35 players at tick 400;
- the reviewer's ~75 KB raw / ~9 KB gzipped at 47 mature factions, which is about 45 KB/s per client at 5 Hz.

- **Evidence:** `if(full || revision===undefined || this.metadataRevisions[key]!==revision)Object.assign(output,{[key]:source[key]});`
- **Fix:** add revision counters for these keys, and for players, in replicationMetadata.

#### P14. Encoder results only reach the coordinator when the simulation thread yields (network)
- **Where:** `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:27`, `82-84`; `SnapshotEncodingWorker.ts:22-29`; `PublicationQueue.ts:26-30`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.** The encoder thread is a child of the simulation worker, and it posts its results back to that worker. The PublicationQueue tail then posts `{tick, packet}` on to the coordinator. If a result arrives during a synchronous `match.step()`, it waits for the whole step to finish.

**When it matters.**
- With tick headroom, the simulation thread is idle before the next 125 ms advance and forwards the result at once: no added latency.
- When saturated (step ≥ ~100 ms), the extra delay is about step − encode. The perf baseline shows a 110 ms mean step on the target 2-core host, so this is the common regime there.
- Single-tick advances (LiveMatch.ts:716-720) already cut this from a 4-step wait to a 1-step wait.

**Expected impact.** Up to about 80–180 ms extra per publication under late-game load, which is a large share of the 200 ms cadence. Nothing when there is headroom. The reviewer's "mean ~50 ms at 96 ms ticks" is wrong, because 96 + 28 < 125.

- **Evidence:** `const publications = new PublicationQueue(encodePacket, (tick, packet) => diagnostics.measure("transfer", () => parentPort!.postMessage({ publication: { tick, packet } })), …)`
- **Fix:** give the encoder a MessageChannel straight to the coordinator, with sequencing on the coordinator side so baselines and join-barriers keep the ordering that `publications.flush()` guarantees today.

#### P15. Publishing on every executed order becomes publishing every tick when many humans are active (network)
- **Where:** `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:282`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.** `publish = request.publish || commandProgress || any executed outcome`.
- Only human commands count; AI orders don't go through commandApplications.apply. A retried duplicate command id also triggers a publish.
- There is no coalescing and no minimum interval. The only bounds are the 1-tick advance granularity (8 Hz max) and PublicationQueue's capacity of 2, which only skips when encodes fall about 2 ticks behind.
- This is intentional for order latency (comment at 277-281; LiveMatch.ts:727-730). It gets worse with up to 20 human seats.

**Expected impact.** Reviewer figures; the verifiers did not check them:
- 8 Hz publication;
- a capture every tick (4 ms on PC, about 12 ms on ARM);
- about 30 ms of encoder work per tick, roughly 24% of a core per match;
- about 50 KB × 8 = 400 KB/s per client;
- per-publication size barely shrinks: 50 KB at 8 Hz vs 54 KB at 5 Hz.

- **Evidence:** `const publish = request.publish || commandProgress || outcomes.some(outcome => outcome.status === "executed");`
- **Fix:** add a short coalescing window, or a minimum interval, for command-triggered publications.

#### P16. Unquantised radian heading and speed in squadMotion are about 18% of every compressed frame (network)
- **Where:** `src/skirmish/SnapshotDetails.ts:339-347`
- **Severity:** medium (code verifier medium-low, reach verifier low)
- **Votes:** code kept/medium (medium) · reach kept/high (low)

**What happens.** squadMotion writes raw doubles for every squad on every frame: heading and targetHeading from atan2, and speed from Math.hypot. This path is live in every hosted match, because formationLocomotion is true. Arbitrary doubles barely gzip. The client only needs |heading| ≤ π and speed ≥ 0 for rendering, so quantising is safe.

**Corrections.** Formation slot coordinates (FormationSlotStream.ts:64-72) and trader x/y (TraderStream.ts:58) are already whole numbers, so they gzip like Int32 rows. The reviewer's ~30% and ~20% figures counted the size of those sections, not what the encoding costs.

**Expected impact.**
- On a 53,067 B frame, squadMotion takes about 8.9–9.4 KB gzipped.
- Int32 id plus Int16 quantised fields brings that to 3,743 B, saving about 5.1 KB (~10%).
- Narrowing slots and traders saves only about 1.4 KB and 0.1 KB more.
- Realistic total saving: about 12%.

- **Evidence:** `squadMotion[at + 1] = number(s.locomotion?.heading); squadMotion[at + 2] = number(s.locomotion?.targetHeading); squadMotion[at + 3] = number(s.locomotion?.speed);`
- **Fix:** quantise heading to Int16 in units of 1/10,000 rad, and speed to fixed-point Int16.

#### P17. Per-squad JSON detail strings dominate raw size and client parse work (network)
- **Where:** `src/skirmish/SnapshotDetails.ts:160-175` (encode), `498-500`/`613` (decode)
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- SquadDetailCache.encode emits one JSON object per squad, repeating the same 14 key names every time.
- These go into a per-packet strings table that only deduplicates byte-identical strings.
- Every client JSON.parses each row once per publication. That is by design: one owned object per row.
- Formation objects are replaced on every move step and weaponState on every shot, so moving or fighting squads re-stringify those fields.

**Corrections.** In the reach re-measure the miss rate was about 10% (660 of 6743), with about 48 stringify calls per publication, not 31% and ~130. The quoted hits and misses were cumulative counts, and stringify runs per missed field.

**Expected impact.**
- At about 400–460 changed squads: roughly 150–188 KB raw, about 35% of the raw payload. Mean string length is about 343 characters.
- About 8.5–9.8 KB compressed, which is 16–21% of a 45–53 KB frame.
- About 440 JSON.parse calls per client per publication.

- **Evidence:** `return JSON.stringify(i === 7 && this.slots ? this.slots.encode(s.id, input as FormationState | undefined) : input);` then `value += separator + SQUAD_DETAIL_PREFIXES[i] + parts[i];`
- **Fix:** move the detail fields into typed columns or a compact encoding keyed by schema (no repeated key names), and decode them lazily on the client.

#### P18. The heartbeat drops a socket after one missed 5 s pong, which turns short network blips into global rejoin pauses (network)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:495-503`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.** Every 5 s the heartbeat terminates sessions still marked dead and pings the rest. Only a pong marks a session alive; ordinary message traffic doesn't count. A termination then sets off a chain:

1. close → match.disconnect;
2. the client rejoins automatically within 15 s;
3. qualify's admission path sets this.sync;
4. advance() stops stepping for everyone;
5. a full baseline is broadcast to all clients.

**What actually triggers it.** Browsers answer pings in the network stack, so JS stalls and tab throttling don't miss pongs. OS sleep, radio hand-over and link congestion do. Under congestion the ping also queues behind large state frames on the same socket, so a slow client gets killed and then handed yet another baseline.

**Existing bounds.** The nextSyncAt cooldown, pauseBudgetMs (15 s per 60 s) and the 30 s sync expiry limit how often this can happen. There is no heartbeat test.

**Expected impact.** Any network blackout longer than about 5 s on a seated player becomes a global pause plus a ~290–450 KB baseline broadcast.

- **Evidence:** `if (!session.alive) client.terminate(); else { session.alive = false; client.ping(); }` (interval 5000)
- **Fix:** tolerate 2–3 missed pongs, or treat any received frame as proof of life. Consider a cheaper resume path for a returning player in the same seat.

#### P19. Synchronous route repair and detour work is invisible to the effort limiter (simulation-perf)
- **Where:** `src/skirmish/Simulation.ts:610-612` (drainRouteBatch), `4092-4100` (LocalDetours in repairNavigation); `4036-4038`, `4053-4054` (recovery queueing)
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/medium (medium)

**The limiter.** drainRouteBatch runs up to 60 one-unit tasks per tick. Its 20,000 effort cutoff reads only `this.paths.work`, and it checks only after each task.

**Work the limiter doesn't see.**
- Every repair first runs LocalDetours.find: an A* over a FIXED/8 lattice (up to about 97×97), up to 6000 expansions with 8 neighbours each. Every `clear()` call runs movementPolicyClear, fortifications.clearMovement, traversable, and a scan of held squads within 10 FIXED. None of this is counted.
- A successful detour returns before findExact, so paths.work doesn't move at all.
- For amphibious players, findExact charges `amphibiousPaths.work`, which the limiter never reads.

**Corrections.**
- For land players the findExact fallback is metered, so about 10 failing land repairs do hit the cutoff.
- recoverNavigation queues a repair at most once per second per stalled move squad.
- The realistic trigger is move squads stalled behind friendly holding or arrived squads (or non-hostile ones). Contact with hostiles tends to switch the order to attack instead.
- The comment at Simulation.ts:497 says 24 jobs per tick; the code allows 60.

**Expected impact.** Up to 60 × (6000 expansions × 8 clear checks) per tick, none of it visible to the limiter. The reviewer's probe saw routing ticks of 70–182 ms; the verifiers did not reproduce those numbers.

- **Evidence:** `this.routeWork.drain(480/TICKS_PER_SECOND, { read: () => this.paths.work, limit: ROUTE_EFFORT_LIMIT, }` and, in LocalDetours, `while (heap.size() && expanded < 6000)`
- **Fix:** charge LocalDetours expansions and `amphibiousPaths.work` to the effort counter the limiter reads.

#### P20. The admission budget is spent on requests the route planner refuses (simulation-perf)
- **Where:** `src/skirmish/MovementAdmission.ts:961-969`; `RoutePlanner.ts:525-531`
- **Severity:** medium (reviewer: high)
- **Votes:** code kept/high (medium) · reach kept/medium (medium)

**What happens.** In the routes phase, a saturated RoutePlanner refuses `request()`: non-priority requests at 120+ jobs, uncommitted background requests at 104+. The refusal still does `used++` and `idle=0`, and sets no retryAt. The round robin therefore asks for the same members again within the same tick until the 80–320 unit budget is gone. Each attempt also rebuilds the request context and the obstacle-revision string. That budget is taken away from formation, connector and queued work on other AI admissions.

**Corrections.**
- Deadline rejections come mostly from planner capacity, not from this.
- In live matches autonomousRouteDeadlineTicks is unset. There is no deadline and no re-think loop; admissions stay pending and retry.
- Humans have 24 slots of headroom over AI admissions, not 8, and stepInteractive and the priority pass serve them first.
- No test covers `request()` returning false.

**Expected impact.**
- Reviewer's 52-faction probe: 104–120 planner jobs and 50–320 admissions waiting.
- Match-259 profile: 49,824 of 50,507 requests refused in 600 ticks.
- So while the planner is saturated, most of the admission budget goes on refusals.

- **Evidence:** `member.requested = this.ports.request(id, admission.playerId, member.id, start, goal); used++; idle = 0;`
- **Fix:** on refusal, set a short retryAt, or skip without charging budget when the planner is full.

#### P21. resolveLandDamage allocates per squad and makes extra O(S) passes even when nothing was hit (simulation-perf)
- **Where:** `src/skirmish/Simulation.ts:4603` (damageManpower with no `dealt > 0` guard), `4618-4624`; callers at `Battle.ts:1112`, `1653`
- **Severity:** medium
- **Votes:** code kept/high (medium) · reach kept/high (medium)

**What happens.**
- The loop walks every squad, not just the ledger keys.
- It calls damageManpower even when dealt === 0. damageManpower always returns a new result object and a spread copy of manpower; the identity check afterwards only skips the write, not the allocation.
- Then syncFormationCounts(this.squads), `squads.filter(troops<=0)` and `[...squads].reverse()` each walk all squads again.

**Correction.** In expansion matches it runs at least twice per tick without any guard (at the end of Battle.fight and in advanceProjectiles), plus a third time on afloat hits. The cost is roughly double what was claimed. The early manpowerCount call in recordSoldierCasualties is a negligible lookup.

**Expected impact.** At S = 1500, about 3000+ short-lived objects and about 12,000 iterations per tick that find nothing to do. The reviewer links this to the 10–23 ms combat floor and a 7.9% GC share; that link is unverified.

- **Evidence:** `const resolved=damageManpower(squad,Math.round(dealt*HEALTH_SCALE));` (no `dealt > 0` guard) and `this.syncFormationCounts(this.squads); this.conquest.losses(this.squads.filter((s) => s.troops <= 0), damage); for (const squad of [...this.squads].reverse())`
- **Fix:**
  - Return early when `damage.size === 0` (keeping the combatTicks bump).
  - Otherwise iterate the ledger's target ids and skip dealt === 0.
  - Run sync, filter and remove only over squads that were damaged.

### Low

#### P22. candidates() recomputes type-independent trade evidence inside its per-type loop (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiPlacementCandidates.ts:209-221` (loop starts at 160)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** These values don't depend on the building type, but they are recomputed for every type that passes the tech gates:
- the factory and port counts;
- two tradeQuotes.best lookups;
- growth(false) and growth(true), each of which may call Trade.sourceStatus → refreshMarkets.

That can be up to 21 passes, because types that hit an early continue don't increment `tested`. So it is up to about 42 sourceStatus calls per candidates() call, not 16. refreshMarkets normally returns early from its memo.

**Corrections.** The port anchor set is built at most once per call, since only "port" uses it. AiEconomicDirector.ts:343-345 already computes the same evidence before calling candidates().

**Expected impact.** Placement costs about 0.11 ms/tick in total. Cleanup only.

- **Evidence:** `const productiveLand = this.expansion.economy.tradeQuotes.best(player.id,false); … const landGrowth = growth(false), seaGrowth = growth(true);` inside the loop
- **Fix:** hoist lines 209-221 above the loop and reuse the director's evidence.

#### P23. Background planner budgets are fixed constants that ignore faction count (ai-economy-naval)
- **Where:** `src/skirmish/domain/AiEconomicDirector.ts:204-222`; `AiCoastPlanner.ts:158`; `AiNavalPlanner.ts:271`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.**
- The per-tick allowances are fixed: boundaries 32, fronts 16, navalFacts 48 − fronts, naval 16, army ≤ 24, trade and coasts ≤ 8 each, and cities get the rest of 128. None of them scale with `world.players.length`.
- Naval and coast each serve one faction per tick, and the coast cursor also wastes turns on tribes and humans.
- So per-AI planning latency grows linearly with the number of factions.

Not using a millisecond-based budget is intentional. The budgets are deterministic work units ("browser time never controls the budget"), and a test pins the 128/48/16 values.

**Expected impact.** The reviewer measured economy.step at 1.1 ms of a 37 ms tick with 45 factions; this is unverified. Each faction's naval and coast planning progresses only once every N/8 s, about 5.6 s at 45 factions.

- **Evidence:** `const coastWork = this.coasts.step(Math.min(8,Math.max(0,112-…)));` and `const player = world.players[this.cursor++ % world.players.length]; if (!this.economy.enabled(player)) return 0;`
- **Fix:** skip non-enabled factions in the coast cursor, and derive the deterministic allowances from the number of enabled AIs.

#### P24. Tribes retry the same rejected build tiles on every pass (ai-economy-naval)
- **Where:** `src/skirmish/domain/Expansion.ts:1622-1631`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** Each AI tribe gets a pass every 3 s. A pass tries at most 16 build candidates for one building type, plus one port attempt, through applyCommand. There is no legality pre-filter, and rejected tiles are not remembered.

**Corrections.**
- It is 16 per pass in total, not 16 per type.
- The suggested world.buildingSite pre-check would not help, because it runs the same buildRejection + constructionRejection that applyCommand's build path already runs.
- The line the reviewer cited (1553) is diplomacy code.

**Expected impact.** The reviewer counted 25,830 tribe build attempts in 10 minutes (about 43/s, or about 5 placement validations per tick), versus 1,095 recruits. Minor.

- **Evidence:** `for (let i = 0; i < Math.min(16, candidates.length); i++) { … if (this.world.applyCommand({ type: "build", … }) === null) return; }`
- **Fix:** remember rejected tiles per type with a short expiry, or skip tiles that already hold a building.

#### P25. The AiOperations sleep key includes every faction's ready count, so the 10 s peace sleep rarely triggers (ai-strategic)
- **Where:** `src/skirmish/domain/AiOperations.ts:309-310`, `325-326`, `441`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** sleepKey embeds ageKey, which contains `forces.get(id)` (the ready-squad count) for every player, plus the AI's own land. In a large active match that changes between 3 s thinks, so the 10 s sleep almost never triggers and peaceful AIs stay on the designed 3 s cadence. Including rival strength is intentional.

**Corrections.**
- refreshTheatres and expansionBlocked run before the sleep check, so sleeping never skips them anyway.
- Sleep only saves forceReadiness, the invasionTroops reduce, and the bounded candidate slice. That slice is already cheap: at most 4 rivals per think, combatCohorts memoised per tick, formationEnvelope cached.
- When the rival scan spans several ticks, nextThink isn't advanced, so refreshTheatres and forceReadiness run again on every continuation tick.
- Rebuilding ageKey and diplomacyKey every tick is trivial.
- There are no sleepKey tests.

**Expected impact.** Minor. Nobody has measured how often ready counts change within 3 s at 1100 squads.

- **Evidence:** ``const ageKey = world.players.map(p => `…:${forces.get(p.id) ?? 0}:${p.eliminated}`).join(",");``
- **Fix:** make the key coarser, for example bucketed counts, or only eligible or hostile rivals.

#### P26. The thinkProgression stagger uses only 8 of its 24 phases (ai-strategic)
- **Where:** `src/skirmish/domain/Expansion.ts:1386-1387`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.** `tick % secondsToTicks(3) !== (player.id*3) % secondsToTicks(3)` only ever selects ticks ≡ 0 (mod 3). Up to 44 AI factions (14 regular + 30 tribes; humans are skipped) therefore share 8 slots: about 5.5 per slot, at most 2 of them regular AIs. 16 of every 24 ticks carry no strategic work.

**Corrections.**
- The heavy `ownedLandNearest(…,256)` site search is disabled under the default aiEconomy:true. The per-slot work that remains is thinkPeace, thinkAirAndStrategic and capped tribe development.
- The previous build ran at 20 Hz with 20 slots, not 10 Hz. Slots and tick budget scaled down together, so the relative load is unchanged; the absolute ms per strategic tick went up.
- AiOperations' `id % TICKS_PER_SECOND` is relative jitter, not a slot collapse.

**Expected impact.** A smoother distribution of tick times. No correctness effect.

- **Evidence:** `this.world.tick % secondsToTicks(3) !== (player.id * 3) % secondsToTicks(3)`
- **Fix:** use `player.id % secondsToTicks(3)`, or any phase coprime with the period.

#### P27. HUD refresh repeats redundant passes over squads and ships (client)
- **Where:** `src/skirmish/client/main.ts:878` (updateHud), `1114-1116` (updateGroups); `ControlGroups.ts:59-70`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**Corrections.**
- updateHud runs once per animation frame when hudPending is set (main.ts:2141), not on the deserialise task.
- updateGroups only recalls digits that have members.

**What remains.**
- recall re-runs prune (already done at snapshot time) plus a squad filter, for each bound group.
- recruitmentQuote filters buildings once per kind.
- Two selection filters, the troop loop, and HudViewModel's buildings pass.

That is roughly 8–12 baseline passes plus about 3–4 per bound group, not ~30.

**Expected impact.** Sub-ms to low-ms per frame at about 1400 entities.

- **Evidence:** `recall(digit, snapshot) { this.prune(snapshot);` and `const recalled = snapshot && groups.count(digit) > 0 ? groups.recall(digit, snapshot) : undefined;`
- **Fix:** drop the redundant prune in recall, cache recall results per snapshot tick, and share one buildings scan across recruitment kinds.

#### P28. BuildingFacts.changed compares fire-timer fields that nothing it rebuilds uses (client)
- **Where:** `src/skirmish/client/BuildingFacts.ts:3`; the rebuild is at `Renderer.ts:491-541`
- **Severity:** low
- **Votes:** code refuted/high (low) · reach kept/high (low) · repro kept/high (low)

**What happens.** A change in any compared field rebuilds buildingStacks, occupiedBuildingTiles and the ground clearing.

**What is actually wrong.**
- The reviewer's fix, keying only on id/owner/type/tile/age, would cause a regression. buildingStacks aggregates health, maxHealth, remainingTicks and buildTicks for the health bars and the construction countdown, and ArchitectureOptimization.test.ts:86-92 requires damage to register as a change.
- Only nextAttackTick and launchReadyTick are dead keys. The HUD reads those directly from snapshot.buildings.
- remainingTicks already forces a rebuild on most snapshots whenever anything is under construction, so this is not specific to sieges.

**Expected impact.** Near-negligible: O(buildings × footprint) per snapshot.

- **Evidence:** `const fields = ["id", "playerId", "type", "tile", "remainingTicks", "buildTicks", "age", "health", "maxHealth", "nextAttackTick", "launchReadyTick"]`
- **Fix:** remove the two tick keys. Optionally rebuild occupancy and ground clearing only when the set of id/type/tile changes.

#### P29. Presentation-only combat facts live on authoritative Squad state and are cloned every checkpoint (combat)
- **Where:** `src/skirmish/domain/Battle.ts:326`, `433-456` (meleeStrike, combatFact); `CombatFact.ts:2-8`; `CavalryMelee.ts:44`
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/medium (low) · reach refuted/medium (low) · repro kept/medium (low)

**What is real (narrowed).** meleeStrike (at most 8 contacts) and combatFact (at most 6 modifier strings of up to 32 characters) are documented as presentation-only: "damage never reads these facts". But they live on Squad, so:
- Skirmish.checkpoint structuredClones them every tick (COMMIT_TICKS = 1);
- they change in deltas on every hit tick.

**Where the reviewer was wrong.**
- targetBody, lunge, rankCounts, strikeDepth and reshape are authoritative damage inputs, frozen at commit time (Battle.ts:671-683). Recomputing targetBody from the live target would change combat outcomes.
- Real hulls have about 4–11 points, nowhere near the 1152 validator cap.
- The citation CombatFact.ts:186-190 is wrong; the file has 19 lines.
- SquadDetailCache already limits encode cost to objects that changed.

**Expected impact.** Measured about 2–6 ms of extra clone time with 300 cavalry squads all in melee at once. Bounded and deliberate.

- **Evidence:** `/** Latest committed attack explanation. Presentation and AI never drive damage through it. */` (CombatFact.ts:8)
- **Fix:** optionally move meleeStrike and combatFact to a transient per-tick stream. Keep the contact geometry in state.

#### P30. encodeBaseline packs snapshot details twice (network)
- **Where:** `src/skirmish/SnapshotCodec.ts:200-205` (throw-away encoder), `393` (first pack)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** encodeBaseline creates a throw-away SnapshotEncoder without compactFormationSlots. Its encode() packs details for every squad using a fresh cache: every squad is a miss, and formation JSON is uncompacted. encodeBaseline then overwrites packet.details with a pack from the live cache, which always happens on the server because compactFormationSlots is true there.

The wasted work is the first pass; the second is mostly cache hits. This affects every join barrier and every recovery baseline.

**Expected impact.** Removes the first detail pack per baseline. The reviewer's "roughly halve 38 ms" is unsupported, because tiles, squads and orders are only packed once.

- **Evidence:** `const packet = new SnapshotEncoder(true, { compactTraders: this.compactTraders }).encode(source, journal, facts); if (this.detailCache.compactFormationSlots) { packet.details = packSnapshotDetails(…) }`
- **Fix:** skip details in the throw-away encode, or construct it with the live detail cache.

#### P31. SHA-256 of the uncompressed payload on both ends is redundant on the live path (network)
- **Where:** `src/skirmish/multiplayer/StateCodec.ts:377` (encode), `416-417` (decode)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** Every live publication hashes the full uncompressed buffer, and every client hashes it again. On the live path the hash is used only as a required frame metadata field (SnapshotWireCodec.ts:11, 23). Integrity is already covered by TLS/TCP and by gzip's CRC-32.

The hashing runs in worker threads on both ends, so it is off the main and render threads but on the publication latency path. It can't be removed from encodeState outright, because CommitVerifier and HostedRuntime chain on it.

Correction: the wire overhead is a 64-character hex string, not 32 bytes.

**Expected impact.** The reviewer estimates about 1 ms per side per publication on desktop, more on phones.

- **Evidence:** `return { hash: await diagnostics.measureAsync("hash", () => digest(bytes)),`
- **Fix:** add an opt-out for the binary live profile, and loosen the SnapshotWireCodec metadata schema to match.

#### P32. CompressionStream gzip at level 6 is the slowest codec choice for the hot path (network)
- **Where:** `src/skirmish/multiplayer/StateCodec.ts:370-374`; decode at `391`/`394`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** Every publication is compressed with WHATWG `CompressionStream("gzip")` at zlib's default level 6. This runs in the dedicated SnapshotEncodingWorker, not on the simulation thread.

**Corrections.**
- The ~19 ms figure is either the whole "encoding" phase or a single heavy-load ARM profile. Typical ARM compression means are 2.5–10 ms, with p99 at 10–17 ms.
- decodeState's hardcoded gzip is shared with durable checkpoints (CommitVerifier, HostedRuntime) and with the browser worker, and tests forge gzip payloads. Changing the format for live snapshots therefore has to be scoped and versioned.

**Expected impact.** Benchmarks show level-3 deflate is about 3–10× cheaper (for example 2.25 ms → 0.23 ms per 75 KB), for frames about 3–20% larger. The saving is CPU on the second core of the 2-core host.

- **Evidence:** `new Response(bytes).body!.pipeThrough(new CompressionStream("gzip"))`
- **Fix:** in the Node encoder, use zlib `deflateRawSync` at about level 3 for the binary snapshot path only, with `DecompressionStream("deflate-raw")` on the client, and version the format.

#### P33. The coordinator clones and stringifies the lobby state 40 times a second, and sends the directory to in-match players every second (network)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:453-454`, `488-492` (clock), `213-226`/`494` (publish)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.**
- The 50 ms clock compares `JSON.stringify(rooms.snapshot())` before and after each tick. snapshot() is a structuredClone, so that is two deep clones and two stringifies per tick (40/s each) even when idle. On a change there is a third clone plus store.write.
- publish() runs every second to every session, including in-match sessions, which discard it after the first one.

The 1 s cadence is intentional, because runtime-derived summaries don't show up in the state diff. All of this runs on the shared coordinator thread, and none of it is new.

**Expected impact.** Small. The fan-out is one stringify per socket per second.

- **Evidence:** `const clock = setInterval(() => { const before = JSON.stringify(rooms.snapshot());`
- **Fix:** add a dirty flag or change counter on RoomCoordinator, and skip or slim the directory for sessions bound to a matchId.

#### P34. The binary snapshot frame is re-encoded and its body copied for each client (server-lifecycle)
- **Where:** `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:200-205`; `SnapshotWireCodec.ts:20-30`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.** send() calls encodeSnapshotFrame once per recipient. Each call allocates a header, the metadata JSON, and a memcpy of the shared compressed body. textSnapshotPacket caches per packet; the binary path doesn't.

The per-client fields (flowEpoch, rebase) only affect the metadata, so the body copy is the part that could be shared. ws server sends add no further copy. ClientStateFlow (window 4) skips clients with 4 unacked frames, so the per-client rate is an upper bound.

**Expected impact.** The reviewer estimates about 40 allocations/s and about 2.4 MB/s of memcpy per match at 8 humans × 5 Hz. Docs cite about 19 KB per client for deltas, so the real figure may be 2–3× lower.

- **Evidence:** `const frame = diagnostics.measure("transport", () => encodeSnapshotFrame(state));` called per client
- **Fix:** send the header+metadata and the shared body as separate fragments, or move the per-client fields out of the frame.

#### P35. stepWarships scans all buildings for each repairing ship, and waiting ships scan every tick (simulation-perf + sweep-simulation)
- **Where:**
  - `src/skirmish/Simulation.ts:3221` and `3269-3270`: `.find` for repairing / returning-to-dock ships
  - `3009` and `3056`: `.filter` in the dock searches
  - `3299-3300`: the waiting-for-dock branch
- **Severity:** low
- **Merged:** simulation-perf "stepWarships scans all buildings per repairing ship" (`:3212`) and sweep-simulation "stepWarships scans all buildings per ship per tick for repair ports" (`:3214`)
- **Votes:**
  - simulation-perf: code kept/high (low) · reach kept/high (low)
  - sweep-simulation: code kept/high (low) · reach kept/high (low)

**What happens.**
- Repairing and returning-to-dock warships do a linear `this.buildings.find` for their repairPortId every tick, even though `building(id)` is O(1). The number of these ships is capped by occupied friendly ports, since each port takes one ship.
- findNearestDockWithCapacity and findNearestPortBerth filter the whole building list, even though `buildingIndex.byType(playerId, "port")` exists.
- The bigger cost: ships in waiting-for-dock call findNearestDockWithCapacity every tick with no throttle. Only the initial damaged-ship search at 3332 is throttled to every 0.5 s. The number of waiting ships is not capped by ports.

**Expected impact.** A few thousand to about 15k short-circuiting comparisons per tick for repairs. The waiting-for-dock full scans scale with waiting ships × buildings × 8 per second.

- **Evidence:** `const port = this.buildings.find((b) => b.id === ship.repairPortId && b.type === "port" && …` and `if (ship.repairState === "waiting-for-dock") { const dock = this.findNearestDockWithCapacity(ship, occupiedPorts);`
- **Fix:**
  - Use `this.building(ship.repairPortId)` plus the same checks.
  - Use `buildingIndex.byType` in both dock searches, keeping the port order deterministic.
  - Throttle the waiting-for-dock search.

#### P36. RoutePlanner.step rescans and re-spreads the whole job table on every quantum (simulation-perf)
- **Where:** `src/skirmish/RoutePlanner.ts:561`, `586-594`, `377-381`, `444`, `682-683`
- **Severity:** low
- **Votes:** code kept/medium (low) · reach kept/medium (low)

**What happens.**
- step() spreads the job map once for the deadline sweep, three times for pinSharedPreparation, and once for humanWaiting.
- On every quantum, selectJob collects every eligible job and nextJob rescans them.
- The table is capped at 128 jobs (jobLimit), and classification is cached per epoch, so each visit is cheap.

**Context.**
- Visits per second are the same as at 20 Hz, because the budget is fixed at 81,920 units/s. What grew is the per-tick spike: up to about 41k visits in one tick when saturated.
- Sweeping deadlines once per second instead would change the deterministic timing of "limited" completions, so it is not a drop-in fix.

**Expected impact.** The reviewer's live profile attributed 5.8% to selectJob at 20 Hz. The share should be similar now, with a bigger per-tick spike.

- **Evidence:** `for (const job of [...this.jobs.values()]) {` (deadline sweep) and `while (this.jobs.size && used < budget) { const selected = this.selectJob(job => !deferred.has(job));`
- **Fix:** maintain per-class counters on insert and retire instead of rescanning.

#### P37. Elimination transfers the whole victim territory in a single tick (simulation-perf)
- **Where:** `src/skirmish/Simulation.ts:5483-5491` (checkWinner). Absorption (`3658-3664`) and nuclearBlast (`4821-4832`) have the same shape.
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.** Each changeOwner does a fixed amount of work: invalidateCapture over a radius-3 disc, small allocations, and about 8 domain notifications. The route-cache clears cost nothing after the first one.

**Corrections.**
- The scan of all buildings per former owner can't run at elimination time, because an eliminated faction has no living completed city.
- The squad sort only runs on captured building tiles.
- Measured cost is about 5–9 µs per tile.
- The reviewer's 516 ms probe tick can't be pinned on eliminations: windows with no eliminations reached 406 ms.

**Expected impact.** About 10 ms per 1000 tiles: roughly 35–45 ms for 5,000 tiles and about 100 ms for 20,000. It only goes over the 125 ms budget for very large factions, or several large eliminations in the same tick.

- **Evidence:** `for (const tile of [...(this.ownedTiles.get(player.id) ?? []), ...(this.ownedWater.get(player.id) ?? [])].sort(…)) { … this.changeOwner(tile,recipient); …}`
- **Fix:** optionally, time-slice the transfer through a budgeted queue.

#### P38. Any new building placement invalidates the capture row cache (simulation-perf)
- **Where:** `src/skirmish/Simulation.ts:4683-4684` (environment), `4693`/`4698` (key)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.**
- `environment` includes `this.paths.revision`, which bumps on every ForestField publish.
- Forest.footprint flips cleared state whether or not the tile had forest on it. So almost every building placed on fresh ground, not only forest, bumps the revision.
- On the next tick every land squad's capture row is invalidated, which reruns captureQuery, the footprint filter, and the diff.

Path cost never affects capture eligibility, so `paths.revision` doesn't belong in this key.

**Cautions for the fix.**
- Alliance invalidation is semantically required. Don't swap it for diplomacy.revision: that misses direct `state.alliances` mutations in IncrementalCapture.test.ts and bumps on unrelated offers.
- Under raids, the buildingsAt check in captureEligible may need a building-index revision if paths.revision is removed.

**Expected impact.** The reviewer's probe windows showed refreshed = 1114 and reused = 0 at S ≈ 1150.

- **Evidence:** ``const environment=`${this.paths.revision}:${this.expansion?.fortifications.version??0}:`+ …``
- **Fix:** drop paths.revision from `environment`, and add a building-index revision for the raids buildingsAt check if needed.

#### P39. AttackApproaches.rebuild and thinkAi grouping allocate O(S) structures every tick (simulation-perf)
- **Where:** `src/skirmish/AttackApproaches.ts:73`; `Simulation.ts:4890-4896`
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.**
- rebuild builds `targets = new Map(squads.map(…))` over all land squads every tick. That map is only read inside groups with two or more melee attackers.
- thinkAi builds per-owner arrays of non-embarked squads every tick.

**Corrections.**
- squadIndex.byOwner includes embarked squads, so it is not a drop-in replacement.
- `armies` also feeds operations.step for all players.
- The `loads` pass is a required O(S) pass.

**Expected impact.** Constant-factor GC churn on loops that are already O(S).

- **Evidence:** `const targets = new Map(squads.map((s) => [s.id, s]));`
- **Fix:** build `targets` lazily, or look squads up by id. Cache a by-owner view of non-embarked squads.

#### P40. Accepting an alliance or peace scans every map tile and stringifies diplomacy state twice (sweep-ownership)
- **Where:** `src/skirmish/domain/Expansion.ts:468`/`475` (stringify), `540-546` (tile loop)
- **Severity:** low (reviewer: medium)
- **Votes:** code kept/high (low) · reach kept/high (low)

**What happens.**
- Every alliance command stringifies `diplomacy.state` twice.
- Every accepted alliance or peace loops over every tile, clearing claims between owners who are now allied.
- AI acceptance reaches this path through thinkPeace → command. The AI's offer-peace path calls diplomacy.action directly and skips the loop.
- Acceptances are rate-limited: pending offers are deduplicated, there is a 300 s per-pair cooldown, and the AI checks its context first.

**What already exists for a fix.** Skirmish.activeClaims is a superset of the claimed tiles (Simulation.ts:4781 is the only non-zero claim write), and diplomacy.revision already exists.

**Expected impact.** Measured about 0.8–1.3 ms warm and about 7 ms cold per accepted alliance on a 1M-tile map, plus about 0.1 ms for the stringifies. Not a stall.

- **Evidence:** `for (let tile = 0; tile < world.owners.length; tile++) if (world.claims[tile] && this.diplomacy.allied(world.owners[tile], world.claims[tile])) {`
- **Fix:** iterate Skirmish.activeClaims (exposed through ExpansionWorld) instead of every tile, and compare diplomacy.revision instead of stringifying.

#### P41. Per-tick ship sort copy and dead embarkedOn scans (sweep-simulation)
- **Where:** `src/skirmish/Simulation.ts:2753` (fightShips sort), `2985-2989` (legacy cargo loop), `1974-1975` (recordNavalLosses), `4872-4879` (captor XP sort)
- **Severity:** low
- **Votes:** code kept/high (low) · reach kept/medium (low)

**What happens.**
- **Ship sort.** fightShips copies and sorts all ships every tick. Ship ids are already monotonic (there is a single `nextId++` site) and restore preserves order. TimSort on sorted input is about an O(N) copy, so this is mostly a wasted copy.
- **Dead embarkedOn scans.** Live code never sets embarkedOn to anything but null, so the embarkedOn scans find nothing. The per-tick one is resolveNavalDamage's `[...this.squads].reverse()`, which fightShips calls every tick even when nothing sank.
- **Event-only cost.** recordNavalLosses scans only on ticks when a ship sinks.
- **Captor XP.** The full sort runs only on hostile building captures, and a min scan would do.

**Expected impact.** Small. Mostly one O(S) copy per tick of dead work.

- **Evidence:** `for (const ship of [...this.ships].sort((a, b) => a.id - b.id)) {` and `for (const squad of [...this.squads].reverse()) if (squad.embarkedOn !== null && sunk.has(squad.embarkedOn))`
- **Fix:**
  - Drop the sort copy.
  - Guard the legacy cargo loop on `sunk.size`.
  - Use a min scan for the captor.

---

## Refuted during verification

These 24 findings were refuted by a majority of verifiers. They are listed so the owner can see what was considered.

| Area | Title | path:line | Why refuted |
|---|---|---|---|
| network | Expansion.snapshot builds every metadata section before selectMetadata discards most of it | `src/skirmish/domain/Expansion.ts:1886` | Keys without a revision (armies, tradeSites, tradeEnemies) are kept and sent on every capture, not discarded. The work that is discarded (productionPlans, receipts spread, pairRelations) is small or cached. |
| server-lifecycle | Authenticate-path rollback can discard concurrent coordinator mutations | `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:429` | When active.length is 0, the only await is `await Promise.all([])`, a microtask, so the 50 ms clock cannot interleave. When matches are active, matchRequest=true skips the rollback. |
| combat | Combat is float-based; fractional tick constants in cavalry timing | `src/skirmish/domain/CavalryMelee.ts:11` | The constants and xp/health use exactly rounded +, * and / followed by floor/ceil. The game is server-authoritative on a single host with no cross-engine replay, and Node 24 is already pinned (package.json engines, Dockerfiles). |
| combat | hybridAcquisition caches live Squad object references across ticks | `src/skirmish/domain/Battle.ts:630` | Correct today: records are mutated in place, CombatActivity bumps the epoch on removal/owner/afloat changes, Battle.restore clears the cache, and stale entries are pruned per tick. A repro found 0 identity mismatches. At most a hardening note. |
| ai-strategic | Invasion response steals army-mission squads; planner then releases every mission | `src/skirmish/domain/AiInvasionResponse.ts:139` | The roster loop skips Army members at lines 147-148, and a repro stole 0 mission squads. One code verifier traced a narrower stale multi-chunk-roster path at line 173 (medium, not simulated). |
| ai-strategic | Candidate scan indexes world.players by a numeric cursor | `src/skirmish/domain/AiOperations.ts:407` | world.players is append-only: the only push is in createPlayers, restore preserves order, and elimination is a flag. The cursor and the array are checkpointed together. |
| ai-strategic | Every restore()-based test fails locally: instanceof Uint8Array across the jsdom realm | `src/skirmish/Simulation.ts:246` | This only happens when tests/skirmish is run under the root jsdom config via --dir. `npm run test:skirmish` (node env) passes those suites; the one failure there is unrelated, in AiLateGame. |
| ai-economy-naval | Restored AiRouteQuotes with requested:true cannot complete until their 60 s expiry | `src/skirmish/domain/AiRouteQuotes.ts:144` | The route planner job queue is checkpointed (planning.jobs) and restored, so the completion still arrives and matches by admissionId. |
| simulation-perf | Movement work is O(all land squads), not O(moving squads) | `src/skirmish/Simulation.ts:3481` | Measured at 1000 squads: holding costs 2.5–4 ms, marching 14–23 ms. Holding squads skip routing, the avoidance solve and locomotion. What is left is a floor of about 3–9 µs per squad (low). |
| simulation-perf | AI think does an O(frontier) aiFootprintAllowed scan per AI player nearly every tick | `src/skirmish/Simulation.ts:4970` | Under raids-v1 (all live and local matches), aiFootprintAllowed is an O(1) canEnter check, measured at about 0.05 ms/tick. The radius scan only runs in legacy non-raids configs. |
| simulation-perf | Polymorphic squad records and per-tick spreads keep GC pressure high under the 384 MB worker cap | `src/skirmish/EntityCollection.ts:66` | Short-lived objects die in young-generation scavenges, which the old-generation cap does not limit. A capped probe with 1716–3356 squads saw 4–9 major GCs over 200–600 ticks (about 0.5–1.8% of tick time) and a live heap of about 100–115 MB. |
| simulation-perf | changeOwner can silently leave tiles owned by an eliminated faction under raid diplomacy | `src/skirmish/Simulation.ts:4815` | All buildings on a tile always share the tile's owner: building requires owning the tile, and transfers move whole stacks. Recipient 0 skips the raids guards, so the guard cannot fire during elimination. |
| client | Ctrl+digit 'replace group' binding may be swallowed by browser tab switching | `src/skirmish/client/Controls.ts:78` | Ctrl/Cmd+1..9 is not a reserved accelerator in Chromium or Firefox, so preventDefault() works. The action is also reachable via Ctrl+click on the HUD buttons and is documented. Alt+digit would be worse, since it is a tab switch on Linux. |
| sweep-simulation | Elimination assigns buildings to owner 0; consumers indexing player state by building.playerId crash | `src/skirmish/Simulation.ts:5442` | Every consumer cited skips owner 0: the Supply loop skips non-players, Trade markets are built per real player from owner-indexed buckets, and MilitaryInfrastructure guards for it. A scratch run of 250 ticks plus a restore did not throw. |
| sweep-simulation | moveDestination trusts order.y! while client x/y are copied into admission intents | `src/skirmish/Simulation.ts:3852` | Every activation path replaces client x/y with a domain formation point; FormationPlanning only reaches "done" once every member has a point. A repro across 4 option combinations found 0 bad orders. Informational hygiene only. |
| sweep-ownership | Expansion.snapshot mutates checkpointed Roads cache/dirty during publication | `src/skirmish/domain/Expansion.ts:1898` | Roads.cache/dirty is a pure memo of tiles. Restored states behave identically, and no production path compares checkpoint bytes across publish cadences. Hygiene note: drop the memo from the checkpoint. |
| sweep-ownership | Match-269 dereference pattern survives: unguarded progression.states[owner].completed | `src/skirmish/domain/Trade.ts:386` | No current caller can pass an owner without a progression entry. Markets are rebuilt per live player from owner-indexed views, and sourceStatus returns early for owner 0. Line 386 is only a dead variable. |
| sweep-ownership | Bulk re-own of all buildings on a captured tile and the raids guard interact badly for mixed-owner stacks | `src/skirmish/Simulation.ts:4848` | Mixed-owner stacks cannot be created: placement requires owning the tile, transfers move whole stacks, and preserveStructures is only used with id 0. At most a suggestion to assert the invariant. |
| sweep-determinism | Restored-checkpoint float reproducibility depends on the V8 version | `src/skirmish/FormationLocomotion.ts:57` | DiagnosticReplay stores only a starting checkpoint, so there is no trajectory to diverge from, and it runs in the browser. Node tooling is pinned to one major, and nothing compares results across engines. |
| sweep-determinism | localeCompare("en") tie-breaks and CONTENT_HASH key ordering are ICU-dependent | `src/skirmish/domain/Battle.ts:512` | Simulation sort keys are ASCII kind:id strings, which sort identically under every collation. Each match is simulated on one host, and CONTENT_HASH never crosses hosts. |
| sweep-determinism | TradePublication revisions reset on restore, leaving the encoder's change detection stale | `src/skirmish/domain/TradePublication.ts:5` | Restore creates new actor objects, and the encoder deep-compares whenever owner identity changes (TraderStream.ts:59), so no detail goes stale. Covered by TradeFleet.test.ts:126-142. |
| sweep-determinism | Disconnect handover order comes from socket-event order and is not journaled | `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:246` | setAiController's effects are per-player or commutative. There is no replay or command journal; state is checkpointed whole. |
| sweep-working-tree | Unguarded progression.states[owner].completed remains in the freeze's crash class | `src/skirmish/domain/Supply.ts:139` | Every caller filters by live player id, and the freeze scenario has a regression test (TradeFleet.test.ts:105-108). Hardening only. |
| sweep-working-tree | hybridContacts now runs for every per-soldier ranged squad | `src/skirmish/domain/Battle.ts:918` | At HEAD, every ranged per-soldier unit also had melee, so the same 17 units already ran hybridContacts. The 5 s test timeouts cited come from tests that never tick the battle. |

---

## Unverified

None. All 112 findings got a verdict from at least two verifiers.
