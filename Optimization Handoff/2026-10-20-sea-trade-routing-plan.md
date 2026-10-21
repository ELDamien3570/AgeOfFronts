# Sea trade routing architecture and completion plan

Status: audited implementation plan, grounded in source at `ea9514b1` on `Private-Matches`. Created 20 October; detailed audit completed 21 October 2026. No gameplay implementation is included.

**Implementation entry point:** read [the detailed implementation specification](2026-10-21-sea-trade-implementation-spec.md) after this overview. It supplies exact private types, planner callback behavior, algorithms, initial limits, state transitions, failure handling, persistence/conversion rules, test assertions, harness metrics and ordered tickets T00–T13. Its concrete initial choices supersede the open implementation choices in this overview; empirical qualification gates still apply.

The late-game stall is an unfinished throughput problem in the existing shared routing system. The recommended change is a bounded service for reusable shipping lanes, built on the match's existing route planner. Physical water routes should belong to the match and remain available across voyages. Traders should independently subscribe to those routes and commit their own cargo. Simplifying destination preferences supports this design but is not the main performance improvement.

The owner's confirmed preferences are **allies among nearby ports with reusable routes** and **a cached direct route home when available, otherwise retracing the recorded voyage**. A retraced multi-stop return may be longer, but avoids a fresh normal return search. The earlier suggestion to exclude only the previous stop remains a separate gameplay decision; this implementation retains the inexpensive no-repeat-per-shipment rule.

## Completion standard

The work is complete only when legitimate growing fleets continue launching, delivering and returning through late-game play, cold restore, conquest and concurrent player commands within declared resource limits. Faster isolated route tests or a smaller average tick are insufficient. No finite router can promise bounded waits under unlimited arrivals. The system must bound admitted demand, preserve paid delivery obligations, expose capacity waits, and demonstrate service exceeding sustained legitimate new-route demand in the accepted workloads.

Future trade changes must pass the same fleet-progress and lifecycle gates. That is the practical way to stop rediscovering these failures; no design can guarantee that arbitrary future behavior changes need no qualification.

## Existing work and conflict audit

The checkout was clean before this document. There is one registered Git worktree and no attached worktree or PR in this chat. The returned chat inventory shows this chat as the only active chat in this checkout; related prior chats are not loaded. The GitHub connector returned no open PRs for `ELDamien3570/AgeOfFronts`. These are point-in-time checks, not a lock on another editor or unpublished work. Repeat them immediately before implementation.

The local branches `Trade-Boats-Update`, `V1.1-`, `1.5.7-10hz-prototype`, `1.2.1-Continued-Optimization`, and `claude/silly-euclid-2e33a4` are ancestors of the current checkout. Their relevant changes are already included; do not replay their patches. Remote-tracking branch tips were not refreshed by a fetch. The old handoff's instruction to start from `v1-phased-ai-optimization` is historical for those tasks, not a reason to replace the current implementation with that older branch.

| Existing work | Current evidence | Treatment |
| --- | --- | --- |
| Transactional trade admission P10 | `Trade.begin`, `load`, `validRoute`, `completedRoute`, `stepPlanning`; `TradeFleet.test.ts` | Preserve inventory transfer only after route readiness and live validation. Extract responsibilities without resetting cargo or identity. |
| Shared preparation and water backbones | `HierarchicalPaths.ts`, `SharedTradeRouting.test.ts`, `2026-10-13-shared-trade-routing-contract.md` | Reuse the existing hierarchy and bounded shared preparation. Do not introduce a second pathfinder or a competing preparation cache. |
| Planner fairness P11 and scheduling v6 | `RoutePlanner.ts`, `PlannerActiveLimits`, `PlannerFairness`, `RoutePlannerInteractiveCaps` | Preserve interactive shares, admission reserves, separate corridor/exact concurrency and checkpointed scheduling versions. |
| Known remaining trade backlog | `docs/perf/NextBatchGates.md`, Next 1 | This plan addresses that open work. The record already describes Migration's queue dominated by trade and leaves water-route service unresolved. |
| Recent parity optimizations | `profile-1h-20261018-optimization-plan.md`; source history `917c768e`, `d5158504`, `6f171885` | Retain verified lookup indexes, memoized effects, shared interception grid, borrowed publication and routing inner-loop improvements. Do not repeat the superseded O(admissions) scan work. |
| AI trade investment | `AiTradeCapacity.ts`, `AiTradeOpportunities.ts`, `AiEconomicDirector.ts` | Keep geometric feasibility for bootstrap and observed completed-cycle evidence for investment. No second set of exact quote searches. |
| Ownership, defeat and publication fixes | `Trade.currentMarkets`, `siteSnapshot`, `TradePublication`, `BlastOwnershipLifecycle`, `CheckpointPurity` | Preserve read-only publication, owner-zero safety, exact loss handling and sparse publication revisions. |
| Port cargo and receiving rules | `Supply.goodsCapacity`, `TradeCargo`, `TradeReceiving`, `Economy.ts` | Preserve refill, storage, stack scaling, intake limits, tariffs and full-load dispatch. |

