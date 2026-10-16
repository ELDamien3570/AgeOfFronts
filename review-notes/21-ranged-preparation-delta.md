# 21 — Ranged-preparation delta, committed HEAD, and citation remap (round 3)

Read-only. 2026-10-16, 06:05–06:45 local, Ryzen desktop (Windows). Line numbers are **current working tree** unless marked HEAD. HEAD = `0d1783ce`. The working tree was unchanged between my first `git status` and my last check: the same 25 tracked edits and 10 untracked files. Since then only `review-notes/README.md` has picked up an edit, from another reviewer.

## Scope read

- Repository state: `git log -1`, `git status --short`, `git diff --stat`, `git show --stat 0d1783ce`, `git cat-file -e` probes for the round-1/2 files.
- The whole uncommitted diff, all hunks: `src/skirmish/Simulation.ts`, `SnapshotCodec.ts`, `SnapshotDetails.ts`, `domain/Battle.ts`, `domain/Definitions.ts`, `domain/WeaponTiming.ts`, `content/Units.ts`, `content/RussianActorCalibration.json`, `content/RussianTroopActors.json`, `client/CombatEffectsViewModel.ts`, `client/CombatPresentationTimeline.ts`, `client/Renderer.ts`, `client/troops/TroopActors.ts`, `TroopImpacts.ts`, `TroopVolley.ts`, `scripts/prepareRussianTroopActors.py`, `skirmish/soldier-lab.html`, `vite.skirmish.config.ts`. Also the 8 test diffs: Ages, AiSiegeCommitment, CombatPresentation, PreModernBalance, PresentationTuneUps, SoldierWeapons, StalledMatchContracts.
- Untracked files, all read:
  - `domain/RangedPreparation.ts` (87 lines)
  - `content/RangedAttackTiming.ts` (19)
  - `content/ranged-attack-timing.json` (150, 37 units)
  - `content/RangedAttackTiming.md` (52)
  - `client/troops/RangedAttackPresentation.ts` (143)
  - `tests/skirmish/RangedPreparation.test.ts` (436)
  - `tests/skirmish/fixtures/RangedPreparation.ts` (18)
- Skimmed: `client/lab/RangedReview.ts` (218), `skirmish/ranged-review.html` (168), `tests/skirmish/RangedAttackPresentation.test.ts` (330).
- Supporting reads:
  - `Battle.ts:567-600`, `:640-680`, `:800-990`, `:1068-1082`, `:1150-1156`
  - `Simulation.ts:1186-1200`, `:1580-1592`, `:1704-1776`, `:4180-4270`
  - `Armies.ts:906-970`
  - AI order issuers: `AiDefenseDirector.ts:375-405`, `AiMilitaryDirector.ts:120-160`, `AiInvasionResponse.ts:195-215`, `AiModernFronts.ts:195-212`, `AiRecovery.ts:135-150`, `AiCoastPlanner.ts:110-128`
  - `tests/skirmish/FormationPerformance.test.ts:120-175`, `fixtures/FormationLoad.ts`, `PreModernBalance.test.ts:1-60,125-175`
  - Round-2 notes: `10-test-baseline.md` (1a, Issue 2), `08d:19-40,64,100`, `09:295-306`, `00-summary.md` (all citation lines and `:455-500`), High entries of `08-latent-bugs.md` and `08e-round2-ledger.md`

### What I executed (all outside the repo)

| Run | Tree | Command | Result |
| --- | --- | --- | --- |
| A | live working tree | `npx vitest run --config vite.skirmish.config.ts --testTimeout=120000` on 19 files: the 9 requested, the 3 ranged files, and the other 7 files from the round-2 failing set | **19 files / 189 tests: 9 failed, 180 passed** (19.1 s) |
| B | HEAD export (`git archive 0d1783ce`, junctions for `node_modules` and `Art`) | same files, minus the 2 new ranged tests | **17 files / 162 tests: 13 failed** — exactly round 2's 13 |
| C | scratch copy of the working tree (`cmp`-identical to the live tree) | full skirmish suite, `--testTimeout=120000` | 2,622 tests: **27 failed**. 9 = the run-A assertion failures. 7 are hard-cap timeouts (BlackForest, Continents, Migration ×2, MigrationRegionalNavigation, ReservedMatchWorker ×2). 9 are scratch-copy artefacts (HimalayanSnow ×6, NewWorldClimate ×3; ENOENT on files outside the copied dirs; both pass live). 2 are real failures also at HEAD (Issue 7). |
| D | live tree | `npx tsc --noEmit` | exit 0 |
| E | both trees | scratch harnesses (`probe*.test.ts`) in the scratch trees: crowded 2000-squad stepping, the held/closer fixture, 48v48 duels, order re-issue, anti-air retargeting, snapshot size | tables below |

## How it works today

### (1) Repository state

- **HEAD** `0d1783ce1c578e6ea69126eb05adfc7eddf3a08e`, 2026-10-16 05:23:38 −0400, "pre-ultra". It touches 257 files, +27,174 / −1,531. The parent is `e63a0730` (2026-10-14), the HEAD round 2 compared against.
- **Uncommitted tracked delta outside `review-notes/`:** 25 files, +256 / −63.
  - `src/skirmish`: 17 files.
  - `tests/skirmish`: 7 files.
  - Also `scripts/prepareRussianTroopActors.py`, `skirmish/soldier-lab.html` and `vite.skirmish.config.ts`.
