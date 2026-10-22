# End-game movement and routing implementation and measurements

Final measured source: 0d16678ab2093049c85d613a506a9432e86857f7, local codex/sea-trade-lanes worktree. Both isolated Oracle candidate runs meet the >0.9x average pacing target: 0.9991x at the 75-minute checkpoint and 1.0007x at the 60-minute checkpoint. Production was not promoted or restarted.

The largest live gain is the eight-squad tail: p95 time until the last member moves falls from 6.803 to 1.934 seconds, with worst case 7.991 to 1.990 seconds. Sixty-squad p95 falls from 2.202 to 1.580 seconds. Compact thirty-squad timings remain similar; single-squad live timings are slightly worse. Mean tick cost rises from 90.19 to 93.93 ms in the paired adaptive workload, with worst candidate tick 334.64 ms. This is a responsiveness improvement while retaining real-time pacing, not a claim that every operation became cheaper.

Both candidate captures replay to exactly matching full authoritative checkpoints, with zero command-outcome mismatches. The source tree, test/build qualification, measurement corrections, raw distributions and remaining mechanical wait are detailed below.

## Implemented contracts

Ordinary human movement now owns each squad's intention independently. Shared command groups coordinate destination layout and route reuse; they do not make ready squads wait for unfinished siblings. Death, replacement, cancellation, capture/refit validation, impossible destination placement, and failed queued placement leave unaffected members' intentions intact. Aggregate receipts remain open until all child plans are terminal and retain partial failure information.

Destination slots are published as their bounded allocator certifies them. Current routes can commit while a later Shift layout is still being prepared. Captured planned origins and transferred queue references preserve subsequent layout preparation after current movement has started. Queued slots likewise publish independently; a failed queued slot does not discard the other squads' legs.

Compatible starts and destinations share deterministic route families with the existing 32-tile eligibility bounds and traversal-kind/revision checks. Nearby direct routes do not wait for distant discovery leaders. Surviving members retain shared discoveries when a leader finishes or disappears.

The planner separately bounds allocating foreground searches: four globally and two per seat, with recurring navigation limited to two globally and one per seat. Existing queue capacity, 65,536-node / 2 MiB arena and CPU/work allowances remain unchanged. Fresh admission retains reserved memory against recurring pursuit. Retirement, exclusive searches, holder reclamation, fairness and restoration retain their existing bounded accounting.

Long moves can begin on a certified short approach segment while the final route is discovered. This uses the existing connector allowance, not an additional routing budget. Terrain, access, fortification and authoritative swept collision checks remain in force. A blocked prefix pauses safely; it cannot consume a queued leg or masquerade as full command execution. Full-route handoff selects a validated forward join rather than retracing the travelled prefix.

Formation readiness prioritizes fresh manual input and newly blocked movement within the existing sixteen decisions per tick, reserving periodic service. An optional automatic deployment can continuously return to a travel-capable column from its current soldier poses after sweep certification. Explicit formation intentions, weapon/reload state and the globally disabled moving-deployment setting are preserved. Existing turn/acceleration mechanics remain visible in response timing.

Historical unversioned saves retain admission policy 1 and their historical planner behavior; policy 2 also remains readable. New matches use admission policy 3 and planner scheduling 9. Profiling old checkpoints uses explicit, lossless configuration migration, verified by reverting policy fields and comparing the entire checkpoint. It does not manufacture units, resources, terrain or technology. Existing saved worlds need that explicit migration to receive the new policy.

## Recovery defect found during qualification

The three-client smoke test exposed real stale trader metadata after flow-control recovery. A private baseline could lie between shared comparison cursors. A value changing and changing back across that baseline could then be omitted from the next shared delta, despite every client receiving the same later publication. Exact captured differences were trader waitingReason fields; ownership, squads, ships, buildings, armies and players matched.

Recovery now captures a matching shared delta and private baseline atomically, using the existing join-barrier encoding mechanism. The matching shared delta travels through the ordinary ordered publication stream, including the encoder-to-coordinator direct channel. An explicit executor publication fence detects later deltas that overtake the private recovery reply, even at the same tick. Healthy clients receive the aligned delta even if the recovering guest disconnects or another baseline supersedes it during encoding. The matching private baseline then starts the recovering client's new credit epoch. Tests cover field reversal, worker packet agreement and the disconnect race. Canonical comparison sorts object keys but does not remove trader values from comparison.