Read P10, P11, P22, the shared-routing contract, `agent-workflow.md`, `remaining-work-index.md` and `NextBatchGates.md` when implementing. They are cumulative records with some stale descriptions. For example, P22 describes complete multi-leg/return certification before loading; current execution admits one leg at a time. Preserve current source behavior unless a deliberate policy change is approved. The October 13 contract's 102 ticks represented 5.1 seconds at 20 Hz then; current `TICKS_PER_SECOND` is 8, so the same count represents 12.75 seconds. Specify new goals in game seconds and derive ticks.

Use one implementation owner and an isolated `codex/` worktree based on the then-current intended branch. Serialize changes to `Simulation.ts`, `Expansion.ts`, protocol/checkpoint integration and the shared planner. Preserve unrelated art and gameplay work. No branch switch, merge, push or deployment is part of this planning task.

## Current execution and ownership

1. `BuildingIndex` exposes completed owner/type buckets and geometry/producer revisions. `Trade.currentMarkets` groups sources by owner, mode and physical tile, and `refreshMarkets` builds receiver and water-basin views.
2. `Supply` replenishes each completed producer every tick. A port stores an unstacked current ship load; a stacked site's shipment capacity is calculated separately by `TradeCargo`. Ordinary ships require a full shipment.
3. `Trade.spawn` respects world, owner, mode and source caps. Port footprints can touch several disconnected basins; new couriers try alternate basins when the first berth has no useful receiver.
4. `Trade.candidates` filters current permissions and ranks estimated payout versus extra travel. Naval geometry does not avoid enemy vessels. Enemy interaction is local interception/capture, separate from route search.
5. `Trade.begin` admits one loading attempt per source. A successful route is required before `load` consumes goods. Other source couriers wait behind that attempt.
6. `Trade.stepPlanning` cycles actor admissions, shares matching pending corridor geometry, uses a completed-path cache, and submits misses through `DomainRoutePorts` to the single `RoutePlanner`.
7. The planner owns queue slots, search arena, shared preparation, fairness, copying, cancellation and reclamation. `Simulation.drainRoutes` gives it 10,240 work units per tick at the current 8 Hz; trade admission/commit receives 40 work units per tick. Corridor preparation is independently capped at 32 units, or eight for background while interactive work waits. Unused search work does not imply available preparation capacity.
8. Completion validates actor, shipment, controller generation, location and destination permission before attaching the path and loading. Movement follows that path. Arrival transfers actual accepted cargo and pays through the shared payout formula; captured cargo follows its salvage contract.
9. Completed cycles feed AI investment evidence. Snapshot publication reads current state without advancing trade. Checkpoints contain admissions, retry state, completed trade corridors and planner shared state.

### Existing reuse layers

| Layer | Bound and identity | Limitation relevant here |
| --- | --- | --- |
| `TilePaths.find` completed routes | 16,384 entries and 2,000,000 tile slots; synchronous start/goal/cost revision cache | Deferred trade does not call this cache as its completed-route service. Cache warmth also replays logical work to preserve scheduling. Its large size does not mean deferred fleets retain that many lanes. |
| Shared hierarchical preparation | Up to 1,024 canonical local-tree entries per medium, with active pins | Shares local search work and preserves progress through restore; it is not a persistent port-to-port route registry. |
| Shared water backbones | 128 abstract chains, 65,536 portal identifiers, 4,096 identifiers per chain | Reduces abstract search; endpoints still need refinement. Distinct from completed tile routes. |
| `Trade.corridors` | 128 entries shared by land and sea; 65,536 tiles total; rejects paths longer than 4,096 tiles | Insertion-order eviction; reads do not refresh retention. No lifetime reservation for a productive source or ongoing return obligation. |
| Pending trade geometry | Derived each planning tick from actor admissions | Work ownership is tied to a trader's admission. Cancellation/capture can remove the leader's request while others still need the geometry. Test and measure this churn rather than assuming it is harmless. |