- **Untracked files outside `review-notes/` (10, 1,621 lines):**
  - `skirmish/ranged-review.html`
  - `src/skirmish/client/lab/RangedReview.ts`
  - `src/skirmish/client/troops/RangedAttackPresentation.ts`
  - `src/skirmish/content/RangedAttackTiming.md`, `RangedAttackTiming.ts`, `ranged-attack-timing.json`
  - `src/skirmish/domain/RangedPreparation.ts`
  - `tests/skirmish/RangedAttackPresentation.test.ts`, `RangedPreparation.test.ts`, `fixtures/RangedPreparation.ts`
- **Now committed in HEAD** (none of these exist at `e63a0730`; all confirmed with `git cat-file` or `git show 0d1783ce:`). The summary must stop calling these "uncommitted":
  - **Freeze fix:** `Trade.currentMarkets()` at `Trade.ts:346`.
  - **Rules version 12:** `Manpower.ts:5` `FORMATION_RULES_VERSION = 12`.
  - **New domain files:** `WeaponAccuracy.ts`, `MeleeDamage.ts` (contact-limited melee), `CavalryAssault.ts`, `AirfieldCapacity.ts`, `TradeCargo.ts`.
  - **Content:** `content/UnitTuning.ts` and `unit-tuning.json`.
  - **One-shipload port storage:** `Supply.ts:139` `goodsCapacity`.
  - **Tribal operations on by default:** `AiOperations.ts:99-101`.
  - **AutomaticProduction `troopTarget`:** `AutomaticProduction.ts:203`, `Math.min(600, Math.max(100, …))`. R2-M1 is now in HEAD.
  - **Carrier, drone and airbase work:** `content/DroneSwarms.ts`, `domain/AirBases.ts`.
  - **New tests:** `PreModernBalance.test.ts`, `MeleeDamage.test.ts` and the other round-2 tests.
  - **Effect on the round-2 hazard:** the "untracked but imported" hazard from `09:295-306` is closed for those six files. It reopens for the new delta (Issue 8).
- **HEAD is no longer green.** Run B shows HEAD `0d1783ce` has round 2's 13 assertion failures. A full-suite HEAD run is inferred, not run, but `RusPackagedRuntime:30` and `InfrastructureRework:29` also fail at HEAD (Issue 7). The summary's "HEAD isolation: 5 tests, effectively green" row refers to `e63a0730` and must be relabelled.

### (2) What the delta does to ranged combat

**Authored content.**
- `ranged-attack-timing.json` gives every ranged land unit (37 entries, exactly the 37 units with `attack.channel==='ranged'`, probe) a `prepareMs` and an `automatic` flag.
- `applyRangedAttackTiming` (`content/RangedAttackTiming.ts:6-19`, called at `content/Units.ts:415`) converts this to `attack.preparation = {ticks: ceil(ms/125), automatic}`. For every ranged unit, `rangedAttack === attack` (probe), so hybrids get the same object.
- It throws at module load if a ranged unit lacks an entry or has `prepareMs < 500`. That is content-time, not reachable by a client.
- Resulting values:
  - 4 ticks (500 ms): siege, field support, Napoleonic and modern infantry, modern vehicles, anti-air.
  - 5 ticks (550–580 ms): bows, javelins, Napoleonic muskets, RPL-20, MGs.
  - 7 ticks (770 ms): earlymodern-rangedcavalry.
  - Automatic: `earlymodern-archer`, `modern-archer`, `modern-infantry`.
- `preparation` is part of `UNITS`, so it enters `CONTENT_HASH` (`Catalog.ts:97`).

**State.**
- `WeaponState` gains `rangedSequence` and `rangedAction` {sequence, definitionId, targetKind squad|aircraft|building|barrier, targetId, startTick, releaseTick, lastEligibleTick, phase preparing|sustaining|released} (`WeaponTiming.ts:14-26`).
- It rides the existing per-squad `weaponState`, so it reaches checkpoints (squad records) and snapshot details (`SnapshotDetails.ts:91,145`) with no new channel.

**Mechanism** (`RangedPreparation.ts`, `Battle.ts:567-600`).
- `commitShot(squad, profile, target)` first calls `prepareRangedShot` for ranged profiles with `preparation`.
- **Continuing aim.** If the same definition and target is being aimed and the aim was eligible on the previous tick (`:37`), it continues. The shot is ready when `tick >= releaseTick && tick >= readyTick`.
- **New aim.** Otherwise the old aim is cancelled. A new aim starts only once `tick >= readyTick - ticks` (`:47`), with `releaseTick = max(readyTick, tick+ticks)`.
- **What this does to cadence:**
  - The first shot of an engagement is delayed by `ticks`.
  - Later shots overlap the aim with the cooldown, so cadence is unchanged. Measured: Napoleonic infantry fires at t4, t84, t164, t244 versus HEAD t0, t80, t160, t240.
  - Automatic weapons enter `sustaining` after release (`:82`) and keep their cadence until a cancel or a magazine reload.
- **Release.** After the ordinary weapon commit succeeds, `releaseRangedShot` marks `released` or `sustaining` (`Battle.ts:595-598`).
- **Unchanged: damage, accuracy, splash and projectile rules.** Preparation only gates *when* `commitShot` returns true.

