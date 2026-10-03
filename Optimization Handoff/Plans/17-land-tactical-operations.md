# P17: Complete flank, breach, escort and recovery

Status: **deferred to the next update by the user; no implementation in the current nightly batch**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P16, P15, P09. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/Armies.ts`
- `src/skirmish/domain/AiMilitaryDirector.ts`
- `src/skirmish/domain/AiOperations.ts`
- `src/skirmish/TacticalRoutes.ts`
- `src/skirmish/domain/StructureTargeting.ts`
- `src/skirmish/domain/Battle.ts`

## Current boundary

Base Army tactics exist, but supported pushes, meaningful flanks, breach/siege coordination, escort and recovery were explicitly left incomplete by the supplied progress record and this handoff.

## Implementation slices

1. Use stable operation objectives to choose one supported push and a bounded reachable flank, not independent global nearest-enemy orders for every squad. Require role readiness, reserves and rendezvous before commitment.
2. Plan wall/tower breach with researched siege and escort; handle protected structure approaches through bounded route/clearance services. Cover ranged/anti-air/artillery support and mounted mobility without resetting real cooldowns or bypassing weapons.
3. Implement retreat/regroup/replenish/refit/rejoin and explicit operation completion/abandonment. Integrate landed cargo handoff from naval missions and react locally to damage/invasion even during cooldown.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Seeded terrain fixtures show a genuine reachable flank or an explicit no-flank fallback, with no unsupported sacrifice through an intact wall.
- Escorts remain with vulnerable siege/support/landing units; retreat preserves troop/cost accounting and does not seize manually controlled assets.
- Army replacement, losses, moving targets, walls/gates, treaty changes, controller transfer and restore retain deterministic work/ownership and eventual progress.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Disable only the new tactical objective policy and return to a safe held/recovering operation. Do not cancel paid refit/recruit/transport obligations or change human combat rules.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
