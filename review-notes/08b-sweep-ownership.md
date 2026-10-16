# 08b — Latent-bug sweep: ownership, territory, elimination and trade lifecycles

Reviewer scope: the match-269 bug class (cached references / indices / ids going stale across ownership change, neutralisation, elimination, stack split, capture, controller handover, checkpoint restore). Read-only review of the working tree on branch `1.5.7-10hz-prototype` (uncommitted work included). One throwaway repro script was run from the scratchpad (`neutral-tower.ts`); the three untracked lifecycle tests were run with `vitest --config vite.skirmish.config.ts` (39/39 pass).

## Scope read

Fully read (every line):
- `src/skirmish/domain/Expansion.ts` 1–1930
- `src/skirmish/domain/Trade.ts` 1–1417
- `src/skirmish/domain/TradeCargo.ts`, `TradePublication.ts`, `TradeReceiving.ts`, `TradeQuote.ts` (all)
- `src/skirmish/domain/Armies.ts` 1–1221, `ArmyState.ts` (all)
- `src/skirmish/domain/EngagementManager.ts` 1–972
- `src/skirmish/domain/Occupation.ts`, `TerritoryAbsorption.ts`, `CoastalTerritory.ts`, `NuclearWasteland.ts`, `Diplomacy.ts`, `PairRelations.ts`, `Fortifications.ts`, `Roads.ts`, `TransportHandoff.ts`, `BuildingUpgrades.ts` (all)
- `src/skirmish/HomeTerritory.ts`, `Conquest.ts`, `CapturePressure.ts`, `BuildingIndex.ts`, `UnitIndex.ts`, `EntityCollection.ts`, `FactionAdjacency.ts` (all)
- `tests/skirmish/BlastOwnershipLifecycle.test.ts`, `PortCargoStorage.test.ts`, `PlayerTerritoryEntry.test.ts` (all)
- `Optimization Handoff/Evidence/live-match-freeze-20261015.md` (all)

Partially read (targeted ranges):
- `src/skirmish/Simulation.ts`: 220–366 (setAiController, checkpoint/restore/installCheckpoint, rebuildOwnedTiles), 365–460 (entity hooks, indexes, defense zones), 588–600 (notifyHostileAction), 1205–1275 (entity mutators, delete-ship/delete-building), 1840–1860, 1960–2000 (recordNavalLosses), 2395–2445 (buildingSite/buildingPlacement), 2477–2500 (stepRecruitment/refund), 2940–2985 (resolveNavalDamage), 3590–3700 (tick order: movement→fight→afterMovement→capture→coastal→absorption→warships→recruitment→checkWinner→reconcile), 3745–3800 (zoneSpeed/armyBlocked), 4590–4870 (fight tail, capture, buildingsAt, nuclearBlast, changeOwner), 5415–5515 (promoteTribes, checkWinner)
- `src/skirmish/domain/Battle.ts`: 155–200, 268–300, 1085–1110, 1490–1615
- `src/skirmish/domain/Supply.ts`: 80–175, 255–360
- `src/skirmish/domain/Recruitment.ts`: 1–300
- `src/skirmish/domain/AiOperations.ts`: territoryChanged (85–97), canEnter (265–278)
- `src/skirmish/domain/AiNavalFacts.ts`: 1–60, 190–215
- `src/skirmish/Construction.ts`: 36–80; `src/skirmish/Pathfinding.ts` component writes (67–79, static)
- `src/skirmish/content/Buildings.ts` 5–12 (DEFENSIVE_BUILDINGS); `TribeDevelopment.ts` 24–35; `client/main.ts` 667/697 (raids-v1 is the default lobby rule)

## How it works today