**Wiring and cancellation.**
- **Three call sites pass a target:**
  - aircraft at `Battle.ts:845`
  - ground burst at `:982`
  - structures at `:1154`
- **Melee profiles are untouched.** The hybrid melee call at `:629` uses the melee profile, so it never prepares.
- **End-of-turn cancel.** The `finally` of the per-squad combat loop (`Battle.ts:1076-1079`) cancels any `preparing` or `sustaining` action that was not re-confirmed this tick. This covers leaving range, losing the target, `continue` paths (refit, afloat, charge, quiet owners, melee profile chosen) and aircraft.
- **`Skirmish.updateSquad`** (`Simulation.ts:1189-1196`) auto-cancels on any of:
  - a definition or owner change
  - refit, afloat or embark
  - a charge that is not in recovery
  - a structure-target change
  - any `order` write other than the same attack target
- **`activateOrder`** (`Simulation.ts:1705-1706`) cancels unconditionally unless `continuingAttack`.
- **Anti-air now uses `commitShot`** (`Battle.ts:842-845`). It previously used an inline `tick >= nextAttackTick` check. It now sets `fighting` and `lastCombatTick` before the shot gate.

**Checkpoint, replication and validator.**
- `validateWeaponState(value, tick?)` (`WeaponTiming.ts:74-93`) checks:
  - integer sequence, which must equal `rangedSequence`
  - target kind, definition id length and integer ids
  - `releaseTick > startTick` and `release − start ≤ 480`
  - `lastEligibleTick ≥ startTick`, and no clock after the packet or checkpoint tick
  - a non-preparing action must have `lastEligibleTick ≥ releaseTick`
- All three decode or restore sites now pass the tick: `Simulation.ts:271` (restore), `SnapshotCodec.ts:487` (legacy), `SnapshotDetails.ts:515` (packed).
- `RangedPreparation.test.ts` covers encode/decode equality mid-aim and restore equality for 25 ticks, including volleys. Both pass.

**Determinism.**
- The per-squad `rangedSequence` counter is the only new state. The combat loop is id-sorted (`Battle.ts:668-670`). There are no floats in the new domain code, and no new iteration over Maps or Sets that affects state.
- CONFIRMED by the restore-equivalence test and by identical probe outputs across repeated runs.
- The client timeline uses floats, but presentation only.

**Throws reachable by a client.**
- None new. `commitShot`'s "Ranged preparation requires a target" (`Battle.ts:571`) is unreachable: every ranged call site passes a target.
- The validator throws only on malformed checkpoints or packets.

**Client.**
- **500 ms global delay.** `CombatPresentationTimeline` gains a `delayTicks` playhead delay. `COMBAT_PRESENTATION_DELAY_TICKS = ceil(500/125) = 4`, at `CombatPresentationTimeline.ts:3`; the Renderer uses it at `Renderer.ts:409`. The timeline merges next-endpoint volleys and projectiles at their own ticks and surfaces a forthcoming `rangedAction` at its `startTick`.
- **Wind-up drawing.** `RangedAttackPresentation` draws the wind-up from `startTick` to `releaseTick`. It refuses a late-joined aim (`permitsRelease`). It also stops promising an attack from "readiness" alone.
- **Muzzle smoke.** It moves from fact arrival to the actual release attachment (`TroopImpacts.release`).

### (3) Did it change the two round-2 measurements? No. It defers them by 500 ms.

Crowded fixture (`formationLoad('crowded')`, 2,000 napoleonic-infantry, one `game.step()` per row):

| step | WT squads / troops / fighting | HEAD 0d1783ce squads / troops |
| --- | --- | --- |
| 1 | 2,000 / 96,000 / 2,000 | **450** / 21,600 |
| 2–4 | 2,000 / 96,000 / 2,000 | 450 / 21,600 |
| 5 | **450** / 21,600 / 450 | 450 / 21,600 |
| 6–24 | 450 / 21,600 / 450 | 450 / 21,600 |

**1,550 of 2,000 squads still die in one volley; it now lands on tick 5 instead of tick 1.**

The `FormationPerformance:161-167` held/closer fixture:
- Working tree: `61→111` deals **5,292** at tick 5; `held` is removed and `closer` goes 42 → 10.
- HEAD: the same 5,292 at tick 1; `held` is removed and `closer` goes 48 → 5.

48v48 duels (PreModernBalance-style, real `fight()` and `advanceProjectiles()`, both sides firing; HP in `remainingHealth` units of 1/1000 HP):

| unit, distance | WT first-damage tick | first volley damage to an equal line | troops after volley | line wiped at tick | HEAD first / wiped |
| --- | --- | --- | --- | --- | --- |
| napoleonic-infantry, 3 tiles | 4 | 3,969,000 / 4,800,000 (82.7 %) | 48 → 9 | 84 | 0 / 80 |
| napoleonic-infantry, 6 tiles | 4 | 3,078,000 (64.1 %) | 48 → 18 | 244 | 0 / 240 |
| napoleonic-archer (musket), 3 tiles | 5 | 3,840,000 / 3,840,000 (**100 %**, mutual) | 48 → 0 | 5 | 0 / 0 |
| napoleonic-archer, 6 tiles | 5 | 3,239,999 (84.4 %) | 48 → 8 | 197 | 0 / 192 |

