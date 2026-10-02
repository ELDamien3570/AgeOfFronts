# P14: Reduce remaining browser presentation work

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: None beyond the handed-off baseline. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/client/multiplayerStateWorker.ts`
- `src/skirmish/client/OnlineMatchSession.ts`
- `src/skirmish/client/Renderer.ts`
- `src/skirmish/client/main.ts`
- `src/skirmish/client/MapSymbols.ts`
- `src/skirmish/client/TraderPresentation.ts`

## Current boundary

Canonical worker application now continues without materializing discarded views while the renderer is busy. Latest projections preserve dirty unions. Viewport-first entity work, retained presentation objects, HUD memoization and actual browser performance evidence remain.

## Implementation slices

1. Profile actual decode/apply/projection/transfer/HUD/render work before changing layout. Cull by coarse viewport before expensive unit artwork/formation preparation, and reuse safe immutable roads/deposits facts.
2. Retain stable render entities and at most the needed interpolation samples. Avoid computing closed-panel/foreign-faction HUD detail; memoize by explicit revisions rather than stale object identity.
3. Preserve MapSymbols, trader presentation, accessible controls, event logging and intentional graphical LOD. Do not use camera visibility to alter physical simulation or canonical deltas.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Real browser slow-render cycles preserve canonical updates, changed-back dirty cells, removals, late projections and join/recovery barriers.
- Pan/zoom/selection/closed-panels/reopen tests show correct symbols, sprites, interpolation and no leaked render objects.
- Record browser class, frame percentiles, heap and queue/projection counters on ordinary play; separate rendering improvement from server capacity.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert a rendering optimization without changing canonical protocol/state. Keep demand-driven projection and recovery barriers intact unless replacing them with independently verified equivalents.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
