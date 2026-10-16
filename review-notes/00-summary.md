# 00 — Executive summary (Age of Fronts code review, 2026-10-15)

Read-only review of branch `1.5.7-10hz-prototype` including the uncommitted working tree (8 Hz). Sources: area notes 01–07 and sweeps 08a–08d in this folder, plus the verified bug ledger (two adversarial verifiers per suspected bug). Where a note and the ledger disagree, this summary follows the ledger. `08-latent-bugs.md` (full verified ledger) was still being written when this summary was produced.

## Verdict

The bones are good: the server-authoritative split is clean, nothing in `domain/`, `content/` or `client/` imports `Simulation.ts`, every AI action goes through the same command validator humans use, AI state is id-based and generation-fenced, the tests run the real simulation (190 of 360 files build a `Skirmish`), and checkpoints are close to complete. The 52-faction target is not reachable as the code stands, though. A 52-faction all-AI probe runs at 82–113 ms mean per tick on a desktop Ryzen 3700X, which is about 0.5x real time on the Oracle ARM host (06). Network efficiency is C+ for today's 3-human load and D for 8 humans (02). Every rejoin pauses the match for all players (02, 02b). The late-age combat model is broken: Early Modern and Modern hull weapons one-shot whole squads (05). Strategic AI nations almost never start wars except as retaliation, and economic AI caps itself at two cities and hoards gold (04, 04b). On top of that, there is one simple way to kill a live match with a crafted packet (08a). The recurring freeze class (live records cached across ownership changes) has been fixed at its known site. Its root cause, hand-wired ownership and elimination notifications, is still there, and nomads and pirates would add much more ownership and elimination churn (01, 08b). The working tree is red and mixes eight unrelated changes (08d). Order of work: ship the hotfix, set up a gate, fix the crash and ownership bugs, then do the scale work (network rejoin and presentation, idle-squad sleeping, AI budgets), and only then build pop-up factions on top of a lifecycle bus.

## Structure

Source: 01-structure.md.

- **Keep:** one-way dependencies at the hard boundary (verified across 453 files). `EntityCollection` is the only writer, with derived indexes and change journals. Content is zod-validated and fingerprinted (`content/Catalog.ts:96` `CONTENT_HASH`; the runtime id SHA-256s the source). The same `Skirmish` class runs in the browser worker, the server worker and the lab.
- **God objects:** `src/skirmish/Simulation.ts` is 5617 lines, 178 methods and 98 imports, and every system shares one 125 ms tick. `domain/Expansion.ts` (1930 lines) has a second command dispatcher of 457 lines (`:431-888`). The seams can be identified by line range: Naval `:2525-3367`, Faction AI `:4867-5424`, Ownership `:4608-4866`, Roster `:1027-1169` and `:5415-5508`, Command dispatch `:1245-1756`, Land navigation `:3849-4457`.
- **Freeze class is structural:** `changeOwner` (`Simulation.ts:4813-4866`) notifies seven subsystems by hand. Elimination and `setAiController` (`:226-240`) release only the subsystems someone remembered to list. `EntityCollection` hands out live mutable records (`EntityCollection.ts:19-21, 65-71`).
- **Parallel systems:**
  - A legacy sandbox ruleset is used only by tests. Production always passes `ages-v1`, yet `Simulation.ts` still has 182 conditional `this.expansion` branches, and 32 test files run only the legacy rules.
  - The dead client-host stack (`HostedRuntime`, `CommitVerifier`, `StateDelta`, `EconomyLedger`, `MatchAuthority`) is still compiled, still hashed into `runtimeId` (`RuntimeBuild.ts:18`), and `docs/MultiplayerPlan.md` still describes it as the current design.
  - Two AI generations run for each AI faction: `thinkAi` plus the domain directors.
- **Process gaps:**
  - `.gitignore:37` ignores `docs/`, so three docs are currently untracked without anyone noticing.
  - There is no CI and there are no hooks.
  - The content compilers are not in any npm script. The uncommitted recipe change now fails the doctrine validator (`scripts/FormationDoctrineSchema.ts:57`). Per the ledger, `content/formation-doctrines.json` itself is *not* stale.
  - `npm test` excludes `tests/skirmish` (`vite.config.ts:334`), and the root vitest config also picks up stale copies under `out/` (`vite.config.ts:331`).
- **Caps:** `Protocol.ts:26` `MAX_FACTIONS = 41` (regular factions), `FactionRules.ts:27-38` (20/14/30, `MAX_PLAYER_ID = 64`). The 8+14+30 target already fits (02b). However, players are only created in the constructor (`createPlayers`), so pop-up factions have no entry point.
- **Recommended sequence (01 R1–R8):**
  - R1, half a day: un-ignore `docs/`, add a skirmish-only `tsconfig` and an `npm run check` gate, add `compile:content` plus a compile-equality test, add a pre-commit hook.
  - R2, 1 day: delete the dead host stack, the legacy packet detail versions and the dev pages in the product build.
  - R3, 2–3 days: make `ages-v1` the only ruleset.
  - R4, 3–4 days: a `MatchLifecycle` bus (tile owner / entity owner / removed / eliminated / controller) with entity generation counters and a randomized checkpoint-purity property test. This is the prerequisite for 52-faction churn and for pop-up factions.
  - R5, one seam a week: extract `NavalSystem`, then `FactionAi` (with a per-faction budget scheduler), `Ownership`, `Roster` (+`addFaction`), `CommandDispatch`/`Recruitment`, and last `LandNavigation`.
  - R6–R8: split `Protocol.ts` into entities, commands and wire; consolidate docs into `docs/skirmish/README.md`; add an architecture-rules test (one cycle `AiNavalBombardment`↔`AiNavalPlanner`, one upward import at `Simulation.ts:33`).

## Network efficiency

Sources: 02-network.md, 02b-server-lifecycle.md.

