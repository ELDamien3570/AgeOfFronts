# 00 — Executive summary (Age of Fronts review, rounds 1–3, 2026-10-15/16)

Read-only review of branch `1.5.7-10hz-prototype` at **HEAD `0d1783ce`** ("pre-ultra", 2026-10-16 05:23) plus the **uncommitted ranged-preparation delta** in the working tree (8 Hz). No source file was changed. HEAD `0d1783ce` already contains the tree that rounds 1 and 2 reviewed as "uncommitted" [21:38-63].

**Precedence.** The verified ledgers are authoritative: [08-latent-bugs.md](08-latent-bugs.md) (round 1, IDs H/M/L/P) and [08e-round2-ledger.md](08e-round2-ledger.md) (round 2, IDs R2-*). Round-3 verified findings have no ledger ID yet; they are cited as `R3-<area> (<short title>)` and listed under "Round 3 additions". Later notes supersede earlier ones where they disagree: repository state, HEAD test results and line numbers come from 21; desktop tick times, the idle-tick attribution and the heap verdict come from 22 (which re-bases 16's tick times); cavalry from 09; pop-up AI cost from R2-P17; bandwidth and command-queue numbers from 16. Nothing listed under "Refuted, do not chase" is used below as a problem or a fix.

**Citation conventions.**
- `H3`, `R2-P6` …: ledger entry IDs. `R3-idle-tick (tribe walking)` etc.: round-3 findings, see "Round 3 additions".
- `[16:69]`: line 69 of `review-notes/16-*.md` (prefixes 01, 02, 02b, 03, 04, 04b, 05, 06, 07, 08a–08d, 09–22 are unique).
- `File.ts:line`: source under `src/skirmish/` unless a path is given.
- **Line numbers are pinned to HEAD `0d1783ce`.** "HEAD" always means `0d1783ce`; the round-2 comparison commit is named `e63a0730` explicitly. Working-tree (WT) lines = HEAD + a per-file shift [21:305-325]:
  - `Simulation.ts`: +1 for HEAD lines 25–1188, +9 for 1189–1703, +11 from 1704 (5,642 lines at HEAD, 5,653 WT).
  - `domain/Battle.ts`: +1 to 566, +17 for 567–940, +18 for 941–1063, +21 from 1064 (1,682 / 1,703 lines).
  - `client/troops/TroopActors.ts`: +6 at 271, +8 at 476–489, +16 at 819–896, +26 at 1226 (1,289 / 1,326 lines).
  - `domain/Expansion.ts` (1,989 lines), `MovementAdmission.ts`, `domain/AiArmyPlanner.ts`, `domain/Armies.ts`: identical in HEAD and WT (shift 0).
  - Code that exists only in the ranged delta (`domain/RangedPreparation.ts`, the cancel at `Simulation.ts:1705`, the anti-air path at `Battle.ts:831-845`) is marked **WT**.
  - Files outside 21's remap carry the ledgers' lines. The ledgers were written against the round-2 tree that HEAD `0d1783ce` now contains, so those lines are HEAD lines; spot checks against HEAD match (for example `AiArmyPlanner.ts:313, 448`, `AiOperations.ts:99, 402`, `AiNavalPlanner.ts:849`, `Renderer.ts:429`, `SnapshotDetails.ts:515`). The exception is `client/main.ts`, where some lines are off by up to about 5.
- "ARM ×2.4": a desktop number scaled by an assumed factor. None of these has been measured on the Oracle A1 host.
- "Quiet" desktop times are from 22 (thread CPU recorded, wall/CPU ≈ 1.3). Round-2 tick times from 16 were taken on an oversubscribed host (wall/CPU 1.8–2.0) and are about 2× too high [22:56-75].

## Verdict

The architecture is sound. HEAD `0d1783ce` is not green (15 assertion failures, inferred), and the uncommitted ranged delta adds three combat regressions. The 8-human, 52-faction game is not playable yet.

| Owner question | Answer | Evidence |
|---|---|---|
| Overall structure | Good bones: server-authoritative, one-way layering, AI acts only through the human command validator, 193 of 371 `tests/skirmish` test files build a real `Skirmish` (192 of 369 at HEAD; source count). The weak points are a 5,642-line `Simulation.ts`, hand-wired ownership notifications (the freeze class), a test-only second ruleset and a dead host stack. | [01:32], [01:54-80], [21:309-312] |
| Balance | Pre-modern combat is roughly closed. Late ages are not: hull weapons one-shot squads and vehicles are immune to pre-modern troops. Foreign trade mints gold for both sides, and stacking multiplies yield. One Napoleonic volley still wipes out most of a crowded front; the ranged delta only delays it by 4 ticks. | [05:194-255], [10:167-176], [21:135-159] |
| Network efficiency | Fine on the wire: 332–426 KB/s per client and 21–27 Mbit/s egress with 8 active humans. Weak on CPU and robustness: a 25–29 ms client clone per publication, a recovery loop that re-sends full baselines, and every rejoin pauses the match. The round-1 grade (C+ today, D at target) [02:5] still fits the CPU and robustness side. | [16:132-149], R2-P8, H1, P18 |
| Combat improvements | Fix the cavalry withdrawal trap and the id-order effects first. Fix the three ranged-preparation regressions (re-issued orders, army marches and anti-air cancel the aim) before that delta is committed. Then cap ranged and hull overkill, and give coasts and towers counterplay. Morale and rout come later. | R2-H3, R2-L1, L8, R3-ranged-delta (re-issue, army march, anti-air), [10:167], [20:166-184] |
| AI structure | The layers (strategy record, director pipeline, army planner, battle line) are the right shape. Battle tactics are the weakest layer: the army line loses to "every squad attacks the nearest enemy". Fix tactics before adding AI kinds. | [15:108-124], R2-H4, R2-M5, M2 |
| Nomads and pirates | Build nomads to the owner's PLAN.md, which supersedes round 1's design, then pirates with a dedicated planner. Both need a lifecycle bus, an atomic `addFaction` and a squad budget first. AI cost per pop-up is small; their squads are not: at the one measured rate, about 50 pop-up squads add 6–15 % to the tick. | [14:8-18], [14:477-534], R2-P17 |
| Readiness for 8 humans + 14 nations + 30 tribes | Not ready. A follower admission that reads a dead corridor lead crashes the match (R2-H1): seen at ticks 3,000–3,200 with 8 active humans (3.8–4.2 simulated minutes after they took control at tick 1,200) and at tick 7 in the minimal repro; it depends on admission state, not on elapsed time. One crafted packet ends any match (R2-H2). On a quiet desktop the idle-seat 52-faction tick is 82.9 ms mean / 147 ms p99 against the 125 ms budget: inside on mean and p95, over on p99, and about 199 ms on ARM (×2.4, 0.63× real time). The 8-active figure (198–206 ms in 16) is inflated about 2× and was not replayed. Humans are eliminated by minute 8–20, and there is no match end. | [16:7], [16:196], [22:102-105], [22:242-252], R3-idle-tick (inflation), [13:76-87], [13:115] |

**Order of work.** Stop the match-killers, with a containment design that never continues a half-ticked world. Fix the ranged-delta regressions before committing it, and get HEAD green. Fix routing contention under human load and cut the idle tick (tribe expansion walking first, with owner sign-off). Then the four playtest blockers from 13. After that come AI tactics, naval and air balance, and the client frame cost. Pop-up factions come last, after the lifecycle bus and the idle-tick plan.

## Structure

| Finding | Evidence |
|---|---|
| Layering holds: no `domain/`, `content/` or `client/` module imports `Simulation.ts` (except the lab). One value cycle exists (`AiNavalBombardment` ↔ `AiNavalPlanner`) and one upward import (`Simulation.ts:34` → `lobby/FactionPalette`; WT `:35`). | [01:24], [01:40], [09:347], [21:331] |
| Two god objects: `Simulation.ts` has 5,642 lines at HEAD (5,653 WT) and `Expansion.ts` 1,989, with a second command dispatcher at `Expansion.ts:435-922`. | [21:309-313], [21:397] |
| The freeze class is structural. `changeOwner` (`Simulation.ts:4838-4891`) notifies seven subsystems by hand, and `EntityCollection` hands out live mutable records. | [01:74], [09:355], [21:367] |
| A test-only legacy ruleset survives: 148 `this.expansion?` and 38 `if(this.expansion` branches, and 32 of the `Skirmish`-building test files run only legacy rules. | [09:379], [01:72] |
| A dead client-host stack (`HostedRuntime`, `CommitVerifier`, `StateDelta`, `EconomyLedger`, `MatchAuthority`) is still compiled and hashed into `runtimeId`. On the server, six confirmed restore defects are reachable only through it or the dev diagnostic replay (`worker.ts:115`): R2-L3, R2-L15, R2-M12, L18, L19 and R2-M11. **R2-M11 is not restore-only:** the same `validateFormation` runs on every decoded squad detail (`SnapshotDetails.ts:515`, `SnapshotCodec.ts:487`), and whether a live client decode can hit it is untraced (check B-3 below). | [01:77], [02b:130], R2-M11 |
| Two AI generations run for every AI faction (`thinkAi` plus the director pipeline). The structure is confirmed; the AI phase is about 10 % of the tick in measured runs (11.7 % of the quiet idle tick). | [01:80], R2-P17, [22:96] |
| Caps are inconsistent. `MAX_FACTIONS = 41` (`Protocol.ts:25`) exceeds `MAX_HUMAN_PLAYERS 20 + MAX_AI_OPPONENTS 14 = 34` (`FactionRules.ts:27-28`). The 14-AI ceiling comes from `MAX_AI_OPPONENTS` (`FactionRules.ts:48`), not from `MAX_FACTIONS` as 04b states [04b:40]. 8 + 14 + 30 = 52 fits `MAX_PLAYER_ID = 64` (`FactionRules.ts:38`). | source |
| Process gaps: `docs/` is gitignored (M9); the content compilers are unscripted and already reject the shipped recipes (M10, R2-M2); there is no CI; the root vitest config collects stale `out/` copies (L16); checkpoints carry no content or tick fingerprint (L14). | ledger |
| Corrections to round-1 notes: `npm run test:skirmish` does exist (`package.json:11`; 10 says it does not), and `tests/perf/` exists (`package.json:29-34`, OpenFront-era scripts; 06 says it does not [06:17]). There is no skirmish perf harness in the tree. | source |

| # | Step | Files | Effort | Test / exit | Source |
|---|---|---|---|---|---|
| S1 | Gate. Un-ignore `docs/`. Add `check` = `tsc --noEmit` + `test:skirmish`, and `compile:content` running the three compilers in order. Exclude `**/out/**` in the root config. Set `testTimeout: 30_000` in the skirmish config. | `.gitignore:37`, `package.json`, `vite.config.ts:331-337`, `vite.skirmish.config.ts`, new `tests/skirmish/ContentCompile.test.ts` | 0.5 day | `ContentCompile` deep-equals `compile(plans)` with `content/*.json`; `npm run check` green | M9, M10, L16, [01:117], [10:184] |
| S2 | Delete the dead host stack and the legacy packet layouts. | the five files above + their 3 tests; `SnapshotDetails.ts` | 1 day | suite green; runtime-id test updated | [01:122] |
| S3 | Make `ages-v1` the only ruleset. | `Simulation.ts`, `Rules.ts` (keep `BUILDING_RULES`), 32 test files | 2–3 days | the 32 ported tests pass on `ages-v1` | [01:125] |
| S4 | `MatchLifecycle` bus (tile owner, entity owner, removed, eliminated, controller) with entity generations. | new `MatchLifecycle.ts`; `changeOwner`, `checkWinner`, `setAiController` | 3–4 days | property test: 20 factions, 2,000 ticks of random ownership flips, eliminations and handovers, with checkpoint→restore equality every 50 ticks | [01:128], [14:477] |
| S5 | Extract one seam per week, verbatim, in this order: Naval, FactionAi (with a per-faction budget scheduler), Ownership, Roster + `addFaction`, CommandDispatch/Recruitment, LandNavigation. Naval goes first because it is the most self-contained and R2-H5, R2-M13 and R2-M14 land there. Roster waits for S4. | `systems/*.ts` with one-line delegates | 1 week each | per seam: suite green, checkpoint hashes of existing fixtures identical before and after, plus an `onPhase` timing for the new system | [01:131] |
| S6 | Split `Protocol.ts` (entities, commands, wire), consolidate docs, add an architecture-rules test (no cycles, no upward imports). | `Protocol.ts`, `docs/skirmish/README.md` | 2 days | `ArchitectureRules.test.ts` | [01:141-147] |

## Network efficiency

**Bandwidth with 8 active humans, 52 factions, desktop** [16:132-149]. This supersedes round 1's extrapolations [16:167-180]. Byte and rate rows do not depend on host speed. The millisecond rows were taken on the same oversubscribed host that inflated 16's tick times about 2× (R3-idle-tick (inflation)); treat them as upper bounds.

| Quantity | Mediterranean 500, active | Migration 500, active | Idle seats (Med / Mig) |
|---|---:|---:|---:|
| Publications per simulated second (gate alone: 5.0) | 6.59 | 6.45 | 5.00 / 5.00 |
| gzip per publication, mean / p99 | 64.7 KB / 114 KB | 51.5 KB / 72 KB | 57.0 / 51.8 KB mean |
| Raw per publication (metadata JSON share) | 601 KB (69 %) | 519 KB (74 %) | 552 / 507 KB |
| Per client at full simulation speed | 426 KB/s | 332 KB/s | 285 / 259 KB/s |
| Egress, 8 clients | 27 Mbit/s | 21 Mbit/s | — |
| Capture on the simulation thread, mean (contended) | 7.6 ms | 5.9 ms | 7.3 / 6.5 ms |
| Encode (encoder thread), mean (contended) | 12.8 ms | 10.8 ms | 12.2 / 11.5 ms |
| Client decode / apply / clone, mean (replay) | 6.2 / 6.1 / 26.4 ms | 5.4 / 5.5 / 29.4 ms | — |
| Client total per publication, mean / p99 (replay) | 38.7 / 54 ms | 40.3 / 54 ms | — |

At the real-worker speed (0.60× real time on desktop, contended) a client received 200 KB/s of wall time [16:150-155].

**Latency.**

| Measure | Value | Source |
|---|---|---|
| Order receipt visible, typical / worst | ~225 ms / ~450 ms | [02:63] |
| Unit at the published position, typical / worst | ~600 ms / ~1,050 ms | [02:65] |
| Unit visibly reacts after a click (no local echo) | 0.4–1.0 s | [07:98] |
| Added by the ranged delta: every squad is drawn and picked 500 ms in the past | +500 ms (WT only; not play-tested) | [21:245-254] |
| Move admission commit with 8 humans, p50 / p95 | 7 / 34 ticks (Med), 12 / 51 ticks (Mig) | [16:117-123] |
| Same on ARM, p95 wall time (×2.4, from contended tick times: upper bound) | 17–25 s | [16:129] |
| Publication forwarding delay, saturated vs unsaturated | 208 ms mean, 472 ms p99 vs 5–10 ms | R2-P7, P14 |
| Main-thread deserialise of the entity view | ~7–10 ms at 900 squads (P1); round trip 25–29 ms at 1,100–1,250 squads, about half on the main thread (R2-P8) | ledger |

The last row replaces round 1's "20 ms on the main thread" table entry, which was the full round trip.

| # | Fix | IDs | Files | Effort | Test | Expected |
|---|---|---|---|---|---|---|
| N1 | When `offer()` refuses only because a recovery is pending, do not set `dirty`. | H1 | `ClientStateFlow.ts:21-23` | S | `LiveMatch` test: acking a rebased baseline triggers exactly one `client-baseline`; update `ClientStateFlow.test.ts:40-51` | no repeated 290–450 KB baselines |
| N2 | Rate-limit bytes and frames before `JSON.parse` and Zod; close repeat violators; cap sockets per IP. Add a resync cooldown (≥ 2 s). Sanitise worker error text. Cap sockets and queued rooms. | M5, M6, L11, L12 | `CoordinatorServer.ts:245-310`, `LiveMatch.ts:891-907`, `serverMatchWorker.ts:306-314` | 1 day | a 512 KB junk frame is rejected before parsing; a second resync within 2 s is refused; `match-ended` carries a fixed string | removes cheap coordinator and worker DoS |
| N3 | Tolerate 2–3 missed pongs. Rejoin an existing seat through the non-pausing `client-baseline` / flow-epoch path instead of the match-wide `sync` lock. | P18 | `CoordinatorServer.ts:495-503`, `LiveMatch.ts:639-645` | 2–3 days | `LiveJoinLifecycle`: an owner's rejoin does not stop `advance()` | no global pause on a ≥ 5 s blip |
| N4 | Send only changed entity rows to the main thread (a lazy row view, or a compact typed-array view for unselected squads). **Do not switch to the packed `presentationPacket` path by default.** It makes the transfer cheap, but the main thread must then run `SnapshotDecoder.decode`, which rebuilds every squad object (P1, client code verifier). R2-P8's verifier suggests it, but nothing compares the two. Adopt it only if a bench shows packed decode on the main thread costs less than the clone's main-thread half (about 12–15 ms of the 25–29 ms round trip at 1,100–1,250 squads). | P1, R2-P8 | `CanonicalStateStream.ts:133-152`, `multiplayerStateWorker.ts:99-103` | M–L, plus 0.5 day for the bench | 16's replay harness: client cost per publication ≤ 20 ms at 1,100 squads; the bench records packed main-thread decode vs clone deserialise at the same publications | about −10–15 ms main thread per publication; 17 ranks this below the renderer fixes [17:64] |
| N5 | Metadata revisions: progression per player, revisions for armies, inventories, recruitment, tradeSites, aircraft and projectiles, players as a change list. | P12, P13, R2-P15, R2-P16, R2-P20 | `Expansion.ts:1935`, `Progression.ts:196`, `SnapshotCodec.ts:172-173, 390` | M | idle delta ≤ 10 KB raw; decoder keeps omitted keys (existing test) | metadata is 68–74 % of raw bytes; idle floor about 75 KB raw → < 10 KB [02:193] |
| N6 | A command publication replaces the next scheduled one (≤ 5 Hz total), and the encoder posts to the coordinator through a `MessageChannel`. | P15, P14, R2-P7 | `serverMatchWorker.ts:82-84, 282`, `LiveMatch.ts:727-731`, `PublicationQueue.ts:26-30` | S + S/M | 8-human harness ≤ 5.0 publications per simulated second; saturated forwarding delay ≤ 20 ms | −23 % publications, about −95 KB/s per client on Med [16:336-339] |
| N7 | Per-seat command quota (24 within the shared 100), a token bucket (8/s, burst 24), and 64 receipts per player. | — (model) | `LiveMatch.ts:559-575`, `CommandApplications.ts` | S | one seat at 50 msg/s never causes "Command queue is full" for the others | 8 honest humans see 0 rejections; only when one client sends at the 50 msg/s limit do honest players get 17 (Med) / 132 (Mig) rejections per match (modelled) [16:10], [16:161-164] |
| N8 | Wire hygiene: quantise `squadMotion` (about −12 % frame), compact detail strings, `deflateRaw` level 3, drop the live SHA-256, pack baseline details once, encode the frame body once per publication. | P16, P17, P32, P31, P30, P34, P33 | `SnapshotDetails.ts:339-347`, `StateCodec.ts:370-377`, `SnapshotCodec.ts:200-205`, `CoordinatorServer.ts:200-205` | 1–3 days total | round-trip codec tests | CPU and bytes, low priority |
| N9 | Interest management: later, and only together with fog of war (13 R6). Egress is not the binding constraint. | — | — | L | — | [16:340-344] |
| N10 | Drop released ranged history from replication: prune `released` actions older than a few ticks, or omit `rangedAction` from details for squads with no current aim. | R3-ranged-delta (released history) | `domain/RangedPreparation.ts:6-12` (WT), `SnapshotDetails.ts:145` | 0.5 day | steady combat delta packets within 1 % of HEAD's size on the all-firing fixture; `RangedPreparation.test.ts` restore and decode equality still pass | removes +8.5 % raw / +5 % gzip on steady combat packets |

## Combat

**Model, HEAD.**
- `Battle.fight` visits squads in id order. Damage resolves together through a `DamageLedger`. Contact comes from convex hulls, and `MeleeDamageBatch` caps damage per exposed slot and discards overkill [03:54-220].
- **Cavalry (09 supersedes round 1).** Default attack orders, which the client and every AI send, build a sustained `CavalryAssault` that strikes at weapon cadence:

  | Matchup | Assault HP/s | Charge HP/s | Ranks mode / assault |
  |---|---:|---:|---:|
  | Early Medieval heavy cavalry vs EM infantry | 270.6 | 365.9 | 1/10 |
  | Late Medieval cavalry vs LM infantry | 82.2 | 103.2 | 1/11.6 |
  | Bronze cavalry vs Bronze infantry | 70.9 | 84.6 | 1/7.4 |

  Source: [09:207-214]. Rank waves now exist only as an explicit `cavalryMode:'ranks'`. Only the lab sends it, but the server accepts it from any client. Round 1's "three waves per 10.8 s" and "1/6.5 of authored DPS" are obsolete [09:308-320].
- **Ranged preparation (WT only).** Every ranged land unit (37) gets an authored aim of 4–7 ticks. `commitShot` prepares against a specific target; the first shot of an engagement is delayed by the aim, later shots overlap it with the cooldown, so cadence is unchanged. Changing target, a cancelling order write, or leaving range restarts the aim. Damage, accuracy and splash rules are unchanged [21:65-131].

**What is wrong.**

| Problem | Measured / evidence | ID |
|---|---|---|
| A move order on engaged cavalry keeps it "withdrawing" for the whole move. A body-blocked rider deals 0 damage and takes 14 HP/s; the control run deals 240–290 HP/s. This is a regression from `e63a0730`. | executed | R2-H3 |
| Charge disruption is written in place inside the id-ordered loop. Damage over 6 s: 3,528 HP vs 2,897 HP, depending on which squad has the lower id. | executed | R2-L1 (L7) |
| Blast splash spends its budget in id order, not by distance. | read + reasoning | L8 |
| The melee wall test uses the root-to-root segment and ignores the wall's owner. | repro | L9 |
| About 0.12 % of approved melee contacts find no receiver slot and deal nothing. | fuzzed | L21 |
| One Napoleonic volley removes 1,550 of 2,000 squads in the crowded fixture: at step 1 at HEAD, at step 5 in the WT (the aim delays it, the volley is bit-identical). `e63a0730` removed 0. One 48-musket volley dealt 5,292 damage at 3 tiles; muskets at 3 tiles annihilate an equal 48-squad line on the first volley (100 %, mutual). | [10:54], [21:135-159], [08d:100] | design (measured) |
| `FormationPerformance.test.ts:144` and `:161-167` now pass in the WT only because their single step ends before the delayed volley. The perf contract no longer detects the annihilation. | [21:234-239] | test validity (measured) |
| **WT:** re-issuing the same attack order restarts the aim. Re-issued every 2–4 ticks, ranged cavalry, Napoleonic and modern infantry fire 0 shots in 120 ticks; every 6 ticks, modern infantry fires 33 against 70 never re-issued. Clicks under 350 ms become charges, so the real client needs re-issues every 3–4 ticks for full suppression; AI paths are guarded. | [21:207-217] | R3-ranged-delta (re-issue) |
| **WT:** army members with preparation-gated ranged weapons never complete an aim while their army is on a manual move or regroup march: 0 shots in about 32 in-combat ticks, against 3 on individual move orders. The march re-issues slot moves through `setArmyMove` → `activateOrder` every tick. | reproduced | R3-ranged-delta (army march) |
| Synchronised melee strikes cost 26–50 ms per strike tick and 35–95 ms on first contact (200 strikes, desktop, warm JIT). | measured | P11 |
| Assault geometry is recertified on every strike: 2–6 ms on ARM at 200 engaged cavalry. | measured | R2-P11 |

**Top proposals.**

| # | Proposal | Files | Effort | Test |
|---|---|---|---|---|
| C1 | Require contact for every engagement phase. Replace the move-long withdrawal with a 2 s guard. Arm the bonus instead of charging only for an in-contact target. | `Simulation.ts:3742-3749` (WT 3753-3760), `CavalryAssault.ts:127-138`, `Expansion.ts:805-809` | 1 day | a held rider whose attacker leaves clears within 2 s; a blocked withdrawing rider deals damage after 2 s; a charge to a point after a stale engagement charges [09:414-425] |
| C2 | Per-tick effect ledger: stage charge disruption and fighter hits, apply them after the loop, and sort splash victims by distance then id. | `Battle.ts:760-765` (charge disruption; WT 777-782), `Battle.ts:1571-1602` (splash `targetLimit` and the id `sort`/`slice` at 1578-1579 and 1601-1602; WT +21); `Expansion.ts:1286-1297` | 1 day | swapping ids gives identical strike ticks and damage; a mirrored fighter duel ends symmetrically; the centre body takes splash first |
| C3 | Ranged and hull lethality. First check whether accuracy or splash applies twice in the Napoleonic case. Then cap any non-per-soldier hit at bodies-in-reach × soldier HP, author hull damage at soldier scale, and add vehicle bonuses to anti-tank and pikes. The ranged delta does not substitute for this [21:241-243]. | `Battle.ts:1017-1024` (WT 1035-1042); `content/Units.ts:75, 112, 264`; `unit-tuning.json`; `skirmish/plans/soldier-weapons.json` | 2–4 days | the crowded fixture keeps > 1,900 fighting **after 8 steps** (past the longest aim; the old single-step assertion is vacuous in the WT [21:294]); 48v48 duel rows: a full-range Napoleonic volley kills 15–20 % of an equal line; one MG burst kills ≤ 4 riflemen; two ATGM teams kill a T-14 in ≤ 40 s [05:347-386] |
| C4 | Gate `cavalryMode:'ranks'` behind a lab-only match option. | `Simulation.ts:1454-1458` (WT 1463-1467), `Battle.ts:940` (the `ranks` read; WT 958) | 2 h | ranks is rejected in live options |
| C5 | Write assault geometry only on a material change, and round it. | `Battle.ts:989-992` (WT 1007-1010) | 0.5 day | a 20 s assault makes ≤ 3 engagement replacements |
| C6 | Cache receiving bodies per pose pair, or stagger first strikes. | `MeleeDamage.ts:50-72`, `Battle.ts:621-622` (WT 638-639) | 1–2 days | 200 synchronised strikes ≤ 15 ms desktop warm |
| C7 | Re-baseline AI military balance after the cavalry change. The "7–10× stronger" figure is unverified (R2-L2). | investigate: 15's battle harness run outside the suite [15:108-114] | investigate, 1 day | outcome = an AI-vs-AI age-matched army table (W/L and survivors per age) recorded in BalanceContract.md [09:452]; any age with ≥ 3× survivors for one side opens a balance item |
| C8 | Later: morale and rout, resolved in a ledger after `fight()`. Today fights run to near-mutual annihilation (12v12 naval: 1–7 survivors [20:131]). Generals are not recommended until morale exists; nothing measured supports them. | new `domain/Morale.ts`, `Battle.ts`, `Protocol.ts` (`Squad.morale`), `TacticalEstimate.ts` | 3–5 days | a squad losing 30 % in 10 s routs; rout contagion stays within a capped radius; checkpoint continuity [03:479] |
| C9 | **WT, before commit.** Keep the aim when a player re-issues an attack on the target the squad is already attacking and the order is not appended: skip the cancel in `activateOrder` (or pass `continuingAttack` from `applyCommand`), matching the exemption in `updateSquad`. | `Simulation.ts:1591`, `:1705` (WT), guard at `:1195` (WT) | 0.5 day | in `RangedPreparation.test.ts`: the same attack re-issued every tick for 120 ticks fires as many shots as never re-issued (modern infantry 70); re-issued every 6 ticks, also equal |
| C10 | **WT, before commit.** Keep the aim when an army re-slots a move and the ranged target is unchanged, both in `activateOrder` (army re-orders through `setArmyMove`) and in the `updateSquad` order guard for move-to-move rewrites. | `Simulation.ts:1195`, `:1705`, `setArmyMove` `:3863` (all WT); `Armies.ts:182`, `:834`, `:866`, `:1082`, `:927`, `:969` | 1 day | an army on a manual move under distant fire: its ranged members fire at least as many shots in 32 in-combat ticks as the same units on individual move orders (3 in the repro) |
| C11 | **WT, playtest decision.** Apply the 500 ms presentation delay only to combat facts (volleys, projectiles, `rangedAction`) and draw movement and picking from the latest snapshot. | `Renderer.ts:409`, `:647`, `:1121-1122`; `CombatPresentationTimeline.ts:73-74` | S (1 day) | movement is drawn at the latest endpoint and `squadAt` uses the latest snapshot while a wind-up still plays from its `startTick` [21:296] |

**Air and strategic (12).**

| Problem | Evidence | ID |
|---|---|---|
| Point launches and bombing or atomic sorties skip diplomacy. A nuke on a peace-protected or allied faction turns its land into capturable owner-0 wasteland without any war. | executed | R2-M4 |
| Bombers dominate. Range 1,687–2,531 tiles covers every map. Re-sorties are instant with no ordnance cost. The blast has no budget. Anti-air gets at most 1–2 shots per 1.7 s pass. Atomic bombs cannot be intercepted. | [12:299-341] | design (arithmetic from source) |
| **WT:** mobile anti-air re-picks the nearest aircraft every tick and restarts its 4-tick aim on every change. 4 or more fighters in patrol orbit silence it (0 shots in 200 ticks, against 12–13 for one fighter); 2 fighters overhead cut it from 15 to 6 shots in 240 ticks. Drone swarms and bomber streams were not affected in straight-line runs. Emplacements and ship air defence are unaffected. | reproduced | R3-ranged-delta (anti-air) |
| Strategic timing is half-rescaled. ICBM flight went 36 → 90 s and defence reload 20 → 50 s; defence shots per silo cycle fell 3.0 → 1.2. The interceptor/missile speed ratio is unchanged, which corrects 08c I1. | [12:342-357] | design |
| The AI's air play is absent: 0 air commands in a natural 20-minute Modern run, and 10 missile-defence buildings per city when wealthy. | [12:359-385] | executed |
| AI conventional bombing has no friendly-fire check. | [12:386-397] | code |
| Fighter duels are decided by array order. | executed | R2-L8 |
| Smaller items: transfers rebuild all bases per plane (1–3 ms); anti-air scans are linear; aircraft are re-sent in full every packet (~14 B per moving plane); emplacement volleys skip the cap; the shared 4,096 projectile cap holds bombers at their target. | — | R2-P13, R2-P14, R2-P15, R2-L9, R2-L10 |

| # | Proposal | Files | Effort | Test |
|---|---|---|---|---|
| A1 | Check the blast area at accept time. Refuse when allied or protected forces are inside; establish war against a non-allied target. | `Expansion.ts:610-646, 1007-1019` | 0.5 day | in `StrategicDefense.test.ts`: a peace-protected point launch is rejected; an ally under an atomic sortie is rejected |
| A2 | Express strategic timing in seconds: flight `secondsToTicks(36)`, defence reload `secondsToTicks(20)`, interceptor speed `80*FIXED/TPS`. | `MissileDefense.ts:3-4`, `Expansion.ts:1092` | XS | `SimulationTiming.test.ts` covers all three |
| A3 | Air balance pass: combat radius per class and age, rearm time, an ordnance cost, a capped bomb budget, stronger anti-air, interceptable atomic bombs. | `FlightOperations.ts`, `ModernWeapons.ts`, `Battle.ts:1172, 1569` (WT 1193, 1590) | M | new `AirBalance.test.ts` rows (a)–(f) [12:506-536] |
| A4 | AI strategic sanity: threat-based missile-defence demand, proactive anti-air, friendly-fire filter, skip reloading launchers. | `AiMilitaryDemand.ts:128`, `AiPlacementCandidates.ts:207, 239`, `Expansion.ts:1816-1858` | S–M | an AI next to its own engaged squad does not sortie; a reloading silo issues no `launch` [12:537] |
| A5 | **WT, before commit.** Sticky anti-air acquisition: keep the aircraft in `rangedAction` while it stays eligible, as the ground path keeps its previous target, then fall back to nearest. | `Battle.ts:831-845` (WT), ground retention at `:913-915` (WT); `domain/RangedPreparation.ts:33-37` (WT) | 0.5 day | in `RangedPreparation.test.ts`: 4 fighters in patrol orbit → ≥ 10 shots in 200 ticks (one fighter: 12–13); 2 fighters overhead → ≥ 13 shots in 240 ticks |

**Naval (20).**

| Measured | Value | Source |
|---|---|---|
| Same-age 1v1, Stone to Classical | both sink on the same tick after 93–98 s | [20:124] |
| Early Medieval 1v1 | both stall at 1 HP dealing 0 damage | R2-M13 |
| Mirrored battles flipped by id assignment alone | 7 of 24 | [20:156-165], R2-L17 |
| Equal-gold fleets | Stone and Bronze swarms beat every pre-gunpowder fleet with 2.5–24× gold efficiency | [20:133-155] |
| One warship vs a same-age port or city | destroyed in 42–60 s; the warship takes 0 damage | [20:166-176] |
| 3 warships vs 12 afloat squads | all sunk in 14–24 s; land troops cannot shoot transports | [20:177-184] |
| Escorted merchant | captured after 2.25 s; the escort has no effect | [20:185-193] |
| Idle human warship next to foreign coastal water | declares war after 1.4 s | [20:206-211] |
| Stone → Modern refit plus free repair | 46 % of the price of a new hull | [20:194-200] |

Confirmed naval defects: R2-H5 (repair livelock), R2-M13, R2-M14, R2-M15, R2-L17, R2-L18, R2-L19, R2-P30, P35.

| # | Proposal | Files | Effort | Test |
|---|---|---|---|---|
| V1 | Damage floor `0.6 + 0.4 × health fraction`, and clamp the troops argument to ≥ 1. | `Simulation.ts:2772-2789, 2910, 2931` (WT +11) | 0.5 day | new `NavalBalance.test.ts`: a same-age 1v1 resolves in 15–30 s in every age; a 1-HP ship of every vessel deals ≥ 1 |
| V2 | Repair state machine: `repairing` restarts the dock voyage; retreat below 60 %; scale health on research and refit; spawn recruits at max health. | `Simulation.ts:3215-3297, 2591-2606` (WT +11), `Expansion.ts:1157-1160` (refit completion) | 0.5 day | interrupted recovery reaches full health ≤ 90 s; ship improvements do not move a full-health patrol |
| V3 | Innocent passage: warships do not declare entry war; afloat squads still do. | `Simulation.ts:3445` (WT 3456) | 0.25–0.5 day | an idle warship beside foreign coast declares no war |
| V4 | Land–sea interplay: towers and gun nests shoot ships; ranged troops get a weak anti-hull attack; warships a weak anti-personnel attack; transport hull damage persists. | `content/Defences.ts`, `Battle.ts:1064-1105` (WT 1085-1126), `TransportHandoff.ts:24-33` | 2–3 days | one same-age warship cannot destroy a same-age tower and two can; a beach held by 2 ranged squads sinks ≥ 1 of 6 transports |
| V5 | Boarding instead of instant capture: 3 s of contact, blocked by an escort within 3 tiles; a recapture is counted once. | `Trade.ts:1229-1258` | 1 day | an escorted merchant is not captured; a recapture counts once |
| V6 | Naval economy: age-gate older hulls, flatten strength per gold, price refits off the target, fix the AI vessel pickers. | `Simulation.ts:2561-2566` (WT +11), `RefitQuote.ts`, `AiNavalPlanner.ts:845-852` (picker; warship filter at :849), `Expansion.ts:1766-1785` | 0.5 day + matrix | adjacent ages at equal gold: the newer wins with 1.1–2.0× efficiency |

## AI, tribes, nomads and pirates

**Current architecture** [04:18-70], [04b:44-96]:
- `thinkAi` (`Simulation.ts:4892`, WT 4903) runs every tick for each AI faction. It drives an `AiOperations` strategic record (peace → preparing → war → recovery) and a staggered per-squad loop.
- Nations add the `AiEconomicDirector` pipeline: fact readers under a fixed allowance, army missions, invasion response, defence, Modern fronts, naval and coast planners, and one `decide` per 2 ticks for the whole match.
- Battles run through `AiArmyPlanner` → `EngagementManager` → the `Armies` battle line.
- Tribes get `thinkTribeDevelopment`, recruitment and a leash in `thinkAi`, and an `AiOperations` tribe branch, which HEAD enables by default (`AiOperations.ts:99-101`) [21:58]. Holding tribe squads re-enter 16-squad "strategic expansion" marches every 0.75 s decision; this is most of the movement in an idle match [22:128-143].
- Every decision is an `applyCommand` through the human validator, generation-fenced. Keep this design.

**Measured limits** (not ledger rows):

| Area | Measurement | Source |
|---|---|---|
| Battle line vs a naive "attack the nearest enemy" policy, AI W/L by age | Bronze 4/2, Classical 1/3, Early Medieval 0/4, Late Medieval 0/4, Napoleonic 2/2; human auto-armies 0/16 | [15:108-114] |
| Ranged losses | AI 0.47–0.99 vs naive opponent 0.12–0.40 | [15:118-120] |
| Charge-bonus activations | 0 in about 120 battles | [15:124] |
| AI vs AI before Napoleonic | 16 of 18 battles drawn, mostly with no contact | [15:110-113] |
| Economy pacing | one decision per 2 ticks match-wide; 24 % issue a command; 19 of 27 factions saving; up to 247k idle gold; 108 builds in 10 minutes across ~20 nations | [04b:42] |
| City cap | nations stop at two cities before Early Modern | [04b:170] |
| Aggression toward humans | first AI war on a human at minute 1; passive human seats end up at war with 1–6 factions | [13:90], [22:309-313] |

**Confirmed limits and fix-first list.**

| # | Fix | IDs | Files | Effort | Test |
|---|---|---|---|---|---|
| I1 | Release only the failing mission. | M2, R2-M6 | `AiArmyPlanner.ts:313` | hours | an annihilated army leaves sibling missions intact |
| I2 | Gate the advance creep on frontline or ranged members fighting, not mounted wings. | R2-M5 | `Armies.ts:1148` | hours | the line advances while only the wing fights |
| I3 | Mark the army blocked on an unreachable leader route so the breach phase can run. | R2-H4 | `Armies.ts:217-224, 651-652`, `AiArmyPlanner.ts:448-453` | 1 day | ring-walled city: `breach` within 30 s, wall damage within 90 s |
| I4 | Keep the objective tile in its own field and skip identical re-moves. | R2-P19 | `AiArmyPlanner.ts:184, 492` | hours | at most 1 re-send per objective change |
| I5 | Persistent fleet missions: extend the deadline on progress, re-check credit in `recover`, and use `secondsToTicks` for recovery timers. | M1, L3, L2 | `AiNavalPlanner.ts:306-319, 573-575, 883-888` | 0.5 day | extend `AiNavalPlanner.test.ts:166-178` past 120 s: a quiet patrol keeps the same mission id in stage `patrolling` at t = 300 s with no `abort` transition (fails today at exactly 120 s); a mission parked in `recover` returns to `fund` within 1 s of credit covering the next vessel; recovery completes at `secondsToTicks(20)` |
| I6 | Restore the AI 12-kit floor, or order payloads ahead of surplus kits. | R2-M1 (H5) | `AutomaticProduction.ts:203, 266-270` | 1–2 h | `AiLateGame.test.ts:142` passes |
| I7 | Pick vessels by strength per cost, not catalogue order. | R2-M15 | `AiNavalPlanner.ts:845-852` (filter at :849), `Expansion.ts:1766-1785` | hours | the AI picks `modern-warship` over an identical `modern-submarine` |
| I8 | Adopt or disband human armies after a handover; release AI state on elimination. | M3, L1 | `Simulation.ts:227-241, 5460` (WT 228-242, 5471) | 3 h | the AI reuses squads from a handed-over army; an eliminated faction leaves no missions |
| I9 | Scale background budgets with enabled factions, skip idle factions without using their turn, owner-scoped Modern-front assessment. | P2, P3, P4, P23 | `AiEconomicDirector.ts:204-222`, `AiCoastPlanner.ts:158-209`, `AiModernFronts.ts:244-253` | 1–1.5 days | 45 factions: naval assessment ≤ 5 s; a coast goal completes on Mediterranean 500 |
| I10 | Coarser sleep key; stagger over all 24 phases; remember rejected tribe build tiles. | P25, P26, P24 | `AiOperations.ts:309-326`, `Expansion.ts:1379` (stagger), `Expansion.ts:1616-1621` (16-candidate build loop) | 0.5 day | thinks spread over 24 phases |
| I11 | Lost trench: issue the regroup order; dead `flank` phase: wire it or remove it; scale the skirmish-stance budget. | R2-L12, R2-L11, R2-P18 | `TrenchPositioning.ts:66-74`, `AiArmyPlanner.ts:400`, `SkirmishStance.ts:169-185` | 1 day | a lost trench moves survivors home; reloading skirmishers are visited within their trigger window |
| I12 | Economy competence: cities for manpower, a saving rate instead of the whole balance, gate `advance` on `usableNextAge`, multi-command decisions, resource-directed expansion. | 04b I16, I5, I6, I4, I7 | `AiPlacementCandidates.ts:198-294`, `AiEconomicDirector.ts:227-470`, `AiEconomicPlanner.ts:335`, `HomeTerritory.ts:105-135` | 4–6 days | `pacingAutoplay` seeds 47/72 before and after; idle gold at minute 10 below 50k [04b:182-200] |

**Tactics from 15** (T7 was refuted and is excluded).

| # | Change | Files | Effort | Test |
|---|---|---|---|---|
| T-a | Role-ordered march column; deploy when time-to-contact ≤ 10 s; a deeper ranged band; skirmish posture when ranged ≥ 25 %; a ranged-evade rule. | `Armies.ts:743-810` (column), `AiArmyPlanner.ts:457, 468`, `BattleLineLayout.ts:34-35` (`LINES.bandGap`), `Armies` `tacticalStep` | 2 days | new `AiBattleCompetence.test.ts` (Early Medieval 9v9, both seats): AI wins ≥ 2/4 vs attack-nearest; AI ranged melee-ticks ≤ 2× the opponent's |
| T-b | Contact-based commitment; when idle in `engage`, fall back to the objective or the nearest enemy army. | `AiArmyPlanner.ts` (commitment and `engage`), `Armies.ts:1148`, `AiDoctrines.ts` (`advanceAbove`) | 1 day | an AI-vs-AI duel reaches contact ≤ 30 s and is decided ≤ 150 s; ≥ 80 % of an idle defender killed |
| T-c | Re-arm charges while engaged; loose squads and tribes may charge. | `Armies.ts:356`, `Simulation.ts:5125` (WT 5136), `Expansion.ts:813` | 1 day | ≥ 1 bonus activation in a 60 s Late Medieval duel |
| T-d | Offensive hill gate at ≥ 3 % estimate gain. | `HillPositioning.ts:324` | 1 h | the AI takes the hill on the HillDefence map |
| T-e | Calibrate `engagementEstimate` against simulated outcomes. | `TacticalEstimate.ts:11-26`, `EngagementManager.ts:570-598` | 2 days | per-age table test: estimate vs simulated survivor ratio within a fitted tolerance |

Sources: [15:251-264], [15:332-383].

**Pop-up factions (14; summary, details in [14-popup-factions-spec.md](14-popup-factions-spec.md)).**
- The owner's `.codex/1.5 Update Plans/Nomad Factions/PLAN.md` (2026-10-07) is authoritative for nomads, and it contradicts round 1's design (no economy, ≤ 8 squads, settle into a tribe, excluded from victory). Round 1's nomad design is superseded [14:8-18], [14:221-233].
- **Nomads (PLAN.md):** a yurt economy; groups of 3–5 and at most 20 living; the window opens on Bronze → Classical eligibility and closes at the third Early Modern faction; a Khan gets +10 squad capacity per credited conquest, up to 100; no alliances; they block victory.
- **Pirates (proposal):** ships only, at most `min(4, ⌈seaTraders/40⌉)` living, 3 warships at spawn, immediate plunder, and a new `AiPiratePlanner` (about 250 lines, ≤ 300 reads per turn) instead of an `AiNavalPlanner` objective. That planner is port-centric and budget-starved (P2, M1) [14:536-696].
- **Other kinds:** mercenaries as a pirate hire contract; barbarian waves only as a nomad spawn trigger; rebels deferred until the lifecycle bus and purity test exist [14:697-707].
- **Feature prerequisites (R-0, 6–8 days):** lifecycle bus (S4); Roster seam with a two-phase `addFaction`; id range, adjacency and colour sizing; a `FactionProfile` table in place of the `kind` string checks; memoised hostility and live-rival iteration; checkpoint v12; a trade plunder mode [14:477-534]. Round 2 refuted these as *current* defects because nothing spawns factions at runtime today. They are build work for this feature, not bugs.
- **Cost (supersedes round 1's "+10 % AI tick at 6 pop-ups" and 14's derived per-squad ARM figures).** The AI part is small: about 1 ms for 6 pop-ups, 0.4–0.7 % of the tick (R2-P17). The whole-tick cost follows squads. The only measurement: 6 real tribes (+110–150 squads) added 17–34 % to the tick at ticks 1,200–1,600 (R2-P17, idle x64), about 0.11–0.31 % per added squad including the wars and combat they bring. At that rate:

  | Pop-up population | Added squads | Added tick (measured rate) |
  |---|---:|---:|
  | 6 pop-ups [14:453] | ≈ 50 | +6–15 % |
  | 14's proposed `POPUP_SQUAD_BUDGET` [14:606] | 200 | +23–62 % |
  | 20 PLAN.md nomads at 40 squads [14:455] | 800 | far beyond any budget |

  22's per-squad costs (16–18 µs CPU stationary, 51–82 µs moving) give a lower bound of about +1–5 % for 50 squads, because they exclude the wars a new faction attracts [22:145-170]. 14's DERIVED "+12–28 ms ARM for 200 squads" (0.06–0.14 ms per squad) [14:438-457] is below the measured rate and is not used.
- **T17 and the budget, restated consistently.** 14's T17 "6 pop-ups ≤ +5 % tick on desktop" [14:887] cannot pass at the measured rate (+6–15 %). Restated acceptance: on the quiet desktop (Migration 500, 52 factions, wall/CPU ≤ 1.5), 6 pop-ups add ≤ +10 % and the full pop-up budget adds ≤ +20 % to the tick mean. Start `POPUP_SQUAD_BUDGET` at 60 squads (+7–19 % at the measured rate) instead of 200, keep the world cap of 1,400 squads [14:607], and raise the budget only when the T17 profile shows headroom. Give nomad marches the same concurrency budget as tribe marches (I-1 below) [22:349].
- **Pirates need naval counterplay first:** V1–V5 above [20:490-500].
- **Tests:** T1–T16 [14:860-888], plus T17 as restated.

**Effort for the owner's pop-up request.** 14 sizes only R-0. The figures below are editor estimates for one developer who knows the codebase, from the scope 14 and PLAN.md §16 give per stage; nothing measured supports them.

| Build | Stage (PLAN.md §16) / part | Scope (source) | Effort |
|---|---|---|---|
| Prerequisites | R-0 | lifecycle bus, Roster + `addFaction`, ids, profiles, hostility memo, checkpoint v12, plunder mode [14:477-534] | 6–8 days (14) |
| Nomads | 1 baseline and contracts | edge policies, predicate and ownership audit (PLAN.md §16) | 1–2 days |
| Nomads | 2 diplomacy permissions | mostly done in raids-v1; an AI caller for `beginAiRaid` and a kind-aware alliance gate remain [14:207] | 1 day |
| Nomads | 3 content and economy | nomad profile, shallow tree, two mounted lines, three yurt roles, `nomadBuildingLimit`, manpower [14:581-609] | 4–6 days, plus art |
| Nomads | 4 registration and world spawn | latches, groups of 3–5, region search, population guard, on top of R-0's `addFaction` (T4, T5) | 2–3 days |
| Nomads | 5 rivalry and Khan | intra-group wars, capacity credits at `checkWinner`, one-time Khan notice (T14) | 2 days |
| Nomads | 6 expansion and trade raiding | unclaimed expansion, land-actor raid grid in `Trade.ts`, embargo missions [14:695] | 3–4 days |
| Nomads | 7 retaliation and campaign | new `NomadCampaign.ts`, `AiOperations` nomad branch over adjacent factions [14:688-695] | 3–4 days |
| Nomads | 8 presentation and balance | names, colours (T16), HUD, tuning runs incl. T17 | 3–5 days, plus art |
| Nomads | total after R-0 | | 19–27 days |
| Pirates | profile, `spawnShip`, ship-only survival (T7) | [14:611-642] | 1–2 days |
| Pirates | `AiPiratePlanner` (~250 lines) | [14:654-685] | 3–4 days |
| Pirates | immediate plunder, reinforcement, careening, disband (T8, T9) | [14:630-642] | 2 days |
| Pirates | tribute and hire contracts (T10, T11, T12) | [14:711-770] | 3 days |
| Pirates | HUD, colours, balance | [14:830-858] | 1–2 days |
| Pirates | total after R-0 and V1–V5 | | 10–13 days |

## Balance and economy

The bookkeeping is sound: escrow refunds once, and costs use `Math.ceil` [05:174-190].

| Problem | Measured | Proposal | Files | Effort | Test |
|---|---|---|---|---|---|
| Late-age hulls one-shot squads; vehicles are immune to pre-modern troops (64 pikemen die in 5.75 s, the tank stays at 1,000/1,000) | [05:194-221] | C3 above, plus ATGM `vehicle` +400, PTRD +150, Napoleonic pikes and grenades +60 | `skirmish/plans/soldier-weapons.json`, `unit-tuning.json` | with C3 | contract rows in C3 |
| An age-up needs only two trees, so warfare can be skipped. Serial research floor to Modern: ~31 min on two trees, ~46 on three; Stone → Modern costs 1.44M gold | [05:123-132], [05:223-229], [05:258-262] | require warfare slots 1–3 (or add 50 % of the unfinished tree's gold to the advance) | `Progression.ts:101-106` | 0.5 day | `Ages.test.ts`: advance rejected with two non-warfare trees |
| Foreign trade pays both sides in full: one Modern factory yields 38k gold/min to each side, against 1.7k/min from 1,500 tiles of land on Mediterranean 500 | [05:231-243], [13:71] | 25 % receiver tariff, a per-market intake rate, a per-faction commerce cap | `Trade.ts:1388-1392`, `TradeReceiving.ts:27-33`, `Economy.ts` | 1–2 days | `TradeFleet` tests: the receiver gets 25 %; a market saturates |
| Stacking 15 buildings per tile: 15 Modern mines on one deposit yield 180 ore/s | [05:245-255] | mines 1 per deposit, cities 3, factories and ports 5 | `Construction.ts:18`, `Supply.ts:363-372` | 0.5 day | stack-limit validator test |
| Refits priced off the source unit (warship refit plus repair = 46 % of a new hull) | [20:194-200], [05:274-281] | `max(formula, 60 % × (target − source))` and proportional health | `Refitting.ts:6-15`, `RefitQuote.ts:28-34`, `Expansion.ts:1157-1160` (completion; handlers at 661-678 ships, 737-747 squads [21:404]) | 2 h | refit quote test |
| Content contradicts the contract: `modern-archer` HP 80 → 100 and enlarged 1 → 3; Modern MG crew 200 HP vs 1,000 in Early Modern; bronze cavalry now costs 16 horses | [10:47-63], [05:283-289] | owner decision, then recompile | `skirmish/plans/formation-recipes.json`, `content/Units.ts:414` | minutes | `CombatPresentation.test.ts:65`, `TechnologyDetails.test.ts:27` |
| Tribe opening: 4 squads, cap 10 + 5 per age, a flat 40 reserve points (3.3× a Stone nation). Tribes reach their cap by minute 2 | [13:90-93], [05:290-296] | cap 6 + 4 per age; reserve 2 × the nation base; no campaigns vs nations before Bronze or minute 8 | `FactionRules.ts:50-54`, `Simulation.ts:3690` (WT 3701), `AiOperations.ts:402` | S | `TribeOpening.test.ts` |
| Spawns are unequal for 8 humans: land 3.4–14.8× (Med 500) and 4–22.7× (Mig 500); coast 0 vs 136–199 tiles; 0–9 extra deposits | [11:88-103] | balanced human starts | `SpawnSelection.ts:113-185`, `StartingPositions.ts` | 1–2 days | `SpawnFairness.test.ts`: max/min land within 40 steps ≤ 1.35 over 12 seeds |
| Naval strength per gold is not monotonic across ages | [20:133-155] | V6 | — | — | — |
| Pacing: AI leaders reach Bronze at minute 4, Classical 8, Early Medieval 13, Late Medieval 19, Napoleonic 25–26; Modern projected at ~43 against a 60–90 minute target | [13:94] | 13 R8 (below), then a pacing probe | `Progression.ts:101-106`, `Technology.ts:30-40`; probe: new `scripts/pacingProbe.ts` using 13's probe setup [13:35-43] | S + M tuning; probe: investigate, 1 day | probe outcome = leader and median age-entry minutes to minute 60 on 3 seeds, compared with the targets [13:296-318] |
| No per-age counter matrix in tests | [05:401-403] | `BalanceMatrix.test.ts` (dps per gold, per age) | new test | 1 day | fails when a same-age counter pair drops below a threshold |

The horses correction: the starting resource floor already includes horses [11:49], which corrects 05 issue 11.

## Gameplay design (13)

**Measured early game:** Mediterranean 500, 52 factions, Stone start, production options [13:76-87].

| Minute | Humans alive (idle seats, seed 424242) | Humans alive (AI-driven seats) | Original nations alive | Tribes promoted |
|---|---|---|---|---|
| 4 | 6 / 8 | 8 / 8 | 14 | 0 |
| 8 | 1 | 2 | 8 | 6–10 |
| 20 | 0 | 0 | 3 | 7–8 |
| 30 | 0 | 0 | 2–3 | 4–7 |

The field collapses from 52 to 7–16 factions by minute 30. The leader holds 32 % of the land, 1.4× the runner-up [13:89-97].

**Issues** [13:109-166]:
- **G2 victory.** A solo win needs all 51 others dead, tribes included. One embarked squad keeps a faction alive.
- **G3 allied victory** is unreachable with more than about 4 factions alive.
- **G4 eliminated humans** get no defeat screen and keep the server simulating.
- **G5 no fog of war.** Every client receives every entity and every rival's gold, and the AI is omniscient.
- **G6 factions are cosmetic.**
- **G7 snowball** through tribe inheritance.
- **G8 no AI difficulty.**
- **G11 entry war.** Any human squad entering foreign land declares war.

**Rise of Nations parity gaps** (what RoN has that this game lacks; 13's RoN analogues are general knowledge, not code facts [13:3]):
- **Attrition** outside own supply, RoN's signature anti-snowball damper. None exists (`grep unsupplied|attrition` finds nothing) [13:247], [14:707]. → R5.
- **Territory and wonder victory**, plus score with a time limit and surrender. Only conquest exists [13:50], [13:191]. → R2 (score and time limit first; territory later; wonders with R7).
- **City fire:** cities and towers that shoot, so no early rush works [13:177], [13:326]. → R9 item 4.
- **Rare resources** found by scouting. Deposits exist but every client sees the whole map, so there is nothing to find [13:133], [13:321]. → only with R6 (fog of war).
- **No-rush start:** RoN gets it from city fire, attrition and small early armies; here an explicit treaty timer is the cheapest equivalent [13:177]. → R1.

| # | Change | Blocks an 8-human playtest? | Files | Effort | Test |
|---|---|---|---|---|---|
| R1 | 8-minute protected start (O(1) per-player check in `protected()`), the tribe numbers from the balance table, tribe-campaign gate, inheritance limited to age | **Yes** | `FactionRules.ts`, `Simulation.ts:3610-3618, 5467-5472` (WT +11), `Diplomacy.ts`, `AiOperations.ts:402`, lobby settings | S–M | `StartProtection.test.ts`; nightly probe: ≥ 6 of 8 AI-driven human seats alive at minute 10 on 3 seeds |
| R2 | Victory: only regular factions count; eliminated after 180 s without a city; humans-vs-AI teams; 90-minute limit with score; resign; end when no human is alive. Territory win later. | **Yes** (minimum) | new `domain/Victory.ts`, `Simulation.ts:5450-5532` (WT 5461-5543), `Expansion.ts:1929-1941`, `CommandSchema.ts`, `LiveMatch.ts:400, 773` | M (3–4 days) | `Victory.test.ts` (pure function), `resign` integration, `LiveMatch` ends when all humans are eliminated |
| R3 | Defeat dialog and observer mode; eliminated seats do not keep a match alive. Later: claim a tribe. | **Yes** (minimum) | `client/main.ts:1313-1333`, `LiveMatch.ts:592-596, 783-801` | S (min) / M | `LiveMatch` test with only eliminated seats connected |
| R4 | AI difficulty relaxed / standard / hard: raid floor, required advantage, a cap on concurrent campaigns per human, income multiplier | **Yes** for mixed skill | new `content/AiDifficulty.ts`, `AiOperations.ts:402-429`, `Simulation.ts:3682-3704` (WT 3693-3715) | S–M | relaxed keeps 8/8 AI-driven seats alive at minute 10 |
| R5 | Snowball damper: attrition outside supply. Land income is only land/160 per second on Med 500, so a log land-income curve would change nothing [13:71], [13:241-254] | No | `Simulation.ts` (new `attrition()` beside `replenish()`), `TacticalRules.ts`, `Protocol.ts` | M | `Attrition.test.ts`: grace, rate, ally supply, exemptions, checkpoint |
| R6 | Fog of war, only together with interest management (per-viewer encodes: 1.2–2.4× encoder CPU, 60–80 % fewer bytes) | No | new `Visibility.ts`, `SnapshotCodec.ts:125-175, 390` | L–XL | a per-viewer encode never contains an entity outside the mask |
| R7 | National powers (10 at ±10–20 % on existing systems), then elite-variant unique units | No | new `content/NationalPowers.ts` + cost hooks | M then L | per-power quote tests |
| R8 | Pacing: three trees per advance, advance times 90–180 s (leaders reach Modern near minute 61) | No (the three-tree rule could ship with R1) | `Progression.ts:101-106`, `Technology.ts:30-40` | S + M | `Ages.test.ts`; pacing probe to minute 60 |
| R9 | Opening structure: spawn parity, tribe bounties and tribute, a trespass warning before war, city fire | Partly (spawn parity) | `SpawnSelection.ts`, `Diplomacy.ts`, `Battle.ts` | M | spawn-parity property test; a Stone city with 1 squad repels 5 clubmen squads for 60 s |

Pacing targets (leader / median minute of age entry): Bronze 5/6, Classical 12/14, Early Medieval 20/23, Late Medieval 28/32, Napoleonic 37/42, Early Modern 47/53, Modern 58/65; match end 75–90 [13:296-318].

## Performance at the 52-faction target

**Baseline, re-based in round 3** (quiet desktop, Migration 500, 52 factions, worker capped at 384 MB, ticks 1,200–6,000) [22:89-105]. This supersedes 16's tick times.

| Phase, mean ms | (a) all 52 AI | (b) 8 idle seats + 480 squads | (b) − (a) |
|---|---:|---:|---:|
| Tick mean / p95 / p99 / max | 67.8 / 100.2 / 125.1 / 209 | **82.9 / 115.6 / 147.1 / 230** | +15.1 |
| Movement | 23.29 | 27.04 | +3.76 |
| Combat | 14.65 | 19.54 | +4.88 |
| Routing | 14.31 | 14.91 | +0.59 |
| AI | 7.06 | 9.67 | +2.61 |
| Economy / capture | 3.16 / 3.13 | 4.72 / 3.42 | +1.55 / +0.29 |
| Thread CPU per tick | 51.1 | 64.6 | +13.5 |
| ARM ×2.4, mean / p99 (extrapolated) | 163 / 300 | 199 / 353 | — |

**16 as published (contended host, wall/CPU 1.80–1.97; about 2× too high)** [16:67-99], [22:58-63]:

| Phase, mean ms | Med active | Med idle | Mig active | Mig idle |
|---|---:|---:|---:|---:|
| Tick mean / p99 / max | 198 / 464 / 851 | 154 / 357 / 1,038 | 206 / 497 / 1,063 | 154 / 334 / 852 |
| Routing (mean / p99) | 41.2 / 126 | 23.4 / 66 | 65.8 / 337 | 25.2 / 70 |
| Movement / combat / AI | 68.2 / 53.8 / 16.6 | 59.2 / 35.5 / 17.6 | 60.7 / 47.1 / 15.3 | 56.1 / 36.6 / 16.4 |

- **Idle seats.** The quiet idle-seat tick meets 125 ms on the desktop on mean and p95, not on p99 (147 ms). On ARM it is about 0.63× real time (×2.4, extrapolated); real time on ARM needs about 52 ms on the desktop, a −37 % cut [22:325-327]. 16's "480 stationary squads pay the full per-squad cost" is overstated: they add about 15 ms (+22 %) over all-AI [22:85], R3-idle-tick (inflation).
- **Active humans.** 198–206 ms is from the contended runs; quiet it is probably 110–150 ms (SUSPECT, not replayed) [22:250]. R2-P31's "0.25× on ARM" becomes about 0.4–0.5× (extrapolated) [22:252]. It must be measured on the A1 host with `scripts/profileV11Oracle.sh`, with thread CPU recorded.
- **Where the idle tick goes.** 342 of 365 movers per tick on Migration (431 of 461 on Mediterranean) are tribe squads on expansion marches at ticks 1,200–1,600; 139 of 178 at ticks 3,600–4,000 [22:132-141]. A moving squad costs 51–82 µs CPU per tick, a stationary one 16–18 µs [22:145-170].
- 8 Hz remains the right tick rate: per-second cost scales roughly linearly with Hz [06:205-213].

**Idle-tick plan (round 3).** Ordered by measured or bounded saving on (b). Shifts: `Simulation.ts` WT = HEAD +11 for these lines.

| # | Change | IDs | Saving on the idle tick | Files (HEAD) | Effort | Test |
|---|---|---|---|---|---|---|
| I-0 | Measurement hygiene, prerequisite: record thread CPU next to wall in diagnostics and perf scripts; flag runs with wall/CPU > 1.5; export live heap after GC. | R3-idle-tick (inflation) | none; prevents a repeat of 16's inflation | `serverMatchWorker.ts:86-107`, `RuntimeDiagnostics.ts`, `scripts/measureLateGamePerformance.ts` | S | unit test that diagnostics carry `cpuMs` and the wall/CPU ratio |
| I-1 | Bound tribe expansion walking: at most K concurrent marchers per tribe (K = 4–8), or border growth without walking for uncontested tiles. **Gameplay change: owner sign-off.** | R3-idle-tick (tribe walking) | measured −10.5 to −27.3 ms wall (K = 4: −19 to −28 %; K = 8: −12 to −16 %); tribes hold 7–20 % less land at minutes 3.3–5 [22:203-217] | `Simulation.ts:5211-5218` (march loop; WT 5222-5229), `HomeTerritory.ts:105` | S (cap) / M (border growth) | 52-faction fixture: no tribe has more than K squads on march-issued moves after N ticks, and tribe land ≥ an agreed share of baseline; perf contract: tribe movers per tick ≤ 30 × K at tick 1,600 on Mig 500 [22:331] |
| I-2 | Cheaper clearance for moving squads: skip `transportProposal` for land-only steps, memoise envelope and sweep bounds per (formation, tick), stop clearing the 8-candidate proof cache on every `spatialRevision`, drop the duplicate `transportProposal` call. | R3-idle-tick (clearance) | BOUNDED: clearance path 11.8 %, envelope work 7.8 % (overlapping); realistic 5–8 %, not measured | `Simulation.ts:2009, 2030-2039, 2074-2110, 3548, 3565-3579, 997`; `CombatGeometry.ts:35` | M | 400-tick squad-hash equality (baseline vs patched) and a counter test that envelope builds per tick fall |
| I-3 | Spatial-index maintenance: rebuild the movement grid once per phase boundary, or update moved squads incrementally, keeping id-sorted buckets. | R3-idle-tick (clearance) | BOUNDED: `SpatialGrid.rebuild` 5.9 %; realistic 3–4 % | `Simulation.ts:479-493`, `SpatialGrid.ts:34-70`, `Battle.ts:265` | M | hash equality over 400 ticks; `query` results stay id-ordered after incremental moves |
| I-4 | Planner selection and admission bookkeeping: per-class job counters (P36), in-place priority iteration (R2-P6). | P36, R2-P6 | BOUNDED idle 2–3 %; larger with active humans (perf rank 1) | `RoutePlanner.ts:368-430`, `MovementAdmission.ts:801-804` | S–M | existing planner fairness tests, plus a checkpoint hash test with the same job order |
| I-5 | Optional, last: a cross-phase dormant path (combat acquisition, damage, formation sync and movement walks) for holding, non-fighting squads with no hostile in range. Movement-only sleeping stays refuted. | R3-idle-tick (floor) | BOUNDED about 10–12 % (half of the 22–29 % all-phase floor) | `Battle.ts:651-653`, `Simulation.ts:3465-3629, 4583, 2176` | L | hash equality over a 400-tick idle fixture; a dormant squad wakes on the tick an enemy enters range |

Expected combined effect: I-1 (K = 4) + I-2 + I-3 ≈ −30 to −38 %, about 52–58 ms mean on the desktop, near real time on ARM (extrapolated) [22:338-341]. Not capacity levers (each inside the ±2–3 % A/A noise): P21's zero-damage skip, lazy `LandingOccupancy`, R2-P10's back-off. Keep them as hygiene; R2-P10 still matters for blocked 144-troop squads in combat [22:300-307], R3-idle-tick (micro-fixes).

**Other confirmed perf items, ranked by measured magnitude.** Ranks 1 and 2 were measured under active human load in 16's contended runs; their absolute ms are about 2× upper bounds, but the routing increase over idle is caused by active orders [22:309-313].

| Rank | Item | IDs | Measured | Files | Effort | Test |
|---|---|---|---|---|---|---|
| 1 | **Routing contention under human load.** The largest increase under active humans: the planner is monopolised by per-member interactive jobs, priority selection is O(P²), and budget is spent on refusals. Fix: per-human cap 16 and interactive cap 64, one job per cohort, two priority maps, refusal back-off. | R2-P3, R2-P6, P20 | routing +18 / +41 ms over idle (contended); 274–635 admissions pending; priority path 10–16 ms per tick (6–7 %) | `RoutePlanner.ts:520-532`, `MovementAdmission.ts:788-818, 946-969` | 3–4 days | 8-human gate (Roadmap Next #1); micro-benchmark P = 500 under 1 ms per call |
| 2 | **Mixed army / non-army move runs synchronous HPA\*** on the never-warmed amphibious graph (a single-tick stall). Route mixed selections through admission and cap cold trees. | R2-P2 | 309–535 ms at 500; 2,612 ms at 1000 (desktop) | `Simulation.ts:1480-1483, 1546` (WT 1489-1492, 1555), `HierarchicalPaths.ts:433-440` | 0.5–1 day | a mixed move returns ≤ 20 ms; amphibious `treeBytes` stays 0 |
| 3 | Failed reorientation retried every tick. Compute the assignment once and add `reorientRetryTick`. Does not move the idle tick (22); matters for blocked squads in combat. | R2-P10 | 6–11 % of the tick in 19's runs; up to 29 attempts per tick; 7–38 ms per 144-troop attempt | `Simulation.ts:2269-2273` (WT 2280-2284), `FormationGeometry.ts:113-120, 454-481` | 1 day | ≤ ⌈80/retryTicks⌉+1 attempts in 80 ticks; checkpoint equality |
| 4 | Synchronised melee strike spike (C6) | P11 | 26–50 ms per strike tick; 35–95 ms first contact | `MeleeDamage.ts:50-72`, `Battle.ts:621-622` | 1–2 days | 200 synchronised strikes ≤ 15 ms desktop warm, as a perf contract outside the suite |
| 5 | Raid `spatial.nearest` miss with no radius cap. Cache per (player, enemy) and add a radius. | P6 | 3.4 ms per miss (1000 map), 16 ms (2000); 10 due squads → 30–160 ms | `Simulation.ts:5163-5179` (WT 5174-5190), `SpatialGrid.ts:218` | 2 h | an embarked-only enemy causes no full-grid scan |
| 6 | Elimination transfers all territory in one tick; time-slice it | P37 | ~10 ms per 1,000 tiles; ~100 ms for 20k tiles | `Simulation.ts:5487-5495` (WT 5498-5506) | 2 days | eliminating a faction with 20k tiles: no tick spends > 25 ms in the transfer, and the final owner map equals the one-tick transfer |
| 7 | Synchronous route repair invisible to the effort limiter | P19 | not reproduced by the verifiers; reviewer saw 70–182 ms routing ticks | `Simulation.ts:604-612, 4087-4139` (WT 605-613, 4098-4150), `LocalDetours.ts` | 2–3 days | jam fixture: routing p99 bounded |
| 8 | `resolveLandDamage` extra passes (hygiene: the zero-damage skip alone sits inside A/A noise on the idle tick) | P21 | ~3,000 objects and 12k iterations per tick at S = 1,500; profile bound ≤ 1.5 % | `Simulation.ts:4579-4609, 4625-4631` (WT 4590-4620, 4636-4642) | 0.5 day | ledger-only iteration test; squad hash unchanged |
| 9 | Small items, below | see rows | as listed | see rows | hours each | see rows |
| 10 | `Diplomacy.hostile` memo | P5 | 2–3 % of the tick in organic play (1–2.5 ms); 35–60 % only in a synthetic run with injected embargo rows | `Diplomacy.ts:31-36, 125-127` | 1 day | do it as a pop-up prerequisite; pop-ups add war and embargo rows on a path called 2.7–22k times per tick |

| Rank 9 item | ID | Files | Effort | Test |
|---|---|---|---|---|
| Assault geometry recertified per strike | R2-P11 | see C5 | with C5 | with C5 |
| Anti-air scans all aircraft linearly | R2-P14 | `Battle.ts` aircraft path, `Expansion.ts:950-959`, `content/DroneSwarms.ts` | S | an airborne-grid query returns the same targets as the linear scan on a 200-aircraft fixture |
| Transfers rebuild all air bases per plane | R2-P13 | `Expansion.ts:1354-1362`, `AirBases.ts:12-14` | S | the per-tick bases map is built once per tick (counter); transfer outcomes unchanged |
| Planner rescans the job table per quantum | P36 | `RoutePlanner.ts:561, 586-594` | with I-4 | with I-4 |
| Capture row cache invalidated by any building placement | P38 | `Simulation.ts` capture environment key | investigate, 0.5 day | outcome = whether a per-region building revision restores row reuse (today 1,114 refreshed / 0 reused windows) |
| Template cache key includes `seed%16` | R2-P26 | `FormationGeometry.ts:689-699` | XS | unjittered shapes share one key across seeds |
| Any cost change cancels every in-flight corridor | R2-P28 | `HierarchicalPaths.ts:854-855`, `RoutePlanner.ts:751-772` | M | a cost change in a cluster the corridor never read does not cancel it |

**Also measured.**
- **Heap: the 384 MB cap is not a constraint over 10 simulated minutes, with idle or active humans.** 8 active humans (16): 237 MB used / 419 MB total at tick 5,600 [16:155]. 8 idle seats + 480 squads (22): peak `heapUsed` 309 MB, `heapTotal` 448 MB, live heap after a full GC 147 MB [22:223-231]. `heapTotal` reads above 384 MB because the cap applies to old space only [22:237]. 19's AI-seat-only figures agree: 128–147 MB live at tick 4,000, projecting to about 230 MB live at 60 minutes on Med 500 [19:136-155], [19:196-217]. Major GC costs 0.4–1.2 ms per tick, the same as uncapped [22:238]. The open risk: peak `heapUsed` approaches the cap only if live heap passes about 230–250 MB, which is near the 60-minute projection (extrapolated) [22:320]; no 60-minute run with 8 active humans exists, so watch it with I-0's live-heap export. Path trees are off-heap: 39 / 70 / 119 MB of `arrayBuffers` on Med 500 / Mig 500 / Med 1000. Budget host RSS for those, keep the cap, and do not shrink route caches: that frees about 0 MB [19:398-401].
- **Corridor warm-up is paced per tick.** `PATH_WARM_TREES = 4` (`Simulation.ts:189`, WT 190) gives 32 trees/s at 8 Hz against 120 at 20 Hz, so the Migration 1000 water gate opens at 10.7 minutes [19:285-299]. Fix: 15 trees per tick (120/s), or build the trees during `prepare`. Files `Simulation.ts:189, 802, 3410-3412` (WT +1/+1/+11). Effort XS. Test: the gate tick equals `ceil(portals/15)+1`, and on Mig 1000 the water gate opens by about 2.9 simulated minutes (10.7 / 3.75, derived).
- **The amphibious hierarchy is built eagerly but never warmed.** Build it lazily (first amphibious faction or first find), add it to residency diagnostics, and store `largestComponent` as an `Int32Array`; do not drop it, because synchronous finds over 48 tiles use it (R2-P25). Files `Simulation.ts:800, 804` (WT 801, 805), `serverMatchWorker.ts:96`, `Pathfinding.ts`. Effort 0.5 day. Test: no amphibious hierarchy exists before the first amphibious find; routes are hash-identical on an army-order fixture with legs over 48 tiles; diagnostics report amphibious residency.
- **Not recommended:** movement-only idle-squad sleeping, heap raises or allocation hygiene for GC, and two-tier cadence. Each rests on a refuted claim (see below) or on no measurement.

## Map generation (11)

| Problem | Measured | ID |
|---|---|---|
| Every procedural `prepare` at 2000 exceeds the 30 s worker timer (41.5–81 s desktop) and ends the lobby's match. At 1000 desktop takes 10.8 / 15.3 / 18.2 s (Migration / Continents / Black Forest); ARM ~27–46 s is unmeasured. | [11:69-76] | R2-P1 |
| Each spawn click reruns the whole 52-faction placement on the serial worker: 1.9 s per select on Black Forest 1000 and ~14.5 s at 2000, where three clicks exceed 30 s. | [11:82-87] | R2-P5 |
| The map hash depends on engine libm. All 13 maps matched in Firefox, Chrome and Edge, but with every libm result 1 ulp off, 6 of 120 maps hashed differently. There is no server-map fallback. | [11:54-63] | R2-M3 |
| Black Forest layout and spawn attempt 0 share one unsalted stream. | code | R2-L6 |
| Unlucky-seed throws end the match with no re-roll and no seed log (none found in ~900 samples). | sampled | R2-L7 |
| Large fields are copied 2–3 times; peak RSS ~500 MB at 2000. | — | R2-P12 |

| # | Proposal | Files | Effort | Test |
|---|---|---|---|---|
| G-a | Give `prepare` its own timeout (e.g. 150 s); hide 2000 in the lobby; warn on procedural 1000. | `ReservedMatchWorker.ts:68-72`, `LobbyDirectory.ts:87-92` | 1 h | a lobby cannot select 2000 |
| G-b | Hotspots with identical output: bounding box in the island stamp, hoisted `cos`/`sin`, a typed-array priority queue. | `MigrationLayout.ts:124-131`, `MigrationCoast.ts:105-106`, `TerrainPriorityQueue` | 0.5 day | hashes unchanged for fixed seeds; about −35–50 % generation time |
| G-c | O(local) spawn placement; one in-flight `select-spawn` per guest; start the timeout when the worker begins the request. | `StartingPositions.ts:16-37`, `LiveMatch.ts:510-523` | 0.5 day | Black Forest 1000 select < 10 ms |
| G-d | Salt the streams, retry bad seeds up to 3 times, log `{mapId, size, seed, mapHash, genMs}`. | `BlackForestLayout.ts:44`, `SpawnSelection.ts:115`, `serverMatchWorker.ts:138, 308` | 2 h | an injected generator throw retries with a derived seed |
| G-e | `DeterministicMath` for the generator path, a lint rule, and golden hashes. | new `DeterministicMath.ts`, ~121 call sites | 1 day | `MapIdentityGolden.test.ts`; Playwright Firefox/WebKit job |
| G-f | Byte fallback: serve the server's map blob over HTTP on a hash mismatch or at size ≥ 1000. | `OnlineMatchSession.ts:346-356`, server route | 1–2 days | a client with a perturbed libm still joins |

## Client and UX (07 + 17)

**Frame cost in real Chrome, 1,042 squads.** The machine was contended, so these are upper bounds [17:33-58].

| View | `renderer.draw` p50 / p99 | Split |
|---|---|---|
| Strategic zoom, whole map | 17.7–19.9 / 41–48 ms | ~60 % in per-squad pose and envelope rebuilt every frame (R2-P9) |
| Soldier zoom, scale 16, 202 detailed squads | 186.6 / 383 ms | choreography 90 ms + `drawImage` flush 86 ms (R2-P4) |
| Soldier zoom, scale 12, 273 squads | 297.8 ms p50 | 137 + 128 ms |
| Per publication | `renderer.update` 11–25 ms; structured-clone round trip 20–22 ms | — |

Incremental presentation (P1) saves about 10 ms per publication, about 5 % of the main thread. The renderer items are larger [17:60-66].

| # | Fix | IDs | Files | Effort | Test |
|---|---|---|---|---|---|
| U1 | Pass the local player id to `combatTargets`. | R2-M7 | `Renderer.ts:429` | XS | crosshairs test with `localPlayerId` 3 |
| U2 | Skip offscreen remains capture when not detailed, and cap the count. | R2-M8 | `TroopActors.ts:488-489` (`captureOffscreenLoss`; WT 496-497), `:819` (WT 835) | XS–S | zoomed-out 12 publications keep records ≤ cap |
| U3 | Clear aircraft on control-group recall; draw the selection box, previews and Paused label on the top layer; list the double-right-click charge in the controls popover. | M4, L5, L4 | `main.ts:1146-1153`, `style.css:169-184`, `HudView.ts:176`, `en.json` | XS each | client-controls test with aircraft selected |
| U4 | Memoise formation render poses per (squad, formation, integer tick). | R2-P9 | `Renderer.ts:1442-1497`, `FormationRenderPose.ts` | S | strategic `draw` p95 < 12 ms at 1,000 squads (harness, idle machine) |
| U5 | Detailed-soldier budget and choreography LOD, then `InstancedActorSprites` behind `SoldierDrawQueue`. | R2-P4, P10 | `TroopActors.ts:271-321, 896-1280` (WT 277-327, 912-1316) | S then M | soldier-zoom p50 < 33 ms with 200 squads on screen |
| U6 | Per-frame waste, nine items, below. | P7, P8, P9, R2-P21, R2-P22, R2-P23, R2-L13, P27, P28 | below | XS–S each | below |
| U7 | Pending-order overlay plus an acknowledgement sound. Units otherwise react 0.4–1.0 s after a click [07:98], plus 500 ms if the ranged delta's global delay ships (C11). | — (measured) | `main.ts`, `Renderer.ts` | S–M | the route line is drawn on the click frame; cleared on echo or after 2 s |
| U8 | Readability: 30 tribe colours have a minimum RGB distance of 8.1, with 34 pairs under 25. Add a diplomatic colour mode and relation outlines. | — (computed) [07:121-130] | `FactionColors.ts:44-48`, `TerritoryLayer.ts` | S / M | palette distance test |
| U9 | The 30-squad selection cap is silent. Add a toast and client fan-out. | — [07:111-119] | `SquadSelectionViewModel.ts:36-42` | S | selecting 80 squads issues 3 orders |
| U10 | A right-click on an own airstrip always transfers; let it fall through to a patrol. | — [09:261-271] | `main.ts:1831-1838` | S | patrol over own base possible |

U6 items (ledger lines, HEAD; `client/main.ts` lines can be off by up to about 5):

| Item | ID | Files | Effort | Test |
|---|---|---|---|---|
| Melee-volley map built per snapshot, not per visible squad | P7 | `Renderer.ts:1863` | XS | one volley map build per snapshot (counter) |
| Timeline sample cache | P8 | `CombatPresentationTimeline.ts:54-59, 96-131` | XS | `sample()` at an unchanged tick returns the same object |
| Hit-test grid | P9 | `Renderer.ts:634-668, 685-689`, `main.ts:1546` | S | `squadAt` equals brute force on random points; pointermove work independent of squad count (counter) |
| Spread cavalry re-plans across frames | R2-P21 | `troops/CavalryAssaultPresentation.ts:518-528` | S | at most N riders re-planned per frame |
| HUD markup cache | R2-P22 | `HudView.ts:43-48, 447-450, 568-576` | XS | an unchanged update writes no `innerHTML` |
| Placement preview only on revisions | R2-P23 | `PlacementPreview.ts:163, 190-201, 243-266`, `Renderer.ts:422` | S | an unchanged revision triggers no chunk re-diff |
| Berth clamp after carrier landing | R2-L13 | `AircraftGroundPresentation.ts:48-52, 71-84` | XS | a carrier landing frees the old airstrip berth |
| HUD redundant passes | P27 | `main.ts:878, 1114-1116`, `ControlGroups.ts:59-70` | XS | one squad pass per HUD update (counter) |
| `BuildingFacts.changed` fire-timer fields | P28 | `BuildingFacts.ts:3`, `Renderer.ts:491-541` | XS | a fire-timer change alone triggers no rebuild |

**8-human HUD plan.**

| Item | Blocks the playtest? | Files | Effort | Test |
|---|---|---|---|---|
| Defeat dialog and observer mode (13 R3) | **Yes** | `client/main.ts`, `HudViewModel.ts` | S | eliminated local player sees the dialog |
| Player list: connection, score, protection timer, age | Partly (with R1/R2) | `HudViewModel.ts`, `players` rows | S | view-model test |
| Chat and pings (a relayed, rate-limited server message, not a sim command) | No: use voice for the first friends playtest [13:333-336] | `CoordinatorServer.ts`, `main.ts` (reuse the `editingText` guard) | S each | rate-limit test |
| Minimap with alerts; all-faction diplomacy overview | No | new view, `TerritoryLayer` chunks | M each | — |
| RTS staples: attack-move, patrol, stances, rally points, idle cycling, edge scroll | No | `Protocol.ts`, `Controls.ts` | M total | command tests |

Source for the missing staples: [07:157-160].

## Confirmed latent bugs

Full entries: [08-latent-bugs.md](08-latent-bugs.md) (round 1) and [08e-round2-ledger.md](08e-round2-ledger.md) (round 2); round 3 below. Severities below are the verified ones; locations are HEAD lines per the conventions.

**Critical**

| ID | Bug | Where |
|---|---|---|
| R2-H1 | A follower admission dereferences a dead corridor lead, and `removeSquad` does not cancel admissions; the TypeError escapes `Skirmish.step` mid-tick and the match ends. It depends on admission state: 8 active humans hit it at ticks 3,000–3,200; the minimal repro at tick 7. | `MovementAdmission.ts:942`, `Simulation.ts:1227` (WT 1236) |
| R2-H2 (H3) | A charge fallback with off-map x/y throws in `map.ref`: one packet ends any match. Any marching non-cavalry squad qualifies, even an enemy's. | `Simulation.ts:1302-1304` (WT 1311-1313) |

**Containing a mid-tick throw (design for Roadmap Now #1).**
- R2-H1 throws inside `Skirmish.step` after some phases have run. R2-H2 throws inside `applyCommand` during `CommandApplications.apply`, which has only try/finally. Both end the match today (`LiveMatch.ts:661-662`).
- A catch that logs and continues is unsafe for both. After R2-H1 the world is half-ticked (some phases applied, others not). Before R2-H2's throw, order observers may already have mutated trench and stance state (R2-M10).
- Proposal, in order:
  1. Remove the known throws: guard `MovementAdmission.ts:942` and cancel a squad's admissions in `removeSquad` (R2-H1); bounds-check top-level and nested x/y/tile in `commandRejection` and restrict the column test to owned squads (R2-H2).
  2. Per-command containment only before mutation: run all validation (the R2-M10 fix) before any observer or write, and convert a throw raised during validation into a rejection with a fixed message. A throw after mutation begins counts as a tick fault.
  3. A tick fault never continues. Short term (S, 1 day): mark the match faulted, stop advancing, save the last good checkpoint and the command log since it for diagnosis, and end the match with a fixed string (L11). Medium term (M, 3–4 days): roll back atomically by restoring the last good checkpoint and replaying the logged commands up to the faulting tick, dropping the faulting command when the throw came from one; if the replay faults again, fall back to the short-term path.
  4. Rollback makes `Skirmish.restore` a live path; today the live server never calls it (R2-M12). R2-M11, R2-M12, L15, L18, L19, R2-L3 and R2-L15 must be fixed first.
  5. Checkpoint cadence: a checkpoint is 5.2–9.0 MB serialised at tick 4,000 [19:142-144]; its time is unmeasured. Investigate (0.5 day): `checkpoint()` time at about 1,200 squads; outcome = a per-tick checkpoint if it costs ≤ 5 % of the tick, otherwise every N ticks plus replay.
- Test: a fault-injection test that throws from a chosen phase at tick T. After recovery the state hash equals an uninterrupted run without the faulting command, or the match is faulted with diagnostics saved. No `step()` ever runs on the half-ticked world.

**High**

| ID | Bug | Where |
|---|---|---|
| R2-H3 | A move order on engaged cavalry keeps it withdrawing, so it never fights back (regression). | `Simulation.ts:3742-3749` (WT 3753-3760), `Battle.ts:710` (WT 727) |
| R2-H4 | The siege breach is unreachable for a fully walled target. | `AiArmyPlanner.ts:448-453`, `Armies.ts:217-224` |
| R2-H5 | The repair state machine livelocks; AI ships are lost permanently and hold their port's repair slot. | `Simulation.ts:3238-3242, 3286-3297` (WT +11) |
| H1 | Every client recovery triggers another full baseline. | `ClientStateFlow.ts:21-23` |
| H2 | Neutral (owner-0) towers become permanent, indestructible obstacles. They are never capturable, which also answers 03's open question 5. Fix row B-1. | `Fortifications.ts:102-107`, `Simulation.ts:5467, 5498-5499` (WT 5478, 5509-5510) |
| H4 | Working-tree test regressions. Superseded by 10 and 21: see "Repository state and test baseline". | — |

**Medium**

| ID | Bug |
|---|---|
| R2-M1 (H5, lowered) | The AI 100-kit floor delays strategic payloads (`AutomaticProduction.ts:203`, committed in HEAD). |
| R2-M2 (M10) | The doctrine compiler rejects 20 of 24 mounted variants; nothing runs the compilers. |
| R2-M3 | The map hash depends on engine libm. |
| R2-M4 | Point launches and sorties skip diplomacy. |
| R2-M5 | Any fighting member freezes the army's advance (`Armies.ts:1148`). |
| R2-M6 (M2) | One annihilated army disbands its sibling armies (`AiArmyPlanner.ts:313`). |
| R2-M7 | Crosshairs show player 1's targets (`Renderer.ts:429`). |
| R2-M8 | Remains records grow while zoomed out. |
| R2-M9 | Occupy suppresses another faction's skirmish stance (`Expansion.ts:439`). |
| R2-M10 (M11) | Order observers mutate trench and stance state before rejection (`Simulation.ts:1467-1468`, WT 1476-1477). |
| R2-M11 | Transport landing and refits leave live states that fail the restore validator (`TransportHandoff.ts:67`, `Simulation.ts:1197`, WT 1206). The same validator runs on decoded squad details; client exposure untraced (B-3). |
| R2-M12 | An engagement cursor fails its own validator at a quantum boundary (`EngagementManager.ts:625`). Fix row B-4. |
| R2-M13 | Early Medieval warships stall as 1-HP ships dealing 0 damage. |
| R2-M14 | Naval research sends whole fleets to port. |
| R2-M15 | The AI buys 25 % dearer identical submarines. |
| M1 | Fleet missions abort at 120 s. |
| M3 | Human armies are orphaned after an AI handover. |
| M4 | Control-group recall leaves aircraft selected. |
| M5 | Parsing and Zod run before the rate limit; abusive sockets are never closed. |
| M6 | Resync has no cooldown. |
| M7 | A failed match initialisation is silent and strands the players. Fix row B-2. |
| **M8** | `cancelSync` deletes a newer admission of the same guest (`LiveMatch.ts:466-469`). |
| M9 | `docs/` is gitignored. |

Medium perf entries are in the performance and network tables: P1–P21, R2-P2 through R2-P10.

**Low (selected; the full list is in the ledgers)**

| ID | Bug |
|---|---|
| **L3** | A naval mission parked in recover never re-checks its credit (`AiNavalPlanner.ts:575`). |
| **L6** | Timeline frames share the latest ownership buffers. Latent; document the contract (`PresentationState.ts:45`). |
| **L10** | Duplicate-tab and quick-reload cases show misleading 4001 messages (`OnlineLobbyConnection.ts:102-114`). |
| **L12** | No cap on sockets or queued rooms, and directory fan-out is O(sessions × state) (`CoordinatorServer.ts:213-226`). |
| **L13** | A worker that dies during an empty pause goes unnoticed until the grace period expires. Fix row B-5. |
| **L15** | `LocalAvoidance` checkpoints CrowdRecovery but restores it empty; `AiRecovery` saves `known` but never reads it (`LocalAvoidance.ts:116, 125-126`). |
| **L20** | A Shift-queued replenish activates on non-friendly land and never finishes (`Simulation.ts:1488-1512`, WT 1497-1521). |
| others | L1, L2, L7 → R2-L1, L8, L9, L11, L14, L16, L17, L18, L19, L21, L22, L23, L24; R2-L2 to R2-L19 (R2-L5: `RussianTroopSources` hashes depend on the CRLF checkout; R2-L16: the 3,000-tick cohort deadline is now 375 s). |

**Fix rows for confirmed bugs without a row elsewhere.**

| # | Fix | IDs | Files | Effort | Test |
|---|---|---|---|---|---|
| B-1 | In `checkWinner`, when the recipient is 0, remove the victim's defensive buildings (and call `fortifications.forgetBuilding`) instead of re-owning them to 0. Belt-and-braces: `Fortifications.blocked` ignores owner-0 towers and walls, and `canAttackStructure(a, 0)` is true so stray neutral defences can be cleared [08b:150]. | H2 | `Simulation.ts:5467, 5498-5499` (WT 5478, 5509-5510), `Fortifications.ts:102-107`, `Diplomacy.ts:40` | 0.5 day (08b: about 1 h + tests) | a `BlastOwnershipLifecycle`-shaped raid-mode test with a tower: after the victim is eliminated with recipient 0, the tower is gone or attackable and its tile is capturable |
| B-2 | Show requestId-less errors (or a dedicated `match-failed` message) in the lobby, and put the members back in their room when initialisation fails. | M7 | `CoordinatorServer.ts:475-482`, `OnlineLobbyConnection.ts:79-86`, lobby `main.ts:296-298`, `RoomCoordinator` | 0.5–1 day | a `prepare` that rejects: every member sees the failure in the lobby and is back in its room; a custom room is not deleted |
| B-3 | Fix: at `TransportHandoff.ts:67` keep `deployedShape: intent==='column' ? (old.deployedShape ?? formationDoctrine(id).defaultShape) : intent`; store the same `eligibleShape` result in the refit branch. **Check (client exposure):** decode a publication carrying a squad in the R2-M11 state through the client's state-worker decode, which reaches `SnapshotDetails.ts:515` / `SnapshotCodec.ts:487`. | R2-M11 | `TransportHandoff.ts:60-74`, `Simulation.ts:1195-1197` (WT 1204-1206); check: `multiplayerStateWorker.ts`, `SnapshotDetails.ts:515` | fix 0.5 day; check: investigate, 0.5 day | fix: an end-of-tick `validateFormation` assertion in tests; the landing-column and refit repros pass; check outcome = whether the client throws, requests a baseline (feeding H1's loop), or ignores the squad |
| B-4 | Clear `j.projections` together with `memberIds` and `enemyIds` when a quantum ends after one army's plan. | R2-M12 | `EngagementManager.ts:625` | 1 h | two opposing armies (14 and 29 squads) with checkpoint → restore every tick: no "Invalid engagement planning cursor" |
| B-5 | Expose `lifecycle` or an `onExit` hook on `MatchExecutor`, and end the match when it fires (or check it at the top of `advance()`). | L13 | `ReservedMatchWorker.ts:58-59`, `LiveMatch.ts:639-646` | 0.5 day | terminating the worker during an empty pause ends the match within one advance, and the lobby no longer lists it as paused |

## Round 3 additions

Verified in round 3; no ledger ID yet. Lines are WT unless marked; to get HEAD lines subtract the shifts in the citation conventions (`Simulation.ts` −1 below WT 1190, −9 to WT 1712, −11 above; `Battle.ts` −1 to WT 567, −17 for WT 584–957, −18 for WT 959–1081, −21 from WT 1085).

| Label | Finding | Where | Severity | Status | Fix row |
|---|---|---|---|---|---|
| R3-ranged-delta (re-issue) | Re-issuing the same attack order cancels the ranged aim; repeated clicks stop the squad firing. Modern infantry baseline is 70 shots in this tree; every 6 ticks, 39 vs 84 in the second verifier's fixture. The `finishOrder` → hold variant (`:1775`) was traced, not tested. | `Simulation.ts:1705` (via `applyCommand` `:1591`; exemption at `:1195`) | medium | confirmed | C9 |
| R3-ranged-delta (anti-air) | Anti-air re-picks the nearest aircraft every tick; 4+ fighters in patrol orbit (`Expansion.ts:1302-1311`) silence it. Drone swarms and bomber streams are not affected. | `Battle.ts:831-845`; `RangedPreparation.ts:33-37` | high | confirmed | A5 |
| R3-ranged-delta (army march) | Army slot moves re-issued through `setArmyMove` → `activateOrder` cancel every aim; ranged members fire 0 shots on a manual march. The `updateSquad` writes at `Armies.ts:927`/`:969` were not seen to cancel. | `Simulation.ts:1705`, `:3863`; `Armies.ts:182`, `:834`, `:866`, `:1082` | medium–high (verifiers split) | confirmed | C10 |
| R3-ranged-delta (released history) | Released ranged history rides every emitted squad detail until overwritten: +8.5 % raw / +5 % gzip on steady combat delta packets, +1–3 % on baselines. | `domain/RangedPreparation.ts:6-12`, `SnapshotDetails.ts:145` | low | confirmed | N10 |
| R3-ranged-delta (carrier tech) | HEAD has two committed test failures: `rus-earlymodern-aircraft-carriers` is missing from `skirmish/plans/technology-plan.json`. Planner drift; runtime `validateTechnologies()` passes. | `tests/skirmish/RusPackagedRuntime.test.ts:30`, `InfrastructureRework.test.ts:29` (HEAD = WT) | low | confirmed | commit plan step 1 |
| R3-idle-tick (inflation) | 16's tick times are about 2× inflated by host oversubscription; the stationary-squad attribution is overstated (+22 %, not the full per-squad cost). The active-human figure was not replayed. | `review-notes/16-load-test-8-humans.md:73`, `:83-84`, `:91`; R2-P31 | medium (doc and capacity correction) | confirmed | I-0; Performance baseline |
| R3-idle-tick (tribe walking) | Tribe expansion walking is the largest lever found on the idle tick: −25 to −32 ms with no marches, −16.5 to −27.3 with a 4-cap, −10.5 to −15.2 with an 8-cap (wall); at maximum lobby load, a gameplay trade-off. | `Simulation.ts:5222-5229` (entered via `:5164`, `:5207-5212`); `HomeTerritory.ts:105-135` | high at maximum load | confirmed | I-1 |
| R3-idle-tick (floor) | The all-phase idle-army floor is about 16 µs CPU per stationary squad (15.9–18.4, from one 800-tick run), about 2× the refuted movement-only floor; 22–29 % of the idle tick at about 1,000 stationary squads. | `Battle.ts:668-670`; `Simulation.ts:4590`, `syncFormationCounts` at `:3481`, `:3663`, `:4636` | low (bounded lever) | confirmed | I-5 |
| R3-idle-tick (clearance) | Moving-squad clearance certification and envelope and geometry-key rebuilds cost about 1/5 of the idle tick; the 8-candidate proof cache clears on every `spatialRevision`. | `Simulation.ts:3576-3590`, `:2041`, `:2085-2121`, `:998`; `CombatGeometry.ts:35` | medium | confirmed | I-2, I-3 |
| R3-idle-tick (micro-fixes) | P21's zero-damage skip, lazy `LandingOccupancy` and R2-P10's back-off do not move the idle tick (inside A/A noise). | `Simulation.ts:4594` | low | confirmed | Performance note |

## Repository state and test baseline

**State** [21:38-63]. HEAD is `0d1783ce` ("pre-ultra", 2026-10-16 05:23; 257 files, +27,174 / −1,531); its parent `e63a0730` is the commit round 2 compared against. HEAD commits the whole round-1/2 bundle: the freeze fix (`Trade.ts:346`), rules version 12 (`Manpower.ts:5`), `WeaponAccuracy`, `MeleeDamage`, `CavalryAssault`, `AirfieldCapacity`, `TradeCargo`, `content/UnitTuning.ts` + `unit-tuning.json`, one-shipload port storage (`Supply.ts:139`), tribal operations on by default (`AiOperations.ts:99-101`), the AutomaticProduction troop target (`AutomaticProduction.ts:203`, R2-M1) and the carrier, drone and airbase work. The "untracked but imported" hazard of [09:295-306] is closed for those files.

The uncommitted working tree is the ranged-preparation delta: 25 tracked files (+256 / −63) and 10 untracked files (1,621 lines) [21:41-51]. Tracked edits import untracked files (`Battle.ts:13`, `Simulation.ts:24`, `content/Units.ts:28`, `TroopActors.ts:16`), so committing only the tracked files breaks the build [21:265-270].

| Run | Tree | Files / tests | Failed | Source |
|---|---|---|---|---|
| Round 3, full skirmish suite (scratch copy of the WT) | WT | 2,622 tests | 27: the 9 assertion failures of run A + 2 carrier-plan failures + 7 hard-cap timeouts + 9 scratch-copy artefacts (pass live) | [21:32] |
| Round 3, run A (19 targeted files) | WT | 19 / 189 | 9 | [21:30] |
| Round 3, run B (17 targeted files) | HEAD | 17 / 162 | 13 = round 2's 13 | [21:31] |
| Assertion failures, HEAD | HEAD | — | **15, inferred**: round 2's 13 + `RusPackagedRuntime:30` + `InfrastructureRework:29` (both introduced by `0d1783ce`); no full-suite HEAD run | [21:63], R3-ranged-delta (carrier tech) |
| Assertion failures, WT | WT | — | **11**: run A's 9 + the 2 carrier failures (21's "9 at the working tree" [21:303] omits the carrier pair) | [21:30-32] |
| Round 2, full suite (that tree is now HEAD, less later edits) | round-2 tree | 368 / 2,639 | 25 files / 30 tests (17 timeouts + 13 assertions) | [10:16] |
| Round 2, `e63a0730` in isolation | `e63a0730` | — | 5 tests (RussianTroopSources × 3, 2 map hard caps): `e63a0730` was effectively green; HEAD is not | [10:19] |
| `tsc --noEmit` | WT | — | 0 errors | [21:33] |
| oxlint | round-2 tree | — | 161 errors (`e63a0730`: 157), all `prefer-nullish-coalescing`; not re-run in round 3 | L23 |

**The 11 WT assertion failures, and what the delta changed** [21:178-196]:
- **Now pass, justified:** `Ages:340` (stale literal rewritten to the authored 15 rpm javelin) and `PresentationTuneUps:112` (adds the missing accuracy term).
- **Now pass, masked:** `FormationPerformance:144` and `:167`. Their single step ends before the delayed volley; rewrite them to step past the longest aim (≥ 8 steps) (C3).
- **Still failing, unchanged by the delta:**
  - Code: `AiLateGame:142` (R2-M1), `SoldierDetailMode:86` (L24).
  - Content vs validator: `FlexibleFrontage:73` (R2-M2).
  - Content vs contract: `CombatPresentation:65` (RPL-20 HP; owner decision).
  - Fixtures: `ResponsiveGameplay:119` (L22); `RiverExpansion:89` (reads a world frozen after the tribe wins at tick 747; flipped by the Stone-infantry retune, R2-L4).
  - Stale literals: `FormationRepairContracts:37`, `TechnologyDetails:27`.
  - Admitted: `PreModernBalance:72` (axemen 36 > 33 in the WT, 39 at HEAD; R2-L2).
  - Planner drift, also at HEAD: `RusPackagedRuntime:30`, `InfrastructureRework:29`.

**Commit plan (fix-forward from HEAD `0d1783ce`).** The round-2 advice to split out a freeze hotfix is moot: the freeze fix is committed (`Trade.ts:346`).
1. Fix HEAD's carrier-plan failures: add the `rus-earlymodern-aircraft-carriers` node (slot 6, naval, prerequisites ship-improvements and bombers) to `skirmish/plans/technology-plan.json`, or mark the tech optional. XS. Exit: both tests green.
2. Before committing the ranged delta: C9, C10 and A5, and rewrite `FormationPerformance:144/:167` (C3's acceptance). Then commit the 10 untracked files together with their importers in one commit.
3. Apply 10's per-test green plan to the remaining failures [10:199-219]: raise the skirmish `testTimeout`, lift the map caps, normalise CRLF for `RussianTroopSources`.
4. Get explicit owner decisions on: one-shipload port storage; Napoleonic volley lethality (unchanged by the delta); tribal campaigns on by default (in HEAD; put them behind a flag until R1 lands); Modern RPL-20 HP; 16 horses for bronze cavalry; the medieval 40/50 recipe; the 500 ms global presentation delay (C11); the tribe march budget K (I-1).

## Refuted, do not chase

Round 1 ([08-latent-bugs.md](08-latent-bugs.md), 24 rows):
- `Expansion.snapshot` discards metadata it built: unrevisioned keys are sent, not discarded.
- Authenticate-path rollback loses concurrent mutations: no interleaving is possible.
- Combat floats and fractional tick constants are a defect: single host, Node pinned.
- `hybridAcquisition` caches stale `Squad` references: correct today, 0 mismatches.
- The invasion response steals army-mission squads: the roster skips army members. So there is no "lease priority" fix; only M2's `releaseMission` stands.
- The `AiOperations` candidate cursor over `world.players` is unsafe: players are append-only.
- `restore()` tests fail across the jsdom realm: only under the root jsdom config. No realm-safe typed-array check is needed.
- Restored `AiRouteQuotes` stall: planner jobs are checkpointed.
- Movement is O(all land squads): holding squads cost 2.5–4 ms vs 14–23 ms marching at 1,000 squads. No movement-only idle-squad sleeping project. (Round 3 agrees on the movement-only floor; the all-phase floor is a separate, bounded lever, I-5.)
- AI frontier `aiFootprintAllowed` scan: O(1) under raids-v1, about 0.05 ms per tick.
- GC pressure under the 384 MB cap: major GC is 0.5–1.8 % of the tick and the live heap is about 100–115 MB. Neither a heap raise nor an allocation-hygiene project is justified.
- `changeOwner` leaves tiles to an eliminated faction: buildings always share the tile's owner.
- Ctrl+digit is swallowed by the browser: not a reserved accelerator.
- Owner-0 buildings crash consumers: every consumer skips owner 0.
- `moveDestination` trusts client `y`: 0 bad orders in the repro.
- `Expansion.snapshot` mutating the Roads cache: a pure memo; hygiene only.
- `states[owner].completed` in Trade as a freeze risk: no caller can pass such an owner.
- Bulk re-own of mixed-owner stacks: mixed stacks cannot be created.
- Restored float reproducibility across V8 versions, for restored checkpoints: no checkpoint is compared across engines. (Generated maps are compared across engines; that is R2-M3, confirmed.)
- `localeCompare` / `CONTENT_HASH` ICU dependence: ASCII keys, one host.
- `TradePublication` revisions reset on restore: the encoder deep-compares.
- Disconnect handover order not journaled: the effects commute.
- `states[owner].completed` in Supply "is exactly what would trigger the next freeze": hardening only.
- `hybridContacts` guard removal needs measuring: the same 17 units already ran it at `e63a0730`.

Round 2 ([08e-round2-ledger.md](08e-round2-ledger.md), 17 rows):
- Aircraft lost with their base are not counted as losses: no aircraft loss counter exists.
- Float trigonometry in flight: server-authoritative.
- Carrier aircraft have no ground presentation: `CarrierAircraftPresentation` handles them.
- Player-id range exhausted: nothing spawns at runtime; a nomad design input (14 R-0).
- `deployPlayer` is not atomic: called only from the constructor.
- New faction kinds inherit nation or tribe rules: `FactionKind` is a closed union today.
- Ships do not count for survival: the documented, tested rule.
- Prizes captured by an owner without a market never complete: the intended wait-for-receiver design.
- The candidate scan and sleep key scale with lifetime players: the roster is fixed.
- Faction-name decks throw when exhausted: draws are capped.
- `thinkCapabilities` strips siege squads from armies (15 T7): the two paths never meet with `aiEconomy` on.
- Human admissions never expire, so 33–45 % of their work is superseded: supersede cancels in the same tick; the counts measure order churn. No "coalesce admissions" fix.
- `TechnologyViewModel` empty-tree crash: validated at module load.
- Lab `battleDefinition` / `rankLaunchSpacing`: no producer; the migration is tested.
- An army planning-cap rejection cancels the army's plan: the cancel frees the slot first.
- `CohortAdmission.start` refuses at 128: every caller cancels first.
- `withinShoreline` fails open on NaN: production passes `softDepth` 0.

Also measured as not worth doing:
- Halving `ROUTE_CACHE_TILES` / `START_TREE_CACHE` frees about 0 MB of capped heap [19:151].
- 06's "raise the worker heap to 512–640 MB" is unnecessary [19:398-401], [22:315-321].
- The `Diplomacy.hostile` memo is not a top perf item in organic play (P5).
- P21's zero-damage skip, lazy `LandingOccupancy` and R2-P10's back-off as capacity levers for the idle tick [22:300-307].

## Roadmap

**Now (this week and next)**

| # | Item | IDs | Exit criterion | From |
|---|---|---|---|---|
| 1 | Match-killers and containment. Guard `MovementAdmission.ts:942` and cancel admissions in `removeSquad`; bounds-check x/y/tile in `commandRejection` and restrict the column test to owned squads; validation-only per-command containment; a tick fault is never continued (short-term faulted-and-end path, see "Containing a mid-tick throw"). Run the B-3 client-exposure check. | R2-H1, R2-H2, R2-M10, R2-M11 (check) | `MovementAdmissionCorridorLeaderDeath.test.ts` green. A bounded `CommandFuzz.test.ts` (about 1,500 commands, about 20 s) in the suite with 0 match-ending throws. The fault-injection test passes (no step on a half-ticked world). The 8-human harness completes 10 simulated minutes on Med 500 and Mig 500 with 0 exceptions. B-3 check outcome recorded. | 16, 18 |
| 2 | Gate (S1) and the ranged-delta commit: carrier plan fix, C9, C10, A5, `FormationPerformance` rewrite, one commit with the untracked files. | S1, M9, M10, L16, R3-ranged-delta (re-issue, army march, anti-air, carrier tech) | `npm run check` exists and is green on the new commit except the listed green-tree items; `RangedPreparation.test.ts` covers re-issue every tick, an army march under fire, and the 4-fighter orbit. | 01, 21 |
| 3 | Green tree | R2-M1, R2-M2, R2-L4, L22, L24, R2-L5 | `npm run test:skirmish` on a frozen snapshot: 0 assertion failures except `PreModernBalance:72` as `it.fails`; 0 timeouts with `testTimeout` 30 s and the map caps lifted; `tsc` 0 errors; oxlint ≤ 157. | 10, 21 |
| 4 | Network and server safety | H1, M5, M6, M7, M8, P18, L11, L13 | A rebased-baseline ack gives exactly 1 `client-baseline`. A second resync within 2 s is refused. A 512 KB junk frame is rejected before `JSON.parse`. 2 missed pongs are tolerated. Terminal messages are a fixed string. A rejecting `prepare` returns players to their room with a visible error (B-2). A dead worker in an empty pause ends the match within one advance (B-5). | 02, 02b |
| 5 | Side-effect-free rejections and rule exploits | R2-M10, R2-M9, R2-L14, R2-M4, H2 | The fuzz oracle "rejected ⇒ state digest unchanged" passes. The occupy-stance repro keeps `suppressed:false`. A peace-protected point launch is rejected. An eliminated faction's tower with recipient 0 is gone or attackable and its tile capturable (B-1). | 18, 12, 08b |
| 6 | XS client fixes | R2-M7, R2-M8, M4, L5, L4 | U1–U3 tests green. | 17, 07 |

**Next (the following month)**

| # | Item | IDs | Exit criterion | From |
|---|---|---|---|---|
| 1 | Routing and spike fixes (perf ranks 1–3 and 5), plus warm-up per second | R2-P3, R2-P6, P20, R2-P2, R2-P10, P6 | Committed `tests/skirmish/perf/EightHumanLoad.ts` (from 16's harness), run on a quiet host with wall/CPU ≤ 1.5, on Med 500 and Mig 500: tick mean ≤ 1.15× the idle-seat control; planner window-mean < 100; admissions pending < 150; move-commit p95 < 16 ticks; no desktop tick > 250 ms from routing. Then **one run on the Oracle A1 host** with thread CPU records ARM mean and p99 at 52 factions with 8 active humans. This settles R2-P31. | 16, 19, 22 |
| 2 | Idle-tick plan I-0 to I-3 (I-1 after the owner chooses K or border growth) | R3-idle-tick (inflation, tribe walking, clearance), P36, R2-P6 | Quiet desktop, Mig 500, 52 factions with 8 idle seats + 480 squads, ticks 1,200–6,000: tick mean ≤ 58 ms and p99 ≤ 125 ms (today 82.9 / 147), wall/CPU ≤ 1.5, squad-hash equality for I-2 and I-3; diagnostics carry thread CPU and live heap. Repeat on the A1 host. | 22 |
| 3 | Playtest blockers (13 R1–R4, minimum forms) | — (measured) | Nightly probe on 3 seeds: ≥ 6 of 8 AI-driven human seats alive at minute 10 (relaxed: 8/8). Every match ends by score at the time limit or by "no living human". Eliminated seats do not keep a match alive. | 13 |
| 4 | Network and client CPU (N4–N6, N10, U4, U5 budget) | P1, R2-P8, P12–P15, R2-P7, R2-P9, R2-P4, R3-ranged-delta (released history) | 8-human Med 500: ≤ 5.0 publications per simulated second; ≤ 330 KB/s per client at full speed; saturated forwarding ≤ 20 ms; client cost per publication ≤ 20 ms mean; the N4 bench recorded. Chrome harness on an idle machine: strategic `draw` p95 < 12 ms at 1,000 squads. | 16, 17, 02 |
| 5 | AI fix-first list I1–I11 and tactics T-a to T-d | R2-H4, R2-M5, M2, M1, M3, L1, R2-P19 | `AiBattleCompetence.test.ts`: AI vs attack-nearest ≥ 2/4; AI-vs-AI contact ≤ 30 s and decided ≤ 150 s; ≥ 1 charge bonus in a 60 s Late Medieval duel; walled-city breach ≤ 30 s. `AiLateGame` green. I5's 300 s patrol test green. | 15, 04, 04b |
| 6 | Naval V1–V3 | R2-H5, R2-M13, R2-M14, R2-L19 | `NavalBalance.test.ts`: same-age 1v1 in 15–30 s in every age; a 1-HP ship deals ≥ 1; interrupted recovery reaches full health ≤ 90 s; an idle warship declares no entry war. | 20 |
| 7 | Combat C1–C3, C5 | R2-H3, R2-L1, L8, R2-P11 | The id-swap duel is identical; the crowded fixture keeps > 1,900 fighting after 8 steps; the Napoleonic and Modern contract rows pass. | 09, 10, 05, 21 |
| 8 | Map generation G-a, G-c, G-d | R2-P1, R2-P5, R2-L6, R2-L7 | 2000 is not offered. Black Forest 1000 select < 10 ms. `prepare` at 1000 for all three procedural maps measured on A1 and under its timeout. The seed is logged on failure. | 11 |
| 9 | Balance table rows (age-up gate, trade tariff, stacking, refits, tribe opening, content decisions), the pacing probe, and `BalanceMatrix.test.ts` | — (measured) | The listed contract tests pass; the pacing table is recorded; BalanceContract.md updated. | 05, 13, 20 |
| 10 | Lifecycle bus (S4) and restore validity (B-3 fix, B-4, L15, L18, L19, R2-L3, R2-L15), then the rollback form of containment | L1, M3, R2-M11, R2-M12 | The checkpoint-purity property test is green; checkpoint → restore every tick passes on the fuzz fixtures; the fault-injection test passes with rollback. | 01, 14, 18 |

**Later**

| # | Item | Exit criterion | From |
|---|---|---|---|
| 1 | Pop-ups: R-0 prerequisites (6–8 days), PLAN.md nomads (19–27 days, editor estimate), then pirates with `AiPiratePlanner` (10–13 days, editor estimate) | T1–T16 green. T17 as restated: on the quiet desktop, 6 pop-ups ≤ +10 % and the full pop-up budget ≤ +20 % tick mean. The deterministic pop-up squad budget (start 60) is enforced. An ARM run with 52 factions + 6 pop-ups is recorded. | 14 |
| 2 | Seam extraction (S5), `Protocol.ts` split, legacy ruleset and host stack deleted (S2, S3) | Per seam: suite green and fixture checkpoint hashes identical before and after. | 01 |
| 3 | Air balance and AI air (A1–A4) | `AirBalance.test.ts` rows (a)–(f) green; AI airstrip built within 10 minutes when at war in a Modern-start probe. | 12 |
| 4 | Land–sea interplay, boarding and naval economy (V4–V6) | the V4–V6 tests green; pirate counterplay present before pirates ship. | 20 |
| 5 | Fog of war with interest management (R6, N9) | Property test: a per-viewer encode never contains an entity outside the mask. Bytes per client −60 % at 20 % viewport coverage. | 13, 02 |
| 6 | Instanced soldiers and choreography LOD (U5, second half) | Soldier-zoom p50 < 33 ms with 200 detailed squads on screen. | 17 |
| 7 | Attrition (R5), national powers (R7), pacing tuning (R8), morale (C8) | `Attrition.test.ts`; per-power quote tests; leaders reach Modern at minute 55–65 in the pacing probe. | 13, 03 |
| 8 | Deterministic map math and the byte fallback (G-e, G-f) | `MapIdentityGolden` green in Firefox and WebKit. | 11 |
| 9 | 8-human HUD: chat, pings, minimap, diplomacy overview, RTS staples | Per-item tests; a public lobby opens only after chat and pings exist. | 07, 13 |
| 10 | Optional cross-phase dormant path (I-5) | Hash equality on a 400-tick idle fixture; dormant squads wake on the tick an enemy enters range; ≥ 8 % off the quiet idle tick, else drop it. | 22 |
