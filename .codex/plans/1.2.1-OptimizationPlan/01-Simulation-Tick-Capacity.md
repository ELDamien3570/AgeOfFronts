# 01 — Predictable simulation capacity and release qualification

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

- `src/skirmish/Simulation.ts:2654` (`performTick`) executes phases sequentially; command application adds work outside that phase total.
- `src/skirmish/multiplayer/application/LiveMatch.ts:683` limits catch-up and resets its deadline when too far behind. This prevents unbounded catch-up, but must not hide lost real-time pace.
- `Optimization Handoff/2026-10-04-1.2-remaining-passes.md` records dense ARM sampled tick p95 52.76 ms versus the 50 ms tick interval; routing p95 20.28 ms. These historical numbers are neither a fresh baseline nor a target-capacity pass.
- The same report's hour soak used Old World 1000, two clients, ten AIs and 25 tribes. Input injection ceased for the two factions at approximately minutes 10 and 37. Tribe merchant participation and research fixes changed the workload afterward.

## End-state architecture

Keep one authoritative owner of mutable match state and a fixed 20 Hz rules clock. Each phase has an explicit input epoch, output effects, deterministic work accounting and a bounded retained-memory contract. Fixed-cost authoritative work runs every tick; expensive planning continues across ticks with observable service guarantees. Presentation cadence never controls simulation progress. Wall-clock profiling diagnoses budget failures but must not arbitrarily decide different gameplay results on different machines.

Maintain separate budgets for command preparation, search, cleanup, AI decisions, canonical simulation and publication capture. Budget every nested expensive primitive, rather than counting only top-level jobs. Do not charge the same shared work twice or let a command multiply its budget by selecting more units. Counts and limits belong to one versioned configuration with units and tests.

Start with algorithmic/index improvements in plans 02–06. Parallel execution is conditional: only profile-proven pure work on compact immutable inputs can leave the authority thread. Results need tick/revision tags, deterministic application order, stale-result rejection and bounded outstanding work. Two cores are already shared by simulation, encoder and coordinator; adding workers can make contention worse. Do not introduce shared mutable world state, an ECS rewrite or a native module without a measured need.

## Phases

1. **Establish trustworthy accounting.** Extend `RuntimeDiagnostics.ts`, simulation worker and coordinator telemetry to capture command application, phase times, capture/extraction, transfer, encoder service, scheduler delay, simulation-tick/wall-time ratio and pauses separately. Maintain rolling distributions and maxima; a last-256-sample p95 is not a whole-run percentile. Bound telemetry buffers and avoid per-entity logging. Count every admitted/completed/rejected/superseded command and identify its caller without logging authentication tokens.
2. **Define the budget ledger.** Inventory nested loops and their worst-case input sizes. Assign deterministic quanta and finite memory caps; distinguish mandatory correctness work from deferrable planning. Existing command/route caps remain safeguards, not substitutes for accounting. Unit-test exact budget boundaries and cleanup costs.
3. **Integrate the seven plans.** Land shared mutation/phase contracts from plan 07 first, then command preparation (02) and route churn (03). Plan 04 uses those contracts. Trade indexes (06) can proceed once lifecycle contracts exist; plan 05 consumes all entity journals. Complete this plan's capacity qualification last. Parallel development requires disjoint ownership; coordinate changes in Simulation.ts and Expansion.ts.
4. **Profile the combined candidate.** Compare identical checkpoints, seeds, command streams and options. Report gameplay divergence separately from algorithmic speedup. Include stable population phases and late-game growth. Where improvements remain insufficient, rank actual samples and prototype a single pure off-thread task; retain only a net win including copies, contention and tail latency.
5. **Qualify release.** Use the matrix and hard failure rules below. Publish a release evidence record with explicit pass/fail/not-run for every gate. Deployment is a separate owner-approved action.

## Proposed release gates

These are engineering acceptance targets, not measured promises. Record any owner-approved revision before testing; never revise them afterward to turn a failure green.

- At 1x, steady-state tick p95 <=35 ms and p99 <=45 ms on the target ARM machine, with >=99% of intended unpaused ticks completed per wall-clock minute and no accumulating debt. Report maximum and >50 ms/>100 ms counts. Approved join pauses are measured separately with duration and cause.
- Scheduler, command and publication queues have fixed byte/count/age envelopes and no sustained growth. Healthy peers cannot be disconnected merely because another peer stalls.
- Human server receipt p95 <=250 ms; ordinary reachable land commands first authoritative displacement p95 <=500 ms, p99 <=1 s after server receipt. Report queue/preparation/search/application portions. Physically blocked, Hold, combat and mandatory transport commands have separate outcomes, not false failures or exclusions without accounting.
- Cold mandatory transport planning produces movement or a specific terminal rejection within a proposed 5 s p99, with pending feedback promptly. Travel and landing completion depend on distance and congestion and are measured separately.
- Canonical publication age p95 <=300 ms, p99 <=500 ms at the existing 5 Hz target under the declared network profile. Snapshot encoder service p95 <=100 ms and p99 <200 ms is a supporting budget, not an end-to-end guarantee.
- No unexplained canonical mismatch, lost/duplicated committed effect, uncaught worker error, unbounded retry, stuck admission or monotonically growing retained queue. Heap/external/buffer/RSS envelopes must be declared after baseline measurement and remain below configured process/worker limits with >=25% measured safety headroom.
- Every supported client tier must be specified by actual CPU/GPU/RAM/browser. Proposed minimum tier: 30 FPS with p95 frame <=33.3 ms; target tier: 60 FPS with p95 <=16.7 ms. Report p99 and long tasks too. Do not advertise a minimum tier until selected and measured.

