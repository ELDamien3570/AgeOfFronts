# Sea-trade implementation validation

Worktree: `C:/Users/Damien/.codex/worktrees/sea-trade-lanes/AgeOfFronts`

Branch: `codex/sea-trade-lanes`

Base: `ea9514b1e40420aca9336dbbf583370301e1e52b`

Implementation, functional qualification and serial timing are complete. The total-CPU gate is missed; activation remains an owner decision. Routing is still opt-in (`seaTradeRouting: "lanes-v1"`). Normal factories are unchanged. The owner subsequently requested an isolated Oracle test deployment; see `2026-10-21-oracle-sea-trade-test-plan.md`. Production defaults remain unchanged. No merge or deployment has occurred.

The original checkout's concurrent UI/results, blast-diplomacy and aircraft edits are untouched. Shared-file overlap includes Trade's new `ownersInBlast`, Simulation's `tradeOwnersInBlast` and Expansion's blast permissions/aircraft recruitment. A read-only tracked patch `git apply --check` succeeds, with no new implementation file-name collisions (`out/sea-trade/integration-preflight.json`). Future integration must preserve those edits.

## Implemented contracts

- One match-local undirected water-lane registry shares typed geometry across owners and both directions. Permission, cargo, intake, tariff and payment stay live Trade decisions.
- Bounded removable queues, indexed heaps, copying, discovery, management, geometry and reference counts. Ready departures attach outside the existing 40-item management allowance. Copy work charges the existing routing budget.
- At most eight candidates. Two retained source-market hints survive view retirement. Exploration preserves eventual receiver coverage with zero/one/two hints and a reserved pending receiver slot. Allies win among nearby ready routes.
- Extra stops use ready cached geometry only. Home uses a ready direct lane or physically retraces the retained voyage and interrupted prefix. Imported legacy shipments keep their explicit return-search exception until their next load.
- Full loads, source debit, receiving intake, tariffs, payout, capture/salvage, physical no-repeat and eight-stop rules remain authoritative. Intake waits retain useful pending/ready geometry. Captures preserve cargo and existing eligibility/handling rules.
- Scheduler v7 balances land/water and paid/unpaid admission with finite canonical demand leases, active pools and idle-capacity lending. Total work/human reservations are preserved; omitted-option matches retain v6.
- Private paths/cursors stay out of trader publication. Public waits distinguish market capacity from route capacity. Restore validates bounded envelopes, cursor metadata, geometry, references and planner links.
- The approved lossless AI minimum repair represents unobserved score/port-distance/target-distance minima as missing values compared as infinity. Legacy positive infinity migrates on restore. Finite values and codec limits are preserved.

The user approved shared-planner scheduling, the AI checkpoint repair, cached-only extra stops, and preserving CPU limits with documented first-use cold delay. The cold-only five/15-second target is an accepted exception, not a passing SLA. The larger fresh-run tail below must be explicit before default activation.

## Mature functional qualification

Each mature run warms 2,400 ticks and measures 4,800 ticks (five plus ten game minutes). Concurrent functional wall times are not isolated speedup measurements.

| Metric | 45-minute input | 60-minute input |
| --- | --- | --- |
| Final tick | 28,800 | 36,000 |
| Recurring reuse | 9,789 / 9,816 (99.725%) | 13,481 / 13,563 (99.395%) |
| Actual loads / arrivals | 8,864 / 10,864 | 11,061 / 15,108 |
| Completed returns / salvage deliveries | 7,806 / 957 | 9,655 / 1,242 |
| Same-phase ready departures | 8,864 | 11,061 |
| Cold source completions | 65 | 94 |
| Cold source p50 / p95 / p99, seconds | 3.125 / 21.125 / 33 | 17.375 / 46.75 / 60.5 |
| Cold salvage p95 / p99, seconds | 12.25 / 20.625 | 29.375 / 48 |
| Canceled cold source / salvage subscriptions | 98 / 2 | 380 / 58 |
| Final unresolved cold subscriptions | 9 | 41 |
| Sampled two-minute eligible-ready stalls | 0 | 0 |

Evidence: `out/sea-trade/m45-final-v6` and `m60-final-v6`: manifests, results, raw events/samples, trace/cold/pending audits and final saves. Both final saves restore and round-trip losslessly through the portable codec.

