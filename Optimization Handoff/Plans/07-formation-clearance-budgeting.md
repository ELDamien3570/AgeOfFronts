# P07: Resume formation setup and clearance

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P11. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/FormationPlanning.ts`
- `src/skirmish/Formations.ts`
- `src/skirmish/MovementAdmission.ts`
- `src/skirmish/SquadGeometry.ts`
- `src/skirmish/domain/Armies.ts`

## Current boundary

Formation fallback slot enumeration is resumable and sparse. Setup, occupancy/reservation preparation, clearance rays, downstream connectors and copies still need complete inside-work budgeting.

## Implementation slices

1. Define deterministic work units for every setup/slot/candidate/clearance/LOS/copy/cleanup phase. Store cursors and preserve original tie order and exact destination normalization.
2. Use stage-valid occupancy facts and reusable sparse slot reservations. Yield inside expensive swept-radius/clearance work instead of charging only after a large function returns.
3. Expose the same resumable formation service to ordinary moves, Armies, shore landing and transport. Keep atomic selected-cohort semantics and revalidate the short live connector before commitment.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Large/coincident selections and crowded/blocked footprints respect per-step budgets including setup and rejected candidates.
- Reference and resumable planners choose identical slots where equivalence is promised.
- Cold/warm/restore/cancel/replacement tests prove no orphan reservations or quadratic duplicate setup, and no geometry clipping through walls.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Retain the existing formation implementation as a test reference. Do not switch production until all calling paths use the new lifecycle coherently.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
