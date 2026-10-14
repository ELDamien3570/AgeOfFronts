# Further ARM simulation qualification

This pass continues from the previous multiplayer pipeline fixes. The target
remains sustained 20 Hz / 1x on the existing two-core Always Free ARM machine.
All results below use the validated Migration 1000 x 1000 fixture, seed
1272661902, 10 regular AI, 25 tribes, three human empires, Napoleonic cap and
initial 700 squads/300 warships. Population evolves during continuation.

The starting working tree was frozen under `out/arm-1x-20261014/baseline/src`.
It includes the prior uncommitted pipeline fixes. The new simulation changes
preserve work budgets, RNG, selection order, entity authority and 20 Hz timing.

## Changes and validity

- Entirely owned capture footprints skip their per-tile side-effect loop only
  when no undefended-capture acceleration or fallout processing is required.
  Their pressure contributions remain retained, so competing claims still
  resolve normally. The existing `changeOwner`/`invalidateCapture` path dirties
  every affected contributing center; movement, permissions and lifecycle changes
  also refresh the existing contribution cache. Checkpoint restore clears it.
- Route selection reads eligibility and priority once within a selection quantum
  and reuses that scratch through reservation/fair-selection scans. Reads refresh
  next quantum, including after completion callbacks change the domain. Legacy
  scheduling versions, priority proportions, caller/player ordering, exclusive
  retries, arena reclamation and work counters are preserved. Scratch is bounded
  by the queue and released after selection.
- Polygon contact retains the exact containment tolerance, source/target tie
  ordering, intersection arithmetic and fallback overlap test. It replaces nested
  containment callbacks with loops and hoists invariant source-edge arithmetic
  outside the target-edge loop. No geometric approximation was introduced.

A movement-phase extraction was tested as a separate experiment. Its PC probe
improved, but an alternating ARM comparison reduced runtime by only 0.65%
(88.144 s versus 87.575 s for 1,200 ticks). Both checkpoints were identical.
That small result does not justify a large source relocation under the observed
run-to-run variation. The experiment was **not retained** in the working source.

## Simulation-only measurements

The CPU sample at tick 3100-3700 reached 0.740x. This excludes snapshot capture,
compression, coordinator scheduling and clients; it is not multiplayer pace.
Single-process no-profiler controls reached 0.702x and 0.760x, while the first
combined candidate reached 0.781x. That spread makes a single-run headline gain
unreliable. The first owned-footprint candidate reached 0.767x. All have identical
final ARM checkpoint hashes at tick 3700:
`06ea18b241960b9ad176d182b799a1a64e23cf3225edadc06b4d741bd9248633`.

A longer alternating comparison warmed both worlds for 300 ticks, then ran
24 blocks of 50 ticks each, alternating which implementation ran first. Each
world advanced the identical interval from tick 3300 to 4500. Both worlds share
one process/GC and are advanced sequentially, so this comparison controls host
load better but does not model a single production match's memory footprint.

| Alternating simulation-only comparison | Starting code | Three optimizations |
| --- | ---: | ---: |
| Time for 1,200 ticks | 90.116 s | 87.355 s |
| Pace excluding other world's runtime | 0.666x | 0.687x |
| Mean tick | 75.09 ms | 72.79 ms |
| Capture phase mean | 6.94 ms | 5.89 ms |
| Routing phase mean | 11.73 ms | 11.33 ms |
| Movement phase mean | 23.32 ms | 23.28 ms |
| Combat phase mean | 18.29 ms | 18.08 ms |

The measured reduction in total runtime is **3.06%**. Capture is about **15%**
cheaper; approximately 582 entirely owned squad footprints skip that loop per
tick. Most movement cost remains. Do not attribute every phase difference to
the edits: JIT and GC effects also affect this shared-process comparison.

Both final serialized checkpoints have identical SHA-256 hashes:
`8b701891dcb1ad28b7ef40ac24040f6ff8e9170275f2060668b885ec79104b91`.
PC baseline and candidate 600-tick checks also have identical hashes. These
are comparisons within each architecture, not a cross-architecture determinism
qualification.

## End-to-end and remaining target

The actual three-client coordinator ran two before/after pairs in A/B/A/B order,
each over the identical tick 3100-3700 interval, after 100 logical warm-up ticks.
These include snapshot capture, off-thread encoding, socket framing, canonical
client application and presentation transfer. Clients run on the PC through
private SSH forwards. They are idle in this fixed-boundary test, allowing exact
comparison of world progress; this is not a new active-order latency test.

| Three-client ARM run | Starting code | Final candidate |
| --- | ---: | ---: |
| First pair pace | 0.669x | 0.687x |
| Second pair pace | 0.664x | 0.674x |
| Combined pace, total ticks / total wall time | **0.667x** | **0.680x** |
| Total wall time for two 600-tick runs | 89.987 s | 88.180 s |
| Mean tick, average of final diagnostic windows | 77.87 ms | 76.30 ms |
| Capture mean, same windows | 7.86 ms | 6.74 ms |
| Routing mean, same windows | 12.45 ms | 12.09 ms |
| Movement mean, same windows | 23.21 ms | 23.56 ms |
| Combat mean, same windows | 19.61 ms | 18.78 ms |

That is **2.01% less wall time / 2.05% more throughput** across these repeated
end-to-end samples. All four runs finish with 725 squads, 278 ships, 160 buildings,
172 traders, six projectiles and 81 recruitment jobs. All clients report zero
decode errors and zero rebases. Client update-gap p95 spans roughly 420-456 ms
across the runs and is not consistently improved. The second candidate also has
a 275 ms maximum tick in its final diagnostic window; large spikes remain.

This is a modest improvement, not sustained 1x qualification. Do not compare the
best simulation-only result (0.781x) to the previous report's multiplayer pace
(0.691x) and call the difference a gain: those are different measurement paths.
The repeated matched pipeline results above are the primary capacity evidence.
There are too few independent runs to claim a tight statistical confidence bound.

The 50 ms budget still requires a substantial reduction in movement/combat/routing
cost. At 0.680x, the equivalent interval needs roughly another **32% reduction in
wall time** to reach 1x. Lowering tick frequency or AI decisions would change the
agreed behavior and was not done. The next useful investigation is reducing
repeated exact movement/contact work with demonstrated validity dependencies;
the rejected movement extraction does not establish that a refactor alone closes
this gap, nor do these measurements establish that parallel simulation is required.

## Validation and operational state

- All **2,373 skirmish tests across 343 files passed** (412.96 seconds), including
  a new owned-footprint pressure/ownership invalidation regression.
- Focused capture, planner fairness, arena/retry and formation contact tests pass.
- TypeScript, production skirmish build and `git diff --check` pass.
- Tests and simulation-only CPU sampling are separate from browser FPS and actual
  multiplayer qualification. No new rendering-performance claim is made.
- All ARM work uses isolated temporary containers with two CPUs/4 GB limits and
  a production-activity guard. No paid hardware or production deployment was used.
- All temporary containers and the private SSH tunnel have stopped. Final
  production health is `ok`, with zero active or stalled matches. The final ARM
  candidate hashes match the three changed local source files. Source remains
  uncommitted and undeployed; prior pipeline edits were preserved.

Raw CPU profile, frozen sources, repeated timings, checkpoint equality, experiments
and validation logs are retained locally under `out/arm-1x-20261014/`. Actual
multiplayer raw runs use `out/multiplayer-pipeline-20261014/`. Prior pipeline
results remain in `multiplayer-fixes-results-20261014.md`.
