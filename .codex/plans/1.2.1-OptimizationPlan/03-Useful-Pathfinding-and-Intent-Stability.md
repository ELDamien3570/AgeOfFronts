# 03 — Useful pathfinding throughput and stable intentions

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`src/skirmish/RoutePlanner.ts:379` uses a shared default 4,096 work-unit budget and 64-unit quantum, plus preparation/ray limits. `PlanningWorkspace.ts` owns a 65,536-slot arena. Fairness, human reservation and incremental release already exist. Preserve them. A node expansion can still invoke multiple costly obstacle/connector operations, so its CPU cost is not constant.

The previous dense replay's 2,418 completions and 4,730 supersessions motivate investigation, not a conclusion that all superseded jobs were wasted. Some cancellation is essential for responsive players. Oldest planner age is not human order latency. Collect current per-caller evidence before tuning.

## End-state architecture

Separate strategic intention, route corridor and local motion. An AI intention has a stable objective/version and a reason to change. A route has a certified static corridor plus per-actor connectors and current legal-passage checks. Local collision/steering handles short-lived congestion without repeatedly throwing away strategic search. Scheduler accounting includes preparation, obstacle reads, heap operations, output copying and cleanup.

A reusable route key must include movement medium/component, radius/clearance class, topology and relevant regional revisions, passage/diplomacy policy and goal semantics. Equal start/goal coordinates alone do not prove equivalent orders. Paths shared by a cohort are immutable; each member retains an independent cursor, connector and command revision.

## Implementation phases

1. **Measure useful work.** Add bounded per-caller and per-player histograms for queue age, first service, admitted-to-complete time, expanded nodes, obstacle reads, reclaimed nodes, cancellation reason and completed-but-unused output. Separate human direct orders, AI strategic refresh, tactical pursuit, formation, trader, transport and cleanup. Track valid progress across supersessions so recurring restarts cannot masquerade as a healthy queue.
2. **Stabilize AI orders.** Audit callers that submit equivalent goals every think cycle. Introduce objective identity, progress observation and hysteresis where semantics allow. Retain ongoing routes when an objective moves within its permitted tolerance, but immediately honor human replacement, Hold, target death, newly illegal passage and genuine tactical danger. Personality changes priorities, not ownership/collision correctness. Bound retry cadence and clear the backoff when relevant facts improve.
3. **Reduce query and corridor duplication.** Reuse static component/corridor results across compatible cohort members, with bounded LRU or generation-scoped caches. Certify the actual start/end connector for each radius and owner. Never reuse a ship coast connector for a different ship without validation. Prefer existing hierarchical topology and facts before introducing global flow fields. Cache “unreachable” only with dependency revisions and an expiry/revalidation rule.
4. **Narrow invalidation.** Track the regions/edges used by a corridor and invalidate on intersecting changes. A cache entry records dependencies, not just a global world version. Ownership may affect legal passage without changing terrain; doors, walls, diplomacy, research, radius and shore status also count. Broad topology changes trigger a bounded safe rebuild. Keep per-step hostile collision as the final authority even when a route certificate remains valid.
5. **Make cost accounting faithful.** Split high-cost connector, ray and obstacle operations into charged resumable primitives. Preserve deterministic scheduler order and bounded queue/workspace limits. Use measured CPU per primitive to tune fixed weights, while wall time remains diagnostic. Check starvation and head-of-line blocking when a large job occupies the arena; incremental cleanup and reserved headroom must allow small human jobs to progress.
6. **Qualify local motion quality.** Test routes under dense combat with current friendly overlap recovery and hostile swept-collision guards. Avoid pathological alternate-route oscillation and repeated army reformation. A shared corridor must not funnel every squad through one identical slot. Use existing formation/local approach rules to distribute actors without making hard friendly exclusion a new dependency.

## Tests and acceptance

Extend `PlannerFairness.test.ts`, `RoutePlanner.test.ts`, `PlanningWorkspace.test.ts`, `MovementAdmission.test.ts`, `ShipMovementAdmission.test.ts` and `SimulationCheckpoint.test.ts`.

Test mixed human/AI/trade load, a single expensive request, many cheap requests, full arena, cleanup backlog, unreachable goals, wall creation/destruction, coast changes, capture/diplomacy changes and repeated restores. Every cache hit must match an uncached oracle for legality and reachability on generated small maps. Deterministic tie-breaks and final route costs should match where the algorithm is unchanged; an intentional route-quality change needs its own quality tolerance and approval.

Test that human orders are never coalesced just because their destination matches; Shift-queue semantics and formation/attack intent must survive. Verify shared paths cannot be mutated through aliases. Add end-to-end command receipts so queue metrics cannot conceal a lost command.

Acceptance requires reduced wasted work for repeated-equivalent AI scenarios, no regression in genuine replacement latency, bounded maximum retained workspace/cache, no starvation in the declared finite workload, and plan-01 human response/tick gates. Record path stretch and arrival-time distributions, not just CPU. Use at least a 25% reduction in discarded work as an initial experiment target for the redundant-intent fixture, not a universal promise or a reason to suppress valid commands.

## Alternatives and final design review

Do not simply increase 4,096 or arena size: that exchanges latency for tick spikes or memory. Flow fields can help many same-goal compatible actors, but changing walls/passage policies and many destinations can erase the benefit. Implement only after corridor reuse fails a measured requirement. Incremental search algorithms likewise add state and invalidation complexity; they are a later measured experiment, not a required rewrite.

Reviewed loose ends: cache eviction during in-flight consumers (immutable/ref-counted lifetime); stale negative routes (dependency-based invalidation); stationary targets with changing attack semantics (semantic key); cancelled jobs holding arena slots (budgeted release); minor goal drift causing endless restart (hysteresis with progress checks). Dependencies: plan 02 owns preparation; plan 04 owns spatial facts; plan 07 owns revisions/checkpoints. Roll back cache use at match boundaries while retaining the same scheduler and legality checks.

## Second-pass review amendments

- **Parallel outcomes:** if pure path queries later run off-thread under plan 01, their completion order must not alter the scheduler's gameplay commitment order. Tag results with intent and dependency generations, apply at defined barriers, and bound wasted work on obsolete tasks.
- **Work units are not interchangeable:** include candidate construction and disposal as well as node expansion in fairness diagnostics. Tune weights using target ARM evidence and report both logical units and actual CPU.
- **Dedup semantics:** compare complete command intent, including queue position, target, attack/transport state and relevant ownership/formation constraints. Preserve external request identities and outcomes even if safe internal work is shared.
- **Reachability versus clearance:** a topology-level route can be connected yet unusable for a member's radius or current passage policy. The per-member connector and final swept-collision checks are mandatory, including while following a cache hit.
- **No universal cancellation target:** the 25% experiment target applies only to a redundant-equivalent-intent fixture. It must not bias the scheduler toward completing obsolete work when a real player changes an order.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
