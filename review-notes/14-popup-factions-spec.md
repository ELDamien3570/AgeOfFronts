# 14 — Pop-up factions: a buildable specification (nomads, pirates, other kinds)

Round 2 reviewer. Read-only review of the working tree as of 2026-10-16. I modified nothing in the repository except this file. Line numbers are current and were checked with `grep -n` and `sed -n`.

**CONFIRMED** means I traced the code path end to end, or ran it. **SUSPECT** means the mechanism is clear but I did not observe the consequence. **DERIVED** means a number is computed from measured per-unit costs, not measured directly.

> **Read this first: the owner already has an agreed nomad design, and it contradicts round 1.**
> `.codex/1.5 Update Plans/Nomad Factions/PLAN.md` (778 lines, dated 2026-10-07, status "gameplay design agreed; implementation not started", "Authority: the decisions recorded in the design conversation take precedence over older plans") fixes the nomad rules:
> - Nomads have a compact paid economy: a main yurt (a reskinned city), bow-maker's yurts and warriors' yurts.
> - Spawning works by groups of 3–5 rival factions, with at most 20 living nomads.
> - The spawn window opens on Bronze→Classical tech eligibility and closes permanently once three factions reach Early Modern.
> - The last surviving group member becomes Khan. Every credited conquest adds 10 squad capacity, up to 100.
> - Nomads never accept alliances. Peace happens through popups.
> - Nomads count as opponents for elimination victory.
> - There is no promotion into tribes or nations.
>
> Round 1 (`04-ai.md` "Design", `00-summary.md` lines 173–193) proposed something incompatible:
> - economy-less nomads ≤ 8 squads
> - roam/raid/extort/settle phases
> - settling = becoming a tribe
> - tribute/hire for nomads
> - pop-ups excluded from victory
> - "+10 % AI tick at 6 pop-ups"
>
> This spec therefore does three things:
> - **(a)** It treats PLAN.md as authoritative for nomads. It supplies the numbers, files, schemas and tests that PLAN.md leaves open.
> - **(b)** It applies the "no economy" premise of my brief to the kinds PLAN.md does not cover: pirates, and hireable mercenary bands as a contract mode of pirates. Rebels are evaluated as an optional later kind.
> - **(c)** It replaces round 1's unsupported cost claim with measured per-unit costs.
>
> Where I recommend something PLAN.md lists as "tuning" or "policy pending", I label it as a proposal.

---

## Scope read

**Owner design and round-1 notes**
- `.codex/1.5 Update Plans/Nomad Factions/PLAN.md` 1–778 (all).
- `review-notes/04-ai.md` (all), `04b-ai-economy-naval.md` 85–118 and 138–141.
- `05-balance-economy.md` 290–297 (issue 10), `07-client.md` 121–126 (I10).
- `01-structure.md` 70–95 (I4/I9), 125–140 (R4/R5).
- `06-simulation-perf.md` 19–60 (probe).
- `08-latent-bugs.md` 41, 460–477 (L1), 1690–1732 (refuted table), `00-summary.md` 25–30 and 128–198.

**Faction model**
- `src/skirmish/FactionRules.ts` 1–102 (all).
- `src/skirmish/Protocol.ts` 17–30, 31–230 (Command union), 299–321 (`Player`), 480–560 (`Snapshot`, `SnapshotPacket`).
- `src/skirmish/domain/FactionRoster.ts` 1–81 (all).
- `src/skirmish/content/Factions.ts` 140–200 and the group list. I counted the deck with a scratch script: 224 regular / 241 tribe identities across three origins.

**`src/skirmish/Simulation.ts`**
- 220–345: `setAiController`, `checkpoint` (version 11), `restore`/`installCheckpoint` validation.
- 548–575: `aiFootprintAllowed` cache key.
- 755–790: constructor caps.
- 1000–1176: `createPlayers`, `deployPlayer`, `deployStartingSquads`, `player()`.
- 1262–1300: AI and tribe command restrictions.
- 1505–1514: replenish legality.
- 2354–2400: `spawnSquad`.
- 2481–2535: `applyReservePoints`, `replenish`.
- 2560–2615: `recruitShip` completion.
- 3420–3445: tick head.
- 3600–3620: land entry wars.
- 3678–3700: `produceReserves`.
- 4670–4712: `capture`.
- 4888–5010: `thinkAi` head.
- 5436–5527: `promoteTribes`, `checkWinner`.

**`src/skirmish/domain/Expansion.ts`**
- 148–171: checkpoint/restore.
- 195–264: `announce`, constructor, `add`.
- 1111–1200: `beforeStep`.
- 1382–1400: `thinkProgression` head.
- 1929–1945: `coalition`, replication metadata.

**Diplomacy and trade**
- `domain/Diplomacy.ts` 1–340 (all), `DiplomacyValidation.ts` (all), `Definitions.ts` 265–274 (`DiplomacyState`) and 475–500 (`MatchEvent`).
- `domain/Trade.ts`:
  - 189–200: sea-actor index, `raidTargets`
  - 440–450: `allowedMarket`
  - 655–690: candidates / no-receiver
  - 955–965: `actorCap`
  - 1012–1060: `spawn` / global cap
  - 1205–1300: theft and prize
  - 1360–1400: prize delivery
- `git show f0d2cee0 --stat` (automatic sea piracy: `Trade.ts` +4/−2, `TradeFleet.test.ts` +65).

**AI**
- `domain/AiOperations.ts` 1–446 (all).
- `domain/AiNavalPlanner.ts` 1–330 and 630–665.
- `domain/AiNavalFacts.ts` 340–440.
- `domain/AiEconomicDirector.ts` 212–216.
- `domain/AiPersonality.ts` 1–91.
- `domain/DiplomaticGeography.ts` 36–48.
- `domain/TribeDevelopment.ts` (all).
- `domain/Progression.ts` 91–145.
- `domain/NeutralTerritoryClaims.ts` 1–80.
- `domain/SkirmishStance.ts` 85–89 and 175–179, `domain/TrenchPositioning.ts` 55–60.
- `domain/Battle.ts` 1114–1160 (structure attack commit).

**Content and supporting files**
- `content/Units.ts`: I dumped the full `UNITS` and `VESSELS` roster with costs via a scratch script.
- `content/Economy.ts` 9–10 and 54–61, `domain/Manpower.ts` 126–128.
- `FactionAdjacency.ts` 1–30, `domain/SpawnSelection.ts` (API).

**Client, wire and server**
- `client/FactionColors.ts` (all), `lobby/FactionPalette.ts` (all), `client/TerritoryLayer.ts` 70–110.
- `client/EmpireHudView.ts` 485–505, `client/EmpireView.ts` 760–777, `client/FactionViewModel.ts` 20–32.
- `SnapshotCodec.ts` 380–395, `multiplayer/SnapshotWireCodec.ts` (all), `multiplayer/StateCodec.ts` 365–395 (gzip).
- `multiplayer/CommandSchema.ts` 1–92 and 139.
- `multiplayer/application/LiveMatch.ts` 265–282, 555–575, 785–805.
- `multiplayer/infrastructure/serverMatchWorker.ts` 195–255, `CoordinatorServer.ts` 285–310 (rate limit).

**Measurements (scratch only, under `scratchpad/popup/`)**
- `aicost.ts`: per-faction AI cost probe.
- `players.ts`: player-list wire size.
- `colors.ts`: palette distances.
- `units.ts`, `vessels.ts`: roster dumps.

---

## How it works today

### Faction identity, ids and caps

- **Kinds.** `Player.kind` is `"regular" | "tribe"` (`Protocol.ts:310`, `FactionRoster.ts:5`).
- **Id range.** Ids are dense, `1..N`, created only in `createPlayers` (`Simulation.ts:1032–1067`) through `deployPlayer` (`:1069`). There is one `players.push` (`:1102`). `player(id)` has an O(1) fast path `players[id-1].id === id` (`:1173–1176`).
- **Caps.**
  - `MAX_PLAYER_ID = 20+14+30 = 64` (`FactionRules.ts:27–38`). A 20-human lobby uses the whole range.
  - `MAX_FACTIONS = 41` regular (`Protocol.ts:25`).
  - Owners are a `Uint8Array`, and 255 is the contested marker.
  - `restore` accepts ids `1..254` (`Simulation.ts:258`), but `FactionAdjacency` only stores `1..64` (`FactionAdjacency.ts:7–9`).
- **Identities.** They come from `FactionRoster`: two decks (`regular`, `tribe`), each with its own seeded stream (`FactionRoster.ts:23–26`). `take` throws when a deck is exhausted (`:79`).
- **Deploy.** `deployPlayer` decides `ai: id > humanCount` (`:1083`), then:
  - pushes the player and calls `expansion.add` (progression and supply registries);
  - claims a radius around the base (`:1105–1110`);
  - **then** validates the camp, throwing if there is no room (`:1113–1114`);
  - grants a completed city and 3 or 4 starting squads.

### Who is "special" today

There are 67 string comparisons on `kind` across 19 files. I listed every one; the relevant consequences are in the kind-audit table under Issues.

A new kind string falls through to whatever the `else` branch of each site does. In most places that means "regular nation", in some it means "tribe", and in the client it means "nation".

### Diplomacy that pop-ups need (raids-v1, production default via `DEFAULT_AI_POLICIES`)

