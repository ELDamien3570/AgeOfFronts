# P19: Complete dependency, bottleneck and utility decisions

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P04, P11. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiProductionDependencies.ts`
- `src/skirmish/domain/AiEconomicPlanner.ts`
- `src/skirmish/domain/AiEconomicDirector.ts`
- `src/skirmish/domain/AiEconomicSnapshot.ts`
- `src/skirmish/domain/AiMilitaryDemand.ts`
- `src/skirmish/domain/Supply.ts`

## Current boundary

An opt-in economic coordinator, typed inventories, shared demand, paid upgrades, upstream military dependencies, older-unit fallbacks and unknown-on-exhausted exploration already exist. Richer branch utility, bottlenecks and viability diagnostics remain open.

## Implementation slices

1. Model candidate utility using actual production chains, missing recipes/workshops/research, current/incoming/protected stock, renewable inputs, capacity and time to useful output. Avoid double-counting incoming items or demand.
2. Select bottleneck investments which make a real objective viable; distinguish missing research, unreachable resource, exhausted search, market absence, capacity and unaffordability with finite reason codes.
3. Resume expensive dependency/candidate preparation under fair budgets. Share results with land/naval/defense demand and preserve emergency preemption, saving expiry and older viable fallbacks.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Multi-step refining/equipment chains through absent workshops choose the right upstream task and aggregate shared inputs once.
- Unknown/limited exploration is not impossible; no candidate spends protected stock or counts a paid queued unit twice.
- Tests cover depletion, capture, upgrade, cancellation, competing objectives, fallbacks and restored saving plans with exact cost/inventory conservation.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep aiEconomy disabled until accepted. Revert individual utility branches while retaining ordinary production/payment and releasing only unpaid stale reservations.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Final implementation pass - 3 October 2026

Dependency DAG quotes aggregate shared inputs once, separate paid incoming and protected stock, retain finite bottleneck reasons and time to output, and resume demand preparation with persisted bounded work.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
