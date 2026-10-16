# 13 — Gameplay design review against Rise of Nations (8 humans + 14 nations + 30 tribes + pop-ups)

Round 2, read-only. Tree reviewed as of 2026-10-16 (working tree on `1.5.7-10hz-prototype`, 8 Hz). Every line number below was re-checked with `grep -n`/`sed -n` on the current tree. **CONFIRMED** = traced end to end in code or measured with the probe below; **SUSPECT** = mechanism read, magnitude not measured. Rise of Nations (RoN) references are design analogues from general knowledge of the game, not code facts; exact RoN numbers are marked "approx.".

## Scope read

| File | Lines |
|---|---|
| `review-notes/00-summary.md` | all (gameplay-relevant parts) |
| `review-notes/03-combat.md` | 412-517 (I16, recommendations, gameplay proposals) |
| `review-notes/05-balance-economy.md` | 45-175 (model and pacing table), 192-419 (issues 1-16, recommendations) |
| `review-notes/07-client.md` | 155-188 (I18, 8-human HUD) |
| `review-notes/04-ai.md` | 130-211 (I13-I14, recommendations, design) |
| `review-notes/02-network.md` | 137-138 (N19), 203 (rec 10) |
| `review-notes/08-latent-bugs.md` | refuted table 1697-1726, grep for checkWinner/tribe |
| `src/skirmish/lobby/LobbyRules.ts`, `LobbyDirectory.ts` | all |
| `src/skirmish/FactionRules.ts` | all (1-102) |
| `src/skirmish/Simulation.ts` | 227-240 (`setAiController`), 1095-1140 (camp and starting squads), 3600-3615 (entry war), 3678-3700 (`produceReserves`, land income), 5436-5530 (`promoteTribes`, `checkWinner`) |
| `src/skirmish/domain/Expansion.ts` | 195-240 (victoryMode, constructor), 435 (alliances lobby flag), 1505-1560 (AI alliance logic), 1929-1941 (`coalition`) |
| `src/skirmish/content/Factions.ts` | 1-300, 1003; `domain/FactionRoster.ts` 1-80 |
| `src/skirmish/content/Catalog.ts` | 30-100 (`DEFAULT_CULTURE`) |
| `src/skirmish/content/Technology.ts` | all; `content/technologies.json` (summarised by script) |
| `src/skirmish/domain/Progression.ts` | all |
| `src/skirmish/domain/Diplomacy.ts` | 1-200 (raids-v1 rules) |
| `src/skirmish/domain/AiPersonality.ts` | all; `content/AiPersonalities.ts` 1-279; `content/AiDoctrines.ts` 1-60; `content/AiPolicies.ts` all |
| `src/skirmish/domain/AiOperations.ts` | 370-440 (candidate scan, tribe and nation war gates) |
| `src/skirmish/domain/TribeDevelopment.ts` | 1-45 |
| `src/skirmish/content/StartingEconomy.ts` | all; `StartingPositions.ts` all; `domain/SpawnSelection.ts` 60-147 |
| `src/skirmish/SnapshotCodec.ts` | 115-175 (`selectEntities`, `selectMetadata`), 390 (players) |
| `src/skirmish/Protocol.ts` | 300-322 (`Player`), 435-482 (`SkirmishOptions`) |
| `src/skirmish/multiplayer/application/LiveMatch.ts` | 140-200 (options), 255-290 (`assertAvailable`), 385-420, 570-660 (disconnect / empty grace / advance), 760-835 (`summary`, `end`) |
| `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` | 55-70, 120-200; `ServerMap.ts` all; `HeightmapMap.ts` 100-112 (territoryIncomeScale) |
| `src/skirmish/client/main.ts` | 930-1000, 1305-1360 (`showResult`, eliminated gating); `client/lobby/LobbyView.ts` 96-160; `client/lobby/main.ts` 160-180 |

### Probe (my own measurement, scratchpad only)

`scratchpad/gameplay/early.ts` / `early2.ts` (outside the repo). Mediterranean (`heightmap-test1`) at 500 (500x250, 89,524 land tiles, `territoryIncomeScale` 4) loaded through the production `loadServerMap`, production options (`DEFAULT_AI_POLICIES`, raids-v1, corridors-v1, `FORMATION_MOVEMENT`), Stone Age start, technology speed 1, 8 human seats + 14 AI + 30 tribes = 52 factions, solo victory, alliances off (lobby defaults). Three runs:

* `idle` seeds 424242 and 9001: the 8 human seats issue no commands (worst case for a human, but it isolates what the AI and tribes do on their own).
* `ai` seed 424242: the 8 human seats are handed to the AI at tick 0 (`setAiController(id,true)`), a proxy for a competent player that recruits, builds and expands.

Results are in "How it works today / measured early game" below; raw JSON in `scratchpad/gameplay/early-*.json`.

## How it works today

### Victory and match end
* Survival is "any ground squad with troops > 0 (embarked included) or any completed city" (`Simulation.ts:5446-5453`). Everyone else is eliminated in one batch, their land goes to the conquest beneficiary or to owner 0 under raids-v1 (`:5461-5462`).
* `winner` is set only when exactly one non-eliminated player remains, or none (`:5514-5516`). Tribes are players, so a solo win means all 51 other factions, including all 30 tribes, are dead.
* Allied mode: `coalition()` (`Expansion.ts:1929-1941`) wins when no tribe is alive, at least one regular faction has been eliminated, and every pair of live factions is allied. Tribes cannot ally (`Diplomacy.ts:172`). AI accepts at most `maximumAllies` 1-3 partners (`AiPersonalities.ts:23, 57, 81, 105, 131, 156, 181, 205, 228, 253, 267`; `AiPersonality.ts:76-91`). A clique of k factions needs k-1 allies each, so with any AI alive an allied win needs <= 4 survivors.
* No score, time limit, territory, wonder, resign or team rules exist (grep for `score|wonder|capital|resign|surrender|concede` in non-lab skirmish code: no gameplay hits).
* Server: `LiveMatch` ends the match when `winner !== null` (`LiveMatch.ts:400, 773`) or when no seat is connected for `EMPTY_MATCH_GRACE_MS` = 120 s (`:33, 592-596, 603-614`). An eliminated human's seat still counts as connected.
* Client: `showResult` only runs on `winner !== null` (`main.ts:860, 1313-1333`). An eliminated local player just sees disabled build/recruit controls (`main.ts:938-942, 1351`, `SkirmishViewModel.ts:218`), no defeat message.
* Rejoin and takeover: `summary` offers `rejoinPlayerId` only for a non-eliminated owner (`LiveMatch.ts:783-788`), `freeAiSeats` only to guests without a seat (`:789-801`), and `assertAvailable` rejects tribes and eliminated factions and anyone who already owns a seat (`:266-283`).

