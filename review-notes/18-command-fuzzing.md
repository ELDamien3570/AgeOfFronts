# 18 — Command fuzzing and exception containment (round 2)

Reviewer area: every wire command type, from `commandSchema` through `CommandApplications.apply`, `Skirmish.applyCommand`, `Expansion.command` and their handlers. I wrote and ran a property-based fuzzer against real matches in five ages and confirmed the H3 match-kill. I also found four new defect classes:

1. A cross-faction stance mutation.
2. Rejections that still mutate state (M11 is still live, plus three new instances).
3. Live states that the simulation's own checkpoint validator rejects.
4. No containment anywhere between one bad command and the end of a live match.

The working tree was edited while I worked: `Units.ts`, `Expansion.ts` and `Simulation.ts` changed between 02:30 and 02:37 on 2026-10-16. One edit briefly made the tree unloadable (`Missing unlock earlymodern-carrier`, `Catalog.ts:65`). All line numbers below were re-checked against the tree at about 03:10. Later reproductions ran on a frozen copy taken at 02:40, outside the repo.

## Scope read

- `src/skirmish/multiplayer/CommandSchema.ts:1-140` (all 41 command variants, `order`/`armyOrder` unions, nested `fallbackOrder`, `deploymentLine`, `transfer-aircraft`, `attack.cavalryMode`).
- `src/skirmish/CommandApplications.ts:1-184` (whole file).
- `src/skirmish/domain/CommandPolicy.ts:1-152` (whole file).
- `src/skirmish/Simulation.ts`:
  - `204-242`: `assertAvailable`, `setAiController`, `checkpoint`.
  - `243-345`: `restore` validators and `installCheckpoint`.
  - `1186-1214`: `updateSquad`, including the definition-change formation rebuild.
  - `1248-1587`: `applyArmyCommand`, `applyCommand`.
  - `1589-1690`: `applyLineOrder`.
  - `1700-1710`: `formationIntent` activation.
  - `2192-2202`, `2343-2344`: formation upkeep.
  - `3378-3400`: `step`.
  - `3540-3556`: transport landing.
