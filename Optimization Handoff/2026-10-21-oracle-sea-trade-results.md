# Oracle sea-trade qualification results

**The test does not meet the owner’s acceptance criteria.** Both lane-mode client runs stopped on invalid army metadata, and their observed on-pace fractions were below 90%. The legacy control completed its full interval and met the pace criterion. No source change or default activation was made during these tests.

Test source: `239539d8de94fc69194d887615493557327ce263`, published on `codex/sea-trade-lanes` and verified with `git ls-remote` before deployment. Production remains at `ea9514b1e40420aca9336dbbf583370301e1e52b`.

## Environment and method

- Existing Oracle Neoverse-N1 ARM64 machine, two CPU cores, Node 24.18.0. Separate loopback-only test service/database; two real clients across an SSH forward. Canonical Dockerfile built on Oracle. The configured simulation/route work limits were preserved.
- Production coordinator, LiveMatch scheduling, 384MiB reserved-worker heap, 256MiB encoder-worker heap, WebSockets, publication flow control and SnapshotDecoder. Test cgroup ceiling: two CPUs and 4GiB; neither worker nor container limit was raised during measurement.
- Test-only initialization restores the exact fixture after construction. Two existing factions become human-controlled; all other units, terrain, cargo and economy remain. Existing squads are held and then ordered in selections of one/four/eight, at most one sampled order every five seconds across both clients. No units or resources are manufactured.
- On pace means **at least 79 ticks in a complete nonoverlapping ten-second wall window** (9.875 game seconds), the owner-approved one-tick tolerance. The acceptance condition is strictly more than 90% of windows. Strict 80-tick windows are reported separately. The final partial tail is excluded from the window fraction but included in overall speed.
- Pace uses completed production-advance timestamps, including stalls in the measured wall interval. It is not the fraction of fast individual ticks. Simulation-step timings exclude snapshot/encoding/socket work; those costs are included in achieved pace.
- Movement timing is command send to an executed receipt and the first subsequently decoded displacement of at least one selected member. It measures an observed group response after execution, not arrival or every member moving. Because the receipt is required, this can be a conservative upper bound on the first cohort’s physical motion. Device/render-frame latency is not measured.
- Only settled squads with three unchanged publications are sampled. Destinations are owned, standable, on the same land component, and 2–6 versus 25–50 tiles from the leader when sent. Pending commands are not replaced; skipped opportunities and right-censored commands remain explicit.

## Pace and stability

The two lane results are **interrupted pre-failure intervals**, not completed 15/12-minute qualifications. Their cutoffs are the server completion timestamps of the last tick successfully decoded by both clients. Original failed client results remain untouched. Synthetic end metadata used for partial analysis is saved separately and explicitly labeled.

| Test | Observed wall interval | On-pace windows | Strict 1× windows | Overall speed | Player path |
| --- | ---: | ---: | ---: | ---: | --- |
| 60-minute lanes | 574.832s | 35/57 (61.4%) | 49.1% | 0.9664× | `Invalid army slots`; interrupted |
| 75-minute lanes | 185.916s | 5/18 (27.8%) | 22.2% | 0.9366× | `Invalid army slots`; interrupted |
| 60-minute legacy | 900.424s | 88/90 (97.8%) | 92.2% | 1.0002× | Completed; no client fault |

All three server containers remained free of process OOM. Their recorded exit code is zero because the tests were explicitly stopped during cleanup. **That is not a stability pass for the two failed client paths.** Both clients independently rejected army records; the server process remaining alive does not establish a playable match.

| Test | Mean step | p95 | p99 | Worst | Steps over 125ms | Longest consecutive below-target window stretch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 60-minute lanes | 109.338ms | 157.052ms | 263.506ms | 373.941ms | 925/4444 | 90s |
| 75-minute lanes | 124.521ms | 174.908ms | 255.952ms | 321.946ms | 528/1393 | 70s |
| 60-minute legacy | 84.568ms | 117.920ms | 187.116ms | 318.610ms | 266/7205 | 10s |