The volley sizes are bit-identical between the trees. Only the timing shifts, by the preparation ticks. Round-2 Issue 2 / summary C3 is **untouched**.

Requested test files, run A (working tree) versus run B (HEAD):

| File | WT | HEAD 0d1783ce |
| --- | --- | --- |
| FormationPerformance | 14/14 pass | 2 fail: `:144` 450 > 1900; `:167` null vs 111 |
| PreModernBalance | 1 fail of 17: `:72` axemen survivors **36** > 33 | 1 fail: 39 > 33 |
| Ages | 16/16 | 1 fail: `:340` 160 vs 100 |
| CombatPresentation | 1 fail of 6: `:65` 68 vs 48 | same |
| PresentationTuneUps | 6/6 | 1 fail: `:112` 3327.75 vs 5100 |
| AiSiegeCommitment | 6/6 | 6/6 |
| StalledMatchContracts | 4/4 | 4/4 |
| MeleeDamage | 11/11 | 11/11 |
| TroopContactCasualties | 7/7 | 7/7 |
| RangedPreparation (new) | 14/14 | n/a |
| RangedAttackPresentation (new) | 13/13 | n/a |
| SoldierWeapons | 12/12 | 12/12 |

### (4) The 13 round-2 failures

| # | Test | Now | Why | Justified? |
| --- | --- | --- | --- | --- |
| 1 | `Ages:340` | **pass** | expectation rewritten: `next−lastAttackTick === secondsToTicks(20)` while moving, then `+secondsToTicks(4)` stationary; also asserts 0 projectiles before preparation | **Content-justified and tighter.** The javelin is authored at 15 rpm (probe), and 4 s × 5 = 20 s is exactly round 2's "stale literal" diagnosis. |
| 2 | `PresentationTuneUps:112` | **pass** | expected damage now multiplies contributors by `weaponAccuracy(rangedAttack, distance)` and samples reservations at the release tick; also asserts no ranged shot before preparation | **Justified.** It adds the missing accuracy term that round 2 identified. It is still exact equality, not loosened. It mirrors the implementation formula, so it guards a regression in the reservation logic, not the accuracy contract. |
| 3 | `FormationPerformance:144` | **pass** | **test not edited**: the single `step()` now ends before the first volley (release at tick 5) | **Masked, not fixed** (Issue 3). |
| 4 | `FormationPerformance:167` | **pass** | not edited: the 3-step scenario ends before anyone dies | **Masked, not fixed.** |
| 5 | `PreModernBalance:72` | fail, 36 > 33 | value moved 39 → 36 through first-volley timing | admitted contract gap (R2-L2) |
| 6–13 | `AiLateGame:142`, `CombatPresentation:65`, `FlexibleFrontage:73`, `FormationRepairContracts:37`, `ResponsiveGameplay:119`, `RiverExpansion:89`, `SoldierDetailMode:86`, `TechnologyDetails:27` | **fail, unchanged messages** | untouched by the delta | as in 10 |

The other rewritten tests insert `finishRangedPreparation` and add "nothing before preparation" assertions. That is mechanical adaptation and stricter, not looser:
- `Ages:439`
- `AiSiegeCommitment:79-80`
- `CombatPresentation:152`
- `PreModernBalance:156`
- `SoldierWeapons:214-215`
- `StalledMatchContracts:40`

## Issues

### Issue 1 — Re-issuing the same attack order resets the aim; repeated clicks stop a squad firing entirely — high, CONFIRMED (bug/gameplay)
- **Where:**
  - `Simulation.ts:1705-1706`: `activateOrder` cancels unless `continuingAttack`.
  - It is reached for every player order through `Simulation.ts:1591` (`applyCommand` → `activateOrder(entry.squad, entry.order, entry.path)`).
  - Contrast `Simulation.ts:1195`, where `updateSquad` deliberately exempts a same-target attack.
- **Mechanism:**
  - A new aim cannot inherit elapsed time (`RangedPreparation.ts:46-66`).
  - Any re-issue of the identical attack order before `releaseTick` restarts the 4–7 tick aim. This includes a double-click, attack spam, or re-selecting the group and right-clicking the same enemy.
- **Measured (120 ticks, target in range):**

| unit (prep ticks) | re-issued every 2 / 3 / 4 ticks | every 6 | every 8 | never | HEAD (any rate) |
| --- | --- | --- | --- | --- | --- |
| earlymodern-rangedcavalry (7) | 0 / 0 / 0 shots | 0 | 5 | 6 | 6 |
| napoleonic-infantry (4) | 0 / 0 / 0 | 2 | 2 | 2 | 2 |
| modern-infantry (4, automatic) | 0 / 0 / 0 | 33 | 49 | 70 | 74 |

- **Consequence:** RTS players spam-click attack. Clicking faster than the preparation (500–875 ms) silences the squad, and slower clicking cuts automatic-weapon output by up to half.
- **AI:** not affected. The AI order paths I read are guarded: `setArmyAttack` only re-orders on a different target (`Simulation.ts:3875-3878`), and the director paths skip fighting squads.
- **Related, low:** a queue that drains on arrival (`finishOrder` → `activateOrder(hold)`, `Simulation.ts:1775`) also restarts an aim begun while moving.

