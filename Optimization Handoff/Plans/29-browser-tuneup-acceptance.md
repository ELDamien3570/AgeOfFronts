# P29: Verify real-browser tuneups and presentation

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P14, P28. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/client/RecruitmentQueueView.ts`
- `src/skirmish/client/EmpireView.ts`
- `src/skirmish/client/PlacementPreview.ts`
- `src/skirmish/client/EmpireHudView.ts`
- `src/skirmish/client/main.ts`
- `tests/skirmish`

## Current boundary

Recruitment cancellation, paid building upgrades/U action, age-correct placement, opening budgets/tribes and first-node grants have unit/integration coverage. The requested real-browser acceptance has not been performed.

## Implementation slices

1. Use the repository current play/preview command and a real supported browser. Verify right-click cancels exactly one applicable recruit, keeps other producer heads moving, refunds once and suppresses the context menu. Check tooltip/keyboard/focus behavior.
2. Verify one-tier paid upgrades, displayed cost/timer, paused production, illegal/damaged/insufficient-funds states and the U shortcut on actual selected building cards. Check age-dependent mine/oil visibility and authoritative rejection across an age change.
3. Start Stone, Bronze and later actual V1 ages including Modern. Confirm stated purchasing power and the user-confirmed first-node grants; do not treat all current-age technologies as free. Observe age-locked tribes, event feed, symbols/traders, joins and slow presentation.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Capture screenshots/video and concise reproducible results with browser/runtime/source/map/seed/age, including observed failures.
- Human and AI/tribe initialization match the actual catalogue; no Industrial/Iron placeholder age is invented.
- Browser queue/heap/frame evidence and ordinary reconnect flows pass without artwork integration or modification of the user’s in-progress Art files.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert only the failed UI/presentation slice or keep its gate unaccepted. Preserve authoritative refunds, payment, visibility and progression rules; do not mask domain failures with UI-only changes.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
