# 15 — AI battle-level tactical competence against a human

Round 2 reviewer, area **AI tactics**. Reviewed the working tree on 2026-10-16 between about 01:00 and 02:40. The tree was being edited during the review: `Expansion.ts` and `Simulation.ts` line numbers moved twice, and for about ten minutes `Catalog.ts` threw `Missing unlock earlymodern-carrier` at import. Every path:line below was re-checked with `grep -n` at the end of the session.

**CONFIRMED** means the behaviour was executed in a scratch scenario with the real `Skirmish` class, or traced end to end in code. **SUSPECT** means the mechanism was read but its effect was not isolated.

## Scope read

- `src/skirmish/domain/AiArmyPlanner.ts` 1-560 (all of it: select/rally/assemble/advance/engage/flank/breach/recover/replenish/refit).
- `src/skirmish/domain/Armies.ts` 1-1221 (all of it). The tactical parts are `syncSlots` 285-314, `closeGap` 315-331, `setTerrainPosition` 332-338, `tacticalStep` 339-378, `observeOrder` 525-546, `order` 605-711, `column` 743-810, `deploy` 869-905, `step` 1099-1205.
- `src/skirmish/domain/EngagementManager.ts` 1-972 (all of it): detection, posture, assignment scoring, wings.
- `src/skirmish/domain/BattleLineLayout.ts` 1-108; `src/skirmish/content/TacticalRules.ts` 1-65; `src/skirmish/domain/TacticalEstimate.ts`; `AiCombatPower.ts`; `FormationTactics.ts`; `SkirmishStance.ts` 1-328; `CavalryAssault.ts` 1-138 (new); `PlayerAttackContinuation.ts`.
- `src/skirmish/domain/HillPositioning.ts` 1-384, `TrenchPositioning.ts` 1-147, `TacticalFeatureIndex.ts` 1-80 and `scorePosition` 308-352, `ElevationAdvantage.ts` 12-27 and 78-90.
- `src/skirmish/domain/StructureAttackPreparation.ts` 1-120. This is the geometry admission for `attack-structure`, so I only skimmed it.
- `CohortAdmission.ts` (caps and deadlines only); `AiRecovery.ts` 100-299; `AiDefenseDirector.ts` 300-410 (staffing); `AiDefenseQuote.ts` 1-40; `AiInvasionResponse.ts` 186-221.
- `src/skirmish/content/AiDoctrines.ts` (all), `AiPersonalities.ts` 1-80, `Armies.ts` (content caps).
- `src/skirmish/Simulation.ts`:
  - `thinkAi` 4892-5260, mainly the per-squad intercept/raid/march loop 5010-5200;
  - `applyArmyCommand` 1250-1253; `hostile` 1960; `armyTargetAllowed` 3801;
  - the tick order 3424-3460; the move-to-attack conversion 4165-4180;
  - `domainRoutes` 644-647.
- `src/skirmish/domain/Expansion.ts`:
  - the `charge` command 749-830, including the bonus-arming branch at 813;
  - `thinkCapabilities` 1618-1745, including the siege loop 1712-1741.
- `src/skirmish/domain/Battle.ts` 925-975: the ordinary cavalry assault and the bonus commit.
- `src/skirmish/domain/CommandPrecedence.ts` (all).
- Tests read: `HillMission.test.ts` and `fixtures/HillDefence.ts`, `Phase8BattleLines.test.ts` (fixture), `AiOperations.test.ts` (fixture), `PreModernBalance.test.ts` (harness), `AiSiegeCommitment.test.ts` (fixture), `SiegeBehavior.test.ts` 40-122.
- Ran `HillMission`, `AiTrenchOccupation`, `Phase8BattleLines` and `Phase7Tactics` with `vite.skirmish.config.ts`: 4 files, 37 tests, all pass.
- Context read: `03-combat.md` (I2, I6, I11, I13, I16, gameplay proposals), `04-ai.md` (sections 1-90), and the ledger `08-latent-bugs.md` (M2, M3, and the refuted table).

## How it works today

There are four layers of tactical control. All of them issue ordinary commands.

1. **Loose AI squads**: `Skirmish.thinkAi`, `Simulation.ts:4892`. This covers tribes, nation squads that no lease or army owns, and the leftovers of every disbanded army.
   - Every 0.75 s per squad (`(tick+id)%6===1`), the squad scans 20 tiles (`:5051`). It scores hostile targets by `distance² + approachLoad·(2 tiles)²` (`:5077`) and sends an `attack` order when the target is inside `interceptRange` (20 tiles, `:5125`).
   - A squad replenishes only when it stands on its own land, is below `replenishBelow` (65 %), **and** no enemy is within 12 tiles (`:5110-5118`).
   - There is no counter matching, no charge, no focus fire, and no retreat under threat.
   - `AiInvasionResponse` moves leased defenders as a mob with `move` orders (`AiInvasionResponse.ts:205-211`).
