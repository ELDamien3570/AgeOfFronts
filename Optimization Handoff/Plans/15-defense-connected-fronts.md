# P15: Finish broader defensive-region policy

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P03, P07. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiFrontRecords.ts`
- `src/skirmish/domain/AiModernFronts.ts`
- `src/skirmish/domain/AiDefenseDirector.ts`
- `src/skirmish/domain/AiDefenseOutline.ts`
- `src/skirmish/domain/AiBoundaryIndex.ts`
- `src/skirmish/domain/AiAssetLeases.ts`

## Current boundary

Current defense slice is complete and tested: resumable terrain-aware city circuits; at most eight stable 16x16 hostile sectors; one funded three-site Modern section per faction, occupied trenches/support/reserve, withdrawal and reuse. This is not connected whole-front aggregation, multi-front allocation or a proof all older child work is bounded.

## Implementation slices

1. Build connected/reachable defensive regions from stable sector records without repeatedly flooding the world. Preserve IDs and commitment lifetime across harmless border jitter; rank material threats, access, rear supply and terrain.
2. Generalize staffing/support/reserve and safe construction/repair to the desired multi-front envelope. Reuse or retire paid structures intentionally; preserve city gates/friendly access and never reserve forces already owned by another operation.
3. Budget remaining city proposal preparation, full-world roster/enemy scans, construction-window queries, wall-closure/repair searches and candidate validation. Modern sections already have a resumable roster; migrate other controllers to shared lifecycle facts.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Independent connected-front reference on concave borders, islands, cliffs, enclaves and treaty changes; stable IDs do not churn on equal choices.
- Actual paid fortifications remain staffed with reachable support and reserve; overmatch/loss/takeover/peace releases unpaid holds and retreats without refunding paid work.
- Test exhausted resources, destroyed/captured positions, reuse/repair, multiple fronts and city enclosure access with deterministic work and retained-state bounds.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep aiDefenses off until acceptance. Fall back to the completed single-section/terrain-enclosure behavior without deleting paid structures or disrupting manual orders.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
