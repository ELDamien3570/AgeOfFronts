# P12: Extend dirty replication beyond terrain

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P03, P04. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/TileChangeJournal.ts`
- `src/skirmish/SnapshotCodec.ts`
- `src/skirmish/Simulation.ts`
- `src/skirmish/domain/Expansion.ts`
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts`

## Current boundary

Independent bounded tile-journal cursors and borrowed network terrain fields are implemented and byte-compared to full scans. Entity/producer/domain metadata still need maintained revisions and compact dirty extraction.

## Implementation slices

1. Define independent bounded entity add/change/remove journals with stable IDs and immutable/dynamic revisions. Each encoder owns its cursor; a standalone baseline must not drain normal publication.
2. Extract compact coherent batches without cloning unchanged arrays/metadata. Copy or synchronously transfer ownership before later authoritative mutation; keep the simulation as sole owner.
3. Provide exact full-scan fallback on overflow/restore/version change, and safe handling of changes that revert before publication. Preserve event identities and ordering.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Byte-for-byte packets or decoded canonical equality against full extraction across lifecycle mutations, removals and change-and-revert.
- Independent baseline/normal-stream cursors, skipped capture at full encoder queue, overflow and restore do not lose changes.
- Counters show reduced unchanged extraction/allocation and bounded journals; captured tick/base/sequence remain coherent under delayed encoding.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep exact full-scan extraction available. Revert one journal consumer independently, never publish a delta whose base was advanced without capturing its changes.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
