# P05: Bound local combat and defensive queries

Status: **local implementation complete at cd4a46c; larger hotspot/capacity measurements remain open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P03. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/Battle.ts`
- `src/skirmish/domain/Fortifications.ts`
- `src/skirmish/SpatialGrid.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

Trench coverage and some projectile phases already use local queries. Empty gun nests, strategic projectile interception, blast/wall scans and repeated collision views still need profiling-led reduction.

## Implementation slices

1. Add maintained or stage-valid indexes for missile defenses, local barriers/segments, towers and projectiles. Use actual reachable geometric candidates, not faction-wide scans per projectile or emplacement.
2. Sleep empty defensive searches with deterministic next-check deadlines and immediate invalidation from entering enemies/incoming projectiles. Preserve first legal firing tick; do not delay physical retaliation to save work.
3. Reuse stage facts only across mutation-safe boundaries and preserve simultaneous damage ordering, LOS and friendly-wall/gate rules.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Compare damage/casualties/projectile outcomes with the full-reference rules across moving targets, destruction, interception, splash and treaty changes.
- Assert empty sectors stop repeated full searches and wake in time for a new threat.
- Test dense local hotspots separately from global entity count; report remaining unavoidable local work rather than claiming a hard cap that changes combat.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Retain exact reference combat selection until equivalence is proven. Roll back indexing/sleep scheduling independently; never roll back legal damage or casualty accounting.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Nightly integration checkpoint

See [cd4a46c implementation scope and exact local validation](../Evidence/nightly-batch-01.md). External acceptance remains open.