Hostility (`Diplomacy.ts:125–127`):

```
hostile(a,b) = nonAllied ∧ ¬protected ∧ (declaredWar ∨ embargo)
```

The other predicates:
- **Embargo.** Directional theft in the last 60 s (`:34–36`). Combat permission from it is mutual.
- **Capture.** `canCapture` requires a declared war for owned land. It is true for neutral land (`!b`, `:37–40`).
- **Theft.** `canSteal`: an AI may only steal under a war or an existing embargo. A human steals automatically (`:41–48`).
- **Raids.** `beginAiRaid` (`:57–66`) opens an embargo by recording a theft. It has no non-test caller.
- **Wars.** `establishWar` records `initiator` and `cause` (`:67–75`).
- **Peace.** It is neutral: it clears war and embargo and grants 60 s of protection. The proposer has a 300 s per-pair cooldown, and there is a 30 s per-human-recipient cooldown for AI proposers (`:150–166`).
- **Kind gate.** Alliance actions involving a tribe are rejected except `declare` (`:168–173`). Any other kind passes.

### Trade theft and prizes

Each live trader looks for a captor within 1.2 tiles that passes `canSteal` (`Trade.ts:1229–1236`). Theft does the following:
- records the embargo (`:1241`);
- re-owns the actor as a `prize` (`:1249–1259`).

A prize is delivered only to a market of its new owner (`:445`). If none is reachable it waits in `no-receiver` and retries every 5 s (`:661–668`). There is also a cheap sea-actor spatial index, rebuilt at most once per tick (`:189–195`). `raidTargets` samples it with bounded reads (32 results, 256 reads; `:197–200`). The naval AI already uses it (`AiNavalPlanner.ts:641–649`).

### AI participation by kind (production options: `aiEconomy`, `deferredPlanning`, `aiWarPolicy`, `aiNaval` all true; `content/AiPolicies.ts:4–8`)

**`AiOperations.enabled`** (`AiOperations.ts:99–102`): `ai && !eliminated && (regular || deferredPlanning)`. In production any AI faction of **any** kind is enabled. Inside it, the code branches only on `=== "tribe"`, so a new kind takes the **nation** branch: `raidAfterTicks`, invasion war through `establishWar`.

**`AiOperations.step`, per tick:**
- builds `ageKey` over **all** players, including eliminated ones (`:309`);
- runs a release loop over records (`:311`);
- runs a candidate scan that indexes `world.players[r.cursor++]` and charges `this.work++` **before** skipping eliminated or ineligible rivals (`:408–410`). The global cap is 16 reads per tick.

**Economy and naval planners.** The economy director and naval planner are nation (+ tribe-naval) only (`AiNavalPlanner.ts:186–192`). The naval planner is port-centric: a theater scan with no owned port returns no sea (`:155`). Every mission has a 120 s deadline (`:306`). It is stepped with 16 units per tick, for one faction per tick (`AiEconomicDirector.ts:214`).

**`thinkAi`** (`Simulation.ts:4888`): every AI player every tick, per-squad decisions at a 0.75 s stagger. `operations.enabled(player)` is called once per AI per tick (`:4961`).

**`thinkProgression`** (`Expansion.ts:1382–1400`): tribes branch off. Every other AI kind enters the nation research/advance path, and the legacy path when the economy director is off for that player.

### Economy defaults that apply to every live player

- **Reserves and gold.** `produceReserves` gives every non-eliminated player a base reserve income (tribes a flat 40, others `baseReserveIncome(age)`), plus city income, plus **20 gold/s + land/40** (`Simulation.ts:3683–3699`).
- **Trade caps.** `Trade.actorCap` is 48 for every non-tribe (`Trade.ts:962`). The world trade cap is the sum over live players (`:1022–1023`).
- **Squad caps.** `squadCap` gives non-tribes the nation age caps of 60–200 (`FactionRules.ts:95–102`). `shipCap` gives AI non-tribes 32 warships (`:34–36`).

### Survival, victory, promotion

- **Survival** (`checkWinner`, `Simulation.ts:5446–5527`): a faction survives with a ground squad with troops > 0, or a completed city (`:5449–5452`). Ships do not count.
- **Victory.** Solo victory goes to the last survivor (`:5514–5515`). Allied victory (`Expansion.ts:1929–1940`) needs no live tribe, at least one eliminated regular, and every live pair allied.
- **Promotion.** Tribe promotion flips `kind` in place (`:5436–5444`, `:5506–5512`).
- **Advancement.** `tribeAdvanceRejection` counts "surviving non-tribes" as the reference population (`TribeDevelopment.ts:12`).

### Replication and HUD

- **Player list.** `SnapshotPacket.players` carries every `Player` record (all fields, eliminated included) on every publication (`SnapshotCodec.ts:390`).
- **Colours.** These are client-computed in id order (`FactionColors.ts:73–114`). The roster key includes every player (`:77–80`). Any roster change re-runs assignment. `TerritoryLayer.setColors` repaints every ownership pixel when the palette array differs in length or content (`TerritoryLayer.ts:80–88`).
- **Events.** A ring of 80 `MatchEvent`s (`Expansion.ts:202–205`) with kinds `age | conquest | diplomacy | promotion | war` (`Definitions.ts:479`). The HUD formats them in English inline (`EmpireHudView.ts:485–500`).

---

## Strengths

- **The intent/permission split already exists.** Raids-v1 separates combat permission (embargo or war) from capture permission (war only) (`Diplomacy.ts:37–48`). This is exactly the permission matrix PLAN.md §9 asks for, so PLAN.md "Stage 2" is mostly done. What remains is an AI caller for `beginAiRaid` and a kind-aware alliance gate.
- **Neutral peace already matches PLAN.md §12.** It clears wars and embargoes and grants 60 s protection, with per-pair and per-recipient cooldowns and context de-duplication (`Diplomacy.ts:76–83`, `:150–166`).
- **War records carry initiator and cause** (`Diplomacy.ts:67–75`, `Definitions.ts:270`). This is the evidence PLAN.md's retaliation trigger needs ("invades nomad land and establishes war" ⇒ `cause: "entry"` with initiator ≠ nomad).
- **Bounded trade-raid targeting exists.** `Trade.raidTargets` plus the per-tick sea index are reusable as-is for pirates, with a predicate parameter.
- **Progression supports a starting age per player.** `Progression.add(playerId, startingAge)` (`Progression.ts:138`) means a late faction can be registered at any tier without new progression code.
- **`spawnSquad(player, line, tile, definitionId, consumeReserves=false)`** (`Simulation.ts:2354`) is a clean grant path for spawn packages, identical to how starting squads are created.
- **Determinism discipline is in place.** There are dedicated PRNG streams (`FactionRoster`), id-sorted tie-breaks, generation fencing of AI leases and tasks (`controlGenerations`), and append-only players. A pop-up system can follow these patterns.

---

## Issues

Severity is for the pop-up target: 8 humans + 14 AI + 30 tribes, plus PLAN.md's up to 20 living nomads, plus pirates.

### P1. The round-1 pop-up design contradicts the owner's agreed nomad plan — design/process, **high**, confidence high

**Where:** `review-notes/04-ai.md` §Design / §Phased plan and `00-summary.md` 173–193 versus `.codex/1.5 Update Plans/Nomad Factions/PLAN.md` §2, §5, §12, §13.

**Contradictions** (round-1 proposal → PLAN.md):
- no economy, cap ≤ 8 squads → paid yurts, cap 10 + 10 per conquest up to 100;
- settling into a tribe → no promotion; kind persists after capturing cities;
- tribute/hire for nomads → nomads never accept alliances, and only peace popups exist;
- pop-ups excluded from victory → "surviving nomads block ordinary all-factions-eliminated victory";
- spawn at most ⌈nations/4⌉ from Bronze → groups of 3–5, at most 20 living, latches on tech eligibility and on the third Early Modern faction;
- "AiRaidPlanner.step(8) ≈ +10 % AI tick" → no measured basis (P14 gives measured numbers).

**Consequence:** a developer following round 1 would build the wrong feature. Nomads must follow PLAN.md. The round-1 economy-less model is still useful, but only for pirates and contract bands, where no owner design exists.

### P2. The id range cannot hold the target roster plus pop-ups, and id-indexed structures disagree on the bound — bug/design, **high**, CONFIRMED

**Where:** `FactionRules.ts:38`; `FactionAdjacency.ts:7–9, 14, 18, 22`; `Simulation.ts:258, 559`; `DiplomacyValidation.ts:4`; `client/FactionColors.ts:46`.

**Mechanism:**
- `MAX_PLAYER_ID = 64` equals the largest constructor roster (20 + 14 + 30).
- `FactionAdjacency` silently ignores any owner > 64:
  - `adjacent` returns false;
  - `adjust` returns true without counting.
  - So a faction with id 65+ that owns land has no borders and no `hasUnclaimedFrontier`. That breaks PLAN.md's "neighboring means sharing a territorial border" campaign targeting and `AiOperations.expansionBlocked`.
- Restore and diplomacy validation accept ids up to 254.
- The legacy footprint cache key `playerId + prospective*(MAX_PLAYER_ID+1)` collides once ids exceed 64. For example (66, 0) and (1, 1) both give 66. Under raids this branch returns earlier (`:549–551`), so the collision is legacy-only.