2. **Operational missions (nations only)**: `AiArmyPlanner.stepMission`.
   - The planner creates a real Army through `create-army` and switches its `autoTactics` off (`:280`). It then marches to `targetTile` (`advance`).
   - When an enemy is within **12 tiles** of the army (`:457`), it does the following once:
     - sets posture (`line`, `skirmish` or `defend`, `:468`);
     - sets the doctrine's wing preference;
     - sends `deploy` at the army centre, facing the enemy centroid;
     - picks an advisory shape per member (`preferredShape`, 10 s cooldown, `:474-478`);
     - switches to `engage` and **resets `plan.since`** (`:473`).
   - While in `engage`, the planner does nothing tactical. With no enemy inside 12 tiles it only retargets *conquest buildings*, or the last enemy squad when `finishing` (`:480-497`).
   - **After `commitmentTicks` (60 s balanced, 80 s conqueror) in advance/engage it regroups home** unless the operation is `sustaining` (`:498-504`). It also recovers when troops fall below 55 % of `initialTroops` (`:356`).
   - **Breach** is entered only when `army.state==="blocked"` (`:448`).
   - **Hill** (`HillPositioning`) and **trench** (`TrenchPositioning`) sub-missions run in advance/engage (`:369-372`).
   - The `flank` phase exists in the type, the validator and a handler (`:400-404`), but **nothing ever assigns it**.
3. **L3 engagement planning (all armies, human and AI)**: `EngagementManager`.
   - **Detection.** 32 armies are detected per tick. An army joins an engagement when an enemy is within `joinTiles` 14 + army radius, up to 12 armies per engagement.
   - **Per-squad assignment** (`planQuantum`) covers frontline and ranged slots only, with at most 12 candidate comparisons each:
     - frontline score = contact frontage + anti-mounted bonus − lateral offset, with at most 2 attackers per target;
     - ranged score = damage ÷ remaining health, which focuses fire on the weakest.
   - **Posture.** `engagementEstimate` decides the posture: advance at ≥1.15, and *withdraw (AI only)* after two consecutive plans below 0.55 or when the army collapses below 55 %.
   - **Reserves.** A weak point (advantage < 0.7) pulls the nearest reserve.
   - **Wings** (`planWings`, `:757-916`), one per mounted side:
     - `hold → route` to a flank candidate tile once half the frontline is fighting, or when the enemy has no cavalry;
     - `route → strike` when the rider reaches the via-point while the target does not face it, or when the target is within 6 tiles and in column or reloading;
     - the target is the **extreme-lateral non-mounted enemy** (`:819-826`);
     - the wing gives up below 60 % health, or when enemy cavalry nearby outweighs it (`:794`).
4. **Army execution**: `Armies.step` and `tacticalStep`.
   - **Battle line.** `layoutArmyBattleLine` builds the bands:
     - frontline band;
     - ranged band `LINES.bandGap` = 1 tile behind it;
     - support band;
     - reserve band 2 tiles further back;
     - mounted squads on the wings, `wingGap` 1.5 tiles outside the front.
     - The AI keeps `reservePercent × 0.5` of its frontline in reserve (`Armies.ts:295`); for `balanced` that is 1 of 4.
   - **Leashes.** `tacticalStep` applies the L3 assignment inside per-role leashes: frontline 3 tiles, ranged 1 tile, mounted 0, and 14 for a striking wing.
   - **Charges.** A striking wing member is issued a `charge` (`:371-372`). **This is the only call site in the codebase where the AI charges.**
   - **Withdraw.** A `withdraw` plan regroups the whole army to `player.base` (`:342-347`). The frontline keeps its attack orders for `rearWithdrawalTicks` (1 s).
   - **Advance creep.** An `advance` plan moves the anchor 1 tile every `refreshTicks` (3 s), but only if *no member is fighting* (`:1148`).
   - **Finishing.** When no enemy is within `joinTiles` and every member stands on its slot, a non-auto (AI) army `finish()`es and holds (`:1158-1159`).
   - **Rotation.** `closeGap` swaps a frontline squad below 25 % strength with a reserve (`:315-331`).
5. **Advisory controllers.**
   - `SkirmishStance`: reload-time step-backs for reloadable foot ranged. It is enabled for army posture `skirmish`, but the AI picks that posture only with the `fire-retreat` doctrine or ≥50 % ranged against ≥60 % melee. It processes 8 squads per tick globally.
   - `CavalryAssault` (new): an ordinary cavalry attack now creates a `cavalryEngagement.assault` (`Battle.ts:939-950`) without a bonus.
     - A `charge` command re-arms `chargeMultiplier`× damage for `bonusDurationTicks`.
     - For pre-Modern cavalry that means ×2 for 6 s every 20 s (`Expansion.ts:813-818`, `CavalryAssault.ts:108-123`).
     - This turns 03-combat I6 (one strike per 10.8 s) into a non-issue for attack-ordered soldier cavalry. Rank waves remain only for `cavalryMode:"ranks"`. I did not re-measure I6.
