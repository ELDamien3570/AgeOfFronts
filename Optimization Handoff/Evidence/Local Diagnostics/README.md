# Local hitch and multiplayer diagnostics

Diagnostics run against the current uncommitted architecture optimizations, locally on Windows / Ryzen 7 3700X / Node 24.18.0. No production gameplay code was changed for this diagnostic pass. These results identify remaining work; they do not claim additional optimization gains against the old baseline.

## Execution and evidence

Runs were sequential: late-game control, the identical instrumented replay, browser simulation/rendering, then a ten-minute localhost hosted match. The browser scene is also rerun after the hosted match to verify the captured image and exclude skipped draw calls from draw timings. See `environment.json` for source hashes and machine details.

```powershell
node --import tsx scripts/profileLocalHitches.mjs --ticks 1600 --out out/local-diagnostics/hitches-control
node --import tsx scripts/profileLocalHitches.mjs --ticks 1600 --profile --out out/local-diagnostics/hitches-profile
node scripts/summarizeLocalDiagnostics.mjs
node scripts/runHostedStabilitySoak.mjs --seconds 600 --clients 6 --binary-clients 5 --order-interval 15 --exercise-backpressure --out out/local-diagnostics/hosted
node scripts/summarizeHostedDiagnostics.mjs
node node_modules/vite/bin/vite.js --config vite.skirmish.config.ts --host 127.0.0.1 --port 9000
# Browser: tests/skirmish/browser/LocalRuntimeProfile.html, Run 30-second profile
node node_modules/typescript/bin/tsc --noEmit
```

The checkpoint is `out/overnight-1000/seed42-filtered/checkpoint-60000.v8`, SHA256 `fc910c746e756c2c28ad76ddfd20b0fdc95c4f57313ceef8ec94009dc731c15f`. Its historical provenance includes a transport-filtered stress fixture. These continuations install no gameplay filters or prototype replacements beyond timing wrappers. This is a reproducible late-state diagnostic, not an unfiltered whole-match reliability certificate.

Small evidence JSON files accompany this report. Large CPU/heap profiles and tick traces remain locally in `out/local-diagnostics/`, rather than adding large generated artifacts to the repository.

## Late-game control: the hitch is concentrated at restore startup

| Metric | All 1,600 ticks | After first 80 ticks |
|---|---:|---:|
| Mean tick | 20.33 ms | 20.08 ms |
| p95 | 27.17 ms | 26.79 ms |
| p99 | 33.20 ms | 30.70 ms |
| Maximum | 115.09 ms | 41.19 ms |

The **only tick over 50 ms was tick 60001**, the first tick after restore. Its costs were distributed across routing (25.88 ms), AI (21.94 ms), capture (17.81 ms), economy (17.40 ms), movement (16.00 ms), and combat (9.22 ms). GC overlapped approximately 9.31 ms. First snapshot extraction took another 16.37 ms outside the tick timer. This supports investigating first-use initialization and cold execution across several systems; it does not isolate a single JIT or cache mechanism as the cause.

Across the run, 441 GC events consumed about 1,005 ms; maximum pause was 10.31 ms. GC contributes to overhead but does not explain the 115 ms startup hitch by itself.

Routing averaged **7.09 ms / 34.9%** of the tick, including exact planner work at 5.46 ms and land hierarchy warming at 0.93 ms. Capture averaged **3.79 ms / 18.7%**. Those are the best-supported next CPU targets.

## CPU and allocation evidence

The CPU/allocation profiler raised mean tick time by **24.0%**. Its final snapshot and checkpoint hashes match the control exactly. Use the control for timing claims; use the instrumented run to locate work. Additional hitches that appear only under instrumentation are not evidence of equivalent uninstrumented gameplay stalls.

Merged CPU self samples identify `PlanningWorkspace.step` (5.47%), `RoutePlanner.step` (4.49%), `Simulation.capture` (4.35%), GC (4.24%), and `Simulation.aiFootprintAllowed` (3.21%). Anonymous Simulation callbacks account for another 5.56%; heap call stacks locate the largest ones in exact routing and topology-neighbor checks. Self percentages exclude callees and should not be added to inclusive phase measurements.

