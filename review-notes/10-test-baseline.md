# 10 — Authoritative test baseline: HEAD vs working tree, and the River regression

Round 2 reviewer. Read-only. Date 2026-10-16, 01:50–03:40 local, Ryzen 3700X desktop (Windows).

## Scope read

- Configs: `vite.skirmish.config.ts` (all; `test.include = tests/skirmish/**/*.test.ts`, last line), `vite.config.ts:320-337` (root vitest `exclude` contains `tests/skirmish/**` at `:334` but not `out/**`), `.gitattributes` (header), `.oxlintrc.json` (presence), `package.json:38-44` (lint scripts).
- Tests read: `tests/skirmish/RiverExpansion.test.ts` (all, 91 lines), `AiLateGame.test.ts:120-145`, `FlexibleFrontage.test.ts:66-76`, `FormationPerformance.test.ts:130-170`, `ResponsiveGameplay.test.ts:100-120`, `SoldierDetailMode.test.ts:80-88`, `TechnologyDetails.test.ts:20-30`, `Ages.test.ts:330-342`, `CombatPresentation.test.ts:30-66`, `PresentationTuneUps.test.ts:100-113`, `FormationRepairContracts.test.ts:35-39`, `PreModernBalance.test.ts:40-80`, `RussianTroopSources.test.ts:1-22`; per-test timeouts grepped in `BlackForestMap`, `ContinentsMap`, `MigrationMap`, `MapContent`, `ReservedMatchWorker`.
- Source read: `src/skirmish/Simulation.ts` working-tree diff (all hunks), `:546-560` (`aiFootprintAllowed`), `:5078-5092` (tribe defence hop), `:5235-5276` (`riverHop`, `expandAcrossRiver`), `step()` winner early-return (`if (this.winner !== null) return;`, `:3389` in the snapshot, `:3393` in the live tree at 03:00 — the file is being edited while I review, see "Moving tree"), `checkWinner` `:5446-5527`; `domain/AiOperations.ts` diff (all) and `:98-101` (`enabled`); `domain/Expansion.ts` diff (all; tribe development hunk at `:1580-1615`); `domain/TribeDevelopment.ts` diff; `domain/AutomaticProduction.ts:203`, `:256-273`; `domain/WeaponAccuracy.ts` (all); `content/UnitTuning.ts` (all); `content/unit-tuning.json:1-70`, `:413-415`; `content/formation-recipes.json:431-435`; `content/Units.ts:344`, `:409-414`; `content/Catalog.ts` diff; `content/BalanceContract.md:45-128`; `client/troops/TroopActors.ts:476`, `:498`, `:508`; `scripts/FormationDoctrineSchema.ts:57`.
- Round-1 notes read for reconciliation: `01-structure.md:14,32,104-106,150-156`; `08d-sweep-working-tree.md:19-21,50-70,76,96,104-110,126-127`; `08-latent-bugs.md:132-200` (H4, H5), `:406-430` (M10), `:850-880` (L22, L23); `03-combat.md:38-50`; `05-balance-economy.md:36-44,413-414`; `04b-ai-economy-naval.md:30-40`; `00-summary.md:24,327,353`.

### What I executed (all outside the repo except this file)

| Run | Tree | Command | Result |
| --- | --- | --- | --- |
| A | working tree (live, 01:53–01:57) | `npx vitest run --config vite.skirmish.config.ts` (json+default reporter) | **368 files / 2639 tests; 25 files / 30 tests failed; 223.6 s** |
| B | HEAD `e63a0730` export (`git archive HEAD`, node_modules junction) | same | **351 files / 2419 tests; 22 files / 37 tests failed; 248.4 s** |
| C | frozen working-tree snapshot (copied 01:56, see below), each of A's 25 failing files alone | `--testTimeout=120000` | **12 files / 13 tests fail on assertions; 4 tests fail on hard-coded per-test caps** |
| D | HEAD export, each of B's 22 failing files alone | `--testTimeout=120000` | **2 files / 5 tests fail: RussianTroopSources ×3 (hash), BlackForestMap ×1 and ContinentsMap ×1 (hard caps)** |
| E | both trees, the three map files with per-test caps raised to 900 s (scratch copies `*.long.test.ts`) | `--testTimeout=900000` | all map assertions pass (see table) |
| F | working tree | `npx tsc --noEmit` | **exit 0, 0 errors, 150 s** |
| G | working tree / HEAD export | `npx oxlint` | **161 errors / 157 errors**, all `typescript(prefer-nullish-coalescing)`, 0 warnings; exit 1 on both |
| H | snapshot vs HEAD | scratch `river.mts` replaying the RiverExpansion fixture with tracing, plus 16 hunk-revert variants | root cause below |

### Moving tree

