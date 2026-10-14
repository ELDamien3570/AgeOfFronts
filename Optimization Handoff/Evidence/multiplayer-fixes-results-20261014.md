# Multiplayer fixes: implementation and qualification

The multiplayer pipeline changes materially reduce command receipt latency and
network traffic. They do **not** make this late-game workload sustain 20 Hz on
the two-core ARM server. This is a qualified pipeline improvement, not a claim
that all multiplayer lag has been solved.

## Implemented behavior

- The coordinator requests one canonical tick at a time, returning to its event
  loop between ticks so queued orders and completed publications can be serviced.
  Worker mutations remain serialized. Clock debt stays bounded. Overdue ticks
  yield with `setImmediate`; future deadlines use a timer.
- Background publication is capped in both wall time and simulation time:
  at least 200 ms and four completed ticks between background captures. Executed
  commands retain immediate publication. This avoids increasing capture work
  per logical tick when simulation is overloaded.
- The server uses the existing compact formation-slot and trader formats.
  Join/recovery baselines retain the live encoder's slot IDs and include pending
  retired IDs, without consuming shared delta cursors or transferring canonical
  geometry buffers. Subsequent removals and deltas remain valid for all clients.
- Canonical network packets are decoded and validated once. The state worker
  sends trusted decoded entity data and sparse tile obligations to presentation,
  eliminating the second JSON packing/validation pass. Structured cloning still
  isolates entity graphs. Only owned sparse tile buffers are transferred.
- Presentation applies map/geometry changes when a view is actually presented.
  Dropping/coalescing views preserves unacknowledged changes and does not mutate
  the renderer's currently displayed map prematurely.

No AI, combat, economic, pathfinding, planning-budget, simulation-frequency or
player-facing timing rules were changed. The contract is in
[multiplayer-fixes-contract-20261014.md](multiplayer-fixes-contract-20261014.md).

## Matched pipeline measurements

Baseline source was frozen before these changes, matching the user's `Pre-fixes`
commit `7de4bc653e1cd1eae61aa085e58f270c6d180148`. Candidate measurements use the
final source. Both run the actual coordinator, match worker, binary WebSockets,
network decoder, canonical state worker and presentation path. Three clients
run in separate worker threads and issue one-squad orders every five seconds.

The fixture uses Migration, 1000 x 1000 cells, seed 1272661902, 10 regular AI,
25 tribes, three human empires and a Napoleonic age cap. It starts with 700
squads and 300 warships, then evolves through normal domain APIs; entity counts
change during the run. It is a controlled late-game workload, not a recording
of the unavailable historical human match or its exact late-game economy.

| Metric | PC before | PC after | ARM before | ARM after |
| --- | ---: | ---: | ---: | ---: |
| Mean executed-command receipt | 159.4 ms | 86.9 ms | 483.4 ms | 174.6 ms |
| Received update gap, p95 | 304.1 ms | 245.3 ms | 380.9 ms | 408.8 ms |
| Observed encode completion, mean | 99.8 ms | 44.8 ms | 280.6 ms | 87.0 ms |
| Traffic per client | 357.4 KiB/s | 280.2 KiB/s | 235.8 KiB/s | 187.5 KiB/s |
| Simulation pace | 0.991x | 0.999x | 0.729x | 0.691x |

PC measurements last 60 seconds; ARM measurements last 90 seconds. All 33 PC
orders and 51 ARM orders executed in their respective candidate runs. There
were no client decode errors or automatic rebases. ARM tests used a private
SSH tunnel and an isolated container limited to two CPUs and 4 GB memory.
This is not an Internet RTT comparison or a production deployment.

Receipt latency means the client received an **executed** outcome, not the
time until the first visible movement. Encode completion includes scheduling
and dispatch delays; it is not just compressor CPU time. Active orders commit
at different ticks after scheduling changes, so their evolving combat/movement
work is not an exact simulation-capacity comparison.

The ARM update-gap result is a remaining limitation, not a win. Faster order
service does not guarantee smoother interpolation when snapshots still arrive
hundreds of milliseconds apart. Further work must address simulation capacity
and presentation of those gaps, with gameplay-preserving measurements.

## Fixed simulation boundary comparison

