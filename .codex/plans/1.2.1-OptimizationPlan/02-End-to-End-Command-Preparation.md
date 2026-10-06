# 02 — Budget every stage of command preparation

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`src/skirmish/domain/Expansion.ts:650` prepares structure attacks by enumerating tiles around the target footprint, checking walkability/fortifications/aim, filtering and sorting per selected squad, and assigning reserved positions before `admitStructureAttack`. The 30-squad boundary does not bound target footprint x range-area x aim-check cost. `MovementAdmission.ts`, `RoutePlanner.ts` and `StructureAttackAdmission.test.ts` already provide foundations; extend them instead of creating a second independent scheduler.

This is a source-confirmed synchronous path, not proof of its current share of server CPU. Audit other preparation paths with the same pattern: formation slots, shore and landing candidates, building/road/wall placement quotation, target selection and large result copying.

## End-state architecture

A command is an explicit state machine: validate identity/shape -> reserve bounded admission -> enumerate -> certify -> rank/select -> assign -> search/connect -> revalidate -> atomically activate -> release. Each potentially large stage yields with serializable cursors and consumes the shared deterministic work budget. Cheap validation remains immediate; expensive validation is itself staged. UI receipts distinguish accepted/pending from executed, blocked, superseded and rejected.

Proposed preparation record: authenticated command identity, player, sorted selected IDs, order revisions, target identity/generation, geometry/diplomacy/research dependencies, stage/cursors, compact candidate frontier, reservations, temporary paths, consumed-work counters and deadline policy. Never retain mutable entity references or browser closures. Existing orders continue while preparing; no premature clearing of queues, charge state or movement. Explicit Hold/cancel must take effect promptly and retire pending work.

## Implementation phases

1. **Trace complete command costs.** Instrument candidate visits, aim segments, obstacle reads, ranking comparisons, copied path nodes and release operations, including work before route admission. Add an inventory marking each loop bounded/resumable and the source of its bound. Establish reference outputs from the current structure-attack allocator on small fixtures.
2. **Move enumeration into admission.** Use a deterministic tile-range cursor over target segments and range rows. Charge each tile and any nested ray traversal. Deduplicate with bounded scratch storage scoped to a target/profile/revision. Enumerate long barriers without allocating an unbounded target-expanded rectangle or giant Set. Workspace exhaustion is a resumable wait or explicit capacity rejection, never a synchronous fallback search.
3. **Replace monolithic sorting.** For the current “best candidate” rule, a streaming lexicographic argmin can avoid sorting: side load, distance, stable tile ID. Re-scan or retain bounded certified candidates as reservations change. Preserve completeness: a top-K list is an optimization only if fallback continuation can find a legal candidate outside it. Share static candidate facts across equal movement/weapon profiles; certify each squad's connectivity and spacing individually.
4. **Stage assignment and route certification.** Reserve only within the pending transaction. Save the current per-squad assignment policy and deterministic tie-breaks unless separately approved. At activation, recheck life/owner/order revision, target validity, allied status, technology/range and changed obstacles. A changed dependency triggers local recertification or a bounded restart. Do not reject unrelated orders because an irrelevant global revision changed.
5. **Close lifecycle and receipts.** Implement cancellation, supersession, destruction, ownership change, disconnect, elimination, pause and restore at every stage. Release slots and workspace incrementally. Transfer pending receipt dependencies to replacement land/transport admissions exactly once. Document whether group commands are atomic or intentionally partial and preserve current contract. Never report executed before activation.
6. **Apply the pattern to the inventory.** Convert only source-confirmed unbounded preparation paths; do not duplicate already bounded shore/formation jobs. Run each path's focused tests and reference comparison before the next conversion.

## Invariants and memory limits

Every step has an integer maximum for candidate/ray/obstacle/copy/release work. A single primitive cannot conceal a full barrier or entity scan. All nested arrays, Sets, path fragments and dedup structures count toward the job and match memory envelope. Account for reservations held by cancelled jobs until release completes. Fairness is per player/caller, with human capacity protection and a finite service policy for AI; spawning many child jobs cannot multiply one parent's share.

A job may be pending because the path is difficult, but it cannot exist forever without progress or a terminal outcome. Deadlines use simulation progress and explicit pause semantics; wall-clock network timeout is a separate layer. Capacity rejection preserves prior orders and communicates a retryable reason. Restore preserves work consumed, cursors and receipt status, or restarts under an explicitly tested bounded policy with no duplicated commitment.

## Tests and acceptance

Extend `StructureAttackAdmission.test.ts`, `MovementAdmission.test.ts`, `CommittedPlanningPause.test.ts`, `RoutePlanner.test.ts` and `SimulationCheckpoint.test.ts`.

- Long walls and maximum valid attack range with 30 mixed-profile squads; no free positions; narrow corridors; existing valid firing positions; different squad radii
- Cancellation/target destruction/ownership and diplomacy changes at every stage; simultaneous reservation contenders; old order changes during preparation
- Workspace exhaustion, repeated replacement, exact quantum boundary, zero budget, pause and restore; no retained candidate or reservation after terminal cleanup
- Small-case reference equality for chosen positions, order effects and deterministic hashes. Test low work budgets across many ticks, not only one generous completion
- Assert operation counters cap each slice. Benchmark whole-command p95/p99 preparation and maximum tick contribution separately from final pathfinding and network latency

Done when every audited large command has bounded preparation, terminal cleanup and receipts; no synchronous escape hatch remains; the common plan-01 response targets pass in integrated tests.

## Alternatives and final design review

A larger timeout hides stalls. Smaller selection limits change UX without bounding one expensive target. Caching the final assigned positions across squads is unsafe because reservations and personal connectivity differ. Prefer streaming best-selection over maintaining a new general priority-queue framework where one best choice is enough. A subtle loose end is target mutation between certification and activation: revision-tagged atomic activation above closes it. Another is cleanup taking longer than useful work: charge cleanup and include it in fairness/memory tests. Rollback switches an entire admission implementation only at a match boundary, with checkpoint/protocol compatibility verified through plan 07.

## Second-pass review amendments

- **Multi-stage accounting:** a single `structureAim` call may walk many barrier segments/ray cells. Charging one candidate is insufficient; the aim query itself needs a cursor or a proven bounded primitive.
- **Cancellation responsiveness:** ordinary movement supersession must not retire the old successful path before the replacement commits. Hold is a deliberate exception that stops current motion immediately; receipt and cleanup may finish later under a bounded budget.
- **Cache pressure:** candidate caches compete with route arenas and snapshot copies. Give them an explicit shared byte allowance and eviction/recomputation behavior rather than independent generous maxima per job.
- **Changing dependency storms:** allow bounded local recertification and progress retention where safe; after repeated invalidation, provide a specific terminal outcome or a scheduled retry policy. Never continually reset an apparent deadline without exposing the accumulated age.
- **Scope control:** the first deliverable is the known structure-attack preparation path. Inventory findings need evidence and their own regression case before converting unrelated systems. This avoids replacing several already-correct planners just to make their code look uniform.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