### Lobby options actually exposed
`LobbySettings` (`LobbyDirectory.ts:21-42`) and the create dialog (`client/lobby/LobbyView.ts:156`): map, human seats (2-20, default 20 from `LobbyRules.ts:7`), minimum humans, start timer, world size, starting age, technology speed 1/2/3x, AI count 0-14, tribes 0-30, resource density/output, alliances disabled/allowed (default disabled, `:57`), victory solo/allied (default solo), infinite gold for players, public AI takeover. Mode is hard-coded `"free-for-all"` (`LobbyRules.ts:5`, `LobbyDirectory.ts:64`). `diplomacyRules` is always `raids-v1` (`LiveMatch.ts:147`). No AI difficulty, no teams, no victory variants, no fog option.

### Factions
`FactionIdentity` = id, name, kind, origin (historical / middle-earth / westeros), region, AI personalities, reference links (`FactionRoster.ts:6-14`). There is exactly one culture (`Catalog.ts:40-52`: "Only the authored default culture is selectable"), one roster (Russian art), one tech tree. AI factions differ only by one of 11 personalities (`AiPersonality.ts:4-15`) and their doctrine (`AiDoctrines.ts`). Human seats have no personality and no bonus. Mechanically all 52 factions are identical except `kind` (regular vs tribe).

### Ages and technology
126 technologies, three trees per age, 4-10 required nodes per tree (`technologies.json` via `Technology.ts:11`). Advancing needs any two complete current-age trees plus `ADVANCES[i]` (3,000-120,000 gold, 50-85 s) (`Progression.ts:91-109`, `Technology.ts:30-40`). Per-age serial research time (my script over the compiled catalogue): Stone 1.3-1.4 min per tree, Bronze 1.8-2.2, Classical 2.3-2.9, Early Medieval 2.6-3.7, Late Medieval 3.0-4.3, Napoleonic 3.3-4.8, Early Modern 4.6-8.1, Modern 5.5-11.0. Warfare is the longest and dearest tree from Classical on (Modern warfare 566k gold, 11 min). Tribes may only advance after 75 % of surviving non-tribe factions have (`TribeDevelopment.ts:5-17`).

### Diplomacy (raids-v1)
Default pairwise state is neutral, not war. War comes from (a) explicit `declare`, (b) AI `establishWar(…,"invasion")` when a campaign starts (`AiOperations.ts:287`), (c) **automatic "entry" war when a human squad moves inside any non-allied owned tile** (`Simulation.ts:3606-3614`; ships at `:3441`). Theft creates a 60 s embargo (`Diplomacy.ts:34-36, 44-51`). Peace gives 60 s of protection (`:79-86`). Capture of tiles/structures needs a declared war (`:37-39`). Tribes may declare but not ally.

### Information
No fog of war. `SnapshotEncoder.selectEntities` (`SnapshotCodec.ts:125-160`) selects changed squads, ships and buildings by journal, one shared cursor for every subscriber. `players` rows are copied whole (`:390`), which includes every rival's `gold`, `reserves`, `land`, `losses`, `kills` (`Protocol.ts:300-322`); `progression` for every faction is metadata. The AI reads full rival compositions (`AiOperations.ts:412-416`, `combatAdvantage(composition(player.id), composition(rival.id))`).

### Economy facts that matter for design
* Land gold is `20 + floor(land / (40 x territoryIncomeScale))` per second (`Simulation.ts:3695-3698`). Mediterranean 500 has `territoryIncomeScale` = 500x250/(250x125) = 4 (`HeightmapMap.ts:109-112`), so 1,500 tiles earn 20+9 = 29 gold/s = 1.7k/min. 05's land table assumed scale 1; on the default playtest map land income is a quarter of that, against 2.4k-38k/min per factory from trade (05).
* Reserves (manpower): nations `baseReserveIncome(age)` + per city; tribes a flat 40 points/s (`Simulation.ts:3686`). Starting squads: 3 for nations, 4 for tribes (`Simulation.ts:1119`, `FactionRules.ts:50`). Tribe squad cap 10 + 5/age (`FactionRules.ts:53-54, 95-98`) against 60-200 for nations.

### Measured early game (probe above)

| Minute | idle 424242: humans alive / original AI nations alive / promoted tribes / tribes | idle 9001 | ai 424242 (seats AI-driven) |
|---|---|---|---|
| 1 | 8 / 14 / 0 / 30 | 8 / 14 / 0 / 30 | 8 / 14 / 0 / 30 |
| 2 | 7 / 14 / 0 / 30 | 8 / 14 / 0 / 30 | 8 / 14 / 0 / 30 |
| 4 | 6 / 14 / 0 / 30 | 7 / 13 / 0 / 30 | 8 / 14 / 0 / 30 |
| 6 | 3 / 13 / 1 / 29 | 6 / 12 / 1 / 29 | 7 / 13 / 2 / 28 |
| 8 | 1 / 8 / 6 / 23 | 5 / 9 / 4 / 23 | **2** / 8 / 10 / 14 |
| 10 | 0 / 6 / 7 / 18 | 1 / 7 / 6 / 20 | 2 / 6 / 11 / 9 |
| 12 | 0 / 5 / 7 / 18 | 0 / 6 / 7 / 17 | 1 / 6 / 11 / 5 |
| 16 | 0 / 3 / 9 / 12 | 0 / 5 / 7 / 12 | 1 / 4 / 10 / 2 |
| 20 | 0 / 3 / 7 / 11 | 0 / 4 / 4 / 9 | **0** / 3 / 8 / 1 |
| 30 | 0 / 3 / 7 / 6 (min 28) | 0 / 2 / 5 / 3 | 0 / 2 / 4 / 1 |