- `src/skirmish/domain/Expansion.ts:433-919`: `command()` and every branch it dispatches. `922-1060`: `validPosition`, `recruitAircraft`, `completeAircraft`, `launch`. `1240-1400`: aircraft step, `operationalAirfield`, `advanceTransfer`.
- `src/skirmish/domain/Armies.ts:449-700`: `command`, `observeOrder`, `detach`, `order`.
- `src/skirmish/domain/TrenchOccupancy.ts`: `78-90` (checkpoint), `290-296`, `452-525` (`command`, `resetBudget`, `admit`), `615-640` (`observe`, `leave`).
- `src/skirmish/domain/SkirmishStance.ts:60-240`.
- `src/skirmish/domain/Supply.ts:224-262`, `src/skirmish/domain/Fortifications.ts:349-366`, `src/skirmish/domain/Progression.ts:156-190`.
- `src/skirmish/domain/TransportHandoff.ts:45-70`, `src/skirmish/domain/FormationGeometry.ts:96-104, 483-545`, `src/skirmish/domain/FormationProfiles.ts:12-19, 114, 143-148`.
- `src/skirmish/EntityCollection.ts:1-94`.
- `src/skirmish/domain/EngagementManager.ts:160-185`.
- `src/skirmish/multiplayer/application/LiveMatch.ts:1-32, 126-166, 547-575 (command, admitCommand), 640-760 (scheduleTick, advanceWorld)`.
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:1-75, 125-320`.
- `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:300-360`.
- `src/core/game/GameMap.ts:160-200` (`ref` throws on invalid coordinates).
- `src/skirmish/worker.ts:115` (the only production `restore` call site).
- Ledger `review-notes/08-latent-bugs.md`: H3 (110-133), M11 (431-460), the refuted table (1697-1726).

## How it works today

**Wire to domain (`LiveMatch.admitCommand`, `LiveMatch.ts:551-575`).**
- A frame must have a string `type` and fit in 100,000 JSON characters.
- It is then `commandSchema.parse({...input, playerId: this.playerId(guest)})`. The client-supplied `playerId` is overwritten, and `.strict()` objects reject unknown keys, including an own `__proto__` key.
- The command is queued (`MAX_QUEUED_COMMANDS` = 100 for the whole match, not per player).
- Zod errors throw back to the coordinator. They are per-request and not fatal.

**Worker (`serverMatchWorker.ts:250-265`).**
- For each queued command, a seat that is AI-controlled or missing is rejected without reaching the domain (`:252-254`).
- Otherwise it calls `match.commandApplications.apply(item.id, item.command)` (`:255`).
- There is no try/catch around the loop or around `match.step()`.
- The one catch is the whole-request catch at `:305-314`. It logs `console.error("Match executor operation failed", type, error)` and posts `{error}`.

**LiveMatch.** `scheduleTick` turns any rejected advance into `this.end(\`Match stopped: ${message}\`)` (`LiveMatch.ts:660-662`). One throw anywhere in command application or simulation ends the match for every seat.

**CommandApplications.apply (`CommandApplications.ts:56-108`).**
- Duplicate ids replay the previous outcome. The capacity guard covers deferrable types.
- `try { rejection = this.ports.apply(command) } finally { this.applying = undefined }`. There is a finally but no catch (`:91-96`).

**Skirmish.applyCommand (`Simulation.ts:1254`).** Runs in this order:
1. `commandRejection`. This checks shape: safe integers, ids > 0, `x`/`y`/`tile` >= 0 and array caps. It does not know the map size, so it never checks an upper bound on coordinates or tiles.
2. Player checks.
3. `delete-ship` and `delete-building`.
4. Tribe build limits.
5. The **charge pre-check** (`:1302-1306`).
6. `formation` (`:1307-1340`).
7. `expansion.command` (`:1341`).
8. Legacy branches.
9. The `order` path (`:1413-1587`), with `applyLineOrder` at `:1589`.

**Expansion.command (`Expansion.ts:433`).** Dispatches to:
- trenches: `occupy`;
- stance;
- `Armies.command`: `create-army`, `army-*`;
- `Progression`: research, advance;
- `Supply`: production;
- `Trade`: pause, block;
- `Diplomacy`;
- `Fortifications.repair`;
- aircraft: recruit, transfer, sortie;
- `launch`;
- refit, ships, enlarge, refit;
- `charge`, `attack-structure`.

Each branch validates on its own, and most validate before writing.

**Side observers.** Several domain observers run as part of command application:
- `SkirmishStance.observe` (`SkirmishStance.ts:115-142`).
- `TrenchOccupancy.observe` (`TrenchOccupancy.ts:615-632`).
- `Armies.observeOrder` (`Armies.ts:520-545`).

None of these observers checks ownership. They trust their callers to have validated the squad ids.

## Fuzzer (scratch, outside the repo)

`C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/command-fuzz/fuzz.ts`, with a frozen-tree copy at `.../command-fuzz/snap/fuzz.ts`.

Run it with `npx tsx fuzz.ts <startingAge> <commands> <seed> continents <infiniteGold 0|1>`. Environment knobs: `WARM`, `SMART`, `FULL`, `LEGACY`.

**Fixture.**
- `loadServerMap({mapId:"continents", worldSize:250})`, built with `createSkirmishMap` exactly as the server worker does.
- Options are the live-lobby options: `DEFAULT_AI_POLICIES`, raids-v1, corridors-v1, `FORMATION_MOVEMENT`, ages-v1, 2 human seats, 3 AI, 3 tribes, technologySpeed 3, alliances on.
- Warm-up: both human seats run as AI for 1200-2400 ticks. Then they are handed back with `setAiController(id, false)`.
- Seeding then runs:
  - complete all technologies up to the seat's age;
  - add gold and materials;
  - 3 rounds of `build` for every building type (two airstrips each);
  - recruit every unit, vessel and aircraft at every owned building;
  - declare war (1↔2, 1→3, 2→4) and send attack orders.
- Typical seeded state: 80-120 squads, 13-86 ships, 110-190 buildings, 4-46 aircraft, armies, 4-18 formation transitions, 6-26 embarked/afloat squads, ongoing fights.
- When a winner appears or both humans are eliminated, a fresh epoch is set up with a new seed.

**Generation.**
- Every type in `commandSchema` is generated from weighted pools:
  - own, enemy and removed ids of each entity kind, and ids of the wrong kind;
  - 0, 1, 255, 256, 65535, 65536, 9,999,999 and 10,000,000;
  - tiles: own, enemy, water, neutral land, near own squads, `N-1`, `N`, `N+1`, 10,000,000;
  - coordinates: ±1,000,000, -1, 0, `W*256-1`, `W*256`, `W*256+1`, 999,999;
  - empty, duplicate and max-length arrays (30, 200, 10,000), plus array-length + 1;
  - every enum value, `fallbackOrder` of both kinds, `append`, `deploymentLine` with extreme endpoints, and text ids such as `__proto__`, `constructor` and 100-character strings.
- `SMART` (default 0.5) mixes in a valid-biased generator, so acceptance paths are exercised deeply: trench occupy, airfield transfer, sortie including atomic, launch, refit/enlarge, cavalry charge with fallback, line orders, army orders, structure and naval attacks.

**Application.**
- Each command is `commandSchema.safeParse({...raw, playerId: actor})`, matching LiveMatch's overwrite. Actors are the two human seats.
- 5% of commands are "trusted path": `game.applyCommand` for an AI seat, as AI code does.
- Wire commands go through `game.commandApplications.apply(id, cmd)`, applying the worker's AI-seat rejection.
- 1-3 `step()` calls follow each command.
- Every 250 commands: `checkpoint()`, then `restore()` into a fresh `Skirmish` and 3 ticks.

**Oracles.**
1. Any throw in apply or step. The tool then recovers from the last checkpoint.
2. **Rejected ⇒ no mutation.** A digest of players, squads, ships, buildings, aircraft, inventories, trench, stance, armies, diplomacy, recruitment, admission, supply, barriers, progression, trade, owners and claims is compared before and after each rejected command. `FULL=1` also compares every top-level checkpoint key.
3. Direct mutation of foreign entities or foreign stance/trench rows by an accepted command.
4. Invariants after ticks:
   - finite, non-negative gold, reserves and inventory;
   - squads on-map, troops >= 0, at most 32 queued orders;
   - move tiles and points on-map, no attack order on an own squad;
   - charge point on-map, land squad not on water;
   - aircraft airfield exists and is owned, transfer destination exists, finite coordinates.
5. `restore()` validator failures on live states.

**Full-checkpoint check.** Two `FULL=1` runs (Napoleonic seed 43, Modern seed 45; 3,000 commands each) compared every checkpoint key on every rejected command. They found no other rejected-mutation categories beyond those in Issue 4.

**Volume.** About 55,000 schema-valid commands were applied across StoneAge, ClassicalAge, Napoleonic, EarlyModern and Modern, with infinite gold on and off, in 16 runs plus targeted reproductions. Random-only runs accept only 0.4-6% of commands. Valid-biased runs accept 14-26%, for example Modern seed 35: 1,261 of 4,930. With the valid-biased generator, every command type except `launch`, `enlarge`, `research` and `upgrade-building` reached its executed branch. `launch` was rejected because every seeded silo was still reloading or had no payload. `upgrade-building` is always rejected by design. Raw results are in `result-*.json` beside the script.

## Strengths

- **Strict wire schemas.** `.strict()` everywhere, a bounded `id` (≤ 10,000,000), bounded arrays and enums. Recipe and technology lookups use `Map`s, so `__proto__`/`constructor` ids are harmless (`Supply.ts:237-238`, `Progression.ts:165`). Prototype-pollution attempts got nowhere.
- **Tile bounds are checked consistently.** Out-of-range tiles are guarded where it matters: `PathTopology.walkable` checks bounds (`PathTopology.ts:68-72`), `Pathfinding.connected` goes through it, and the append path guards `order.tile < width*height` (`Simulation.ts:1446`). Expansion's charge path checks `validPosition` before `map.ref` (`Expansion.ts:771, 763`). `applyLineOrder` checks the centre (`Simulation.ts:1620-1627`).
- **Validate-then-commit is the norm.** Most handlers validate before writing. `applyLineOrder` explicitly "revalidate[s] the whole deployment before changing any orders". Charge, attack-structure and the Expansion army path only notify observers on success (`Simulation.ts:1343-1347`, `Expansion.ts:442`).
- **Ownership is checked almost everywhere.** In 55k commands there were no accepted cross-faction entity mutations, apart from the stance side table described below.
- **Conservation held.** No invariant violations on gold, reserves, inventory, positions, queues or water placement in any run.
- **One correct throw class.** In 55k commands, H3 was the only throw from command application. `step()` never threw because of a command.
- **The AI-seat rejection works.** It happens in the worker (`serverMatchWorker.ts:252-254`), so a seat handed to AI after a disconnect cannot be driven by stale clients.

## Issues

### 1. H3 still live: a charge with an off-map point ends the match (CONFIRMED, executed)
- **Where:** `src/skirmish/Simulation.ts:1302-1304`. The throw is at `src/core/game/GameMap.ts:169`.
- **Severity:** critical (one packet from any seated client stops the match for everyone).
- **Confidence:** high.

**Mechanism.**
- The pre-check fires if any listed squad id, of any owner, is non-cavalry and in column or leaving column.
- If `fallbackOrder` is `{type:"attack"}` with a target that does not exist, it builds `{type:'move', tile: this.map.ref(floor(x/256), floor(y/256))}` with no bounds check. `commandRejection` only rejects x/y < 0 (`CommandPolicy.ts:63-72`).
- `ref` throws `Invalid coordinates`. `CommandApplications.apply` has no catch (`:91-96`). The worker catch posts an error (`serverMatchWorker.ts:305-314`), and `LiveMatch.scheduleTick` ends the match (`LiveMatch.ts:660-662`).

**Evidence.**
- Targeted reproduction `repro-h3.ts`: StoneAge, tick 2656. Player 1 lists **a tribe's** marching squad (id 246, owner 7):
  ```json
  {"type":"charge","squadIds":[246],"x":1000000,"y":1000000,"fallbackOrder":{"type":"attack","targetId":9999999}}
  ```
  The result is `Error: Invalid coordinates: 3906,3906 at Simulation.ts:1304:127 <- CommandApplications.ts:93:30`.
- The random fuzzer found it independently 5 times (StoneAge, Napoleonic, EarlyModern, Modern ×2). The minimal boundary case is off by one: `"x":64000,"y":64000` on a 250-tile map (`Invalid coordinates: 250,250`, Modern seed 35), and `"y":64000` with any in-map x (EarlyModern seed 34). A client that sends `W*256` for a click on the far edge is enough.

**Secondary.** The pre-check also leaks whether an arbitrary squad id is in column ("Deploy before charging"), because ownership is not checked.

### 2. A rejected command reaches no catch, so any future throw is also fatal (CONFIRMED by reading)
- **Where:** `src/skirmish/CommandApplications.ts:91-96`; `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:250-265, 305-314`; `src/skirmish/multiplayer/application/LiveMatch.ts:660-662`.
- **Severity:** high (structural). **Confidence:** high.

**Mechanism.** There is no per-command or per-batch containment. If command k of a 100-command batch throws:
- commands `0..k-1` stay applied;
- commands `k+1..` are silently dropped;
- `match.step()` is skipped;
- outcomes collected through `onOutcome` stay in the worker's `commandOutcomes` map, which is cleared only at the end of a successful advance (`serverMatchWorker.ts:301`).

LiveMatch then ends the match, so the partial state is never observed. That is "safe", but it costs every player the match.

**Logging.** The log is one `console.error` with `message.request.type`. It records no player id, no command, and no ring buffer of recent commands, so step-phase faults caused by an earlier command cannot be attributed.

### 3. Occupy lets a player suppress another faction's skirmish stance (CONFIRMED, executed)
- **Where:** `src/skirmish/domain/Expansion.ts:439`. The observer without an ownership check is `src/skirmish/domain/SkirmishStance.ts:115-128`.
- **Severity:** medium (gameplay exploit, needs a modified client). **Confidence:** high.

**Mechanism.**
- `TrenchOccupancy.command` filters to owned, eligible squads (`TrenchOccupancy.ts:472-477`). But on success Expansion calls `this.skirmish.observe(command)` with the **unfiltered** `command.squadIds`.
- For each id that has a stance row, `observe` sets `suppressed = true` and calls `finish(id, false)`, which aborts an in-progress withdrawal.
- `suppressed` is sticky. Only the owner's own `stance` or army-order resets it (`SkirmishStance.ts:110, 136`). The squad stays inert while its UI still shows the "skirmish" stance.

**Repro** (`repro-occupy-stance.ts`, `trenchLineScene` fixture):
1. Player 1 sets `stance: skirmish` on its ranged squad 16. Its row is `{"suppressed":false,"phase":"ready"}`.
2. Player 2 sends `occupy {squadIds:[ownDefender, 16], tile: own trench}`, which is executed.
3. Squad 16's row is now `{"suppressed":true}`, while `squad.stance` is still `"skirmish"`.

**Consequence.** An attacker with any owned trench can repeatedly cancel the enemy's reload-retreat micro just before a cavalry charge.

**Fix.** Pass only the admitted squad ids to `observe` (have `TrenchOccupancy.command` return them). Also make `SkirmishStance.observe` and `TrenchOccupancy.observe` take a `playerId` and skip foreign squads, as defence in depth.

### 4. M11 still live, plus three new "rejected but mutated" paths (CONFIRMED by fuzz digest)
- **Severity:** medium (M11) / low (others). **Confidence:** high.

**a) M11.**
- `Simulation.ts:1467-1468` runs `skirmish.observe` and `trenches.observe` before the rejections at `:1472-1473` (unwalkable tile) and `:1511-1512` (replenish off friendly land).
- The fuzzer logged it in every age with combat: Napoleonic, EarlyModern, Modern and ClassicalAge.
- On EarlyModern seed 34 the digest showed squad 2717's formation gaining an occupation-leave transition, plus a trench row change, on a **rejected** replenish. The command was `{"type":"order","squadIds":[...],"order":{"type":"replenish"},"append":false}`.
- Fix as in the ledger: move both observer calls after the last rejection, or onto the commit loop at `:1573-1585`.

