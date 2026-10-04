# 07 — Explicit mutation, lifecycle and release integrity

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`Simulation.ts:3628` (`changeOwner`) updates owner sets/counts, clears route caches and notifies supply, operations, adjacency, tile journals, territory absorption, coastal facts and placement facts. Checkpoint state in `Simulation.ts` is a broad manually assembled structure. This is a maintenance risk, not a claim that current state is corrupt.

`EntityCollection.ts` already centralizes squad/ship/building ownership and hooks. Extend that useful abstraction rather than replacing it wholesale. Its `updateOwned` intentionally relies on callers surrendering writable aliases; TypeScript readonly types alone do not enforce deep ownership at runtime. `multiplayer/infrastructure/RuntimeBuild.ts` explicitly enumerates source paths; review whether all protocol, encoder and client compatibility-sensitive changes participate in release identity.

## End-state architecture

Keep a single authoritative simulation owner, with cohesive domain APIs and typed, ordered mutation effects. Each entity family and territory field has one write boundary that validates invariants, applies canonical changes and emits the exact derived-index/journal invalidations required. Phase contracts define when consumers may observe updates. Checkpoints distinguish canonical data, pending authoritative jobs and reconstructible caches. Compatibility/version rules are explicit.

“Transaction” here means a small deterministic domain commit, not a database or durable event-sourcing platform. Avoid a generic asynchronous event bus for authoritative writes. Subscribers must have a documented order and cannot observe half-applied ownership/resource changes. Batch notifications where safe while ensuring dependent immediate reads remain correct.

## Implementation phases

1. **Map ownership and contracts.** List canonical fields, allowed writers, readers/epochs, indexes, cache revisions, replication fields and checkpoint representation. Start with territory, entity spawn/remove/transfer, boarding, building upgrades and trade settlement. Search direct assignments outside owners and classify legitimate initialization versus mutation. Do not confuse the inherited `src/core` relay documentation with the current `src/skirmish` authoritative runtime.
2. **Introduce typed effects around existing APIs.** Define territory ownership, position, membership, geometry, research/diplomacy and resource changes as explicit effects with old/new values and generations. Preserve existing behavior and tie-break ordering. Use a transaction-local dirty set to coalesce repeated index invalidations, with finite size and clear commit barriers. No listener may recursively trigger an uncontrolled mutation cascade.
3. **Migrate one domain at a time.** Add exhaustive lifecycle tests around the old path, migrate that path, then compare. Extend EntityCollection ownership to remaining large replicated families as plans 05/06 require. Keep input cloning at public boundaries; use owned transfers only where alias relinquishment is provable. Development-only deep-freeze/alias tests can detect retained writable references without adding production-wide cloning.
4. **Split orchestration by phase.** Extract cohesive tick orchestration into small modules only after contracts exist. Each phase declares prerequisites, state it mutates, emitted effects and budget. Keep an explicit ordering table in code/tests. Avoid a giant interface exposing every internal collection or a service locator that merely hides coupling.
5. **Formalize checkpoints and reconstruction.** Version schemas and validate size/identity/index partitions before changing live state. Save pending planners, reservations, receipt dependencies and deterministic scheduler cursors needed to preserve behavior. Rebuild purely derived indexes from canonical records in a defined sequence. Partial restore failure must not leave a usable half-restored match. Whether restore is transactional via temporary state or rejects before install, test the contract.
6. **Close build/protocol identity gaps.** Audit `computeRuntimeBuild` coverage of simulation, codecs, worker infrastructure and client decoder behavior. Define separate compatible content/protocol/build identities if needed; a git label alone is not sufficient. Bind exact artifacts to runtime identity and reject incompatible clients with a clear reason. Test that changing a compatibility-sensitive file changes the relevant identity while documentation-only changes need not change the gameplay identity.
7. **Install regression guardrails.** Add static checks or narrow lint rules against unauthorized mutation, plus independent recount/index/restore reference tests. Bound event/dirty buffers, diagnostic logging and checkpoint retained memory. Reconcile current runtime documentation and progress status as implementation completes so old “flags off” or relay claims cannot drive wrong release decisions.

