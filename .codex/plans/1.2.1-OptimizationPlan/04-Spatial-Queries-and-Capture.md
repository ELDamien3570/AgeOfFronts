# 04 — Shared spatial facts and exact incremental capture

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`Simulation.ts:2684` rebuilds a squad index before AI and again for movement; held-unit and approach queries add work. `domain/Battle.ts:166` rebuilds its squad/naval indexes and trench coverage. Its building index already uses producer/geometry revisions, which should be retained. `SpatialGrid.ts` has exact query and bounded advisory sample APIs; the latter explicitly cannot replace exact hostile collision. `Simulation.ts:3552` visits each eligible squad capture footprint each tick. `CapturePressure.ts` already clears only touched cells.

## End-state architecture

Use phase-versioned spatial views with a single owner for each index. AI sees the documented pre-movement state; battle/capture see the appropriate post-movement state. Consumers can share a view only when their membership predicates and temporal semantics agree. Authoritative collision and targeting remain exact. Advisory steering can remain sampled under its existing contract.

Maintain or rebuild indexes based on measured dirty density, rather than assuming incremental is always faster. Cache geometric capture masks separately from owner/progression/combat-dependent permissions. Where safe, aggregate per-owner contributions to touched cells; contested semantics, accelerated capture and diplomacy must remain identical to the reference implementation.

## Implementation phases

1. **Inventory consumers and epochs.** For AI, route preparation, local movement, combat, trench staffing, trade interception and capture, record required position epoch, inclusion rules, radius and deterministic iteration order. Instrument rebuilds, records moved, bucket visits, returned candidates, exact pair checks and duplicate capture tile visits.
2. **Introduce shared phase views.** Define a read-only index interface tagged with tick/phase/geometry generation. Build one stable ordered eligible-unit list per relevant phase. Share indexes only after equivalence tests. Movement commits update membership or produce the post-movement rebuild once; embarked/dead/new/owner-changed entities update at defined barriers. For swept collision, queries must cover the swept footprint, not only endpoint cells.
3. **Choose incremental versus rebuild adaptively.** Compare costs on low-motion and all-moving armies. An explicit dirty-record threshold selects the cheaper deterministic strategy. Maintain deterministic result ordering regardless of bucket insertion/removal history. Do not sort every query merely to conceal unstable membership; design stable tie-breaks and charge necessary sorting.
4. **Cache static/slow facts.** Extend existing building revision patterns to trench geometry and eligible coverage candidates. Recompute staffing when units enter/leave, die, embark, change owner/type/research eligibility or when the trench changes. Preserve slot count, same-owner rule and exact ID selection behavior. Reuse terrain/obstacle facts only with radius and legal-passage dependencies.
5. **Optimize capture in two stages.** First precompute radius offsets and cache geometric masks by center/component/radius/topology, retaining per-tick permissions. Then benchmark reference-counted per-owner cell coverage from added/removed/moved footprints. Multiple squads of one owner must not accelerate ordinary pressure, while any opposing owner still contests it. Accelerated capture needs its own correct aggregation and invalidation for resistance, not a stale cached boolean.
6. **Bound storage and rebuild paths.** Use sparse active chunks where map-sized faction arrays would explode. Derive a byte envelope for worst-case occupied chunks and owners. Invalidation/rebuild must not freeze a tick after a large territory change; stage optional facts while retaining a correct bounded fallback. If a cache has no cheap safe fallback for mandatory tick work, do not enable it until rebuild cost fits the release budget.

## Correctness details that cannot be skipped

Removing one overlapping squad must not remove the remaining squad's pressure. A cell contested by three factions must remain contested when one leaves. Capture progress continues for stationary eligible coverage; “nothing moved” does not mean “nothing changes.” Ownership, diplomacy, resistance, unit technology and embarkation may change capture eligibility without movement. The existing byte pressure uses 255 as contested; new owner-index schemes must validate representable IDs and avoid confusing sparse IDs with packed slots.

Preserve simultaneous damage and capture semantics. Do not delay hostile collisions across ticks, cap exact query results, or permit a stale ownership cache to cross a forbidden border. Candidate deduplication must not omit a legitimate second damage contribution. Lifecycle transactions from plan 07 are essential to keep indexes coherent.

## Tests and acceptance

Extend `CapturePressure.test.ts`, `CaptureQuery.test.ts`, `SimulationCheckpoint.test.ts` and relevant movement/combat tests. Build a slow reference oracle independent of the optimized data structures. Compare every tick on random small maps, contested boundaries, three-way contests, overlapping stationary/moving forces, building captures, research changes, embark/disembark, trench destruction and checkpoint restore.

Test view-epoch misuse with development assertions. Randomize insertion/removal histories while keeping canonical inputs fixed; results must be deterministic. Benchmark sparse and dense battles separately; report worst bucket occupancy and pair tests. An exact crowded interaction can remain intrinsically expensive; a grid alone does not prove linear scaling.

Done when redundant rebuilds are removed for equivalent phases, capture results match the oracle, cache memory is bounded, all invalidation tests pass, and the common tick gate passes. Record both query cost and any extra mutation-maintenance cost; optimize total work, not a single timer.

## Alternatives and final design review

A quadtree or new spatial tree is not automatically better than the existing uniform grid for roughly similar-sized moving squads. First share/index the existing work; prototype another structure only for a demonstrated density/radius distribution. Pair batching can avoid duplicate symmetric checks but asymmetric weapons/hostility/ranges need separate semantics. Full per-faction grids would multiply largest-map memory by 54; sparse or shared representations avoid that trap. If persistent capture counts prove too complex relative to their win, keep the simpler cached geometric masks with exact per-tick accumulation. This is an explicit acceptable alternative if release gates pass.

Rollback retains the original exact query/capture path behind a match-start flag and compares both in small debug fixtures. Do not run double simulation indefinitely in production. Dependencies: plan 07 phase/mutation contracts; plan 03 corridor dependencies; plan 06 interception consumers.

## Second-pass review amendments

- **Snapshot lifetime:** a read-only view backed by mutable entity objects is not an immutable phase snapshot. Either constrain its lifetime to a synchronous phase or capture compact fields; version tags alone do not prevent stale readers from seeing new coordinates.
- **Capture cache keys:** geometric masks use the actual center semantics of the current implementation (tile-centered here); exact combat/movement queries still require sub-tile positions. Do not generalize a tile cache to sub-tile queries without a proof.
- **Reference-count representation:** persistent pressure requires enough per-owner state to remove one contributor without losing others. A single byte containing only owner/contested cannot support correct decrement. Prototype sparse per-cell owner counts and accelerated-contributor state with explicit memory limits; keep the simpler accumulation path if it wins overall.
- **Batch correctness:** apply all movement/lifecycle changes needed by a phase before exposing its index. Publishing half an incremental rebuild would produce incorrect collision, targeting or capture.
- **Worst-case honesty:** exact dense combat may require many legal pair tests even after redundant queries disappear. If the remaining physical interaction count violates the budget, report the measured limit rather than silently truncating targets or changing combat frequency.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