Other observations from the same runs:
* First AI war declaration against a human at minute 1 (AI 19 on H4, seed 424242); first human eliminated at minute 2 (AI 16 conquered H5 from 33.5 tiles away). AI nations reach 5-9 squads and 1,200-1,600 tiles by minute 2-3, against 3 squads and ~113 tiles for an idle human.
* Tribes average 8.0 squads at minute 1 and sit at their cap of 10 from minute 2 (`FactionRules.ts:53`), while AI nations average 4.1-5.3 squads in minutes 1-3.
* From minute 5 tribes conquer AI nations and inherit their progression (`Simulation.ts:5463-5468`): 7-11 promotions by minute 10 in every run. In the `ai` run only 2 of the 8 AI-driven seats and 8 of 14 original nations survive minute 8.
* 52 factions collapse to 12-21 by minute 20 and to 7-16 by minute 28-30; total squads fall from ~400-520 at minute 4-6 to ~170-390 later. In the `ai` run all 8 AI-driven human seats are gone by minute 20, and the leader holds 28,763 tiles (32 % of all land, 1.4x the runner-up) at minute 30.
* Age pace of AI leaders, identical in all three runs: Bronze at minute 4, Classical 8, Early Medieval 13, Late Medieval 19, Napoleonic 25-26. With two trees the serial research floor to enter Napoleonic is 18.4 min (05 table), so leaders run at about 1.4x the floor; the same ratio projects Early Modern at ~33 and Modern at ~43 min. Two ages of spread between leaders and laggards at minute 20-30 (one Classical survivor at minute 30 in seed 9001).
* Spawn spread for the 8 human seats (seed 424242): nearest neighbour 16.3-44.3 tiles; one seat had 5 tribes within 40 tiles, another had no faction within 40 tiles; 4 of 8 had coast within 12 tiles.

This contradicts 04 I14 ("tribes are inert speed bumps, eaten in the first ages") for Stone starts on the default playtest map: at 30 tribes the tribes are the main early predators and the main winners.

## Strengths
* The rules are a good RoN-shaped skeleton: eight ages, three research trees with age gating, territory that grows from cities and capture, trade couriers and sea traders, a manpower pool, a diplomacy state machine with war, raids (embargo by theft), peace protection and alliances.
* Survival, ownership transfer and conquest credit are centralised in `checkWinner` (`Simulation.ts:5446-5528`), so new victory rules have one insertion point; `expansion.winners` and `winner = -1` already model multi-winner results and the client already renders them (`main.ts:1323-1325`).
* `peaceProtection` rows with `untilTick` (`Definitions.ts:272`, `Diplomacy.ts:31-33`) are a ready-made "no-rush / protected start" primitive; `longTerm` alliances (`Definitions.ts:256-264`) are a ready-made team primitive.
* Controller handover (`Simulation.ts:227-240`) and public AI takeover (`LiveMatch.ts:266-283, 789-801`) already move a faction between human and AI control mid-match, so "rejoin as another faction" is mostly seat bookkeeping.
* AI behaviour is data-driven: personalities, doctrines and policy flags (`AiPersonalities.ts`, `AiDoctrines.ts`, `AiPolicies.ts`) give clean levers for difficulty without touching the decision code.
* Lobby already has starting age and technology speed, which are the two strongest match-length levers.

## Issues

