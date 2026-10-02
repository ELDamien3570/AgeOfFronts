# P24: Finish persistent fleet recovery and completion

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P23, P09. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiNavalPlanner.ts`
- `src/skirmish/domain/AiAssetLeases.ts`
- `src/skirmish/ShipMovementAdmission.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

Individual ships already preserve repair/boarding/refit ownership and can rejoin an existing mission. Full persistent recovery/complete mission lifecycle and release of all associated obligations remain incomplete.

## Implementation slices

1. Define explicit reasons/transitions for assessed, funded, assembled, staged, executing, recovering, completed and aborted missions. Separate per-ship repair subtasks from the mission owner; preserve stable anchor/roster where safe.
2. Complete or cancel unpaid funding/route work on terminal outcomes, but honor paid recruitment, cargo, repair and refit lifecycles. Allow useful repaired survivors to recover/rejoin instead of permanent abandoned leases.
3. Record terminal evidence and bounded mission history before choosing another objective. Do not create a new mission ID solely to reset failure limits.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Losses, dock contention, no legal dock, exhausted supplies, port capture, changed treaty, takeover and restore all reach a defined safe state.
- No ship has competing movement owners, no paid job is refunded twice and no recovery route is overwritten by ordinary patrol AI.
- Completed/aborted missions release stale members and retained IDs without deleting ships/cargo or erasing theater evidence.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Fall back to ordinary per-ship repair/patrol after explicit lease release. Preserve terminal evidence and paid lifecycle obligations across the rollback.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