**How it works:** one authoritative `Skirmish` per reserved worker thread. A journal-driven shared delta cursor feeds one gzip per publication, done on a separate encoder thread and shared by all subscribers. Frames are binary WebSocket. Queues are bounded at every hop. Publications go out at 5 Hz, plus an immediate publish after human commands (`serverMatchWorker.ts:282`). There is no interest management and no fog of war (`SnapshotCodec.ts:125-160`).

**Bandwidth (02).** Measured on a 47-faction Mediterranean match (896 squads, 93 traders, 260 buildings) on a desktop PC. The reference-load column is extrapolated to 1100 squads, 630 traders and 52 factions.

| Quantity | Measured (900 squads) | Reference load (est.) | Idle (no entity change) |
|---|---:|---:|---:|
| Delta publication, raw | 522 KB | ~700 KB | 75 KB |
| Delta publication, gzip | 54 KB | ~65–75 KB | ~9 KB |
| Per client at 5 Hz | 270 KB/s (2.2 Mbit/s) | 330–375 KB/s (~3 Mbit/s) | 45 KB/s |
| Per client at 8 Hz (publish-on-order) | 400 KB/s | 520–600 KB/s | — |
| Server egress, 8 clients, 5 Hz | 2.2 MB/s (17 Mbit/s) | 2.6–3 MB/s (21–24 Mbit/s) | 0.36 MB/s |
| Baseline (join / recovery), gzip | 290 KB | ~450 KB | — |
| Baseline capture on sim thread | 38 ms | ~100 ms (ARM) | — |
| Baseline encode | 99 ms | ~250 ms (ARM) | — |
| Delta capture on sim thread | 4 ms | ~12 ms (ARM) | ~3 ms |
| Delta encode (encoder thread) | 13 ms | ~28 ms (ARM) | ~3 ms |
| Client worker decode + apply + project | 6.5 + 8.6 + 3.6 ms | ~25 ms | ~8 ms |
| Worker → main clone of full view | 20 ms (1.2 MB equiv.) | ~30 ms | ~15 ms |
| Changed squads per 200 ms publication | 413 of 896 (46 %) | ~500 of 1100 | 0 |

**Latency (02, 8 Hz, nominal load).**

| | Best | Typical | Worst (overloaded tick) |
|---|---:|---:|---:|
| Receipt visible (ack only) | ~100 ms | ~225 ms | ~450 ms |
| First pixel of the new state | ~250 ms | ~400 ms | ~800 ms |
| Unit visibly at the published position | ~375 ms | ~600 ms | ~1050 ms |

The ~225 ms receipt breaks down as roughly 30 ms transit, 62 ms waiting for dispatch, 96 ms for the tick, and an occasional one-tick deferral. Per the ledger, the encoder-forwarding hop (`serverMatchWorker.ts:82-84`) adds latency only when the simulation thread is at or over its tick budget, but on the target host that is the common case.

