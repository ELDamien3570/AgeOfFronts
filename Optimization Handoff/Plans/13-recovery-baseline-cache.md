# P13: Cache coherent recovery and join baselines

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P12, P02. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/multiplayer/application/LiveMatch.ts`
- `src/skirmish/multiplayer/application/ClientStateFlow.ts`
- `src/skirmish/multiplayer/application/PublicationQueue.ts`
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts`
- `src/skirmish/client/OnlineMatchSession.ts`

## Current boundary

Bounded two-slot server encoding, ordered publication and flushed join/recovery/terminal barriers are complete. Safe reuse of baselines at the same canonical version still needs measurement and explicit cache ownership.

## Implementation slices

1. Key a finite baseline cache by exact canonical capture/version/sequence and protocol shape, not merely wall-clock proximity or current tick labels. Share immutable bytes only while the corresponding base remains valid.
2. Fence superseded client epochs, reconnecting guests and late encoder results. Keep join and client-application deadlines separate from executor watchdogs.
3. Measure coordinator fan-out, serialized messages and cache retention. Do not introduce a second canonical owner or pause the whole match for one slow client.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Simultaneous ordinary joins reuse eligible baseline work, while changed states/epochs do not.
- Delayed baseline completion cannot rewind a newer canonical state; skipped deltas force required recovery.
- Closing clients/workers clears cache references and finite backlogs; normal clients progress despite an ordinary slow renderer.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Disable caching and return to fresh coherent baselines while retaining barrier semantics. Never replay a baseline from a mismatched capture/epoch to save CPU.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