For an equal wall-duration comparison, the first **574.832s** of the legacy control achieves **55/57 on-pace windows (96.5%)**, **1.0005×** overall, and a mean step of **83.237ms**. The corresponding lane interval averages **109.338ms**, a difference of **26.102ms per step**. This is whole-world simulation wall time, not CPU isolated to sea destination selection. The worlds evolve differently under the two policies, and the short settling interval advances slightly different initial tick counts. One serial operational comparison does not establish statistical significance.

The two lane intervals lose about 3.4% and 6.3% of overall real-time pace, while missing many more individual ten-second windows. This is why a near-1× average cannot substitute for the requested time-at-1× measure. Their slowest complete windows advance at 0.8000× and 0.8125×.

## Movement distributions

All times below are seconds. Percentiles use **completed samples only**. The completed/sent column and unresolved counts prevent the censored older-fixture orders from disappearing into apparently good percentiles. These are small operational samples, especially the older fixture; do not interpret its tail percentiles as population estimates.

| Test | Selection size | Completed/sent | Median movement | p95 movement | p99 movement | Maximum movement | Unresolved at stop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 60-minute lanes | 1 | 40/40 | 0.731 | 1.143 | 1.279 | 1.279 | 0 |
| 60-minute lanes | 4 | 39/39 | 0.576 | 1.002 | 1.158 | 1.158 | 0 |
| 60-minute lanes | 8 | 34/34 | 0.544 | 5.576 | 8.906 | 8.906 | 0 |
| 75-minute lanes | 1 | 9/9 | 0.832 | 1.113 | 1.113 | 1.113 | 0 |
| 75-minute lanes | 4 | 12/12 | 0.824 | 16.570 | 16.570 | 16.570 | 0 |
| 75-minute lanes | 8 | 6/8 | 1.612 | 26.631 | 26.631 | 26.631 | 2 |
| 60-minute legacy | 1 | 57/57 | 0.719 | 0.962 | 1.136 | 1.136 | 0 |
| 60-minute legacy | 4 | 58/58 | 0.509 | 0.913 | 1.022 | 1.022 | 0 |
| 60-minute legacy | 8 | 58/58 | 0.372 | 1.594 | 61.225 | 61.225 | 0 |

The older lane fixture’s two unresolved eight-squad orders had already waited approximately **16s and 11s** when decoding failed. Across the completed lane samples, one/four-squad moves are usually responsive, while eight-squad requests expose longer planning delays. The legacy control also contains a **61.225s short-route eight-squad delay** and a **5.460s long-route delay**. Those orders eventually execute; neither is silently dropped.

| Test | Distance category | Completed/sent | Median execution receipt | p95 receipt | Median movement | p95 movement | Maximum movement |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 60-minute lanes | short | 58/58 | 0.251 | 0.642 | 0.625 | 1.143 | 8.906 |
| 60-minute lanes | long | 55/55 | 0.261 | 0.730 | 0.592 | 1.171 | 3.826 |
| 75-minute lanes | short | 15/15 | 0.377 | 26.558 | 1.113 | 26.631 | 26.631 |
| 75-minute lanes | long | 12/14 | 0.277 | 16.536 | 0.828 | 16.570 | 16.570 |
| 60-minute legacy | short | 86/86 | 0.209 | 0.368 | 0.558 | 0.962 | 61.225 |
| 60-minute legacy | long | 87/87 | 0.212 | 0.330 | 0.518 | 0.936 | 5.460 |

Acknowledgements are generally tens of milliseconds; the long outliers wait in deferred planning before execution, so they cannot be explained as only WAN acknowledgement time. The equally long-duration legacy prefix still contains the 61.225s outlier. Its eight-squad movement p95 is 5.460s versus 5.576s in the first lane interval. This does not support a blanket claim that the new routing creates all existing movement stalls. It also does not qualify the newer, shorter failed fixture as responsive.

## Army-slot failure investigation