**Consequence:** any mid-match faction in a lobby above 52 regular+tribe seats, or any pop-up lifetime beyond 12 at the 52 target, silently loses border facts.

**Lifetime arithmetic for PLAN.md:** at most 20 living nomads, with no id reuse (PLAN.md §14 forbids naive recycling). Over a typical Bronze→Early-Modern window, waves of 3–5 can easily produce 40–80 lifetime ids.

### P3. `deployPlayer` is not atomic and is constructor-shaped; reusing it mid-match leaves half-registered factions — bug (latent), **high**, CONFIRMED by reading

**Where:** `Simulation.ts:1083, 1102–1114`.

**Mechanism:** the function does four things in order:
1. pushes the player (`:1102`) and registers progression and supply (`expansion.add`, `:1103`);
2. flips ownership of a radius (`:1105–1110`, through `changeOwner`, which notifies supply, operations, adjacency, economy, boundaries, absorption and coastal territory);
3. calls `startingCamp`;
4. throws if there is no room (`:1113–1114`).

It also derives `ai` from `id > humanCount` and always grants a completed city. PLAN.md §5.1 says the opposite: spawn **without** a completed yurt.

**Consequence:** a mid-match `addFaction` built on `deployPlayer` would, on a failed placement:
- throw out of `step()` after mutating players, owners and every territory subscriber; the worker has no recovery, so this is a match freeze;
- or, if caught, leave a ghost player with tiles and no units. A ghost passes `checkWinner` as eliminated next tick, and its tiles go to owner 0, which is the 2026-10-15 freeze class.

PLAN.md §14 requires an atomic group spawn.

### P4. A new kind inherits nation or tribe behaviour at a dozen sites — design/bug, **high**, CONFIRMED by reading

Default behaviour for a new kind string (e.g. `"nomad"`, `"pirate"`):

| Site | Today for a non-tribe AI | What is needed |
|---|---|---|
| `AiOperations.enabled` `AiOperations.ts:99–102` | enabled (deferredPlanning=true) and runs the **nation** branch: `raidAfterTicks`, `establishWar` invasions, full candidate scan | per-profile branch (nomad phases per PLAN.md §8; pirates excluded and stepped by their own planner) |
| Candidate scan `AiOperations.ts:405–431` | nations treat a nomad camp as an invasion target via `geography.eligible` base distance ≤ 64 (`DiplomaticGeography.ts:39`) | PLAN.md: nations may invade nomads (that is the retaliation trigger), so keep them; pirates must be excluded (no base, no land) |
| `Expansion.thinkProgression` `Expansion.ts:1390–1400` | research and age-advance through the nation path (and legacy path when the director is off) | nomads: own shallow tree (PLAN.md §6); pirates: no progression actions |
| `produceReserves` `Simulation.ts:3683–3699` | nation base reserve income + **20 gold/s** + land income | nomads: PLAN.md §5.3 (yurt bonus, pending); pirates: **0** passive income |
| `Trade.actorCap` `Trade.ts:962`, global cap `:1022–1023` | 48 traders each, added to the world cap | nomads: profile value; pirates: 0 (otherwise 20 living nomads add +960 to the world trader cap) |
| `squadCap` `FactionRules.ts:95–102` | 60–200 | nomads: `min(100, 10+10·credits)` (PLAN.md §7); pirates: 0 squads |
| `shipCap` `FactionRules.ts:34–36` | 32 per hull class | nomads: 0 warships (PLAN.md §6); pirates: 6–8 |
| `tribeAdvanceRejection` `TribeDevelopment.ts:12` | pop-ups count as "surviving non-tribes", so the denominator of the 75 % rule grows and tribes age more slowly | count `kind === "regular"` only |
| `Diplomacy.action` kind gate `Diplomacy.ts:172` | alliance offers to and from a nomad are accepted by the validator | PLAN.md: nomads never accept alliances, so reject by profile |
| `EmpireView` `client/EmpireView.ts:769–776` | shows Offer alliance / Long-term buttons and labels the pop-up "AI nation" | profile-driven buttons and label |
| `checkWinner` `Simulation.ts:5449–5452` | ships do not count for survival | pirates: ships count (P5) |
| `coalition` `Expansion.ts:1935` | only tribes block; a never-allied nomad blocks implicitly through the pairwise allied check | PLAN.md §13 says to review allied mode explicitly (open question) |
| `capture` `Simulation.ts:4688–4693` | every land squad presses claims on neutral land (`canCapture(a,0)` is true, `Diplomacy.ts:38`) | nomads: yes (PLAN.md Phase C); pirates/bands: none |
| `SkirmishStance.ts:87,177`, `TrenchPositioning.ts:58` | tribe-only exclusions | decide per profile (nomad horse archers probably want skirmish stance) |

**Consequence:** dropping a new kind in without a profile table produces a pirate that researches and earns 20 gold/s, nomads that ally, tribes that age more slowly, and an inflated world trade cap.

### P5. Ship-only factions are eliminated on their first tick — bug (latent), **high** for pirates, CONFIRMED by reading

**Where:** `Simulation.ts:5449–5456`.

**Mechanism:** survival is ground squads with troops > 0, or a completed city. Ships are explicitly excluded by the comment and the code. A pirate faction spawned with ships only is put in `defeated` on the first `checkWinner` after spawn. Its ships are then removed (`:5497`).

**Fix:** a `survives(player)` profile predicate: pirates survive while any ship has `health > 0`.

### P6. A captured trader cannot complete for an owner without a market — bug (latent), **medium**, CONFIRMED by reading

**Where:** `Trade.ts:445, 661–668, 1249–1259`.

**Mechanism:** a prize may only unload at its owner's ready market (`allowedMarket`). With none, it re-plans every 5 s as `no-receiver` forever. Waking happens only on a new owned port (`:420–424`). Prizes keep occupying the captor's tally and the global cap (`:1021–1034`).

**Consequence:** this affects any market-less owner: pirates, and nomads before the main yurt completes. Stolen cargo never becomes value, so a pirate gains nothing. Under PLAN.md nomads, it also means an opening-phase nomad that raids gets nothing until its yurt exists, which may be intended.

**Fix:** a profile flag `plunder: "prize" | "immediate"`. With `"immediate"`, credit `cargo × valuePerGood` to the captor's loot at the theft commit (`:1241`) and retire the actor instead of re-owning it.

### P7. Pop-up spawn cannot reuse the naval planner without rewriting it; it is port-centric and budget-starved — design, **high** (for pirates), CONFIRMED

**Where:**
- `AiNavalPlanner.ts:127–167` (`chooseTheater` starts from owned ports and returns no sea when there are none, `:155`);
- `:186–192` (`enabled` is economy or tribe only);
- `:265–330` (one faction per call, mission deadline 120 s at `:306`, abort and 20 s idle);
- `AiEconomicDirector.ts:214` (`naval.step(16)`);
- `04b` I1/I2 (assessments take 40–170 s at 45 factions).

**Mechanism:**
- **Funding** is `recruit-ship` at a port.
- **Recovery** returns ships to the gathering port.
- **Theater scoring** starts from owned coastal buildings.

A portless faction never gets a mission. Even if forced in, it would share 16 units per tick with all nations and tribes and get a turn about every 50+ ticks at 52 factions.

**Decision:** a new `AiPiratePlanner` (spec in R-B).

### P8. Candidate scans and sleep keys scale with *lifetime* players, not live ones — perf/design, **medium**, CONFIRMED (code), magnitude DERIVED

**Where:** `AiOperations.ts:309` (`ageKey` over all players including eliminated, every tick) and `:405–410` (`world.players[r.cursor++]; this.work++` before the eliminated check).

**Mechanism:** a full candidate scan reads every player id. At 4 per think-slice and a global 16 per tick:
- 52 players = 13 slices per scan;
- with 100 lifetime ids (52 + 48 pop-up ids, roughly 12 nomad waves) = 25 slices;
- about half the global read budget is then spent on dead ids.

The 08 ledger refuted only the **correctness** variant ("indexing by cursor is safe while append-only"). This is the cost variant, and it is new with pop-ups. `ageKey` also embeds every player's force count, so any pop-up's squad change invalidates every AI's 10 s sleep (04 I6, now amplified).

**Consequence:** nation war-target selection slows linearly with match age, and sleep keys churn.

**Fix:**
- iterate a `liveRivalIds` list maintained by the roster lifecycle;
- store the cursor as an id;
- drop pop-ups and eliminated players from `ageKey`.

### P9. Elimination releases almost nothing; with lifetime ids the leftovers become unbounded per match — design, **medium**, CONFIRMED (code)

**Where:** `Simulation.ts:5446–5527` (no `release` calls); `08-latent-bugs.md` L1 (474–477: "not unbounded… no respawn").

**Mechanism:** L1's bound relied on "players are created only in `createPlayers`". With pop-ups that premise is false. Per dead id, these persist in every checkpoint and every O(players) loop:
- `progression.states[id]`
- `supply.inventories[id]`
- `Trade.capturedValue/lostValue`
- `PairRelations` rows
- naval planner `history`/`funding`
- `economy.demands/saving`
- `HomeTerritory` caches
- `playerAttacks` rows

**Consequence:** with recurring waves this is real growth. L1 must be upgraded from "bounded, cosmetic" to a pop-up prerequisite. The fix is a `factionEliminated` subscriber list (R4).

