# P20: Select useful research and age advances

Status: **implemented locally; full-run plus focused-repair validation recorded**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Current implementation - 3 October 2026

Research utility now uses role deficits, attainable production inputs, resources, logistics and actual sea opportunity. Age advancement requires a usable paid production path. Unpaid saved goals remain stable but expire or invalidate when legality/use changes; progression owns every paid research/age transition.

The user resumed this plan and requested one combined test run with the remaining tuneups and lobby fixes. See [combined batch evidence](../Evidence/remaining-five-combined-validation.md) for results and qualification limits.

## Dependencies and ownership

Depends on: P19, P27. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/Expansion.ts`
- `src/skirmish/domain/Progression.ts`
- `src/skirmish/domain/AiEconomicPlanner.ts`
- `src/skirmish/content/Technology.ts`
- `src/skirmish/content/StartingEconomy.ts`

## Current boundary

Starting grants are complete: all prior ages plus first node of each current-age branch, including tribes. Actual opening purchasing power is tested. Remaining work is useful AI research/age choice tied to viable objectives, not changing that user decision.

## Implementation slices

1. Score current legal research by actual bottlenecks, field roles, logistics, defense/sea opportunity and time-to-benefit. Include research/advance cost and opportunity cost in the shared ledger.
2. Advance only when the existing two-current-branches prerequisite and paid timing rules permit it and the new tier has a viable production/use path. Preserve age-locked tribes and their legal same-age research.
3. Persist a bounded research objective long enough to avoid churn; invalidate on material losses, unavailable inputs or changed theater, not every unit movement.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Seven-age starting/restore regressions retain exact grants; no later same-age technology becomes free.
- Research choice resolves real chain or tactical bottlenecks, and missing input/capability produces an explicit fallback.
- Tribes cannot advance or research other ages; multiple AI objectives cannot spend the same reserve or reset paid research.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert the utility scorer to the existing legal ordering, never the authoritative progression rules or the confirmed initial-grant policy.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