A later strict comparison identified an independent sparse-decoder clock issue: the encoder deliberately omits released ranged history after eight ticks, but an unchanged entity does not emit another sparse row at that deadline. A retained client could therefore keep a released animation record that a fresh baseline correctly omitted. The decoder now applies the existing wire-only replicatedWeaponState projection at every packet clock, replacing only an expired view row. Previously returned snapshots and authoritative weapon state stay unchanged. A new sparse-journal regression fails before the correction and passes afterward; no combat or weapon rules were changed.

Observer comparisons canonicalize object keys and entity rosters by stable ID, retain all field values, and capture the first real disagreement. Input response timestamps and flow-control credits precede observer-only hashing. Batches derive their limit from MAX_ORDER_SQUADS rather than a duplicated constant.

## Formation completion defect verified in the first successful smoke

A modern infantry squad's route committed one tick after input, but it did not translate until tick 89. The exact same-ARM replay matched every canonical section and reproduced the delay. An eight-tick automatic narrowing transition remained attached after its end: a small-heading-change branch skipped transition cleanup. Since movement correctly refuses an attached non-column deployment transition, the carrier stayed still until the periodic formation scan retargeted it 86 ticks after input.

Completion now clears the expired transition before facing/retry/withdrawal branches can continue. This preserves the certified target pose and explicit formation intention; it does not turn on movement during deployment. A regression fails before the fix and passes afterward. A counterfactual replay of the original input journal on the corrected implementation starts translation at tick 12 instead of 89 (1.5 versus 11.125 game seconds). Its final world intentionally differs after earlier movement; this counterfactual is not described as an exact canonical replay qualification. Fresh corrected-source captures receive their own exact replay checks.

## Measurement method

Oracle test containers are isolated from production on localhost ports 18081/18082, with two CPU and four GiB limits, no CPU profiler during timed measurement, read-only application mounts and automatic production-activity/health/deadline guards. Uploaded files are pinned by a complete SHA-256 manifest; archives and every final file are verified on Oracle. Production revision remains ea9514b1e40420aca9336dbbf583370301e1e52b.

Three real WebSocket clients use the production decoder, coordinator, worker and encoder. The third client takes over a real existing large faction. The actual UI and transport limit is thirty squads per order. Sixty-squad stress samples are two simultaneous legal thirty-squad orders, with aggregate acknowledgement/execution waiting for both receipts. They are not represented as a single supported sixty-squad UI selection.

The paired control uses the exact e2f449f40e7e4554e3244b88a76060a2cd22d7e4 simulation and historical movement policies. Both variants use the same measurement harness and recovery fix in MatchRuntime/LiveMatch; overlay hashes are recorded in measurement-build.json. This isolates movement policy from the independently verified recovery correction. Timed interactive traffic uses the same adaptive workload generator, not an identical command journal: faster completed orders can be reused earlier. Identical-input comparisons are reported separately from the offline restored-world probes.

First decoded movement means displacement greater than eight fixed units, independently sampled for every member. It includes intended turning, acceleration and publication/network delay. First turn is censored at the member's first translation or completed hold; later orders cannot supply a response for a completed sample. A preliminary control exposed that observer-lifetime defect and is excluded from final latency claims. First authoritative turn, nonzero translation, threshold crossing, full-route commit, and whole-selection response are recorded separately. Missing or terminal members and incomplete full commands remain visible. Last-member statistics include only fully observed groups; unfinished groups are separately counted rather than assigned a fabricated latency.

The user's acceptance criterion is sustained average late-game speed above 0.9x. Ten-second windows, including the previously agreed one-tick sampling tolerance, remain diagnostic; their fraction is not used as the current acceptance gate.

## Related gameplay gate

The corrected movement changes the existing AI-versus-manual duel outcome. An isolated comparison changes only Simulation.ts between 9f317aa0 and the completed-transition correction, with identical fixtures and remaining code. Across four Early Medieval duels, AI wins change from 4/4 to 2/4; the required minimum 2/4 still passes. AI archer-contact ticks change from 516 to 517; the manual opponent's fall from 510 to 254. The comparative archer-exposure assertion therefore fails at 517 versus its 508 limit. The threshold remains unchanged. The user explicitly authorized a tactical correction. Exact contact tracing identified cavalry fighting an adjacent infantry target inside the ranged bodies while the frontline chased other assignments. AI frontline members now prioritize legal nearby melee threats to their archers, subject to the existing weapon, leash, personal-contact and retarget rules. Shared threat geometry is calculated once per tactical step. Human armies retain their prior targeting. A direct integration test fails on original behavior and passes with the correction; the four-duel matrix improves to three AI wins and passes the original exposure ratio (532 versus 806). Absolute archer-contact ticks do not improve in that matrix (517 to 532), so this is reported as better interception and battle outcome rather than a reduction in absolute exposure. A broader archer-retreat experiment worsened exposure and was discarded.

