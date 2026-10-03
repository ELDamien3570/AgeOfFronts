# P10: Make trade routing resumable and transactional

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P08, P11, P04. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/Trade.ts`
- `src/skirmish/domain/TradeQuote.ts`
- `src/skirmish/domain/RouteTask.ts`
- `src/skirmish/RoutePlanner.ts`
- `src/skirmish/domain/Supply.ts`

## Current boundary

Trade has candidate reuse, bounded exact sea quoting and actor-preserving empty-source switching, but complete loads/candidate preparation/route selection are still synchronous in places.

## Implementation slices

1. Persist candidate generation, lower-bound ranking, exact routes, load/unload and alternate-market phases under the shared planner allowance. Preserve actor identity through mode/market changes.
2. Separate advisory quotes from actual inventory transfer, payout and route commitment. Recheck source/destination ownership, supply, sea and permissions at the execution boundary.
3. Bound retired actor IDs, per-actor candidate state and failed-route retry history; clean up on capture, destruction and controller release without double payouts.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Land/sea markets, exhausted sources, captured producers, unreachable alternatives and convoy losses conserve inventory/currency.
- Exact payout and selected viable market match a synchronous reference under stable state.
- Fair progress, save/restore and cancellation cover all load/candidate/copy phases; no queue wrapper conceals an unbounded sort or full route.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Retain paid cargo and actor identity; stop only pending candidate work. Fall back to an explicit waiting/retry outcome rather than fabricating a payout or silently deleting the trader.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Final implementation pass - 3 October 2026

Trade enumerates bounded market candidates and admits exact routes before taking source goods; source/port/cargo/generation checks fence the payment boundary, with finite capacity retry.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