6. **Siege.**
   - Inside an army: the planner's `breach` phase (`:404-445`) scans 9×9 tiles for a wall or tower, routes siege and escort to a certified firing tile, and sends `attack-structure`.
   - Outside an army: `Expansion.thinkCapabilities` sends `attack-structure` to **every** own siege-bonus squad every 3 s, toward the nearest hostile building on the whole map (`Expansion.ts:1712-1741`).

## Experiments

Harness: `C:/Users/Damien/AppData/Local/Temp/claude/C--Users-Damien-Documents-GitHub-AgeOfFronts-AgeOfFronts/be77198a-17e0-4a3b-a12d-354ee04baaf8/scratchpad/ai-tactics/` (`harness.ts`, `matrix.ts`, `trace.ts`, `wingprobe.ts`, `chargeprobe.ts`, `siege.ts`, `siegesteal.ts`, `commit.ts`, `whohits.ts`, `hillmath.ts`). Setup:

- **Map and game.** A real `Skirmish` on a flat 128×96 map with `deferredPlanning` and `aiEconomy` on and `runAi:false`, so economy noise is off. All technologies are researched.
- **Forces.** Each side has 9 squads at full strength: 4 frontline, 3 ranged and 2 charge-capable cavalry of the age. Napoleonic uses `earlymodern-heavycavalry`. The sides start 40 tiles apart.
- **The AI side.** It is a real Army with `autoTactics` off and an injected `land-army` mission (purpose `combat`, phase `advance`, leased like the planner does). `stepMission` is driven at its own `nextThink` cadence.
  - I call `stepMission` directly rather than `step()`: with `aiWarPolicy` off, `step()` would re-derive a theatre that reserves 25 % of the roster. Everything else is the production path.
- **Human policies.**
  - `naive`: every idle squad attacks the nearest enemy.
  - `competent`: a scripted policy. Cavalry charge the nearest enemy ranged squad and re-arm charges when ready; ranged squads focus-fire the weakest enemy within 10 tiles; frontline squads engage enemy non-ranged units; squads below 30 % pull back.
  - `idle`: holds and fights only when touched.
  - `autoarmy`: a human Army with auto tactics and one move order.
- **Seating and decision.** Each pairing is played from both seats with 2-3 seeds and ±3-tile vertical jitter. In naive-vs-naive this removed a strong seat bias (seat A won 0.46/0.14 in one seating). A side is decided when it falls below 15 % of its starting health.

**Caveat:** my `competent` script is *not* better than `naive`; it lost 1/5, 1/3, 0/4, 1/3 and 0/4 to naive. Read the `naive` rows as "a trivial human policy". The `competent` rows are an extra opponent, not an upper bound.

### Win/loss of the AI army (W/L/D from the AI's side; remaining strength of AI / opponent)

| Age | AI vs naive | AI vs competent | AI vs idle (passive defender) | AI vs AI | Human auto-army vs naive |
|---|---|---|---|---|---|
| Bronze | 4/2/0 (0.36 / 0.21) | 2/4/0 | (0.76 / 0.96, one run) | 0/0/6, **no contact** | 0/4 (0.14 / 0.36) |
| Classical | 1/3/0 (0.17 / 0.23) | 1/3/0 | 0/3/1 (0.73 / 0.91) | 0/0/4 (0.82 / 0.82) | — |
| Early Medieval | 0/4/0 (0.15 / 0.47) | 0/4/0 | 4/0/0 but only 50 % killed | 0/0/4 (0.95 / 0.95) | 0/4 (0.15 / 0.59) |
| Late Medieval | 0/4/0 (0.14 / 0.34) | 0/3/1 | 1/1/2 (0.74 / 0.67) | 1/1/2 | 0/4 (0.14 / 0.51) |
| Napoleonic | 2/2/0 (0.40 / 0.32) | 4/0/0 | 2/0/2, 30 % killed | 2/2/0, decided at 132 s | 0/4 (0.14 / 0.65) |

### Behaviour counters (mean per battle)

- **Ranged losses.** The army side's ranged suffer much more than the opponent's:
  - AI vs naive: AI 0.47-0.99 vs naive 0.12-0.40;
  - human auto-army vs naive: 0.73-1.0 vs 0.01-0.07.
- **Ranged caught in melee.** Ticks in which an army ranged squad is in melee contact: 102-540 for the AI, against 12-106 for the naive opponent.
- **AI cavalry charges:**
  - `charge` commands: 0-2 per battle;
  - charge-bonus activations (`assault.bonusStartTick`): **0 in every battle**, about 120 battles in all.
- **AI withdraw posture:** 8-226 ticks per battle.
- **Damaged-frontline swaps:** 1-16 per battle (`closeGap` works).

### Counterfactuals (Bronze, Early Medieval and Late Medieval, AI vs naive)

