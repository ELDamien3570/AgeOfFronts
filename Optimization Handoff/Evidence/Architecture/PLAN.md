# Architecture optimization execution plan

Baseline: clean commit `234d62a74ac32275c1d99cb693bec97110347a05`, including
the earlier debloat pass. Frozen sources: `out/architecture-baseline`.
Preserve every gameplay feature, exact fixed-step state, route work/fairness,
checkpoint/replay outcomes, command authorization and recovery obligations.
Do not deploy or publish during this work.

## Work and acceptance

1. Entity writes: add an owned scalar-write path, avoid generic patch enumeration
   for hot scalar writes, reuse index fact records when membership is unchanged.
   Preserve immediate observable state, no-op detection and journal hooks.
2. Wall clearance: use an expanded swept-area proof and early-exit exact query;
   retain collecting queries for callers that need candidates. Compare with the
   original collecting sweep over corners, radii, allied gates and obstacles.
3. Unit definitions: player/definition cache without per-read compound keys.
   Resolve once per combat pass where possible; research/refit/restore stay live.
4. Capture: bounded cache of static terrain/component footprints, keeping live
   eligibility, notification order, pressure and timers exactly unchanged.
   Incremental pressure is unnecessary if it would introduce unsafe invalidation.
5. Routing: reduce identical revision serialization and static topology checks;
   preserve search order, per-quantum work, capacity and completion ticks.
   Do not silently replace flat A* with a different-path hierarchy. Replay hashes
   are the acceptance gate; record remaining algorithmic opportunity honestly.
6. Presentation: send packet-owned packed entities and accumulated tile deltas
   from the canonical worker; retain main-thread presentation state. Preserve
   reset/removal/changed-back/ack/coalescing and disconnected-seat behavior.
7. Network: dedicated binary snapshot codec/envelope over WebSocket, keeping
   checkpoint codec, legacy text compatibility, integrity, allocation limits,
   recovery baselines and state acknowledgements. Exercise real sockets.
8. UI/render projections: cache building-derived views by exact facts and refresh
   HUD once per visible frame while canonical state continues updating. Keep
   input-triggered HUD updates immediate and selection reconciliation correct.

## Validation and measurement

- Run three sequential 400-tick baseline and candidate checkpoint trials and
  repeated synthetic 1500-unit movement trials, with no concurrent heavy checks.
- Require identical snapshot and checkpoint hashes on every replay comparison.
- Add focused tests for ownership/index mutation, sweep equivalence, definition
  invalidation, packed presentation obligations and binary snapshot corruption.
- Compare binary/text wire bytes, encode/decode latency and presentation map-copy
  volume; do not call a transfer-only microbenchmark a full pipeline gain.
- Run full skirmish suite with two workers, TypeScript, production build and diff
  checks. Use browser canonical-worker harness and a short gameplay smoke test.
- Save evidence and per-task disposition under Optimization Handoff/Evidence/
  Architecture. Report means/tails/limits and any unreached performance targets.

## Progress

- [x] Freeze baseline and define compatibility constraints.
- [x] Tasks 1-3: mutation, wall clearance, definitions.
- [x] Tasks 4-5: capture and routing.
- [x] Task 6: canonical presentation packets.
- [x] Task 7: binary live snapshot transport.
- [x] Task 8: fact-driven render/UI work.
- [x] Final regression, browser verification and baseline comparison.

Results: `Optimization Handoff/Evidence/Architecture/README.md`.
All replay hashes matched. Final suite: 1318 passing tests across 195 files.
TypeScript and production build passed. Late-game tick mean: 24.248 -> 19.298 ms.
1500-squad marching tick mean: 11.890 -> 9.432 ms. These are local headless results;
123 ms worst-case late-game spikes and release/runtime qualification remain.