### P10. The player list is sent in full, including eliminated rows and private economy, on every publication — perf/design, **medium**, CONFIRMED + measured

**Where:** `SnapshotCodec.ts:390`.

**Measured (scratch `players.ts`, 52 factions after 40 ticks):**

| Player list | JSON | gzip in isolation |
|---|---|---|
| 52 players | 13 396 B | 1 686 B |
| 68 players | 17 797 B | 1 930 B |
| identity fields only (52) | 6 145 B | 971 B |
| dynamic fields only (52) | 5 862 B | 506 B |

**Consequence:**
- Bandwidth growth is modest. The real costs are worker→main structured clone and decode per publication, which grow linearly with lifetime ids.
- Every client receives every faction's `gold`, `reserves`, `reserveRemainder` and `base` (the AI's strategic target tile). That is an information leak independent of pop-ups.
- The client colour roster key (`FactionColors.ts:77–80`) changes on every append. `TerritoryLayer.setColors` then repaints all territory chunks (`TerritoryLayer.ts:80–88`), because the array length changed even though no existing colour changed.

### P11. Faction-name decks are per-kind and throw on exhaustion — bug (latent), **medium**, CONFIRMED by reading

**Where:** `FactionRoster.ts:19–26, 62–80`.

**Mechanism:** only `regular` and `tribe` decks exist. `take` throws "catalog is exhausted". A pop-up that takes from the tribe deck is safe for about 211 more names after 30 tribes. Its own deck sized below the lifetime cap would throw inside `step()`, which freezes the match.

**Fix:**
- per-kind deck with a seed salt of its own (`0x4e4f4d44` "NOMD", `0x50495254` "PIRT"); this keeps existing decks bit-identical;
- deterministic suffix fallback ("Second Horde of X") instead of throwing.

### P12. The Bronze Russian roster has no mounted archer — content gap, **medium**, CONFIRMED (dumped `UNITS`)

**Where:** `content/Units.ts` (dump).

**Mechanism:** BronzeAge offers `bronzeage-cavalry` (light, 245 gold / 16 reserves / 16 horses) but no ranged cavalry. `classicalage-rangedcavalry` is the first horse archer.

**Consequence:** PLAN.md's "two melee cavalry and two ranged cavalry" at a Bronze-tier spawn has no definition. PLAN.md §6 already calls for authored nomad units. Until they exist, the placeholder mapping in R-A must use `bronzeage-cavalry` ×2 + `bronzeage-archer` ×2 at Bronze tier.

### P13. Landless squads cannot replenish — design, **low** (nomads own land per PLAN.md), CONFIRMED

**Where:** `Simulation.ts:1509–1512` (order validation) and `:2516` (execution).

**Consequence:** irrelevant for PLAN.md nomads, which own territory. Pirates have no squads. A future landless contract band or rebels on enemy land would need a `replenishAt(player, tile)` profile predicate.

### P14. Round 1's AI cost claim had no basis; measured per-unit AI costs — perf, informational, **measured**

#### Probe

Probe: `scratchpad/popup/aicost.ts`.
- Same setup as 06: Migration 500×500, seed 1272661902, 8 human seats switched to AI, 14 AI, 30 tribes, Napoleonic start, production AI policies, raids-v1.
- I wrapped `AiOperations.step`, `AiOperations.enabled` (per-record boundaries, skipping the release loop) and `Skirmish.thinkAi` (per-AI-player body boundaries via the per-player `operations.enabled` call at `Simulation.ts:4961`).
- I also counted `Diplomacy.hostile` calls.
- Runs: 3 200 ticks at 30 tribes; 3 200 ticks at 20 tribes (control); 2 000+ ticks solo at 30 tribes. The solo run reproduced squad counts exactly (147/326/509/659/802), so it is deterministic.

**The machine was shared with other reviewers' runs** (7 heavy node processes). Absolute tick times were 2.1–2.8× the round-1 unloaded run at identical squad counts: tick 2400 measured 207 ms versus round 1's 82 ms with S≈990 in both. Shares and per-unit ratios were stable across loaded runs.

**Normalisation:** loaded ms ÷ 2.5 ≈ unloaded desktop; × 2.4 ≈ ARM. Loaded ms are therefore ≈ ARM-equivalent, and I quote them as such.

#### Results (30-tribe run, per tick averages over 400-tick windows)

| tick | squads (nation/tribe) | tick ms | AI phase ms (share) | `operations.step` ms | ops per nation record | ops per tribe record | thinkAi tribe body total | per tribe squad | `hostile()` calls/tick |
|---|---|---|---|---|---|---|---|---|---|
| 1600 | 78 / 659 | 165.7 | 16.7 (10.1 %) | 2.98 | 0.042 | 0.064 | 7.16 | 0.0109 | 11 484 |
| 2000 | 79 / 802 | 203.8 | 21.5 (10.5 %) | 3.61 | 0.049 | 0.080 | 9.50 | 0.0118 | 15 795 |
| 2400 | 80 / 911 | 207.3 | 26.1 (12.6 %) | 6.10 | 0.139* | 0.095 | 11.16 | 0.0122 | 19 178 |
| 3200 | 210 / 715 | 259.6 | 26.9 (10.4 %) | 4.26 | 0.071 | 0.100 | 11.27 | 0.0158 | 18 816 |

\* contains a 695 ms single-tick spike in `operations.step` (max column of the raw log), which is worth a separate look by the AI-perf owner.

The 20-tribe control at the same ticks gave the same per-unit figures: ops 0.10 ms per tribe record and 0.016–0.018 ms per tribe squad.

#### Per-unit costs (ARM-equivalent)

- AiOperations per AI record: **≈ 0.05–0.10 ms/tick**.
- `thinkAi` per AI squad: **≈ 0.011–0.016 ms/tick**.
- Nation bodies are cheap (0.07–0.13 ms per nation) because armies and missions take squads out of the per-squad loop.

#### Pop-up estimates

**AI only** (DERIVED from the per-unit costs above):

| Scenario | AI ms/tick (ARM-eq) | share of 52-faction AI phase (≈ 26 ms) |
|---|---|---|
| 6 pop-ups: 4 nomads at 10 squads + 2 pirates (new planner ≈ 0.05 ms each) | 4 × (0.08 + 10 × 0.013) + 2 × 0.05 ≈ **0.95 ms** | ≈ 3.6 % |
| 10 pop-ups: 6 nomads at 10 + 4 pirates | ≈ **1.5 ms** | ≈ 6 % |
| PLAN.md maximum, 20 living nomads at cap 10 | ≈ **4.2 ms** | ≈ 16 % |
| 20 nomads at 40 squads (3 credits each) | ≈ **12 ms** | ≈ 45 % |

**Whole tick:** the dominant cost is the pop-ups' **squads**. Using round 1's unloaded per-squad phase costs (movement 36 ms, combat 13 ms, capture 3.4 ms per ~1 000 squads on desktop; × 2.4 for ARM), the marginal cost is about **0.06–0.14 ms ARM per squad per tick**.

| Pop-up population | Added squads | Added ms/tick (ARM) |
|---|---|---|
| 6 pop-ups | ≈ 50 | +3–7 |
| 20 PLAN.md nomads at cap 10 | 200 | +12–28 |
| 20 nomads at 40 squads | 800 | +50–110 |

The last row breaks the 125 ms budget on its own.

**The round-1 "+10 % AI tick at 6 pop-ups" should read:**
- about +4 % of the AI phase (≈ 1 ms ARM);
- about +2–4 % of the whole tick at the 52-faction load, because squad count dominates.

**Hostility checks:** `Diplomacy.hostile` is already called 11–22 k times per tick at 52 factions. Every pop-up war or embargo row lengthens its linear scans (04 I5), which is why R3 of 04 (memoised hostility) is a prerequisite here.

### P15. No deterministic population guard exists for spawned units — design, **medium**

**Where:** none exists; PLAN.md §4.3 caps live **factions** (20) only.

**Consequence:** see P14. The tick cost scales with pop-up squads, and PLAN.md's 100-squad nomad cap times 20 nomads is a 2 000-squad ceiling. A deterministic guard must be in squad units (wall time is not allowed in the simulation).

---

## Recommendations

Ordered by dependency. Effort is for one developer who knows the codebase.

### R-0. Prerequisites (must land first) — about 6–8 days total

1. **Lifecycle bus (01 R4)** — `src/skirmish/MatchLifecycle.ts` (new). It owns these events:
   - `factionAdded(id, kind)`
   - `factionEliminated(id, recipient)`
   - `tileOwner(...)`
   - `entityOwner(...)`
   - `entityRemoved(...)`
   - `controller(...)`

   Subscribers own their release:
   - `economy.release`
   - `operations.release`
   - `naval.release`
   - `Trade` market caches
   - `PairRelations`
   - `HomeTerritory`
   - `playerAttacks.forget`
   - `commandApplications.release`
   - the AI `liveRivalIds` list

   This closes P9 and L1. Test: the randomized "checkpoint purity" property test from 01 R4, extended with `addFaction` and eliminations. 3–4 days.