**b) Armies `fire-retreat`.**
- `Armies.ts:610` sets `army.posture='skirmish'` before target validation (`:619`), walkability (`:624`) and connectivity (`:630`).
- A rejected `army-order {fire-retreat, targetId: <non-hostile or stale>}` permanently flips the posture with no `slotRevision` bump and no `engagements.invalidate`. Compare the proper `army-posture` handler at `:491`.
- Logged 2-3 times in every run with armies, for example Napoleonic seed 13: `{"type":"army-order","armyId":15,"order":{"type":"fire-retreat","targetId":65536}}` → "Choose a hostile land squad", yet `armies` changed.
- Fix: delete line 610. Line 663 already sets the posture on the commit path.

**c) Army planning cap.**
- `Armies.ts:639-640` runs `this.cancelPlanning(army.id)` before `if(this.leaderAdmissions.size>=128) return "Army planning is full"`.
- A rejected army order cancels the army's existing pending plan. The cap is global across all factions.
- Not hit by the fuzzer (it needs 128 concurrent army plans). Found by reading.
- Fix: check the cap first, counting the army's own existing plan as freed.

**d) Trench occupy.**
- `TrenchOccupancy.command` mutates before it knows the outcome. It runs `resetBudget()`, removes queued entries (`:502`) and charges the shared per-tick admission budget (`used++`, `:513`; `BUDGETS.trenchAdmission = 8`, `TacticalRules.ts:52`) for every attempted squad, even when the command returns "Not enough trench space" or "No legal route to the trench".
- Logged 26-40 times per EarlyModern/Modern run.
- Consequences:
  - a rejected occupy cancels that squad's earlier queued occupation;
  - failing attempts consume the **global** 8-per-tick budget. The queue only drains while `used < 8` (`:755-760`), so a player can starve every other faction's trench admissions with one failing occupy per tick.