The exact 60-minute final save continued another 4,800 ticks (`m60-backlog-extension-v6`): 11,464 loads, 16,058 arrivals, 10,048 completed returns and 1,350 salvage deliveries. All 41 carry-in pending requests cleared or were released; none remained at the end. Minute-end distinct backlog fluctuated from zero to 27, ending with 23 new requests. The initial cohort reached 1,096 ticks (137 seconds) before clearing. All 11,464 recorded ready departures committed in the same phase; no sampled two-minute ready stall. Its final save passes portable transport. `backlog-audit.json` explicitly seeds carry-in subscriptions so restarting telemetry cannot hide them.

Reuse counts eligible departure/continuation acquisitions for physical pairs first acquired at least five game minutes earlier, including cold source and ready actor stages. It excludes idempotent polls, holder transfers, returns and salvage. Cold percentiles count completed subscriptions; canceled and unresolved work is separate.

## Fresh 90-minute qualification

All six runs completed 43,200 ticks with 14 AI, 30 tribes, technology speed three and the normal time limit. Every final state remains all-AI, restores normally and passes lossless portable transport. No sampled two-minute eligible-ready departure stall was found. No fresh normal continuation or return search remains pending.

| Run | Loads / completed returns | Recurring reuse | Final queued | Peak records / packed cells | Cold source p95 / p99 / max, seconds |
| --- | --- | --- | --- | --- | --- |
| m250-s42 | 56,947 / 47,774 | 99.908% | 0 | 4,957 / 574,125 | 3.875 / 17.625 / 19.125 |
| m500-s42 | 52,052 / 39,739 | 99.741% | 0 | 5,002 / 813,610 | 11.5 / 17.375 / 30.875 |
| m1000-s47 | 51,982 / 41,968 | 99.763% | 14 | 3,490 / 616,874 | 149.875 / 359.875 / 416.625 |
| m1000-s1606492585 | 62,805 / 54,671 | 99.701% | 0 | 2,807 / 403,553 | 43.5 / 72.5 / 76.5 |
| m1000-s42 | 52,167 / 42,494 | 99.664% | 9 | 4,385 / 895,700 | 46.375 / 74.125 / 144.375 |
| coastal500-s42 | 101,098 / 74,556 | 99.585% | 0 | 7,439 / 795,671 | 5.25 / 8.625 / 30 |

All 377,051 recorded ready departures committed in the same phase. This measures ready eligibility, not first cold demand. The independent real-planner fleet regression proves more than 40 distinct ready sources launch with management disabled. Sampled readiness uses the same bounded candidate policy as runtime; it does not claim exhaustive knowledge of every port worldwide.

Final-ten-minute queues fluctuate and drain. Seed47 falls from 78 at minute 80 to zero at 85/87/88, ending 14; seed42 has a late burst 87 at 85, then 25 at 87 and 9 at 90. Other final queues are zero. Queued counts exclude admitted searches. Exact remaining economic requests are in `fresh-final-pending-audit.json`: seed47 has two cold departures (oldest 87 ticks) and 19 salvage demands (oldest 178 ticks); seed42 has 25 salvage demands (oldest 385 ticks), with no cold departure pending.

**Updated cold-delay limitation:** seed47's rare first-use tail is substantially longer than the earlier mature-only decision data: p95 about 150 seconds, p99 about 360 seconds and maximum about 417 seconds. Median is 7.75 seconds and recurring reuse 99.763%, but a new route can still take several minutes under bursts. The user previously chose fixed CPU limits and accepted documented cold delay; this new practical tail has been flagged explicitly and must be visible in the final activation decision. It is not a satisfied cold SLA. Table percentiles count completed cold source subscriptions; canceled and unresolved work remain separate.

Evidence: each `fresh-*-final-v6/final-functional-audit.json`, `final.v8.portable.json`, raw samples/results, and `out/sea-trade/fresh-functional-audit-v6.json`.

## Human arena-retry regression and correction

A matched probe submits the same 11 actual single-squad move commands eight ticks apart on the 60-minute inputs, with player one under human control. Initially seven short commands took one tick in both modes; four long commands took 109/117/158/160 ticks in legacy but 432/439/481/483 with v7. The small mixed-medium test had missed this regression.