2. **Roster seam with an atomic `addFaction` (01 R5.4)** — `src/skirmish/systems/Roster.ts`. Move `createPlayers`, `deployPlayer`, `promoteTribes` and the elimination part of `checkWinner` there unchanged, then add:

   ```ts
   addFaction(spec: {kind: FactionKind; base: number; ai: true; age: Age; identity: FactionIdentity; personalityId: AiPersonalityId;
     claimRadius: number; city: "none" | "completed"; squads: {definitionId: string; tile: number}[]; ships: {definitionId: string; tile: number}[];
     colorSlot: number}): number | string
   ```

   Contract:
   - **Phase 1, validate only, with no mutation:**
     - the id budget (`players.length + 1 ≤ MAX_PLAYER_ID`);
     - land or water walkability of every unit tile;
     - `canDeploy` for every squad;
     - the claim radius (all target tiles currently owner 0 and in the base's component);
     - name availability.

     On failure, return the reason string.
   - **Phase 2, commit:** `players.push`, `progression.add(id, age)`, `supply.add`, `controlGenerations.set(id, 0)`, `changeOwner` loop, `spawnSquad` with `consumeReserves=false`, `spawnShip` (new helper extracted from `Simulation.ts:2596–2614`, including `navalFacts.observeShip`), then `lifecycle.factionAdded`. Phase 2 must not throw.
   - Keep `players` append-only and never reuse ids, matching PLAN.md §14 and the 08 ledger.
   - `deployPlayer` keeps calling the same internals for the constructor.

   2 days.

3. **Raise and reconcile the id caps (P2).**
   - Set `MAX_PLAYER_ID = 254` and size `FactionAdjacency` as `Uint32Array(255²)`, which is 260 KB. Alternatively store edges sparsely as `Map<number,number>` keyed `a*255+b`; there are at most about 300 non-zero pairs.
   - Add `POPUP_LIFETIME_CAP = 254 − baseRoster`, enforced by `addFaction`.
   - Fix the cache key at `Simulation.ts:559` to use 255.
   - Reconcile `Protocol.ts:25` `MAX_FACTIONS` with 20 + 14.
   - Pre-size the client `COLORS` to 255 (P10 / R-E).

   0.5 day.
4. **Faction profile table (P4)** — `src/skirmish/FactionProfiles.ts`, specified in R-A. Route every site in the P4 table through `profileOf(player)`. 1.5 days, mechanical, with the `PopupKindAudit` test (T6).
5. **Memoised hostility (04 R3)** and **live-rival iteration (P8)**. 1 day.
6. **Checkpoint version 12 with a tolerant reader for 11** (R-D). 0.5 day.
7. **Trade plunder mode (P6)** and a predicate parameter on `raidTargets` (`Trade.ts:197`). 0.5 day.

### R-A. Profiles and unit sourcing

`FactionKind = "regular" | "tribe" | "nomad" | "pirate"` in `FactionRoster.ts:5` and `Protocol.ts:310`. Optionally add `"rebel"` later (R-C).

```ts
export interface FactionProfile {
  kind: FactionKind;
  survives: "squads-or-city" | "squads-or-city-or-ships";  // checkWinner
  victoryBlocking: boolean;            // checkWinner survivors / coalition
  canAlly: boolean;                    // Diplomacy.action gate, EmpireView buttons
  acceptsPeace: boolean;
  pacts: { tribute: boolean; hire: boolean };
  capturesLand: boolean;               // Simulation.capture early-out per owner
  plunder: "prize" | "immediate";      // Trade theft commit
  alwaysHostile: boolean;              // Diplomacy.hostile/canSteal "outlaw" term
  progression: "full" | "tribe" | "nomad-tree" | "frozen";
  passiveIncome: "nation" | "tribe" | "nomad" | "none";
  tradeActors: number | ((age: Age) => number);
  squadCap: (player: Player, age: Age, credits: number) => number;
  warshipCap: number; transportCap: number;
  advancesWith: "self" | "world";
  countsForTribeAdvance: boolean;      // TribeDevelopment survivors
  candidateForInvasion: boolean;       // AiOperations candidate scan
  promotes: boolean;
}
```

| Field | regular | tribe | nomad (PLAN.md) | pirate (proposal) |
|---|---|---|---|---|
| survives | squads-or-city | squads-or-city | squads-or-city (yurt is a city, §13) | squads-or-city-or-ships |
| victoryBlocking | yes | yes | **yes** (PLAN.md §13) | **no** (proposal; open question Q2) |
| canAlly | yes | no | **no** (PLAN.md §12) | no |
| pacts | — | — | none (PLAN.md has none) | tribute + hire |
| capturesLand | yes | yes | yes (unclaimed expansion; war captures) | no |
| plunder | prize | prize | prize (PLAN.md §Phase C "normal prize handling"; receivers = yurt/cities) | immediate |
| alwaysHostile | no | no | no (embargo raids, §9) | **yes** (outlaw) |
| progression | full | tribe | nomad-tree (ends LateMedieval, §6) | frozen at spawn tier |
| passiveIncome | nation | tribe | nomad (yurt bonus, §5.3) | none |
| tradeActors | 48 | 16+2·age | 8 (proposal: land couriers from yurts) | 0 |
| squadCap | age caps | 10+5·age | `min(100, 10+10·credits)` (§7) | 0 |
| warshipCap | 32 (AI) | 24 | 0 (§6) | 6 (Classical–EarlyMedieval), 8 (LateMedieval–Napoleonic) |
| countsForTribeAdvance | yes | no | no | no |
| candidateForInvasion | yes | yes | yes (invading nomads is the retaliation trigger) | no |
| promotes | — | yes | **no** (§3) | no |

#### Nomad unit sourcing (PLAN.md §5–§7, ordinary economy)

**Spawn package** (granted with `spawnSquad(..., consumeReserves=false)`): 2 melee + 2 ranged cavalry at the group's tier. Until PLAN.md §6's authored nomad units exist, use this placeholder mapping onto the Russian roster (P12):

| Nomad tier | melee ×2 | ranged ×2 |
|---|---|---|
| Bronze | `bronzeage-cavalry` | `bronzeage-archer` (no Bronze horse archer exists) |
| Classical | `classicalage-cavalry` | `classicalage-rangedcavalry` |
| EarlyMedieval | `earlymedieval-cavalry` | `earlymedieval-rangedcavalry` |
| LateMedieval | `latemedieval-cavalry` | `latemedieval-rangedcavalry` |

Proposal for the tier of recurring spawns (PLAN.md §4.5 leaves it open): `min(LateMedieval, worldAge − 1)`. Here `worldAge` is the median age of live regular factions; the floor is Bronze.

**Recruitment:**
- **Path:** the ordinary `recruit` command at a warriors' yurt, a new `BuildingType "warriors-yurt"`. It reuses `recruitment.enqueue`, `stepRecruitment` and `refundRecruitment`, with no new lifecycle.
- **Building limits:** PLAN.md §5.2. Put them in a `nomadBuildingLimit` sibling of `tribeBuildingLimit` (`TribeDevelopment.ts:40`), enforced at the same validator site (`Simulation.ts:1280–1285`).

**Manpower** (PLAN.md §5.6 leaves the numbers open). Proposed:
- reserve income = `baseReserveIncome(age)` (`Economy.ts:58`) plus `1.5 × cityReserveIncome` for the main yurt only;
- replenishment uses the ordinary `replenish` path, since nomads own land;
- do not reuse the flat tribe 40, which 05 #10 shows is wrong across ages.

**Capacity credits** (PLAN.md §7): record `{victim, tick}` in the nomad faction state when `checkWinner`'s `ConquestCredit.beneficiary` (`Conquest.ts:84`) returns this nomad. Do it once per terminal defeat, after the whole batch is marked (`Simulation.ts:5456`), so simultaneous defeats cannot credit a dead faction (PLAN.md §13).

**Population guard (P15), proposal:**
- spawn a group only if live pop-up squads + 4 × group size ≤ `POPUP_SQUAD_BUDGET = 200`;
- and only if world squads ≤ 1 400 (about the 8 Hz ARM reference load plus 30 %).

Both counts are deterministic. 200 squads costs about +12–28 ms ARM (P14).

#### Pirate unit sourcing (no economy)

- **Kind:** `"pirate"`.
- **Opening latch:** the first regular faction reaches ClassicalAge.
- **Closing latch:** the same as nomads (third Early Modern achiever). Existing pirates persist.
- **Concurrent cap:** `min(4, ⌈seaTraders/40⌉)`, where `seaTraders` is the live naval trade actors in the candidate sea.
- **Lifetime cap:** shared `POPUP_LIFETIME_CAP`.

**Spawn package** (granted through `Roster.addFaction` → new `spawnShip(player, definitionId, waterTile)`): 3 warships of tier `max(BronzeAge, worldAge − 1)`, using `${tier}-warship` from `VESSELS`. There are no transports and no squads.

| World age | Ships | Hull each | Gold value each |
|---|---|---|---|
| Classical | 3 × `bronzeage-warship` | 1 300 | 1 400 |
| EarlyMedieval | 3 × `classicalage-warship` | 1 690 | 2 100 |
| LateMedieval | 3 × `earlymedieval-warship` | 2 197 | 2 800 |
| Napoleonic | 3 × `latemedieval-warship` | 2 856 | 3 500 |

Pirates' `progression` is frozen with `completed = []`, so `vesselEffects` gives authored base stats with no research bonuses.

**Reinforcement** (all deterministic, no passive income):
- **Plunder** (P6 immediate mode): `loot += cargo × valuePerGood` at theft.
- **Tribute** (R-D): `loot += gold`.
- **Ships:** when `loot ≥ 0.75 × vessel gold` and ships < cap and `tick ≥ nextReinforcement`:
  - spawn one ship at the pirate's haven (the spawn water tile, re-anchored to the flagship's tile every 60 s);
  - `loot −=` cost;
  - `nextReinforcement = tick + secondsToTicks(60)`.