- Fix: charge the budget per accepted admission and per player (for example 8 per player per tick); remove queue entries only on success.

### 5. Live states fail the simulation's own restore validator, so checkpoint/restore throws (CONFIRMED, root cause traced)
- **Where:** `src/skirmish/domain/TransportHandoff.ts:60` and `:67`; secondary at `src/skirmish/Simulation.ts:1195` and `:1197`. The validator is `src/skirmish/domain/FormationGeometry.ts:538-540`.
- **Severity:** medium. **Confidence:** high.

**Symptom.**
- Fuzz round-trips (`checkpoint()` then `restore()` into a fresh Skirmish) failed with `Error: Invalid formation frontage` in ClassicalAge (4 of 20 checks), Napoleonic (2), EarlyModern (1) and Modern (1).
- One recovery even turned FATAL, because the instance holding a bad checkpoint could not be restored.
- Offending squads all had the same shape: `{"shape":"column","mode":"travel","preferredFrontage":176|288|320,"automatic":false}` with **no `deployedShape`**. Examples: EarlyModern squad 3061 `earlymodern-archer` with 2 troops; Modern squad 44 `modern-infantry` with 7 troops; ClassicalAge squad 2350 `bronzeage-infantry` with 21 troops.

**Root cause (instrumented).** In two independent runs (ClassicalAge seed 32, tick 9872; Modern seed 25, tick 8134), every first invalid write came from this same path. I wrapped `EntityCollection.apply/setOwned` and validated every squad at each tick boundary (`snap/formcheck.ts`). The first invalid write was a transport landing:
- `Simulation.ts:3552` → `updateSquad` with `transportProposal` changes from `TransportHandoff.ts:55-69`.
- For a manual column (`intent === "column"`), `preferredFrontage` is computed for `old.deployedShape ?? doctrine.defaultShape` (`:60`). But the stored `deployedShape` is `intent==="column" ? old.deployedShape : intent` (`:67`), which stays `undefined`.
- The validator then checks `preferredFrontage` against `deployedShape ?? shape` = `"column"`. Column has no profile (`FormationProfiles.ts:16-17`), so it throws.

