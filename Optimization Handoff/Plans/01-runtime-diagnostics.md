# P01: Complete production-path diagnostics

Status: **production observers implemented; local automated gate passed;
external qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: None beyond the handed-off baseline. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/RuntimeDiagnostics.ts`
- `src/skirmish/Simulation.ts`
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts`
- `src/skirmish/multiplayer/infrastructure/snapshotEncoderThread.ts`
- `src/skirmish/multiplayer/application/LiveMatch.ts`
- `src/skirmish/client/OnlineMatchSession.ts`

## Starting boundary

Fixed timing windows, worker memory/count reports and liveness versus match progress already exist. Encoding is off-thread and publication backlog is capped. GC, scheduler lateness, detailed codec/transport stages and end-to-end browser measurements are incomplete.

## Local continuation, 2 October 2026

Implemented on `codex/optimization-runtime-diagnostics`, from published source
`357fa7d5f8a8b2c54b55812f860b4918591693a3`:

- Finite rolling observations for validation/admission, scheduler debt, snapshot
  extraction/packing/buffer assembly, JSON, gzip, hash, base64, worker transfer,
  coordinator fan-out and socket enqueue. The normal, standalone baseline,
  client-recovery and join-barrier paths use the production observers.
- Separate active simulated/wall time accounting; synchronization resets its
  observation anchor. Timing never chooses domain work or enters checkpoints.
- Per-faction/per-caller exact-planner work, pending age and terminal outcome
  counts. At most 256 faction keys times eight finite caller classes are retained;
  active queries inspect the existing at-most-128-job queue. This observes
  fairness; it does not implement P11 fair shares or long-search escalation.
- Maintained crossing-tree byte counts and bounded start-cache/route residency
  observations. These report typed-array storage, not total V8 object overhead.
- Worker-local GC durations and explicit executor/encoder close, error, timeout
  and exit categories. Existing watchdogs and gameplay behavior are preserved.
- Client decode/apply/projection/presentation/recovery/queue observations, shared
  HUD and render CPU measurements, and animation-frame intervals. Missing stage
  samples remain absent. Coordinator and active online-browser summaries are
  structured and limited to one per 30 seconds.
- Match/runtime/source/thread/capture identity in worker observations, with the
  encoded tick explicitly reported. A worker capture sequence includes standalone
  baselines; it is distinct from the coordinator's public publication sequence.
  Coordinator and client summaries report that actual publication sequence.

All timing values use milliseconds; the simulated/wall ratio is dimensionless.
Nested stages overlap and must not be added as independent serial costs. Socket
timing measures enqueue CPU time, not acknowledged delivery or network latency.
GC/heap/external/ArrayBuffer readings belong to their worker; RSS belongs to the
shared Node process. `retainedBytes` describes histogram sample buffers, not
whole-consumer memory. Sample windows contain at most 256 observations per stage.

Focused tests exercise the real reserved simulation and encoding workers,
deterministic observed/unobserved commands, restored checkpoints, failed/disabled
observers, bounded storage, cohort cancellation, coordinator scheduling, and the
client-session contract. Client-session tests use a decoder double. Real-browser
playback, target ARM hardware, mature-world memory peaks, forced native worker
timeouts/restarts and target-capacity qualification remain unverified. No
experimental feature default or public health response was expanded.

Local Windows x64 / Node 24.18.0 evidence: **1018 tests across 156 files** passed
with `node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts
--maxWorkers=1`; TypeScript and the skirmish production build passed. Scoped
Oxlint and ESLint passed on the edited slice, excluding the known untouched
Simulation `tile` diagnostic at line 932. Whitespace checks passed. The initial
four-worker baseline had four five-second timeouts; those original tests passed
unchanged in a one-worker rerun. Assertion strength and test timeouts were kept.
The known Vite large-chunk warning remains.

## Implementation slices

1. Add bounded observations for command validation/admission, scheduler lateness, simulated/wall-clock ratio, snapshot extraction/packing/JSON/compression/hash/transfer and coordinator/socket fan-out. Correlate match/source/runtime/tick/publication sequence without exposing private per-match diagnostics through public health.
2. Instrument planner oldest age, work/outcomes by caller and faction, hierarchy/cache residency and limited/superseded outcomes. Add client decode/apply/projection/HUD/frame/recovery/queue-byte measures. Keep one bounded histogram per finite stage and periodic structured summaries, not per-entity log streams.
3. Include GC duration and worker exit/timeout/restart cause where the runtime supports it. Document which memory numbers are worker-local versus process RSS; use no wall-clock decision logic.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Run identical seeded commands with instrumentation enabled/disabled and compare checkpoints.
- Force missing samples, invalid times, paused joins, stalled workers and encoding failure; verify bounded retained sample counts and correct status categories.
- Exercise the real production worker/client path and show stage totals and correlation identifiers; do not substitute the old host/verifier path.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Remove or disable new observers without changing simulation state or protocol semantics. Preserve existing aggregate health behavior and finite diagnostic windows.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