- **Repair** (proposal): a ship that has not fought for 30 s regains 0.5 % hull per second up to 60 % ("careening"). Implement in the pirate planner as a hull update through `updateShip`, not a new combat rule.
- **Despawn:**
  - no ships: eliminated by `checkWinner` with the profile survival rule;
  - or no plunder or tribute for 6 min after a 3 min grace: the planner issues `delete-ship` for all its ships, a new AI-allowed internal removal, not the human `delete-ship` command, which rejects AI (`Simulation.ts:1263`). Then `checkWinner` eliminates it. Announce `popup/disband`.

**Caps:** warships 6 or 8 (above), traders 0, squads 0.

#### Paths to reuse (and not)

| Need | Reuse | Do not use |
|---|---|---|
| Grant units | `spawnSquad(..., false)` (`Simulation.ts:2354`), new `spawnShip` extracted from `recruitShip` completion (`:2596–2614`) | `recruit` / `recruit-ship` for pirates (needs building, port, cost) |
| Nomad recruitment | `recruit` command + `recruitment.enqueue` + new yurt building types | `Expansion.recruitment` tribe chooser (tribe-specific line logic) |
| Theft | `Trade` captor loop (`:1229`) with the profile `plunder` mode | prize delivery for pirates |
| Hostility | raids-v1 `establishWar` / `beginAiRaid` / `neutralPeace` / `peaceProtection` | new parallel permission tables |
| Movement | `sail` / `order` commands through `applyCommand` | direct position writes |

### R-B. Planner decision: a new `AiPiratePlanner`, not an `AiNavalPlanner` objective

**Why not the naval planner (P7):**
- Every phase of `AiNavalPlanner` assumes an owned gathering port: theater discovery (`:127–167`), funding (`recruit-ship`), recovery (dock), and port loss → re-anchor or abort (`:322–330`).
- It shares a fixed 16-unit allowance with every nation and tribe, one faction per tick (`AiEconomicDirector.ts:214`). At 52+ factions a pirate would act about every 6 s with assessments spanning minutes (04b I1).
- The 120 s abort (`:306, :317–320`) would reset the pirate's hunt cycle.
- Adding a portless objective would touch `chooseTheater`, `fund`, `recover`, `applyAssessment` and `release`. That is roughly as much code as a new planner, and it risks regressing nation fleets.

**`src/skirmish/domain/AiPiratePlanner.ts` (new, about 250 lines):**
- Stepped from `Expansion.beforeStep` right after `economy.step()` (`Expansion.ts:1198`), only when at least one live pirate exists.
- One pirate per tick, round-robin over a `pirateIds` list maintained by the lifecycle bus. It is not indexed into `world.players` (P8).
- State per pirate: `{playerId, generation, phase: "hunt"|"chase"|"flee"|"careen"|"escort", targetActor?: number, targetOwner?: number, nextThink: tick, haven: tile, contract?: id}`. Ids only; actors and ships are re-resolved every turn.

**Per-turn read budget (hard caps):**
- `Trade.raidTargets(x, y, 48*FIXED, owner, result, predicate)` once: ≤ 256 grid reads, ≤ 32 results. The predicate is `canSteal(pirate, owner)` (outlaw ∧ ¬protected ∧ ¬allied), or the contract target only while hired.
- `AiNavalFacts.nearbyShips(sea, flagship, 16*FIXED)` for threats: ≤ 9 sector cells, ≤ 32 ships read.
- ≤ 8 own-ship reads; ≤ 2 commands (`sail` / `naval-attack` / `stop-ships`).
- At most about 300 primitive reads per tick. Measured cost class: < 0.05 ms per tick ARM-equivalent, by the same per-read costs as `raidTargets` in the naval planner.

**Decision rules:**
- **hunt:** pick the victim with max `cargo × valuePerGood / (1 + dist/16)`, excluding owners that are `protected` or `dontEmbargo`-irrelevant. Sail the whole fleet in one group to the victim tile.
- **flee:** when local enemy power (`navalPower`) ≥ 1.5 × own ready power, sail away from the threat centroid to the farthest water tile of 3 candidates around the haven.
- **careen:** below 35 % hull average, return to the haven and hold.
- **escort** while hired: attack only the contract target's traders and ships.
- **Re-think cadence:** `nextThink = tick + max(4, pirates)` ticks.

**Files touched:**
- `AiPiratePlanner.ts` (new)
- `Expansion.ts` (construct, step, checkpoint)
- `Trade.ts` (`raidTargets` predicate overload, immediate plunder)
- `Diplomacy.ts` (outlaw term)
- `Simulation.ts` (`spawnShip`, `checkWinner` profile survival)
- `AiNavalFacts.ts` (no change; read-only use)

**Nomads:** follow PLAN.md §14: "Do not place the full feature in another expanding branch of `Simulation.thinkAi`". Add `src/skirmish/domain/NomadCampaign.ts`, which owns:
- group membership;
- the Khan latch;
- retaliation evidence, read from `diplomacy.state.wars` rows with `cause === "entry"` and `initiator !== nomad` while the nomad owns the tile;
- permanent-campaign activation, on credit of that aggressor's defeat;
- the current objective.

`AiOperations` gets a nomad branch that reads `NomadCampaign` for its target. It uses the record's existing `threats`, `retries` and `nextThink` and the shared 16-read budget, but it iterates **adjacent** factions only (`FactionAdjacency.adjacent` over `liveRivalIds`) instead of the full player list. Trade raids by nomads call `diplomacy.beginAiRaid` (its first production caller, fixing 04 I11). Targets come from a land-courier analogue of `raidTargets` (new lazily rebuilt land-actor grid in `Trade.ts`, same bounded sampler).

### R-C. Other pop-up kinds, evaluated against RoN-style needs

| Kind | Need it serves | Verdict | Spawn / despawn rules (if built) | Risk |
|---|---|---|---|---|
| **Nomads** (PLAN.md) | fill empty land mid-game, trade threat, conquest escalation | **Build first** | PLAN.md §4 latches; groups of 3–5; ≤ 20 living, plus the squad budget guard (R-A); despawn only by defeat | medium (economy content) |
| **Pirates** | sea-trade counterplay, naval purpose for nations without wars, gold sink (tribute) | **Build second** | Classical latch → 3rd Early Modern closure; spawn on water 24–40 tiles from any port and within 16 tiles of a sampled loaded sea trader, in a sea with ≥ 8 loaded traders from ≥ 2 owners; ≤ `min(4, ⌈seaTraders/40⌉)` live; attempts every 180 ± 60 s (dedicated PRNG); despawn on no ships or 6 min idle | low (no land, no buildings) |
| **Mercenaries for hire** | gold sink for rich traders, temporary force projection | **Build as a contract mode of pirates (`hire`)**, not a kind; optionally extend to Khanates only if the owner revises PLAN.md §12 | contract 120/180/300 s; one contract per pop-up | low |
| **Barbarian waves** (scripted invasion at age-ups) | anti-snowball pressure on the leader | **Do not build as a kind.** Optional spawn **trigger** for nomad groups (e.g. a group biased toward the region adjacent to the age leader when it first advances) once nomads exist | — | low |
| **Rebels** in over-extended territory | late-game anti-snowball when nomads and pirates have closed (Early Modern+) | **Defer** until R-0 #1/#2 and the checkpoint-purity property test are green. It is the riskiest kind: it changes tile ownership away from a live faction mid-war | Proposal: a faction with land > 400 × completed cities and ≥ 25 % of its land farther than 40 tiles from any own city or depot (sampled, 64 owned tiles per think) for 3 min spawns 4–6 squads of its `age − 1` frontline infantry on a remote owned tile; `kind "rebel"`, war with the owner only (`cause: "rebellion"`, new), captures land; holding ≥ 60 tiles for 3 min promotes it in place to `kind "tribe"` (the `promoteTribes` mechanism); despawn when squads = 0 | high (ownership churn, the 2026-10-15 freeze class) |

There is no supply or attrition concept in the code today (`grep unsupplied|attrition` finds none). "Over-extension" therefore needs the sampled distance metric above, not a supply system.

### R-D. Wire and checkpoint schemas

#### Commands

Add these to `Protocol.ts` `Command` and `multiplayer/CommandSchema.ts`. They use three distinct `type`s so the existing top-level `z.discriminatedUnion("type", …)` stays valid.

```ts
// CommandSchema.ts (zod 4, same helpers as the file)
const gold = z.number().int().min(50).max(1_000_000);
command("tribute-offer", { otherId: id, gold }),                                   // payer -> pop-up
command("tribute-answer", { offerId: id, accept: z.boolean() }),                  // recipient of a pending row
command("hire", { otherId: id, targetId: id, gold,
  seconds: z.union([z.literal(120), z.literal(180), z.literal(300)]) }),
```