**Second path (executed synthetically, `snap/refit-frontage.ts`).**
- `updateSquad` with a new `definitionId` (refit or enlargement completion) on a column squad keeps the shape column, computes `preferredFrontage` for `eligibleShape(…, old.deployedShape ?? shape)` (`:1195`), and drops `deployedShape` to `undefined` when the new doctrine lacks it (`:1197`).
- 390 of 2,086 same-line definition changes produce an invalid formation, for example `bronzeage-anticavalry(shield-wall)` → `earlymodern-anticavalry`.

**Consequences.**
- `worker.ts:115` (local/solo recovery) throws and poisons the Skirmish (`restoreFailure`, `Simulation.ts:206-210, 286-292`).
- Any future server checkpoint/rejoin path inherits the failure.
- `checkpoint()` output is not a reliable diagnostic artefact.

**Fix.**
- `TransportHandoff.ts:67`: `deployedShape: intent==="column" ? (old.deployedShape ?? formationDoctrine(s.definitionId).defaultShape) : intent`.
- `Simulation.ts:1197`: store the same `eligibleShape(...)` result used at `:1195`, or drop `preferredFrontage` together with `deployedShape`.

### 6. A second validator mismatch: "Invalid engagement planning cursor" (SUSPECT, seen once)
- **Where:** `src/skirmish/domain/EngagementManager.ts:166-180`.
- **Severity:** low-medium. **Confidence:** medium.