Trace showed a human full-arena exact retry waiting behind cold sea-corridor arena holders, while 24 reserved preparation units sat idle. A candidate-world scheduling-v6 diagnostic completed those commands in two/three ticks, isolating the scheduling interaction.

V7 now reserves corridor preparation for interactive work that can actually use it. A waiting exact arena retry cannot; existing holders borrow that idle allowance to drain. Queued replacements have request fields only and conservatively reserve potential corridor preparation. V6 retains historical behavior. No total work or human route share increases.

The final matched probe executes every command without rejection or unresolved receipt. Long-command delays are 88/95/128/147 ticks, each no slower than its matched legacy command; seven short commands remain one tick (`human-receipt-comparison-v6.json`). This is non-regression for that 11-command sample. Long-route p95 remains 18.375 game seconds. The broader opt-in eight-human real-time load gate remains unqualified.

The real 1,024-slot planner regression improves from tick 13 to tick 4 under the same 10,240-unit cap. It cold-restores while the human waits, then requires identical planner checkpoints after each future step. The 41-test focused planner/movement group and strengthened 11-test active-limits suite pass; scheduler lint is clean.

## Persistence, publication and source equivalence

- Mode omitted: exact 88-tick checkpoint/publication parity before minimum repair; afterward exact publications and checkpoint equality after normalizing only the three approved legacy fields (`final-mode-off-checkpoint-repair-parity.json`).
- Putting exactly 16 old sentinels back reproduces the previous whole idle-fixture digest; squad digest unchanged (`checkpoint-golden-proof.json`).
- Whole state/delta, repeated restore, partial catalog/packing, malformed bounds/metadata, reference ownership, known-home return and observer-purity regressions pass. Focused checkpoint subset: 27 tests/three files.
- Restore-only metadata guards leave runtime class bodies unchanged except the restore validation call. Both canonical mature inputs and eight future ticks are exactly equal (`metadata-fences-equivalence.json`).
- The human-only scheduler change is entirely inside an already-priority-true branch, with v6 unchanged. All-AI workloads cannot enter it; both mature canonical/eight-future-tick checks match and final fresh states are all-AI (`human-loan-equivalence.json`). Profiling manifests retain original hashes with this explicit equivalence evidence for the three changed runtime files.
- The earlier 22-file manifests retain their original hashes; metadata, human-only scheduling and indexed-lookup changes have the explicit equivalence proofs described here. The final-source confirmation records its own authority hashes and passes before/after integrity checks.
- Six real WebSocket tests cover creator-hosted and server execution, join/reclaim, legacy omission and new routing.
- Controlled browser proof uses the production renderer/Empire panel, borrowed publication, paid cycles, loaded capture, cold restore/future agreement and market-intake label. The actual production host worker advances 100 ticks with join/client baseline agreement. This is controlled proof, not a live battle or deployment qualification.

Readable screenshots in the task visualization folder: `sea-trade-worker-capture-v6.png`, `sea-trade-intake-wait-v6.png`. Own temporary Vite servers and tabs are stopped.

## Bounded indexed lookup correction and final CLI checks

A sampled profile of the active final world (`active-world-cpu-v6/hot-functions.json`) found a direct discovery-contract violation. The new port catalog called the generic Trade lookup; after an authoritative index miss, that helper scanned every building. Destroyed/stale catalog IDs are legitimate, so this hid a full-world scan inside one discovery unit.

New sea services now require and bind the authoritative indexed building provider, including its missing result. The generic legacy helper is unchanged. A real-discovery regression first observed one whole-building-list read for a missing ID, then passes with zero reads after the repair. All 69 focused sea/planner tests pass.

`indexed-lookup-equivalence.json` records exact initial and 16/32/48/64-tick mature checkpoints, every-second-tick publication hashes, and terminal fresh-save restoration equality across the repair. An AST comparison proves executable source outside the new-mode constructor branch is unchanged. This is a behavior-equivalent lookup correction, with no cargo, policy, or budget change. The final-source full-window timing confirmation completed and its complete final fixture bytes equal the earlier candidate fixture.

The profiler CLI now rejects unknown/duplicate/missing flags and out-of-range seeds, faction counts and technology speeds. It creates missing evidence parents, refuses existing output directories, provides `--help`, and explicitly removes the sea-routing option for fresh legacy controls. Actual one-tick legacy/new runs verify omission plus scheduler v6 versus lane sidecar plus scheduler v7 (`cli-contract-validation-v7.json`). Valid measured checkpoint arguments and the simulation loop are unchanged.