### Issue 2 — Anti-air re-picks the nearest aircraft every tick, so 2+ aircraft at similar range can never be shot — high severity, mechanism CONFIRMED, real-flight frequency SUSPECT
- **Where:**
  - `Battle.ts:831-845`: nearest hostile aircraft each tick, with no stickiness, unlike the ground path's `previous` retention at `:913-915`.
  - `RangedPreparation.ts:33-37,46-66`: a different target id means a fresh aim.
- **Measured** (modern-anti-air, 4-tick prep, 120 ticks):

| scenario | firing ticks / 120 | HEAD |
| --- | --- | --- |
| single plane | 8 | 8 |
| two planes whose nearest alternates | **0** | 8 |
| six planes orbiting at 2–3 tiles | **0** | 8 |

- **Consequence:** drone swarms (`content/DroneSwarms.ts`) and bomber streams crossing the gun change "nearest" frequently. Anti-air, already flagged as too weak (summary A3), can be fully neutralised by numbers.
- **Not yet known:** I did not measure how often the nearest aircraft changes in a real sortie.

### Issue 3 — FormationPerformance is green only because the lethal volley moved from tick 1 to tick 5 — high (test validity), CONFIRMED
- **Where:** `tests/skirmish/FormationPerformance.test.ts:144` and `:161-167`, both unedited. The crowded table in (3) shows the mechanism.
- **Consequence:**
  - The 2,000-squad perf contract still loses 77.5 % of squads on the first volley. It no longer detects it.
  - The summary row "One Napoleonic step removes 1,550 of 2,000" (`00-summary.md:120`) and the C3 acceptance test ("`FormationPerformance.test.ts:144` back to > 1,900 fighting", `00-summary.md:131`) are now satisfied vacuously.
  - C3 needs a new acceptance criterion, for example "> 1,900 fighting after 8 steps", or the 48v48 duel rows above.

### Issue 4 — Napoleonic volley lethality unchanged; muskets at 3 tiles annihilate an equal line in one volley — medium (design/balance), CONFIRMED
- **Evidence:** the duel table above. `napoleonic-archer` at 3 tiles: 100 % mutual annihilation on the first volley (t5). `napoleonic-infantry`: 82.7 %.
- **Consequence:** preparation adds a readable wind-up but does not change who wins or how fast. Round-2 C3 stays open, and the first-volley-decides problem remains. Simultaneous release, with both sides aiming from t0, makes mutual wipes common.

### Issue 5 — Every squad on the battlefield is now drawn and picked 500 ms in the past — medium (UX), CONFIRMED by code
- **Where:**
  - `Renderer.ts:409`: the timeline is built with `COMBAT_PRESENTATION_DELAY_TICKS`.
  - `Renderer.ts:1121-1122`: the whole draw snapshot is the combat frame.
  - `Renderer.ts:647`: picking uses `presentedCombat.snapshot`.
  - `CombatPresentationTimeline.ts:73-74`: the ceiling is `latest.tick − delayTicks`.
- **Consequence:**
  - Order-to-visible-motion latency grows by 500 ms on top of network RTT and the 200 ms publication cadence. Clicks select bodies where they were 0.5 s ago.
  - The intent is to show whole wind-ups (`RangedAttackTiming.md` "Presentation and recovery"). The cost is paid by all units, including pure movement.
- **Not yet known:** not play-tested.

### Issue 6 — Anti-air now reports "fighting" every tick an aircraft is in range, even when not firing — low, CONFIRMED
- **Where:** `Battle.ts:843-844`. It was previously set only on a shot tick. The old duplicate remains at `:863-864`.
- **Consequence:** behaviour change for anything keyed on `fighting` or `lastCombatTick`: AI "not fighting" filters, R2-M5 advance-creep freeze, presentation. This is probably more correct, but it is undocumented.

### Issue 7 — HEAD `0d1783ce` has two new committed failures: carrier tech missing from the saved tech plan — medium (test baseline), CONFIRMED
- **Where:** `RusPackagedRuntime.test.ts:30` and `InfrastructureRework.test.ts:29` fail on both trees.
- **Mechanism:** the runtime has `rus-earlymodern-aircraft-carriers`, but `skirmish/plans/technology-plan.json` does not (probe: `extraRuntime: ["rus-earlymodern-aircraft-carriers"]`).
- **Consequence:** the authoritative failing set at HEAD is now 13 + 2 = 15 assertion failures, not round 2's 13. These two are unrelated to the ranged delta.

### Issue 8 — The new delta repeats the partial-commit hazard — low, CONFIRMED
- **Where:** tracked edits import untracked files:
  - `Battle.ts:13` and `Simulation.ts:24` import `RangedPreparation.ts`.
  - `Units.ts:28` imports `RangedAttackTiming.ts` and its JSON.
  - `TroopActors.ts:16` imports `RangedAttackPresentation.ts`.
- **Consequence:** committing only the tracked files breaks the build. Commit them together.

### Issue 9 — Ranged history is replicated for every squad forever — low (perf), CONFIRMED (size measured on encoder objects, not wire bytes)
- **Where:**
  - `RangedPreparation.ts:6-7`: a released action is kept "as bounded history".
  - `SnapshotDetails.ts:145`: `weaponState` is in every squad detail payload.
- **Measured** (`JSON.stringify` of the encoder output, 600-squad `formationLoad`):

