# P02: Qualify consumer limits and transient memory

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P01. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/multiplayer/StateCodec.ts`
- `src/skirmish/SnapshotCodec.ts`
- `src/skirmish/client/multiplayerStateWorker.ts`
- `src/skirmish/multiplayer/application/PublicationQueue.ts`
- `src/skirmish/multiplayer/infrastructure/SnapshotEncodingWorker.ts`

## Current boundary

Wire/metadata/typed-array limits and bounded queues exist. Their values are structural safeguards, not measured total V8 heap or whole-process certification. The encoding worker has a 256 MiB old-generation limit.

## Implementation slices

1. Inventory each consumer: normal snapshot, recovery checkpoint, joining client, delayed renderer, worker message and coordinator fan-out. Document simultaneous buffers/strings/maps, transfer-versus-clone ownership and worst legitimate payload shape.
2. Measure representative valid ordinary-play payloads and peak transient heap/external/ArrayBuffer/RSS on supported runtimes. Tune limits together so a valid encoder output is accepted by its intended decoder without removing protective caps.
3. Audit retained pending IDs, caches, histories, worker close/failure queues, geometry copies and deleted-entity references. Use explicit cleanup or finite bounds; avoid broad pooling without measured benefit.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- Boundary-size valid packets and malformed length/nesting/token/base64/RLE/buffer-reference cases reject before large allocations.
- Slow renderer/recovery/cancelled join and encoder failure release retained data; comparable-cardinality sessions settle into a stable memory band.
- Save/restore with active/inactive arena states preserves order and continuation without copying unused full buffers.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Revert a limit change as a coordinated encoder/decoder change. Keep the last demonstrated valid envelope; never silently drop canonical updates to fit memory.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