- With withdraw disabled (`planFor` patched): 3/1, 0/4, 0/4.
- With `autoTactics` on for the AI army: 3/1, 0/4, 0/4.

So neither withdraw nor auto tactics explains the losses.

### Who hits the AI's ranged (`whohits.ts`)

- First contact on AI ranged comes at **6.5-8 s, while the column is still assembling or marching**. Our own frontline is 0-2.4 tiles away at that moment.
- By attacker role:
  - Early Medieval: enemy cavalry 189 ticks, enemy frontline 128;
  - Late Medieval (AI): enemy cavalry 132 ticks, enemy frontline 279.
- AI Early Medieval slots: frontline laterals −2/0/+2; the reserve 8 tiles back; ranged only 2.3-4 tiles behind the front; mounted squads at ±5 tiles.

## Strengths

- One authority. AI tactics go through the same `army-order`/`charge`/`formation` commands as a human (`applyArmyCommand`, `Simulation.ts:1250`). There is no AI-only damage path.
- The L3 planner is bounded and resumable: ≤12 contact comparisons per squad, a 48-unit budget per tick, revisioned jobs, and a cancel path on wing routes. It survived every scenario without a throw.
- Ranged focus-fire on the lowest remaining health (`EngagementManager.ts:698-711`) and anti-mounted frontline matching are sensible defaults.
- Frontline rotation (`closeGap`) and the reserve commit at the weakest slot do fire (1-16 swaps per battle).
- Hill and trench sub-missions are well fenced:
  - route quotes are released;
  - rear access is checked;
  - minimum commit of 30 s, re-evaluation every 5 s;
  - restore is validated;
  - the defensive hill test passes, and on the fixture the AI holds the crest with two screens.
- Wings cancel themselves when the enemy cavalry outweighs them, or below 60 % health, so cavalry do come home.

## Issues

### T1. The army battle line loses to "every squad attacks the nearest enemy": ranged are overrun in the meeting engagement
- `Armies.ts:743-810` (`column`): the march column is two files wide in arrival order, with no role order, so ranged squads march interleaved with the frontline.
- `AiArmyPlanner.ts:457-473`: deploy is triggered only at 12 tiles, on a 2 s planner cadence.
- `BattleLineLayout.ts:34-36`: the ranged band sits `LINES.bandGap` = 1 tile behind the front band.
- `TacticalRules.ts:49`: `rangedLeash` 1, `frontLeash` 3, `maxPerTarget` 2.
- `AiArmyPlanner.ts:468`: skirmish posture is used only at ≥50 % ranged.
- **Severity: high. Outcome CONFIRMED by execution; root-cause split SUSPECT.**
- **Mechanism.**
  - The army meets the enemy while still in column. Naive cavalry (speed 110-130 %) closes 12 tiles in about 6 s.
  - The deploy order reshuffles slots under contact.
  - Ranged squads end up 0-2.4 tiles from their own frontline with nothing screening their flanks: the wings leave to route, and the reserve is 8 tiles back.
  - Ranged hold a 1-tile leash and never step back unless the posture is `skirmish`.
- **Consequence.**
  - AI armies lose 0/4 to the trivial policy in Early and Late Medieval, 1/3 in Classical and 2/2 in Napoleonic. Humans who use their own auto armies lose 0/16.
  - Battle lines are worse than no coordination. That defeats the purpose of the army layer and of the AI's army planner.
- **Repro.** `matrix.ts EarlyMedieval ai:naive 150 2`; `whohits.ts EarlyMedieval ai:naive`.

### T2. Equal AI armies (or AI vs a stationary human) stand off and go home
- `AiArmyPlanner.ts:457` (12-tile deploy), `:480-497`: with no enemy inside 12 tiles in `engage`, only a conquest building or the last squad is targeted. **There is no fallback to `plan.targetTile` or to the enemy army.**
- `Armies.ts:1148`: advance creep requires `estimate ≥ 1.15` (`ENGAGEMENT.advanceAbove`).
- `Armies.ts:1158-1159`: a non-auto army with no enemy within 14 tiles `finish()`es into hold.
- **Severity: high. Confidence: CONFIRMED by execution.**
- **Mechanism.**
  - Both armies deploy where they first see each other, 16-18 tiles apart.
  - Neither has an estimate ≥ 1.15, so neither creeps forward.
  - Both armies leave each other's `joinTiles`, so both `finish()`.
  - The planner sees no enemy inside 12 tiles and no buildings (or keeps re-ordering a move to a city it cannot take).
  - At `since + 60 s` both regroup home.
- **Consequence.**
  - AI vs AI gave 14 draws out of 16 in Bronze through Early Medieval, with 0-18 % losses.
  - Against a human who simply holds a line, the AI never commits its infantry: the idle defender lost only 9-50 % in 150 s.
  - In a 52-faction match this means AI wars produce marching, not battles.
- **Repro.** `trace.ts ai:ai BronzeAge 40` shows deploy at 8 s, hold from 16 s, recover at 60 s.