```ts
// Protocol.ts Command union
| { type: "tribute-offer"; playerId: number; otherId: number; gold: number }
| { type: "tribute-answer"; playerId: number; offerId: number; accept: boolean }
| { type: "hire"; playerId: number; otherId: number; targetId: number; gold: number; seconds: 120 | 180 | 300 }
```

**Domain validation** in a new `Diplomacy.pact(...)`, reached from the `Expansion.command` dispatcher. The rules are in order, and each rejection returns a string:

1. **Ownership.** `playerId` is already overwritten from the seat (`LiveMatch.ts:567–570`). The domain additionally requires `player` to be live, and `!profileOf(player).pacts.*`. Payers are regular or tribe factions, never pop-ups.
2. **`tribute-offer`:**
   - `other` is live with `profileOf(other).pacts.tribute`;
   - `other.id !== player.id`;
   - `availableGold(player) ≥ gold`;
   - `gold ≥ quote(other)`, where `quote = 300 × ships × (ageIndex+1)` for pirates;
   - no pending row for (payer, pop-up);
   - payer has < 3 pending rows;
   - the per-pair cooldown has elapsed (30 s after reject or expiry).

   **Effect:** escrow (`spendGold`) and push `{id, proposer: payer, recipient: popup, payer, popup, gold, expiresTick: tick+20 s}`.
3. **`tribute-answer`:** the row exists, `row.recipient === player.id`, and the row is unexpired.
   - **accept:** `loot[popup] += gold`; set protection (payer, popup) `untilTick = max(existing, tick + 180 s)` through the existing `peaceProtection` rows (unique per pair, so extend the existing row), then `permissionsChanged`.
   - **reject:** refund the escrow and set the cooldown.
   - Pop-up AI answers its own rows on its next planner turn: accept iff `gold ≥ quote`.
4. **`hire`:**
   - `other` has `pacts.hire`;
   - `target` is live and is neither payer nor pop-up;
   - `diplomacy.hostile(player, target) || declaredWar(player, target)` (no hiring against neutral friends);
   - pop-up has no active contract;
   - payer has < 2 active contracts;
   - `gold ≥ 2 × quote`.

   **Effect:** spend gold immediately; `loot += gold`; push the contract `{id, popup, employer, target, gold, untilTick}`; set protection (employer, popup) for the duration. The pop-up's planner restricts its targets to `target`.
5. **Expiry and cleanup** in `Diplomacy.step` (`:287`): drop expired offers with refund; drop contracts on expiry; drop rows whose payer, pop-up or target is no longer live (refund escrow to a live payer). Announce `popup/contract-end`.
6. **Rate limits.**
   - **Domain:** the cooldowns above, plus at most 1 pact command per payer per 2 s (`pactNext[payer]`).
   - **Transport:** existing 50 messages/s/session (`CoordinatorServer.ts:305`) and `MAX_QUEUED_COMMANDS`.
   - Recommended: a per-seat class budget in `LiveMatch.submit` (diplomacy-class commands ≤ 2/s), so a client cannot burn the shared queue with rejected pacts.

**Events:** add `MatchEvent.kind "popup"` with `action: "spawn" | "khan" | "disband" | "tribute" | "hired" | "contract-end"` (`Definitions.ts:479–500`). The HUD text goes in `EmpireHudView.ts:490–500`. Example lines:
- "The leader of {name} has been declared Khan." (PLAN.md §Phase B, verbatim)
- "{name} pirates appeared near {region}"
- "{payer} paid tribute to {name}"
- "{payer} hired {name} against {target}"

The skirmish HUD currently formats English inline. If skirmish strings move to `translateText`, add matching `en.json` keys only (CLAUDE.md).

#### Checkpoint

`Skirmish.checkpoint` goes from version 11 to **12** (`Simulation.ts:242`). `restore`/`installCheckpoint` (`:251`, `:295`) accept 11 or 12. A version-11 checkpoint restores with an empty pop-up state, and the latches are recomputed from `progression.states` (PLAN.md §4.5 recommendation).

The new section lives in `Expansion.checkpoint()` as `popups`. Following the domain's convention (zod is only used in `multiplayer/`), implement validation as a hand validator `domain/PopupValidation.ts` mirroring this schema. The Zod form below is the normative shape; the same file can be used in tests.

```ts
const pid = z.number().int().min(1).max(254);
const tick = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const tile = z.number().int().min(0);
export const PopupCheckpointV1 = z.object({
  version: z.literal(1),
  random: z.number().int(),                                   // PseudoRandom.getState() of the dedicated stream
  latches: z.object({
    nomadOpened: z.object({ tick, by: pid }).nullable(),
    pirateOpened: z.object({ tick, by: pid }).nullable(),
    closed: z.object({ tick }).nullable(),
    earlyModernAchievers: z.array(pid).max(3),                 // distinct, ascending, historical (PLAN §4.2)
  }).strict(),
  nextAttempt: z.object({ nomad: tick, pirate: tick }).strict(),
  search: z.object({ kind: z.enum(["nomad", "pirate"]), cursor: z.number().int().min(0),
    best: tile.nullable(), bestScore: z.number().int(), startedTick: tick }).strict().nullable(),
  lifetime: z.object({ nomad: z.number().int().min(0).max(254), pirate: z.number().int().min(0).max(254) }).strict(),
  nextGroupId: z.number().int().min(1), nextPactId: z.number().int().min(1),
  groups: z.array(z.object({ id: z.number().int().min(1), members: z.array(pid).min(3).max(5),
    createdTick: tick, khan: pid.nullable(), khanAnnounced: z.boolean() }).strict()).max(254),
  factions: z.array(z.object({
    playerId: pid, kind: z.enum(["nomad", "pirate"]), groupId: z.number().int().min(1).nullable(),
    spawnedTick: tick, tier: z.enum(["BronzeAge","ClassicalAge","EarlyMedieval","LateMedieval","Napoleonic"]),
    phase: z.enum(["rivals", "khanate", "retaliation", "campaign", "hunt", "chase", "flee", "careen", "escort", "disbanding"]),
    campaign: z.object({ activatedTick: tick, aggressor: pid }).strict().nullable(),   // permanent once set (PLAN §Phase E)
    retaliation: z.array(z.object({ aggressor: pid, since: tick }).strict()).max(8),
    credits: z.array(z.object({ victim: pid, tick }).strict()).max(9),                 // cap 100 = 10 + 10*9
    loot: z.number().int().min(0).max(1_000_000_000),
    lastIncomeTick: tick, nextReinforcementTick: tick, haven: tile.nullable(),
  }).strict()).max(254),
  pacts: z.array(z.object({ id: z.number().int().min(1), proposer: pid, recipient: pid, payer: pid, popup: pid,
    gold: z.number().int().min(50).max(1_000_000), expiresTick: tick }).strict()).max(256),
  contracts: z.array(z.object({ id: z.number().int().min(1), popup: pid, employer: pid, target: pid,
    gold: z.number().int().min(50).max(1_000_000), untilTick: tick }).strict()).max(64),
  pactNext: z.array(z.tuple([pid, tick])).max(254),
  pirate: z.array(z.object({ playerId: pid, generation: z.number().int().min(0), targetActor: z.number().int().min(0).nullable(),
    targetOwner: pid.nullable(), nextThink: tick }).strict()).max(254),
}).strict();
```

**Cross-record rules** (validator, run against the saved players):
- every `pid` is in `saved.players`;
- `factions[].kind` equals that player's `kind`;
- group members are unique, belong to exactly one group and are nomads;
- `khan ∈ members` and `khanAnnounced ⇒ khan !== null`;
- `credits[].victim` is unique per faction and ≠ the faction;
- `pacts`: at most one row per (payer, popup); `payer ∉ factions`; `popup ∈ factions`;
- `contracts`: `popup ≠ employer ≠ target`, at most one per popup;
- `lifetime.nomad + lifetime.pirate` = number of `saved.players` with a pop-up kind;
- `earlyModernAchievers` are sorted and distinct.

Escrowed gold is already deducted from the payer, so restore needs no reconciliation.

### R-E. Replication and HUD

1. **Player-list revisions (P10).** Replace `SnapshotPacket.players: Player[]` with three parts:
   - `rosterRevision: number` and `roster?: PlayerIdentity[]`. The roster carries `id, name, factionId, personalityId, kind, colorKind, colorSlot, ai, eliminated` and is sent only on reset or a revision change. The revision is bumped by `factionAdded`, `factionEliminated`, `controller` and promotion.
   - `standings: Int32Array`, one 8-int row per **live** player: `id, land, losses, kills, recruited, reservesBucket, goldBucket, flags`.
   - The local player's full record (exact `gold`/`reserves`/`reserveRemainder`).

   Buckets are coarse (e.g. `floor(log2(gold+1))`) for others, which also closes the information leak. Eliminated players drop out of `standings` after the publication that flips them.

   **Files:** `Protocol.ts`, `SnapshotCodec.ts:390` (encode) and `:622` (decode → client `Player[]` reconstruction), `client/main.ts` / `EmpireView` consumers.

   **Size estimate** for live players only, typed: 52 × 32 B = 1.7 KB raw per packet, constant in lifetime ids.

   **Tests:** codec round-trip; a late-join baseline includes the roster; an eliminated player stays resolvable by id from `roster`.
