# P06: Make Army routes transactional and resumable

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P07, P11. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/Armies.ts`
- `src/skirmish/domain/RouteTask.ts`
- `src/skirmish/RoutePlanner.ts`
- `src/skirmish/Simulation.ts`
- `src/skirmish/CommandApplications.ts`

## Current boundary

Ordinary land replacements are transactional. ArmyRouteRequest/RouteWork limit job count, but Army leader routes, member connectors/deployment and synchronous paths.find work remain incomplete bounded admission.

## Implementation slices

1. Introduce an Army admission record containing owner generation, Army/member/order revisions, target/formation, staged routes and per-member outcomes. Keep old orders running until the whole replacement is valid.
2. Move leader corridor, slots, connectors, flanking/rear deployment and path materialization into resumable planner phases. Share the normal scheduler/workspace; no private unbounded fallback after a limited result.
3. Commit the accepted cohort atomically with original input receipts. Fence stale membership, death, takeover, target movement, terrain/wall changes and Shift replacement; preserve later queued legs.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Old orders continue while admission is pending; no partial formation activation or costs on failed replacement.
- Restore at every phase then replay the same commands to an identical checkpoint and terminal receipt.
- Exercise split/disband/member removal, overlapping manual replacements, Shift subsets, narrow passages and exhausted shared workspace; both work bounds and eventual progress must pass.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep deferredPlanning off in production. If a migration fails, cancel only unpublished admissions with explicit outcomes; preserve already committed physical orders and paid work.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