### T3. Any fighting member freezes the whole line's advance
- `Armies.ts:1148` (`&&!available.some(s=>s.fighting)`).
- **Severity: high. Confidence: CONFIRMED (`wingprobe.ts`).**
- **Mechanism.** Against a passive Late Medieval defender, the AI wing cavalry engaged at 16 s. The infantry line then stayed about 10 tiles back for 50 s, although the posture was `advance` for most of that time. The ranged squads (range 9) never got into range.
- **Consequence.** Cavalry fight alone and are worn down, while the infantry watches.
- **Fix.** Gate the creep on *frontline* members fighting, not on any member.

### T4. The commitment timer abandons winning fights mid-contact
- `AiArmyPlanner.ts:498-504`, with `plan.since` reset at deploy (`:473`) and `AiDoctrines.ts:20` (`commitmentTicks` 60 s).
- **Severity: high. Confidence: CONFIRMED (`commit.ts`).**
- **Mechanism.** The regroup is issued regardless of contact or the estimate:
  - Napoleonic: the AI was at 0.92 against the defender's 0.42, with 2 squads fighting, and regrouped at 68 s;
  - Late Medieval and Bronze: the same, at 68 s.
- After the regroup, the frontline turns after 1 s (`LINES.rearWithdrawalTicks`) and exposes its rear arc (×1.5 melee exposure).
- **Consequence.** A human only has to survive 60 s. The AI throws away won battles and then pays the rally/assemble cost again.

### T5. The AI never earns the cavalry charge bonus, and loose AI squads never charge at all
- `Armies.ts:356` (an engaged rider is skipped), `Armies.ts:371-372` (the only AI charge site), `EngagementManager.ts:843-852` (strike conditions).
- `Expansion.ts:813-818` (a charge while engaged arms the ×2 bonus), `Battle.ts:939-950` (an ordinary assault carries no bonus).
- Content: `chargeMultiplier` 2, `bonusDurationTicks` 48, `cooldownTicks` 160, `maximumDistance` 10 tiles for all pre-Modern charge cavalry.
- **Severity: high (balance against humans). Confidence: CONFIRMED (`chargeprobe.ts`/`wingprobe.ts`):** 0 charge attempts in the probe runs and 0 bonus activations in about 120 battles.
- **Mechanism.**
  - Wings route around the enemy and bump into contact before reaching `strike`. Battle then turns them into an ordinary assault.
  - In `strike` they are already `engaged`, and `tacticalStep` `continue`s past them.
  - `thinkAi`, invasion response and tribes have no charge path.
  - Napoleonic infantry's bayonet charge (`charge`, `maximumDistance` 6) is never used, because the wing logic is mounted-only.
- **Consequence.**
  - A human re-arming every 20 s does double damage a third of the time, plus impact. The AI's cavalry runs at base damage.
  - This asymmetry grows if 03-combat recommendation 3 (cavalry cadence) is adopted.

### T6. Siege breach is unreachable under deferred planning (production), so a walled city is immune to the AI army
- `AiArmyPlanner.ts:448`: breach only when `army.state==="blocked"`.
- `Armies.ts:944/1077/1095`: `blocked` is set only on formation-space or member-route failure.
- `Armies.ts:219-226`: `finishLeader` on an unreachable leader route changes no army state.
- `Armies.ts:638-643`: with `domainRoutes`, every move is deferred and returns `null`.
- `AiPolicies.ts:5`: live matches use `deferredPlanning: true`.
- **Severity: high. Confidence: CONFIRMED (`siege.ts`).**
- **Mechanism.** The test was a 16-tower, 19-wall ring around a city, attacked by an AI army with 2 `bronzeage-siege`:
  - the planner sent 31 `army-order:move` commands in 60 s;
  - all of them failed silently and the army never left x=42;
  - phase stayed `advance`, then `recover` at 60 s;
  - every wall kept full health.
- **Consequence.**
  - Walls plus towers (which have no weapon pre-Modern, 03-combat I11) make a human city immune to AI armies.
  - Each failed order also costs a leader admission (`Armies.ts:640` cap 128) and a route request every 2 s.

### T7. `thinkCapabilities` strips siege engines out of AI armies every 3 s
- `Expansion.ts:1712-1741` sends `attack-structure` to every siege-bonus squad. It does not exclude army members or leased squads.
- `Armies.ts:525-533`: `observeOrder` detaches a subset that receives a direct order.
- **Severity: high (siege doctrine / engineer). Confidence: CONFIRMED (`siegesteal.ts`):** the army went from 8 members to 6, the siege squads were detached, and their leases stayed with the mission.
- **Mechanism.**
  - The nearest hostile building on the whole map becomes the target, unescorted.
  - The mission still lists the squads, and their leases still name it, so `stepMission` neither notices nor resizes.
  - The breach shooters (`plan.breach.shooters`) are those same detached squads.
  - The `engineer` doctrine (`AiDoctrines.ts:88-92`, preferred roles siege → artillery first) is hit hardest.
