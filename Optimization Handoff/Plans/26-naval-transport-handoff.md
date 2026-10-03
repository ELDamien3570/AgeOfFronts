# P26: Complete escorted naval transport and beachheads

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P09, P16, P24, P25. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiNavalPlanner.ts`
- `src/skirmish/domain/ShoreTransport.ts`
- `src/skirmish/domain/Armies.ts`
- `src/skirmish/domain/AiAssetLeases.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

Full strategic cargo selection, escort assembly, actual capacity, boarding, landing and beachhead handoff are still open. Basic automatic shore transport and port-defense facts must be reused rather than duplicated.

## Implementation slices

1. Prepare a mission with legal intended sea, actual researched transport capacity, eligible unleased cargo, sufficient escort, departure/landing routes, safe timing and recovery alternatives. Reserve only unpaid commitments.
2. Execute rendezvous, transactional boarding, escorted sail and legal landing through P09. Revalidate threats, capacity, cargo identity and footprint at each boundary; wait or return safely when blocked.
3. Transfer landed squads exactly once to a researched land Army/beachhead objective, release transport-only leases, and preserve surviving ships/cargo if the target collapses. Link actual losses/value to naval evidence.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Multiple transports and partial physical boarding cannot overbook or duplicate squads; actual capacities differ by researched hull.
- Sink/capture/cancel/refit/repair/hostile landing/blocked shore cases conserve troops, resources and ownership.
- Successful landing produces a real supported land objective; failed landing reaches recovery without immortal mission state or stranded hidden cargo.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Stop admitting new strategic transports while existing loaded ships finish a safe return/landing. Never delete cargo or teleport units when disabling the feature.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Final implementation pass - 3 October 2026

Strategic transport selects real researched capacity and cargo, retains mobile reserves, acquires escorts, executes normal boarding/sail/unload, returns surviving cargo when conditions collapse, and hands the physical beachhead off once. P25 bombardment acceptance remains deferred.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