**Ownership is a byte array plus derived indexes.** `Skirmish.owners: Uint8Array` is the only authoritative territory state. Every write goes through `Simulation.changeOwner(tile, id, {squadCapture, preserveStructures})` (Simulation.ts:4813–4867), which: applies raids-v1 guards (4814–4815: the new owner must be allowed to capture the old owner *and* every building owner on the tile, or the write is silently dropped), refuses to give wasteland to a faction unless a squad captured it (4816), maintains `ownedTiles/ownedWater` Sets and `player.land` counters (4818–4828), then fans out invalidation to `captureContributions` (`invalidateCapture`), `routeFootprints/routeEntries`, `supply.territoryChanged` (deposit owner), `operations.territoryChanged`, `tileChanges`, `adjacency`, `economy.boundaries`, `territoryAbsorption`, `coastalTerritory`, `economy.placements` (4829–4840). Unless `preserveStructures`, every building on the tile is re-owned to `id` (4848–4849), the nearest captor squad gets XP, and city loss is recorded in `ConquestCredit` (4850–4866).

**Four callers change ownership**: `capture()` (squad pressure, Simulation.ts:4649–4793; also clears fallout cells on squad capture), `coastalTerritory.step` (water claims/relinquish, 3641–3642), `territoryAbsorption.step` (1–2-cell pockets, 3643–3654), and `checkWinner` defeat cleanup (5425–5509). `nuclearBlast` (4800–4811) neutralises land with `preserveStructures` so edge buildings keep their owner until squad capture or defeat.

**Buildings are owned by `EntityCollection<Building>`; indexes observe writes.** `BuildingIndex` keeps per-owner/per-type/per-ready buckets whose `values` are *frozen copies cached until the bucket changes* (BuildingIndex.ts:36–38, 49, 55). Ownership change goes through `updateBuilding` → `BuildingIndex.changed` (247–282) which re-buckets by owner and bumps `producerRevision`. This identity-stable, immutable-view design is what the match-269 fix leans on: `Trade.currentMarkets` (Trade.ts:346–371) compares `facts.completed(owner,type)` array identities to decide whether its cached `OwnerMarkets` (sites, markets) is still valid, so a captured/neutralised building changes identity and the cache is rebuilt from current ownership. `siteSnapshot` (998–1017) uses `currentMarkets` directly and never writes `this.markets`, `receiving` or actors.