Final checks after this correction: TypeScript, scoped lint and both production builds pass. The complete suite is **3,404 passed, seven skipped, one unchanged calibration failure** (3,412 total), `full-suite-indexed-final-v7.json`.

## Regression, builds and remaining activation gates

Pre-lookup-correction full suite: **3,403 passed, seven skipped, one baseline failure** (3,411 total), `out/sea-trade/full-suite-human-loan-final-v6.json`. The strengthened restore assertion also passes its targeted suite. TypeScript and both production bundles pass after the scheduler correction; final pre-timing type/diff checks pass. Scoped lint matches 20 original findings with zero new messages; the later scheduler-specific lint is clean.

The untouched original checkout independently reproduces `RussianAssetIntegration.test.ts:42`: MachineGunTruck release y expected 0.52, actual 0.5390625. This unrelated calibration is unchanged and unwaived. The approved plan requires full-suite clearance; user AGENTS excludes unrelated edits. An explicit accepted exception or separate resolution is needed before normal default activation. The longer rare cold tail must also be explicit in that activation decision.

Three serial paired timing repetitions (AB, BA, AB) completed before the later lookup correction. A separate final-source confirmation has completed, as reported below. They warm 2,400 and measure 4,800 ticks, publish every two ticks, sample every 480, and disable event traces. Main-thread and whole-process CPU are captured at actual warmup/measurement tick boundaries. Existing wall/thread-CPU contention flag is 1.5. Identical V8 GC tracing reports main-thread pause count/total/p95/p99 between logged markers, including publication and excluding final checkpoint serialization. The 480/480-tick smoke validates both markers and 197 GC events; its concurrent timings are diagnostic only. Driver/wrapper source is copied into timing evidence; source hashes, new changed-source membership and base SHA are checked before/after every run.

These are task-isolated local x64 measurements with ordinary desktop background. No Oracle/ARM, production pace or statistically significant speedup is claimed in advance. The combined policy/service benchmark does not isolate old destination-scoring CPU alone.

## Measured CPU and useful-work tradeoff

All three serial AB/BA/AB pairs completed with source integrity checks before/after every run. These pairs measure the source **before the later bounded-lookup correction**; their manifests retain exact hashes. They are not relabeled as three final-source measurements. The final-source confirmation is separate.

All wall/thread CPU ratios pass the existing 1.5 contention flag; the maximum is 1.352. Repeated runs produce byte-identical final fixtures within each policy (one unique legacy hash and one unique lane hash). The policies deliberately evolve different worlds; no fields were removed to manufacture cross-policy equality.

| Pair | Legacy / lane process CPU per tick, ms | CPU change | Legacy / lane mean tick, ms | Shared routing wall-time change |
| --- | --- | --- | --- | --- |
| 1 | 51.559 / 75.843 | +47.1% | 53.637 / 83.834 | +43.0% |
| 2 | 48.516 / 64.017 | +32.0% | 48.640 / 78.501 | +46.9% |
| 3 | 48.656 / 75.010 | +54.2% | 48.518 / 73.093 | +36.3% |

Process CPU includes publication and all process threads; phase timings are wall time, not per-phase CPU measurements. Instrumentation is identical in each pair, and ordinary desktop background remains uncontrolled. Three pairs do not establish statistical significance or target-host/ARM performance.

Every pair records 568 versus 11,061 sea loads, 2,301 versus 15,108 arrivals, 395 versus 9,655 completed returns, and 112 versus 1,242 salvage deliveries. Returns increase 24.44x and loads 19.47x. Across the full 15-minute warmup-plus-measurement continuation, **all-trade credited gold** increases from 12,005,565 to 54,982,224 (4.58x); this includes land trade and salvage and is not net profit or a sea-only total.

The worlds have different activity, not simply more ground units: final ground troops are 26,863 versus 24,960, naval traders 872 versus 1,074, and the combat-tick counter 14,353 versus 15,661. The first pair's extra wall time is concentrated in combat, movement, capture and transport (about 20ms of the 30ms increase), with economy +2.17ms and shared routing +4.94ms. A diagnostic sampled profile confirms hierarchical preparation, movement, capture and fighting remain substantial costs; the direct discovery lookup fault was repaired within scope. No unrelated combat or movement optimization has been made.

