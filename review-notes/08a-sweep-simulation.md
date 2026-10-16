# 08a — Latent-bug sweep of `src/skirmish/Simulation.ts`

Reviewer scope: the whole `Skirmish` aggregate (5617 lines, working tree as of the 8 Hz branch), read end to end in ~250-line chunks, with the long single-line methods unfolded. Cross-file reads were limited to what was needed to confirm a mechanism. Two throwaway `tsx` scripts were run from the scratchpad (nothing was written into the repo except this file).

## Scope read

- `src/skirmish/Simulation.ts` 1–5617 (all). Long lines unfolded: 241 (`checkpoint`), 269 (restore validation), 1327 (formation reform literal), 2186 (`syncFormationCounts`).
- `src/skirmish/EntityCollection.ts` (all) — records are mutated in place (`Object.assign`), so a stale reference to a removed entity still "looks alive".
- `src/skirmish/domain/CommandPolicy.ts` 1–150, `src/skirmish/multiplayer/CommandSchema.ts` (all), `src/skirmish/multiplayer/application/LiveMatch.ts` 560–600, `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` 240–275, `src/skirmish/CommandApplications.ts` 88–110.
- `src/skirmish/MovementAdmission.ts` 238–310, 373–475, 604–768; `src/skirmish/ShipMovementAdmission.ts` `valid()`.
- `src/skirmish/domain/Recruitment.ts` 144–150, 246–280; `src/skirmish/domain/Supply.ts` 85–150, 340–360; `src/skirmish/domain/Trade.ts` 380–390, 995–1012; `src/skirmish/domain/Expansion.ts` 1085–1205; `src/skirmish/domain/TrenchOccupancy.ts` 615–645; `src/skirmish/domain/SkirmishStance.ts` `observe()`; `src/skirmish/domain/Diplomacy.ts` `canCapture`; `src/skirmish/Conquest.ts` `beneficiary`; `src/skirmish/FactionRules.ts` `canPromoteTribe`.
- `src/skirmish/UnitIndex.ts` 282–297, `src/skirmish/BuildingIndex.ts` 247–282, `src/skirmish/CapturePressure.ts` 13–22, `src/skirmish/domain/CombatGeometry.ts` 18–62, `src/skirmish/LocalAvoidance.ts` 158–180, `src/skirmish/SquadGeometry.ts` 28–62, `src/core/game/GameMap.ts` 167–175.
- `Optimization Handoff/Evidence/live-match-freeze-20261015.md` 1–60 (context only).
- `tests/skirmish/Conquest.test.ts` 1–95 (used as the fixture for the scratch scripts).

## How it works today

**Entity ownership.** Squads, ships and buildings live in three `EntityCollection`s (370–401). Every write goes through `update`/`updateOwned`/`setOwned`, which mutate the stored record in place and fire hooks that keep `UnitIndex`/`BuildingIndex`, the change journals, `LandingOccupancy`, and the economy's naval/recovery facts current. `removeSquad` (1222) additionally drops `movementClearance` and `playerAttacks`; the `removed` hook (372–377) clears navigation progress, detours, order revisions, queued legs, continuations, route approaches and cancels the squad's planner/route-work keys. Because records are mutated in place, any code that holds a `Squad`/`Building`/`Ship` reference across a removal keeps seeing a live-looking object; the code defends against this with `this.squad(id)!==target` checks (e.g. `routePursuit` 4369) and by re-reading ids, but only where the author remembered.

**Command path.** `LiveMatch.command` (LiveMatch.ts 567–570) parses the wire payload with the strict Zod `commandSchema` and **overwrites `playerId` from the seat**, so no client can command another faction. `serverMatchWorker` (251–256) rejects commands for AI-controlled seats and otherwise calls `commandApplications.apply`, which wraps `Skirmish.applyCommand` in `try/finally` with **no catch** (CommandApplications.ts 92–96): any exception thrown inside `applyCommand` escapes the worker's `advance` and kills the match (the Oct-15 failure class). `applyCommand` (1249–1577) runs `commandRejection` (shape only), looks the player up, then dispatches: delete-ship/delete-building/tribe limits/charge pre-check/formation inline; everything else that is ages-specific goes to `expansion.command`; then recruit/build/recruit-ship/sail/stop-ships; finally the generic `order` path, which validates ownership (1416–1423), appends or activates orders, and either hands the move to `MovementAdmission` (deferred planning) or plans synchronously with `formations.plan` + `findGroup`.