| fixture | weaponState chars | full baseline | packet after 24 steps |
| --- | --- | --- | --- |
| distributed, 500 squads | 55,000 → 150,961 | 3,827,382 → 3,938,277 (+2.9 %) | 634,290 → 745,185 (+17 %) |
| crowded, 200 squads | 22,000 → 60,400 | — | 270,158 → 313,773 (+16 %) |

- **Churn:** during preparation, `lastEligibleTick` changes every tick, so detail payloads churn for 4–7 ticks per shot.
- **Not measured:** wire bytes after zbin.

### Issue 10 — Army slot updates write `order` through `updateSquad`, which cancels an aim — low, SUSPECT
- **Where:** `Armies.ts:927`, `:969` (`updateSquad(s.id,{order:{...s.order,x,y}})`) → `Simulation.ts:1195`.
- **Consequence:** only if army members fire while their march slots move. R2-M5 suggests a fighting member freezes the advance, so the impact is probably small. Not reproduced.

## Recommendations

1. **Issue 1.** In `activateOrder`, keep the aim when the new order is an attack on the same target as the current aim: compare against `rangedAction.targetId`, mirroring `Simulation.ts:1195`. Add a test: re-issue the same attack every tick for 120 ticks and shots must equal the never-reissued count. Consider keeping the aim across `finishOrder → hold` too.
2. **Issue 2.** Make anti-air acquisition sticky: prefer the aircraft currently in `rangedAction` (or `combatTargetId`) while it stays eligible, then fall back to nearest. Add the alternating-pair and orbit scenarios to `RangedPreparation.test.ts`.
3. **Issue 3.** Change `FormationPerformance:144` to step past the longest preparation (≥ 8 steps) or to assert on the tick of the first release. Re-point summary C3's acceptance criterion to the duel rows here.
4. **Issue 4.** The C3 decision is still the owner's. The preparation work does not substitute for it.
5. **Issue 5.** Apply the 500 ms delay only to combat facts (volleys, projectiles, `rangedAction`) and draw movement at the latest endpoint. Or make the delay adaptive (0 when no squad has a forthcoming `rangedAction`). Picking should use the latest snapshot.
6. **Issue 7.** Add the carrier tech to `skirmish/plans/technology-plan.json`, or mark it optional.
7. **Issue 9.** Drop `released` history once it is older than the presentation buffer (for example `releaseTick + 8`), and omit `rangedAction` from details for squads with no current aim.
8. **Summary edits:**
   - Relabel "HEAD isolation … effectively green" to `e63a0730`.
   - Mark the round-1/2 bundle as committed in `0d1783ce`.
   - Use the remap table below for line numbers.
   - Replace the "13 working-tree failures" heading with: 9 at the working tree, 15 at HEAD.

## Citation remap (5)

**File lengths** (`wc -l`):

| file | working tree | HEAD 0d1783ce | summary claimed |
| --- | --- | --- | --- |
| `Simulation.ts` | 5,653 | 5,642 | 5,638 |
| `domain/Battle.ts` | 1,703 | 1,682 | — |
| `domain/Expansion.ts` | 1,989 | 1,989 | 1,997 |
| `client/troops/TroopActors.ts` | 1,326 | 1,289 | — |
| `MovementAdmission.ts` | 1,067 | 1,067 | — |
| `domain/AiArmyPlanner.ts` | 560 | 560 | — |

`Expansion.ts`, `MovementAdmission.ts` and `AiArmyPlanner.ts` are byte-identical between the working tree and HEAD (`git diff --quiet`).

**Offset rules**, from the cited construct at HEAD to the working tree:
- `Simulation.ts`: +1 for HEAD lines 25–1188, +9 for 1189–1703, +11 from 1704 on.
- `Battle.ts`: +1 to 566, +17 for ~567–940, +18 for ~941–1063, +21 from ~1064 on.
- `TroopActors.ts`: +6 at 271, +8 at 476–489, +16 at 819–896, +26 at 1226.

"Drift" is the HEAD line of the grepped construct minus the cited line. +4 means the citation was pinned to round 2's 01:56 frozen snapshot.

### Simulation.ts