## Qualification matrix and failure policy

Run only in a local or explicitly authorized isolated staging environment, never by generating load against public players. First verify the harness itself, with stop conditions and bounded inputs. This plan is not authorization to deploy or launch tests on Oracle.

Use at least three recorded seeds for an early-to-late 90-minute target-count session, plus a two-hour dense checkpoint continuation and a separate cold-start/late-join session. Include land-heavy and water-heavy maps, dense defenses, active naval transport, all researched production and tribe trade. Capture actual largest-map dimensions and entity counts; an arbitrary label such as “max” is insufficient. Keep all ten human seats meaningfully active throughout through valid scenario drivers, and perform a separate real rendered-client acceptance session. A dead/ineligible driver cannot silently stop input: fail coverage, renew a predefined valid scenario or explicitly record the shorter covered interval. Idle sockets are not active-player certification.

Test clean links and a declared impaired profile (proposed 100 ms RTT and 20 ms jitter), slow rendering, tab background/foreground and allowed reconnect/AI-takeover paths. Observe per-peer lag and recovery without allowing one peer to stall everyone indefinitely. Test pause/resume and terminal match cleanup. Network delivery latency is additional to server processing and must be reported independently.

Qualify 2x/4x separately if intended for online release: 20 simulation ticks per game second needs 40/80 ticks per wall second at those speeds, unless an explicitly documented different speed model is used. A 1x pass cannot support a 4x claim. If the target cannot meet gates after measured improvements, document the bottleneck and ask the owner to decide hardware, supported envelope or further refactor; do not conceal it with automatic throttling.

## Tests, rollback and design review

Extend `RuntimeDiagnostics.test.ts`, `LiveMatch.test.ts`, checkpoint and admission suites. Verify diagnostic overhead disabled/enabled, bounded histograms, scheduler catch-up, legitimate pause exclusion and exact terminal cleanup. Run the full suite after integration, not just accumulated focused passes.

Ship implementation stages behind internal comparison flags where appropriate. Roll back complete compatible client/server builds; never downgrade protocol or checkpoint state in a live match. Retain the preceding release artifact and clearly end incompatible sessions.

Reviewed alternatives and loose ends: a faster language alone does not remove repeated scans; more workers are not free on two cores; average tick time hides spikes; a healthy /health endpoint does not prove a match advances; sparse final samples hide hour-long tails. These risks are covered above. Remaining release decisions are supported online speed, minimum client tier and explicit memory/network budgets after baseline capture.

## Second-pass review amendments

- **Admission latency versus gameplay latency:** record client-send, server-receive, admission, first service, activation and first authoritative movement separately. Report clock synchronization error for cross-machine timings; same-process durations are the primary processing evidence. Every unsuccessful or superseded trial remains in the outcome denominator. Good p95 among successful commands cannot hide a high rejection rate.
- **Aggregate budget:** phase p95 values cannot be added to infer total p95. Measure full advance calls, including command batches and up to four catch-up ticks, alongside individual ticks. Include coordinator event-loop delay and encoder CPU contention.
- **Growth and cleanup:** compare a fixed-roster plateau separately from legitimate entity growth. Fit retained-memory slope over stable-population intervals, then verify return to a bounded idle envelope after match disposal. No demand for flat memory while the world legitimately expands.
- **Network and resource envelope:** record actual upload/download throughput, RTT/jitter, browser throttling, CPU quota, worker limits, OS/runtime and background services. Set byte budgets before the release run from the supported connection tier; fail qualification if this remains unspecified.
- **Reproducibility:** retain immutable baseline/candidate artifacts, seeds, content hashes and raw distributions. Repeat measurements in alternating order without unrelated workloads; a single faster run is insufficient.

## Navigation and implementation checklist

1. [Command preparation](02-End-to-End-Command-Preparation.md)
2. [Pathfinding and intention stability](03-Useful-Pathfinding-and-Intent-Stability.md)
3. [Spatial facts and capture](04-Spatial-Queries-and-Capture.md)
4. [Replication and presentation](05-Incremental-Replication-and-Presentation.md)
5. [Trade growth](06-Trade-and-Entity-Growth.md)
6. [Mutation and release integrity](07-Mutation-Lifecycle-and-Release-Integrity.md)

For each implementation phase: record baseline -> implement one coherent change -> focused/reference tests -> compare cost and behavior -> review failure/rollback path -> mark complete. At final integration run `npm run test:skirmish`, the checkout's TypeScript check (currently `npx tsc --noEmit`), scoped lint and `npm run build:skirmish`; preserve actual output and exit codes. Follow repository dependency installation policy (`npm run inst`, not an unpinned install). Missing assets or environment failures are blockers to fix or disclose, never reasons to delete tests. Complete documentation checks here do not mean these runtime tests have been run for this planning-only change.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