The decoder calls `validateArmyRecords(packet.expansion.armies)` before merging the received metadata. `Invalid army slots` means the packet has too many slots for members, duplicate slot squad IDs, or duplicate slot indices. Failed network frames were not captured by the published probe, so the precise failing army/constraint in these two runs is not proven. Before failure, the clients agree on ownership/player/squad/ship/building/trader hashes across 2,733 matching publications in the first lane run and 858 in the older lane run.

A separate, local synthetic reproduction calls the **actual unchanged** `Armies.closeGap` and `validateArmyRecords`. With a queued front gap and an independently weakened frontline member, the first replacement leaves the gap queued. The next replacement can reuse its occupied index. The reproduction produces indices `[1, 8, 2]` then `[8, 8, 2]`, and the validator throws exactly `Invalid army slots`.

`Armies.ts` is byte-identical after line-ending normalization to the pre-implementation base `ea9514b1e40420aca9336dbbf583370301e1e52b`. This demonstrates a pre-existing defect capable of the same failure; it does **not** prove that it was the exact trigger in either uncaptured failed frame. The full legacy run did not encounter it in its 15-minute sample. No validator relaxation, army repair or unrelated source edit was made during qualification.

Reproduction: `out/sea-trade/reproduceArmyGapInvariant.mjs`, `army-gap-invariant-reproduction.json`. Relevant code: `src/skirmish/domain/Armies.ts` gap selection/replacement around lines 339–350 and `src/skirmish/domain/ArmyState.ts` slot uniqueness checks around lines 39–47.

## Integrity, cleanup and limitations

- Exact published source and a clean isolated remote checkout were verified. Each container records source SHA, input SHA256, image ID, configuration, logs and exit/OOM state.
- Docker’s rebuilt image/attestation IDs differ between runs. Older manifest IDs no longer resolve after rebuilding the tag. A single remaining image was not treated as equality proof. Read-only extraction from all three stopped container filesystems confirms their three production server/worker/encoder bundles are byte-identical (`container-bundle-integrity.json`). The final test-only probe seam and bundle hashes are also retained.
- Initial fixtures’ three SHA256 hashes match their staged Oracle copies. The 60-minute lane state is an explicit conversion; the 75-minute lane state is an independently evolved lane world, not a mode toggle of the legacy control.
- Raw evidence includes server advances/tick/pace JSONL, runtime phase diagnostics, source/image/input metadata, client order outcomes and latency records, failed results, separate partial analyses and full control analysis. SQLite guest databases are excluded from exported evidence.
- A permissions failure initially interrupted evidence collection after the first client failure. Root-owned redirections recovered the logs and normal explicit stop; only the collector was corrected. The exact published workload was not modified. Both interrupted runs remain failed results.
- Windows clients run through an SSH tunnel. This includes WAN/tunnel/decoding delay, but not actual browser rendering, input-device delay, or larger selections than eight squads. This is one ARM host and one run per fixture, not a general capacity guarantee or a production promotion.
- Public and internal production health are both `status: ok`, `activeMatches: 0`; production revision remains `ea9514b1e40420aca9336dbbf583370301e1e52b`. No test container remains running. The SSH forward is closed. Public Caddy, database, production containers and normal routing factories were not changed.

## Result and next work

Keep shared lanes opt-in. The measured build fails the requested pace/stability acceptance. The existing army-slot invariant needs a scoped repair and regression proof, group-command admission needs investigation (including the legacy minute-long case), and the active late-game simulation needs more end-to-end headroom before retesting. The owner requested distributions rather than a fixed input-latency threshold; no latency pass has been invented.

Machine-readable aggregate: `out/sea-trade/oracle-qualification-summary.json`. Run roots: `out/sea-trade/oracle-qualified-239539d8/` and `out/sea-trade/oracle-qualified-239539d8-remaining/`. Test image/source/evidence remain available under `/opt/ageoffronts/sea-trade-test/239539d8de94fc69194d887615493557327ce263` for review; all test execution is stopped.