- **Perf note.** The loop filters and sorts the full `world.buildings` per siege squad per nation every 3 s. That is O(S_siege · B log B); at 430 buildings it is small but not free.

### T8. Offensive hill use is gated by an unreachable threshold
- `HillPositioning.ts:324` (`elevated.advantage < current.advantage * 1.1`), `ElevationAdvantage.ts:12-20, 78-86` (+≤10 % ranged per-soldier damage only).
- **Severity: medium. Confidence: CONFIRMED (`hillmath.ts`).**
- **Measured advantage gain from shifting the whole army onto a hill:**

  | Height gain | Pre-Napoleonic, mixed 9-squad army | Pre-Napoleonic, ranged-heavy | Napoleonic |
  |---|---|---|---|
  | 15 m | — | — | ×1.029 |
  | 40 m | ×1.029-1.045 | ×1.060-1.074 | ×1.111 |

- **Consequence.** Combat-purpose missions never take hills before Napoleonic. Defence missions have no gate and work, as the tests show. The estimate also ignores the +10 % range bonus.

### T9. The estimate that drives every tactical decision omits what decides fights
- `TacticalEstimate.ts:11-26` (`cohortDps`: front arc only, no charge bonus, no kiting, no contact limit beyond a frontage proxy, no morale), used by:
  - posture, `EngagementManager.ts:570-598`;
  - weakest slot, `:728-737`;
  - hill gate (T8);
  - wing safety;
  - `AiOperations` targeting.
- **Severity: medium. Confidence: CONFIRMED by read; calibration error not measured.**
- **Consequence.**
  - `advance` (≥1.15) and `withdraw` (<0.55) fire on numbers that do not track outcomes. In AI vs naive, the AI loses even when its posture says `advance`.
  - Every change proposed in 03-combat (bounded cleave, cavalry cadence, morale) must be mirrored here, or AI posture drifts further.

### T10. Withdrawal is all-or-nothing and goes to the capital
- `Armies.ts:342-347` (regroup to `player.base`), `:659-664` (frontline holds 1 s), `EngagementManager.ts:587`.
- **Severity: medium. Confidence: CONFIRMED by read; the effect is small in the measurements** (disabling withdraw changed W/L by at most one game in 4).
- **Mechanism.**
  - There is no rear guard and no bound on the fall-back distance.
  - The planner stays in `engage`, and the withdraw is ordered by L3, so the two layers disagree. With no enemy within 12 tiles, the planner's conquest branch (`AiArmyPlanner.ts:480-497`) can send the army straight back.
  - The planner's own 55 % rule (`:356`) duplicates L3's collapse rule.

### T11. The loose-squad AI (tribes, leftovers, invasion response) has no battle tactics
- `Simulation.ts:5051-5131` (nearest-by-distance intercept; replenish only with no threat inside 12 tiles), `AiInvasionResponse.ts:205-211` (mob `move` orders).
- **Severity: medium. Confidence: CONFIRMED by read.**
- **Consequence.**
  - The 30 tribes are pure attack-nearest blobs, with no counter selection and no charges.
  - Damaged squads fight to death while any enemy is within 12 tiles.
  - Note: per T1 this is currently *better* than an army line.

### T12. Dead `flank` phase; doctrine `flank-left/right` is a label
- `AiArmyPlanner.ts:400-404` cannot be reached; no `plan.phase='flank'` assignment exists.
- `AiArmyPlanner.ts:470` only sets `wingPreference`, which merely orders the wing loop in `EngagementManager.ts:759`.
- **Severity: low-medium. Confidence: CONFIRMED by grep.**
- **Consequence.** The `rider` personality's "staged mounted wings" contract is not implemented beyond what every army already does.

### T13. Wing target choice ignores value
- `EngagementManager.ts:819-826`: the wing target is the extreme-lateral non-mounted enemy, which is not necessarily ranged, siege or artillery.
- The strike gate (`:843-852`) requires reaching the via-point unopposed, or a column/reloading target within 6 tiles.
- **Severity: medium. Confidence: CONFIRMED by read.**
- **Consequence.** A human's skirmishers and guns are not hunted, and wings frequently ride into the enemy flank infantry (see T5).

### T14. Shapes are chosen once, at deploy
- `AiArmyPlanner.ts:474-478` runs only on the advance→engage transition.
- **Severity: low-medium. Confidence: CONFIRMED by read.**
- **Consequence.** Squares are never formed when enemy cavalry appears after deployment (`preferredShape` would choose them). Shield walls are never dropped when the archers die.