## Tests and acceptance

Extend `SimulationCheckpoint.test.ts`, `FactionIdentity.test.ts`, `EntityReplicationJournal.test.ts`, live-join/transport and trade lifecycle suites. Add fault-injection cases for validation failure before mutation, subscriber errors and invalid restore payloads. Canonical mutation hooks should be non-throwing after commit or fail the match coherently; do not silently continue with damaged indexes. Specify and test this choice.

For random valid event sequences, recompute derived indexes from canonical state and compare after every commit. Include capture with buildings/cargo, same-tick death and attack, diplomacy changes, queue cancellation, disconnect/seat reclamation and restore during every pending-admission stage. Compare deterministic continuation hashes between uninterrupted and restored runs. Test independent consumer journals and baseline generations after restore.

Done when every canonical mutation family has a documented owner and tested lifecycle path; targeted direct-write checks pass; all index/revision/checkpoint comparisons pass; compatibility rejection is tested; and plans 02–06 use these contracts without duplicating ownership. Full skirmish tests, TypeScript, scoped lint and production build must pass on the exact candidate. A folder refactor or increased test count alone is not completion.

## Dependency and rollout contract

This is an early enabling plan, but do not make all work wait for a whole-codebase rewrite. Phase 1 plus the minimal effects needed by the next optimization should land first. Migrate territory and spatial dependencies before plan 04, trade/entity families before plans 05/06, and pending-job checkpoint contracts before plans 02/03. Plan 01 owns final capacity certification; this plan owns correctness and compatibility across their integration.

Use small behavior-preserving commits with a clear reference path. No source-module extraction should accompany unrelated balance changes. Release artifacts roll forward/back as coherent versions; never attempt an unsupported in-place downgrade of active match state. Keep a known-good artifact and owner-reviewed release checklist. No automatic deployment or Oracle configuration change is authorized by these documents.

## Alternatives and final design review

A universal event-sourcing system would add durable logs/replay/storage obligations the game does not need. A full ECS conversion would broaden scope before the actual mutation contracts are understood. Prefer typed domain owners, explicit phase functions and small derived-index interfaces. Nested mutable collections are the key aliasing loose end: freezing the outer entity list alone is insufficient. The plan explicitly tests owned-buffer/collection lifetimes.

Other reviewed loose ends: restore failure atomicity, recursive listener effects, double journal notifications, entity generation reuse, half-updated ownership, stale dependency caches and runtime hashes omitting encoder changes. Each is covered above. The seven plans address the identified simulation/reliability risks; completing them is not a blanket certification of all release needs such as account security, moderation, content rights, accessibility or platform-store requirements. Record any separate release blockers rather than silently declaring the entire product production-ready.

## Second-pass review amendments

- **Canonical versus derived:** cache rebuilds may choose a different internal layout only if observable iteration/tie-break behavior stays stable. Some scheduler cursors and arena free-list order are behavior-relevant and must remain in checkpoints; do not classify them as disposable just because they look like implementation details.
- **Commit failure:** prevalidate all fallible conditions before publishing canonical changes. If an unexpected invariant fails during commit, stop that match coherently and release consumers; an expensive full-world clone per mutation is not an acceptable default rollback mechanism.
- **Small interfaces:** extend existing entity ownership/hooks before adding a general event framework. Compile-time exhaustiveness and independent tests should enforce coverage, without making every system subscribe to every write.
- **Hash coverage:** a documentation-only commit should not invalidate gameplay compatibility, but codec/worker/client contract changes may. Explicitly test the inclusion policy; do not assume a larger recursive hash is automatically the right compatibility model.
- **Final plan integration:** once phases land, update plan status with links to exact evidence and remove superseded contradictory guidance from active release docs while preserving historical results as history. Mark overall release qualification pending until plan 01's exact target passes.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