| cited | construct (grepped) | HEAD | WT | drift |
| --- | --- | --- | --- | --- |
| 34 | `import … "./lobby/FactionPalette"` | 34 | 35 | 0 |
| 227-241 | `setAiController(playerId, ai)` | 227-241 | 228-242 | 0 |
| 604-612 | `try{this.drainRouteBatch();}` … `ROUTE_EFFORT_LIMIT` | 604-612 | 605-613 | 0 |
| 800 | `new AmphibiousPaths(map, false)` | 800 | 801 | 0 |
| 822 | `priority: request => this.interactiveRoute(…)` | 822 | 823 | 0 |
| 930 | `available:ship=>!this.player(ship.playerId)?.ai …` | 930 | 931 | 0 |
| 1197 | `deployedShape:old.deployedShape && doctrine.shapes…` (refit branch of `updateSquad`) | 1197 | 1206 | 0 |
| 1227 | `removeSquad(id: number): boolean` | 1227 | 1236 | 0 |
| 1301-1302 / 1302-1304 | `if(command.type === "charge" && command.squadIds.some(` | 1302 | 1311 | +1 / 0 |
| 1304 | `tile:this.map.ref(Math.floor(command.x/FIXED)…` | 1304 | 1313 | 0 |
| 1454-1458 | `if(order.cavalryMode==='ranks' && selected.some(` | 1454-1458 | 1463-1467 | 0 |
| 1467-1468 | `this.expansion?.skirmish.observe(command);` / `trenches.observe` | 1467-1468 | 1476-1477 | 0 |
| 1480-1483 | `if(this.options.deferredPlanning && !append && order.type==="move" &&` | 1480-1483 | 1489-1492 | 0 |
| 1488-1512 | replenish branch; end message `…before replenishing` | 1488-1512 | 1497-1521 | 0 |
| 1543-1553 | `groupPaths = squadPaths.findGroup(` | 1546 | 1555 | 0 |
| 2269-2273 | `// explicit facing orders remain exact.` (reorient retry) | 2269-2273 | 2280-2284 | 0 |
| 2293 | `if(s.cavalryEngagement)continue;` | 2293 | 2304 | 0 |
| 2561-2566 | `VESSEL.get(definitionId ?? \`stoneage-${kind}\`)` | 2561-2566 | 2572-2577 | 0 |
| 2591-2606 | ship recruit; `health: rules.health,` | 2591-2606 | 2602-2617 | 0 |
| 2772-2789 | `if (!ship.attackTargetId && !this.hasNavalOpponents(…)) continue;` | 2772-2789 | 2783-2800 | 0 |
| 2910, 2931 | `scaledDamage,` / `Math.round((1000 * ship.health) / vessel!.health)` | 2910, 2931 | 2921, 2942 | 0 |
| 3215-3297 | `const maxHealth = this.shipMaxHealth(ship);` | 3215-3297 | 3226-3308 | 0 |
| 3238-3242 | repairing → `repairState: "returning-to-dock"` | 3238-3242 (write at 3241) | 3249-3253 | 0 |
| 3286-3297 | returning → `repairState: "repairing"` | 3286-3297 (write at 3294) | 3297-3308 | 0 |
| 3441 | warship entry war `…!this.player(ship.playerId)?.ai&&diplomacy.nonAllied(…)` | **3445** | 3456 | +4 |
| 3393 (10-test-baseline) | `if (this.winner !== null) return;` | 3393 | 3404 | 0 |
| 3606-3614 | `if(this.expansion?.diplomacy.raids)for(let at=0;at<land.length;at++){` | **3610-3618** | 3621-3629 | +4 |
| 3678-3700 | `private produceReserves()` | **3682-3704** | 3693-3715 | +4 |
| 3686 | `(player.kind === "tribe" ? 40 :` | **3690** | 3701 | +4 |
| 3742-3749 | `const targetIds=old.targetIds.filter(` … withdraw clear | 3742-3749 | 3753-3760 | 0 |
| 3748 | `if(phase==='withdrawing'&&…&&squad.order.type!=='move'){` | 3748 | 3759 | 0 |
| 3802 | `armyBlocked(tile, playerId)` | 3802 | 3813 | 0 |
| 4083-4135 | `private repairNavigation(squad)` | **4087** (to ~4139) | 4098 | +4 |
| 4164-4165 | `if(squad.order.type==='move' && squad.fighting && …!engagement &&` | 4165 | 4176 | +1 / 0 |
| 4575-4605 | `resolveLandDamage(damage: DamageLedger)` | **4579-4609** | 4590-4620 | +4 |
| 4631 | `if (squad.troops <= 0) this.removeSquad(squad.id);` | 4631 | 4642 | 0 |
| 4834-4887 | `private changeOwner(tile, id, options)` | **4838-4891** | 4849-4902 | +4 |
| 4888 | `private thinkAi(): void` | **4892** | 4903 | +4 |
| 5159-5175 | `const lastSquad = … this.spatial.nearest(` | **5163-5179** (call at 5166) | 5174-5190 | +4 |
| 5446-5528 | `private checkWinner(): void` | **5450-5532** | 5461-5543 | +4 |
| 5456 | `for (const player of defeated) player.eliminated = true;` | **5460** | 5471 | +4 |
| 5463-5468 | `const recipient = this.expansion?.diplomacy.raids …` | **5467** | 5478 | +4 |
| 5483-5491 | territory transfer loop → `this.changeOwner(tile,recipient);` | **5487-5495** | 5498-5506 | +4 |
| 5494-5495 | remaining-building reassignment `updateBuilding(building.id,{playerId: recipient})` | **5498-5499** | 5509-5510 | +4 |

### Battle.ts

| cited | construct | HEAD | WT | drift |
| --- | --- | --- | --- | --- |
| 75 | `cavalryRankLaunchSpacing?(squad)` (the comment is on 75) | 75-76 | 76-77 | 0 |
| 621-622 | `private meleeHit(damage:DamageLedger, …` | 621-622 | 638-639 | 0 |
| 709-710 / 710 | `// Transports carry soldiers…` + `…cavalryEngagement?.phase==='withdrawing') continue;` | 709-710 | 726-727 | 0 |
| 760-765 | charge disruption `let dx=Math.round(contact.normal.x*offset)…` | 760-765 | 777-782 | 0 |
| 941-946 | `const assault=ordinaryCavalryAssault(…)` (engaged on hold) | 941-946 | 959-964 | 0 |
| 989-992 | `const activeAssault=squad.cavalryEngagement?.assault;` | 989-992 | 1007-1010 | 0 |
| 1017-1024 | direct ranged hit; `engagement.participants * weaponAccuracy(` | 1017-1024 | 1035-1042 | 0 |
| 1047 | `if(waves && contacts.length){` | 1047 | 1065 | 0 |
| 1062-1105 | `// Fixed gun nests have their own weapon` loop | 1064-1105 | 1085-1126 | +2 |
| 1172 | `const incoming = this.projectiles.filter(… icbm/warhead)` | 1172 | 1193 | 0 |
| 1548-1559 | splash `impacts.add(target.id,p.playerId,lethal);` (id-sorted at 1546) | 1548-1559 | 1569-1580 | 0 |
| 1569 | `p.kind === "bomb" ? Infinity :` | 1569 | 1590 | 0 |