### T15. `SkirmishStance` does not scale to the target
- `TacticalRules.ts:52` (`BUDGETS.skirmish` 8), `SkirmishStance.ts:169-183`: every tick it walks every army's members to register states, then evaluates 8 per tick globally.
- **Severity: low-medium (it matters only once the AI uses skirmish more, see R3). Confidence: SUSPECT.**
- **Consequence.** With 300 ranged squads in skirmish posture, each one is visited about every 4.7 s at 8 Hz. Reload windows are 2.5-12 s, so most step-backs are missed.

### T16. Trench sub-mission details
- `TrenchPositioning.ts:128-138`: every occupant goes to the *first tile* of the first segment that fits.
- `:73-79`: on a lost trench, the phase is set to `recover` with no regroup order and no `since` update.
- Trench positioning is Modern-only and defence-purpose-only.
- **Severity: low. Confidence: CONFIRMED by read.**

### T17. Interactions with confirmed ledger issues
- **M2** (`AiArmyPlanner.ts:309-315`, still present).
  - Tactically: when one army is annihilated, `Armies.detach` auto-disbands it. `!army` then releases every sibling army of the nation, **including armies in contact**.
  - Their members become loose squads handled by `thinkAi` attack-nearest, and their L3 plans vanish (`EngagementManager.step` drops plans of dead armies).
  - With T1 this can even *improve* their fighting, which hides the bug in playtests.
- **M3** (handover). Orphaned human armies keep the human's `autoTactics` setting:
  - with auto tactics on, they fight through L3 like the AI's own armies (T1, T2 apply);
  - with auto tactics off, they `finish()` and hold forever.

### T18. Engage keeps re-sending the same move
- `AiArmyPlanner.ts:492-495`: when the objective is unchanged and every member holds, the planner re-orders the move every 2 s. It sent 31 in the siege scenario.
- Every `Armies.order` cancels the army's planning and queues a new leader admission (`Armies.ts:638-643`; cap 128 shared with humans, `CohortAdmission.ts:100` cap 128).
- **Severity: low-medium (perf and route churn at 52 factions). Confidence: CONFIRMED.**

## Recommendations (prioritised)

1. **Fix the march order and the meeting engagement** (T1). About 2 days.
   - In `Armies.column` (`Armies.ts:743-810`), sort column members by slot role on the first build: frontline, then mounted, ranged, support, reserve. Keep id as the tiebreak.
   - In `AiArmyPlanner.ts:457`, deploy when time-to-contact ≤ 10 s, not at a fixed 12 tiles. Use the enemy's max speed × 10 s, capped at 20 tiles, with the nearest-enemy scan already there.
   - Widen `LINES.bandGap` for ranged from 256 to 2·FIXED. This is a data change; `HillMission` asserts ranged depth 0 only for crest layouts, so it is unaffected.
   - Give the AI the `skirmish` posture whenever ranged ≥ 25 % and the enemy has melee (`AiArmyPlanner.ts:468`).
   - Add a "ranged evade" rule in `tacticalStep`: a ranged member whose slot has an enemy melee body within 2 tiles, and no friendly frontline between them, steps back 3 tiles along −facing, through the same `setArmyMove`.
   - **Test.** A new `tests/skirmish/AiBattleCompetence.test.ts` using this harness (Early Medieval, 9v9, both seats). Assert:
     - AI vs attack-nearest wins ≥ 2/4;
     - AI ranged melee-ticks ≤ the opponent's × 2.
   - **Trade-off.** More deployment time before contact. Mitigate by deploying in place, which `deploy` already does.
2. **Make commitment contact-aware and end standoffs** (T2, T3, T4). About 1 day.
   - Replace `world.tick - plan.since >= commitmentTicks` with `world.tick - lastContact >= commitmentTicks`, where `lastContact` is the latest `lastCombatTick` of any member. Keep a hard cap at 3× `commitmentTicks`.
   - In `engage` with no enemy within 12 tiles and no building objective, re-order `move` to `plan.targetTile`, or to the centroid of the nearest hostile army within 24 tiles.
   - Change `Armies.ts:1148` to require no *frontline* member fighting.
   - Lower `advanceAbove` for `conqueror`/`rider` to 1.0 through a doctrine field. This is a data change.
   - **Tests.**
     - The AI-vs-AI duel reaches contact within 30 s and decides within 150 s.
     - The AI vs an idle defender kills ≥ 80 % in 150 s.
     - The commitment test: the AI does not regroup while it is fighting and ahead.
   - **Trade-off.** More contact means more combat CPU. The ARM budget is the constraint; see 03-combat I14 and 06-simulation-perf.
3. **Charges** (T5). About 1 day.
   - In `tacticalStep`, drop the `continue` at `Armies.ts:356` when the rider's `chargeReadyTick ≤ tick` and its target is not `square` or an anti-cavalry front. Issue `charge` with `targetId` = the engaged target; `Expansion.ts:813` already turns that into a bonus.
   - In wing `route`, issue the charge as soon as the strike target is within `charge.maximumDistance` and not braced.
   - In `thinkAi` (`Simulation.ts:5125`), use `charge` instead of `attack` for charge-capable squads within `maximumDistance`.
   - Let napoleonic-infantry charge in strike or close contact.
   - **Test.** In a 60 s Late Medieval duel, the AI bonus activation count is > 0, and win rate vs naive improves.
   - **Balance.** This interacts with 03-combat recommendation 3. Do this first, then retune.
