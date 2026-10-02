# P16: Create researched coordinated AI Armies

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P06, P11. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiMilitaryDirector.ts`
- `src/skirmish/domain/Armies.ts`
- `src/skirmish/content/Armies.ts`
- `src/skirmish/domain/AiOperations.ts`
- `src/skirmish/domain/AiAssetLeases.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

AiMilitaryDirector currently coordinates paid modernization, not the requested full land-Army strategy. Ordinary AI still issues cohorts/raids. Optional operations provide one prepared offensive target and defensive memory, but readiness currently relies mainly on healthy squad count/personality.

## Implementation slices

1. Create persistent Army objectives only when the faction has the actual Armies research/capacity. Select reachable members through shared force facts and atomic movement leases, preserving mobile reserve and other paid commitments.
2. Prepare a supported force objective with roles, readiness, staging, logistics and target region. Feed shortfalls into existing demand/reservations rather than making free units or repeatedly changing research/refits.
3. Use the transactional Army admission interface and optional operations declaration/territory rules. Persist rally/assemble/advance/engage/recover states, explicit outcomes and minimum commitment lifetimes.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- No unresearched or over-capacity Army creation; selected members cannot be leased to defense/navy/manual control simultaneously.
- A supported Army stages and advances through real formation/path commands; unavailable members and losses produce orderly recovery.
- Checkpoint every state; identical commands/seeds yield identical membership, routes and payments. Trial operation flags off preserve default behavior.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Release only unpaid Army commitments and movement leases. Existing armies/physical orders and paid refits remain legal; keep aiEconomy/deferredPlanning gates unchanged until qualified.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
