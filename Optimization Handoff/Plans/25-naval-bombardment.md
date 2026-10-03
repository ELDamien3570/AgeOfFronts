# P25: Add supported coastal bombardment

Status: **deferred to the next update by the user; no implementation in the current nightly batch**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P24, P05, P27. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiNavalPlanner.ts`
- `src/skirmish/domain/StructureTargeting.ts`
- `src/skirmish/domain/Battle.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

The navy controller currently focuses on port defense/concentration. Strategic coastal bombardment and its escort/readiness/withdrawal behavior are not implemented in this checkpoint.

## Implementation slices

1. Select legal reachable coastal targets in the declared/defensive theater using actual naval weapon targets, range, firing geometry and structure value. Reuse local spatial facts and bounded candidate/LOS planning.
2. Stage a supported bombardment group with escort and repair/withdrawal criteria. Respect sea component, coast access, neutral/allied territory and optional operation declarations without modifying physical damage rules.
3. Finish or replan when the target is destroyed/captured, access changes or losses outweigh value. Feed real outcomes back into persistent naval evidence.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Ships fire only with real range/LOS/target eligibility; scenery or visual range does not permit illegal shots.
- Escort/recovery ownership survives target destruction, boarding, repair, treaty changes and save/restore.
- No repeated doomed bombardment drains the treasury; construction/structure and ship casualties reconcile exactly.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Disable new bombardment objectives and recover fleets through existing mission states. Leave real projectiles, damage and paid ships under ordinary simulation authority.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