At the 60-minute checkpoint there are 878 sea traders, 242 distinct source tiles and only 61 completed sea entries in the shared trade cache. This shows retention pressure, not a measured cache-miss/eviction rate; the detailed miss breakdown belongs in phase 0.

The 21 October audit established that the cache's entry cap is binding while tile storage is mostly unused: the 45/60-minute caches retain 4,278/5,337 tiles total under a 65,536-tile allowance. This does not establish the eviction rate, but rules out presenting that allowance as exhausted. See the implementation specification for distinct shared-path working-set measurements and the initial bounded retention policy.

## Findings and remaining uncertainty

The existing two-minute continuations reproduce the parked ships. At 45 minutes, 466 existing sea traders never move; 411 are loading at sufficiently stocked sources at the end, including 291 behind another source admission. At 60 minutes, the corresponding figures are 521, 406 and 271. Every counted full-stock follower has a leader admission at the same source. A separate 60-second probe records 10,572 sea-trade admission attempts and 346 acceptances, with 119 of 120 pending planner jobs owned by trade at its final snapshot. Retries are not unique requests.

A focused probe finds zero remaining preparation allowance on 58.6% of sea-corridor calls. Most pending jobs have not yet allocated a search. Destination selection alone costs about 0.86 ms per tick, approximately 1.23% of a 69.89 ms instrumented tick. Removing its scoring cannot explain away the route-service backlog.

The proven failure chain is long route-service latency plus source admission blocking, with misleading wait publication. Exact shares attributable to cache eviction, endpoint diversity, leader cancellation, rejected admission polling, and local-tree/backbone misses are not yet measured. The implementation must first establish those shares. Merely raising a cache size or declaring all ships committed would be a speculative fix.

The raw evidence and harnesses are under `out/trade-stall-20261020/`; these ignored local artifacts must be reproducible or archived as durable evidence before being used as a release gate. Historical checkpoint continuations are not fresh-match or live-user-match qualification.

The 20 October focused baseline verification passed **97 tests across five suites**: `TradeFleet`, `SharedTradeRouting`, `PlannerActiveLimits`, `TradeReceiving` and `CheckpointPurity` (157.97 seconds). No source was changed. This confirms the preserved local contracts; it does not qualify sustained fleet service or the proposed architecture. The 21 October document audit did not rerun these production tests.

Audit time units during the affected lifecycle work. For example, the current admission-deadline branch assigns a literal 100 wait ticks, which is 12.5 seconds at 8 Hz. It is not the cause established for the default checkpoint, whose autonomous deadline option is absent, but historical tick constants must not silently become new routing policy.

## Recommended architecture

### Physical port access

Introduce `SeaTradePorts`, using `BuildingIndex`, existing market views and `portWaterTiles`. Separate a physical location and its water access from the current owner, completed stack and receiving state. Resolve building identities afresh at economic commitment; never retain mutable `Building` objects as durable route authority.

Represent each port's reachable basin access explicitly. Select the preferred receiver endpoint in existing footprint-helper order per basin. A route key uses actual start/goal water tiles and water-topology revision; the canonical geometry key orders those endpoint IDs to share reverse views. A ship at an alternate berth uses its actual tile as its start, without a separate normalization move or connector subsystem. Never snap a ship to a berth, teleport it between disconnected basins, or discard another productive basin.

Conquest or a stack upgrade changes economics and eligibility, not the water geometry. Destruction removes the site's economic usability; already referenced pure geometry can remain until its consumers release it. Rebuilding at the same tile requires fresh site identity checks. Establish a safe policy for owner/generation rollover and an explicit full reset when a different world is installed into the same simulation instance.

### Shared shipping lanes

Introduce `SeaTradeRoutes` as the match-owned route registry for civilian sea voyages. It uses the existing `RoutePlanner` and its shared hierarchy. Land trade keeps its current policy/cache; the service does not take ownership of warship or troop movement.