One EarlyModern round-trip (seed 34, original tree, about tick 12,000) failed with `Invalid engagement planning cursor`. That check covers several conditions: army or enemy count caps, `memberIds > 60`, `candidates > 12`, non-finite axis, `projections.length !== enemyIds.length`, non-integer projections, and negative or non-integer cursors. I could not isolate which one before the tree moved, and a re-run on the frozen copy did not hit it. Same class as #5: live planner state violates its own restore validator.

The fuzzer's restore-failure dump now prints the failing condition per job, so it will be identified on the next hit.

### 7. Aircraft stay parked at a captured or destroyed airfield for one tick (CONFIRMED, benign)
- **Where:** `src/skirmish/domain/Expansion.ts` aircraft step (`const base = … b.playerId === a.playerId` → `a.health = 0`).
- **Severity:** low. **Confidence:** high.

The invariant "aircraft at an owned airfield" failed transiently 7 times. The next aircraft step kills the plane, so this is not a stale-cache crash: aircraft never dereference foreign progression state. It does show that a captured airfield silently destroys parked planes with no event. That may be a design choice, but it should be announced to the owner.

### 8. Server-side cost of large id arrays (CONFIRMED by reading, low)
- **Where:** `src/skirmish/multiplayer/CommandSchema.ts:92-132` (`buildingIds` up to 10,000); `src/skirmish/domain/Expansion.ts` `recruitAircraft` (`this.world.buildings.filter(... buildingIds.includes(b.id) ...)`); `src/skirmish/Simulation.ts:2473-2474` `automaticRecruitmentBuilding`.
- **Severity:** low. **Confidence:** high.

