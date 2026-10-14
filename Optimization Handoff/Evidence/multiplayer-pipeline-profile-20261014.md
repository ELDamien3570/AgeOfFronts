# Multiplayer pipeline profile — October 14, 2026

## Findings

The controlled multiplayer pipeline has three distinct problems: simulation
overruns, catch-up batches delaying publication/command handling, and substantial
client state reconstruction work. Adding idle connections alone did not produce
a material slowdown on the PC. Socket fan-out was small, and client baseline
recovery was not observed in the measured runs. The prior theory that several
humans necessarily push publication frequency toward 20 Hz was not demonstrated:
the frequent group-order run instead stayed below 5 Hz and generated deferred
and superseded commands.

The latest late-game player match cannot be retrospectively diagnosed from
retained production logs. The running application container was created at
03:58:33 UTC on October 14; it retains only a short early-game session,
match-246, reaching tick 593. Those early samples show approximately 1x progress,
not late-game performance. This report diagnoses controlled workload behavior,
not the exact cause of that missing player session.

## Workload and pipeline

Migration 1000 x 1000, seed 1272661902, Napoleonic, 10 regular AI, 25 tribes,
three human empires, initial 700 squads / 300 warships. Restore uses the validated
`out/migration-lag-20261014/scenario.v8` fixture through the normal restore
validator. AI remains active and population evolves. This is a population stress
fixture after 3,000 natural ticks, not a captured late-game human economy.

Each run starts an isolated in-memory coordinator. The real coordinator,
LiveMatch scheduler, reserved match worker, off-thread encoder, publication queue,
binary WebSocket framing and client flow-control receipts are used. A generated
copy of the worker only replaces initial match construction with validated
fixture restoration; production source is unchanged. The one-client run retains
the same three human empires, with two absent seats remaining idle, to isolate
connection count from simulation population.

Three separate Node client threads use actual binary framing and the actual
`multiplayerStateWorker.ts`, with a browser-worker adapter. Each applies the
canonical state, projects a packed view, structured-clones its transfer buffers
and decodes the presentation snapshot. There is no DOM, renderer, HUD, browser
main-thread contention, or OnlineMatchSession presentation coalescing. Thus
these are pipeline measurements, not browser FPS or full UI latency claims.

The clients record execution receipts; these are **not first visible movement**.
Frequent group-order stress selects eight squads per client each second. Because
the fixture scatters some added squads, these can require long regrouping routes.
The ordinary-order runs select one squad per client every five seconds.
The 150 ms RTT probe delays incoming messages and outgoing receipts/orders by
75 ms each; it does not emulate bandwidth caps, packet loss or network jitter.

Local runs use Node 24.18.0 and the current working tree, including prior local
simulation/HUD optimizations. Runs are sequential, with 10 seconds warmup and
30 or 45 seconds measurement. Absolute timings vary with evolving state, JIT and
GC; these are not alternating paired CPU-capacity comparisons.

## Measurements

| Run | Simulation progress | Received states/sec | Client 0 delivery gap p95 | Execution receipt mean |
| --- | ---: | ---: | ---: | ---: |
| PC, one idle client | 0.932x | 4.67 | 352 ms | No orders |
| PC, three idle clients | 0.954x | 4.70 | 357 ms | No orders |
| PC, three frequent group-order clients | 0.900x | 4.46 | 409 ms | No fully executed group receipts |
| PC, group orders with simulated 150 ms RTT | 0.887x | 4.50 | 427 ms | No fully executed group receipts |
| PC, three ordinary-order clients | 0.989x | 5.02 | 341 ms | 213 ms |
| Always Free ARM, three ordinary-order clients | 0.701x | 3.53 | 400 ms | 466 ms |

All measured clients reported zero baseline recoveries and no decode errors.
Sampled coordinator socket buffered bytes were zero. Fan-out means were below
1 ms, including approximately 0.37 ms on ARM. This excludes fan-out CPU cost as
the dominant bottleneck in these runs; it does not exclude a slow real client or
constrained real connection outside these conditions.

The PC frequent-order run admitted 87 commands. Each client received 29 deferred
and 28 superseded receipts. This does not mean no selected squad moved: a lead
cohort can commit before the full command finishes. It demonstrates replacement
and route churn under this stress input. Ordinary single-squad orders all
completed: 24 executed receipts across three clients on PC and ARM.

## ARM scheduling and publication delay

The ARM server used the currently deployed image at
`5764f97cb957d318e9dfeec109bb10065bdf6336`, not the locally optimized PC tree.
Consequently this is a deployed-hardware qualification, not a clean CPU-only
comparison against the PC runs. The server ran in a temporary container on the
existing Always Free machine, limited to two CPUs and 4 GB memory, using its
existing image and an isolated in-memory database. Three clients ran on the PC
through private SSH forwards; SSH adds transport overhead and is not the public
TLS path. Production had no active matches and the helper automatically stopped
if production became active. It has stopped and production health is confirmed.