**Order lifecycle.** `activateOrder` (1685–1718) cancels planner keys, clears continuation/approach/queued-leg state, updates trench/cavalry/playerAttacks observers, bumps `orderRevisions` (the fence every async route result is checked against), and installs `path=[tileOf(squad), ...path]`. `finishOrder` (1720–1755) pops queued orders: a queued move either takes a ready continuation path, starts a deferred queued leg, or does a synchronous `find`; a queued attack is re-activated if the target id still exists; otherwise the squad holds (keeping its facing).

**Tick.** `step` → `performTick` (3378–3666): queued-leg deadlines; path warming; volley expiry; construction (one foundation per tile per tick, 3404–3412); `promoteTribes`; `expansion.beforeStep`; diplomatic withdrawal; reserves; `thinkAi`; ship movement (+ raids entry/declaration); `drainRoutes` (route work, planner, admissions, army/trade planning budgets); cavalry engagements; column travel; held-squad spatial; formation counts; attack approaches; per-squad `navigation` → intents; formation locomotion; `avoidance.step` with the clearance proof cache; rollback of illegal end positions; raids war-on-entry; `advanceNavigation`; formation states; `fight`/`fightShips`; `expansion.afterMovement` (trade step, projectiles, dead-building removal); orphan navigation cleanup (post-restore only); `replenish`; `capture` (pressure-based claims, fallout cleanup); coastal/absorption ownership; `stepWarships`; `stepRecruitment`; `checkWinner`; `armies.reconcile`.

**Ownership change.** `changeOwner` (4813–4865) is the single choke point: refuses captures the diplomacy forbids, refuses ownership of wasteland unless `squadCapture`, maintains `ownedTiles`/`ownedWater`/`player.land`, invalidates capture rows, clears the per-tick footprint caches, notifies supply/operations/adjacency/boundaries/absorption/coast/placements, then (unless `preserveStructures`) **reassigns every building on the tile to the new owner, including owner 0**, awards captor XP and conquest credit when a last city falls.

**Elimination.** `checkWinner` (5425–5507) marks factions with no live squad and no completed city as eliminated, then for each: inherits research to a tribe beneficiary, removes foundations, hands every owned land/water tile to `recipient` (beneficiary, or 0 when raids diplomacy forbids capture, or 0 when no conquest credit exists — `ConquestCredit.beneficiary` returns 0 by default), reassigns remaining buildings to `recipient`, removes ships, aircraft and defense zones. Winner is declared only with ≤1 survivor or a coalition.

**Checkpoint/restore.** `checkpoint` (241) serialises 45 fields via `structuredClone`; `restore` (242–288) validates shapes/ids/clocks, `installCheckpoint` (289–343) restores collections and sub-systems, rebuilds owned-tile sets, adjacency, spatial grids, and flags `navigationCleanupNeeded`. I diffed every instance field (listing at 201–737, 1243, 2013–2033, 2207, 2275, 3110–3131, 4612–4620) against the checkpoint: everything with gameplay state is either checkpointed, rebuilt in `installCheckpoint`, or a per-tick scratch. The residue is listed under Issue 8.

**Determinism.** No `Math.random`, `Date.now`; `performance.now` only behind `onPhase` diagnostics (212, 3381). `this.random` is checkpointed but never consumed in this file. Float math (`Math.hypot`/`sqrt`/`atan2`/`cos`) is used widely for geometry, which is fine for a single authoritative server but means checkpoint replays must run on the same engine. The only comparator-less `.sort()` is none; all sorts have comparators. Iteration over Maps/Sets that are mutated in the loop (3384, 4661, 4744, 4745) only deletes the current/later entries, which JS iteration tolerates.

## Strengths