**Trade lifecycle.** `Trade.step` (1196–1399) is called from `Expansion.afterMovement` (1189) *before* capture/checkWinner in the same tick. It rebuilds a `players` map, calls `refreshMarkets()` (372–427: receivers reconfigured, `landMarkets/landComponents/seaMarkets` rebuilt only when some owner's market view changed), spawns at most one courier per source per second, then advances every actor: elimination of the owner → cargo discarded and actor retired (1221–1225); interception by a hostile/raiding unit within 1.2 tiles → actor becomes the captor's `prize` (1240–1263); loss of the source site (owner+tile lookup in `source()`, 428–434) → empty actor retired, loaded actor becomes a self-prize (1264–1275); destination revalidated every tick with `allowedMarket` (437–459); delivery takes `receiving.take(owner:tile)` and credits both parties (1369–1393). Route admissions (`admissions`, `validRoute` 585–600) are re-validated against actor id, shipment id, start tile, owner permission revision and route generation on every planner round, so stale routes are cancelled rather than executed. Land corridors are *not* keyed by territory ownership; a courier that steps onto now-forbidden land evicts its owner's corridors and re-plans (1302–1317).

**Elimination.** `checkWinner` (5425–5509) marks every defeated faction first, resolves a beneficiary through `ConquestCredit.beneficiary` (Conquest.ts:84–93; chains through already-eliminated killers, cycles → 0), downgrades it to 0 in raids mode when the beneficiary could not legally capture the victim (5442), deletes foundations, transfers every owned land/water tile, then re-owns every remaining building of the victim (5473–5474, the fallout-edge fix), removes ships, aircraft and defense zones. Squads need no removal (defeat requires none alive). Next tick `Diplomacy.step` drops wars/alliances/offers/embargoes/protections of dead factions (287–338), `Trade.step` retires their couriers, `Armies.reconcile`/`step` disband empty armies, `EngagementManager.step` drops engagements with no live army (424–447), `Supply.step` drops their production jobs (288–297), `Recruitment.step` refunds jobs whose producer changed owner or land (Recruitment.ts:259–270).

**Controller handover** (`setAiController`, Simulation.ts:226–240) flips `player.ai` in place, bumps `controlGenerations` (route tasks carry a generation and are dropped, 4047), releases AI economy/operations records and command applications. No domain caches Player objects across ticks except within a single `Trade.step` pass (fresh `players` map, 1203–1210).

**Checkpoint restore** (`installCheckpoint`, 286–345) re-adopts entity arrays and rebuilds every derived index (`rebuildOwnedTiles`, `adjacency.rebuild`, BuildingIndex/UnitIndex rebuild via hooks, `Fortifications.reindex`, `EngagementManager.reindex`, `Armies.byArmyId`, `CoastalTerritory.byShore`, `Trade.markets` cleared, `TerritoryAbsorption.pocketGeometry` cleared). `player.land` is restored from the player record, not recomputed.

## Strengths

- The match-269 fix is structurally sound, not a patch: trade site membership is derived from immutable, identity-stable index views (`Bucket.values`), and the snapshot path is read-only. `BlastOwnershipLifecycle.test.ts` asserts `trade.checkpoint()` equality across publication for 5 s after a defeat, for all five payload kinds and three diplomacy modes.
- Almost every cross-tick structure is id-keyed and re-validated at use (`validRoute`, `allowedMarket`, `Recruitment.step`, `Fortifications.step`, `Armies.members/reconcile`, `EngagementManager.step`, `Supply.step` goods/plans/jobs). Stale ids degrade to "re-plan" rather than crash.
- `changeOwner` is the single write path and fans out invalidation to every derived structure; `FactionAdjacency.changed` even self-rebuilds on underflow (FactionAdjacency.ts:33–36).
- `Diplomacy.nonAllied/canCapture/canAttackStructure/canSteal` all treat owner 0 explicitly (Diplomacy.ts:30, 37–41), and `PairRelations.state` returns "neutral" for 0 (PairRelations.ts:37–39, 61).
- `ConquestCredit.beneficiary` handles simultaneous defeats and credit cycles (Conquest.ts:84–93); `checkWinner` marks the whole batch before resolving credit.
- Restore validates entity owner ids against the roster and most domain records (Simulation.ts:253–275; `validateArmyRecords`; `EngagementManager.restore`).

## Issues

### I1. Neutral (owner-0) towers are permanent, indestructible obstacles for every faction — CONFIRMED (repro run)
- Where: `src/skirmish/domain/Fortifications.ts:102–106` (`blocked` treats a tower owner that is not allied as blocking; `allied(0, x)` is false for every x), `src/skirmish/domain/Diplomacy.ts:40` (`canAttackStructure(a, 0)` is `false` because of `!!b`), `src/skirmish/domain/Battle.ts:1097` and `src/skirmish/domain/Expansion.ts:823–824` (attack-structure rejected), `src/skirmish/domain/Expansion.ts:1830–1853` (`captureEligible`: the ray to the tower's own tile crosses the blocked tile, so it is never capturable; owner 0 passes `canCapture`), `src/skirmish/Simulation.ts:5442,5474` (defeat cleanup re-owns *all* surviving buildings, towers included, to `recipient`, which is 0 for raid-only defeats, self-inflicted/uncredited defeats, or a beneficiary chain that ends in an eliminated faction).
- Mechanism: once a tower's `playerId` is 0, `Fortifications.step` (370–394) keeps it in the `towers` map forever (it has health, nobody can damage it except indiscriminate bombs/ICBMs), its tile blocks movement, army planning (`armyBlocked`, Simulation.ts:3779–3781), construction (`buildRejection`, Expansion.ts:389–392), and capture for all 52 factions. All its walls die immediately (Fortifications.ts:395–406) but the tower stays.
- Repro (executed, scratchpad `neutral-tower.ts`): raids-v1, victim 2 with city + tower; attacker 1 at embargo (no war) drops an atomic bomb on the city; victim eliminated with recipient 0 → tower owner 0, `blocked(tile,1)=true`, `blocked(tile,3)=true`, attack-structure → "Choose an enemy structure", `canCaptureTile(towerTile)=false`, tile behind the tower also uncapturable, land path from (18,20) to (22,20) routes around it, state unchanged after 30 s.
- Consequence: raids-v1 is the default lobby rule (`client/main.ts:667,697`). Over a long 52-faction match every raid-only or uncredited elimination leaves permanent map scars; tribes build towers (`TribeDevelopment.ts:26`). Severity high, confidence high.

### I2. Couriers keep sailing/walking to a market that became neutral and "deliver" nothing — CONFIRMED by trace (not executed)
- Where: `src/skirmish/domain/Trade.ts:437–459` (`allowedMarket`: owner 0 has no `eliminated` record (442), is `permitted` (PairRelations "neutral"), is not `enemy`, so a land city (456–458) or any port for naval traders (455) stays an allowed destination), `src/skirmish/domain/TradeReceiving.ts:29` (unconfigured key `0:tile` → 0 available), `Trade.ts:1369–1397` (quantity 0, `visited`/`visitedTiles` pushed, state back to outbound with full cargo).
- Trigger: courier outbound to faction V's city/port; V is eliminated with recipient 0 (raid-only, uncredited) or the building is neutralised by defeat cleanup. The courier finishes the trip, delivers 0, burns one of its `maximumStops`, then re-plans.
- Consequence: wasted round trips and planner budget; naval traders can be sent into neutral ports repeatedly (each neutral port is a fresh `visitedTiles` entry per shipment). Severity medium, confidence high. Neutral markets never enter `landComponents/seaMarkets` (built from per-player views, 372–427), so only in-flight destinations are affected.

### I3. Capturing or inheriting a tower demolishes every wall attached to it — CONFIRMED by trace
- Where: `src/skirmish/domain/Fortifications.ts:395–406` (a wall whose endpoint owner differs from `wall.playerId` gets health 0 and is removed on the same step); `src/skirmish/Simulation.ts:4848–4849` (tile capture re-owns the tower), `5474` (defeat cleanup re-owns all surviving towers to the beneficiary).
- Consequence: when a faction is eliminated at war, the inheritor receives towers but *all* of the victim's walls vanish in one tick; a single captured tower deletes every link to it, including links between two still-enemy towers. If this is intentional ("walls belong to their builder") it should be documented; it is a large, instant fortification change on elimination at the 52-faction target. Severity medium (design), confidence high.

### I4. `Expansion.snapshot()` mutates checkpointed state (Roads cache/dirty) — CONFIRMED (repro run)
- Where: `src/skirmish/domain/Expansion.ts:1898` (`roads: this.roads.packed()`), `src/skirmish/domain/Roads.ts:9` (checkpoint includes `cache` and `dirty`), `Roads.ts:55–78` (`packed` rewrites them).
- Repro: `roads.add(...)`, `checkpoint()`, `expansion.snapshot()`, `checkpoint()` → the two checkpoints differ (`dirty` true→false, `cache` filled). Semantically equivalent after restore, but it violates the stated "publication never mutates authoritative state" rule, makes checkpoint byte-equality depend on publish cadence, and the BlastOwnership test only asserts `trade.checkpoint()` equality so it cannot catch regressions of this shape. `relations.snapshot()` (PairRelations.ts:69) also forces a projection refresh, but that state is not checkpointed. Severity low, confidence high.

### I5. The exact match-269 dereference pattern survives in three places — CONFIRMED by trace; currently unreachable
- Where: `src/skirmish/domain/Trade.ts:386` (dead variable `research = this.progression.states[b.playerId].completed` inside `refreshMarkets`), `Trade.ts:892–894` (`cargoEffects(owner)` with `states[owner].completed`), `src/skirmish/domain/Supply.ts:139–142` (`goodsCapacity(building)` with `states[building.playerId].completed`).
- Today every caller reaches these through per-player market views (`currentMarkets`, `markets.get(a.playerId)`), so owner 0 cannot arrive. But `sourceStatus(sourceId)` (984–991), AI quote code, or a future pop-up faction whose `Expansion.add` is skipped would throw `Cannot read properties of undefined (reading 'completed')` — the freeze signature. Severity medium (latent), confidence high.

### I6. AI takeover inherits the human's trade pause/block lists forever — CONFIRMED by trace
- Where: `src/skirmish/domain/Trade.ts:110,264–304` (`controls` only written by `setPaused/setBlocked`), `src/skirmish/domain/Expansion.ts:450–459` (the only callers are the two player commands; no AI code calls them — grep over `src/skirmish` confirms), `src/skirmish/Simulation.ts:226–240` (`setAiController` releases economy/operations records but not trade controls).
- Consequence: a disconnected human who had paused sea trade or blocked partners leaves an AI that can never resume them; with no reconnect, that faction's trade income is capped for the rest of the match. Severity medium (gameplay), confidence high.

### I7. `amphibiousFactions` cache keyed by `completed.length` — SUSPECT (fragile)
- Where: `src/skirmish/Simulation.ts:409–418`. A restore (or progression change) that keeps the research count but changes its members keeps a stale transport vessel. `Trade.cargoEffects` (892–899) shows the safer key (array identity + length + progression revision). Severity low, confidence high that it is fragile; no production trigger identified (restore is same-timeline only).

### I8. Tile capture re-owns every building on the tile regardless of owner; raids guard refuses the whole tile if any building owner is uncapturable — SUSPECT (latent, mixed stacks)
- Where: `src/skirmish/Simulation.ts:4815` (guard) and `4848–4849` (bulk re-own). `Construction.ts:46–55` only enforces same *type* per tile; land ownership (`buildingTerrainRejection`) keeps mixed-owner stacks out of normal play, but fixtures build them and the defeat path re-owns per building (5474), so a future pop-up/neutral-spawn feature could create them. In raids mode the combination can leave land owned by an eliminated faction (its wars are dropped at Diplomacy.ts:322, after which `canCapture(x, victim)` is false for everyone) that no one can ever capture. Severity low today, confidence medium.

### I9. Alliance/peace acceptance scans the whole map and stringifies diplomacy twice — CONFIRMED by trace (perf)
- Where: `src/skirmish/domain/Expansion.ts:467,473` (`JSON.stringify(this.diplomacy.state)` before and after), `Expansion.ts:538–545` (loop over every tile on every accepted alliance/peace). On Migration (1,000,000 tiles) with AI tribes offering peace every 3 s (1096–1107), each acceptance is a ~1M-iteration stall inside the tick. `Skirmish.activeClaims` already holds every tile with a live claim. Severity medium at the 52-faction target, confidence high.

### I10. Restore does not validate `owners[]` tile values against the roster — SUSPECT (crash on malformed checkpoint)
- Where: `src/skirmish/Simulation.ts:253–262` validates entity `playerId`s but not `saved.owners`; `changeOwner` (4827, `this.player(old)!.land--`) and `nuclearBlast` (4803, `this.player(previous)!`) dereference the previous owner unconditionally. A checkpoint whose owner byte references no player crashes the worker on the first capture/claim rather than being rejected at restore. Severity low, confidence high.

### I11. One-tick lag for buildings destroyed in combat — CONFIRMED by trace (benign)
- Where: `src/skirmish/domain/Expansion.ts:1192–1194` removes dead buildings without `fortifications.forgetBuilding`/`supply.forgetProducer`/`recruitment.cancel` (the `delete-building` command does all three, Simulation.ts:1268–1272). Fortifications, Supply and Recruitment self-heal on their next step, but `capture()` in the same tick still sees the dead tower as blocking and `Supply.goods` keeps entries for buildings that only ever *received* returned cargo (goodsOwners is set only on production, Supply.ts:350). Severity low.

### I12. Duplicate guard line — cleanup
- `src/skirmish/domain/Expansion.ts:1832–1833` repeats the raids building-owner check verbatim.

### Lifecycle matrix (what happens today)

| Event | Buildings | Squads/ships/aircraft | Trade | Diplomacy/relations | Armies/engagements | Territory caches |
|---|---|---|---|---|---|---|
| (a) tile owner changes mid-tick | all on tile re-owned (4848) unless `preserveStructures` | captor XP | markets rebuilt next `refreshMarkets` (identity change); corridors evicted on first blocked step | `operations.territoryChanged` | none | capture rows dirtied, route caches cleared, absorption/coastal dirtied, adjacency adjusted |
| (b) owner → 0 | keep owner (fallout) or become 0 (defeat, recipient 0) → **I1, I2** | — | neutral markets excluded from candidates; in-flight destinations still allowed (I2) | `nonAllied/canCapture` handle 0 | — | wasteland cells refuse non-squad transfers (4816) |
| (c) elimination | foundations removed, rest re-owned incl. fallout edge (5461–5474); walls of inherited towers die (I3) | ships/aircraft/defense zones removed (5476–5483); no live squads by definition | couriers discarded+retired next step (1221–1225); controls/inventories persist (harmless) | wars/alliances/offers/embargoes/protections dropped next step (287–338); `betrayal/cooldowns/peaceContexts` expire by tick | reconcile→detach→disband; engagements dropped when no live army (424–430) | `ownedTiles` emptied via changeOwner; adjacency adjusted |
| (d) stack split | only via mixed-owner stacks (fixtures) → I8 | — | `currentMarkets` groups by live owner (I-fixed) | — | — | — |
| (e) building deleted/captured/upgraded under a job/courier | Recruitment refunds on owner/land change (259–270); Supply drops jobs/plans/goods on owner change (274–297) | — | destination revalidated each tick; source lookup by owner+tile → prize/retire | — | — | — |
| (f) ship sinks | — | `resolveNavalDamage` removes squads with `embarkedOn` (2974–2981); note no code path in `src/skirmish` ever sets `embarkedOn` to a ship id (only the decoder), so this is legacy | naval traders are TradeActors, not ships: interception → prize; blasts → `destroyInBlast` | — | — | — |
| (g) restore | indexes rebuilt via hooks | rebuilt | markets cleared, admissions/retries/corridors restored, cargoResearch safe (identity key) | revision bumped, permissionGeneration bumped | byArmyId, membership reindexed | ownedTiles/adjacency rebuilt; pocketGeometry cleared; byShore rebuilt; `amphibiousFactions` stale-prone (I7) |
| (h) human↔AI | — | `aiWithdrawal` cleared, attacks forgotten | **controls persist (I6)**; theft automatic flag flips immediately | AI proposer set recomputed per step | `controls.human` reads live `player.ai` | route tasks dropped by generation |

### Cross-tick cache table

| Owner / field | Keyed by | Invalidation rule | Assessment |
|---|---|---|---|
| `Simulation.ownedTiles/ownedWater`, `player.land` | owner → tile Set | maintained in `changeOwner`; rebuilt on restore (land from record) | safe |
| `Simulation.captureFootprints` | position → tiles | LRU only; depends on `paths.component`, which is static (Pathfinding.ts:67–79) | safe |
| `Simulation.captureContributions/Centers/Buildings` | squad id / building id | `invalidateCapture` from `changeOwner`, env key (paths, forts, alliances, permission signature), building key; cleared on restore; rows not seen this pass forgotten | safe |
| `Simulation.routeFootprints/routeEntries` | — | cleared on every `changeOwner` | safe |
| `Simulation.amphibiousFactions` | player → vessel | `completed.length` only | fragile (I7) |
| `Simulation.defenseZones` | array | removed on elimination; `zoneSpeed` checks `owners[zone.tile]===zone.playerId` live | safe |
| `Battle.structureById/structureBodies` | building id | rebuilt when `producerRevision`/`geometryRevision` change (owner change bumps producerRevision) | safe |
| `Battle.launchPermissions` | owner → lists | `permissionSignature`; in-flight shots keep the old list by design | safe |
| `Trade.markets/landMarkets/landComponents/seaMarkets/receiving` | owner | `currentMarkets` identity check on frozen index views + geometryRevision; `receiving.retain` | safe (post-fix) |
| `Trade.landShortlists` | owner:originTile | 10 s epoch + permission string; cleared whenever any market changes | safe |
| `Trade.corridors/routeLengths` | owner:start:goal:revision | not territory-keyed; evicted when a courier hits forbidden land (1302–1317); bounded | self-healing (one blocked step per change) |
| `Trade.admissions` | actor id | `validRoute` every planning round (actor/shipment/start/permission/generation) | safe |
| `Trade.retries/cycleQuotes/retired` | actor id | deleted on retire/remove | safe |
| `Trade.cargoResearch` | owner | tick + progression revision + research identity + length | safe; dereference unguarded for unknown owner (I5) |
| `Trade.seaActorIds/blastActors` | tick | rebuilt per tick / per blast tick | safe |
| `TradeActor.destination/factoryId/originTile/routeOriginOwner` | ids | revalidated each tick; owner-0 destinations still allowed (I2) | fragile (I2) |
| `Supply.goods/goodsOwners/selectedRecipes/jobs` | building id | per-tick scan against live index and owner (274–297) | safe (goods deleted on capture by design) |
| `Fortifications.towers/tileIndex/barrierIds/ownerBarriers/repairs` | tile / id | towers rebuilt every tick, reindex on change, repairs validated per second | safe; owner-0 tower semantics broken (I1); wall demolition on owner change (I3) |
| `Armies.membership/byArmyId/marches/commandHistory/leaderAdmissions/cohortArmies/slotPlanning` | ids + army revision | members filtered by owner+troops each step; reconcile after checkWinner; admissions revalidated | safe |
| `EngagementManager.engagements/plans/jobs/wings/postures/membership` | army ids | dropped when armies die or idle; `legal()` on every squad read; `WingPlan.playerId` cached but armies never change owner | safe |
| `Diplomacy.state.*`, `peace*`, `pairNext`, `recipientCooldowns` | ids/pairs | filtered by live roster or tick each step | safe (small growth for dead ids) |
| `PairRelations.recent/pairs/rows/ownerSignatures` | pair | stamp includes tick/revisions; `live` set excludes eliminated | safe |
| `TerritoryAbsorption.pending/watched/dirty/pocketGeometry` | root tile | `changed()` dirties ±2 cells; pocketGeometry not checkpointed, cleared on restore | safe |
| `CoastalTerritory.rights/pending/byShore` | water tile / shore | shore dirtied on every owner change; byShore rebuilt on restore | safe |
| `NuclearWasteland.cells/owners/recovery` | tile / former owner | explicit clear on squad capture | safe |
| `HomeTerritory.cache/bridgeheads/cursors/failures` | player | 3 s TTL + base/anchor key; failures bounded 2048 | benign staleness |
| `FactionAdjacency.edges/unclaimedEdges` | owner pair | incremental; self-rebuild on underflow | safe |
| `Recruitment` jobs/buckets | job id | producer owner/land/health checked every tick | safe |
| `Expansion.aircraft` | airfield id | airfield must still be owned, else aircraft dies (1232–1240) | safe |
| `Roads.cache/dirty` | — | rewritten by `packed()` during publication | checkpoint purity violated (I4) |

## Recommendations

1. **Stop neutral towers from becoming permanent obstacles (I1).** Smallest safe change, ~1 h + tests: in `checkWinner` when `recipient === 0`, remove (or set health 0 on) every `DEFENSIVE_BUILDINGS` member of the victim instead of re-owning it to 0, and in `nuclearBlast` edge handling leave towers alone (they still have an owner). Belt-and-braces: make `Fortifications.blocked` ignore owner-0 towers/walls (`towerOwner !== 0 && !allied`) and let `canAttackStructure(a, 0)` return true so stray neutral defensive buildings can be cleared by force. Add a regression test shaped like `BlastOwnershipLifecycle` "raid" mode with a tower: assert the tower is gone or attackable and its tile capturable. Trade-off: removing towers forfeits the inheritor's captured fortifications in the raid-only case only; the alternative (owner-0 = passable) changes pathing semantics for neutral walls generally, which is why both are suggested.
2. **Reject owner-0 (and unindexed-owner) markets in `allowedMarket` (I2).** One line: `if (b.playerId === 0 || !this.markets.has(b.playerId)) return false;` plus a test that neutralises a courier's destination mid-trip and asserts re-planning. ~30 min.
3. **Harden the three `states[owner].completed` dereferences (I5).** Delete `Trade.ts:386`; route `cargoEffects`/`goodsCapacity` through a `researchOf(owner)` helper that returns `[]` for unknown owners (or asserts with the building id in the message so a future freeze is diagnosable). Add a test calling `siteSnapshot`, `sourceStatus` and `goodsCapacity` with an owner-0 port. ~1 h.
4. **Reset trade controls on AI takeover (I6).** In `setAiController(ai=true)`: `trade.setPaused(id,false,false); setPaused(id,true,false); clear block lists; controlRevision++`. Decide whether AI should also clear blocks (recommend yes; blocks are a human expression of intent). ~30 min + test.
5. **Decide and document wall ownership on tower transfer (I3).** If walls should follow towers: in `Fortifications.step`, when both endpoints now share an owner different from `wall.playerId`, re-own the wall instead of killing it; keep killing only when endpoints disagree. ~1 h. If current behaviour is intended, add a comment and a test naming it.
6. **Make publication pure (I4).** Either drop `cache/dirty` from `Roads.checkpoint` (recompute on restore) or have `snapshot()` call a side-effect-free `packed()` that caches outside checkpointed fields. Extend the BlastOwnership purity assertion to `expansion.checkpoint()` so the rule is enforced globally. ~1 h.
7. **Replace the full-map scan in alliance acceptance (I9)** with iteration over `Skirmish.activeClaims` exposed through `ExpansionWorld` (claims are only ever non-zero for active claims, Simulation.ts:4752–4760) and drop the double `JSON.stringify` in favour of `diplomacy.revision` comparison. ~1 h; removes an O(map) stall per diplomatic event.
8. **Validate `owners[]` on restore (I10)** against the roster set already built at Simulation.ts:247–252; also tolerate `player(old)` being undefined in `changeOwner`/`nuclearBlast` (skip the counter). ~30 min.
9. **Key `amphibiousFactions` by research identity (I7)** like `Trade.cargoEffects`. ~15 min.
10. **Add an invariant for mixed-owner stacks (I8)**: a debug `verify` that every building on a tile shares an owner (or owner 0), run where `verifyBuildingIndexes` runs, so pop-up factions cannot silently violate the assumption behind `changeOwner`'s bulk re-own and the raids guard. ~30 min.
11. Call `fortifications.forgetBuilding`/`supply.forgetProducer` from `Expansion.afterMovement` when removing dead buildings (I11) so combat destruction and manual deletion share one cleanup path. ~20 min.
12. Remove the duplicated line at `Expansion.ts:1833` (I12).

## Open questions

- Is wall demolition on tower capture/inheritance intended (I3)? The code comments do not say; the elimination case deletes a whole faction's fortifications at once.
- Is `embarkedOn` still a live mechanic? No simulation code assigns it to a ship id; if it is legacy, `recordNavalLosses` cargo credit and the `checkWinner` ship-removal path could be simplified (and the restore validator could reject non-null `embarkedOn`).
- Should neutral *cities* count as capturable prizes with their stored goods? Today Supply deletes goods on any owner change (Supply.ts:275–277), so captured/inherited sources always arrive empty — fine for balance, but worth stating in the trade cargo design.
- For the pop-up factions plan: will they be created through `Expansion.add` + `Trade.markets` lazily (works today) and will their ids stay below `MAX_PLAYER_ID`/255 (CapturePressure uses 255 as the contested sentinel)?