The working tree changed **during** this review. At 02:30–02:35 (and again by 03:00) another session edited `Protocol.ts`, `Rules.ts`, `SnapshotDetails.ts`, `Simulation.ts`, `content/Units.ts`, `content/ModernWeapons.ts`, `domain/Definitions.ts`, `domain/Expansion.ts`, `domain/AirfieldCapacity.ts`, `client/ImpactPresentation.ts` and added `content/DroneSwarms.ts`, `domain/AirBases.ts` (carrier/drone/airbase work). My first isolation pass against the live tree hit `Error: Missing unlock earlymodern-carrier` at import time in `PresentationTuneUps` and `RegionalMapImports` (`content/Catalog.ts:65` throws while building the unit catalogue) — i.e. for some minutes the live tree could not load the unit catalogue at all. I discarded that pass and re-ran everything against a frozen copy of `src/`, `tests/skirmish/`, `scripts/`, `skirmish/` taken at 01:56 (no tracked file had an mtime between round 1's ledger at 01:34 and 02:30, so the snapshot equals the tree that run A tested). **All working-tree numbers below are for that snapshot.** Line numbers in `Simulation.ts` past ~:3380 have drifted by about +4 since then in the live tree.

The desktop was also shared with other agents' node processes (one at 1.2 GB / 1286 CPU-s started 02:46), so wall times are noisy; this matters only for the timeout class.

## How it works today

- Two vitest configs. `npm test` uses the root `vite.config.ts`, which **excludes `tests/skirmish/**`** (`vite.config.ts:334`) but not `out/**`, so `npx vitest <Name> --run` without a config runs only stale copies under `out/crash-investigation-20261015/deployed/tests/skirmish/` and `out/late-game-playability-20261012/baseline/tests/skirmish/` (and never the live file). The skirmish suite runs only with `--config vite.skirmish.config.ts`, whose `include` is root-relative `tests/skirmish/**/*.test.ts`, so it never picks up `out/` or `.codex/` copies. No npm script runs it (`package.json` scripts) and there is no CI.
- Default per-test timeout 5 s; many map/worker tests hard-code their own caps (`BlackForestMap.test.ts:44` 30 s, `ContinentsMap.test.ts:67/77/107` 120 s, `MigrationMap.test.ts:39/93/…` 30 s, `ReservedMatchWorker.test.ts:59/76/103` 20 s, `MapContent.test.ts:456` 60 s). A per-test cap overrides `--testTimeout`, so these fail even "in isolation with a 120 s timeout" whenever the machine is slower than the author's.
- `tsc --noEmit` covers the whole fork (`tsconfig.json`), 150 s here.

## Strengths

- The deterministic core is healthy at HEAD: **every HEAD failure in run B is a timeout, an artefact of my export, or the CRLF hash test** — run D shows HEAD is green apart from two hard caps and RussianTroopSources.
- `tsc` is clean on the working tree.
- The working tree's new tests (17 untracked files, +94 tests: CavalryAssault*, AirfieldTransfer, BalanceExperiment, MeleeDamage, PreModernBalance, BlastOwnershipLifecycle, …) all pass in isolation, including `BalanceExperiment` once `Art/` is present.
- The new restore-equivalence check inside `RiverExpansion` ("crosses with a small afloat cohort…", `:53-57`) passes on both trees: restore after afloat state is bit-identical for 30 ticks.

## Results

### (1a) Working tree — authoritative failing set (snapshot, isolation, run C)

| # | Test (file:line of failing assertion) | Assertion → expected vs actual | Classification | Cause |
| --- | --- | --- | --- | --- |
| 1 | `Ages.test.ts:340` "launches one physical ranged projectile and reloads five times slower while moving" | `nextAttackTick` expected `secondsToTicks(12.5)`=100, got **160** | new regression vs HEAD — **stale literal** | `soldier-weapons.json` stoneage-archer ranged 12 HP @24 rpm (2.5 s) → 32 HP @15 rpm (4 s): 32 ticks × `movingReloadPercent` 500 = 160. The "five times" contract still holds. |
| 2 | `AiLateGame.test.ts:142` "carries strategic payload and oil requirements into automatic production" | `jobs` contains make-hydrogen/make-mirv: expected `true`, got **false** | new regression — **code** (ledger H5 stands) | `AutomaticProduction.ts:203` `troopTarget = Math.min(600, Math.max(100, …))` (HEAD: `Math.min(180, Math.max(context.ai ? 12 : 100, …))`) and `targets.clear()/continuous.clear()` removed under `aiDemand` (`:266-273`). |
| 3 | `CombatPresentation.test.ts:65` "shows an enemy's actual owner research and strength…" | health meter expected **48**, got **68** | new regression — **content contradicts its contract** | `formation-recipes.json:431-435` modern-archer (RPL-20 crew) `soldierHp` 80 → **100**, `enlargedCapacity` 1 → **3**; test sets wounds 32 000 → 100−32 = 68. `BalanceContract.md:107-108` says Modern "HP, counts, recruitment, prices … are unchanged". |
| 4 | `FlexibleFrontage.test.ts:73` "rejects malformed profile data and mounted width exploits in the compiler" | throws `Mounted frontage exceeds infantry ratio: bronzeage-cavalry capacity 1.8894230769230769` | new regression — **content vs validator** (ledger M10 stands) | `scripts/FormationDoctrineSchema.ts:57`; bronzeage-cavalry capacity 8→16, enlarged 12→20 (`skirmish/plans/formation-recipes.json:66-69`). |
| 5 | `FormationPerformance.test.ts:144` "creates 2000 legal squads … with populated combat" | fighting squads expected **>1900**, got **450** | new regression — **combat lethality (content)**, not perf | Probe: in the crowded fixture one `game.step()` removes **1550 of 2000** napoleonic-infantry squads (HEAD: 0 removed, 2000 fighting). |
| 6 | `FormationPerformance.test.ts:167` "retains a legal automatic ranged target…" | `combatTargetId` expected **111**, got **null** | new regression — **consequence of #5**, not a retarget bug | Probe: after step 1 `held` (id 111) no longer exists (48 → removed) and `closer` is 48 → 5, while the source is untouched; at HEAD held 48→35, closer 48→41. After `removeSquad(closer)` there is no legal target, so null is correct. Ledger H4's "clear code fault: combatTargetId becomes null after removeSquad instead of retargeting" is wrong; 08d's explanation is right. |
| 7 | `FormationRepairContracts.test.ts:37` "authors medieval 36/48 and Napoleonic 48/72…" | early/late-medieval-infantry recipe expected `{capacity:36,enlargedCapacity:48,reserveCost:36}`, got **40/50/40** | new regression — **stale literal** (if the recipe edit is intended) | `content/formation-recipes.json` working-tree edit (212 lines). |
| 8 | `PreModernBalance.test.ts:72` "calibrates the Bronze Age fights starting in melee range" | axemen survivors expected ≤ **33**, got **39** | **admitted** — `BalanceContract.md:116-119` | 1 failure, not 3 (Boyar and the three-spearmen test pass since the 00:17 "October 16 approved-balance promotion"). |
| 9 | `PresentationTuneUps.test.ts:112` "defends contacting enemies while firing at the explicit rear target" | volley damage expected **5100** (test's own `damageAmount` formula), got **3327.75** | new regression — **test model incomplete** | New `domain/WeaponAccuracy.ts` scales ranged contribution at launch (Napoleonic 90 % at contact → 35 % at max range, `BalanceContract.md:50-54`); 3327.75/5100 = 0.6525. The test formula omits `weaponAccuracy()`. |
| 10 | `ResponsiveGameplay.test.ts:119` "keeps strategic sleep facts identical across restore despite index rebuilds" | restored vs live AiOperations checkpoint: `nextThink` **1426 vs 1480** | new regression — **fixture** (ledger L22 stands) | `AiOperations.ts` adds `expansionBlocked()` (→ `hasUnclaimedFrontier`) to `sleepKey`; fixture writes `owners` directly, bypassing `changeOwner`. |
| 11 | `RiverExpansion.test.ts:89` "sends a small reinforcement cohort to threatened owned land across a river" | some tribe squad at x ≥ 41 at the end: expected `true`, got **false** | new regression — **fragile end-state assertion exposed by the balance promotion** (full trace in (3)) | Reinforcement works; the match ends (tribe wins) at loop tick 747 with every squad in the west. |
| 12 | `SoldierDetailMode.test.ts:86` "suspends pose processing and clears detailed picking on zoom-out" | `TypeError: snapshot.volleys is not iterable` | new regression — **code + fixture** | `client/troops/TroopActors.ts:476` iterates `snapshot.volleys` unguarded (also `:498`, `:508`); fixture passes `{localPlayerId, squads}` only. |
| 13 | `TechnologyDetails.test.ts:27` "shows cavalry equipment, production inputs and the halved base cycle" | expected to contain `8 horses + 2 Bronze Age equipment`; actual `Spear Riders: 245 gold + 16 reserves + 16 horses + 2 Bronze Age equipment` | new regression — **stale literal**, but see Issue 6 | `content/Units.ts:414` sets `horses: recipe.capacity`; bronze cavalry capacity 8 → 16. |

All 12 files (11 committed + the untracked PreModernBalance) pass at HEAD except that PreModernBalance does not exist there (run B). The 11 committed test files and `tests/skirmish/fixtures/FormationLoad.ts` are identical between HEAD and the snapshot (`cmp`; AiLateGame and CombatPresentation differ only in CRLF line endings), so every one of these is caused by source/content changes, not by test edits.

Timeout-only on the working tree (persist in isolation because of hard-coded caps; all pass with caps raised, run E):

| Test | Cap | Isolation (run C) | Caps raised (run E), WT | HEAD isolation / caps raised |
| --- | --- | --- | --- | --- |
| `BlackForestMap.test.ts:17` "1000: regenerates identical solo and server inputs…" | 30 s (`:44`) | 45.2 s → fail | pass, 26.4 s | 46.1 s fail / pass 25.4 s |
| `ContinentsMap.test.ts:51` "scales the continent count with map size" | 120 s (`:67`) | 141.0 s → fail | pass, 110.7 s | 134.6 s fail / pass 90.8 s |
| `MigrationMap.test.ts:16` "1000: deterministic solo/server map…" | 30 s (`:39`) | 30.4 s → fail | pass, 23.1 s | 19.1 s pass / pass 16.5 s |
| `MigrationMap.test.ts:40` "keeps outer islands separate…" | 30 s (`:93`) | 49.1 s → fail | pass, 33.2 s | 24.4 s pass / pass 27.3 s |

Tests that passed in run C only because `--testTimeout=120000` lifted the 5 s default: `AuthoritativeFormation` "keeps every shared slot…" 9.8 s (HEAD 12.1 s), `EntityReplicationJournal` 10.7 s (HEAD 7.3 s), `Movement` "sixteen-squad army…" 11.6 s, `IncrementalCapture` 5.4 s, `SharedTradeRouting` 5.9 s, `TerrainDissection` 5.5 s, `RegionalMapImports` down-unda 5.6 s, `VallesKairuliaMap` ×4 5.0–6.7 s. A back-to-back re-run of four of them on a quieter machine (snapshot vs HEAD, same minute) gave TerrainDissection 4.3 / 3.9 s, Movement 3.1 / 3.4 s, IncrementalCapture 2.7 / 3.0 s, SharedTradeRouting 4.0 / **5.4 s (HEAD over the default)**. So this class is **pre-existing and load-dependent, not a working-tree perf regression**: these tests sit 0.5–2× from the 5 s default and flip with machine load. AuthoritativeFormation and EntityReplicationJournal exceed 5 s on both trees in every run.

### (1b) HEAD — failing set

Full run B (37): 32 vitest timeouts + 2 harness timeouts ("Timed out waiting for server-only match" `OnlineMatchTransport.test.ts:43`, "Timed out: [[{"type":"directory"…" `LiveJoinTransport.test.ts:54`) + 3 hash assertions. Run B overlapped my scratch replays, so it is noisier than run A.

In isolation (run D) only five remain:

| Test | Assertion | Classification |
| --- | --- | --- |
| `RussianTroopSources.test.ts:20` ×3 (RiverArcher, RecurveArcher, BronzeSpearman) | `baked.metadataHash` `cdd17176…` vs hash of source `02635…` (etc.) | **pre-existing, checkout-dependent** — see Issue 5. Passes in the working tree only because that checkout has CRLF bytes on disk. |
| `BlackForestMap.test.ts:17` 1000 | 46.1 s > 30 s cap | timeout-only, pre-existing |
| `ContinentsMap.test.ts:51` | 134.6 s > 120 s cap | timeout-only, pre-existing |

HEAD's `MigrationMap` passed in isolation (19.1 s / 24.4 s), the working-tree snapshot's did not (30.4 s / 49.1 s); with caps raised both pass in similar time. This is machine load, not a regression (no map-generation file differs between the trees).

### (1c) Static checks (working tree, live at 02:40)

- `npx tsc --noEmit`: exit 0, **0 errors** (150 s).
- `npx oxlint`: **161 errors, 0 warnings, exit 1**, every one `typescript(prefer-nullish-coalescing)` across 70 files (68 tracked). HEAD export: **157 errors**, also exit 1. The +4 are `scripts/compileSoldierWeapons.ts:25`, `src/skirmish/client/lab/UnitLabSheet.ts:73` and `:482` (new untracked file), and `Art/Cultures/Russians/build-fpv-explosion.cjs`. In `src/skirmish` there are 15 errors (HEAD 13): `Armies.ts:1185`, `CombatGeometry.ts:46` ×2, `Battle.ts:659` ×4, `AiArmyPlanner.ts:321`, `AiOperations.ts:420`, `client/HudView.ts:74`, `client/FormationEngagement.ts:103`, `client/Renderer.ts:1030`, `client/main.ts:1904`, `client/lab/UnitLabSheet.ts:73/482`. This confirms ledger L23 (3 new in reviewed code, lint already red at HEAD).

### (2) Reconciliation with round-1 counts

| Note | Their number | Config / filter they must have used | Right then? | Right for the current tree? |
| --- | --- | --- | --- | --- |
| `01-structure.md:14,32,105` | 26 files / 36 tests failed of 360 / 2545, 207 s | skirmish config, full suite, while other runs were active (20 of 36 were timeouts) | Plausible for 19:40; it counted PreModernBalance ×3 (true before the 00:17 promotion). Its classification has errors: FormationPerformance is content lethality, not a squad-count regression; SoldierDetailMode is not "a client/wire shape change" (real snapshots always carry `volleys`); RiverExpansion is not a reinforcement regression. | **No.** Now 368 / 2639 tests; full run 25 / 30 (17 timeouts + 13 assertions); authoritative isolated set **12 files / 13 tests** + 4 hard-cap timeouts. |
| `08d-sweep-working-tree.md:53-55` | full 25 / 34; "15 genuine failures (12 + 3 PreModernBalance) and 2 perf-contract timeouts" | skirmish config, full suite then each failing file alone; `--testTimeout=120000` only for two files | Yes at 19:40. The "2 perf-contract timeouts" (AuthoritativeFormation, EntityReplicationJournal) are real >5 s tests, but they are equally slow at HEAD. Its finding that the map-generation timeouts pass alone is load-dependent: today the 1000-size BlackForest and Continents tests exceed their hard caps alone on both trees (and the two MigrationMap tests did on the snapshot). | **No**: 12 + **1** PreModernBalance = 13. |
| `08-latent-bugs.md` H4 (`:132-160`) | 12 + 1; 11 committed files; HEAD 105/105 | skirmish config, only the 12 named files (93 + 12 = 105 tests) | Count right. Two details wrong: "FormationPerformance: combatTargetId becomes null after removeSquad instead of retargeting" is a symptom of #5, not a code fault; and the claim that "BalanceContract.md:89 … is stale" is right but `:89-90` also still says axemen-vs-archers "currently fail" which **is** still true. | **Yes** — matches my isolated run exactly (13 tests, 12 files incl. PreModernBalance). It is the number to use. |
| `03-combat.md:46-48` | PreModernBalance 3 failed (62 passed over 5 files) | skirmish config, 5 named files | Yes at 19:40 (Boyar 37.6 s, three-spearmen `[0,1]`, axemen 22 archers survive). | **No**: 1 failure (axemen 39 > 33). Boyar now 15.75 s and the spearmen test passes after the 00:17 `unit-tuning.json` / `soldier-weapons.json` promotion (`BalanceContract.md:96-119`). |
| `05-balance-economy.md:40-43` | "`PreModernBalance`, `AgeSquadCaps`, `FormationManpower` — all live tests pass; the two failures … are stale copies under out/" | **root config** (`npx vitest <names> --run`), because only the root config collects `out/**`; and the root config **excludes `tests/skirmish/**`** (`vite.config.ts:334`) | **No.** Under that config no live file ran: there is no `PreModernBalance` copy under `out/` at all, and the "passing" AgeSquadCaps/FormationManpower were the `out/…/deployed` and `out/…/baseline` copies. Live PreModernBalance had 3 failures at that time. | Live AgeSquadCaps and FormationManpower do pass now (run A); live PreModernBalance has 1 failure. The note's evidence is void either way. |
| `04b-ai-economy-naval.md:40` | "seven in-scope AI test files (all pass; the 76 failures … are stale copies under out/late-game-playability-20261012/)" | **root config** again (same reasoning; all seven names exist under both `out/` trees) | **Not evidenced**: the passes were the `out/` copies. | The live AI files the note names (AiEconomy, AiNavalPlanner, AiNavalFacts, AutomaticProduction, AiProgressionPolicy, …) pass with the skirmish config now (run A). **But live `AiLateGame` fails** (#2), and it belongs in that area. |
| `00-summary.md:353` | "12 tests … plus at least one admitted PreModernBalance; runs disagree 1 vs 3" | — | — | Resolved: **1**, because the content changed at 00:17 between the two runs. |

### (3) Root cause: `RiverExpansion.test.ts:89`

Replay of the exact fixture (`RiverExpansion.test.ts:9-27`, `:81-90`) with tracing, 900 loop steps from `game.tick=56`:

| | HEAD | working tree (snapshot) |
| --- | --- | --- |
| max simultaneous afloat tribe squads (`:88` asserts 1..4) | 2 | 2 |
| first loop tick a tribe squad is at x ≥ 41 | 11 | 12 |
| intruder (2 troops) destroyed | tick 46 | tick **32** |
| nation 1 eliminated / human seat 2 eliminated | 778 / 872 | 746 / **747** |
| `winner` set (tribe id 3) — `step()` returns early from then on | loop tick **872** | loop tick **747** |
| last loop tick a tribe squad was at x ≥ 41 | 899 (squad 13 at 47.9,1.7 when the world froze) | **656** |
| tribe tiles at x ≥ 41 at the end | 752 | 442 |
| `:89` | passes (by luck) | **fails** |

So the behaviour the test is named after — a ≤4-squad afloat cohort crosses to threatened owned land and kills the intruder — **works on both trees, and faster on the working tree**. What changed is incidental: in this fixture the tribe has `reserves=100000` (`:15`), each nation has one 1000-HP city and a handful of squads, and seat 2 is an idle human (`:17`), so every scenario in this file ends with the tribe conquering both nations (also true for the 2200-tick bridgehead test: winner at game tick 848 at HEAD, 713 in the working tree). After `checkWinner` sets `winner` (`Simulation.ts:5515`) `step()` early-returns (`:3389` snapshot), freezing positions. `:89` then reads a frozen post-victory world and only asks whether *some* tribe squad happened to be east of the river at that instant. In the working tree the tribe's raid on the western bases wins 125 ticks sooner, at a moment when all its squads had been pulled west.

**Bisection** (revert groups of working-tree files to HEAD in a scratch copy; restore after each):

| Reverted to HEAD | winner tick | tribe land x≥41 | `:89` |
| --- | --- | --- | --- |
| nothing (working tree) | 747 | 442 | fail |
| all 29 non-client `src/skirmish` diffs | 872 | 752 | **pass** (= HEAD) |
| `Simulation.ts` alone (incl. thinkAi tribe branch, `aiFootprintAllowed`, riverHop callers) | 747 | 442 | fail — **no effect** |
| `AiOperations.ts` + `Expansion.ts` (tribal strategic operations, `promotionPressure`, `TRIBE_MILITARY_*`) | 747 | 442 | fail — **no effect** |
| AI economy (`AutomaticProduction`, `AiEconomic*`, `AiMilitaryDemand`, `AiArmyPlanner`) | 747 | 442 | fail — no effect |
| `FormationGeometry/Tactics`, `Manpower`, `Definitions` | 747 | 442 | fail — no effect |
| `Supply.ts`, `Trade.ts` | 747 | 442 | fail — no effect |
| `formation-recipes.json` | 747 | 442 | fail — no effect |
| `Battle.ts` | 704 | 420 | fail |
| `soldier-weapons.json` + `SoldierWeapons.ts` | 872 | 419 | fail |
| `Units.ts` + `Catalog.ts` (drops `applyUnitTuning`) | 763 | 440 | fail |
| combat bundle (`Battle.ts`, weapons pair, recipes, `Units.ts`, `Catalog.ts`, `CavalryEngagement/Melee`) | 872 | 752 | **pass** |
| everything except the combat bundle | 747 | 442 | fail |
| weapons pair + `Units.ts`/`Catalog.ts` | 880 | 746 | **pass** |
| `Units.ts`/`Catalog.ts` + recipes | 763 | 440 | fail |
| weapons pair + recipes | 872 | 419 | fail |

Why the AI hunks are inert here: the fixture sets no `aiWarPolicy`, so `AiOperations.enabled()` is false (`AiOperations.ts:99-101`), `records` stays empty, `recruitmentObjective()`/`promotionPressure()` return undefined/false, hence `committedInvasion`/`pushing` in `thinkAi` reduce to HEAD's `finishing`, and the new Expansion tribe branch (`militarizing=false`) uses HEAD's `TRIBE_BUILDING_ORDER` and `TECHNOLOGIES`. No `diplomacyRules`, so `aiFootprintAllowed` returns at `Simulation.ts:553`.

**Responsible hunks (CONFIRMED):** the two halves of the stone-age infantry change, which must both be reverted to restore HEAD behaviour:

1. `src/skirmish/content/soldier-weapons.json` (compiled from `skirmish/plans/soldier-weapons.json`) — `stoneage-infantry.melee` `{damageHp:18, rpm:30, primaryBonus ranged +4, defence melee 1}` → `{damageHp:10, rpm:60, bonuses {infantry:+10, ranged:+20}, defence melee 0}`; versus infantry that is (10+10)×60 = 1200 HP/min per soldier against 18×30 = 540 (×2.2).
2. `src/skirmish/content/unit-tuning.json:5-7` via the new `applyUnitTuning` call at `content/Units.ts:412` — `stoneage-infantry.speedPercent` 100 → **80**.

Both are the deliberate "October 16 approved-balance promotion" (`BalanceContract.md:96-102`: mainline melee 10, cadence 60 RPM, stone speed 80 %). So this is **not a tribal-AI regression**; it is a fragile test assertion exposed by an intended balance change. (Round 1 saw the same test fail at 19:40, before the 00:17 promotion, against an earlier draft of the same two files; I cannot reconstruct that state, but the mechanism — conquest timing — is generic.)

### (4) AiLateGame and FlexibleFrontage

- `AiLateGame.test.ts:142` **still fails** on the snapshot (and passes at HEAD). `AutomaticProduction.ts:203` still reads `Math.min(600, Math.max(100, troopCapacity * 3, Math.ceil(squadCount / 3)))`. Ledger H5 stands unchanged.
- `FlexibleFrontage.test.ts:73` **still fails** with the identical message (`bronzeage-cavalry capacity 1.8894230769230769`). Ledger M10 stands; nothing re-ran the compilers.

## Issues

### Issue 1 — Every RiverExpansion scenario ends in a frozen post-victory world; `:89` measures luck — medium, CONFIRMED (bug, test design)
- `tests/skirmish/RiverExpansion.test.ts:12-26` (fixture), `:81-90`; `src/skirmish/Simulation.ts:3389` (snapshot; `:3393` live) early return on `winner`.
- Mechanism: tribe `reserves=100000` vs nations with one city each and an idle human seat; the tribe eliminates both nations at loop tick 747 (WT) / 872 (HEAD) out of 900, and at game tick 713 / 848 out of 2200 in the bridgehead test. Assertions then sample a frozen world. `:89` passes at HEAD only because squad 13 stood at x=47.9 at tick 872.
- Consequence: the suite reports a "tribal reinforcement regression" that does not exist (it cost round 1 a SUSPECT item and the summary a regression entry), and conversely would keep passing if reinforcement broke after tick ~60 but some squad lingered east. Any future content retune will flip it again.

### Issue 2 — Napoleonic infantry volley annihilates two adjacent 48-man lines in one tick — high, CONFIRMED (balance/combat), owner: combat area
- Evidence: `tests/skirmish/FormationPerformance.test.ts:161-167` fixture replayed (`fixtures/FormationLoad.ts`, `crowded`, 60): after one step `held` 48 → removed and `closer` 48 → 5, source untouched (HEAD: 48→35 and 48→41). Crowded 2000-squad load: 2000 → **450** squads after one `step()` (HEAD: 2000 remain, 2000 fighting).
- Mechanism (SUSPECT, for the combat reviewer): 91 soldiers killed by one 48-musket volley implies >1.9 kills per musket; the combination of the new accuracy-at-launch model, soldier-weapons promotion and/or volley splash across overlapping squads (`held` at +3 tiles, `closer` at +2.8 tiles) over-applies damage. `08d` measured 5292 damage for one volley at 3 tiles.
- Consequence: Napoleonic/Early-Modern line battles resolve in one exchange, and the 2000-squad performance contract (`:144`) can no longer measure combat load because 77 % of squads die on tick 1.

### Issue 3 — Modern RPL-20 crew HP and enlargement changed despite the contract — medium, CONFIRMED (balance/content)
- `src/skirmish/content/formation-recipes.json:431-435` (`modern-archer` `soldierHp` 100, `enlargedCapacity` 3; HEAD 80 / 1) vs `src/skirmish/content/BalanceContract.md:107-108` ("HP, counts, recruitment, prices and modern weapons are unchanged").
- Consequence: either the contract is wrong or the recipe edit leaked into Modern; `CombatPresentation.test.ts:65` fails (68 vs 48). Cannot be resolved by editing the test until the owner says which is intended.

### Issue 4 — Bronze cavalry now costs 16 horses per squad for the same total HP — low, CONFIRMED (balance), intent unknown
- `src/skirmish/content/Units.ts:414` derives `horses: recipe.capacity`; bronzeage-cavalry capacity 8 → 16 with per-soldier HP 300 000 → 150 000 (total unchanged, probe of `createManpower`). Equipment stays 2 per squad. `TechnologyDetails.test.ts:27` shows `16 reserves + 16 horses + 2 Bronze Age equipment` (HEAD 8 horses).
- Consequence: doubling a strategic-resource price of cavalry as a side-effect of a frontage/visual change; it also widens mounted frontage past the compiler ratio (M10).

### Issue 5 — `RussianTroopSources` hashes CRLF bytes; fails on any LF checkout (fresh clone, Linux build host) — low, CONFIRMED (determinism/build)
- `tests/skirmish/RussianTroopSources.test.ts:10-20`; `Art/Cultures/Russians/Units/BronzeAge/RiverArcher/TopDownReview/animations.json` is 21 957 bytes with 918 CRs on this disk although `.gitattributes` says `eol=lf` (git index blob is LF, 21 039 bytes). Baked `metadataHash` `cdd17176…` in `Art/Runtime/Russians/Troops/BronzeAge-RiverArcher/animations.json` is the CRLF hash; the committed LF source hashes to `0263590c…`.
- Consequence: HEAD fails 3 tests on an LF export; the bake script records platform-dependent hashes, exactly the hazard the `.gitattributes` header warns about. Fix: `git add --renormalize .` on this machine, re-bake, or hash after `\r\n → \n` normalisation in both the baker and the test.

### Issue 6 — A third of the suite's "failures" are wall-clock caps — medium, CONFIRMED (test infrastructure)
- Hard caps: `BlackForestMap.test.ts:44` (30 s), `ContinentsMap.test.ts:67` (120 s), `MigrationMap.test.ts:39,93` (30 s), `ReservedMatchWorker.test.ts:59,76,103` (20 s), plus the 5 s default for ~10 slow tests listed above.
- Run A: 17 of 30 failures are timeouts; run B: 34 of 37. In isolation on an idle-ish desktop 4 (WT) / 2 (HEAD) hard-capped tests still fail, and ~10 tests exceed the 5 s default on both trees.
- Consequence: a red suite on unchanged code; real regressions (13) are hidden in noise, which is how round 1 produced six incompatible counts.

### Issue 7 — Round-1 notes 04b and 05 ran stale `out/` copies, not the live tests — medium, CONFIRMED (process)
- `vite.config.ts:334` excludes `tests/skirmish/**` and nothing excludes `out/**`; `out/crash-investigation-20261015/deployed/tests/skirmish/` and `out/late-game-playability-20261012/baseline/tests/skirmish/` hold copies of AgeSquadCaps, FormationManpower, AiEconomy, AiNavalPlanner, AiNavalFacts, AutomaticProduction, AiProgressionPolicy, AiLateGame; no copy of PreModernBalance exists.
- Consequence: "all live tests pass" (05) and "all pass" (04b) are not evidence; live PreModernBalance (05's area) and AiLateGame (04b's area) fail. 00-summary item 32 already flags the `out/` collection; this is its concrete cost.

### Issue 8 — The working tree is being edited concurrently and was briefly un-loadable — informational, CONFIRMED
- 02:30–03:00 edits to `Protocol.ts`, `Simulation.ts`, `content/Units.ts`, `domain/Expansion.ts`, etc.; for a window `content/Catalog.ts:65` threw `Missing unlock earlymodern-carrier` at import, failing every test file that loads the catalogue.
- Consequence: any baseline taken from the live tree without a snapshot is unreliable; this note's working-tree numbers are pinned to the 01:56 snapshot.

## Recommendations

### Green-tree plan (per failing test, working-tree snapshot)

| Test | Action | Specifics | Effort |
| --- | --- | --- | --- |
| `Ages.test.ts:340` | **update expectation** (justified by the deliberate archer retune in `soldier-weapons.json`, cadence 2.5 s → 4 s) | `expect(s.nextAttackTick).toBe(UNIT.get('stoneage-archer')!.attack.reloadTicks * 5)` (= 160), keeping "five times slower" as the contract instead of a literal | 5 min |
| `AiLateGame.test.ts:142` | **fix code** (H5) | `AutomaticProduction.ts:203`: `Math.min(context.ai ? 180 : 600, Math.max(context.ai ? 12 : 100, troopCapacity * 3, Math.ceil(squadCount / 3)))`, or keep the human floor and, under `aiDemand`, stop ranking every equipment recipe ahead of payload recipes once kit stock ≥ `aiDemand.equipment` for that kit. Add a unit test with kit stock = demand and assert a payload job starts. | 1–2 h |
| `CombatPresentation.test.ts:65` | **owner decision**, then either fix content or update expectation | If Modern is unchanged per `BalanceContract.md:107-108`: restore `modern-archer` `soldierHp: 80`, `enlargedCapacity: 1` in `skirmish/plans/formation-recipes.json` and recompile. Otherwise change the test to `UNIT.get('modern-archer')!.formationRecipe.soldierHp - 32` (= 68) and correct the contract text. | 15 min |
| `FlexibleFrontage.test.ts:73` | **fix content or validator** (M10) | Either bronzeage-cavalry capacity back to 8/12 (and the other 20 offending mounted doctrines), or raise `FRONTAGE.mountedWidthRatioMax` from 1.35 to ≥ 2.05 deliberately (worst case napoleonic-cavalry 2.034) and update the test's `mountedChecks` expectations. Then run `compileFormationRecipes` → `compileSoldierWeapons` → `compileFormationDoctrines`. | 1 h |
| `FormationPerformance.test.ts:144`, `:167` | **investigate code/content first** (Issue 2); only then adjust fixtures | If one-volley annihilation is a bug (splash/overlap double-application or accuracy applied twice), fix it and both tests return. If intended, change `:144` to count squads that acquired a target this step before casualties (`combatTargetId !== null` sampled inside `fight`), and place `held`/`closer` at the musket's far band (≥ 70 % range) so neither dies on tick 1. | 0.5–2 days |
| `FormationRepairContracts.test.ts:37` | **update expectation** if the medieval 40/50 recipe is intended | `{capacity:40, enlargedCapacity:50, reserveCost:40}`, retitle to "authors medieval 40/50…"; otherwise restore 36/48 in `skirmish/plans/formation-recipes.json`. | 5 min |
| `PreModernBalance.test.ts:72` | **admitted** — mark `it.fails(...)` with a comment pointing to `BalanceContract.md:116-119`, or retune | Keep the 27–33 target. Fix `BalanceContract.md:89-90`: Boyar now passes (15.75 s); only axemen-vs-archers fails. | 10 min |
| `PresentationTuneUps.test.ts:112` | **update expectation** (justified by `BalanceContract.md:50-54`, accuracy committed at launch) | `const expected = damageAmount(..., remaining) * weaponAccuracy(unit.rangedAttack!, distance)` with the same distance `Battle` uses (or assert `toBeCloseTo(expected*acc, 2)`); 5100 × 0.6525 = 3327.75. | 20 min |
| `ResponsiveGameplay.test.ts:119` | **fix fixture** (L22) | Set ownership through `game.changeOwner` (or call the adjacency `rebuild` after the direct `owners.fill`) at `ResponsiveGameplay.test.ts:35-36`. Add a production-path test: live vs restored `sleepKey` equality after `changeOwner`. | 30 min |
| `RiverExpansion.test.ts:89` | **update expectation** (justified by trace (3): behaviour intact, failure is post-victory freeze) | Make the fixture non-terminal and the assertion behavioural: (a) give each nation's city `health: 1_000_000` or set `tribe.reserves = 2000`; (b) record `firstLanded` = first loop tick a non-afloat tribe squad stands on x ≥ 41 and `intruderDead` = first tick `game.squad(enemy.id)` is absent; assert `firstLanded <= 120`, `intruderDead <= 240`, `crossings` in 1..4; (c) add `expect(game.winner).toBeNull()` at the end of every scenario in this file so freezes surface as failures. Expected values on the current tree: 12 and 32. | 45 min |
| `SoldierDetailMode.test.ts:86` | **fix code and fixture** | `TroopActors.ts:476`, `:498`, `:508`: `snapshot.volleys ?? []`; fixture adds `volleys: []`. | 10 min |
| `TechnologyDetails.test.ts:27` | **update expectation after Issue 4 decision** | `"16 horses + 2 Bronze Age equipment"` if 16 horses is intended; otherwise make horses a fixed per-squad cost in `Units.ts:414`. | 5 min |
| Map caps (BlackForest/Continents/Migration) | **update infrastructure** | Replace fixed caps with `process.env.SKIRMISH_SLOW_TIMEOUT ?? 300_000` or move the 1000-size generators into a `*.slow.test.ts` group run separately; measured need on this desktop: 46 s, 141 s, 49 s. | 1 h |
| 5 s-default slow tests (~10) | **update infrastructure** | `test: { testTimeout: 30_000 }` in `vite.skirmish.config.ts` (max measured 12.1 s in isolation), and `poolOptions.threads.maxThreads: 8` to stop CPU oversubscription. | 10 min |
| `RussianTroopSources` (HEAD/LF) | **fix pipeline** | `git add --renormalize .` and re-bake, or normalise line endings before hashing in the baker and the test. | 30 min |

After these, the expected baseline is: 0 assertion failures except the admitted `it.fails`, 0 timeouts with the raised caps, `tsc` clean, oxlint at HEAD's 157 (fix the 3–4 new sites now; treat the rest as separate debt).

### Process

1. Add `"test:skirmish": "vitest run --config vite.skirmish.config.ts"` and `"check": "tsc --noEmit && npm run test:skirmish"`; add `"**/out/**"` to the root `exclude` (`vite.config.ts:331-337`) so `npx vitest X` can no longer silently run stale copies. 15 min.
2. Snapshot before baselining: a reviewer or CI job should run against `git stash create`/`git worktree` output, not the live tree, while other sessions edit. Record the tree hash in each note.
3. Keep one authoritative failing-test ledger (this table) and require every change to state which rows it moves.

## Open questions

- Is `modern-archer` 100 HP / enlarged 3 intended (contract says Modern unchanged)?
- Is one-volley annihilation of Napoleonic lines intended? If not, which of accuracy, splash or overlap is double-applying?
- Is 16 horses per bronze cavalry squad intended, or should horses stay per-squad?
- Was the medieval infantry recipe change to 40/50 intended (FormationRepairContracts title still says 36/48)?
- Should a tribe with unlimited reserves be able to eliminate two nations in ~95 s on an 80×48 map? It is a fixture, but it is also what the tribe AI does at 52-faction scale against weak neighbours.