- A single ownership choke point (`changeOwner`) and a single entity-mutation path (`EntityCollection`) with derived indexes; stale-id defences (`orderRevisions`, `aiGeneration`, `valid()` callbacks) are consistently threaded through the async route pipeline.
- The server rewrites `playerId` from the seat and uses a strict Zod schema, so cross-faction commands are impossible at the transport layer.
- Damage is resolved simultaneously through ledgers; removals iterate over copies; `routePursuit` and the planner's `completed` callback re-fetch entities by id before mutating.
- Elimination cleanup is more complete than most RTS codebases: foundations, ships, aircraft, defense zones, conquest credit chains, and the recipient-0 case for raids are all handled; `Recruitment.step` self-heals jobs whose producer changed hands.
- `restore` validates ids, clocks, manpower, weapon state and formation clocks before installation, and poisons the aggregate (`restoreFailure`) rather than running on a half-installed state.

## Issues

### 1. `charge` fallback computes `map.ref()` from unbounded client coordinates → uncaught throw kills the match
- Path: `src/skirmish/Simulation.ts:1293-1300` (branch), `:1299` (`this.map.ref(Math.floor(command.x/FIXED),Math.floor(command.y/FIXED))`).
- Severity: **high**. Confidence: **confirmed** (runtime repro below).
- Mechanism: the wire schema bounds `x`/`y` to ±1,000,000 (CommandSchema.ts 10–13, 93) but not to the map; `GameMap.ref` throws `Invalid coordinates` for anything off-map (GameMap.ts 167–170). The pre-check at 1293 fires for any non-cavalry squad that is in (or leaving) column formation, and when `fallbackOrder.type==='attack'` names a squad id that no longer exists, 1299 converts the raw point into a tile without `isValidCoord`. `CommandApplications.apply` has `try/finally` without `catch` (CommandApplications.ts 92–96), and `serverMatchWorker` lets the exception out of `advance` (serverMatchWorker.ts 251–256). The Expansion-side validation of charge coordinates never runs because this branch precedes `expansion.command` (1337).
- Repro (scratch, ran): ages-v1 96×64 map; `formation` command shape `column` on player 1's infantry; then `commandSchema.parse({type:"charge",playerId:1,squadIds:[id],x:1000000,y:0,fallbackOrder:{type:"attack",targetId:999999}})` passes; `applyCommand` throws `Invalid coordinates: 3906,0`. The same command with on-map x/y returns `null`.
- Consequence: any seated human can end a live match for all 8 humans with one crafted packet (no checkpoint recovery exists). Side note: the same branch inspects `this.squad(id)` for ids the player does not own, so the "Deploy before charging" message leaks whether an enemy squad is in column.

### 2. `skirmish.observe` / `trenches.observe` run before the order can still be rejected
- Path: `src/skirmish/Simulation.ts:1457-1458` (observers) vs rejections at `:1461-1462`, `:1463-1464`, `:1486`, `:1492-1493`, `:1499-1502`, `:1530-1536`, `:1545-1548`.
- Severity: **medium**. Confidence: **confirmed** (runtime repro below; mechanism in TrenchOccupancy.ts 615–641 — `observe` calls `leave(id)` for every non-hold order — and SkirmishStance.ts `observe` which finishes/suppresses the stance state).
- Mechanism: for `type:"order"` the observers fire unconditionally once ownership passes; the walkability, reachability, formation-room, foreign-territory-replenish and army-group rejections come afterwards and return without undoing the side effects. By contrast `charge`/`attack-structure` only observe on success (1339–1343).
- Repro (scratch, ran): player-1 squad on neutral land, `order:{type:"replenish"}` → returns "Move every selected squad onto friendly territory before replenishing" while both observers were invoked.
- Consequence: a mis-click to an unreachable/water tile, or a Shift-queue over a full formation, makes an entrenched line start `phase:'leaving'` and cancels skirmish stances, although the order itself did nothing. Wrong but desync-free.