A lane is immutable validated water geometry between access tiles, with directional traversal views, a topology revision, deterministic identifier, request state and dependency references. The specification defines queued, requested, staging, packing, ready and retiring states. Disconnected components reject cheaply; capacity pressure is not geographic failure and the new service needs no negative-route cache. Store packed path tiles once, with private per-trader traversal cursors. The audited current water graph supports reverse views; do not extend that assumption to land or future directional graphs.

At most one in-flight geometry request exists for a lane key. Sources and voyages subscribe independently of the actor selected to consume the next cargo load. Cancelling, capturing or destroying one trader releases only its subscription. It cannot discard useful work belonging to other sources or voyages. Zero-subscriber cleanup is bounded and deterministic.

The planner adapter adds the distinct domain owner `sea-trade` and the typed lane task defined in the specification. Its admission ID names a genuine lane admission, not an actor. `Simulation` delegates that consumer and explicitly excludes it from interactive human work. Map it to the existing `trade` scheduling caller so it gets no extra share. A lane's live geometry and subscriptions validate the search; individual subscribers validate their economics only at commit.

Keep one fair router. Charge a shared lane through an explicit sponsoring faction/caller, with checkpointed service order and a bounded sponsor handoff if that faction disappears. Additional subscribers must not create extra scheduling shares. Preserve the existing human reserves and loaded-cargo priority. Empty returns and productive first departures need observable eventual service; declaring every speculative lane committed is not an acceptable substitute for fairness.

Capture and source loss can leave ships at arbitrary water positions. Those voyages need a bounded point-to-port connector or direct emergency route through the same planner, with the existing cargo priority. Do not force them through a fictitious port node, teleport them onto a lane, or let opportunistic lane warming occupy all recovery capacity.

### Retention and memory

Separate hard active-voyage/pending-demand pins from soft useful-source retention and opportunistic idle routes. Active path references remain valid through arrival or cancellation. A productive source can retain two useful routes softly; under pressure those remain evictable after ordinary idle entries. Otherwise idle source claims could consume the entire budget and deadlock recovery. Use deterministic demand/recency rules rather than insertion age alone.

Bound each resource independently: descriptors, candidate links, logical waiting lanes, accepted planner jobs, active searches, path tile bytes, subscribers and cleanup work. Never precompute all port pairs. A shortlist of four primary nearby candidates plus four bounded fallback candidates per source access is a starting experiment, not an accepted tuning constant. Advance discovery incrementally so a busy local group cannot permanently hide a viable farther destination.

The specification fixes initial bounds of 16,384 lane records and 32 MiB packed path payload, with separate staging, recovery, subscription and per-tick limits. These are implementable starting defaults supported by sampled working-set sizing, not maximum-roster certification. Phase 0 validates those defaults against the full intended workload before integration. There must be no unbounded pin set and no silent eviction of a path still used by a ship. If the required active set would exceed the budget, delay new unpaid departures explicitly and continue paid voyages. A representation/capacity failure is never geographic unreachable and blocks acceptance if a supported workload needs that route.

Prefer immutable shared packed paths first. Segment/backbone references should be added only if measured route duplication or payload size prevents the target working set fitting. Reuse the existing hierarchy rather than creating another compressed navigation graph by default. Count metadata, retained trees, legacy actor paths, checkpoint bytes and peak restore/cloning memory as well as packed tile payload.

### Destination policy

Keep one cheap eligibility rule: completed living foreign port, reachable from the ship's actual basin, normal trade permission, mode enabled, not already visited during this shipment, and below the existing stop limit. Preserve the return-home and captured-cargo exceptions.

Build nearby candidate links per port access with bounded spatial/basin discovery. A geometric distance is a shortlist estimate, not proof of a short sea voyage around a peninsula. Use known lane length when available. Among nearby viable ready lanes, prefer allied ports; select deterministically within that group using a rotating/stable fairness cursor so all ships do not continually chase the same refilling receiver. Use a ready neutral lane rather than waiting indefinitely for an unbuilt allied lane. Only start bounded route discovery when the ready set cannot serve the voyage. No profitability/risk search or exact search over all ports.

Use live receiving availability as a cheap filter, not a reservation or a reason to invalidate geometry. Intake changes while a ship sails, so actual delivery remains authoritative at arrival. A zero-intake visit consumes no goods and pays nothing. Bound continuation: choose another unvisited eligible stop or return with the remainder. When all nearby receivers are temporarily full, expose a market-intake wait or return outcome; do not misreport geographic failure or spin between zero-value ports.

