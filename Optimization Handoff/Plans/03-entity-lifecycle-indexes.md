# P03: Maintain entity and ownership indexes

Status: **building and squad/ship/cargo lifecycle checkpoints implemented locally; remaining consumer migration and broader qualification are open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: None beyond the handed-off baseline. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/BuildingIndex.ts`
- `src/skirmish/CargoIndex.ts`
- `src/skirmish/Simulation.ts`
- `src/skirmish/domain/AiForceInventory.ts`
- `src/skirmish/domain/AiEconomicSnapshot.ts`
- `src/skirmish/domain/Expansion.ts`

## Current boundary

Cargo is grouped once per movement stage and building queries exist, but building indexes are rebuilt each tick and many faction/entity filters still scan arrays. A same-length change cannot safely be detected from array length alone.

## Implementation slices

1. Define authoritative spawn/remove/owner/type/tier/completion/health/embark/landing hooks and explicit immutable versus dynamic revisions. Keep one owner for mutation. Expose read-only by-ID/by-owner/by-type/producer/cargo facts without leaking mutable arrays.
2. Migrate repeated consumers incrementally, retaining independent full-array reference implementations in tests. Cover stack identity and same-count replacement; do not turn caches into a second authoritative model.
3. Rebuild derived facts on restore and provide development consistency checks. Bound tombstones/cursors and reclaim historical IDs after cancellation/death.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Randomized lifecycle sequences compare each index against a full-array reference after every mutation.
- Same-length replacement, capture, tier upgrade, completion, destroyed buildings, embarking and sunk cargo invalidate exact dependent views.
- Cold/warm and restored worlds produce identical authoritative results; prove reduced scans using counters rather than unrepeatable timing claims.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep the full-reference query path behind a development comparison switch until stable. Roll back individual consumers without reverting authoritative state changes.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Local continuation checkpoint

The building lifecycle slice is implemented at `1fe9ede1b8ee9c093032d0257423fb90c4e022ab`.
See [exact source, counters and validation](../Evidence/03-building-lifecycle.md).
At the building-only checkpoint, squad/ship/cargo ownership and the local
full-suite timing gate remained open. The subsequent unit checkpoint below
updates that boundary; this plan still has broader acceptance work. The user approved read-only domain records/collections and explicit
mutation methods, including migration of affected fixtures.

## Unit checkpoint and requested pause

Code checkpoint `a0e2aa1587b29c7101ebade7d85698ea7a45d657` implements squad/ship membership and cargo ownership.
See [source, work counters and validation](../Evidence/03-unit-lifecycle.md).
The final local suite passed 1,034 tests in 158 files, TypeScript and the build;
remaining consumer migration and runtime/browser/ARM qualification remain open.
The user requested a pause after this gate. P11 and P14 stay reserved for the
parallel session; no next dependent implementation has begun.
