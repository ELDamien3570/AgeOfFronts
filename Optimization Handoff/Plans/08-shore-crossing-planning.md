# P08: Resume shared shore and crossing searches

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P11, P04. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/ShoreRoutes.ts`
- `src/skirmish/domain/ShoreTransport.ts`
- `src/skirmish/CoastIndex.ts`
- `src/skirmish/content/ShoreTransport.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

Coast geometry is indexed, but ranked departure/arrival endpoints and land/water searches can still execute synchronously. Sharing crossing rankings and inside-candidate work remains open.

## Implementation slices

1. Create a bounded shared crossing query keyed by immutable coast/terrain version, endpoints/regions, transport class and relevant dynamic permissions. Rank a resumable shortlist with stable ties and retained lower bounds.
2. Budget endpoint discovery, coast pairing, land approach, water corridor, landing approach, path copying and cleanup independently. Reuse only safe shared subresults; never cache mutable ownership permissions as static coast geometry.
3. Connect ordinary automatic transport and Army/trade callers through explicit pending/complete/unreachable/limited states. Do not call synchronous paths.find merely because an earlier stage was queued.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Many islands, inland sources, disconnected seas, captured ports, forest/wall changes and allied shore access produce correct legal routes.
- Repeated nearby requests demonstrate shared ranking reuse and fair bounded work without coupling their cancellation.
- Checkpoint at each endpoint/search/copy phase, then complete or reject identically; memory exhaustion stays unknown/limited rather than false unreachable.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Preserve completed voyages and cargo. Roll back new pending crossing work with explicit requeue/cancel rules; never teleport squads to resolve a stale plan.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Final implementation pass - 3 October 2026

Shared crossing graphs, stable edge ranking, exact approach/arrival/water searches, subscriber cancellation and connected-land travel-time comparisons persist and yield.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