During 45 seconds measurement the server advanced 636 ticks. **All 159 advance
requests contained four ticks.** Simulation-only time in the last 256-tick window
averaged 70.43 ms, p95 89.03 ms, p99 188.02 ms, maximum 249.06 ms. Movement
averaged 21.59 ms, combat 17.20 ms and routing 11.08 ms. The final population was
729 squads, 274 ships, 161 buildings and 177 traders.

The coordinator publishes at most once per completed advance request. Four
50 ms logical ticks take approximately 280 ms of real computation at this load;
that couples publication cadence to overloaded catch-up batches. Actual delivery
averaged about 285 ms apart, rather than the nominal 200 ms background cadence.
Execution receipts averaged 466 ms and reached 695 ms, including network transit
and waiting for the worker; this is not solely route execution time.

Off-thread encoding does not remove result-dispatch latency. ARM encoder phase
means were approximately 4.53 ms packing, 3.29 ms JSON, 19.24 ms compression and
0.89 ms hashing. But elapsed time observed by the simulation worker for an encode
averaged **293.80 ms**, p95 402.76 ms. This includes queueing and handling the
encoder response after synchronous simulation work; it must not be reported as
294 ms of compression CPU. One publication capture was skipped at the bounded
queue; no client resync occurred.

This scheduling coupling is an independently useful improvement target even
when a faster CPU can keep simulation near real time. It also explains why
smooth renderer FPS does not guarantee responsive online movement.

## Compact network format probe

An offline alternating probe continued the same restored match for 70
publications, with 10 warmup and 60 measured pairs. It compared current server
encoding with compact formation-slot and trader options already used locally.
**Every decoded complete snapshot was deeply equal.**

| Per-publication mean | Current server format | Compact options |
| --- | ---: | ---: |
| Compressed packet bytes | 59,895 | 46,265 |
| Encoding | 13.40 ms | 9.56 ms |
| Decoding | 7.53 ms | 5.46 ms |
| Canonical application | 6.98 ms | 6.21 ms |
| Snapshot extraction/packing | 2.12 ms | 2.56 ms |
| Presentation projection | 4.72 ms | 5.03 ms |
| Presentation snapshot decode | 9.55 ms | 9.33 ms |

Compressed traffic fell 22.8%, encoding 28.6%, decoding 27.5%. Not all phases
improved. This is an offline format opportunity, not an implemented server
change or a socket-capacity result. Actual online runs used about 236–322 KiB/sec
per client. The representation should be qualified through joins, recovery,
schema compatibility and real browser clients before enabling it online.

In ordinary PC socket runs, presentation snapshot decoding/transfer alone
averaged roughly 13 ms per publication, p95 about 17 ms, before renderer/HUD work.
That can interfere with a 16.7 ms frame budget even while worker-side network
decoding is fast. A healthy average FPS can still conceal publication-time hitches.

## Scheduling probe and recommendations

A fixture-only scheduling experiment yielded to Node's event loop between
canonical ticks in a catch-up batch, without changing simulation timestep or
authoritative mechanics. In the ordinary-order PC run, observed encode wall time
fell from approximately 121 ms to 89 ms and delivery gap p95 from 341 ms to
308 ms. However progress fell from 0.989x to 0.943x and execution receipt mean
increased from 213 to 265 ms. This unpaired diagnostic supports investigating
dispatch coupling, **not shipping a bare yield as a proven fix**.

Recommended order of work:

1. Give publication completion and input handling a bounded service delay that
   does not grow with a four-tick catch-up batch. Preserve canonical tick order
   and snapshot cursor correctness; do not introduce concurrent state mutation.
2. Qualify and adopt compact network representation where exact state is retained.
3. Reduce presentation reconstruction/allocation at update arrival and measure
   actual browser frame hitches, not just average FPS.
4. Profile group-order admission/replacement and planning fairness with realistic
   nearby cohorts; distinguish first committed movement from full-command completion.
5. Continue simulation optimization or an explicit timestep migration: current
   deployed ARM simulation cannot sustain this fixture at 20 Hz. Network changes
   cannot make 70 ms of work fit a 50 ms simulation interval.

A jitter buffer could smooth network irregularity at added visual latency. It
should be considered after controlling server delivery delay, not used to hide
ongoing simulation debt. A fresh real browser capture of a late-game player
match is still required to establish how much each mechanism contributes there.

## Evidence and reproducibility

Raw JSON, client samples, temporary worker generation and harnesses are in
`out/multiplayer-pipeline-20261014/`. `summary.json` combines all runs.
`prepare.mjs` generates worker adapters from the current source; use `--yield`
only for the explicitly labeled scheduling probe. Restore is never bypassed.
`run.ts` arguments: label, client count, idle/active, emulated RTT milliseconds,
measurement milliseconds, selected unit count, order interval milliseconds.

The ARM harness's temporary source copies are generated against the deployed
image inside its own mounted output directory. The production files, database,
deployment and cloud hardware configuration were not changed. No paid instance
was started. Existing local optimization edits were preserved. No full test-suite
rerun was needed for profiling-only artifacts; runtime runs completed without
client errors, the format comparison checked deep state equality at every pair,
and the scheduling probe is explicitly experimental.