4. **Siege** (T6, T7). About 1.5 days.
   - **Hours:** filter `Expansion.ts:1712-1716` by `!this.armies.armyOf(s.id) && !this.economy.assets.held(\`squad:${s.id}\`)`.
   - **About 1 day:** on an unreachable leader route (`Armies.completedRoute` → `finishLeader(...,"rejected")`), set `army.state="blocked"` and `army.reason`, so the existing breach phase engages. Alternatively, have the planner quote the route (`economy.routes`) before `move` and enter `breach` at the last reachable tile.
   - **Test.** A ring-walled city with an AI army that includes siege. Assert `phase==='breach'` within 30 s, wall damage within 90 s, and the siege squads stay army members.
5. **Hill gate** (T8). About 1 hour.
   - Use `≥ current × 1.03`, or drop the estimate gate for ranged-heavy armies and rely on `scorePosition`.
   - Add the range bonus into the estimate context.
   - **Test.** On the HillDefence map with a combat mission, the AI takes the hill.
6. **Calibrate the estimate** (T9). About 2 days.
   - Add a table test that runs the harness for each age and compares `engagementEstimate` with the simulated survivor ratio. Fit a per-channel correction: a charge-bonus term, and a front-arc vs flank term from `facingArc` sampling.
   - Re-run it whenever 03-combat items 1, 3 or morale land.
7. **M2 fix** (`releaseMission`, already in the ledger). Hours. It keeps sibling armies in contact intact (T17).
8. **Wing value targeting and shape refresh** (T13, T14). About half a day.
   - Score wing targets: ranged/siege/artillery ×2, flank or rear arc ×1.5, minus distance.
   - Re-run `preferredShape` for each member every `shapeCooldownTicks` while in `engage`.
9. **Bounded fighting withdrawal** (T10). About 1 day.
   - Regroup to a point 10 tiles back along −facing on own or neutral land, not to `player.base`.
   - Ranged and mounted leave first; the frontline holds 3 s.
   - Then hand the decision to L2: recover only if the estimate is still < 0.8.
10. **Cheap data levers that help now**, in `AiDoctrines.ts`/`TacticalRules.ts`, each about 1 hour:
    - `commitmentTicks` 60 → 120 s as a stop-gap for T4;
    - AI reserve `reservePercent*.5` → `reservePercent*.25` to put more frontline in the line (`Armies.ts:295`);
    - `skirmisher` already uses `fire-retreat`, so keep it;
    - `ENGAGEMENT.rangedLeash` 1 → 2.
    - Each of these needs the matrix re-run; none of them fixes T1/T2 alone.
11. **Scale items.** Remove the per-tick member walk in `SkirmishStance.step` by registering on `army-posture`/`army-members`. Raise `BUDGETS.skirmish` to 32. Dedupe the planner's identical re-moves (T18).

**Interaction with 03-combat proposals.**

- **Bounded cleave** helps a line against blobs, and may close part of T1. Re-run the matrix after it lands.
- **Cavalry cadence** is largely superseded for soldier cavalry by `ordinaryCavalryAssault`, but the charge-bonus asymmetry (T5) remains and grows.
- **Morale and rout** would make the estimate's withdraw/advance meaningful. The AI then needs:
  - (a) a morale term in `cohortDps`;
  - (b) wing targeting of low-morale bodies;
  - (c) a check that rout-forced moves do not count as "member fighting" in `Armies.ts:1148`.
- **Attrition in enemy territory** strengthens the case for contact-based commitment (R2) over a fixed timer.

## Open questions

1. Is the planner meant to own the battle after deploy (L3 only), or should L2 re-deploy when the engagement drifts (T2)? The comment at `AiArmyPlanner.ts:471` says L3 owns it, but L3 has no "close the distance" behaviour for estimates < 1.15.
2. Should human auto-armies share the AI's L3 (they do), given that they lose 0/16 to attack-nearest? If players are expected to use auto tactics, T1 is a player-facing bug and not only an AI one.
3. Is `commitmentTicks` meant as a raid timer (hit and leave) or a battle timer? The doctrine texts ("measured raids") suggest raids, but missions are also used for conquest.
4. Should towers get a weapon before Modern (03-combat I11)? It changes how urgent T6 is.
5. My `competent` script was weaker than `naive`. Is there a reference human replay (DiagnosticReplay) that could be turned into a scripted opponent for a real "competent human" benchmark?
6. In the siege scenario the AI army sat for 40 s *on top of* an enemy city tile without capture (T2 trace, before buildings were removed). That is outside my scope (capture rules). Worth a check by whoever owns `capture()` (`Simulation.ts:4670`).
