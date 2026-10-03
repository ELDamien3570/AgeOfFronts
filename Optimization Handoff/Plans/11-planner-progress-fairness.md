# P11: Guarantee limited-search progress and fairness

Status: **local implementation and shared integration complete at cd4a46c; capacity qualification remains open**. Read
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

## Local P11 slice 1 evidence (2 October 2026)

Source: `59c4eeb4696e6c8f91c730704ec9537f7f351a1b`, including integrated P01.
Branch: `codex/p11-p14-optimization`. No default admission flag changed.
New matches use checkpointed player round-robin, caller round-robin within each
player, and FIFO rotation within each caller. At most 128 queued jobs are
examined per quantum; cursor state is bounded to the existing 256-player domain.
Historical checkpoints without scheduling metadata explicitly restore FIFO.
Diagnostics remain read-only and excluded from checkpoints.

Focused planner/fairness/land/ship admission: 32 tests passed. TypeScript,
scoped Oxlint/ESLint and production build passed. Full suite with four workers:
1011 passed, ten existing five-second timeouts. Serial suite: 1020 passed,
one timeout in `ShoreTransport.test.ts` (waiting island-slot test). The same
test timed out against the untouched HEAD planner (5814 ms, original 5000 ms
limit). No deadline or assertion was weakened. Common full-suite acceptance
remains open on this Windows x64 environment; this is not a clean full gate.
Fairness fixtures use 80x80 all-land maps, no runtime AI flags, fixed topology,
budget/quantum 1, and 12 deterministic turns. Sparse faction: 6 of 12 turns;
one-player admission/defense/trade: 4 each. Restore preserves exact turns.
This earlier slice is superseded by the final local implementation below.


## P11 final local implementation (2026-10-03)

New checkpoint scheduling version 3 shares quanta by player and caller, with FIFO
rotation inside each cohort. Legacy missing metadata restores FIFO (version 1);
version 2 keeps its prior fair scheduling without the new escalation policy.
Queue maximum remains 128; scheduler selection uses at most three scans of that
queue per quantum, separately from charged search work. Cursor state is bounded
to 256 players. Diagnostic cohorts are bounded by player/caller combinations.

After charged cleanup, a limited search retries once with exclusive access to
the existing fixed arena. New allocations wait while existing holders finish;
no existing search progress is discarded. Full-arena exhaustion remains limited,
never unreachable. Reservations, cleanup and fairness cursors survive restore.
The ordinary scheduler stays fair; exclusive escalation temporarily reserves
service until a finite terminal outcome, including up to 32 existing finalists.

After three limited results, new committed ship legs pause, retain later
waypoints and stop submitting searches. Replacements reject without changing
active orders. Unchanged recovery intentions retain progress. Legacy ship
checkpoints restore the previous retry/coalescing policy. The user chose
stability; land pause and visible land/ship status are supplied in the reserved
Simulation/protocol/codec integration patch rather than overwriting those files.

The new tests cover 54 players with two classes (108 jobs, two turns each across
216 one-unit turns), contested 128-slot capacity, full-arena terminal failure,
cancellation with arrivals, exact mid-escalation restore, ship pause/replacement,
and legacy policy. The shared patch's regression covers land pause, retained
later orders, restore, no further requests, wire status and clearing status.
79 focused tests passed with the integration patch; a further 12 passed after
adding the legacy ship case. TypeScript, scoped lint, production build and diff
checks passed. Final serial full suite: 1035 tests passed across 158 files in
279.86 seconds; no deadline changes. See Evidence/P11-P14/README.md.

This does not qualify future P06-P10 callers before they migrate to this planner,
the largest map, the ARM host or ten real browser clients. Default gates stay off.

## Nightly integration checkpoint

See [cd4a46c implementation scope and exact local validation](../Evidence/nightly-batch-01.md). External acceptance remains open.