To separate pipeline responsiveness from evolving input workloads, the ARM
baseline and final candidate also ran the identical idle interval from tick
3100 to tick 3700, with 100 logical warm-up ticks. Both end with 725 squads,
278 ships, 160 buildings, 172 traders, six projectiles and 81 recruitment jobs.

| Metric | Baseline | Final candidate |
| --- | ---: | ---: |
| Wall time for 600 ticks | 42.957 s | 43.395 s |
| Simulation pace | 0.698x | 0.691x |
| Tick mean in final diagnostic window | 75.23 ms | 75.05 ms |
| Observed encode completion mean | 294.5 ms | 92.1 ms |

The simulation-capacity result is effectively unchanged, with a small wall-time
regression in this pair. It fails sustained 1x acceptance. At 20 Hz the budget
is 50 ms, while simulation alone remains around 75 ms. Pipeline changes cannot
erase that gap. A migration to a 100 ms simulation step would be a separate
gameplay/timing contract, and was not implemented here.

The final ARM diagnostic window attributes about 22.30 ms per tick to movement,
18.14 ms to combat and 12.38 ms to routing; those three phases alone total
52.82 ms. AI averages 6.22 ms and economy 2.24 ms. These are scoped timing
measurements, not proof that any whole subsystem can be safely skipped or
rescheduled. They identify the next simulation investigation rather than
justifying a silent gameplay change.

An intermediate variant used one-tick requests but continued capturing at
5 Hz in wall time under overload. It reduced ARM pace to 0.645x by doing more
captures per logical tick. That variant was rejected; the final logical-time
capture guard prevents that failure mode. Raw intermediate runs are retained
for audit rather than hidden.

## Client work and rendering evidence

On the matched PC run, canonical application fell from 8.01 to 4.85 ms.
Presentation projection fell from about 5.09 to 0.052 ms, and applying a view
fell from 8.91 to 0.045 ms. Those latter figures exclude object transfer:
modeled structured-clone work increased from 2.93 to 13.29 ms. The new path
removes redundant serialization/validation but does not make large entity
graphs free to send. Claiming a 200-fold improvement for the entire UI pipeline
would be incorrect. The headless harness does not measure DOM or drawing.

The actual built browser client joined the fixture match, displayed formations,
and completed a Grenadier movement order. Five steady diagnostic samples
between ticks 3583 and 5907 showed approximately 93-97 FPS, frame p95 around
10-20 ms, and presentation means around 9-12 ms. No decode errors or recoveries
were observed. This is a functional/rendering smoke check at overview and
partial formation zoom; it is not a controlled before/after FPS comparison or
a worst-case dense-camera qualification. The final zoom screenshot was captured
after the helper timed out and is visual evidence only.

## Correctness and release checks

- A 400-tick continuation produced deeply identical canonical checkpoints and
  identical SHA-256 hashes for baseline and candidate:
  `6fbb82b095127103474ebeaf5d20be28f5b3138dd54bd08bb8de83d51fc5b5a4`.
- Actual compact network encoding/decoding and direct presentation were compared
  with canonical state across 67 presented frames, 34 dropped frames and two
  recovery baselines. Tile reversions, removals and shared slot-dictionary churn
  are covered by focused tests.
- Full skirmish-suite final rerun: **343 files and all 2,372 tests passed**
  (416.03 seconds, clean exit). An earlier run exposed one stale lifecycle
  fixture that assumed each worker request advanced four ticks. The fixture
  now advances four individual ticks; flow-control assertions were preserved.
- TypeScript passed after the final test-fixture correction. The production
  skirmish build passed with the final source; its existing large-chunk warning
  remains. `git diff --check` passed.

## Artifacts and operational state

Raw runs and the actual socket/worker harness are under ignored local
`out/multiplayer-pipeline-20261014/`. Qualification, state equality, test/build
logs and browser evidence are under `out/multiplayer-fixes-20261014/`.
`summary.json` in the latter directory aggregates the matched runs. Headline
cases are `baseline-small-clean`, `candidate-final-clean`,
`arm-baseline-matched`, `arm-active-final`, `arm-fixed-baseline` and
`arm-fixed-final`.

Production was not deployed, restarted or reconfigured. The profiling container
was stopped and removed, the SSH tunnel closed, and production health confirmed
`status: ok`, zero active matches and zero stalled matches. No paid hardware was
started. Source changes remain local and uncommitted for review.