## Observer isolation and the apparent missing member

A preliminary three-client run placed full-world sorting, canonical JSON serialization, hashing and diagnostic JSON retention on the same event loop as all three production decoders. Its measured pace was 0.872x for control and 0.869x for candidate, with median decoder wall time near 100 ms and rare delays above three seconds. Those runs remain preserved as observer-burden diagnostics and are excluded from final performance comparisons.

A benchmark on an actual captured production-decoded late-game snapshot measured about 68 ms per inline comparison versus 10 ms to dispatch a comparison to a worker on the local machine. The corrected observer compares every eighth publication on a separate worker; all fields from the original comparison remain included. It retains at most 32 sampled publications and records every decoder error. Full-field checks cover real trader-field differences, roster/property ordering and retention limits. Credits and response timestamps precede observer dispatch. Stationary eligibility requires distinct simulation ticks.

With identical production source, the corrected 60-second Oracle smoke averages 1.003x and decoder medians fall to 14-15 ms. Short-move per-member median is 915 ms and long-move median is 730 ms. This short check validates the observer correction, not the final ten-minute pacing gate or a runtime CPU improvement. Final control and candidate both use the corrected observer.

The apparently untranslated modern cavalry member 7864 has a verified exact-input same-ARM trace with zero immediate-outcome mismatches. Its command applies at tick 36284, first translation occurs at 36291 (0.875 game seconds), and it is removed at 36297 (1.625 game seconds). Client publications did not observe its brief movement before removal. It was not a stuck squad. The corrected harness records removed members separately and releases surviving sample members with valid Hold orders rather than including missing IDs. No disappeared member is counted as successful observed movement.

## Shared-route promotion regression

If the original discovery leader is removed, its first surviving follower becomes the leader. Two destinations can each be within 32 tiles of the original goal while being 60 tiles apart from one another. The second survivor previously waited for a route it could never share. Promotion now updates both the family origin and destination, and follower waiting checks the actual promoted destination. A three-member regression reproduces the old missing request and passes after the correction. Existing corridor connector certification and budgets remain unchanged.

## Final evidence

Final measured harness source: 0d16678ab2093049c85d613a506a9432e86857f7. Its complete src tree is a3e8dd2b7ad1af198dab8f36350156fd6a1dd0c6, identical to the full-suite gameplay source. Three additional observer-worker tests and project types pass. The full suite completed with 3,448 passes, one failure, two expected failures and seven skipped tests across 475 files. The sole failure is the independently reproduced Russian machine-gun truck asset calibration. Types and frontend/multiplayer/probe production builds pass. Gameplay source is identical to the full-suite commit 7b0c8643; later commits change only the measurement harness and its tests.

The final local identical-command probe runs 240 ticks per case on the real m75 checkpoint, using current tactical behavior for both old-policy and responsive-policy variants. All eight cases finish with zero unresolved members. Dispersed eight: last full commit 45 to 2 ticks, last translation 50 to 6. Compact sixty: last commit 4 to 4, last translation 9 to 8. Dispersed sixty: last commit 23 to 7, last translation 28 to 9; every first response is within two ticks. These are authoritative simulation-tick results, not hosted/network wall-time results.

A preliminary ten-minute control capture has an exact same-ARM replay: 4,467 ticks, 3,077 journal actions, 241 commands, one controller change and 2,835 road publications; every canonical checkpoint section matches, with zero immediate-outcome mismatches. That capture is excluded from final latency tables after the observer lifetime correction.

Final timed runs, same-ARM identical-command comparison, stage attribution checks and both candidate canonical replays are complete. Neither candidate has pending full commands, unresolved surviving members, client-state failures or pre-admission coasting samples. Each candidate has one sixty-member sample containing a squad already at its assigned formation slot; those members are reported as completed without observed motion and are not assigned a fabricated movement time. In the m60 replay, member 12124 commits at tick 31018 to (243552,101632), exactly its current position, although that slot is 3.125 tiles from the shared command centre.

