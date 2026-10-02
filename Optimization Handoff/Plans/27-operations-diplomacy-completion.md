# P27: Complete selective operations and diplomacy quotas

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P03. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/AiOperations.ts`
- `src/skirmish/domain/DiplomaticGeography.ts`
- `src/skirmish/domain/Diplomacy.ts`
- `src/skirmish/domain/Expansion.ts`
- `src/skirmish/Simulation.ts`

## Current boundary

Optional AI peace/preparing/war/recovery, one offensive target, local remembered defense, declarations, footprint guards, geographic diplomacy and 1200-tick AI recipient cooldowns are implemented. Full selective force/logistics readiness, broad strategic sleep facts and remaining proposal quotas/windows are not.

## Implementation slices

1. Complete event-driven local threat/knowledge facts and shared regional frontier inputs so peaceful strategic preparation stops before expensive global scans. Keep physical movement/collision/projectiles/capture/damage running normally.
2. Replace count-only readiness with useful force classes, available counters, logistics, siege/transport needs and stable evidence; coordinate P16/P19 rather than duplicating their scorers.
3. Implement configurable proposer/global quotas and post-reject/expiry/break AI-only contact windows. The architecture suggests one outgoing pending offer, 2–3 minute proposer cadence, recipient windows and longer declined/broken-pair cooldowns; validate values as tuning proposals, not mandatory physical treaty changes. Keep manual offers/replies unchanged.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Multiple invaders wake only relevant defense and remain retaliatable during cooldown; border hopping cannot buy immunity.
- Neutral routes, capture-radius contact, landing, allied passage, defensive pursuit and retreat obey explicit operation policy while human command legality is unchanged.
- Many eligible proposers cannot flood a recipient; AI quotas, pending offer cleanup, reciprocal acceptance, reject/expiry/break and restore are deterministic and bounded.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep aiWarPolicy off by default and preserve physical Diplomacy.hostile. Disabling strategic policy must not stop paid lifecycles or rewrite human alliance mechanics.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