`includes` over a 10,000-element array for every building is about 4.3M comparisons per `recruit-aircraft` at 430 buildings. The per-session limit is 50 commands/s and there are 8 human seats, so the bound is about 0.2-0.4 s of worker CPU per second in the worst case. Fix: convert to `Set` once, or cap `buildingIds` at the faction's building count (≤ 1,024).

### 9. Global, not per-player, command budgets (CONFIRMED by reading, low)
- **Where:** `LiveMatch.ts:32, 559-560` (`MAX_QUEUED_COMMANDS = 100` per match per tick); `CommandApplications.ts:66-79` (512 pending receipts per match); `Armies.ts:640` (128 army plans); `TrenchOccupancy` admissions (8 per tick).
- **Severity:** low. **Confidence:** high.

One player can fill these shared queues and cause "Command queue is full" or "Command planning is full" rejections for others. With 8 humans plus 46 AI factions that is a fairness risk. The per-session 50/s limiter (M5) bounds it, but does not remove it.

## Recommendations

**R1. Fix H3 at the boundary.** Effort: 1 hour, with a test.
- `commandRejection(command, bounds?: {width:number;height:number})`. Reject:
  - any top-level `x`/`y` ≥ `width*FIXED` / `height*FIXED`;
  - any `tile`, `fallbackOrder.tile`, `order.tile` or `frontageTiles[i]` ≥ `width*height`;
  - `deploymentLine` endpoints outside [-W*FIXED, 2·W*FIXED].
- Call it as `commandRejection(command, {width:this.map.width(),height:this.map.height()})` at `Simulation.ts:1256`.
- In `Simulation.ts:1302-1305`:
  - restrict the column test to `s.playerId === player.id`;
  - reuse Expansion's `fallback` helper, which already checks `isValidCoord` (`Expansion.ts:758-767`), or add `if(!this.map.isValidCoord(tx,ty)) return "Deploy before charging"`.
- Test `tests/skirmish/CommandBounds.test.ts`:
  - a marching enemy squad, a charge with `fallbackOrder` attack on 9,999,999 and `x=W*256` ⇒ `outcome.status === "rejected"`, no throw;
  - the same for `y=H*256`, sortie and launch.

**R2. Per-command containment in `CommandApplications.apply`.** Effort: half a day, plus tests.

```ts
// Ports gains: mutationEpoch(): number; verifyIntegrity(): string | null; fault?(f: CommandFault): void
let rejection: string | null;
const epoch = this.ports.mutationEpoch();
try { rejection = this.ports.apply(command); }
catch (error) {
  const partial = this.ports.mutationEpoch() !== epoch;
  const integrity = partial ? this.ports.verifyIntegrity() : null;
  this.diagnostics.faults++;
  this.ports.fault?.({ error, command, partial, integrity, tick: this.ports.tick() });
  if (integrity) throw new CommandFaultError(integrity, error); // fail-stop only if state is now inconsistent
  rejection = "This order could not be applied";
} finally { this.applying = undefined; }
```

- **`mutationEpoch`.** A counter in `Skirmish`, bumped in the `squadEntities`, `buildingEntities` and `shipEntities` hooks (`Simulation.ts:375-...`). Also bump it in `spend`/`spendGold`, `Recruitment.enqueue/cancel`, `Armies` writes, the trench/stance `observe` calls, `aircraft` writes and `Diplomacy.action`. A cheap alternative is to bump on any `Expansion.command` branch entry after validation. Most current throws (`map.ref`, missing-entity dereference) happen before any write, so `partial === false` and rejecting is exactly equivalent to a validation failure.
- **`verifyIntegrity` (bounded, about 1 ms at reference load).** It checks:
  - `buildingIndex.verify(buildings)` (exists, `Simulation.ts:1240`) and the squad and ship index counts;
  - every `armies.membership` id is a live owned squad;
  - every `trenches.occupants` id is a live squad;
  - `movementAdmission` pending ids are live;
  - all player gold, reserves and inventory are finite and ≥ 0;
  - `commandApplications.pending ≤ capacity`.
  - Only if this fails does the match fail-stop as today.
