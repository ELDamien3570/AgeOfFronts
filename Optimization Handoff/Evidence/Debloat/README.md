# Feature-preserving performance and simplification pass

All existing gameplay features remain. Spending rules, AI asset control,
admission/fairness, deterministic timing and checkpoint guarantees remain.
DDD and MVVM are no longer requirements for new features in the current
skirmish architecture document.

## Implemented

- Reuse sorted land membership and refresh spatial geometry by revision at the
  existing phase boundaries. Keep the separate held-unit grid.
- Replace rollback coordinate objects with dense Float64 scratch and avoidance
  Map/Set churn with reusable live-unit rows. Compare melee approach cache facts
  exactly rather than allocating large serialized keys or using collision hashes.
- Schedule exact route work with one eligible queue scan per quantum while
  preserving player/caller rotation, priority and FIFO heads.
- Pack entity details into versioned transferable buffers, including ships,
  volleys and variable ID lists. Preserve optional/null distinctions and numeric
  precision. Validate before canonical mutation and accept legacy packets.
  Transfer only packet-owned buffers; clone road geometry before transferring.
- Refresh HUD projections in place, guard repeated DOM writes, cache territory
  glyph advances and published labels, and remove the population-triggered 30 Hz cap.
- Require shared trade spatial views and remove the unused fallback grids.

## Measurements

Frozen baseline: `5c778ef8065e5a1e831386bf189409d98f41e378`.

| Local workload | Baseline | Candidate | Evidence |
| --- | ---: | ---: | --- |
| Existing late-game checkpoint, mean tick | 24.316 ms | 22.300 ms | Three runs of 400 ticks each; 8.29% reduction |
| Synthetic 1500 marching squads, mean tick | 15.710 ms | 14.406 ms | Two runs of 200 ticks each; no AI or combat |
| Browser packet clone/transfer, mean synchronous cost | 2.097 ms | 0.263 ms | 1500 stationary squads; 120 samples |

The packet comparison excludes candidate encode (0.857 ms) and decode
(1.449 ms); it is not an end-to-end worker pipeline speedup claim.
The mass workload was measured before the final scheduler change and has no
active route jobs. Every baseline/candidate replay comparison has identical
canonical snapshot and checkpoint hashes.

The browser renderer made zero territory `measureText` calls during drawing
and admitted all 60 synthetic frames at 60 Hz with 1500 squads. Actual sampled
draw intervals included a 710 ms outlier; sustained 60 FPS is not established.

## Validation

- 1308 tests passed across 194 files with `--maxWorkers=2`.
- TypeScript `--noEmit`, skirmish production build and `git diff --check` passed.
- Browser canonical projection regression passed.
- Local gameplay loaded, selected three squads with correct troop totals and
  paused/resumed without browser errors. Recruitment was unavailable without
  a barracks and was not exercised by this short UI smoke test.

## Plan corrections and remaining costs

The plan's four identical spatial rebuilds are actually three movement-phase
refreshes and a separate held grid. A single start-of-tick rebuild would leave
boarding or moved units stale for later consumers. Float32 scratch would reduce
precision; entity-ID sized arrays would grow with match lifetime.

Many quotes already are direct functions. Budgets, leases and admission own
real spending, control and fairness behavior, so removing them would violate
the requested feature preservation. Snapshot entity deltas also already exist.
Players, expansion metadata and string tables still use structured cloning.

The remaining late-checkpoint phase means are about 6.58 ms routing, 4.32 ms
capture and 3.45 ms movement. Further performance work needs to address those
costs with equivalent-state evidence, not merely remove architectural names.

There is no DevTools allocation trace, measured allocation-rate reduction,
flat-heap proof, sustained multiplayer frame-rate qualification or ARM result.
The CPU profile includes setup and still records garbage collection. The plan's
3.5x, sub-10 ms and near-zero-GC targets were not achieved or established.
The production build retains the existing large-chunk warning.

`summary.json` contains exact aggregates and limits. The adjacent JSON files
contain raw per-tick timings. `candidate.cpuprofile` and `cpu-summary.json`
describe the whole-process profile before the scheduler improvement.

## Reproduce

```powershell
node --import tsx tests/skirmish/debloatBenchmark.ts . out/debloat-current.json 400
node --import tsx tests/skirmish/debloatBenchmark.ts . out/debloat-mass.json 200 mass
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
```

The late-checkpoint harness requires
`out/overnight-1000/seed42-filtered/checkpoint-60000.v8`, whose SHA256 is recorded
in `summary.json`. Frozen sources were extracted into `out/debloat-baseline`
from the baseline commit; the benchmark accepts that directory as its first
argument. Browser harnesses are `tests/skirmish/browser/DebloatProfile.html`
and `tests/skirmish/browser/P14Projection.html` on the skirmish Vite server.