Preserve the current no-repeat-per-physical-location rule and eight-stop limit by default. Excluding only the previous stop allows A to B to C to A circuits, which changes economics and itinerary length. That is unnecessary for route reuse and requires a separate owner decision. Do not silently implement it as a performance optimization.

This simpler policy intentionally changes destination selection and can change voyage income. Payout formulas, tariffs, intake, storage and refill stay unchanged. Old-versus-new world hash equality is therefore not the acceptance condition for this phase; accounting, deterministic execution, useful throughput and economy measurements are.

### Cargo transactions and return obligations

`Trade` remains the sole authority for source stock, loaded quantity, shipment identity, visited locations, delivery payment, capture/loss and retirement. A source dispatch record owns the next unpaid load transaction; it asks for a ready lane without making any particular empty trader the lifetime owner of that lane. Commit rechecks the current source, research capacity, stock, destination, permissions, actual departure tile and controller generation. A shared path never authorizes two consumers to spend the same stock.

Preserve finishing an already accepted sea leg when war starts, while blocking new enemy voyages. Pauses and trade blocks stop future normal departures according to the existing contract; they do not erase loaded cargo or pirate salvage obligations. Source loss converts a loaded courier to the existing owned-receiver salvage path. Recapture, receiver destruction, blast and faction defeat must release the right references and pay or lose cargo exactly once.

Treat empty returns as fleet recovery work rather than economically meaningless speculation. Avoid new per-tick route submissions for unchanged requests. Capacity refusal should retain lane identity, age and progress, and retry on a deterministic bounded schedule or capacity notification. A blocked source can use an already-ready alternate eligible lane; it should not throw away the first lane's useful shared preparation to try every candidate again.

For new-mode normal returns, first use a ready direct home lane; otherwise reverse the retained outward trail with no new search. An interrupted current leg returns along its travelled prefix before reversing completed legs. Intermediate ports are geometry waypoints only, with no sale, tariff, intake or handling. Capture/source loss releases the old trail and retains current-position salvage as a separate recovery request. The specification defines the private cursor/span arithmetic and legacy-voyage exception for converted fixtures.

### Invalidation and dependencies

| Change | Physical water lane | Voyage and eligibility |
| --- | --- | --- |
| Alliance, war, embargo, pause | Retain | Recheck the affected pair/next commitment; preserve the existing accepted-leg rule. |
| Port owner changes | Retain if endpoints remain physical water | Rebind site/receiver identity; revalidate source spending and destination owner. |
| Port destroyed or rebuilt | Retain pure geometry only while useful/referenced | Invalidate the site incarnation, choose another owned receiver for salvage, forbid stale payout. |
| Stack, age, cargo research, vessel speed | Retain | Recompute capacity, intake and handling facts at their current authoritative boundaries. |
| Receiver intake changes | Retain | Update selection/arrival quantity; no route search. |
| Ship capture, sinking or blast | Retain for remaining subscribers | Release the affected voyage; preserve exact loss/salvage accounting. |
| Controller transfer or faction elimination | Retain geometry | Release/rebind owner-specific dispatch and sponsorship; preserve valid paid obligations. |
| Actual water topology/cost revision | Invalidate affected geometry or the medium epoch | Revalidate/replan under bounded work; no stale route attachment. |
| Restore to the same or a different world | Restore canonical lane work and order, reset derived indexes | Validate all identities, references and option/schema compatibility. |

Use the current `BuildingIndex` and lifecycle infrastructure; do not add a parallel world event bus. The bus does not currently expose every readiness/research change, so state which events versus revision checks maintain each index. A global building geometry revision should not flush all physical sea lanes. Current water passability is immutable; support its explicit epoch without claiming that arbitrary dynamic terrain is already supported by the engine.

### Persistence and publication

Route readiness changes launch timing, so the lane registry, progress, eviction order, scheduler references and selection cursors are canonical state. Persist them explicitly. Physical cache warmth, wall-clock time, object identity and hash-map reconstruction must not grant extra logical progress after restore. Validate caps, route steps, node ownership, endpoint references, subscriptions and counters before allowing the match to continue.

