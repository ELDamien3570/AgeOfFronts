# 05 — Complete incremental replication and bounded presentation

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`SnapshotCodec.ts:106` includes metadata fields whenever they lack revision tracking. `domain/Expansion.ts:1610` tracks selected metadata revisions, while snapshot extraction still exposes whole collections such as traders, barriers, aircraft and projectiles. Squad/ship/building journals and sparse terrain journals already exist; extend them.

`multiplayer/infrastructure/SnapshotEncodingWorker.ts:47` deliberately clones at the tick boundary to isolate live mutable records. Its two pending slots and 256 MiB old-generation limit are existing safeguards. Moving that clone later without a replacement ownership contract is a correctness bug. `client/CanonicalStateStream.ts:117` still clones the complete canonical presentation on demand, with special handling for roads/deposits. Demand-driven projection is already present.

## End-state architecture

Every replicated collection has stable IDs, a bounded change journal, per-consumer cursor, generation and deletion tombstones. Static configuration, geometry, dynamic entity state, counters and ephemeral presentation events have explicit schemas and lifetimes. A publication is one immutable tick-consistent bundle with a sequence and baseline identity. State delta application is complete and ordered; rendering may skip superseded presentations only after canonical state has incorporated the required deltas.

Use compact transferable buffers where measurements justify them. Ownership of each buffer is explicit: writable by exactly one side or immutable while shared. Never transfer/detach authoritative storage. Baseline generation and live publication share a coherent barrier; late joins cannot consume mixed epochs. Existing reconnect/AI-takeover functionality stays intact.

## Implementation phases

1. **Measure the complete pipeline.** Separate extraction, diff construction, structured clone/postMessage, encoding, coordinator queueing, socket bytes, receive/decode/apply, projection and render time. Track simultaneous copy counts and bytes, not only payload size. Report heap, external memory, ArrayBuffers and process RSS; V8 old-generation limits are not whole-process limits.
2. **Inventory every field.** Classify each `ExpansionSnapshot` field by static/revisioned entity/counter/event. Specify owner mutation API, dirty trigger, stable identity, delete/reset semantics and visibility. Prioritize barriers (mostly stable geometry), traders, aircraft and projectiles, then production/recruitment/inventories/armies and any remaining whole collections. A revision avoids resending unchanged data but still sends the entire collection when one element changes; entity deltas are the end state for large collections.
3. **Extend journals and decoder.** Reuse existing `EntityChangeJournal.ts`/`EntityCollection.ts` patterns. Add upsert/delete records and baseline reset with independent cursors for encoder, join cache and diagnostics. Bound retained history by bytes and age; lagging consumers trigger an explicit fresh baseline rather than pinning history forever. Handle spawn-and-delete within one interval without ghost entities.
4. **Reduce copying safely.** Build compact immutable extraction batches with selected fields and pre-sized arenas or pooled buffers. Transfer only owned outbound memory. Return buffers through a bounded pool after all consumers finish. Preserve publication ordering if encoding completes out of order. In-flight failure, timeout, pause, close and baseline requests release ownership exactly once. Benchmark extraction+transfer+encoding together before accepting a format change.
5. **Introduce persistent presentation deltas.** Keep the canonical decoder authoritative for client state. Apply entity/chunk changes to a stable rendering model, update only changed geometry and maintain previous/current poses for interpolation. A presentation acknowledgement retires only changes through its own sequence. If the renderer misses frames, union changes since its acknowledged cursor or rebuild a bounded baseline; never simply discard dependency-bearing canonical deltas. UI selected-unit/building panels need the same generation handling as the map.
6. **Prove backpressure and recovery.** Retain bounded per-peer and encoder queues. One slow peer may be resynchronized or disconnected under the documented policy without pausing all healthy peers indefinitely. Distinguish input receipts from presentation ACKs. Pause-assisted join requires a maximum duration and a safe timeout path. Reconnect to an eliminated faction is an expected rejection, not a performance failure. Encoder failure must leave no dangling barrier or pending promise.
7. **Version the protocol.** Plan 07 owns runtime identity coverage and compatibility; this plan owns field/schema migration. Use negotiated incompatible-build rejection or coherent client/server rollout. A feature flag cannot mix old and new packet semantics without explicit compatibility support.

## Tests and acceptance

Extend `EntityReplicationJournal.test.ts`, `SparseNetworkSnapshot.test.ts`, `CanonicalStateStream.test.ts`, `TileChangeJournal.test.ts`, `LiveJoinRuntime.test.ts`, `LiveJoinLifecycle.test.ts` and `LiveMatch.test.ts`.

Compare a decoder consuming deltas to a fresh full snapshot at identical ticks. Cover no changes, one change among thousands, ID reuse prohibition/generations, deletes, owner transfers, reset, journal overflow, differing consumer speeds, out-of-order worker completion, cancellation and restore. Mutate authoritative objects after capture to prove the outbound packet cannot change. Verify buffers are not accessed after transfer and pool retention is bounded on errors.

Rendered tests cover zoom, selection, hover, destroyed entities, missed presentation frames, tab background/foreground, interpolation and UI counters. No visual ghosts or canonical state skipped. Test rendering on the declared minimum client tier, not only a powerful development PC.

Done when unchanged large collections incur no full serialization, payload/application cost scales with changed entities in sparse-change fixtures, all snapshot equivalence tests pass, and plan-01 publication/memory/client gates pass under the target count. In all-moving worlds O(changed entities) is still O(total entities); publish those worst cases honestly.

## Alternatives and final design review

Do not switch transports merely to hide serialization cost. Compression must justify its CPU cost on two cores. Interest management may eventually reduce traffic, but must preserve fog/visibility, ownership UI and cross-map gameplay knowledge; it is not a prerequisite until measurements show full-world deltas are insufficient. SharedArrayBuffer introduces deployment/security/ownership requirements and is optional, not the first fix. Cosmetic projectile events may replace persistent state only after proving no gameplay or late-join semantics depend on it.

Reviewed loose ends: independent cursors, tombstones, overflow baselines, joined-client consistency, slow-consumer memory retention, transient buffer copies, terminal cleanup and runtime mismatch. Each has an explicit phase/test above. Rollback replaces compatible client/server artifacts together at a match boundary; never reinterpret active delta streams with an older decoder.

## Second-pass review amendments

- **Journal reads also cost CPU:** the existing `EntityChangeJournal.since` scans retained IDs and sorts changes. Extending it to more collections is not automatically O(changes). Measure query/extraction work; use an empty-revision fast path and, if needed, a bounded append/ring index with dedup and independent cursors. Do not replace one full scan with another hidden inside “incremental” infrastructure.
- **Envelope alignment:** inspect `multiplayer/StateLimits.ts` and producer/consumer byte limits together. A valid large baseline can exceed a stricter client queue envelope; either define compatible chunked baseline assembly with total allocation limits or reject unsupported configurations before match start. Never raise every limit to mask an accounting mismatch.
- **Decoder work:** wire byte limits alone do not bound decompressed arrays, metadata token counts or apply time. Validate lengths and generations before allocating, cap concurrent baseline assemblies, and bound cancellation cleanup.
- **Join spikes:** baseline capture must fit its declared barrier/pause budget, even with cold caches. If chunked across ticks, capture a coherent immutable source or explicitly pause at the snapshot boundary; never mix current and earlier entity generations.
- **Bandwidth scaling:** one encoding reused by ten clients saves encoder work but outbound bytes still scale with recipients. Include coordinator socket buffering and actual network throughput in the release evidence.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
