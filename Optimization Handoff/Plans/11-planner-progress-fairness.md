# P11: Guarantee limited-search progress and fairness

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: None beyond the handed-off baseline. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/RoutePlanner.ts`
- `src/skirmish/RouteWork.ts`
- `src/skirmish/MovementAdmission.ts`
- `src/skirmish/ShipMovementAdmission.ts`
- `src/skirmish/CommandApplications.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

The exact planner already has a finite queue/workspace and deterministic work accounting. Queued land legs/patrols now resume with bounded backoff; replacement land/ship admissions explicitly reject after three limited attempts. Successful escalation and per-class/per-player guarantees remain unqualified.

## Implementation slices

1. Specify bounded retry/escalation contracts for human replacements, committed background movement, Army/trade/shore callers and urgent defense. Distinguish true unreachable from insufficient current capacity.
2. Add stable per-player/per-command-class fair shares and oldest-age diagnostics without letting repeated new inputs starve accepted older work. Preserve coalescing of unchanged AI intentions.
3. Qualify resource-limited long searches for eventual completion or explicit actionable rejection, with bounded cleanup/path-copy work. Make cancellation and workspace reclamation progress even under continuous legitimate arrivals.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Deterministic cohorts across many factions prove maximum work each step, no class starvation and eventual outcomes.
- Limited searches never become false geographic impossibility; old committed orders remain usable while replacement is pending.
- Mixed Shift intents, dead IDs, takeover, stale revisions and restored workspace free-slot order retain exact outcomes/receipt identities.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep default admission switches unchanged. If scheduler policy changes fail fairness, revert that policy while retaining explicit accepted/executed/rejected receipt semantics.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