### G1. Stone-age tribes and early AI raids wipe out nations, and humans with them, within 10 minutes
* Where: `src/skirmish/FactionRules.ts:50-54` (tribes start with 4 squads, cap 10 + 5/age), `src/skirmish/Simulation.ts:3686` (flat 40 reserve points/s for tribes vs `baseReserveIncome` 12 at Stone for nations, 05 #10), `src/skirmish/Simulation.ts:1119` (nations start with 3 squads), `src/skirmish/domain/AiOperations.ts:402` (tribes may start campaigns after 30 s, nations after `raidAfterTicks` 45-60 s, `AiPersonalities.ts:12, 70, 194`), `src/skirmish/Simulation.ts:5463-5468` (a tribe that kills an AI nation inherits its whole progression and becomes a nation).
* Severity: critical for the 8-human playtest. Confidence: high (CONFIRMED, 3 probe runs, table above).
* Mechanism: tribes reach their cap of 10 squads by minute 2 with 3.3x the nations' manpower income; AI nations hold 4-5 squads (04b: gold hoarded by saving goals). Once boxed in, tribes campaign against the weakest neighbour, which is a nation as often as a tribe, and every win promotes them with the victim's techs. AI nations meanwhile declare on any neighbour with a 2.5x advantage, which an idle or slow-starting human always offers in minute 1-2.
* Consequence: with AI-driven seats as a proxy for competent humans, 6 of 8 seats are gone by minute 8. Eight humans who spend their first minutes learning the HUD will mostly be eliminated before Bronze Age, and the eliminated-human flow (G4) has nothing for them.

### G2. Solo victory requires killing all 51 other factions including every tribe; there is no score, time or territory end
* Where: `src/skirmish/Simulation.ts:5514-5516` (survivors include tribes), `:5449-5453` (one living squad, even embarked, keeps a faction alive).
* Severity: high. Confidence: high (CONFIRMED by reading).
* Consequence: a 60-90 minute match has no natural end. Even at the probe's collapse rate, 7-16 factions remain at minute 28-30; the last ones can survive as a single squad on a transport. The owner has to stop matches by hand or wait for the 120 s empty-grace timer after everyone leaves.

### G3. Allied conquest is unreachable while more than ~4 factions live
* Where: `src/skirmish/domain/Expansion.ts:1929-1941` (`coalition` needs pairwise alliance of every survivor and no live tribe), `src/skirmish/domain/AiPersonality.ts:76-91` + `content/AiPersonalities.ts` (`maximumAllies` 1-3), tribe alliance rejection at `Diplomacy.ts:172`.
* Severity: high (design). Confidence: high (CONFIRMED by reading).
* Consequence: "Allied conquest" is the only lobby alternative to solo conquest and is functionally the same rule. There is no way for 8 friends to play as one or two teams against the AI.

### G4. Eliminated humans get no defeat screen, cannot rejoin or take over anything, and keep the match running
* Where: `src/skirmish/client/main.ts:1313-1333` (result only on `winner`), `src/skirmish/multiplayer/application/LiveMatch.ts:783-788` (rejoin only for a living owner), `:789-801` (takeover only for guests without a seat), `:266-283` (`You already own a faction`, tribes refused), `:592-596` (any connected seat, eliminated or not, keeps the match out of the empty grace).
* Severity: high (blocks the playtest experience). Confidence: high (CONFIRMED by reading).
* Consequence: with G1, most of the 8 humans will spend the rest of the evening watching a match with disabled buttons and no explanation; if any of them keeps the tab open after all living humans are gone, the server keeps simulating 40+ AI factions until one survives, holding a reserved worker (00 recommends `MULTIPLAYER_MATCH_CAPACITY=1` on the ARM host, so no other lobby can start).

### G5. No fog of war: no scouting, no surprise, and every client has a built-in map and economy hack
* Where: `src/skirmish/SnapshotCodec.ts:125-160` (journal-only selection, one cursor), `:390` (full `Player` rows incl. `gold`, `reserves`), `Protocol.ts:300-322`; AI omniscience in `AiOperations.ts:412-416`.
* Severity: high (design), medium for a friends playtest. Confidence: high (CONFIRMED).
* Consequence: RoN's opening (scout, find rare resources, find the enemy) and mid-game (feints, flanking, hidden reserves) are impossible. Any client that logs its decoded state sees every army and treasury.

### G6. Factions are cosmetic
* Where: `src/skirmish/domain/FactionRoster.ts:6-14`, `src/skirmish/content/Catalog.ts:40-52`, `content/Factions.ts:173-1003`.
* Severity: medium (design). Confidence: high.
* Consequence: picking "Carthage" or "Rohan" changes name, colour and, for AI, a personality. 8 humans play identical empires; there is no reason to choose a faction and no asymmetric matchups (RoN's main replay driver).

### G7. Snowball: conquest compounds through tribe inheritance, and land income is too small to be the damper
* Where: `src/skirmish/Simulation.ts:5463-5468` (inheritance), `:3695-3699` with `HeightmapMap.ts:109-112` (land gold / 160 per second on Mediterranean 500), 05 #4/#5/#13 (trade and stacking uncapped).
* Severity: medium-high (design). Confidence: high for the mechanism; the probe shows max land 6-13k tiles (7-14 % of land) at minute 20, so no runaway yet by area, but by progression (promoted tribes jump ages).
* Consequence: the 05 #9(c) option (log land income) acts on ~5 % of a mid-game income and would not change outcomes; dampers must act on conquest reach (attrition) and on trade (05 rec 3).

### G8. No AI difficulty and no protected start for humans
* Where: `src/skirmish/lobby/LobbyDirectory.ts:21-42` (no difficulty field), `src/skirmish/content/AiPersonalities.ts:12, 70, 194` (raids allowed after 45-60 s), `AiOperations.ts:402, 405, 423` (tribes after 30 s; nations attack a 2.5x-weaker non-retaliating neighbour even while expanding).
* Severity: high for mixed lobbies. Confidence: high (measured first war on a human at minute 1).
* Consequence: the same AI that is right for a solo veteran faces 8 first-time players.

### G9. Pacing: AI leaders reach Napoleonic by minute 25-26 and would reach Modern around minute 43
* Where: `src/skirmish/domain/Progression.ts:101-106` (two trees), `content/Technology.ts:30-40` (advance 50-85 s), catalogue ticks.
* Severity: medium. Confidence: medium (measured to minute 20-30, extrapolated after; 05 #6 model).
* Consequence: for a 60-90 minute match the late ages (where the art, aircraft and naval content is) would come before the midpoint, and the field has already collapsed to 7-16 factions by minute 30. Spread between leaders and laggards is two ages at minute 20; cross-age fights are not closed (05 #1/#2).

### G10. Human starts are unequal
* Where: `src/skirmish/StartingPositions.ts:23-37`, `src/skirmish/domain/SpawnSelection.ts:70-78, 113-140`.
* Severity: medium. Confidence: high (probe: 0-5 tribes within 40 tiles, nearest neighbour 16-44 tiles, coast 4/8).
* Consequence: with G1, one human starts next to five predators, another alone. Adds to 05 #11.

### G11. Moving through foreign land auto-declares war, including on tribes at 10 squads
* Where: `src/skirmish/Simulation.ts:3606-3614`.
* Severity: medium. Confidence: high (CONFIRMED by reading; 04 I9 covers the AI side).
* Consequence: early scouting or a mis-click into a neighbour tribe 16-25 tiles away opens a war against a faction with 3x the human's army. RoN only charges attrition for being in foreign territory; war is a deliberate act.

### G12. Lobby defaults do not fit the target
* Where: `src/skirmish/lobby/LobbyRules.ts:4-10` (20 human seats, free-for-all only), `LobbyDirectory.ts:44-61` (alliances disabled, solo victory), `client/lobby/LobbyView.ts:156` ("Infinite Gold for Players" exposed next to real rules).
* Severity: low. Confidence: high.

## Recommendations (ranked gameplay changes)

Effort: XS < 0.5 day, S 0.5-1 day, M 2-4 days, L 1-2 weeks, XL > 2 weeks.

**Blocks an 8-human playtest: R1, R2, R3, R4 (minimum form). Everything else can follow the playtest.**

### R1. Protected start and an opening that humans survive (blocks playtest) — S-M
* Player problem: G1/G8/G11. Humans are attacked at minute 1 and overrun by tribes by minute 6-10.
* RoN analogue: no rush is possible in RoN's first minutes because cities and the capital shoot, attrition kills deep raiders and early armies are tiny; AoE III/IV offer an explicit "treaty" no-rush timer. Here a treaty timer is the cheapest equivalent.
* Rule:
  1. Lobby `protectedStartMinutes` 0/5/8/12, default 8. During protection no faction may declare war on, raid, or capture tiles of a protected human, and a protected human's entry into foreign land does not declare war (it is blocked like peace protection). A human can end its own protection early with an explicit `declare` (shown as "Break protection").
  2. Tribe opening nerf: tribes start with 3 squads, cap `6 + 4 x ageIndex` (Stone 6, Bronze 10, ... Modern 34) instead of `10 + 5 x ageIndex`; tribe reserve points `2 x baseReserveIncome(age)` (24 at Stone instead of 40, 192 at Modern) as in 05 rec 6.
  3. Tribes may not start a campaign against a regular faction before Bronze Age or before 8 minutes, whichever is later (`AiOperations.ts:402`), but keep tribe-on-tribe and nation-on-tribe wars.
  4. Inheritance only when the tribe actually captured the nation's last city (not as conquest beneficiary of a squad wipe), and grant only the donor's age, not every completed tech (`Progression.inheritCompleted`).
* Files: `FactionRules.ts` (constants), `Simulation.ts:3686, 1119, 3606-3614, 5463-5468`, `domain/Diplomacy.ts` (`protected()` gets an O(1) per-player `protectedUntil` check before the row scan, so the start protection does not add 8x51 rows to the hot loop that 04 I5 already flags), `domain/AiOperations.ts:402, 410-429`, `lobby/LobbyDirectory.ts`, `multiplayer/Protocol.ts` (settings schema), `LiveMatch.ts:145-165` (pass through).
* Replication/HUD: protection end tick per player in the replicated diplomacy metadata (already revisioned); a countdown chip in the HUD top bar and a "protected" badge on the player list. `infiniteGold` checkbox moved into an "advanced/test" section.
* AI: candidate scan skips protected targets (it already skips `diplomacy.protected` at `AiOperations.ts:410`), so no planner work beyond the timer.
* Tests: `StartProtection.test.ts` (AI cannot declare on a protected human, human entry does not declare, explicit declare ends protection, checkpoint round-trip keeps the timer); `TribeOpening.test.ts` (Stone tribe cap 6, reserve curve); a nightly design probe like mine asserting that at least 6 of 8 AI-driven human seats are alive at minute 10 on three seeds (about 8 min wall each on desktop).
* Effort: S for protection, S for the tribe numbers, M including the probe gate.

### R2. Victory and match end for 52 factions (blocks playtest in its minimum form) — M (minimum), L (full)
* Player problem: G2/G3. The match never ends with a human win, allied victory is the same as conquest, and nothing ends a match when the humans are gone.
* RoN analogue: RoN offers conquest, territory (hold most of the map's territory for a countdown, approx. 70 %), wonder (accumulate wonder points), score with a game time limit, and surrender; team games share all of them.
* Rule (all evaluated once per second inside `checkWinner`, written to `expansion.victory`):
  1. **Eligible survivors** (minimum, blocks playtest): tribes and future pop-ups are not victory-eligible and do not block any win. Solo conquest = one eligible survivor (or one team). Elimination adds a "homeless" rule: a faction with no completed city for 180 s is eliminated even if squads remain (ends transport-squad hunts).
  2. **Teams** (minimum form "Humans vs AI", blocks a co-op playtest; full form later): lobby `teams: "none" | "humans-vs-ai" | "custom"`. A team is a set of permanent long-term alliances created at tick 0 that cannot be broken (`Diplomacy.action` refuses `break`/`declare` inside a team). `coalition()` becomes "all eligible survivors are on one team".
  3. **Time limit + score** (minimum form, blocks playtest): lobby `timeLimitMinutes` 60/90/120/none, default 90. At the limit the highest team score wins. Score (integer, recomputed every 10 s) = `land/20 + 300 x completed cities + 1500 x ageIndex + 25 x completed techs + kills/4 + 2 x (alive army gold value)/1000`. Visible in the player list for all factions (it is the one number RoN also shows).
  4. **Territory**: a team holding >= 40 % of all land tiles and >= 2x the next team for 5 continuous minutes wins. On Mediterranean 500 that is 35.8k tiles; the probe's leader held 6.8-14.5k at minute 20 and 17-28.8k (19-32 %, 1.15-1.4x the runner-up) at minute 30, so with today's collapse rate this would trigger around minute 40-50, and later once R1/R5 slow the collapse. Countdown broadcast to all.
  5. **Surrender**: command `resign` (human only, or team vote 50 % for teams). The resigning faction is eliminated immediately; its land goes to neutral (or to a teammate if it has one), its squads disband.
  6. **Humans-only end**: when no non-eliminated human (or human team) remains, the match ends with "AI victory" after 60 s (lobby `continueWithoutHumans` false by default).
  7. Wonders: later, together with R7.
* Files: `Simulation.ts:5446-5528` (split into `domain/Victory.ts`: a pure function over players, buildings, land counts, teams and score inputs returning `{winners, reason}`), `Expansion.ts:1929-1941` (`coalition` delegates to `Victory`), `Diplomacy.ts` (team alliances, unbreakable), `Protocol.ts` (`Command` `resign`; `SkirmishOptions.victory` object), `multiplayer/CommandSchema.ts`, `lobby/LobbyDirectory.ts` + `LobbyView.ts` (options), `LiveMatch.ts:400, 773` (end reason text).
* Replication/HUD: `victory` metadata section `{conditions, scores[], territoryLeader?, countdownEndsTick?, timeLimitTick?}` with its own revision; a top-bar clock with time remaining, a score column in the rival list, a territory-countdown banner, the result dialog showing the reason ("Territory victory · Team 1").
* AI: AI ignores score/time except for one rule: when a territory countdown runs against its team, raise all candidate scores against the leader by 2x (reuse the `retaliating` weight in `AiOperations.ts:429`). Surrender is human-only.
* Tests: `Victory.test.ts` (unit, pure function: tribes ignored, homeless timer, team win, time-limit tie-break by lower id, territory countdown resets), a `Skirmish` integration test for `resign`, checkpoint round-trip including countdowns, `LiveMatch` test that a match ends when all humans are eliminated.
* Effort: minimum (eligible survivors + homeless + humans-vs-AI teams + time/score + humans-only end + resign) M, 3-4 days; territory + custom teams + HUD polish L.

### R3. Eliminated-human flow: defeat screen, observer, rejoin as a tribe or nomad (minimum form blocks playtest) — S (minimum) to M
* Player problem: G4, amplified by G1.
* RoN analogue: defeated players become observers with full map; RoN has no respawn. Pop-up factions (nomads) give this game a natural, thematic respawn that RoN lacks.
* Rule:
  1. Minimum (S, blocks playtest): defeat dialog when the local player becomes eliminated ("Your empire has fallen to X at 12:31 — Observe / Leave"); observer mode unlocks the camera and keeps the rival list, diplomacy overview and events feed live; eliminated seats do not count as "connected" for keeping a match alive once no living human remains (`LiveMatch.ts:592-596` uses living seats).
  2. Rejoin as a tribe (M): within 15 minutes of elimination and before Napoleonic, an eliminated human may claim one surviving AI tribe that is not at war with any human and is >= 30 tiles from every human city. Server: `assertAvailable` allows `runtime.kind === "tribe"` for an eliminated owner, the old seat is retired, `setAiController(tribe,false)`. Cost: every claim is a rejoin barrier that pauses the match for everyone (02 N2), so cap at one claim per human and at most one claim per 2 minutes per match until 02's non-pausing rejoin exists.
  3. Rejoin as a nomad (L, after pop-ups exist, 04 design): spawn a nomad band of 4 current-age squads on neutral land >= 30 tiles from any city, no buildings, tribute/hire actions as in 04's design.
* Files: `client/main.ts` (dialog), `client/HudViewModel.ts` (observer state), `LiveMatch.ts:266-283, 592-596, 776-801`, `serverMatchWorker.ts` (`set-controller` path already exists), later `domain/PopupFactions.ts`.
* Replication/HUD: a `seat` state per human (`playing | observing | claimed:<id>`) in `players` rows; claim button in the defeat dialog listing eligible tribes with distance and age.
* AI: when a tribe is claimed, release its planner state (the `setAiController` path already calls `economy.release`/`operations.release`).
* Tests: `LiveMatch` tests for match end with only eliminated seats connected, claim validation (tribe, distance, cooldown), and a `Skirmish` test that a claimed tribe keeps tribe caps.
* Effort: S for the minimum; M for tribe claim.

### R4. AI difficulty for mixed lobbies (minimum "relaxed/standard/hard" preset blocks a mixed playtest; per-AI difficulty can wait) — S-M
* Player problem: G8. One aggression level for veterans and first-timers.
* RoN analogue: RoN has six AI levels (Easiest to Toughest) plus personalities; the higher levels play faster and get economic help (approx.).
* Knobs that already exist: `raidAfterTicks`, `minimumRaidSquads`, `raidSlots`, `interceptRange`, `replenishBelow`, `recruitment` (`AiPersonality.ts:17-38`); `reservePercent`, `assemblyTicks`, `commitmentTicks`, `minimumHealth` (`AiDoctrines.ts:5-15`); war thresholds `required` 1.1-1.6 and the expanding veto 1.6/2.5 (`AiOperations.ts:365, 423-424`); policy flags (`AiPolicies.ts:3-9`); diplomacy contact policy (`Diplomacy.ts:6-7`). Missing: an economy handicap, a cap on simultaneous campaigns against one human, and a selector.
* Rule: new `content/AiDifficulty.ts`:

  | Knob | relaxed | standard | hard (today) |
  |---|---|---|---|
  | `raidAfterTicks` floor | 8 min | 4 min | personality value (45-60 s) |
  | added to war `required` advantage | +0.5 | +0.2 | 0 |
  | expanding veto vs humans | 3.0 | 2.5 | as today |
  | max concurrent AI campaigns against one human | 1 | 2 | unlimited |
  | AI gold and reserve income multiplier | 0.85 | 1.0 | 1.0 (option 1.15 for "brutal") |
  | tribe squad cap delta | -2 | 0 | 0 |
  | AI strategic think interval multiplier | 1.5 | 1.0 | 1.0 |

  Lobby `aiDifficulty` default "standard". Applies to AI-controlled factions only; a human taking over an AI drops it.
* Files: `content/AiDifficulty.ts` (new), `domain/AiOperations.ts:402-429` (thresholds and campaign cap via the existing `commitments` count), `domain/AiArmyPlanner.ts:173` (raid gate), `Simulation.ts:3678-3700` (income multiplier for `player.ai`), `FactionRules.ts:95-102` (`squadCap` delta), lobby files and `SkirmishOptions`.
* Replication/HUD: difficulty in the lobby card and the match manifest; nothing per tick.
* Tests: per-knob unit tests on `AiOperations` candidate filtering; the R1 nightly probe run at each level (relaxed must keep 8/8 AI-driven seats alive at minute 10).
* Effort: S for the table + raid floor + campaign cap; M with income multiplier and probe gate.

### R5. Snowball control: choose 05 #9(a) attrition outside supply — M
* Player problem: G7. Big empires and promoted tribes roll over neighbours; nothing makes deep conquest costly; humans need a defender's advantage against AI rushes.
* Why (a) and not (b)-(d):
  * (c) log land income acts on land gold, which is 20 + land/160 per second on Mediterranean 500 (1.7k/min at 1,500 tiles) against 2.4-38k/min per trading factory (05). It would not change who wins.
  * (b) per-unit price ramp is already partly done by the squad cap (60-200) and the reserve pool, and it taxes defenders exactly as much as attackers, which is the opposite of what the opening needs.
  * (d) wonders are a gold sink and a victory path, not a damper; they are content-heavy and belong with R7.
  * (a) attrition acts on reach, which is how the probe's snowball happens (campaigns against neighbours 20-40 tiles away). In this game a marching army captures the tiles it stands on, so attrition only bites deep, unconsolidated strikes and long sieges; it is RoN's own signature damper and it helps every defender, human or AI, without touching the economy model. Pair it with 05 rec 3 (commerce cap) for the trade snowball.
* Rule: once per second, a land squad is *supplied* if within 6 tiles of a tile owned by itself or an ally, or within 14 tiles of its own completed city, fort/tower or depot. An unsupplied squad accumulates `unsuppliedSeconds`; after a 45 s grace it loses `max(1, ceil(1 % x capacity))` soldiers every 5 s (12 %/min), doubled while inside a territory whose owner has a fort within 14 tiles. Embarked squads, aircraft and pop-up nomads are exempt. Replenish already only works on owned tiles (`Simulation.ts:2509` onwards), so recovery needs a return to supply.
* Files: `Simulation.ts` (new `attrition()` beside `replenish()` at `:3647`; O(squads x 113-tile disc) about 0.5 ms per second at 1,100 squads), `domain/TacticalRules.ts` (constants), `Protocol.ts` (`Squad.unsupplied?: number` seconds), checkpoint (field is on the squad, so it is captured automatically), `SnapshotCodec` detail row.
* Replication/HUD: unsupplied seconds on the squad row; an "out of supply" icon with the countdown; a supply-range overlay while a squad is selected.
* AI: `AiOperations` campaigns already advance tile by tile; add `unsupplied` to `AiForceReadiness` so the AI withdraws squads below 60 % and give `AiArmyPlanner` a waypoint rule "stop at the edge of supply every 12 tiles" (re-uses the existing `assemblyTicks` pause).
* Tests: `Attrition.test.ts` (grace, rate, ally supply, fort doubling, exemption, checkpoint continuity), an AI test that a campaign against a 40-tile-distant tribe still completes with < 25 % attrition losses.
* Effort: M (3-4 days with AI and HUD).

### R6. Fog of war and scouting — L-XL, after 02 rec 10; not a playtest blocker
* Player problem: G5.
* RoN analogue: unexplored black map, explored terrain and borders remembered, live vision only from units and buildings, dedicated scouts and spies.
* Rule: per human team a visibility grid at 4x4-tile cells (500x250: 7.8k cells; 1000x1000: 62.5k cells). Sources: own and allied squads (7 tiles, cavalry 9, scouts 14), buildings (city 10, tower/fort 12), ships (8), aircraft (12). Territory ownership stays public (borders are explored information in RoN and the tile journal is global). Rival `gold`, `reserves`, research jobs are hidden; age, land and score stay public. Add a scout unit per age (no attack, speed 1.3x cavalry, vision 14) using existing light-cavalry art.
* Honest cost:
  * Simulation: none for gameplay rules; visibility is a server-side derived view, recomputed at 2 Hz only for human teams (8 viewers x ~640 sources x ~20 cells = ~13k cell writes per refresh, well under 1 ms).
  * Replication: this is the expensive part. The shared journal cursor and single gzip per publication (02) must become per-viewer (or per-team) entity selection: each viewer needs a "known entity" set so entities entering vision get a full row and those leaving get a removal. That is exactly 02 rec 10's tier (a), with the fog mask in place of the viewport mask. Up to 8 encodes per publication instead of 1, but each covers 15-30 % of entities, so total encoder CPU ~1.2-2.4x today while bytes per client fall 60-80 % (02's estimate). Do it in the same change as 02 rec 10; do not build fog first.
  * `players` and `progression` need per-viewer redaction, which also breaks the shared metadata encode; send redacted rows from a second, shared "public" encode and own rows per viewer.
  * AI: today every AI decision reads omniscient facts (`AiOperations.ts:412-416`, `thinkAi`, `AiModernFronts`, `AiNavalFacts`). Making the AI fog-aware touches dozens of call sites and doubles visibility cost (44 AI viewers). Recommendation: AI stays omniscient at standard/hard and is documented as such; relaxed AI gets a 20 s "intel delay" on rival compositions (cache `composition(rival)` every 20 s) instead of real fog.
  * Client: fog overlay texture from the visibility bitset (sent at 1 Hz, ~1 KB on 500x250), "last seen" ghosts for buildings. M.
  * Cheating: server-side fog removes the built-in maphack; client-side-only fog does not.
* Interim (XS, playtest-safe): hide rival gold/reserves in the HUD only (they are not shown today in the rival list, `main.ts:995`; keep it that way and do not add them).
* Files: new `multiplayer/application/Visibility.ts`, `SnapshotCodec.ts:125-175, 390`, `serverMatchWorker.ts` (per-viewer encode), `client/Renderer.ts` (fog layer), content for scouts.
* Tests: per-viewer encode never contains an entity outside the viewer's mask (property test with random positions); entering/leaving vision produces add/remove rows; replay equality for observers (full feed).
* Effort: L for server + client fog on top of 02 rec 10 (itself L); XL if the AI must also obey fog.

### R7. Faction asymmetry: national powers first, unique units second — M then L; not a playtest blocker
* Player problem: G6.
* RoN analogue: each of RoN's 24 nations has a national power (a set of 3-5 economic/military bonuses) and a handful of unique units that replace a generic unit for some ages.
* Rule (powers, M): 10 powers named after the existing personalities, chosen by humans in the lobby profile and assigned to AI by personality, tribes have none. All bonuses are +-10-20 % multipliers on systems that already exist, so no new art:

  | Power | Bonuses |
  |---|---|
  | Commerce (merchant) | +10 % trade payout, +1 courier tier, markets accept +25 % per visit |
  | Science (scholar) | -10 % research time, -10 % research gold |
  | Conquest (conqueror) | +25 % capture speed, capturing a city pays 10 % of its build cost as gold |
  | Sea (admiral) | -15 % warship and transport gold, +10 % ship speed |
  | Steppe (rider) | -15 % mounted unit gold, +50 % horse deposit yield |
  | Fortress (warden) | -25 % tower/wall gold, enemy attrition x1.5 in own territory (needs R5) |
  | Industry (builder) | -10 % building gold, building ramp cap x3.5 instead of x4 |
  | Siegecraft (engineer) | +15 % siege damage vs structures, siege workshops build 20 % faster |
  | Rangers (skirmisher) | +1 range for ranged soldiers, +10 % ranged accuracy |
  | Alliances (diplomat) | +1 alliance slot, peace cooldown halved, allied trade bonus 175 % instead of 150 % |

* Files: `content/NationalPowers.ts` (new), multiplier hooks in `content/TradeQuote` path (`TradeQuote.ts`), `Progression.researchTerms` (`Progression.ts:26-34`), `content/Buildings.ts` (`buildingCost`), `domain/Manpower.ts`/`Recruitment` (unit cost), `CapturePressure`, `Battle.ts` range/accuracy, `Protocol.Player.powerId`, `lobby/EmpireProfile.ts`.
* Unique units (L): one per power, available in two consecutive ages, as an "elite variant" of an existing roster entry (+15 % HP and damage, +20 % gold) with the same art and a banner tint; authored in `skirmish/plans/*` and compiled by the existing scripts.
* Replication/HUD: `powerId` on the player row (static); power summary in the lobby and the rival tooltip.
* AI: AI reads multipliers through the same cost/quote functions it already calls; `AiCombatPower` must include range/HP modifiers.
* Tests: per-power quote tests (cost, research time, payout), determinism (same seed same result with powers), a `BalanceMatrix` row per power.
* Effort: M for powers, L for unique units.

### R8. Pacing targets for a 60-90 minute match — S (rules), M (tuning)
* Player problem: G9. Ages arrive at ~1.4x the serial floor; Modern projected at ~43 min; late content comes before the midpoint and the field is already collapsed.
* RoN analogue: RoN ages are gated by library research plus an age-advance cost that grows steeply; typical multiplayer games reach the Industrial/Modern ages after 40-60 minutes (approx.).
* Targets (leader / median, minutes from Stone start):

  | Age entered | Target leader | Target median | Measured AI leader today |
  |---|---|---|---|
  | Bronze | 5 | 6 | 4 |
  | Classical | 12 | 14 | 8 |
  | Early Medieval | 20 | 23 | 13 |
  | Late Medieval | 28 | 32 | 19 |
  | Napoleonic | 37 | 42 | 25-26 |
  | Early Modern | 47 | 53 | ~33 (projected, 1.4x floor) |
  | Modern | 58 | 65 | ~43 (projected) |
  | Match end (time limit / territory) | 75-90 | | |

* Rule: (1) age advance requires all three current-age trees, or two trees plus warfare slot `workload - 1` (05 rec 2): raises the serial floor to Modern from 30.8 to 35.2 min (05 table). (2) `ADVANCES` time 50, 55, 60, 65, 70, 75, 85 s (7.7 min in total) to 90, 105, 120, 135, 150, 165, 180 s (15.75 min), so the age-up becomes a visible event as in RoN: +8.1 min of floor. Serial floor to enter Modern becomes 35.2 + 8.1 = 43.3 min; at the measured 1.4x ratio leaders arrive near 61 min, on target. (3) Keep technology speed 2x/3x and starting age as the short-match options; the R2 time limit scales with technology speed (90 / speed + 30 min).
* Files: `domain/Progression.ts:101-106`, `content/Technology.ts:30-40`, `AiEconomicDirector` age-up logic (it already plans with `advanceRejection`), the R2 time-limit default.
* Replication/HUD: age-advance progress for all factions is already in `progression` metadata; show "X is advancing to Napoleonic" in the events feed (RoN announces this).
* AI: no change; validate with the R1 probe extended to 60 min (ARM time ~2x desktop).
* Tests: `Ages.test.ts` (advance rejected with two trees), a pacing probe recorded in `docs/perf` style JSON.
* Effort: S for rules, M for tuning with probes.

### R9. Early-game design for 8 humans among 30 tribes (first 10 minutes) — M, after R1
* Player problem: G1/G10/G11. The first ten minutes decide most eliminations and there is no structure beyond "survive".
* RoN analogue: the RoN opening is scout, place second and third cities, claim rare resources, research the first library techs, with little early combat.
* Rule:
  1. Spawn parity for humans (extends 05 rec 8): humans >= 45 tiles from each other and >= 35 from any regular AI; exactly 2 tribes within 25-45 tiles of each human; coast within 12 tiles for all humans or none (lobby "balanced human starts", default on). Reject and resample (16 attempts already exist in `SpawnSelection.resolve`).
  2. Tribes as opportunities, not only threats: each tribe city captured by a regular faction pays a one-time bounty of `1,500 x (ageIndex+1)` gold and transfers the tribe's mines; peace with a tribe can be bought (tribute 500 x (age+1) for 5 minutes of protection, reusing `peaceProtection`).
  3. Entry is not war during protection (R1) and, after it, entry into a *tribe's* land starts a 20 s "trespass" warning before war (HUD toast with "withdraw" button) instead of instant war.
  4. City fire: completed cities and towers get a short-range (3-4 tiles) age-scaled arrow profile (03 rec 9), so a human's capital survives a 5-squad raid while the player learns the HUD.
  5. Opening objectives in the HUD (no rewards, guidance only): "Build a second city", "Research both Stone trees", "Advance to Bronze Age" with the protection timer beside them.
* Files: `domain/SpawnSelection.ts:113-140`, `StartingPositions.ts`, `Simulation.ts:3606-3614, 5446-5528` (bounty), `domain/Diplomacy.ts` (tribute), `domain/Defences.ts` + `Battle.ts` (city fire, 03 rec 9), client HUD.
* AI: nations already target tribes first when stronger; the bounty makes that rational for humans too. Tribe AI: accept tribute when `advantage < 1.5`.
* Tests: spawn parity property test over 12 seeds; bounty and tribute unit tests; city fire contract row ("a Stone city with 1 frontline squad repels 5 clubmen squads for 60 s").
* Effort: M.

### R10. 8-human HUD essentials (from 07) — S each, partly playtest-relevant
* Chat and pings (07): can be replaced by a voice channel for the first friends playtest; required before public play.
* Player list with connection, score (R2), protection timer (R1), age, power (R7) and team.
* Defeat/observer flow (R3) is the only HUD item that blocks the playtest.

## What blocks an 8-human playtest

| Item | Blocks? | Minimum form |
|---|---|---|
| R1 protected start + tribe opening nerf | **Yes** | 8 min protection, tribe cap/reserve curve, tribe campaign gate |
| R2 victory/end | **Yes** | eligible survivors, homeless timer, humans-vs-AI teams, 90 min time limit with score, resign, end when no living human |
| R3 eliminated flow | **Yes** | defeat dialog, observer mode, eliminated seats do not keep a match alive |
| R4 AI difficulty | **Yes for mixed skill** | relaxed/standard/hard table with raid floor and campaign cap |
| R5 attrition | No | after playtest data |
| R6 fog of war | No | after 02 rec 10 |
| R7 national powers / unique units | No | |
| R8 pacing | No (tune with playtest data); the three-tree rule is S and could ship with R1 | |
| R9 early-game structure | Partly (spawn parity is S and helps fairness) | |
| R10 chat/minimap | No (use voice) | |

## Open questions
1. Is the tribe blitz (tribes eating nations by minute 8 and promoting) the intended Stone-age story? `AiTribeExpansion.md:84` notes "starting nations fall quickly"; the probe shows it at full scale on the default map.
2. Should promoted tribes inherit the victim's full tech list (today) or only its age?
3. Is solo conquest meant to include tribes? If tribes are "minor factions", they should not block victory (RoN has no equivalent; Civ city-states do not).
4. For co-op play, is "8 humans vs 44 AI" a mode the owner wants? It needs only the team rule of R2 and changes the balance target for AI difficulty.
5. Should the AI ever be fog-limited, or is an omniscient AI acceptable if difficulty presets compensate?
6. Is `infiniteGoldForPlayers` meant to stay a lobby option in public lobbies?