### Expansion.ts (working tree = HEAD)

| cited | construct | line now | drift |
| --- | --- | --- | --- |
| 433-913 | dispatcher `command(player, command)` | **435-922** | +2 / +9 |
| 439 | `if(command.type==="occupy")…this.skirmish.observe(command)` | 439 | 0 |
| 610-646 | `if (command.type === "sortie")` | 610-646 | 0 |
| 1007-1019 | strategic target validation | 1007-1019 | 0 |
| 755 / 758-767 | `if (command.type === "charge")` → fallback `world.applyCommand(…)` | 758-767 | 0 |
| 805-809 | charge selection, `world.cancelMovement?.(…)` | 805-809 | 0 |
| 1092 | strategic projectile `speed: FIXED` | 1092 | 0 (construct plausible) |
| 1148 | refit health/price | **unresolved**: 1148 is now a treaty-expire `announce`; refit handlers are at 661-678 (ships) and 737-747 (squads) | ? |
| 1286-1297 | fighter hits `if (enemy && this.world.tick >= a.reloadTick)` | 1286-1297 | 0 |
| 1387 | AI think (tribe branch 1382-1385, `progression.states` at 1387) | 1387 | 0 |
| 1622-1631 | tribe build-tile loop | **1618-1621** (cursor and `applyCommand build`) | ≈ −4 |
| 1766-1785 | `for (const v of VESSELS.filter(` | 1766-1785 | 0 |
| 1816-1858 | AI strategic targets, ending in the `type: "launch"` command | 1816-1858 | 0 |
| 1929-1941 / 1935 | victory test / `replicationMetadata()` | 1929-1941 / 1935 | 0 |

### TroopActors.ts

| cited | construct | HEAD | WT | drift |
| --- | --- | --- | --- | --- |
| 271-321 | `flush = (ctx…) =>` | 271-321 | 277-327 | 0 |
| 476 | `for(const hit of snapshot.volleys){` (L24) | 476 | 484 | 0 |
| 488-489 | `captureOffscreenLoss(next??old,…)` (U2) | 488-489 | 496-497 | 0 |
| 819 | `if (!this.detailed \|\| !this.ready) return;` | 819 | 835 | 0 |
| 896-1280 | `draw = (` | 896-1280 | 912-1316 | 0 |
| 1215 / 1226 | per-soldier loop `for (const [soldierIndex,soldier] of soldiers.entries())` | 1226 | 1252 | 0 (the 1215 note is the assault sample) |

### MovementAdmission.ts and AiArmyPlanner.ts (working tree = HEAD; every citation exact)

| cited | construct | line now |
| --- | --- | --- |
| MA 788-818, 806-818 | `stepAdmissions` budget split; `const [id, admission] = entry;` | 788-818 |
| MA 942 | `this.ports.squad(leader.id)!.kind === this.ports.squad(original.members[0].id)!.kind` | 942 |
| MA 946-955 / 946-969 / 961 | `admission.members.find(` … `this.ports.request(` (961) | 946-969 |
| AAP 184 | `for(const id of this.byPlayer.get(player.id)…)` intent loop | 184 |
| AAP 313 | `this.release(player.id);` | 313 |
| AAP 321 | `if(army&&['rally','assemble','advance','engage'].includes(plan.phase)&&!members.some(…fighting…))` | 321 |
| AAP 400 | `} else if (plan.phase === "flank") {` | 400 |
| AAP 448-453 | `} else if(army?.state==="blocked"){` → `plan.phase="breach"` | 448-453 |
| AAP 492 | `if (objective && (plan.targetTile !== objective.tile \|\| …hold))` | 492 |

The round-1 ledger High entries are covered above: H2 `Simulation.ts:5463, 5494-5495`; H3 `1301-1302`; H4 `TroopActors.ts:476`.

## Open questions

1. Is a 500 ms global render delay acceptable for an RTS whose owner target includes 8 humans? Play-test the order-to-motion latency on the ARM host with real RTT.
2. Should a released aim's history persist at all past the presentation buffer (Issue 9)?
3. How often does the "nearest aircraft" change in real sorties and drone swarms? Issue 2 is mechanism-confirmed only.
4. In both trees, the 11-man `earlymodern-infantry` line deals 7,200 per volley (0.65 % of 1,100,000) to an equal line at 3 and 6 tiles. Neither side loses a soldier in 50 s. Is that the intended Early Modern rifle pace? It is outside this delta; flagged for the balance owner.
5. Should `skirmish/ranged-review.html` ship in the production skirmish build? `vite.skirmish.config.ts` adds it as a build input alongside the other lab pages.