- **Worker.**
  - Wrap each `match.commandApplications.apply` in the loop (`serverMatchWorker.ts:251-264`) with the same catch for non-`CommandFaultError` throws, so the rest of the batch and the `step()` still run.
  - Keep `step()` fail-stop.
  - Keep a ring buffer of the last 64 applied commands (`{tick, playerId, type, id, compact JSON ≤ 512 B}`), include it in any fatal log, and optionally write `checkpoint()` to `/var/log/aof/fault-<match>-<tick>.json.gz` (cap 32 MB) for offline replay.
- **Log line.** One JSON object per fault:
  - `{event:"command-fault", matchId, runtimeId, source:GIT_COMMIT, tick, playerId, guestHash, type, command: truncate(JSON, 2 KB, arrays to 20 items), message, stack: first 10 frames, partial, integrity, faultsThisMatch}`.
  - The client gets only the generic rejection string.
- **Abuse throttle.** More than 3 faults from one player in 60 s ⇒ LiveMatch rejects that guest's commands for 10 s. More than 50 faults per match ⇒ one aggregated warning per minute instead of per-fault logs.
- **Invariants a partial command must preserve.** These are what `verifyIntegrity` checks:
  - entity indexes match the collections;
  - no live reference to a removed squad, ship or building in armies, trench occupants, stance rows, admissions, receipts or aircraft (`airfieldId`, `transfer.destinationId`);
  - money conservation: gold or items spent ⇔ a job, refit, enlargement or repair record exists;
  - `CommandApplications.applying === undefined`, and no receipt is left `pending` for a faulted command.
- **Tests.**
  - `CommandApplications.test.ts`: a port that throws before mutating ⇒ status `rejected`, nothing pending, fault callback called once.
  - A port that throws after the epoch bump with a failing `verifyIntegrity` ⇒ rethrows `CommandFaultError`.
  - A worker test: a batch `[ok, throwing, ok]` ⇒ the 1st and 3rd are applied, the tick advances, and the match does not end.

**R3. Make rejections side-effect free.** Effort: 2-3 hours.
- Move `Simulation.ts:1467-1468` after the last rejection. M11 is still live.
- Delete `Armies.ts:610`.
- Reorder `Armies.ts:639-640`.
- Make TrenchOccupancy budget and queue changes success-only and per player.
- Lock this in with a property test (R5) asserting "rejected ⇒ checkpoint unchanged".

**R4. Close the cross-faction stance hole (#3).** Effort: 30 minutes. Pass the admitted ids, and give both observers a `playerId` ownership filter. Test: the `repro-occupy-stance` scenario ⇒ the foreign row stays `suppressed:false`.

**R5. Bring the fuzzer into the repo as a bounded property test.** Effort: half a day.
- `tests/skirmish/CommandFuzz.test.ts`: a 160×100 fixture (Conquest style) plus a 250 continents map behind an env flag, a fixed seed, and about 1,500 commands per run (about 20 s).
- Oracles: no throw; rejected ⇒ digest unchanged; accepted ⇒ no foreign entity or stance/trench row changed; invariants after ticks; `checkpoint→restore` into a fresh instance every 250 commands.
- The scratch script already contains the generators and digests. Port `ctx()`, `gens`, `smart()`, `state()` and `invariants()`.
- Run the long multi-age version nightly. Each run takes about 10 minutes on the desktop.

**R6. Fix the restore-validator mismatches (#5, #6).** Effort: 1-2 hours.
- `TransportHandoff.ts:67` and `Simulation.ts:1197` as above.
- Add a debug-only end-of-tick assertion in tests: every squad passes `validateFormation`. `formcheck.ts` is a ready template.
- Make the fuzz restore round-trip part of R5.

**R7. Cheap hygiene.**
- Use a `Set` for `buildingIds` lookups.
- Cap `buildingIds` at 1,024.
- Make the global queues per-player-fair (for example `MAX_QUEUED_COMMANDS` per guest = 25, `CommandApplications.capacity` per player = 64).

## Open questions

- Is destroying parked aircraft when an airfield is captured (#7) intended? If so, emit an event.
- Should a faulted command ever be retried? I recommend not: reject it and let the client re-issue.
- Should the server start using `checkpoint()` for rejoin or recovery? If so, #5 and #6 must be fixed first, and the restore round-trip should become a CI gate.
- The engagement cursor failure (#6) needs one more hit to isolate. The patched fuzzer (`snap/fuzz.ts`, `patch5.py`) dumps the failing job condition.
