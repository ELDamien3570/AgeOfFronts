# P28: Qualify deterministic integrated outcomes

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P01, P02, P05, P06, P07, P08, P09, P10, P11, P12, P13, P15, P16, P17, P18, P19, P20, P21, P22, P23, P24, P25, P26, P27. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `tests/skirmish`
- `src/skirmish/Simulation.ts`
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts`
- `docs/V1ImplementationProgress.md`

## Current boundary

Current 1012-test checkpoint covers completed slices. It is not integrated acceptance for the unimplemented plans or the largest-world target.

## Implementation slices

1. Create bounded legitimate local scenarios with explicit map/version, seed, starting age, faction/tribe/human-seat counts, units/buildings/ships/traders/walls/projectiles, feature flags and intended duration. Compare cold/warm/restored execution where equivalence is promised.
2. Combine actual combat, captures, production, trade, defense, armies, navy, alliance/control changes and joins incrementally. Check exact conservation and terminal command outcomes, as well as per-caller work and queue age.
3. Record seeded behavioral outcomes for intentional new policy separately from optimization-equivalence hashes. Remove no failing assertion merely because a newer AI behaves differently; state the intended acceptance before changing a golden result.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Every completed task passes its focused tests plus full skirmish/type/build/whitespace/scoped lint gates at the exact candidate commit.
- Mid-phase restore, cancellation, takeover and death/capture produce no partial payments, duplicate cargo, stale lease or resurrected old intent.
- Finite retained state and eventual planner progress hold across the intended ordinary-play lifecycle; any unresolved failure blocks enabling the corresponding feature.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep the last proven feature combination and disable newly failing experimental flags. Preserve raw evidence and explicit failing configuration instead of claiming a smaller run proves the requested tier.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
