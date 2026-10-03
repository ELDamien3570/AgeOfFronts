# P04: Separate resource geometry and producer revisions

Status: **local implementation complete and tested; broader qualification remains open**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P03. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/domain/ResourceSiteIndex.ts`
- `src/skirmish/domain/Supply.ts`
- `src/skirmish/domain/AiPlacementCandidates.ts`
- `src/skirmish/domain/AiEconomicSnapshot.ts`
- `src/skirmish/client/PlacementPreview.ts`

## Current boundary

Resource facts/visibility and maintained placement lookup exist. ResourceSiteIndex.update still builds geometry signatures, while production/dependency callers repeatedly derive dynamic producer facts.

## Implementation slices

1. Give immutable deposit geometry a version established at generation/import/restore and separate ownership/depletion/visibility revisions. Replace repeated O(deposits) string signatures with explicit changes; retain a safe import-validation path.
2. Maintain resources-by-tile/owner and completed legal producer/workshop capability facts. Invalidate costs/recipes/capacity on capture, completion, upgrade, research and removal.
3. Reuse immutable geometry across safe snapshot/preview consumers while keeping transfer/buffer ownership explicit. Do not share mutable territory arrays casually.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Independent deposit/producer scans match maintained results under owner and tier changes, including unchanged array lengths.
- Placement preview updates funding independently, reveals age-legal deposits only, and refreshes geometry only on its relevant revision.
- Counters prove repeated unchanged queries do not rebuild full geometry signatures; restore and custom-map import reconstruct correctly.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert consumers to exact reference queries while keeping revision fields backward compatible. Never reuse a stale producer capability after capture or upgrading.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.

## Nightly integration checkpoint

See [cd4a46c implementation scope and exact local validation](../Evidence/nightly-batch-01.md). External acceptance remains open.

## Final implementation pass - 3 October 2026

Resource geometry and ownership stay separate; completed producer capability buckets and canonical producer-ID views remove repeated paid-job scans.

The user superseded per-slice validation with one complete code pass and a final gate. Source commit `a4145f4230cabe58023bc60d58b835407a111956` passes 1,075 tests across 164 files, TypeScript, the production build, whitespace and scoped Oxlint. Scoped ESLint retains one pre-existing unused variable. See [final evidence](../Evidence/nightly-final-validation.md) for exact inputs, failures repaired, timeout settings and limits. Experimental flags retain their existing defaults. Deferred-feature cases, remaining real-browser checks and actual target hardware qualification are separate open gates.