**The total-CPU acceptance gate is not met by these measurements.** Useful trade increases sharply, but whole-game CPU also rises 32-54%. This must remain an explicit tradeoff, alongside the already disclosed cold tail and unrelated calibration failure. Normal defaults remain unchanged pending the owner's decision. The final-source confirmation below also misses this gate.

Evidence: `timing-final-v6/comparison.json`, `runs.json`, raw logs/manifests, captured driver/wrapper source, and `final-timing-analysis.json`.

### Final-source confirmation after indexed lookup repair

One additional serial candidate run uses the final runtime and hardened profiler CLI, the same mature input and 2,400/4,800 window. It is **one confirmation compared with the three earlier legacy references**, not three newly paired measurements. Source integrity passes. Its complete final fixture is byte-identical to every earlier lane candidate (`1ae251d9905256bd513dbcacf902bf00a843720af78789b2850ce3c8c318e5b6`); loads, arrivals, returns and all recorded domain outcomes match.

Whole-process CPU is **73.646ms/tick**, main-thread CPU **69.642ms/tick**, mean tick **72.841ms**, p95 **95.411ms**, p99 **113.953ms**, and shared routing wall time **14.826ms/tick**. Wall/thread CPU ratio is **1.088**, below the existing 1.5 contention flag. Process CPU is **42.8%, 51.8% and 51.4% higher** than the three prior legacy controls. The lookup repair preserves behavior and removes hidden unbounded discovery work, but this measurement does not establish a whole-game CPU saving or isolate the repair's causal speedup.

Evidence: `out/sea-trade/indexed-confirmation-summary.json`, `indexed-confirmation-authority.json`, `indexed-confirmation.log`, and `timing-indexed-confirmation-v7/`. Final `git diff --check` passes. Normal factories remain unchanged. No unrelated calibration repair or integration was performed; the implementation is being committed for the separately requested isolated Oracle test. No deployment has occurred.


## Reproduction and future changes

Use Node 24 with installed dependencies, and preserve every new output directory.

```powershell
New-Item -ItemType Directory -Force out/sea-trade | Out-Null
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers 4 tests/skirmish/SeaTrade tests/skirmish/AiCheckpointMinimum.test.ts tests/skirmish/PlannerActiveLimits.test.ts tests/skirmish/HostedMatchTransport.test.ts tests/skirmish/LiveJoinTransport.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs scripts/profileSeaTrade.ts --fresh --map migration --size 1000 --seed 42 --ai 14 --tribes 30 --technology-speed 3 --policy lanes-v1 --ticks 43200 --sample-every 120 --out out/sea-trade/recheck-m1000-s42
```

Repeat fresh qualification for Migration 1000 seeds 1606492585/47, Migration 250/500 seed 42, and `heightmap-test1` 500 seed 42, using new output directories. Headless profiling executes the simulation and production snapshot encoder; rendered-client/socket proof remains separate.

Mature fixture envelopes contain `settings`, `seed`, `options`, `checkpoint`. Convert explicitly with `scripts/convertSeaTradeFixture.ts --input <legacy.v8> --output <new-lanes.v8> --source-sha <exact-origin-sha> --policy lanes-v1`. Ordinary restore does not change routing policy. Profile converted fixtures with `--checkpoint <new-lanes.v8> --policy lanes-v1 --warmup 2400 --ticks 4800 --trace-routing true --sample-every 8 --out <new-directory>`. Boolean telemetry flags require true/false.

CPU comparisons run serial 2400/4800 windows, alternating AB/BA/AB, with other task profiles/tests/builds stopped. Preserve raw GC stdout and actual completed voyages alongside mean/p95/p99 routing/tick cost and measured CPU. Concurrent functional wall time is not a speedup.

Future trade changes must recheck cargo/payout conservation, capture/pause, bounded copy/management, reference release/restore, hint exploration coverage, ready fleet progress and actual human receipts. Reusing long-run evidence after a validation-only or unreachable-branch change requires explicit source/behavior equivalence. Different runtime policies require renewed qualification.

Earlier runs are diagnostics or stopped pilots. Raw evidence remains under `out/sea-trade`; historical investigation text is preserved in `validation-history-before-final.md`. No earlier pilot qualifies final routing.