**What to fix, in order:**
1. **Recovery loop:** S (02 #1; `ClientStateFlow.ts:21-23`). See the bugs section.
2. **Rate limiting:** S (02 #2, 02b #5). Rate-limit before `JSON.parse`/Zod and before the `structuredClone` at `CoordinatorServer.ts:245-247`. Cap frame size per message type; per the ledger, commands need ~100 KB, not 512 KB. Close sockets that repeatedly violate limits, add a per-IP socket cap, and add a per-guest cooldown on `match-state-resync` (`LiveMatch.ts:891-896`).
3. **Non-pausing rejoin:** M, 2–3 days (02 #3, 02b #1). An existing seat should reuse the `client-baseline`/flow-epoch path instead of the match-wide `sync` lock (`LiveMatch.ts:639-645`), and the heartbeat should tolerate 2–3 missed pongs (`CoordinatorServer.ts:495`). Without this, 8 humans will exhaust the 15 s/min pause budget and legitimate players get kicked.
4. **Incremental main-thread presentation:** M/L (02 #4, 07 I3). Today the browser main thread structured-clones the whole entity graph on every publication (`CanonicalStateStream.ts:141-146`, `multiplayerStateWorker.ts:100-103`). The ledger measured ~9.7 ms for the full clone at 900 squads. Note that the existing `packed` path is *not* a drop-in replacement (ledger).
5. **Metadata revisions:** M (02 #5). `progression` (~110 KB raw) is resent on every publication because `Progression.ts:196` bumps its revision every tick. Recruitment, inventories, tradeSites, armies and `players` have no revisions at all (`SnapshotCodec.ts:173, 390`).
6. **Cap command-triggered publications:** S (02 #7). With 8 humans, publish-on-order turns into 8 Hz publishing.
7. **Quantise squad motion:** ~1 day. Quantise `squadMotion` heading and speed to Int16. Per the ledger the saving is ~10–12 % of a frame, not 20 %, because slot and trader coordinates are already integer-valued.
8. **Cheaper compression:** S (02 #9). Switch the binary live path to zlib `deflateRaw` level 3 and drop the SHA-256 there. Both run on the encoder thread, not the sim tick (ledger).
9. **Fan-out copy:** 2 h (02b #7). Encode the frame body once per publication instead of per client (`CoordinatorServer.ts:203`).
10. **Interest management:** L, after 4/5/7 (02 #10). Two tiers: own faction plus the viewport mask at full rate, everything else at 1 Hz as minimap rows. Do this sooner if Oracle egress cannot sustain ~25 Mbit/s per 8-human match.

**Server lifecycle (02b):**
- Keep `MULTIPLAYER_MATCH_CAPACITY=1` on the 2-CPU host until the 52-faction profile has been measured, and add a container memory limit.
- There is no `uncaughtException`/`unhandledRejection` guard, while SQLite writes sit on timer, close and release paths (`CoordinatorStore.ts:69`, `CoordinatorServer.ts:448, 465, 489`). A disk-full or `SQLITE_BUSY` error would kill every live match (02b #3; design item, trigger probability unproven).
- The 100-command queue is shared by all players in a match (`LiveMatch.ts:560`). Use per-seat quotas.

## Combat

Source: 03-combat.md, plus 05 for late ages.

**What it is.** A squad-level formation-geometry model:
- `Battle.fight` (`Battle.ts:629`) visits squads in id order and acquires targets through a bounded spatial query, cached by local activity epochs.
- Contact is computed exactly from convex hulls (gap, normal, frontage, facing). Participants = files in contact × authored ranks.
- Per-soldier damage uses points armour plus one primary-class bonus and facing/shape/cover multipliers.
- Combat revision 10 routes melee through `MeleeDamageBatch` (`MeleeDamage.ts:118-175`), which caps each exposed slot at one soldier's HP and discards the overkill.
- Damage resolves simultaneously through a `DamageLedger`.
- Pre-Napoleonic ranged fire is one projectile per squad shot; later ranged fire is instant.
- Multi-row cavalry fights in three rank waves per 10.8 s. Charges resolve once.
- Naval combat is a nearest-target loop with committed-damage overkill avoidance.

The model is deterministic: there is no `Math.random`, and aim scatter is hashed. It is float-based, so results reproduce only on the same V8 build. Desktop steady-state cost is 6–12 ms per tick at 1100 squads. Per the ledger, the large first-contact spike is a synchronized first melee strike in `meleeReceivers` (`MeleeDamage.ts:46-72`): about 30 ms per 100 pairs striking in the same tick. It is not caused by body builds.

**What is wrong:**
- **Counter bonuses are lost.** Contact-limited melee throws away class-bonus overkill, which inverts infantry-beats-archers: archers now win 60v60 with 22 survivors (`MeleeDamage.ts:160-172`).
- **Cavalry DPS is far below authored.** Rank-wave cavalry deals about 1/6.5 of authored DPS unless the player spams charge (`Battle.ts:1025-1027`, `CavalryMelee.ts:7-12`).
- **Charge order bias.** Charge disruption is written in place during the id-ordered loop, so a lower-id defender strikes about 3 ticks earlier (`Battle.ts:762-765`). This is a fairness bias, not a desync (ledger).
- **Splash order bias.** Blast splash spends its budget in id order, not by distance (`Battle.ts:1524-1558`).
- **Volleys are absorbed.** A whole formation's volley stops at the first hostile body it crosses, so a one-man picket soaks an 81-bow volley (`Battle.ts:1289-1312`).
- **Under-modelled for legibility:** towers have no weapon before Modern (`Defences.ts:70-72`); land units cannot hit transports and warships cannot hit troops (`Units.ts:30-38, 502`); there is no morale/rout, attrition, forest cover or generals.
- **Napoleonic and later firearms decide fights on the first volley.** A 48-musket line deletes an equal line in one tick (05 #7, 08d #11), and nothing caps ranged overkill.

**Top 5 proposals:**

| # | Proposal | Where | Effort |
|---|---|---|---|
| 1 | Bounded cleave: an ordinary attacker addresses `ceil(perHitDamage / targetSoldierHp)` slots, capped at 2–3, so counter bonuses matter again. Apply the same per-body cap to per-soldier ranged volleys. | `Battle.ts:619-622`, `MeleeDamage.ts:120-134` | ~2 days |
| 2 | Fix cavalry cadence: scale each wave's budget by `cycle / sustainedInterval`, or make each wave its own commitment. Pair this with the pike brace rule. | `Battle.ts:990, 1025-1027`, `CavalryMelee.ts` | 1–3 days |
| 3 | Order-independent charge/AA effects: stage `chargeImpact` and aircraft hits in per-tick ledgers. Sort splash victims by distance, then id. | `Battle.ts:762-765, 842, 1524-1558` | 1 day + hours |
| 4 | Volleys that spread: resolve a projectile volley as a small blast across the target frontage, capped at `attackScale`. | `Battle.ts:1289-1312` | 1–2 days |
| 5 | Forts with teeth and coastal interplay: give towers an age-scaled short-range attack, give archers/artillery `ship` targets, give warships a weak anti-personnel profile. | `Defences.ts`, `Battle.ts:1039`, `Units.ts:502` | 2–3 days |

**Next layer, for decisive and legible battles in the style of Rise of Nations (03):**
- Attrition in enemy territory beyond supply range: 1–2 days.
- Morale and rout, resolved in a ledger after `fight()`: 3–5 days.
- Generals: 2–3 days.
- Forest cover and ambush: 1–2 days.

The ledger corrects 03 I7: `targetBody`, lunge and rank counts are authoritative damage inputs and must stay in state. Only `meleeStrike`/`combatFact` are presentation-only and could move to a transient stream.

## AI, tribes, nomads and pirates

Sources: 04-ai.md, 04b-ai-economy-naval.md.

**Current architecture.**
- `thinkAi` (`Simulation.ts:4867`) runs every tick for every AI faction:
  - It groups squads and drives `AiOperations.step` (peace/preparing/war/recovery, 16 candidate reads per tick, persisted records).
  - It runs a per-squad intercept/raid/march loop (1/6 of squads per tick).
- Nations additionally get the `AiEconomicDirector` pipeline (`AiEconomicDirector.ts:196-240`):
  - Fact readers run under one shared allowance.
  - Planners: army missions, invasion response, defense projects, modern fronts, naval missions, coast acquisition.
  - One `decide` per two ticks for the whole match, each issuing at most one command.
- Tribes get only `thinkTribeDevelopment` (catalogue-order research, one building of each type), recruitment in `thinkAi`, an 8-tile leash and the tribe branch of `AiOperations`. In the working tree tribes also get strategic operations by default (08d #12).
- All AI decisions go through `applyCommand`, and leases, reservations and missions are generation-fenced.

**What limits it today:**
1. **Commitment thrash.** The invasion response takes squads from army missions, and `AiArmyPlanner.stepMission` answers by releasing the *whole* faction (`AiArmyPlanner.ts:313`). Offensives collapse on every border poke. Per the ledger, the effect is repeated disband/re-select churn, not permanent loss.
2. **Nations rarely start wars.** `expanding` ignores `blocked` (`AiOperations.ts:405`), so any neutral frontier edge vetoes war against non-tribes unless the advantage is 2.5x or more. Combined with automatic human entry wars and trader theft (`Simulation.ts:3431, 3604`; `Trade.ts:1234`), the result is "everyone attacks the human" by accident.
3. **Scale collapse:**
   - Modern-front assessment resets whenever the global squad count changes (`AiModernFronts.ts:244-245`).
   - Naval planning is a fixed 16 units per tick for the whole match. Every fleet mission is killed at a hard 120 s deadline (`AiNavalPlanner.ts:306, 317`).
   - Coast acquisition scans all 12,203 coast edges on Mediterranean and never finishes before its 300 s deadline (`AiCoastPlanner.ts:158, 188, 194-206`).
   - The single decision slot is saturated, and only 24 % of decisions issue a command (04b benchmark).
4. **Manpower ceiling.** Nations stop at two cities before EarlyModern (`AiPlacementCandidates.ts:294`). Saving goals reserve *all* liquid gold (`AiEconomicDirector.ts:396-470`). The result is 100–247k idle gold at minute 10, with 19 of 27 factions holding a saving goal.
5. **Exploitable diplomacy.** Peace is accepted unless the AI is in `war` phase *and* has more total troops (`Expansion.ts:1067-1077`). Alliances are cheap (`AiPersonality.ts:76-91`). `beginAiRaid` (`Diplomacy.ts:57`) has no caller.
6. **Tribes are speed bumps.** Promotion needs 10 % of all land (`FactionRules.ts:65-77`), which is practically unreachable. Nations target tribes first, so tribes are eaten early.

**Fix first (≈4–5 days total):**
- Lease priority plus `releaseMission(plan)`: 0.5 day.
- `expanding = … && !blocked`, with a reachability-aware frontier: 0.5–1 day.
- Memoised `Diplomacy.hostile` pair table: 1 day. This is also a perf item.
- Sleep key without global force counts, and a hashed stagger: 0.5 day.
- Owner-scoped modern-front assessment: 0.5 day.
- Persistent fleet missions: 0.5 day.
- Cities for manpower and dropping the EarlyModern gate on `wealthy`: 0.5–1 day.
- Faction-scaled background budgets: 0.5–1 day.
- Release AI state in `checkWinner`: 1 h.
- Adopt or disband orphaned armies on human→AI handover: 2 h.

**Later (04b):**
- Multi-command decisions: 1–2 days.
- Reserve a saving *rate* instead of the whole balance: 1 day.
- Gate `advance` on the existing but unused `usableNextAge`: 0.5 day.
- Resource-directed expansion toward missing copper/tin/iron/carbon deposits: 2–3 days. This is the biggest competence gap versus a human.

**Proposed structure for 8 humans, 14 nations, 30 tribes and pop-ups (04):**
- **Keep:** decision = command through the same validator, generation fencing, id-based persistence, and one global per-tick read budget. Pop-ups are ordinary players.
- **Faction kinds:**
  - `FactionKind = regular | tribe | nomad | pirate`, with a `FactionProfile` table (`canOwnLand`, `canBuild`, `squadCap`, `victoryEligible`, `canAlly`, `promotesTo`, `despawnWhen`) replacing `kind === "tribe"` string checks.
  - Raise `MAX_PLAYER_ID` to 80 with a reserved band for pop-ups, keeping owners in a byte with 255 as the contested marker.
  - Keep `players` append-only, because `AiOperations.ts:407-408` indexes it by cursor.
- **New `domain/PopupFactions.ts`** (stepped from `Expansion.beforeStep`):
  - Deterministic spawn and despawn: nomads from Bronze, at most ⌈nations/4⌉, on neutral land ≥24 tiles from cities; pirates from Classical, at most ⌈ports/6⌉, near trade lanes from `AiNavalFacts`.
  - Settle means `kind → tribe` in place.
  - Excluded from victory and from `coalition()`.
- **Nomads:** roam → raid → extort → settle/hired phases on the existing `AiOperations` record. Migration legs use the existing route quotes and march cohorts. A moving camp is claimed through `NeutralTerritoryClaims`. Wiring `beginAiRaid` here gives nations low-intensity hostility too.
- **Diplomacy:** tribute and hire as new diplomacy actions on top of raids-v1 protection.
- **Pirates:** ship-only factions on `AiNavalFacts` lanes, using the existing `canSteal` capture path with a pirate short-circuit.
- **Budget:** nomads ≤8 squads, pirates ≤6 ships, one shared `AiRaidPlanner.step(8)` slot per tick; about +10 % AI tick cost at 6 pop-ups. All state goes in a versioned `popups` checkpoint section.
- **Phased plan:**
  1. Hardening (I1/I2, release on elimination, handover, append-only players, realm-safe typed-array check at `Simulation.ts:245-246`).
  2. Kinds and lifecycle. This needs the 01 R4 lifecycle bus and the R5 `Roster.addFaction`.
  3. Nomad AI plus tribute/hire.
  4. Pirate AI.
  5. Scale and balance pass: I3–I7, the tribe arc (promotion by reachable land or a fixed tile count, an age-parity path), then an ARM run with 52 factions + 6 pop-ups.
- **Prerequisites from balance (05):** fix the flat tribe reserve income first, because pop-ups would inherit it. Harden the `progression.states[owner].completed` dereferences first (`Supply.ts:139-140`, `Trade.ts:893`), because a pop-up building is exactly what would trigger the next freeze.

## Balance and economy

Source: 05-balance-economy.md. The bookkeeping is sound: escrow refunds once, costs use `Math.ceil` everywhere, and no duplication or refund exploits were found. The balance itself splits into two regimes.

| Problem | Where | Proposed direction | Effort |
|---|---|---|---|
| **Critical:** late-age hull weapons one-shot whole soldier squads. The legacy `1.5 ** ageIndex` (x11–x17) is applied against flat 100 HP soldiers, so an MG crew, T-34, Bumerang or T-14 erases a squad per shot. | `Units.ts:75, 112, 264`; `Combat.ts:146-160`; `Battle.ts:995` | Author hull damage at soldier scale (e.g. MG crew 60 dmg × 10 rounds / 2 s, +20 vs infantry; T-34 150/3 s, +300 vs infantry; T-14 400/4 s). Cap any non-per-soldier hit to `bodiesInReach × soldierHp`. | 2–4 days |
| Anti-tank is useless and vehicles are immune to every pre-modern weapon. ATGM does 21 HP per 3 s against 1500 HP; 64 pikemen do nothing to a Tsar tank. | `SoldierWeapons.ts:39, 54`; `soldier-weapons.json` | ATGM `vehicle` +400, PTRD +150, Napoleonic pikes/grenades +60. Add Early Modern / Modern rows to the balance contract. | in the above |
| Age-up needs only two trees, so warfare can be skipped (Stone→Modern 1.44M gold, ~31 min, naval + economic only). | `Progression.ts:101-106` | Require warfare slots 1–3, or add 50 % of the unfinished tree's gold to the advance price. Keep "any two" for tribes. | ½ day |
| Foreign trade mints the full payout for *both* sides (40 + 40 per good), and markets have no intake cap. One Modern factory is worth 38k/min to each side, versus 3.4k/min from 1,500 tiles of land. | `Trade.ts:1388-1392`; `TradeReceiving.ts:27-33` | Receiver gets a ~25 % tariff; add a per-market intake rate; per-faction commerce cap `2×(age+1)×min(factories, 3+age)`; land income `20×(age+1)/2 + land/40`. | 1–2 days |
| Stacking 15 buildings per tile multiplies deposit yield, reserve income and goods. | `Construction.ts:18`; `Supply.ts:363-372` | Mines 1 per deposit, cities 3, factories/ports 5, or diminishing √ yield. | ½ day |
| Napoleonic volleys kill ~90 % of an equal line (150 dmg vs 100 HP). | `soldier-weapons.json` | Muskets 150 → 70 dmg with rpm 6–8 and 8 s reload, or 150 HP bodies. Target: 15–20 % casualties at full range, ~45 % at close range. | 1 h data |
| Hull/ship refits are priced off the source unit (Stone warship + refit 3,300 vs 5,600 new). | `Refitting.ts:10`; `RefitQuote.ts:28-34` | `max(current, 60 % × (target − source gold))`, and require a port of the target tier. | 1 h |
| Data anomaly: the Modern MG crew has 200 hull HP while the Early Modern crew has 1000. | `formation-recipes.json` (`modern-field-support`) | Set it to 1000–1200 and recompile. | minutes |
| Tribe reserve income is a flat 40 points: 3.3x a Stone nation, 0.42x a Modern one, with a cliff on promotion. | `Simulation.ts:3676` | `round(baseReserveIncome(age) × 2)`. Reuse for pop-ups. | 10 min |
| Spawns are uniformly random. Humans only need to be 16 tiles apart, with no parity on coast, land or deposits. | `StartingPositions.ts:23-37`; `SpawnSelection.ts:74-78` | Human clearance `CAMP_RADIUS × 3`, ±30 % Voronoi area / coast-parity check, add horses to the deposit floor, and a lobby toggle. | 1–2 days |
| No upkeep, attrition or price ramp: land gold is linear and uncapped. | `Simulation.ts:3685-3689` | Pick one: attrition on hostile land, a +5 %/squad class price ramp (cap x2), a log land-income curve, or wonders as gold sinks. | 1–2 days each |
| Missile defence was never rescaled to 8 Hz: reload went from 20 s to 50 s, and the interceptor/missile speed ratio from 5.7x to 2.3x (08c I1). | `content/MissileDefense.ts:3-4` | `secondsToTicks(20)`, `80 * FIXED / TICKS_PER_SECOND`, plus a tick-constant lint test. | 1 h |

Two more items:
- Add a `BalanceMatrix.test.ts` (per-age dps/gold counter matrix) so regressions like these fail in tests (05 #10).
- Pacing is research-time-gated. Reaching Modern takes ~31 min of serial research (two trees) or ~46 min (all trees), so a 60–90 min match only works if everyone trades.

## Performance at the 52-faction target

Sources: 06-simulation-perf.md, plus the ledger and 04/07 items.

**Baseline:** a 52-faction all-AI probe on Migration 500 shows:
- Mean tick 82–113 ms on a desktop PC (≈200–270 ms on ARM, about 0.5x pace), with phase maxima of 100–380 ms and a 516 ms worst tick.
- Movement is 40–45 % of the tick and scales with *all* squads.
- The route planner is pinned at 104–120 of 128 jobs.
- `heapUsed` swings 107–476 MB against the worker's 384 MB cap.

Neither 8 Hz nor 10 Hz holds 1x real time. 8 Hz is the right choice, because per-second CPU scales almost linearly with tick rate.

**Fixes ranked by expected gain** (expected ARM ms saved per tick, from 06 unless noted):

| # | Change | Expected gain | Effort |
|---|---|---|---|
| 1 | Sleep idle squads across navigation, locomotion, avoidance, rollback and `advanceNavigation`. Today garrisons cost as much as marching armies (`Simulation.ts:3481-3616`). | −15…−30 ms mean | ~1 week + equivalence tests |
| 2 | Memoise `Diplomacy.hostile` (`Diplomacy.ts:124-126`; `protected`/`embargo` at `:31-36` allocate pair strings per row). Ledger measurement: 35–60 % of tick time in a 40-player raids-v1 match once tens to hundreds of embargo/protection rows are active. | potentially the largest single term when diplomacy rows build up; needs a profile in organic play | 1 day |
| 3 | Budget synchronous route repair. `LocalDetours` and amphibious `findExact` are invisible to `ROUTE_EFFORT_LIMIT` (`Simulation.ts:610-612, 4083-4131`). | −50…−150 ms routing tail (ledger: magnitude unconfirmed) | 2–3 days |
| 4 | Stop burning admission budget on refused planner requests: add a retry backoff or capacity-wait lists, and per-player planner reservations (`MovementAdmission.ts:957-962`). Per the ledger, live matches do not deadline-reject; refused admissions just keep retrying. | −5…−15 ms, steadier AI | 3–4 days |
| 5 | `resolveLandDamage`: return early on an empty ledger, iterate only damaged ids. It runs at least twice per tick (`Battle.ts:1112, 1653`; `Simulation.ts:4603`). | −3…−6 ms + GC | ½ day |
| 6 | Capture key: drop `paths.revision` (`Simulation.ts:4683`). Nearly every building placement bumps it and refreshes all S rows. | removes S-sized refresh bursts (−10…−20 ms spikes) | 2 h |
| 7 | AI frontier scan: check distance first and break early (`Simulation.ts:4970-4976`). Also bound the `thinkAi` raid `spatial.nearest` (`:5162, 5175`; ~16 ms per call on 2000-tile maps in the no-candidate case). | −2…−8 ms | 1–2 h |
| 8 | Planner bookkeeping counters (`RoutePlanner.ts:552-610`) and allocation hygiene: pre-initialise optional squad fields, reuse intent scratch. | −10…−20 ms combined with #5/#7 | 1–3 days |
| 9 | Time-slice elimination transfers (`Simulation.ts:5465-5491`). Ledger: ~35 ms per 5k tiles and ~100 ms per 20k, not hundreds. | removes one-tick spikes for very large factions | 2 days |
| 10 | Worker heap: raise to 512–640 MB, or halve the route/start-tree caches. | fewer mark-compacts | config |
| 11 | Two-tier cadence: squads near contact every tick, others staggered. | the only path to 1000×1000 maps with pop-ups | L |

**AI-side scale fixes:**
- Hashed stagger: `(id*3) % 24` uses only 8 of 24 phases (`Expansion.ts:1386-1387`).
- Faction-scaled planner budgets (04b).
- Measure the working-tree `hybridContacts` change, which now runs for every ranged squad (`Battle.ts:918`, 08d #8), on ARM before shipping.

## Client and UX

Source: 07-client.md. The renderer is mixed: a WebGL2 ground plus instanced strategic markers, Canvas2D for everything else including individual soldiers. `InstancedActorSprites` exists only as a prototype in a review scene (ledger). There is no order echo, so units visibly react 0.4–1.0 s after a click.

**Do now:**
1. **Pending-order overlay plus an acknowledgement sound** (S–M). Draw the route/attack line and a "…" status immediately; keep the build ghost until the building appears. This is the biggest perceived-latency win and needs no networking changes.
2. **XS fixes:**
   - Control-group recall leaves aircraft selected, so the next right-click sends a sortie (`main.ts:1146-1152`). Clear `selectedAircraft`.
   - Overlay canvases cover the drag-selection box and previews at strategic zoom (`style.css:169-183`). The ledger notes the pause dim already applies.
   - The double-right-click charge (`OrderGesture.ts:23-34`) is intentional and tested, but it is not listed in the controls popover (`HudView.ts:176`). Document it, or move charge to an explicit modifier.
3. **Per-frame waste:**
   - Melee-volley lookup map per snapshot instead of the O(fighting × volleys) filter (`Renderer.ts:1863`): XS.
   - Cache `targets` in `CombatPresentationTimeline.sample` (`:79, 96-98`). Only moved squads are cloned, so this is lower impact than 07 states.
   - Viewport reject in `squadAt` per pointermove (`Renderer.ts:643-666`).

**Next:**
- One playout clock with a target delay and slow shrink, driving both squads and `RenderSamples`. Today jitter turns into freezes and 630 traders stop and go. S.
- Readability: the 30 tribe colours sit in an RGB band of [89,166], with a minimum distance of 8.1 and 34 pairs under 25 (`FactionColors.ts:44-48`). Add a diplomatic colour mode, relation outlines on units, and authored hues for all 22 nations/humans. S + M.
- Toast and client-side fan-out for the silent 30-squad selection cap (`SquadSelectionViewModel.ts:36-42`). S.

**Later:**
- A lazy or typed-array presentation transport with a per-snapshot spatial grid. M–L.
- `InstancedActorSprites` for soldiers, after profiling. M–L.

**For an 8-human lobby the HUD needs:**
- chat (the `editingText` guard exists)
- pings
- a minimap with attack/ping alerts
- an all-faction diplomacy overview
- a player list with connection state
- observer mode after elimination
- jump-to on feed events
- RTS staples: attack-move, patrol, stances, rally points, idle cycling, edge-scroll

## Confirmed latent bugs

Severity order. These are the top items from the verified ledger; the rest are in [08-latent-bugs.md](08-latent-bugs.md).

**High**
1. `src/skirmish/Simulation.ts:1302-1305`: the charge fallback calls `map.ref` on unbounded client x/y. Any seated client can list any squad in column (even an enemy's) and send off-map coordinates; the throw rejects the advance and `LiveMatch` ends the match for everyone. Fix: an `isValidCoord` guard plus a per-command catch in `CommandApplications.apply`.
2. `src/skirmish/domain/Fortifications.ts:106`: towers re-owned to 0 on defeat (raids-v1, uncredited defeats, or credit chains ending in an eliminated faction; `Simulation.ts:5463, 5493-5494`) become permanent, indestructible obstacles that leave their tiles uncapturable.
3. `src/skirmish/multiplayer/application/ClientStateFlow.ts:21-23`: refusing a frame while `recovering` sets `dirty`, so every recovery triggers another full baseline. The affected client also gets no deltas while the loop persists. The test at `ClientStateFlow.test.ts:40-51` asserts this behaviour.
4. `src/skirmish/domain/AutomaticProduction.ts:203` (working tree): the 100-kit floor now also applies to the AI, deferring strategic payload production; `AiLateGame.test.ts:142` fails.

**Medium**

5. `src/skirmish/Simulation.ts:1467-1468`: skirmish/trench observers fire before an order can still be rejected. A rejected right-click on water makes entrenched squads leave their trench.
6. `src/skirmish/domain/AiArmyPlanner.ts:313`: a player-wide `release` for one inconsistent mission causes army disband/re-select churn.
7. `src/skirmish/domain/AiModernFronts.ts:244-245`: assessment restarts whenever the global squad count changes, and is silently inaccurate when the count is unchanged but squads changed. Sections never re-evaluate.
8. `src/skirmish/Simulation.ts:5006` / `:226`: on human→AI handover, human-created armies are excluded from every AI planner for the rest of the match.
9. `src/skirmish/domain/AiNavalPlanner.ts:306, 317`: every fleet mission aborts at 120 s with stop-ships and then idles for 20 s.
10. `src/skirmish/domain/AiCoastPlanner.ts:158, 188, 194-206`: liveness bug. On large maps the coast goal never leaves the scan phase.
11. `src/skirmish/domain/Diplomacy.ts:124-126`: unmemoised `hostile()` (see the performance section, #2).
12. `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:245-247, 297-308`: every frame is cloned, parsed and Zod-validated before the rate limit, receipts are exempt, and sockets that violate the limit are never closed.
13. `src/skirmish/multiplayer/application/LiveMatch.ts:891-896, 904`: `match-state-resync` has no cooldown, so one client can force about one full baseline per tick.
14. `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:475-482`: a failed match initialization is silent on the lobby page and the room has already been emptied or deleted.
15. `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts:495-503`: one missed 5 s pong terminates the socket, and each rejoin pauses the whole match.
16. `src/skirmish/Simulation.ts:604-612`: route repair and detour work is outside the effort limiter.
17. `src/skirmish/MovementAdmission.ts:957-962`: refused planner requests still consume admission budget, with no backoff.
18. `src/skirmish/Simulation.ts:4603`: `resolveLandDamage` allocates per squad per call, even when nothing was damaged.
19. `src/skirmish/client/main.ts:1146`: control-group recall leaves aircraft selected.
20. `src/skirmish/client/Renderer.ts:1863`: per-frame O(fighting × volleys) scan.
21. `scripts/FormationDoctrineSchema.ts:57`: the uncommitted recipes break the mounted-frontage invariant. 21 mounted pairs exceed 1.35 (worst ratio 2.03). The runtime does not enforce it.
22. `.gitignore:37`: `docs/` is ignored.

**Low**

23. `src/skirmish/domain/Trade.ts:440`: couriers already en route to a port that turned owner-0 deliver nothing and lose one stop. Fix: reject owner-0 in `allowedMarket`.
24. `src/skirmish/domain/Battle.ts:762-765`: charge order bias. `:1524-1558`: splash in id order. `:248`: the wall test uses root-to-root and wrongly denies melee near wall ends.
25. `src/skirmish/domain/MeleeDamage.ts:141, 162`: approved strikes with no exposed receiver deal 0 damage (rare: hysteresis band or a target mid-transition).
26. `src/skirmish/Simulation.ts:5456`: elimination never releases AI economy or operations state (bounded, but required before pop-ups).
27. `src/skirmish/domain/AiNavalPlanner.ts:573-575`: raw 400/800/200 tick constants make fleet recovery 2.5x slower at 8 Hz. `content/MissileDefense.ts:3-4` has the same class of problem.
28. `src/skirmish/Simulation.ts:254-255`: restore does not validate `owners[]` against the roster. `:414-424`: `amphibiousFactions` is keyed by research count only. Both are reachable only through test-only restore paths.
29. `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts:308`: raw exception text is broadcast to all clients. The same happens at `:84` and `:309`, and at `CoordinatorServer.ts:477-482`.
30. `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts:58`: a worker that dies during an empty pause goes unnoticed for up to 120 s.
31. `src/skirmish/domain/Expansion.ts:540`: a full-map tile sweep on each accepted alliance or peace (rate-limited, ~1–7 ms).
32. `vite.config.ts:331`: the root vitest config collects about 1,200 stale test files under `out/` (local only).
33. Raw sweep, not a separate ledger row: `Expansion.snapshot()` mutates checkpointed Roads `cache`/`dirty` (08b I4), which violates the publication-purity rule the freeze fix relies on.

Refuted or downgraded by verification (do not chase):
- **AI sleep key after restore.** `AiOperations.ts:324-325` breaks a test only because the fixture writes `owners[]` directly. Production cannot diverge.
- **Charge gesture.** The double-right-click charge is intended behaviour.
- **Doctrine output staleness.** `content/formation-doctrines.json` is not stale.

## Working-tree review

Source: 08d-sweep-working-tree.md, with ledger corrections.

**Do not merge as one PR.** The uncommitted tree combines at least eight independent changes:
1. the 2026-10-15 freeze fix (`Trade.currentMarkets`/`siteSnapshot`, `Trade.ts:346-380, 1001-1017`)
2. blast-edge building reassignment on defeat (`Simulation.ts:5440-5474`)
3. a rules-version-12 pre-modern rebalance (`combatRevision 10`)
4. weapon accuracy
5. contact-limited melee (`MeleeDamage.ts`)
6. one-shipload port storage (`Supply.ts:137-141`)
7. tribal strategic operations on by default (`AiOperations.ts:99-102`)
8. a human war-on-entry rewrite
9. a client combat presentation timeline
10. new lab tools

On the positive side: TypeScript is clean, the compiled catalogues match the plans, and the `combatRoots`/`volleyRoots` codec is symmetric and version-safe.

**The suite is red.** Per the ledger, 12 tests in unchanged, committed test files fail against the working tree and pass at HEAD. There is also at least one admitted `PreModernBalance` failure. The runs disagree on how many `PreModernBalance` assertions fail (1 vs 3), so reconcile `BalanceContract.md:84-90, 115-119` against a fresh run. Real regressions:
- AI payload starvation (`AutomaticProduction.ts:203`)
- the doctrine compiler (`FormationDoctrineSchema.ts:57`)
- tribal river reinforcement (`RiverExpansion.test.ts:89`, untraced)
- `SoldierDetailMode` fixture breakage (`TroopActors.ts:476`)
- stale literals in five files

Lint: three new oxlint errors (`compileSoldierWeapons.ts:25`, `UnitLabSheet.ts:73, 482`). Lint was already red at HEAD.

**Recommendation:**
1. **Now:** split out and ship the freeze/ownership/HUD/`OnlineMatchSession.fail` hotfix with its four reproduction tests. Add the `states[owner]?.completed ?? []` hardening (`Supply.ts:139-140`, `Trade.ts:893`; delete the dead line at `Trade.ts:386`). This needs no rules-version bump.
2. **Hold everything else** until the suite is green: AI floor fixed, doctrine ratio fixed and all three compilers re-run, fixtures updated, River regression bisected, contract reconciled, lint clean.
3. **Before the rest merges, decide three policies explicitly:**
   - port storage capped at one shipload
   - uncapped close-range firearm overkill
   - tribal campaigns on by default (`AiTribeExpansion.md` notes "starting nations fall quickly"; put it behind a policy flag until a Mediterranean playtest)
4. **Measure the `hybridContacts` guard removal** (`Battle.ts:918`) on the reference load.

## Roadmap

**Now (this week and next)**
- Split and ship the freeze hotfix plus the `states[owner]` hardening. From 08d, 08b I5.
- Charge-coordinate guard plus a per-command catch in `CommandApplications.apply`. From 08a #1.
- Recovery-loop fix, rate-limit before parse, resync cooldown. From 02 #1–2, 02b #5.
- Neutral towers: remove or make attackable on recipient-0 defeat, and add a raid-mode regression test. From 08b I1.
- Gate: un-ignore `docs/`, `npm run check`, `compile:content` plus an equality test, pre-commit hook, `**/out/**` excluded from vitest. From 01 R1, 08c I12.
- Get the working tree green and decide the three policies. From 08d.
- XS AI fixes: lease priority with `releaseMission`, `expanding` respects `blocked`, release on elimination, orphan armies on handover, raw tick constants, missile-defence rescale. From 04 #1/#2/#8/#9, 04b #9/#10, 08c I1.
- XS client fixes: aircraft recall, overlay z-order, melee-volley map, document the charge gesture. From 07.
- Process hardening: persistence and `send()` guards, lobby-visible init failures, sanitised error text, cancelSync scoped to its admission. From 02b #2–4, #10.

**Next (the following month)**
- Non-pausing rejoin and a relaxed heartbeat. From 02 #3, 02b #1.
- Metadata revisions, capped command publications, encode-once fan-out, `deflateRaw`. From 02 #5–9, 02b #7.
- Incremental main-thread presentation. From 02 #4, 07 I3.
- Pending-order overlay and a playout clock. From 07 #1, #4.
- Diplomacy hostility memo, idle-squad sleeping, route-repair budget, admission backoff, ledger and capture-key fixes, heap size. From 06 #1–#11, 04 #3.
- AI economy: scaled budgets, cities for manpower, persistent fleets, local coast scan, saving rate, `usableNextAge`. From 04b #1–#7.
- Late-age damage rescale, age-up gate, trade tariff and intake cap, stacking limits, refit pricing, tribe reserve curve, Napoleonic volleys, balance-matrix test. From 05 #1–#7, #10.
- Combat cleave, cavalry cadence, order-independent charge and splash. From 03 #1, #3–#5.
- Lifecycle bus plus checkpoint-purity property test. From 01 R4.
- Delete the dead host stack and the legacy ruleset. From 01 R2–R3.

**Later**
- `Simulation.ts` seam extraction, one per week (Naval → FactionAi → Ownership → Roster/`addFaction` → CommandDispatch → LandNavigation), and the `Protocol.ts` split. From 01 R5–R6.
- Pop-up factions: `FactionKind`/`FactionProfile`, `PopupFactions` lifecycle, nomad AI with tribute/hire, pirate AI, tribe promotion arc. From 04 design and phased plan.
- Combat legibility: firing towers and coastal interplay, attrition, morale/rout, generals, forest cover. From 03 #9 and the gameplay proposals.
- Interest management (two-tier viewport/minimap feed). From 02 #10.
- Two-tier simulation cadence for 1000×1000 maps. From 06 #13.
- Seed and command journal, then periodic server checkpoints for crash recovery, behind a checkpoint rules fingerprint. From 08c #2–#4.
- 8-human HUD: chat, pings, minimap, diplomacy overview, player list, observer mode, RTS staples. Also the diplomatic colour mode and palette rework, and instanced soldiers. From 07.
- Spawn parity for humans and snowball dampers. From 05 #8–#9.
