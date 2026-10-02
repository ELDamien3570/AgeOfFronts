# P01: Complete production-path diagnostics

Status: **remaining work, not implemented by this handoff**. Read
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

## Current boundary

Fixed timing windows, worker memory/count reports and liveness versus match progress already exist. Encoding is off-thread and publication backlog is capped. GC, scheduler lateness, detailed codec/transport stages and end-to-end browser measurements are incomplete.

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