Add optional `seaTradeRouting: "lanes-v1"` to match options and a version-1 sea sub-checkpoint under trade. Keep top-level checkpoint version 11 for this additive opted-in extension; option omission retains the old shape and behavior. A new-mode checkpoint must contain its valid sea sub-checkpoint. Do not silently flip legacy matches on restore. Use the explicit offline fixture converter, whose imported incomplete voyage histories retain direct-return behavior until their next new-mode load. Audit strict options equality, `StateCodec`, deltas and multiplayer recovery; unknown versions reject.

Keep route tables and traversal cursors in the private trade sidecar, rather than adding them to `TradeActor`. Both borrowed `TraderStream` serialization and ordinary `Expansion.snapshot` enumerate actor fields, so adding route references there risks a wire leak. Test both projections explicitly. Every visible detail change still calls `tradeDetailsChanged`; join, sparse delta and reconnect must show the same wait state as a full snapshot. `siteSnapshot` remains read-only.

Expose cargo refill, shared-route wait, planner admission, active search, receiving-intake wait, handling and genuinely unavailable receiver as distinct internal causes. Reuse current public wait labels where accurate; any new public label needs deliberate protocol/UI validation updates. Store wait start once rather than incrementing a public detail revision each tick just to display age. Diagnostics must distinguish followers of one lane from distinct queued searches.

### AI integration

Continue geometric feasibility checks for first productive infrastructure; do not require completed voyages before the AI can bootstrap trade. `AiTradeOpportunities` should continue consuming completed actual cycles. Expose cheap ready-lane and route-capacity facts so a queue-bound full port is not diagnosed as a cargo-production shortage. Distinguish supply wait, route wait, handling, travel and receiving wait in observed cycles; a slower routing queue must not spuriously justify more sources or ships.

Keep shared `TradeCargo`, `tradePayout` and `TradeReceiving` authority. P22's richer risk quote is not a reason to reintroduce expensive route scoring. Retain useful AI evidence fields for existing consumers and remove dead quote entry points only after a repository-wide caller audit. Leave land investment policy untouched.

## Implementation sequence

Each phase ends with a coherent tested slice and recorded evidence. Do not combine policy change, persistence migration and global scheduling changes in an unreviewable rewrite.

| Phase | Work and ownership | Exit gate |
| --- | --- | --- |
| 0 Baseline and regression | Add bounded route-lifecycle telemetry and a reproducible full-port stall fixture. Identify cache hits/evictions by medium, lane uniqueness, leader churn, admission retries, preparation reuse, return demand and wait-time percentiles. Freeze current workload/options and establish memory targets. | One test fails on current code for a correctly classified fleet-progress failure. Telemetry and fixture generation do not change canonical state. |
| 1 Port and policy boundaries | Extract port access, current site lookup and pure sea eligibility behind narrow interfaces. Retain current selection and actor paths. Document all writers/readers. | Existing gameplay, publications and checkpoint continuation retain parity; multi-basin and ownership cases pass. |
| 2 Shared lane service | Introduce typed lane requests, canonical bounded state, single in-flight ownership, stable subscriptions, byte accounting and deterministic retention. Initially keep current destination preference. Adapt the existing planner through a serialized integration patch. | Cancellation of any subscriber preserves other progress; repeated lanes create no new search; no interference with land/warship/human routing; cold restore matches uninterrupted new-mode execution. |
| 3 Dispatch and return integration | Let source dispatch and voyages acquire ready lanes, attach immutable paths/cursors, share returns safely and back off unchanged capacity refusals. Correct wait publication. | Full stocked productive sources launch after lanes are ready; returns/captured cargo progress; all conservation and sparse-publication tests pass. |
| 4 Cheap destination selection | Implement nearby reusable routes with allied preference and bounded fallback discovery. Retain no-repeat/full-load/stop-limit rules unless separately approved. Update AI evidence for the simpler policy. | Deterministic policy reference agrees; no zero-intake loops; report income, voyage lengths, useful ports and source investments rather than asserting old-world parity. |
| 5 Sustained qualification | Run mature checkpoint continuations, fresh full matches, topology fixtures, lifecycle churn, real browser publication/reconnect and the existing human-load routing gates. Tune only the resource shown to be limiting. | All correctness and target workload gates pass with stable retained memory and no growing routing backlog. |
| 6 Integration and release readiness | Recheck concurrent work, isolate scope, update current contracts and link exact evidence. Remove superseded sea-only cache/admission code once no consumer remains. Preserve existing land cache. | Focused/full checks, TypeScript, builds, scoped lint and review pass. Deployment remains a separately authorized operation. |

