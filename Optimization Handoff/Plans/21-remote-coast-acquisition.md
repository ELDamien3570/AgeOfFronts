# P21: Plan reachable remote coast acquisition

Status: **deferred to the next update by the user; no implementation in the current nightly batch**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P08, P19, P27. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiPlacementCandidates.ts`
- `src/skirmish/domain/AiEconomicPlanner.ts`
- `src/skirmish/domain/AiOperations.ts`
- `src/skirmish/domain/CoastalTerritory.ts`
- `src/skirmish/CoastIndex.ts`

## Current boundary

Owned coastal candidates can already lie beyond the nearest 256 camp tiles. The remaining requirement is reaching/acquiring a useful remote coast, not just purchasing a port on already-owned land.

## Implementation slices

1. Identify a bounded shortlist of reachable coastal regions that unlock viable trade/transport/defense value. Use real land/sea connectivity and resource/market availability rather than base distance alone.
2. Create a land/transport acquisition objective with force, route, ownership and funding dependencies. Neutral expansion and foreign entry must follow optional operations footprint/declaration rules.
3. Commit port construction only after actual ownership and ordinary placement/research requirements are satisfied. Cancel stale unpaid plans when access/theater value changes.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Landlocked start, remote friendly corridor, disconnected island and foreign coast fixtures choose reachable or explicitly unavailable objectives.
- An apparent near coast across impassable terrain is rejected; acquired coast is genuinely useful to the selected connected sea.
- Restore, treaty change, captured landing area and insufficient funding never cause free ownership, teleportation or duplicate port purchases.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Stop pending acquisitions and return assigned forces through ordinary recovery; preserve captured legal territory and already-paid structures.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