### 3. Elimination (and raids-protected capture) hands buildings to owner 0 as a first-class state
- Path: `src/skirmish/Simulation.ts:5441-5442` (recipient 0 when no credit or `!canCapture`), `:5461-5468` → `changeOwner` `:4846-4849` (`updateBuilding({playerId:id})` with id 0), `:5473-5474`.
- Severity: **medium**. Confidence: mechanism **confirmed**; downstream crash **suspected** (cross-area).
- Mechanism: `ConquestCredit.beneficiary` returns 0 whenever no credit exists (a faction that deletes its own last city, starves, or dies to fallout). Unlike `nuclearBlast` (4805 `preserveStructures:true`, with an explicit comment that neutral land is not a faction that can operate buildings), elimination intentionally reassigns structures to 0 and `tests/skirmish/Conquest.test.ts:86` codifies it. Inside this file every consumer tolerates it (recruit 1773 requires owner match; `stepWarships` filters by `playerId`; `fightShips` 2834 uses `canAttackStructure` which rejects 0; `changeOwner` filters `b.playerId &&`). Outside, `Supply.goodsCapacity` (Supply.ts 141) and `Trade.ts:386` index `progression.states[b.playerId].completed`, which is undefined for 0 — exactly the Oct-15 `TypeError ... 'completed'` class. `BuildingIndex.changed` bumps `producerRevision` but not `geometryRevision` on an owner change (BuildingIndex.ts 277–279), so any consumer keyed on geometry alone keeps stale membership.
- Consequence: latent crash/stale-data class every time a faction dies uncredited or under raids rules. Needs either a documented contract ("owner-0 buildings exist; never index player state by `building.playerId`") enforced by a helper, or removal/`preserveStructures` semantics at elimination.

### 4. `finishOrder` re-activates queued orders that would fail `applyCommand` validation
- Path: `src/skirmish/Simulation.ts:1749` (attack: only `!this.squad(targetId)` is checked), `:1751` (replenish/hold activated unconditionally), consumer `:2506` (replenish never completes off friendly land), `:4172-4181`.
- Severity: **low**. Confidence: **high** (code path traced).
- Mechanism: a queued attack whose target has since become allied/embarked is activated; `navigation` then (4177) calls `finishOrder` for AI or when more orders are queued, but for a human with an empty queue falls into `playerAttacks.choose`, which auto-targets any hostile squad within 12 tiles — not what was ordered. A queued `replenish` on foreign land is activated, `replenish()` skips it every second (2506) and never finishes it, so the squad sits in `replenish` until re-ordered.
- Consequence: wrong target selection / stuck-in-replenish; desync-free.

### 5. Client-supplied move `x`/`y` are copied into intents and `moveDestination` trusts `order.y!`
- Path: `src/skirmish/Simulation.ts:3850-3852`; ingress `:1465` (`movementAdmission.append(command.squadIds, order, …)`) → MovementAdmission.ts 272/283 (`order:{...order}`), substitution only when a formation point exists (MovementAdmission.ts 752–756); `Protocol.ts:34` claims coordinates are never trusted from commands.
- Severity: **low**. Confidence: **medium** (ingress confirmed; I could not find a reachable case where the raw point survives to activation, because `FormationPlanning` fills `result` for every member).
- Mechanism: the schema allows `x` without `y` (CommandSchema.ts 17–24); if a raw order were ever activated, `moveDestination` yields `{x, y:undefined}`, `distanceSquared` becomes `NaN`, and `movementPolicyClear` (517) / `pointTile` would reach `map.ref(NaN)` → throw (same uncaught class as Issue 1).
- Consequence: today mostly hygiene; one future code path away from Issue 1. Strip `x`, `y`, `facing`, `formationIntent` from client orders at the top of the `order` branch.

### 6. `stepWarships` does O(buildings) scans per ship per tick
- Path: `src/skirmish/Simulation.ts:3213-3219`, `:3261-3267` (`this.buildings.find(b => b.id === ship.repairPortId …)`), `:2999-3005`, `:3045-3051` (full filters in dock search).
- Severity: **low/medium (perf at target scale)**. Confidence: **high**.
- Mechanism: `this.building(id)` is O(1) and `buildingIndex.byType(playerId,"port")` exists (used at 2464), but the repair state machine scans the whole building list; at the qualification load (300 warships, 430 buildings) that is up to ~130k predicate calls per tick on the 2-CPU ARM host, before dock searches every 0.5 s per damaged ship.

### 7. `defenseZones` is dead state on a hot path
- Path: `src/skirmish/Simulation.ts:403`, `:3757-3774` (`zoneSpeed` loops it for every `ordinarySpeed` call), checkpointed at 241, cleaned at 5486–5488.
- Severity: **low**. Confidence: **high** (grep: no writer anywhere under `src/skirmish`).
- Consequence: wasted loop per speed query and a checkpoint field that can only be non-empty via a hand-edited checkpoint; delete or implement.

