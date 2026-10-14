# Migration performance work contract

Target: Migration 1000 cells, 10 AI, 25 tribes, three human seats, Napoleonic,
700 squads and 300 warships. Use the validated fixture at
`out/migration-lag-20261014/scenario.v8`; it is a population stress fixture,
not a captured player late game. Primary measurements use the local PC and
ordinary browser worker, renderer, and HUD at 1x.

Keep simulation timing, planner budgets, AI decisions, combat/contact geometry,
formation fit and collision checks, command/recruitment selection and tie order,
and publication cadence unchanged. Derived caches stay bounded or weakly owned
and do not enter checkpoints. Same-machine baseline and candidate checkpoints
must match. Cross-platform heading differences found during profiling remain
an explicit separate correctness concern, not an excuse to relax this guard.

Investigate measured repeated spatial/geometry preparation, route work and HUD
quote/empire projection. Reuse only facts whose complete dependencies are known.
Snapshot or selection changes must immediately refresh availability; no delayed
UI or reduced planning budget is permitted to hide load.

Archive baseline source before edits, alternate unprofiled baseline/candidate
runs, inspect route completion and waiting cohorts, and verify in a rendered
close-up. Require focused correctness coverage and full TypeScript/tests/build.
Report sustained progress and tail times; do not declare lag resolved from an
average alone. Do not push or deploy as part of this request.

## Retained implementation

- `CombatGeometry` owns an envelope cache separately from translated bodies.
  Motion invalidates world contact bodies while preserving exact unchanged
  formation dimensions. Definition, kind, count, capacity/variant, immutable
  formation, charge phase and animated tick remain dependencies.
- Naval combat borrows the existing phase ship index. Alive-warship consumers
  share it only after proving identical inclusion at the same revision. Death,
  membership and restore keep their independent invalidation contracts.
- `LocalAvoidance` derives its root broad phase from the existing collision
  radii instead of assuming two maximum-size legacy cavalry discs. Formation
  collision still uses its exact body guard. Preferred-path squared tolerance,
  hostile trajectories and simultaneous cancellation remain unchanged.
- Avoidance scratch is owned by current entity ID, reused and retired promptly.
  It no longer clears/reallocates the whole ID map every tick. Intent references
  are released at the end of the solve; scratch is absent from checkpoints.
- Resting free-travel locomotion reuses an exact integrator fixed point only
  with no requested goal, zero speed, no charge/afloat mode, no explicit Hold
  facing, and exact floating-point normalization. It supplies the same zero
  intent to the ordinary avoidance/clearance/rollback path. Other cases retain
  the full integrator, including moving, turning and braking cases.
- Recruitment quotes prepare selection origin, queue workloads and faction
  counts once per synchronous HUD query batch. Research-ineligible automatic
  tiers skip expensive quote preparation. Each subsequent query refreshes all
  inputs; no cross-update availability cache or throttled UI was introduced.

## Measurements and correctness

Archived baseline source: `out/migration-fixes-20261014/baseline/src`, from
`5764f97cb957d318e9dfeec109bb10065bdf6336`. PC: Ryzen 7 3700X, approximately
48 GB RAM, Node 24.18.0. No simulation timing constants or planner allowances
were changed.

The final paired Node continuation alternated baseline/candidate order each
tick, with 40 warmup and 600 measured ticks. The ordinary rendered replay was
closed during this measurement. Both games finished with the same checkpoint
SHA-256 `4d12f0722f112a2f093fdfa09298718131da126dbadb15694d95030a997ff343`.
All routing cohorts, motion counters and trade delivery metrics were identical.

| Paired Node metric | Baseline | Candidate |
|---|---:|---:|
| Simulation mean | 49.39 ms | 46.51 ms |
| Simulation p95 | 66.08 ms | 62.14 ms |
| Worker mean (simulation + encode + clone) | 53.24 ms | 50.36 ms |
| Worker p95 | 71.51 ms | 66.59 ms |
| Worker ticks over 50 ms | 326/600 | 271/600 |
| Movement mean | 15.07 ms | 13.34 ms |
| Combat mean | 12.89 ms | 11.85 ms |

