# P09: Complete boarding and landing admission

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P07, P08, P11. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/ShoreTransport.ts`
- `src/skirmish/ShipMovementAdmission.ts`
- `src/skirmish/MovementAdmission.ts`
- `src/skirmish/Simulation.ts`
- `src/skirmish/domain/Armies.ts`

## Current boundary

Replacement sails preserve old voyages, but full transactional boarding/landing selection, capacity reservations and footprint setup are not complete. Naval strategy must use the same authority.

## Implementation slices

1. Add persisted admissions for selecting ships/cargo, rendezvous, capacity, shoreline slots and final live connectors. Protect one movement owner and reserve capacity without creating troops or charging hypothetical purchases.
2. Keep existing voyages/orders until a whole accepted landing/boarding cohort is legal; define safe explicit partial physical lifecycle only where loading genuinely completes one unit at a time.
3. Fence sunk/captured ships, cancelled orders, changed cargo, occupied landing footprints, controller transfer and optional war-policy shore permissions. Landed units hand back to land control exactly once.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Capacity uses actual researched vessel capacity and current cargo, with no overbooking across simultaneous requests.
- Death/sinking/restore/cancel/late success never duplicates or strands an embarked squad and preserves troop conservation.
- Queued voyages and input receipts survive boarding/landing phases; human manual movement/attack/capture rules are unchanged.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Cancel only unpaid/uncommitted admission work. Retain actual embarked cargo and repair/boarding ownership, then finish or safely return it through normal commands.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