Allocation sampling included collected objects. It estimated about 28.55 GB of transient JS allocations during the instrumented run, **not a retained heap or a leak**. Treat the totals as sampling estimates and the ranking as actionable:

| Allocation self site | Share of sampled estimate |
|---|---:|
| Simulation anonymous callbacks, principally routing call stacks | 17.60% |
| Simulation.capture | 12.40% |
| AiOperations.canEnter | 6.39% |
| Simulation.aiFootprintAllowed | 5.13% |
| HomeTerritory.frontier | 3.91% |
| Fortifications.segmentTiles | 3.66% |
| FormationOccupancy.refresh | 3.62% |
| Formations occupancy refresh | 3.57% |
| Fortifications.clear | 3.11% |

Source-backed follow-up candidates, in order:

1. **Routing permission traversal:** remove per-cell predicate/iterator churn; resolve faction policy through indexed player facts; use bounded reusable scratch for footprint traversal. Keep ownership, diplomacy, threat expiry, component restrictions, deterministic work charging, human priority, and fair queue selection identical. Do not trade these guarantees for a superficially faster planner.
2. **Capture traversal:** examine repeated iterable/closure work around cached footprints, capture queries, defensive-building predicates, and accelerated-capture maps. Reuse bounded scratch only with a clear reset lifetime. Keep pressure aggregation, claim order, resistance, and live diplomacy/wall checks unchanged.
3. **Fortification rays:** provide an allocation-free early-exit traversal for boolean clearance while retaining materialized tile lists for callers that need them. Preserve exact supercover corner behavior and tile visitation order.
4. **Formation reservations:** reuse reservation records and numeric bucket identities rather than rebuilding arrays, point objects, and string keys repeatedly. Preserve queued destinations and collision ordering. Avoid maintaining two divergent occupancy implementations.
5. **Frontier exploration:** replace per-cell neighbor arrays with bounded scratch while preserving the existing 60-tick refresh policy and stable frontier ordering. Changing that refresh cadence is gameplay work, not a behavior-preserving optimization.
6. **Restore startup:** measure restore/loading separately, then consider initializing derivable caches before the first paced tick without advancing authoritative state. Verify final-state equality and unchanged route work. Merely moving a hitch into a different measured region does not reduce total load cost.

The evidence favors simplifying these specific inner loops before another broad architectural rewrite. It supplies no measured speedup for any proposed follow-up.

## Browser rendering

See `browser.json` for the accepted final run and `browser.png` for the captured scene. The fixture runs 1,500 holding squads and 200 towers on a 192x128 land map, at a fit-to-map overview. It uses the real simulation in a worker, ordinary combat/capture, SnapshotEncoder/Decoder, and Renderer. AI decisions, movement orders, online HUD, and sockets are absent. This does not qualify tactical zoom, active mass movement, aircraft/naval effects, or the full online UI.

The initial timing run completed without a frame gap over 50 ms, but its post-run screenshot was blank. That image is not accepted as visual proof. The final run counts actual renderer draws, excluding frame-limit skips, and keeps the GPU scene drawing briefly for inspection. Both the live and post-run scenes were visibly verified in the accepted rerun. During verification restart, the default Vite configuration initially served the upstream OpenFront front end; this was corrected to `vite.skirmish.config.ts` before the accepted diagnostic run. No OpenFront-page timings are included.

| Accepted browser metric | Mean | p95 | Maximum |
|---|---:|---:|---:|
| Actual renderer draw | 2.05 ms | 2.90 ms | 7.80 ms |
| Frame interval | 15.40 ms | 20.10 ms | 30.10 ms |
| Renderer update | 1.08 ms | 1.70 ms | 2.20 ms |
| Snapshot decode | 0.13 ms | 0.20 ms | 0.40 ms |
| Simulation worker tick | 8.61 ms | 11.60 ms | 21.70 ms |
| Snapshot encode | 0.52 ms | 0.70 ms | 2.40 ms |

The 30-second run retained all 1,500 squads, delivered 592 packets, and recorded no long task or frame gap over 50 ms after its three-second warmup. CPU draw timing does not measure asynchronous GPU completion.