If phases 2 and 3 meet the fleet target without a global scheduler change, keep scheduling v6. If service is still deficient, make a separately measured scheduler slice, preserving legacy versions and human shares. Do not increase work, preparation, arena and cache limits together; that hides the cause and prevents a useful rollback.

## Verification matrix

### Deterministic correctness

Extend the existing tests rather than replacing them. Relevant baselines include `TradeFleet`, `SharedTradeRouting`, `TradeReceiving`, `TradeAccess`, `PortCargoStorage`, `PlannerFairness`, `PlannerActiveLimits`, `RoutePlannerInteractiveCaps`, `RoutePlannerSinglePass`, `AiTradeCapacity`, `BlastOwnershipLifecycle`, `CheckpointPurity`, `SimulationCheckpoint`, `StateDelta` and `TraderStream`.

Add independent checks for:

- Water walkability and cardinal adjacency of every committed route, exact starting/arrival convention, connector continuity and direction reversal. Compare selected small maps to an independent flood-fill/path reference.
- One geometry search for many actors/owners; leader cancellation/capture/controller transfer at every phase; different owners independently commit cargo; no sponsor obtains multiple fairness shares.
- Active paths survive idle eviction, one-off demand cannot evict every productive lane, working sets larger than the idle cache produce explicit bounded behavior, and retained state returns to baseline after repeated port churn.
- Restore during queued, preparing, copying, ready, loading, sailing, arriving, returning and salvage states; portable encoding; repeated restore into one instance; wrong-map/malformed/oversized/reference-cycle rejection.
- Multi-basin footprints, disconnected ponds, narrow channels, long legal routes, shoreline edges, port stacks, capture/rebuild at the same tile, owner zero, eliminated partners and no owned salvage receiver.
- Full-load/refill exactness, research changes before loading, partial delivery, receiver saturation, tariff exactness, returned cargo, re-capture and simultaneous blast cleanup. Per shipment, loaded goods must reconcile to delivered, returned, lost and remaining cargo, with capture represented as a transfer rather than new goods.
- Allied preference only in the eligible nearby ready set, neutral fallback, deterministic tie breaking, rotating receiver demand, no repeated physical market per shipment and no endless no-sale cycle.
- Every public waiting-state mutation reaches both full and sparse snapshots, with publication purity and reconnect state agreement. Route arrays/references never appear in trader wire records.
- Route congestion does not trigger false source-refill or infrastructure demand. First productive port bootstrap still works before any completed cycle.

### Workloads and metrics

Use the existing 45- and 60-minute seed `1606492585` Migration checkpoints for reproducible comparisons; extend the measured windows to at least ten game minutes once the new service is active. They are regression fixtures, not sufficient fresh-policy qualification. Run serially on a quiet host for timings. Preserve seeds/options and keep instrumented versus uninstrumented results separate.

Run at least three fresh Migration 1000 seeds through 90 game minutes or legitimate match termination, capturing opening, 15, 30, 45, 60 and later checkpoints. Include the current 14 AI/30 tribe configuration and a separate mixed-player workload with genuine command traffic. Cover supported 250/500/1000 worlds, a different map with different coast geometry, cold open water, islands, a narrow channel and disconnected basins. Retain the existing 120-route/37-faction fixture, but do not confuse its initial burst with a growing closed-loop economy.

Record per-source distributions, not just world totals: full-stock time waiting for route, first launch, longest ready-lane delay, departure/arrival/completed-cycle counts, empty returns, stranded paid cargo, receiver-intake waits, cache hits/evictions, unique searches, queue acceptance, work by preparation/search/copy/cleanup, human order latency, retained bytes and checkpoint peak size. Track arrivals versus completions over rolling windows to detect an accumulating backlog. Save representative raw source/actor records for every outlier.

### Proposed acceptance gates

These are targets to be calibrated in phase 0, not achieved measurements. Do not weaken a missed target after implementation without explaining the capacity/design change.

