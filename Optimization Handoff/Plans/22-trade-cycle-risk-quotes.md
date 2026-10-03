# P22: Share complete trade cycle and risk quotes

Status: **implemented locally; full-run plus focused-repair validation recorded**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Current implementation - 3 October 2026

Execution and AI use a shared physical-stock/capacity/payout contract. Deferred admission certifies all committed market legs and the return before loading. Streaming route costs include handling and round-trip travel; observed local non-owned traffic supplies a conservative uncertain risk haircut. Quotes invalidate on stock, ownership, route, port, research and treaty changes.

The user resumed this plan and requested one combined test run with the remaining tuneups and lobby fixes. See [combined batch evidence](../Evidence/remaining-five-combined-validation.md) for results and qualification limits.

## Dependencies and ownership

Depends on: P10, P19. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/TradeQuote.ts`
- `src/skirmish/domain/Trade.ts`
- `src/skirmish/domain/AiEconomicPlanner.ts`
- `src/skirmish/domain/AiNavalPlanner.ts`

## Current boundary

The shared payout formula and basic viable water-market selection are implemented. A richer common complete-cycle/risk quote for AI decisions and actual trade execution remains.

## Implementation slices

1. Quote actual source stock, load/unload time, land/water route length, round trip, cargo/payout, actor/ship capacity, expected delivery frequency and bounded observable route risk.
2. Expose one shared quote contract used by trade execution and economic/naval decisions. Distinguish guaranteed costs from uncertain risk estimates; no hidden free income or omniscient future damage.
3. Cache by exact route/market/ownership/recipe/sea revisions and resume route-dependent work through P10. Invalidate on capture, depletion, treaty and vessel changes.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Quoted complete cycles agree with ordinary execution on safe deterministic fixtures, including empty-source mode switches.
- A higher payout with prohibitive travel/risk is not automatically preferred; unavailable markets never fund useless trade hulls.
- Cancellation/capture/sinking/restore conserves cargo and payouts exactly and bounds cached failed quotes.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Retain the current shared payout formula as authority. Disable richer strategic scoring without changing already committed cargo or actor identity.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
