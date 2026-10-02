# P18: Make all eleven AI doctrines operational

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P16, P17, P19, P23. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/content/AiPersonalities.ts`
- `src/skirmish/domain/AiPersonality.ts`
- `src/skirmish/domain/AiMilitaryDirector.ts`
- `src/skirmish/domain/AiEconomicPlanner.ts`
- `src/skirmish/domain/AiNavalPlanner.ts`
- `src/skirmish/domain/AiOperations.ts`

## Current boundary

All eleven profiles and their numeric preferences already exist. Those preferences are not evidence that each requested operational doctrine is complete.

## Implementation slices

1. Write an explicit behavior contract for balanced, conqueror, warden, builder, merchant, scholar, rider, skirmisher, engineer, admiral and diplomat. Map each to readiness, reserve, timing, target/formation, economy, research, naval and alliance choices supported by current mechanics.
2. Integrate doctrines through shared scored choices/constraints, not duplicated controllers or hidden bonuses. Use stable tie-breaking and bounded preparation; preserve the ordinary command/payment authority.
3. Add scenario-based evidence that the profiles differ meaningfully while still adapting to unavailable terrain/resources/roles. Do not hard-code a doctrine that strands a landlocked admiral or an economically blocked scholar.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- One small deterministic fixture per profile demonstrates its intended decision and a viable constrained fallback.
- All eleven use the same legality, resource conservation, research, lease, path and recovery rules.
- Outcome comparisons report qualitative differences and failures; do not equate winning one seed with global balance or capacity acceptance.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert new policy weights/branches by profile while retaining the baseline preference table. Persisted operation state must safely finish or recover after a profile change.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