| Area | Proposed gate |
| --- | --- |
| Ready lane | An otherwise eligible fully stocked source gets its next departure within one game second after handling and deterministic dispatch turn; no new search or planner queue entry for an unchanged ready lane. |
| Warm stable network | At least 95% ready-lane reuse for recurring eligible port pairs after an explicitly defined warm-up; zero recomputation for a retained valid pair. Report fallback legs separately. |
| Cold lane service | For the declared mixed-load target, p95 acquisition within five game seconds and p99 within fifteen; no supported finite-demand lane remains without service indefinitely. Measure admission-to-ready and first-demand-to-ready separately. |
| Fleet progress | Zero two-minute stationary ships whose only blocker is an already-ready usable lane. No growing full-port route backlog during the final ten minutes of accepted fresh runs. Legitimate cargo/intake/permission/receiver waits are separately counted. |
| Human control | Existing interactive share and receipt correctness preserved; the historical unmet human-latency gate is reported as such. No p95 human route-latency regression in the same paired workload. |
| Work and memory | Every specified deterministic cap asserted; no synchronous all-pairs route construction, uncharged path cloning, unbounded eviction pass, or active-path eviction. Retained state plateaus under fixed demand and returns after churn. Validate the specification's initial byte/count budgets in phase 0. |
| Correctness | Zero cargo or payment discrepancy; no stale commitment; exact uninterrupted-versus-restored results for the same new policy and scheduling version. |
| CPU | No statistically meaningful regression in paired total simulation or human routing cost. Target lower routing cost while increasing completed useful voyages; report p95/p99 and GC, not only means. |

Full simulation target-hardware pace remains a separate qualification: a trade optimization cannot certify unrelated combat/movement capacity. Validate the actual hosting paths in use, including creator-hosted private matches and server-hosted execution where applicable. Use actual rendered clients for UI/reconnect claims. ARM acceptance requires measurements on the target host; local x64 results do not certify it. Avoid live overload traffic and do not restart or deploy as part of qualification without separate authorization.

For parity-only phases, use `scripts/fixtureParityPair.ts` to compare every publication and periodic full checkpoints. For deliberate policy/schema changes, compare domain invariants, reference-policy results and same-version restore determinism, with old-versus-new economy/throughput reported explicitly. A byte/hash mismatch caused by a new canonical lane table is expected and must not be hidden by deleting fields from evidence.

## Decisions before implementation

| Decision | Recommended position | Status |
| --- | --- | --- |
| Allied preference | Allies among nearby reusable routes; ready neutral fallback | Confirmed by owner in this chat. |
| Routing authority | Existing shared planner and hierarchy; match-owned civilian sea lanes | Requested route reuse; architecture recommendation. |
| Repeat visits | Keep no-repeat-per-shipment and eight-stop limit | Recommendation; do not silently substitute previous-stop-only behavior. |
| Economic rules | Preserve prices, tariffs, receiving, refill, caps, piracy and accepted-leg policy | Scope boundary; any requested change gets separate economy acceptance. |
| Nearby range and candidate count | Four nearby plus four exploration candidates; near threshold `max(shortest + 16, ceil(1.5 * shortest))`; ready allies within that set | Specified initial policy; qualify coverage and economy effects. |
| Retained bytes and active working set | 16,384 records, 32 MiB packed paths, separate staging/recovery/work limits | Specified initial bounds; phase 0 validates supported working-set fit. |
| Old checkpoints | Omission preserves legacy; opted-in version-1 substate; explicit offline conversion | Specified compatibility policy. |
| Normal return | Ready direct home route, otherwise reverse retained voyage; direct legacy return for imported old shipments | Confirmed by owner on 21 October; fully specified. |
| Deployment | Separate release authorization after evidence | Outside this planning task. |

## Deliverables

Implementation should produce the narrow sea-route modules and planner adapter, updated lifecycle/checkpoint/wire boundaries, durable regression fixtures, a single reproducible fleet qualification harness, exact comparison evidence and an updated shared-routing contract. Reconcile the stale P10/P22 and historical timing descriptions with links to the new contract rather than rewriting their historical results. Record which existing gates remain unpassed. Leave one owner and one executable acceptance checklist for future changes to trade.

The first implementation action is T00–T01 in the detailed specification: verify concurrent work and establish the regression/measurement baseline. Initial algorithms and resource defaults are now concrete; their acceptance still depends on fleet, memory, restore and player-control evidence. Do not treat this planning pass as proof that unimplemented code meets those targets.