### 8. Fields outside `checkpoint()` that change behaviour after `restore()`
- Path: `src/skirmish/Simulation.ts:592-593` (`pathsWarm`/`warmGraph`), `:409-418` (`amphibiousFactions` keyed on `completed.length`), `:632` (`routeClassificationEpoch`), `:3129-3131` (`navalOwnersTick`/`navalOpponents`), `:4620` (`capturePass`, harmless).
- Severity: **low** (production never restores today). Confidence: **high** for the diff, **medium** for consequences.
- Mechanism: after a restore the warming restarts from land while `corridorReady` (812–815) is already true for `tick ≥ corridorTicks`, so the first interactive/trade routes build trees on demand (latency spike, not a correctness issue). `transportVessel` returns the cached vessel if the restored research set has the same length as before (stale transport hull/speed until the next tech). `routeClassificationEpoch` is not restored; mismatch is safe, but a fresh-process restore whose live counter happens to equal the saved planner revision would reuse stale classifications. `navalOpponents` is stale for one tick if the restore lands on the same tick number.
- Also: `restore` (254) checks tile-array type/length but not that every non-zero `owners[]` value is a known player; `changeOwner` (4827) would then throw on `this.player(old)!.land--`. Corrupt checkpoints only.

### 9. Capture transfers buildings without the subsystem notifications that `delete-building` performs
- Path: `src/skirmish/Simulation.ts:4846-4849` vs `:1267-1272` (`supply.forgetProducer`, `fortifications.forgetBuilding`, recruitment cancel).
- Severity: **medium (design)**. Confidence: asymmetry **confirmed**; consequences **suspected** (Supply keeps `jobs[id]`, `selectedRecipes`, `goods`, `goodsOwners` for the old owner until its own step rewrites them — Supply.ts 87–92, 349–354).
- Consequence: captured factories/ports can keep the previous owner's production selection and goods attribution for up to a second, and every subsystem must independently notice `building.playerId` changes. This is the same shape as the Oct-15 bug and will recur with each new consumer.

### 10. Construction of stacked buildings is serialised per tile
- Path: `src/skirmish/Simulation.ts:3404-3412`.
- Severity: **low (design question)**. Confidence: **high**.
- Consequence: N stacked foundations on one tile complete in N× the time of one; a captured foundation keeps its `remainingTicks` and continues for the captor (changeOwner does not special-case `remainingTicks > 0`, only `checkWinner` removes foundations). Confirm this is intended.

### 11. Small per-tick waste
- `fightShips` sorts a copy of all ships every tick (`:2753`) although `EntityCollection` already iterates in ascending id order (ids are monotonic and restore preserves order).
- `recordNavalLosses` (`:1962-1968`) scans all squads per sunk ship for `embarkedOn === ship.id`, a field no live code ever sets (only legacy checkpoints).
- `changeOwner` captor XP (`:4852-4859`) sorts every squad of the captor per captured tile with enemy buildings.
- Severity: low; confidence high.

### Retracted suspicion (for the record)
I suspected `changeOwner`'s wasteland early-return (4816) could leave fallout tiles owned by an eliminated faction. A scratch run showed this is unreachable: `capture()` clears the wasteland cell when a squad captures it (4776–4778), `nuclearBlast` neutralises owned cells, and absorption/coastal claims are refused on wasteland, so no faction ever owns a wasteland tile.

## Recommendations (prioritised)