This is approximately 5.8% less simulation time and 5.4% less worker time.
The paired process shares GC and memory between two matches; its absolute
durations do not certify browser or hosted capacity. A separately loaded
intermediate baseline/candidate comparison also had deeply equal deserialized
checkpoints, although raw V8 bytes differed. Use content equality and the paired
hash guard rather than interpreting every raw serialization difference as a
gameplay divergence.

An alternating 1,000-update recruitment benchmark produced identical quotes:
baseline 0.467 ms/update, candidate 0.073 ms/update (approximately 84% less work).
See `out/migration-fixes-20261014/hud-bench.json` and `hud-bench.ts`.

The intermediate normal-client run reached 822 squads / 261 warships. A
selected Grenadiers close-up measured frame interval mean 10.79 ms, p95 20 ms;
HUD mean 3.84 ms, quote section 0.174 ms, empire section 1.68 ms. The earlier
investigation's selected close-up measured 20.6 ms mean frame interval and
9.65 ms HUD time, but these are different camera samples and populations, not
a controlled FPS ratio. The client improvements are corroborated by the exact
quote benchmark. The intermediate simulation still ran at 0.955x; its worker
average was 52.27 ms. Final renderer qualification follows separately.

The scenario populates units through valid domain APIs after 3,000 normal
ticks. It does not reproduce a captured player economy or three active human
strategies. Counts naturally change during continuation. No live multiplayer
network capacity or E5 hardware claim follows from these local results.

Focused coverage includes exhaustive hostile broad-phase comparisons for
formation, legacy and mixed carriers, removal/replacement and restore; envelope
translation and physical invalidation; exact idle-integrator/signed-zero
behavior; naval view inclusion after death/restore; and fresh quote availability
after selection, stock and research changes.

Performance has improved, but sustained 1x with comfortable 50 ms headroom is
not established by these Node results. Remaining simulation tail costs must be
reported explicitly before deciding on a timing change.

## Validation status

Full TypeScript and the production Vite build passed. All 342 test files / 2,366
tests passed with `--maxWorkers=2`. The initial unrestricted parallel run hit
29 test timeouts; the bounded rerun kept the existing timeout limits and passed.
No failed assertion was waived. `git diff --check` passed.

The final foreground verification completed after the user activated the replay
panel. Old background samples initially remained in the 256-frame window; those
readings are excluded. Once flushed, the overview measured 11.53 ms mean frame
interval (about 87 FPS), p95 20.10 ms. Its worker mean was 61.07 ms, p95 85.60 ms,
and simulation progress over the measurement window was 0.845x real time.

The dense formation close-up finished at tick 12,985 with 826 squads and 272
warships. It measured 13.49 ms mean frame interval (about 74 FPS), p95 30 ms,
p99 40 ms; frame work mean 7.38 ms and HUD mean 6.64 ms. Worker mean was
67.13 ms, p95 91.70 ms, p99 131 ms, maximum 206.40 ms. Simulation-only mean
was 63.64 ms, p95 87.80 ms. Window progress was 0.740x real time, computed
from differences in diagnostic simulatedMs and wallMs, excluding prior paused
time. No browser error entries were returned. The replay was paused afterward.

The continuously evolving scenario and different camera windows do not isolate
the reason for the slowdown between windows. They do establish that the final
client renders well above 60 FPS on average while simulation fails sustained
1x. These optimizations are correct and useful, but do not resolve all lag.
Simulation timing has not been changed. Evidence is saved in
`out/migration-fixes-20261014/foreground-{start,end,clean,detail}.json` and
`foreground-final.png`.

Changes remain local. No commit, push, production deployment or new Oracle
instance was made during this implementation task.