The slowest m75 single-member sample is preserved as a separate same-ARM diagnostic. Its route commits on the next tick. A certified automatic mass-formation narrowing then lasts eight ticks (one game second), followed by reorientation, turning and acceleration; first translation is at tick 36133 and the decoded threshold is observed at tick 36134, 1.603 wall seconds after input. This is the existing minimum reform-time rule, not delayed route discovery. The current implementation preserves that formation mechanic. Its later source trace is read-only, records zero immediate-outcome mismatches and is not presented as a final canonical proof; the independent full replay provides that proof.

Diagnostic smoke runs that failed protocol/state checks remain preserved and excluded from performance claims. Local tick wall times collected while tests ran are not treated as Oracle CPU or network measurements. Previously accepted first-use sea-lane discovery delays remain under the existing CPU limits; the recurring naval flow is verified below.

## Final Oracle results

All timed cases use the corrected observer, three real clients, the same CPU/memory limits, and no CPU profiler. Average pace is the accepted >0.9x criterion. The archived ten-second-window fraction is diagnostic only.

| Case | Average speed | Mean tick ms | p95 | p99 | Worst | >125 ms |
|---|---:|---:|---:|---:|---:|---:|
| v3-control-m75-observer-03 | 0.9999x | 90.19 | 117.77 | 182.39 | 325.37 | 178/4850 |
| v3-candidate-m75-observer-03 | 0.9991x | 93.93 | 124.36 | 196.50 | 334.64 | 238/4847 |
| v3-candidate-m60-observer-03 | 1.0007x | 92.61 | 124.18 | 200.72 | 310.12 | 237/4828 |

### 75-minute live latency comparison

Seconds from input send to production-decoded movement. These are adaptive live workloads, not an identical command journal. A 60-squad sample is two simultaneous legal 30-squad orders.

| Selected | Old member p50 / p95 / p99 | New member p50 / p95 / p99 | Old last member p50 / p95 | New last member p50 / p95 |
|---|---:|---:|---:|---:|
| 1 | 0.456 / 0.881 / 0.911 | 0.522 / 1.065 / 1.603 | 0.456 / 0.881 | 0.522 / 1.065 |
| 8 | 0.918 / 6.803 / 7.991 | 0.566 / 1.104 / 1.782 | 1.146 / 6.803 | 0.823 / 1.934 |
| 30 | 0.713 / 0.990 / 1.166 | 0.724 / 1.046 / 1.161 | 0.987 / 1.333 | 1.034 / 1.353 |
| 60 | 0.972 / 1.661 / 2.121 | 0.983 / 1.363 / 1.464 | 1.411 / 2.202 | 1.345 / 1.580 |

### v3-control-m75-observer-03

388 matching sampled publications; 0 client failures. Naval cycles 10349, loads 11337, arrivals 16317. Of 618 naval actors surviving both endpoint captures, 611 changed position and 618 changed shipment. Endpoint comparison does not measure every intermediate dwell; delivered-gold totals include land trade.

| Selected | Orders | Member p50 / p95 / p99 / max seconds | Last-member p50 / p95 / max | Pending full commands | Unresolved members | Removed before observed motion | Completed without observed motion |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 39 | 0.456 / 0.881 / 0.911 / 0.911 | 0.456 / 0.881 / 0.911 | 0 | 0 | 0 | 0 |
| 8 | 20 | 0.918 / 6.803 / 7.991 / 7.991 | 1.146 / 6.803 / 7.991 | 0 | 0 | 0 | 0 |
| 30 | 20 | 0.713 / 0.990 / 1.166 / 1.345 | 0.987 / 1.333 / 1.345 | 0 | 0 | 0 | 0 |
| 60 | 20 | 0.972 / 1.661 / 2.121 / 2.356 | 1.411 / 2.202 / 2.356 | 0 | 0 | 0 | 0 |

Full-command and first-activity distributions, short/long splits, per-member stage ticks and all raw groups remain in final-comparison.json and the case result/stages files. Last-member quantiles include only fully observed groups. Completed holds and removals are explicit and are not assigned a fabricated movement time.

### v3-candidate-m75-observer-03

384 matching sampled publications; 0 client failures. Naval cycles 10627, loads 11656, arrivals 16610. Of 618 naval actors surviving both endpoint captures, 607 changed position and 618 changed shipment. Endpoint comparison does not measure every intermediate dwell; delivered-gold totals include land trade.