## Hosted multiplayer

See `hosted-smoke.json` and `hosted-diagnostics.json` for final results. This uses the actual coordinator, match worker, encoding worker and authenticated WebSockets on loopback, with an isolated local database: six humans, ten regular AI, 25 tribes, Old World size 1000, Modern Age, ordinary finite gold. Five clients negotiate binary snapshots and apply the packed canonical presentation path; one uses legacy text snapshots. All AI policy flags remain enabled.

The smoke exercises initial and periodic physical movement, construction completion, trade toggles, invalid-command rejection, an explicit resync, withholding one peer's publication credits for two seconds, and reconnecting a living human. Agreement hashes compare owners, squads, ships and buildings at common ticks; they do not cover every field of the full game state. The headless client applies the same canonical stream APIs without a browser rendering worker or HUD.

**Passed:** 600-second monitored interval, 623.6 seconds including setup, all clients at tick 12205, 299 common-state agreement samples, 143 periodic orders with observed motion, all ten regular AI factions displaced, reconnect succeeded, explicit resync and credit-starvation recovery rebased successfully. Binary clients received only binary state frames; the legacy peer received only text state frames. No smoke failures.

At the last periodic diagnostic sample (tick 11725, before the final 24 seconds of the monitored interval):

| Hosted metric | Result |
|---|---:|
| Lifetime simulation tick mean / maximum | 9.41 / 45.23 ms |
| Simulation ticks over 50 ms | 0 / 11,725 |
| Whole worker advance mean / maximum | 11.87 / 54.34 ms |
| Whole advances over 50 ms | 1 / 9,517 |
| Recent simulation p95 / p99 | 15.53 / 22.16 ms |
| Simulated-time / wall-time ratio | 0.99987 |
| Peak observed squads / buildings / ships / traders | 296 / 109 / 2 / 9 |
| Observed socket-buffer bytes | 0 |

Runtime samples show process RSS rising from 401.5 MiB to 674.7 MiB, mostly during startup/cache warmup. Reported hierarchy tree bytes rose from 7.4 MiB to approximately 88 MiB and then levelled off; late heap usage continued to rise and fall with GC. This is consistent with cache warmup plus allocation churn, **not proof that memory is leak-free**. A multi-hour retained-heap study is still needed to rule out slow growth.

**Responsiveness warrants further work:** order send to first motion observed in a received snapshot was 333 ms at p95 (143 samples; maximum 369 ms). State publication gap p95 was 253–254 ms. The deliberately credit-starved legacy peer had a 1,441 ms maximum gap and recovered. Fast simulation ticks therefore do not finish the input-responsiveness investigation. Instrument admission, execution and publication timestamps together before choosing a cadence or protocol change; these measurements do not isolate each contributor.

Binary peers transferred approximately 34.8 MB each, versus 46.2 MB for the legacy peer. Recovery histories differ, so these totals are a practical transport observation, not a controlled codec benchmark. Headless per-peer decode p95 is elapsed time around asynchronous decoding in one process shared by six clients; interleaved work contributes, so it is not isolated browser decode CPU.

Credit starvation exercises flow-control recovery, not WAN loss, real socket-buffer saturation, or slow browser projection. Diagnostics distinguish simulation tick, whole advance, scheduler lateness, extraction, encoder, fanout, GC and memory. Rolling p95 values are not whole-soak p95; lifetime counters and histograms supply whole-match observations up to the last log sample.

This is one bounded local match, not maximum-player, multi-match capacity, overnight stability, deployment, ARM, WAN, or release qualification. Enabled naval/trade features that do not produce entities during the run are not thereby tested.

## Validation and cleanup

The paired replay hashes matched; hosted smoke exited successfully; the accepted browser diagnostic passed with the scene visibly verified; TypeScript and syntax checks for diagnostic scripts passed. The first browser harness revision encountered a diagnostic-only indexing error, corrected before the accepted runs. Existing public-directory import warnings from Vite remain. Temporary browser tabs and servers started for these tests were closed. No deployment or production gameplay fixes were performed.