1. **Wrap `applyCommand` in a per-command guard** at `CommandApplications.apply` (catch → `rejected: "Command failed"` + log) and, in `applyCommand`, convert the charge fallback through `isValidCoord` before `map.ref` (Issue 1). Effort: 1 hour; add a test with off-map `x`. Also move the charge pre-check after an ownership filter.
2. **Move `skirmish.observe`/`trenches.observe` to the commit point** (just before the `for (const entry of orders)` loop at 1549 and before the deferred `movementAdmission.start/append` returns) so observers only see accepted orders, mirroring the `charge`/`attack-structure` pattern (Issue 2). Effort: 1 hour; the scratch repro converts into a unit test.
3. **Define the owner-0 building contract** (Issue 3/9): add `Skirmish.buildingOwnerChanged(building, old, new)` invoked from `changeOwner` and `checkWinner`, and have Supply/Trade/Fortifications/Recruitment subscribe (forget producer, drop selected recipe/goods owner, cancel jobs) instead of each lazily polling `building.playerId`. Then grep every `progression.states[<building>.playerId]` and route it through a helper that returns `undefined` for 0. Effort: half a day plus tests; this is the single highest-leverage change against the "stale reference across ownership change" class.
4. **Re-validate queued orders in `finishOrder`** with the same predicates `applyCommand` uses (hostile + not embarked for attack; friendly land for replenish) and skip otherwise (Issue 4). Effort: 30 minutes.
5. **Normalise client orders** at the top of the `order` branch: `order = order.type==="move" ? {type:"move",tile:order.tile} : {type:order.type, …}` so no client `x/y` ever reaches `queuedOrders` or admission intents (Issue 5). Effort: 15 minutes.
6. **Index-based repair-port lookups** in `stepWarships` (`this.building(id)`, `buildingIndex.byType(playerId,"port")`) (Issue 6). Effort: 1 hour.
7. **Delete `defenseZones`** and `zoneSpeed` or implement the feature (Issue 7). Effort: 30 minutes (bump checkpoint version).
8. **Restore hygiene** (Issue 8): reset `amphibiousFactions`, `navalOwnersTick`, and bump `routeClassificationEpoch` in `installCheckpoint`; validate `owners[]` values against the player set. Effort: 30 minutes.
9. Decide and document stacked-construction serialisation (Issue 10).

## Ten riskiest methods for a refactor (by coupling × hidden invariants)

1. `applyCommand` (1249–1577) — order of validation vs side effects, four dispatch layers, recursion for charge fallback.
2. `performTick` (3378–3666) — 20 ordered phases; many caches assume this exact ordering (`movementLand` revision fences, `previousPositions`, `movementClearance`).
3. `navigation` (4117–4366) — mixes policy waits, attack retargeting, pursuit scheduling, detours, corridor smoothing and braking in one function with early `activateOrder` calls inside.
4. `changeOwner` (4813–4865) + `checkWinner` (5425–5507) — the ownership/elimination pair that every subsystem is implicitly subscribed to.
5. `capture` (4649–4794) — incremental pressure bookkeeping with dirty flags, persistent rows, fallout cleanup and exposure ledger.
6. `thinkAi` (4867–5208) — per-squad decisions interleaved with `applyCommand` calls that mutate the arrays being iterated (`own` is a snapshot, but orders change `squad.order` mid-loop).
7. `fightShips` (2736–2954) — explicit-target resolution across three id spaces (ship/building/afloat squad), projectile vs direct hits, and `committed` damage accounting.
8. `formationMoveClear` (2096–2165) — column certificate cache keyed by formation object identity (`WeakMap`), with reuse conditions that must match `updateOwned` identity semantics.
9. `finishOrder`/`activateOrder` (1685–1755) — the only place order revisions, continuations and trench/cavalry observers are reconciled; called re-entrantly from the planner's `completed` callback (917–941).
10. `restore`/`installCheckpoint` (242–343) — must be kept in lock-step with every new field; nothing enforces the diff.

## Open questions

- Is owner-0 building ownership an intended long-term state (and if so, should `replicationSource`/UI render "ruins"), or should elimination remove/neutralise structures the way `nuclearBlast` reserves them?
- Why does the `charge` pre-check run before `expansion.command`'s ownership validation? If the intent is a friendlier message, it can be moved after the ownership filter.
- Is per-tile serialised construction (3404–3412) intentional for stacks, and should captured foundations continue for the captor?
- `checkWinner` ends a match only at ≤1 survivor; at the 52-faction target, eliminated humans will sit in matches for a long time — is a "human-only" victory condition planned?
- `embarkedOn` is never assigned by live code; is the whole embark/sink path (resolveNavalDamage 2968–2977, recordNavalLosses) legacy that can be deleted along with `defenseZones`?
