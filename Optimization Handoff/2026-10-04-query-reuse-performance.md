# Route permission and capture query reuse — release candidate

This pass implements the two measured prerequisites to the eleven-item gameplay plan. Production remains on `3f99dbdd0a020a35fc8cd1426caa3264bd47c6b1`. No deployment was performed in this pass.

## Changes and ownership

Routing now shares individual AI entry permissions across overlapping capture/contact footprints during one synchronous tick or standalone route drain. Home and unclaimed tiles use the same unconditional permission rule as `AiOperations.canEnter` without a cache lookup. Foreign-tile permissions are invalidated together with the existing footprint projection on territory writes and operation, diplomacy or retaliation revisions. Both projections are discarded at the end of the tick/drain and excluded from checkpoints.

The preliminary 400-tick diagnostic counted 33,130,628 entry queries, 6,642 exact requests and only 11 replacements with equivalent start/goal/water/obstacle geometry. Equivalent geometry alone does not establish equivalent order or domain generation. Request deduplication was therefore not implemented on that weak evidence; the retained change removes repeated permission work without changing planner scheduling, cancellation or completion semantics.

Capture batches now ask the domain service for a conservative proof that their full ray rectangle contains no indexed fortification occupancy. Empty areas skip repeated per-tile fortification rays. Areas overlapping an occupied coarse block retain the original exact rays, including allied obstacles. Building health, defensive-building ownership and diplomatic eligibility remain live per tile. The query also falls back to exact rays if the fortification version changes, its squad moves, or a tile is outside the proved rectangle. `canCaptureTile` remains the unrestricted exact query.

These are derived read optimizations in the authoritative simulation/domain services. No presentation-owned rules, new gameplay policy, movement budget increase or MVVM/DDD departure is introduced.

## Matched ARM comparison

Oracle's existing two-CPU ARM host, isolated read-only container, two CPUs/2 GiB, no external networking. Production was idle; the runner checks every ten seconds and stops if a live match appears. Trials ran sequentially, never concurrently with another benchmark.

Each trial restores the same Old World 1000 tick-60000 checkpoint: two human factions, ten AI and 25 tribes. It advances 400 ticks with the same deterministic work budgets. Order: baseline, route-only, capture-only, both, both, capture-only, route-only, baseline. There are two independent process trials per variant. Legacy query bodies are benchmark-only overlays; production has no feature-disable switch.

The table shows the mean of the two trial measurements for each variant. Tick p95 is the **mean of trial p95s**, not a pooled percentile or the final rolling window from the previous ten-minute replay.

| Variant | Processing elapsed, ms | Mean tick, ms | Tick p95, ms | Routing mean, ms | AI mean, ms | Capture mean, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 19446.01 | 48.60 | 66.86 | 17.27 | 6.92 | 7.84 |
| Route permissions only | 18630.71 | 46.56 | 64.97 | 17.12 | 4.98 | 7.97 |
| Capture queries only | 19061.62 | 47.64 | 65.47 | 17.26 | 6.84 | 7.03 |
| Both | 18091.68 | 45.21 | 63.44 | 17.16 | 4.94 | 6.79 |

- Route-only processing elapsed improves approximately **4.2%**. Most savings appear in AI evaluation, where the same routing permissions are used; the routing phase itself improves only about 0.9%.
- Capture-only processing elapsed improves approximately **2.0%**, and mean capture cost improves **10.4%**.
- Combined processing elapsed improves **7.0%**, mean capture cost improves **13.4%**, and mean trial tick p95 improves **5.1%**.
- All eight trials have the same full canonical snapshot SHA-256: `5cd32ba914ec1539699330c7c9970bc969a73d1e96876f2a7af596ab7c7db1d1`. Planner outcomes also match: 521 completed, three limited, 742 superseded, 58 pending and oldest age 134 ticks. No claim is made that route churn itself was eliminated.

An initial permission-cache version hashed home/unclaimed tiles too. It saved AI evaluation time but increased routing cost enough to cancel the improvement; it was refined before acceptance. An initial unguarded capture proof reduced capture time more strongly, but the final retained version includes lifecycle/origin/bounds guards. Only final guarded/fast-home-path measurements above describe the release candidate.

Evidence: [ARM comparison](Evidence/2026-10-04-query-reuse/arm-comparison.json). Reproduce with `node --import tsx scripts/profileQueryReuse.mjs --compare --restore <checkpoint.v8> --out <result.json>`, or the idle-only Oracle runner's `queries` mode. Timing runs omit instrumentation wrappers.

## Validation

Regression coverage checks reuse across overlapping foreign allied footprints, fresh projections at drain boundaries, ownership changes, new and refreshed retaliation permissions, alliance changes, map edges, coarse-block boundaries, enemy walls, building capture/removal, wall destruction and restore. Capture queries also fall back after a newly indexed obstacle or a moved origin.

The final home/unclaimed fast path exposed an older transport fixture that mocked `canEnter` to reject neutral territory, despite the real domain rule allowing it unconditionally. The fixture now owns the arrival shore with a foreign faction, grants actual war permission, then withdraws it through checkpointed operation state/revisions. All 30 shore-transport tests pass with this stronger regression, including committed cargo returning to departure after permission withdrawal. No transport behavior was changed to accommodate the fixture.

Final TypeScript and production build passed. After the fixture migration, the retained candidate passed **182 test files and 1224/1224 tests** in the final broad run (138.08 seconds). Focused AI-policy, fortification, capture and shore-transport checks also passed.

The final two-client hosted smoke passed on Old World 1000 with ten AI and 25 tribes: both human movements, construction, all five policy defaults, all ten regular AI moving, trade pause/block controls, rejected-command handling, reconnect and 34 common canonical state samples. Two periodic orders began observed movement after 178/170 ms. Publication gap p95 was 252 ms on both clients; no recorded failures. This is a 60-second monitoring check of a fresh, much lighter world, not a long battle or rendered-client latency certification. Runtime identity: `bdcc1a49e36483c6278177c19aad0841b9669d5ab4d705aa6346caa66883f196`.

The first smoke attempt timed out on an injected command sent just before the harness deliberately closed that client's socket for reconnect. No command outcome was recorded for that request, while the other client's command executed and both clients kept advancing. The smoke runner now waits for its pending movement probes before its deliberate reconnect. The rerun passed; this test correction does not change reconnect or command behavior in production. Failed evidence remains under `out/query-reuse/hosted-smoke`.

Evidence: [hosted smoke](Evidence/2026-10-04-query-reuse/hosted-smoke.json).

## Remaining limits and deployment

The matched dense fixture still has roughly **63 ms tick p95 against a 50 ms budget**. Exact planning remains about 17 ms mean; these changes do not establish universally sub-second large orders, river transport, rendered browser responsiveness or heavy-world real-time simulation. The separate eleven-item pathfinding/AI/progression passes remain necessary and were not implemented here. Keep Oracle's one-match admission limit.

This candidate is prepared on `V1.1.5` for an exact-revision release. Oracle production has not been restarted or modified. Final read-only health returned `status: ok`, `activeMatches: 0`, and only the existing production app/proxy containers remained; all isolated comparisons had exited. Deployment must still recheck idleness, use the release script, then verify source/runtime identity, public HTTPS/WSS behavior and database backup integrity.