2. **Colour slots (07 I10).** Make pop-up colours **server-assigned** at `addFaction` (`Player.colorSlot`), so every client agrees and the choice can use world proximity.
   - Reserve palette indexes 20–35 for a dark "outlaw band" (8 nomad hues, 4 pirate hues, 4 spare).
   - The proposed hexes are measured against today's 52-faction palette with redmean distance:
     - nomad `#5a3a1a #3d2b55 #1f4a3a #6b1f2a`
     - pirate `#14161c #2a2a2a #0e2a3a #3a0e0e`
   - Today's 52-faction palette spans luminance 96–220, and its minimum pairwise distance is 15.3. The outlaw band has luminance 22–64, a distance of **≥ 170 to every existing colour**, and ≥ 49 within the band.
   - **Allocation:** for a new nomad group, pick distinct hues from the nomad band that maximise the minimum distance to colours of factions owning land within 96 tiles of the spawn region. Members of the same group must differ, since they fight each other. Pirates take the pirate hue least used among live pirates. Ties break by slot index.
   - Markers get a light outline and a kind glyph (bow or flag), so dark fills remain legible.
   - Lobby validation (`validFactionColor`, `FactionPalette.ts:25–31`) keeps humans on 0–19.
   - **Client:** pre-size `COLORS` and `RGB` to 255 entries. Make `assignFactionColors` incremental: only new ids are assigned, and existing entries never change. Make `TerritoryLayer.setColors` repaint only when an existing entry's colour changes, not when the array grows. That removes the full repaint per spawn (P10).
3. **HUD badge and diplomacy panel.**
   - `EmpireView.ts:769–776`: buttons by profile. Nomads get the peace popup only (PLAN.md §12). Pirates get "Pay tribute (quote)" and "Hire against…". The label becomes "Nomad horde · Khanate" or "Pirates".
   - `FactionViewModel.ts:27`: profile descriptions.
   - Roster rows (`main.ts:995`): a kind glyph.
4. **Announcements:** see R-D events. Throttle `popup/spawn` to one feed line per group, not per member.

### R-F. Test list and fixtures

**Fixtures:** `tests/skirmish/PopupFixtures.ts` (new):
- `stripWorld({width:300,height:120, seaRows:[60,100], humans:1, ai:2, tribes:2, startingAge})`, a deterministic `GameMapImpl` like `multiplayerReleaseProfile.ts:13–15`;
- `forceGroup(game, tile, size)` and `forcePirate(game, waterTile)`, which call `Roster.addFaction` through a test-only `PopupFactions.spawnForTest` (same path as production, bypassing only the cadence and latches);
- `seaTraffic(game, n)`, which seeds loaded naval traders between two owned ports (pattern of `TradeFleet.test.ts`).

All tests run with `npx vitest run --config vite.skirmish.config.ts`.

| # | Test file | Asserts |
|---|---|---|
| T1 | `PopupRosterAtomic.test.ts` | `addFaction` with a blocked tile returns a reason and leaves `players.length`, `owners`, `nextId`, progression/supply registries and `checkpoint()` byte-identical; success registers progression at the requested age, supply, `controlGenerations`, adjacency (id > 64 borders counted) |
| T2 | `PopupIdBudget.test.ts` | ids are `players.length+1`, never reused after elimination; budget exhaustion refuses spawn with no throw; restore with 200 players succeeds |
| T3 | `PopupCheckpoint.test.ts` | spawn group → checkpoint at t → restore → step 400 ticks equals uninterrupted run (state hash); Khan announced exactly once across restore; v11 checkpoint restores with empty popup section and recomputed latches |
| T4 | `NomadLatches.test.ts` | Bronze tech eligibility opens without gold; third Early Modern closes; eliminating an achiever does not reopen; Classical start spawns the immediate groups; no spawn when `winner !== null` |
| T5 | `NomadPlacement.test.ts` | insufficient region → skipped attempt, no partial group; never overwrites owned tiles; groups always 3–5; squad budget guard refuses |
| T6 | `PopupKindAudit.test.ts` | one assertion per P4 table row (squadCap, shipCap, trade actor cap and global cap, passive income 0 for pirates, `thinkProgression` takes no research action for pirates, `tribeAdvanceRejection` ignores pop-ups, alliance offer to a nomad rejected, `EmpireView` buttons) |
| T7 | `PirateSurvival.test.ts` | ship-only pirate survives while a ship lives; eliminated on last sink; no `conquest` event; ships not transferred |
| T8 | `PiratePlunder.test.ts` | capture credits loot immediately and retires the actor (no prize); victim warships may engage pirates (outlaw hostility mutual); protection (tribute) blocks theft and combat; `dontEmbargo` does not shield from outlaws (decide; see Q4) |
| T9 | `PirateReinforcement.test.ts` | loot ≥ 0.75 × cost spawns one ship per 60 s up to cap; idle 6 min → disband; no passive gold |
| T10 | `TributeDiplomacy.test.ts` | escrow on offer; accept → 180 s protection and loot; reject/expiry/elimination refund; per-pair cooldown; 3-pending cap; `tribute-answer` by non-recipient rejected; `playerId` spoofing impossible (submit through `LiveMatch.submit`) |
| T11 | `HireContract.test.ts` | hire requires hostility with target; employer protected; planner targets only `target` traders; contract end announced; target elimination ends contract |
| T12 | `CommandSchema.test.ts` (extend) | strict objects reject extra keys; `gold` bounds; `seconds` literal union; ids bounds |
| T13 | `AiOperationsLiveRoster.test.ts` | with 40 eliminated ids appended, a nation's full candidate scan uses only live reads (`workUsed` ≤ live count) and `ageKey` excludes pop-ups |
| T14 | `NomadCampaign.test.ts` | PLAN.md §17 unification/campaign rows (Khan with outsider kills, credits +10 up to 100, retaliation only on entry war, campaign permanent through peace) |
| T15 | `PopupVictory.test.ts` | nomads block solo victory; pirates do not (if Q2 accepted); allied mode per decision |
| T16 | `FactionColorsPopup.test.ts` | band distances (≥ 150 redmean to slots 0–64, ≥ 45 within band); appending an id does not change existing `COLORS`; `TerritoryLayer.setColors` does not invalidate on growth |
| T17 | `popupProfile.ts` (benchmark, not in the suite) | Migration 500, 52 factions + 6 / 10 / 20 pop-ups: AI phase and tick mean/p99 deltas, `hostile()` calls/tick, live squads; acceptance: 6 pop-ups ≤ +5 % tick on desktop |

### R-G. Prerequisite mapping (from 01, 04 and the 08 ledger)

| Prerequisite | Source | Why pop-ups need it |
|---|---|---|
| Lifecycle bus + entity generations | 01 R4 | elimination churn (P9), roster-change subscribers (AI live lists, client roster revision), stale-reference class |
| Roster seam + atomic `addFaction` | 01 R5.4 | P3; single home for spawn/promotion/elimination |
| Elimination releases AI/economy state | 08 L1 (upgrade from "bounded") | lifetime ids make it unbounded (P9) |
| Append-only players, ids never reused, cursors by id | 08 refuted-table row for `AiOperations.ts:407` (correctness holds) + P8 (cost) | PLAN.md §14 forbids naive recycling |
| `MAX_PLAYER_ID` / adjacency / colour sizing | 01 I9 + P2 | ids > 64 |
| Memoised hostility | 04 R3 | outlaw term and more war/embargo rows on a path called 11–22 k times per tick |
| Sleep-key and stagger fixes | 04 R4 / I6 | `ageKey` churn from pop-up force changes |
| `beginAiRaid` wiring | 04 R7 / I11 | nomad trade raids (PLAN.md §11) |
| Tribe reserve income by age | 05 #10 | do not copy the flat 40 into nomad income |
| Checkpoint version bump | — | new section; strict `version !== 11` today (`Simulation.ts:251, 295`) |

---

## Open questions

1. **Authority.** Is PLAN.md (2026-10-07) still the agreed nomad design? If yes, round-1 04's nomad design (and `00-summary.md` 173–193) should be marked superseded.
2. **Victory.** Should **pirates** block victory? PLAN.md makes nomads block it. Pirates that respawn until the closing latch could keep a won match alive for minutes. My proposal: pirates never block victory, and a won match stops all spawning (PLAN.md §4.6).
3. **Live cap.** Is PLAN.md's 20-living-nomads cap meant to hold on the ARM host at 52 factions? At cap 10 per nomad it costs about +12–28 ms per tick. At the 100 cap it is unbounded (P14/P15). Should a deterministic squad budget be added to the agreed rules?
4. **Shielding from outlaws.** Should "Don't embargo" or neutral status shield a faction from **outlaw** pirates, or only tribute? (PLAN.md §10 pending items concern player theft, not pirates.)
5. **Mercenaries.** Should hiring extend to Khanates? PLAN.md §12 says nomads never accept alliances; a hire contract is not an alliance, but the plan does not discuss it.
6. **Rebels.** Are rebels wanted at all? They are the only kind that takes land from a live faction mid-war, which is the highest-risk kind for the stale-reference freeze class. They should wait for R4 plus the purity property test.
7. **Information leak.** Can every client stop receiving other factions' exact `gold`/`reserves`/`base` (P10)? That decides whether `standings` uses buckets.
