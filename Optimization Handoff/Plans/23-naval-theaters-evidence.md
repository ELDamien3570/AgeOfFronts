# P23: Rank naval theaters and fund intended-sea purchases

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P21, P22, P19. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiNavalPlanner.ts`
- `src/skirmish/domain/AiNavalFacts.ts`
- `src/skirmish/domain/AiEconomicDirector.ts`
- `src/skirmish/domain/AiLossWindow.ts`
- `src/skirmish/domain/AiBudgetLedger.ts`

## Current boundary

Existing trial navy defends/concentrates near one owned port, with same-sea facts, researched power, paid future strength and theater spending memory. Strategic threatened-sea ranking, richer casualty/value evidence and broader purchase intent remain.

## Implementation slices

1. Rank a bounded set of connected seas using threatened owned value, reachable enemy/coastal objectives, actual fleet power/roles, repair/logistics, market/cargo value and prior campaign evidence.
2. Associate every vessel purchase with its actual spawn sea and intended mission capability. Verify legal port tier, queue, research, vessel capacity and reachable objective; do not buy an adequate global total stranded in the wrong sea.
3. Persist casualty/value evidence across mission IDs and restore. Impose evidence-driven retry/funding ceilings with improved-capability conditions before repeating failed investment; retain normal budget preemption.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Two-sea fixtures select the useful/threatened theater and never count unreachable ships or queues as ready strength.
- Repeated failed missions cannot reset their spending history; better researched power or changed enemy evidence can legitimately reopen investment.
- Destroyed/captured ports, queue completion, repaired ships, limited fact budgets and restore yield coherent readiness and exact payments.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep aiNaval off until separately qualified. Revert strategic theater ranking to the existing port-defense objective while honoring paid ships, queues, dock ownership and evidence records.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Final implementation pass - 3 October 2026

Bounded intended-sea ranking includes owned/coastal goods value, local threats, actual ready/researched fleet and queues, and retained casualty/purchase evidence. P21 remote acquisition and P22 cycle-risk acceptance remain deferred.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