| Selected | Orders | Member p50 / p95 / p99 / max seconds | Last-member p50 / p95 / max | Pending full commands | Unresolved members | Removed before observed motion | Completed without observed motion |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 38 | 0.522 / 1.065 / 1.603 / 1.603 | 0.522 / 1.065 / 1.603 | 0 | 0 | 0 | 0 |
| 8 | 38 | 0.566 / 1.104 / 1.782 / 1.990 | 0.823 / 1.934 / 1.990 | 0 | 0 | 0 | 0 |
| 30 | 20 | 0.724 / 1.046 / 1.161 / 1.450 | 1.034 / 1.353 / 1.450 | 0 | 0 | 0 | 0 |
| 60 | 20 | 0.983 / 1.363 / 1.464 / 1.580 | 1.345 / 1.580 / 1.580 | 0 | 0 | 0 | 1 |

Full-command and first-activity distributions, short/long splits, per-member stage ticks and all raw groups remain in final-comparison.json and the case result/stages files. Last-member quantiles include only fully observed groups. Completed holds and removals are explicit and are not assigned a fabricated movement time.

### v3-candidate-m60-observer-03

382 matching sampled publications; 0 client failures. Naval cycles 10013, loads 11703, arrivals 15139. Of 427 naval actors surviving both endpoint captures, 399 changed position and 427 changed shipment. Endpoint comparison does not measure every intermediate dwell; delivered-gold totals include land trade.

| Selected | Orders | Member p50 / p95 / p99 / max seconds | Last-member p50 / p95 / max | Pending full commands | Unresolved members | Removed before observed motion | Completed without observed motion |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 40 | 0.671 / 1.106 / 1.148 / 1.148 | 0.671 / 1.106 / 1.148 | 0 | 0 | 0 | 0 |
| 8 | 40 | 0.601 / 1.136 / 1.680 / 2.169 | 0.902 / 1.680 / 2.169 | 0 | 0 | 0 | 0 |
| 30 | 20 | 0.790 / 1.165 / 1.296 / 1.442 | 1.149 / 1.429 / 1.442 | 0 | 0 | 0 | 0 |
| 60 | 20 | 0.857 / 1.333 / 1.426 / 1.636 | 1.283 / 1.636 / 1.636 | 0 | 0 | 0 | 1 |

Full-command and first-activity distributions, short/long splits, per-member stage ticks and all raw groups remain in final-comparison.json and the case result/stages files. Last-member quantiles include only fully observed groups. Completed holds and removals are explicit and are not assigned a fabricated movement time.

### Identical-command same-ARM policy comparison

This restores the same mature world for each scenario, uses the same current tactical implementation in both policy variants and manufactures no units or resources. It isolates movement-policy differences. It is an unpaced domain probe; its wall tick times are not a live-match speed result.

| Scenario | Policy | Members | Last route admission ticks | Last first-translation ticks | Unresolved |
|---|---|---:|---:|---:|---:|
| near1 | baseline | 1 | 1 | 6 | 0 |
| near1 | responsive | 1 | 1 | 6 | 0 |
| dispersed8 | baseline | 8 | 45 | 50 | 0 |
| dispersed8 | responsive | 8 | 2 | 6 | 0 |
| compact60 | baseline | 60 | 4 | 9 | 0 |
| compact60 | responsive | 60 | 4 | 8 | 0 |
| dispersed60 | baseline | 60 | 23 | 28 | 0 |
| dispersed60 | responsive | 60 | 7 | 9 | 0 |

### Full authoritative replay verification

v3-candidate-m75-observer-03: initial tick 36000, final tick 40974, 3357 journal actions, 278 commands. Canonical match true; zero differing sections and zero immediate-outcome mismatches.

v3-candidate-m60-observer-03: initial tick 28800, final tick 33732, 3353 journal actions, 285 commands. Canonical match true; zero differing sections and zero immediate-outcome mismatches.

The exact initial checkpoints, command/controller/road-publication journals, final checkpoints, source manifests, container state and replay digests are retained in the evidence directory. Production was not promoted or restarted.

## Evidence location and release status

The complete local evidence is in out/sea-trade/player-movement-0d16678a/: final-comparison.json, qualification-status.json, canonical-status.json, identical-command-oracle.json, source/asset manifests, per-case raw client results, server event journals, V8 checkpoints and container inspections. Prior diagnostic captures and the observer-overhead benchmark remain in out/sea-trade/. The deployed test payload contains 4,142 verified files. The measured source has the same complete src Git tree (a3e8dd2b7ad1af198dab8f36350156fd6a1dd0c6) as the full-suite gameplay commit.

These are isolated test builds and local commits. No Git push, production promotion, production restart, unrelated asset calibration fix or modification of the primary Private-Matches checkout was performed. Historical saves retain their versioned movement policies unless explicitly migrated; new matches receive admission policy 3 and planner scheduling 9.
