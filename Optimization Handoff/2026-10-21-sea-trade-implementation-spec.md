# Sea trade routing implementation specification

Revision 1, 21 October 2026. Applies to source `ea9514b1` on `Private-Matches`. This is an implementation contract, not implemented functionality or performance certification. Read it with [the architecture and qualification plan](2026-10-20-sea-trade-routing-plan.md). When the earlier plan leaves an implementation choice open, this specification supplies the initial choice. Measured acceptance gates still control whether that choice ships.

## 1 Scope and audit corrections

Implement one new optional sea-trade behavior, `seaTradeRouting: "lanes-v1"`, using the existing planner. Absence means current behavior, including direct-construction tests and legacy saves. Never change the behavior of an existing match by interpreting omission as the new default. Only enable the option for new normal matches after the qualification gates pass. Land trade, military navigation, cargo quantities, full-load rules, eight-stop/no-repeat rules, tariffs and capture permissions keep their existing authority.

Confirmed owner instruction: prefer allies among nearby reusable routes. Preserve no-repeat-per-shipment as the implementation baseline. The separately discussed previous-stop-only rule is not part of this implementation.

The adversarial audit identified these details the implementer must not infer:

| Detail | Source observation | Required treatment |
| --- | --- | --- |
| Existing cache pressure | The 45/60-minute trade caches retain 4,278/5,337 tiles total while holding 128 entries. Sea tiles are 2,536/4,268. The 65,536-tile allowance is mostly unused. | Entry count and working-set retention are separate limits. Do not present memory exhaustion as the measured cause. |
| Ready paths outside the cache | The sea actors retain 171,212/150,843 path tiles across 707/636 nonempty arrays, including consumed paths. Distinct contents total 125,111/108,749 tiles. | Clear a completed leg's binding and share retained geometry. Do not count all nonempty actor paths as currently moving voyages. |
| Human classification | `Simulation.interactiveRoute` currently excludes only domain owners `trade` and `strategy`. | The new domain owner must also be excluded or human-owned civilian lanes accidentally receive interactive priority. |
| Domain task fields | `DomainRoutePorts` has actor-shaped callers but generic admission IDs. | Add a distinct `sea-trade` owner with a typed lane admission. Never pass a lane ID to legacy `Trade.routeCommitted` or actor validity. |
| Restore order | `Expansion.restore` restores trade before `Skirmish.installCheckpoint` restores the planner. | Restore sidecar records without submitting/cancelling jobs. Cross-check lane/job references after planner restore. |
| Network projection | Both borrowed trader encoding and ordinary `Expansion.snapshot` enumerate actor fields. | Store lane IDs/cursors in a private sidecar, not on `TradeActor`. Test both projections. |
| Work units | The shared planner has 10,240 search units/tick at 8 Hz, but only 32 corridor preparation units. | Preserve those budgets in the first implementation. New management/copy work gets explicit separately counted allowances. |
| Published planner output | `RoutePlanner` outputs include the starting tile, including shortcut, hierarchy and exact-search paths. | The new lane representation is inclusive of both endpoints. Never guess whether the first step was omitted. |
| Water symmetry | `PathTopology` uses cardinal water steps with constant cost 10 and no naval blocked predicate. | Reverse views are legal in this mode. Assert the restriction; do not generalize reverse reuse to land/military graphs. |
| Apparent dead APIs | Repository searches find no production callers of `seaQuote`, `observedRouteRisk` or `loadingPortFor`; `hasForeignMarket` has a test caller. | Do not introduce another quote-search pipeline. Removal is optional and requires the final caller audit; it is not prerequisite cleanup. |

The measurements above are direct reads of the saved checkpoints, not new live-match captures. Maximum observed saved sea-leg length is 1,141 tiles at minute 45 and 1,112 at minute 60; p95 is 736/719. These sizes justify starting with ordinary packed shared paths rather than inventing another navigation graph.

## 2 File ownership and change map

Create these production files:

| File under `src/skirmish/` | Responsibility |
| --- | --- |
| `domain/SeaTradeTypes.ts` | Serialized records, result unions, work statistics and constants. No world mutation or cross-module singleton. |
| `domain/SeaTradePorts.ts` | Physical port access and incremental nearby discovery from current building facts. No inventory, money or path searches. |
| `domain/SeaTradeRoutes.ts` | One canonical lane per geometry key, subscribers, planner adapter, packing, retention and checkpoint state. No inventory or money. |
| `domain/SeaTradePolicy.ts` | Pure selection over a supplied bounded list of current candidates. No world scan, sort of a basin, path search or mutation. |

Modify these existing boundaries narrowly:

| Existing file | Exact integration |
| --- | --- |
| `Protocol.ts` | Add the optional match option only. No lane data on trader DTOs. |
| `domain/Expansion.ts` | Add the option to its world-options structural type; pass it through the existing world. Keep construction/checkpoint ownership inside `Trade`. |
| `domain/DomainRoutePorts.ts` | Add `sea-trade` to the owner union; export the lane task type and guard. Preserve old owner keys byte for byte. |
| `Simulation.ts` | Route the new consumer; classify it as background/trade; handle its deadline, corridor and commitment callbacks; run post-restore cross-validation. Preserve task ordering and budgets for legacy matches. |
| `domain/Trade.ts` | Branch sea-only admission/movement to the new service in new mode; own sidecar voyage/dispatch transactions; reuse existing load, arrival, capture and loss accounting through factored helpers. |
| `domain/Definitions.ts`, `client/EmpireView.ts` | Add the explicitly public optional wait detail described in section 14 and its display text; no route IDs or cursors on actors. |
| `domain/AiTradeOpportunities.ts`, `AiTradeCapacity.ts` | Consume separated observed route/supply waits; keep bootstrap geometry and existing shared payout rules. No new exact quote searches. |
| `multiplayer/application/LobbyMatchOptions.ts`, `client/main.ts` | Enable the option at the end of qualification for new server-hosted and local/creator-hosted matches. Audit both current `armyTravel` construction sites in `main.ts`. |
| `TraderStream.ts`, `domain/Expansion.ts` projection | Validate the new optional public wait detail and test both projections. Private route state remains exclusively in the sidecar. |
| Existing test/harness files | Retain old-mode coverage, add new-mode coverage and fleet qualification. |

Do not modify `RoutePlanner`, `HierarchicalPaths` or `PathTopology` algorithms in the first lane-service patch. The integration uses their public existing contracts. A measured scheduler defect gets a separate patch and evidence. Do not edit unrelated combat, formation or production behavior.

## 3 Behavior option and construction

Add `seaTradeRouting?: "lanes-v1"` to `MatchOptions` and the structural `ExpansionWorld.options` type. Define `usesSeaLanes = world.options?.seaTradeRouting === "lanes-v1"` once at construction. Reject this combination unless `ruleset === "ages-v1"` and `deferredPlanning === true`; do not silently fall back to synchronous routing. Omission remains supported with the exact old branch.

Construct port/router sidecars inside `Trade` after its existing dependencies are available. `Simulation` already constructs the shared planner before `Expansion`; the service must not acquire a route in its constructor. Resolve `world.domainRoutes` only while stepping. Add a `Trade.seaRouteConsumer` getter returning the service only in new mode.

Keep the top-level checkpoint envelope at version 11 for this additive, explicitly opted-in extension. Add a versioned optional `seaTrade` member only to `Trade.checkpoint`. Old mode must omit that member entirely, preserving old object shape and key order. A new-mode checkpoint without it is malformed. A legacy checkpoint must not be loaded with new-mode options; existing strict options equality enforces that. Unknown option values or sea subversions must fail validation.

## 4 Geometry and port identity

All tile IDs are finite safe integers in `[0, width * height)`. `WaterPaths.walkable` and `component[tile] > 0` are the geometry authorities. Port economic sites remain grouped by `(playerId, physical tile)` as today; use the smallest live completed building ID as the representative and sort constituent IDs numerically. Do not merge two owners' stacks into one source inventory.

The port index groups all berth tiles returned by `portWaterTiles` by water component. Preserve that helper's enumeration order. The preferred endpoint for a component is its first walkable returned tile. Cache this physical endpoint list by physical tile; it is independent of owner, stack, research and diplomacy. A descriptor contains numeric building IDs and tile IDs only, never a persistent `Building` reference.

Port access records and their IDs:

```ts
type SiteKey = string; // `${owner}:${portTile}`
interface PortAccess {
  portTile: number;
  component: number;
  berth: number;
  // Other legal footprint berths in helper order; topology-only derived data.
  berths: readonly number[];
}
interface PortSiteView {
  key: SiteKey;
  owner: number;
  tile: number;
  representativeId: number;
  buildingIds: readonly number[];
  accesses: readonly PortAccess[];
}
```

Do not normalize a live ship's position by moving it to `berth`. For an actor, the lane's start is always the actual tile containing its current fixed-point position. The destination is the selected receiver's preferred endpoint in that actor's component. This directly handles an old/alternate berth without a separate teleport or hidden connector. A captured ship in open water uses the same actual-tile rule.

Newly spawned ships preserve the current alternate-basin procedure: try the historical preferred basin first, then other footprint basins in helper order. Select the first basin with an economically eligible foreign port; route existence still goes through the bounded service. An already spawned actor never changes basins without physical traversability. `SeaTradePorts` must not use component zero as a valid key.

Revalidate source/receiver current ownership, completeness, health and representative ID when committing or delivering. The route itself does not depend on those IDs. Removing one stack member does not invalidate an unchanged physical lane. Rebuilding a receiver at the same tile must not make a stale building ID payable; ordinary arrival resolves the current intended building and applies the existing retarget/return rule.

## 5 Canonical records

Do not add these fields to `TradeActor`. Store them in `Trade.seaTrade` state keyed by actor/source/lane ID. All persisted unions must use explicit discriminants; no `any`, object-reference identity or inferred state from an absent field.

```ts
type LaneId = number; // monotonically increasing, never reused in a match
type LaneState = "queued" | "requested" | "staging" | "packing" | "ready" | "retiring";
type DemandKind = "departure" | "continuation" | "return" | "salvage";
interface LaneKey {
  revision: number;
  lo: number; // min(actual start, actual goal)
  hi: number; // max(actual start, actual goal)
}
interface LaneBase {
  id: LaneId;
  key: LaneKey;
  epoch: number;              // request-attempt fence
  firstDemandTick: number;   // retained across refusals/limited retries
  nextAttemptTick: number;
  attempts: number;
  sponsorId: number;          // fixed for each accepted request attempt
  lastUseTick: number;        // actual successful acquisition, not polling
  references: number;         // HARD voyage/pending-demand pins only
}
type LaneRecord = LaneBase & (
  | { state: "queued" }
  | { state: "requested"; requestedKey: string }
  | { state: "staging"; input: number[] }
  | { state: "packing";
      packing: { input: number[]; output: Int32Array; offset: number } }
  | { state: "ready"; tiles: Int32Array }
  | { state: "retiring"; requestedKey: string }
);
interface LaneUse {
  laneId: LaneId;
  reverse: boolean; // true if required start is key.hi rather than key.lo
}
interface LegCursor extends LaneUse {
  next: number;     // next logical inclusive path index, independent of direction
  end: number;      // inclusive last logical index; supports a partial-leg return
  goalTile: number;
}
interface SeaVoyage {
  actorId: number;
  shipmentId: number;
  currentPortTile?: number; // source or last completed foreign arrival, not origin
  leg?: LegCursor;
  pending?: { laneId?: LaneId; kind: DemandKind; receiverId: number;
    startTile: number; goalTile: number; owner: number; shipmentId: number;
    requestTick: number };
  trail: LaneUse[]; // completed outward legs, at most eight; each owns a pin
  returnSpans?: LegCursor[]; // at most nine, including a partial active leg
  returnSpanIndex?: number;
  wait?: { cause: SeaWait; since: number };
  loadingWaits: { route: number; intake: number; handling: number };
  tripWaits: { route: number; intake: number; handling: number };
  preLoadWaitTicks: number; // loading route/intake/handling, excluding supply
  legacyVoyage: boolean;  // true only for imported old mid-trip fixture actors
}
interface SourceDispatch {
  key: SiteKey;
  chosenActorId: number;
  receiverId: number;
  startTile: number;
  laneId?: LaneId; // absent while even logical record capacity is unavailable
  goalTile: number;
  requestedTick: number;
}
type SeaWait = "cargo" | "shared-lane" | "admission" | "search"
  | "packing" | "memory" | "market-intake" | "no-market"
  | "no-owned-receiver" | "handling";
```

Serialize a lane key as `water:${revision}:${lo}:${hi}`. Its scope is the owning simulation instance; never put lane tables in a module-global cache. Reversible geometry gives one record for A-to-B and B-to-A. A same-tile path is `[tile]` and is never an empty array. Path lengths, order and cursor state are canonical. `lastUseTick`, eviction order, retry order and IDs are canonical because they affect future acquisition.

Serialize subscriptions in a separate bounded table, not nested repeated lane objects. A subscription is `(id, actorId or sourceKey, laneId, ownerId, kind)`. One subscriber owns one count; replacing/cancelling a subscription must first release its old count. Keep subscriptions in ID order and maintain per-lane indexes derived from that table. Restore recomputes reference counts and rejects discrepancies; never trust a saved positive count with no subscriber.

The complete sub-checkpoint includes `version: 1`, `waterRevision`, `nextLaneId`, `nextSubscriptionId`, lane rows, subscription rows, voyage rows, dispatch rows, policy cursors, pending discovery continuations, source-retention rows and service round-robin cursors. Use arrays of `[key, value]` for maps with intentional order. IDs and ticks must be nonnegative safe integers; next IDs must exceed all retained IDs. Runtime telemetry and scratch indexes are excluded.

Use the following concrete serialization layout. `PolicyKey` is `${merchantOwner}:${departurePortTile}:${component}`; it is distinct from the inventory `SiteKey`. A retained source access uses `${sourceOwner}:${sourceTile}:${component}`.

```ts
type PolicyKey = string;
type Holder =
  | { type: "source-demand"; sourceKey: SiteKey }
  | { type: "actor-demand"; actorId: number; shipmentId: number }
  | { type: "actor-leg"; actorId: number; shipmentId: number }
  | { type: "actor-trail"; actorId: number; shipmentId: number; trailIndex: number };
interface Subscription {
  id: number;
  key: string; // stable subscriber key, e.g. `actor:42:shipment:7:leg`
  laneId: LaneId;
  owner: number;
  kind: DemandKind;
  holder: Holder;
}
interface Candidate {
  portTile: number; receiverId: number; owner: number;
  berth: number; distanceSquared: number;
}
interface PolicyView {
  key: PolicyKey;
  owner: number; departurePortTile: number; component: number;
  catalogVersion: number;
  scanAfterReceiverId?: number;
  passUpperId?: number; // frozen highest ID in the catalog when this pass began
  explorationStart: number;
  nearest: Candidate[];     // <= 4
  exploration: Candidate[]; // <= 4
  lastCommittedPortTile?: number;
  passComplete: boolean;
}
interface CatalogBuild {
  inputIds: number[]; // captured coherent market membership; one ID per owner/tile
  gathered: number;
  a: Int32Array;
  b: Int32Array;
  width: number; block: number; left: number; right: number; write: number;
  stage: "gather" | "merge";
  followupDirty: boolean;
}
interface BasinCatalog {
  component: number;
  version: number;
  receiverIds: Int32Array;
  build?: CatalogBuild;
}
interface SeaTradeCheckpoint {
  version: 1;
  waterRevision: number;
  nextLaneId: number;
  nextSubscriptionId: number;
  lanes: LaneRecord[];
  subscriptions: Subscription[];
  voyages: [number, SeaVoyage][];
  dispatches: [SiteKey, SourceDispatch][];
  sourceRetention: [string, LaneId[]][]; // <= 2 soft claims each
  policies: [PolicyKey, PolicyView][];
  catalogs: [number, BasinCatalog][];
  order: {
    packing: LaneId[];
    memory: LaneId[];
    retiring: LaneId[];
    policies: PolicyKey[];
    catalogs: number[];
  };
  cursors: {
    mixedTurn: 0 | 1;
    recoveryTurn: number; // 0..3, three recovery then one unpaid turn
    lastRecoveryOwner: number;
    lastDepartureOwner: number;
    packing: number;
    policy: number;
    catalog: number;
    maintenanceTurn: number;
  };
}
```

Each subscription holder is the single authority for one hard reference. Transferring an active leg to the trail changes that holder/key without releasing/reacquiring the lane. `returnSpans` refer to those retained holders; they do not create duplicate subscriptions. A ready direct return replaces the old trail holders with one active-leg holder atomically after its reference is secured.

For catalog sorting, implement bottom-up merge sort over the two captured ID buffers, preserving `width/block/left/right/write` across turns. One ID read/comparison or output move consumes a discovery unit; do not sort an entire basin synchronously. When `width >= count`, the final buffer is the coherent sorted output. Initial partial catalog publication uses only a completed sorted prefix/chunk with an explicit version; never expose half-written merge output. Normalize completed builds to `build: undefined` and release their other scratch buffer. Additional market churn sets `followupDirty` and cannot reset the older build's cursor.

Array order in `order` is canonical; runtime position maps are derived. Remove an inactive policy/catalog order entry by deterministic swap-with-last and clamp/adjust its cursor, rather than retaining unlimited tombstones. The next uninterrupted and restored visits must agree. FIFO work queues use bounded ring buffers, not O(N) array shifts; serialize their logical remaining order and reconstruct equivalent head/tail positions. Delayed submissions and eviction heaps are reconstructed from lane state and total comparator keys; do not serialize redundant heap implementation arrays. Every lane in an explicit order list occurs exactly once in its matching state, and no ready lane remains in a packing/memory queue.

An actor/source demand exists before a lane can be allocated. Its optional `laneId` and retained `requestTick` allow a record-capacity wait without losing the request age. Allocate no subscription row until a real lane exists. When capacity becomes available, initialize lane age from that demand's original `requestTick`, not the retry tick. Changing target geometry creates a new geometry-demand age but does not reset the actor/source's overall continuous route wait.

## 6 Initial limits and their status

Place the following explicit initial defaults in `SeaTradeTypes.ts`. They are implementation starting bounds, not claims of maximum-roster qualification. Phase 0 may replace a value only with recorded working-set and transport evidence before integrating the affected slice. Do not silently tune them during a benchmark.

| Resource | Initial bound or rule |
| --- | --- |
| Logical lane records, including queued/retiring | 16,384 |
| Ready/packing lane records | Same record cap; path storage is additionally byte-limited |
| Packed path payload, including packing output | 8,388,608 `Int32` cells, 32 MiB |
| Unpacked completion staging | 2,097,152 number-array elements total; account as at least 16 MiB logical JS payload separately from packed storage |
| Single retained path | At most `width * height` tiles; a larger planner output is capacity/representation failure, never geographic unreachable |
| Recovery storage reserve | Last 2,097,152 packed cells and 2,048 records unavailable to new unpaid departure/continuation discovery; paid continuation, return and salvage may use them |
| Active use | One active leg per actor; actor sidecars bounded by actual live trader pool |
| Pending economic demand | At most one pending demand per actor and one dispatch per source with an idle ship; no speculative all-pairs warming |
| Source ready-lane retention | Two most recently successfully used lane references per live source/basin access; an active voyage also owns its own reference |
| Candidate list | Eight descriptors per active source/basin/owner view: four nearby plus four rotating exploration candidates |
| Planner jobs, arena, preparation | Existing bounds unchanged: 128 job table; current arena; existing 32/8 preparation rules |
| Management turns | 40 total units/tick shared with the existing trade admission pass; ready-lane attachments in the existing actor update are excluded, see section 10 |
| Copy/validation | 1,024 path tiles/tick globally, under the existing match route-work budget as specified below |
| Port discovery/catalog rebuild | 2,048 descriptor reads or moved IDs/tick globally; deterministic cursors; measure CPU separately |
| Subscription rows | At most `(maximumStops + 5) * rosterTraderCeiling`; derive ceiling from roster faction kinds and current cap rules, including eliminated factions for restore validation |
| Occupancy retry | 1, 2, 4, then 8 ticks after consecutive admission refusals; reset on actual acceptance |

The current sampled unique sea paths require about 0.48/0.42 MiB if packed once. The 32 MiB payload bound has substantial sample headroom, but does not certify every valid map/roster. Measure retained JS heap, lane metadata, subscriptions, staging, planner workspace/trees, checkpoint clones and encoded size separately. A payload-only budget is not a total-memory result.

No unlimited exception for an active path: reserve room before attaching a path or taking an unpaid load. Already attached paths are never evicted. If recovery cannot acquire room after bounded eviction, retain cargo and return `capacity` with an aged recovery demand; record this as a qualification failure if the accepted workload cannot clear it. Do not silently allocate past the cap, discard cargo or call the route impossible. A path output rejected by the representation limit must appear as its own diagnostic and block acceptance for any supported fixture that needs it.

Use deterministic FIFO retirement for invalid idle records, then LRU by `(lastUseTick, laneId)` for unreferenced ready entries. Source-retention claims are **soft**, distinct from hard subscriptions: evict idle entries with no source claim first, then idle soft-retained entries, and never a hard-referenced path. Without this distinction, productive-but-idle ports could pin all storage and deadlock recovery. Implement the victim index with an indexed binary heap; lazy insertion on every poll is forbidden because it grows without bound. Entries with hard references are absent from the victim heap. Releasing the final hard reference inserts exactly once; acquiring removes it. Evicting a soft-retained entry removes its source-retention links atomically. Bound removal to one victim/management turn. A demand waiting on memory retains its identity and resumes after capacity changes.

Capacity reserves apply at admission, not after loading. They do not make speculative routes committed. Do not allocate a packed output before checking and reserving all of its required cells. If memory must be evicted over several turns, retain the completion input only within the staging cap and expose `memory` wait. If staging is also full, reject that completion as capacity, preserve first-demand age, and retry after the normal bounded backoff. Supported workloads must not repeatedly thrash this fallback.

## 7 Planner adapter and callback table

Add `"sea-trade"` to `DomainRouteOwner`. Keep `DomainRouteTask` and its existing key function for old callers. The new task is a deliberately typed subset, not a fake merchant:

```ts
interface SeaLaneTask extends DomainRouteTask {
  kind: "domain";
  owner: "sea-trade";
  admissionId: LaneId; // genuine lane admission ID, separate owner namespace
  memberId: number;   // key.hi water tile, NOT a building ID
  stage: "lane";
  generation: number; // key.revision, NOT AI controller generation
  epoch: number;      // lane.epoch
}
```

The planner request has `start = key.lo`, `goal = key.hi`, `water = true`, no alternatives, no prepared-goal phase and no amphibious flag. Its context sponsor is fixed at submission. `domainRouteKey` already includes the distinct owner, so lane and actor ID spaces cannot collide. Never call `request` again for the same accepted key: existing `RoutePlanner.request` treats a same-key call as a replacement and discards its search progress.

| `Simulation` boundary | New-owner behavior, before generic/legacy handling |
| --- | --- |
| `domainConsumer` | `sea-trade` returns `expansion.trade.seaRouteConsumer`; preserve all three old branches explicitly. |
| `interactiveRoute` | Exclude `sea-trade` alongside `trade` and `strategy`, including human-owned sources. |
| `DomainRoutePorts.request` | Preserve current generic forwarding; no actor generation lookup for a lane task. |
| `deadlineTicks` in both adapter and planner ports | Return undefined for new lane tasks. Logical work persists under deterministic capacity control; stale geometry/subscribers cancel it. Do not apply the speculative autonomous quote deadline to shared productive work. |
| `committed` | Ask the service whether any subscriber has paid cargo, an empty return obligation or salvage obligation. Plain empty departures remain uncommitted. Old `Trade.routeCommitted` is called only for owner `trade`. |
| `identity` | Map owner `sea-trade` to `{playerId: task.playerId, caller: "trade"}`. Do not add a second caller share. |
| `corridorReady` | New owner receives the same deterministic water-warm gate used for old trade. Preserve the actual interactive/deadline branches for all other tasks. |
| `allowExclusiveRetry` | False for both `trade` and `sea-trade`; do not let a lane monopolize the arena. |
| `valid` | New consumer validates its lane ID, epoch, endpoints, water revision, requested state and at least one live subscription. It does not validate an actor ID, political permission, receiver building or AI generation. |
| `obstacleRevision` | Existing water value remains `"water"`; the consumer separately checks the numeric geometry revision. |
| `blocked` | Undefined, as for existing naval geometry. |
| `completed` | Forward to the new consumer; never to actor-level `Trade.completedRoute`. |

Keep scheduler version 6. The new mode supplies new callback semantics without rewriting old job ordering. A request's immutable sponsor stays fixed through completion even if that faction is eliminated; geometry validity comes from live subscribers, and priority stays background. If a retry is needed, choose a current subscriber owner using the service's checkpointed round-robin cursor. Do not cancel/restart useful geometry merely to change a sponsor. No new request is created without a live subscriber.

`SeaRoutePorts` supplied to the service should expose only `request(task,start,goal,true)`, `cancel(task)`, `has(key)`, `tick()` and the current water revision. `has` uses the existing planner's public method. No service reads planner private jobs or manipulates its arena. For restore validation, add a narrow `RoutePlanner.requests()` read view returning immutable request identities/keys, excluding reclamation-only jobs. It is used during restore/debug checks, not scanned during every acquisition.

## 8 Lane acquisition and outcome state machine

Expose this public API from the registry:

```ts
type AcquireResult =
  | { kind: "ready"; use: LaneUse }
  | { kind: "waiting"; laneId: LaneId;
      cause: "admission" | "search" | "packing" | "memory" }
  | { kind: "unreachable" } // cheap proven component mismatch, no lane allocation
  | { kind: "capacity" }; // cannot allocate even a logical record/subscription

interface SeaTradeRoutesApi {
acquire(demand: { subscriberKey: string; owner: number; kind: DemandKind;
  start: number; goal: number; firstDemandTick: number }, tick: number): AcquireResult;
peek(start: number, goal: number): LaneUse | undefined; // ready only; no touch
markUsed(use: LaneUse, tick: number): void; // call only after actual leg attachment
release(subscriberKey: string): void;
tile(use: LaneUse, logicalIndex: number): number;
length(laneId: LaneId): number;
stepManagement(budget: number): number;
stepCopies(budget: number): number;
validRoute(task: DomainRouteTask): boolean;
completedRoute(task: DomainRouteTask, outcome: ExactRouteOutcome, path: number[]): void;
checkpoint(): SeaTradeCheckpoint;
restore(saved: SeaTradeCheckpoint): void;
validatePlannerLinks(requests: readonly ExactRouteRequest<unknown>[]): void;
}
```

`acquire` is idempotent for an unchanged subscriber key/demand. It checks endpoints, component equality and revision, then looks up the undirected key. A different component is proven unreachable without a planner request. Allocate a record only after logical capacity is available. Repeated polling neither creates more subscribers nor changes queue age/LRU. `markUsed` touches `lastUseTick` only after a real economic leg attaches; neither `peek` nor a ready result followed by failed commitment touches it. A changed demand under the same subscriber key releases the prior subscription before attaching the new one. Lane uses are not transferable buffer ownership: never include packed route buffers in `postMessage` transfer lists.

There is no new negative-route cache for this unmasked immutable water graph: connected-component rejection is already O(1), and caching planner capacity outcomes would be incorrect. Preserve the legacy land/sea failure cache only in the legacy path. Remove negative-cache state and tests from a new-service implementation rather than building unused policy.

The registry constructor receives only the immutable map, water paths, a function returning current route ports, a tick reader and a roster reader. The policy constructor receives no world at all. `SeaTradePorts` receives map/water access plus functions returning current building facts and existing coherent market views. This prevents importing `Simulation` or accessing private planner/cargo state from the new modules; all geometry callbacks stay read-only apart from their own canonical service records.

| Event | Transition and action |
| --- | --- |
| New viable key | Create queued record, epoch 0, first-demand tick now, one subscription. |
| Queued eligible turn | Choose sponsor if no accepted request; increment epoch, make task and attempt submission once. |
| Submission refused | Stay queued; persist first-demand age; next attempt after 1/2/4/8 ticks. No path failure entry, no goods taken. |
| Submission accepted | Requested state with exact request key; no resubmission/poll cancellation while `has(key)` is true. |
| Complete, matching task | Validate endpoints/length and staging budget; retain input in staging state. Reserve output capacity in a bounded management turn, then transition to packing and queue charged validation/copy. |
| Packing succeeds | Ready state, clear staging input, account output once; notify subscribers for their next management turn. |
| Limited | Queued state with capacity retry; retain demand/age. No geographic negative and no exponential 20–300 second route penalty. |
| Unreachable | Different connected components are proven impossible without submitting a search. A same-component, unmasked water search reporting unreachable contradicts the connectivity authority: report a routing invariant failure instead of negative-caching a lawful port. |
| Superseded by known cancellation | Release only the matching epoch; retry if subscriptions still exist and geometry remains valid. |
| Stale callback | Ignore entirely; it must not release a newer request or overwrite a ready lane. |
| No subscribers, queued | Remove in a management turn unless retained as a current useful source lane. |
| No subscribers, requested | Mark retiring, cancel exactly once; do not reuse its epoch. Cleanup awaits callback or `has(key) === false`. |
| Last reference released, ready | Place in idle victim heap; do not immediately discard a reusable route. |
| Actual water epoch change | Stop new acquisitions; retire invalid records under bounded work; attached ships enter explicit recovery planning. This is an explicit future geometry event, not an assertion that dynamic terrain is already supported. |

A `requested` record with `has(key) === false` and no received callback on the next service turn is an invariant violation, not a reason to silently start again. Fail a debug/regression check with its key; production should surface an explicit routing fault rather than conceal lost work indefinitely. During normal callback execution, clear the requested key and store the terminal outcome atomically.

`retiring` is reserved for a cancelled accepted request awaiting acknowledgment/reclamation, not an arbitrary ready payload. Cancelling an unreferenced staging/packing record releases its accounted input/output and removes it in a management turn. Evicting a ready record releases its packed payload directly. A new subscriber finding a retiring key may wait on that same record; after the old request is absent/acknowledged, transition to queued if references are nonzero, otherwise remove it. Its next request uses a new epoch, and no stale cancellation can delete that newer request.

`stepCopies` visits one queued packing record at a time, round-robin. For each tile, validate safe range, water walkability, endpoint convention and Manhattan adjacency to the previous tile, then write one `Int32`. No synchronous `.every`, `.map`, `Array.from`, `.reverse` or full-path copy in `completedRoute`. Reserve the full typed-array output before writing; constructing a zero-filled `Int32Array` is the single bounded allocation per accepted result, with its size charged to the payload cap. Record allocation time separately. Invalid path contents are a router contract failure, never a normal market rejection.

## 9 Destination discovery and exact selection rule

Keep catalog membership tied to the existing completed-market facts; reuse the existing producer/market refresh instead of building a second authoritative ownership catalog. The physical berth cache is derived and can rebuild lazily. Discovery state and selected candidate IDs are canonical because incomplete discovery changes which destination is available on a tick.

For each active departure-port/basin/merchant-owner combination, maintain a bounded `CandidateCursor` with at most eight descriptors, scan position, nearest-four working set and exploration-window position. On first departure, that port is the source. On a continuation it is `voyage.currentPortTile`, the last foreign arrival, **not** `actor.originTile`; otherwise "nearby" would remain incorrectly centered on home for the whole voyage. A descriptor is `(portTile, receiverId, owner, berth, distanceSquared)`. Live-filter owner/permission first, then deduplicate physical receiving tiles before taking slots. The catalog itself groups by `(owner,tile)`, so an own stack cannot hide a foreign stack at the same tile. Policy views are only created on demand for existing couriers; a world with many unused ports must not allocate one for every possible owner/port pair. Remove a view after its last current actor/dispatch leaves, retaining its rotation cursor only while that bounded active view exists.

Discovery scans existing basin port rows incrementally, at most 2,048 reads/moves globally per tick in round-robin source order. Each active policy view gets at most eight reads per visit before rotating; wrap while allowance remains. Updating the nearest four uses insertion into an array of length four, not a full sort. **Candidates can be used as soon as they are discovered**; a full basin pass is not a prerequisite for the first voyage. A pass retains the other four eligible rows from a deterministic rotating ordinal window. When a pass begins, freeze its highest catalog ID as `passUpperId`. Advance with a binary search for the next current receiver ID greater than `scanAfterReceiverId` and no greater than that upper bound. Catalog publication does not reset the cursor: invalidate stale candidate facts live, finish this finite pass, then wrap using the new upper bound. Thus constant construction cannot keep pushing the pass end away or force rescans of the same prefix. Changed eligibility at an older ID is reconsidered on the next bounded pass. Never persist an ordinal into an unsaved `Map` order, and do not clear ready geometric lanes on catalog publication.

To keep that catalog bounded by existing world data, store its sorted numeric receiver IDs once per basin, not once per source. Updating that list must be a resumable rebuild cursor over the existing coherent completed-market view. While it rebuilds, existing candidate links remain subject to live validation and new links use the prior coherent catalog. On initial empty catalog, publish bounded sorted chunks so the first discovered ports can bootstrap. Subsequent replacements publish atomically. Do not abandon a rebuild when more buildings change: finish its captured membership input, mark a follow-up rebuild dirty, then reconcile again. Otherwise continuous construction could keep the catalog empty forever. Store pending input IDs/cursor and merge-run continuations in checkpoints; every moved ID is charged. Taking IDs from the existing market view may retain that immutable membership array until the rebuild completes, but resolve each row's identity/live ownership again rather than treating its mutable building reference as authority. Checkpoint serialization converts that membership to IDs. No full sort in a live rebuild.

Catalog construction consumes at most one quarter (512) of the discovery operations when source discovery is also runnable; source discovery consumes at most the other 1,536. Either may borrow the idle portion. Source views remain bounded by actual active source/basin pairs, and one shared basin catalog replaces per-source membership copies. The catalog is a subset/index of current world ports, not an independent source of ownership truth. New owned-receiver salvage additionally checks the current owner's completed port bucket at a bounded recovery turn so a pending catalog rebuild cannot hide a just-built rescue port.

Run existing `Trade.refreshMarkets` before the mixed legacy/sea management pass so it supplies current coherent market views. Detect later catalog membership work through `BuildingIndex.producerRevision`, but treat that counter as a runtime dirty detector only. After restoring the saved catalog/discovery continuations, set the detector to the restored index's **current** revision in the post-planner restore hook; do not interpret the rebuilt index's generation bump as a new world mutation. Otherwise cold restore would schedule an extra catalog rebuild and diverge. Publication (`siteSnapshot`) must not trigger catalog or queue mutations. Add this exact restore case to `SeaTradePorts.test.ts`.

Use these exact initial selection steps, with no economic return-rate ranking:

1. Read at most the eight supplied candidates. Live-filter completion, health, eliminated owner, basin, foreign ownership, `permitted`, pause, visited physical tiles and the eight-stop limit. Resolve the actual receiver ID from current facts. During an already accepted leg, use the existing accepted-leg rule instead of this new-leg filter.
2. Query `TradeReceiving.available` using current owner/tile, naval/foreign/allied flags. Zero available intake makes the candidate temporarily unsuitable for a new outward leg, not geographically unreachable. Do not reserve intake or charge cargo at selection.
3. For ready candidates, use the retained path's step count as distance. Let `d` be the shortest ready eligible length. The nearby-ready set is lengths `<= max(d + 16, ceil(1.5 * d))`. This avoids a far cached ally winning solely because it is cached. Constants are versioned policy parameters and must be reported in economy comparisons.
4. If the nearby-ready set has allies, restrict selection to those allies. Otherwise use the whole nearby-ready set. Sort this at-most-eight group by numeric `(portTile, receiverId)` and choose its next element after the saved last selected physical tile; wrap at the end. Advance this cursor only on a successful departure/continuation commitment, never on a failed poll.
5. If no eligible ready candidate exists, select one discovery target from the nearest-four subset using squared geographic distance as an estimate. Prefer allies only inside its nearby estimate group, using the same `max(d + 16, ceil(1.5*d))` rule on integer ceiling distance. Obtain integer ceiling distance with a tested helper; do not compare squared distances to unsquared thresholds. Tie-break by receiver tile/ID.
6. Start or subscribe to exactly that one lane demand. While it is pending, use an eligible ready alternate if one becomes available. A source may retain at most the pending target and its bounded ready-retention set; do not launch all eight exact searches.
7. On a proven different-component target, remove it from this pass and rotate to the next candidate, including the exploration four. Capacity waiting does not remove it. With no viable candidate, loading ships retain stock/identity and report no-market or market-intake as appropriate. Loaded ships return with the remainder after bounded candidate discovery; do not wait forever for a currently empty intake window to improve.

The near-group algorithm deliberately permits different destinations from today's payout scoring. It does not promise shortest sea routes from geometric estimates. Continually changing intake must not restart geometry. Do not reset the rotating exploration window every time the nearest-four group is full; tests must prove eventual consideration of a lawful distant receiver.

## 10 Tick order and bounded work

Legacy mode must execute the existing order unchanged. New mode adds this exact routing-phase sequence:

1. Keep existing route-work drain and interactive preparation.
2. Increment the existing route classification epoch as today before reading commitment classifications. Service subscriber changes from the previous trade phase are now visible.
3. Run up to 1,024 lane packing/validation units. Each copied tile consumes one unit of the current 10,240 route-work allowance.
4. Run `routePlanner.step(tick, 10240 - copiedUnits)`; derive 10,240 through the existing `81920 / TICKS_PER_SECOND` expression, not a new hardcoded cadence. Current callback and preparation allowances remain otherwise unchanged.
5. Preserve the existing army, ship, land and interactive passes. Inside the existing 40-unit trade pass, alternate one legacy-admission unit and one sea-service management unit. A service consumes the other service's unused allocation. Preserve each cursor; neither list restarts from the first element each tick.
6. Separately perform up to 2,048 port-discovery/catalog operations globally, with the 512/1,536 split and idle borrowing above. Reading one descriptor or moving one catalog ID uses one unit. This is counted as `portDiscoveryWork`, not hidden inside a candidate helper. Initial allowance comes from a named sea-discovery budget; record its CPU and do not subtract search units for an unrelated descriptor operation.
7. In `Trade.step`, preserve player-map refresh, market refresh, spawning, interception and ownership processing. Run source load/leg commits using the ready facts produced above. Movement and arrival then follow the current actor order. No source can spend stock twice because there is one synchronous simulation owner.

A management unit is one cold lane submission/refusal, one cold dispatch transition, one terminal-state change, one victim removal, or one legacy admission iteration. **A ready lane attaches in the existing ordered actor update without entering this queue.** Otherwise hundreds of sources sharing 20 management turns could not meet the one-second ready-lane gate. The attachment performs O(1) route lookup and at most eight current candidate checks; no path copy or planner submission. Record these as `readyAttachChecks`, and bound them by eight times the live actor count per tick. Cache a source's unchanged ready candidate view within the tick, while rechecking stock and receiver intake at commitment. Do not count that actor update as a single supposedly bounded management turn.

Index operations are logarithmic/bounded. An inner loop that scans all actors/ports/lanes does not count as one unit. Packing and catalog merge moves have their own counters. Build source actor counts using the existing single spawn/accounting pass and maintained indexes, not a new per-source full actor scan.

Copy completion does not allow callbacks to reenter `Trade.step`. Ready notifications mark subscriber work pending; actual cargo writes occur only in the ordered trade phase. If all management queues are idle, their unused work is not converted into extra preparation or unbounded scans.

## 11 Loading transaction and ready path attachment

Factor today's `load` into `commitLoad(actor, currentSite, firstReceiverId)` plus the old admission wrapper. The helper must no longer obtain its receiver by reading `admissions.get(actor.id)`: a new lane does not have an actor admission. Keep the wrapper unchanged for legacy/land callers and pass its current candidate ID to the helper. Both paths share the exact existing capacity, stock debit, shipment fields and alliance snapshot logic.

Ordered commit pseudocode:

```text
require actor is live, empty, loading, not handling and controlled by a live owner
resolve current source by actor owner + origin tile (not a cached building pointer)
require mode enabled, living completed source and currently sufficient stock
require target is a living completed foreign port and a legal new market
require ready lane endpoints match actor's actual tile and target's chosen berth
require lane water revision is current and all required references can be acquired
acquire one active-leg pin and reserve a future trail subscription slot before taking goods
recompute source capacity/definition from the current owner's research
debit current site buildings in the same numeric building order as legacy load
reset loaded/delivered/returned/lost/visited/visitedTiles/quoteAllies as today
allocate the next shipment ID; record trip start and completed supply-wait time
bind leg with next=0, end=length-1; set destination and outbound state
set handling wait to TICKS_PER_SECOND, and publish changed public details once
release source's pending demand; retain its two useful lane references
```

The sequence is synchronous. There must be no callback or `await` between validation and goods debit. If any predicate fails, no stock, shipment ID, quote, cargo or actor identity changes. A reference acquired before a later failed predicate must be released in the same call. Do not debit cargo merely because the shared geometry completed.

The active pin is transferred to the completed trail at arrival, not duplicated. A saved outward trail owns one reference per leg occurrence, even if two occurrences share a lane. A return span borrows those existing pins; it does not acquire them a second time. On new load, flush the current private wait, transfer `loadingWaits` into `tripWaits`, set `preLoadWaitTicks` to that sum, and reset `loadingWaits` to zeros. The existing `tripSupplyTicks` remains a separate supply-only duration.

Two couriers at one stocked source are visited in current actor-array order. The first successful commit debits stock; the second recomputes the remaining stock and cannot reuse the first transaction's quote. Do not add a new sorted-actor queue that changes the whole world's interception or arrival order. A queued `SourceDispatch` owns route interest, not money or an exclusive lifetime claim on the next empty ship. If its chosen actor disappears, another idle actor at the same actual start tile may commit the ready geometry after full revalidation. An actor at a different berth acquires that actual-start key; it does not move to the old leader's berth.

For continuations, no load occurs. Require current cargo and a legal unvisited receiver; acquire the new lane while retaining the existing return trail. On memory refusal, return by the known trail instead of discarding paid goods or taking an unbounded extra memory allocation.

## 12 Movement and physical return algorithm

The owner confirmed **ready direct home route first, otherwise retrace** on 21 October. This is a deliberate new-mode travel policy: a multi-stop retrace may be longer than today's newly searched direct return. Report its effect on completed cycles and AI observations. Do not keep submitting direct-home searches while a ship already has a guaranteed retrace; that would recreate the backlog this policy removes.

New-mode sea actors leave `actor.path = []` and `actor.nextPathIndex = 0`; their private cursor supplies movement tiles. Legacy and land actors continue using those fields. Factor only the choice of next path tile into helpers; keep the existing `dx/dy`, speed, rounding and one-waypoint-per-tick movement arithmetic. At a successful waypoint update the private cursor. Do not make speed depend on the number of tiles packed or concatenate return arrays.

Define `tile(use, i)` as `tiles[use.reverse ? length - 1 - i : i]`. A full outward leg starts at logical index zero and ends at `length - 1`. This preserves the existing initial start-tile visit/handling convention. At a segment join during a return, skip a duplicated shared endpoint; there is no loading wait at that waypoint. Limit this skip loop to the maximum nine spans.

Skip a duplicate join only if the actor is already at that endpoint's exact fixed-point center; a ship between centers must physically reach its prefix goal. Perform at most the existing one waypoint movement action per actor/tick. After the final movement waypoint, arrival accounting runs on the next normal actor update, preserving the current movement/arrival separation. Do not grant an extra movement budget when a span changes.

At an ordinary outward arrival:

1. Apply exactly today's receiver quantity, `tradePayout`, tariff, visited building/tile update and handling wait. A zero sale still marks that physical location visited, preserving current finite progress.
   Set `voyage.currentPortTile` to the actual receiver tile for the next bounded nearby query.
2. Transfer the active leg's retained ownership into `voyage.trail`; do not briefly release the last reference and allow eviction. A full trail has at most eight legs.
3. If cargo remains and the stop limit permits, try the cheap continuation policy. If none is ready and a target is still being discovered, give continuation at most five game seconds from first continuation demand. It may wait under explicit planning/intake causes during that interval; then return. This new-mode timeout is not a geographic negative or cargo deadline.
4. If cargo is empty, the stop limit is reached, discovery has no market, or that continuation limit expires, invoke `startReturn`.

`startReturn` first resolves the current owned source site. If absent, use source-loss salvage below. Otherwise look up a **ready** lane from the ship's actual tile to that source's preferred endpoint in the current basin. If present, bind it as the sole direct return, release old trail references, set the current source representative as `destination`, set `state = returning` and perform no further destination scoring. A ready reversed lane qualifies.

If no direct lane is ready, construct at most eight return spans by visiting the saved outward legs in reverse order and flipping each `reverse` flag. Each span initially has `next = 0`, `end = laneLength - 1`. Keep the pins already owned by the trail. The sequence's final tile must equal the original departure berth, which is valid access to the still-owned source. No search, allocation proportional to path length, extra cargo load or new shipment ID occurs. Intermediate ports are geometry waypoints only: no payout, visited update, receiving intake, new destination, new-leg permission check or handling wait.

For an interrupted outward leg, such as receiver destruction or ownership becoming incompatible, prepend a reversed **traversed prefix** before reversing completed legs. Let `k = max(0, active.next - 1)` in the outward use's logical coordinates. The ship may be between tiles, so its first new goal is the last reached tile `k`, using ordinary physical movement. Flip direction, set return span `next = length - 1 - k` and `end = length - 1`; this traverses only back to the leg's actual start. Do not start at the far endpoint or reverse an untravelled suffix. This adds at most one span, for a total of nine. `k = 0` is a valid single-endpoint prefix.

If the actor is already returning and a fresh direct lane later appears, finish the established return rather than changing paths every tick. If its source representative is removed but the same owned source tile still exists, rebind its current representative after source validation. If the whole source is lost, discard the return obligation and convert to salvage without moving the ship. A real water-geometry invalidation may invalidate the old trail; preserve cargo, release invalid geometry and use explicit recovery planning. Normal owner/diplomacy changes do not invalidate a pure water trail.

At final home arrival, use today's cycle quote, unsold-goods return and loading-state transition exactly once. Release every active/trail/return pin and reset the private voyage for the next shipment. Clear consumed legacy path arrays in new mode; do not retain an entire completed path on every parked actor.

Reset `currentPortTile` to the owned source tile on home arrival and load. Clear it on capture/source-loss salvage; an arbitrary-position prize uses a bounded owned-receiver query centered on its actual coordinates, not the old owner's port. It still acquires geometry from its actual containing water tile.

## 13 Capture, salvage and cleanup

Run interception in the same actor update order, with the same shared spatial queries, capture eligibility, distance and fortification checks. `SeaTradeRoutes` does not dodge warships or change who can steal goods.

Capture transaction order: record diplomacy/theft and existing lost/captured value; release the victim's pending lane subscriber and all traversal/trail references; change owner and set prize state using the existing logic; keep cargo and value-per-good; clear outward itinerary/quote allies/destination and private source policy; apply the existing one-second handling wait; begin owned-receiver salvage on its next eligible update. Do not retain a right to return to the old owner's source.

Salvage selects current owned completed ports in the actual water component, irrespective of normal trade pause or researched trade technology. Use ready lanes first, otherwise one aged recovery request. The target and lane are independent of a producer's stocked-goods state. With no owned receiver, `no-owned-receiver` is a legitimate wait; a completed/captured port triggers bounded reconsideration through current market facts. Receiver destruction releases only that economic subscription and chooses another; useful geometry remains available for other users.

Prize arrival pays the current remaining `cargo * valuePerGood` once and retires the actor. It never applies normal intake, premiums or receiver tariffs. Recapture repeats ownership transfer without minting cargo. Blast/death/elimination follows current discard/loss accounting before central removal and releases sidecar references exactly once. Use idempotent `releaseActor(actorId)` from every existing retirement path and again safely from `removeRetired`; double cleanup must not underflow a lane count.

Source-loss handling retains today's distinction: an empty orphan retires; a loaded orphan becomes prize/salvage. A paused empty loading actor may release its source demand, but a paused mode does not erase an already launched voyage. Do not assume `cancel(actor.id)` removes lane demands: lane state is a different owner and must be released explicitly.

Bound source-retention references to two per active source/basin. A source is active while it has at least one live courier tied to it or a current dispatch; remove its retention when the last such courier/demand disappears, on owner loss, or on source destruction. These checks use maintained source counts and the existing once-per-second accounting pass. Idle retained routes then become ordinary heap victims; they are not permanent pins for every port ever constructed.

## 14 Queue discipline and source waits

Do not implement `stepManagement` as a full scan of all lane records. Maintain explicit ready-to-submit, delayed, terminal and retiring queues, plus the indexed victim heap and packing queue. A delayed queue is a bounded indexed heap by `(nextAttemptTick, firstDemandTick, laneId)`; waking a due lane moves it once into a ready-to-submit queue. There is one queue membership per state. Remove obsolete memberships on transition. Per-owner ready queues rotate owners; within an owner preserve `(firstDemandTick, laneId)` order.

Choose at most three recovery/paid turns followed by one unpaid-departure turn when both are runnable. A recovery group includes paid continuation, empty return and prize/salvage; no speculative empty departure is included. Existing planner classification derives commitment from those actual subscriptions, not from the lane's cache status. A lane subscribed by multiple owners occurs in one ready queue and receives one scheduler identity per attempt. No subscriber count multiplier increases its work share. Retire/copy/catalog work retains a separate guaranteed turn so new arrivals cannot starve cleanup.

Expose private wait cause through this exact mapping without adding new wire enum values:

| Private cause | Existing public `waitingReason` |
| --- | --- |
| cargo | cargo |
| shared-lane, search, packing | planning |
| admission, memory | capacity |
| market-intake | capacity, with detailed private diagnostic cause |
| no-market | unreachable (diagnostics distinguish permissions/discovery) |
| no-owned-receiver | no-receiver |
| handling | handling |

Do not leave intake waits labelled "Waiting for routing capacity" in the UI. Add the deliberate optional public field `TradeActor.waitDetail?: "market-intake" | "no-market"`. Only those two cases set it; other cases delete it. `EmpireView` gives it precedence with text "Waiting for market capacity" or "No eligible trading port", then falls back to the existing reason label. Keep the existing `waitingReason` values so the wire enum itself does not change. Add decoder validation for the optional scalar. Current decoder source accepts unknown scalar fields, but prove forward compatibility against the saved old decoder in a fixture; do not assume it from TypeScript alone. Both old and new clients must continue applying positions/cargo correctly. Ordinary and borrowed snapshots deliberately include this public field and exclude the private route table.

Use one `setSeaWait(actor, cause, tick)` helper: change `since` only when cause changes, accrue elapsed private counters once on exit, and call `tradeDetailsChanged` only if the public reason/detail changes. Do not clear every loading actor's reason before an idempotent `acquire`. A follower at a full source reports planning/capacity consistently with its source dispatch even though it has no independent planner request. Preserve wait state during the existing countdown branch. Leaving a wait clears its public reason/detail exactly once. Incomplete discovery is a planning wait; only a completed/current eligibility examination can report no-market. A full intake window remains the intake detail, not no-market or geographic failure.

Keep detailed causes and `since` in private canonical records for cycle accounting. Publish aggregate read-only counters under runtime diagnostics, not a new actor route table. Distinguish `sourceRefillTicks`, `routeQueueTicks`, `receivingWaitTicks`, `handlingTicks` and physical travel. Payout stays exactly where it is today. Extend `TradeCycleQuote` with optional route/receiving-wait fields for new-mode evidence; do not silently inflate `supplyTicks`. AI supply-limited logic continues to require genuinely insufficient current source stock.

For a new-mode cycle, flush the current private wait before calculating the quote. Source cargo wait stays in existing `tripSupplyTicks`. Other elapsed waits accrue to `loadingWaits` before loading and to `tripWaits` after loading; changing cause accrues `[since, tick)` once. Define `cycleTicks = max(1, tick - tripStartedTick + tripSupplyTicks + preLoadWaitTicks)`, `supplyTicks = tripSupplyTicks`, `routeWaitTicks = tripWaits.route`, `receivingWaitTicks = tripWaits.intake`, and `handlingTicks = tripWaits.handling`. Set `travelTicks = cycleTicks - supplyTicks - routeWaitTicks - receivingWaitTicks - handlingTicks` and assert nonnegative. This residual includes movement and existing one-tick arrival bookkeeping. New-mode handling uses actual wait counters, not the old estimated `(2 + visited.length) * TICKS_PER_SECOND`, so the partition is reconcilable. Legacy quotes retain their exact formula. Imported legacy voyages retain old quote accounting until their next load.

Track the wait interval's category as well as its cause: an initial post-return handling interval belongs to the next load's `loadingWaits`, while launch/foreign-port handling belongs to that shipment's `tripWaits`. Neither is counted twice. A pending cause starts at the phase which actually sets it, not actor creation. Assert that the completed quote's durations sum to its cycle and that route-only congestion never increases `supplyTicks` or causes `tradeSupplyLimited` to become true for a full source.

## 15 Persistence, validation and legacy compatibility

`Trade.checkpoint()` appends `seaTrade` only when new mode is enabled. The registry returns fresh copies of canonical arrays/maps, but no physical caches, world objects, telemetry, heap scratch or subscriptions duplicated per actor. Serialize each packed lane once. Actor legacy paths remain empty in new mode, so the state transport cannot accidentally duplicate one shared path per ship.

`Trade.restore()` performs local schema/reference validation and restores records without querying planner state, altering counters, consuming cargo or changing policy. `Skirmish.installCheckpoint()` restores `Expansion`/trade, then `RoutePlanner`, then calls `trade.validateSeaPlannerLinks()` before the match can resume. That method uses the narrow planner request view. Required cross-checks:

Before `installCheckpoint` performs its existing whole-state clone, call a pure `validateSeaTradeEnvelope(saved.expansion?.trade.seaTrade, mode, mapCellCount)` from `Skirmish.restore`. It checks option/subversion agreement, record counts, typed-array kinds/lengths, aggregate cells and staging limits without cloning payloads. This preflight is necessary because `Expansion.restore` also clones its input before reaching `Trade.restore`. Full semantic/reference/path validation follows in the existing stopped-on-restore-failure boundary. Do not put the only size check after those clones.

1. Every requested lane has exactly one live new-owner request with matching ID, epoch, sponsor, low/high endpoints, generation/revision and key. Retiring requests may be absent after reclamation; a ready/staging/packing lane may not have an active request.
2. Every live new-owner request references a requested/retiring lane and a valid epoch. Reclamation-only jobs are not counted as new live requests. A stale retired search cannot consume a restored lane's current identity.
3. Each active voyage references a live naval actor with matching owner/shipment; every cursor lies inside its lane and span; adjacent trail spans meet at the same physical tile; a normal return ends at actual access to the owned source or is explicitly in salvage/recovery state.
4. Dispatch ownership references a current source identity or a canonical pending invalidation to be processed on the next turn. No arbitrary source mutation is performed by validation. An already invalid saved economic commitment cannot spend stock.
5. Recompute hard counts, soft-retention links, ready payload cells, staging cells, IDs, queue memberships and heap order. Check against saved totals and caps. Reject negative counts, duplicate IDs/subscriptions/keys, future ticks, invalid epochs, unknown states, nonfinite numbers and oversized arrays before cloning large payloads.
6. Validate water paths and partial packing prefixes on restore. Loading a checkpoint is allowed to perform full bounded-by-checkpoint validation; record its time/memory separately from steady-state ticks. Unknown subversions or options must reject rather than defaulting to empty state.

Rebuild runtime lookup maps and indexed heaps from canonical saved order. The result must reproduce the next management, copy and planner work units exactly. Do not use object identity, physical hierarchy warmth or a newly generated derived `BuildingIndex` revision as a saved policy-generation fence. For economic identity, use actual IDs/tile/owner and revalidated facts.

Use the existing `StateCodec` support for `Int32Array`. Current envelopes include 256,000,000 aggregate array bytes and 32,000,000 payload characters; these are transport ceilings, not permission to allocate that much route memory. Test the route table plus the whole existing checkpoint through `encodeState/decodeState` and `StateDelta`. Do not raise envelope limits as part of this change. Capture peak memory of `Expansion.checkpoint` and `installCheckpoint`, which currently clone nested state; changing unrelated clone architecture is outside this slice.

For a different-world restore with identical dimensions, validate every endpoint/step against the supplied world's water graph. Current simulation options/map generation identify the intended map; there is no existing complete terrain fingerprint. Do not claim the new subsystem can detect every arbitrary same-size wrong map by revision alone. The reproducible harness must save/reconstruct the exact map and seed, and malformed-route tests must reject wrong geometry. Adding a whole-map fingerprint belongs in a separate checkpoint-authority proposal if stronger identity is needed.

Legacy gates: omission of the option creates no new service state and no changed checkpoint fields, route callback values, ordering or publication. Existing scheduling versions 1–6 continue through their existing restore paths. New-mode fixture conversion is explicit, offline and one-way; do not compare an old fixture after mutating its options in place and call it a normal restore.

## 16 Explicit fixture conversion

Build `scripts/convertSeaTradeFixture.ts` for offline benchmark inputs only, never called by runtime restore. Arguments: `--input`, `--output`, `--source-sha`, `--policy lanes-v1`. Refuse an existing output path. Write an adjacent manifest with source checkpoint hash, exact source SHA/options, map seed, old/new behavior and every converted class of state.

Algorithm:

1. Deserialize/validate the old world with the old options and reconstruct its exact map using the existing fixture harness. Save an untouched baseline input.
2. Create a new checkpoint object with the new option and a valid empty sea sub-checkpoint. Leave old land/army/ship planning and economy fields unchanged.
3. Move each existing naval actor's nonempty legacy path into an interned full-inclusive lane while preserving its current position, destination and waypoint index. Normalize direction/index without skipping or replaying the current waypoint. Empty consumed paths may be cleared. Keep its current public state and wait countdown.
4. Existing mid-trip actors lack a complete outward breadcrumb trail. Mark them as a **legacy voyage** in private state and permit exactly the current direct-home/salvage behavior for that shipment through the shared lane service. Do not invent a trail, teleport them, or claim retracing is benchmarked until a new-mode shipment has begun.
5. Remove old actor-level sea admissions from `Trade.admissions` and cancel their matching live owner-`trade` planner jobs using the existing cancellation/reclamation mechanism. Preserve land admissions. Carry their actor state/cargo forward as uncommitted new-mode demands with preserved first-wait evidence. Do not delete arena nodes or shared trees by hand.
6. Keep already accepted active sea paths, existing loaded cargo, source stocks, next shipment IDs and all delivered/lost/captured totals unchanged. Each imported path gets proper active reference accounting. Admission cancellation may require advancing both comparison fixtures through an explicitly reported settling window before timing.
7. Instantiate/restore with the new options and run all new cross-checks. Save the output only after a successful normal checkpoint round trip. The converter must reject inputs that exceed representation limits; it may not drop traders or cargo to fit.

Add `legacyVoyage: boolean` to the private voyage schema and clear it at the next successful source load. New normal matches never set it. Compare results from converted mature fixtures separately from fresh matches, since the converter cannot recover historical route trails from incomplete old records.

## 17 Publication and economic integration

Keep internal state under the trade sidecar. Add a test that recursively rejects `laneId`, packed tiles, subscriptions, return spans, discovery catalogs and cursors in both ordinary trader DTOs and borrowed trader deltas. Only existing public actor fields, the deliberate optional `waitDetail` and reviewed quote fields may appear. Do not add private keys to `TradeActor` then rely on a forgotten encoder exclusion.

The selected receiver is advisory until commitment; receiver intake at arrival remains authoritative. Quote-allies remains the existing shipment snapshot, and actual settlement still checks current alliance too. Allied preference is not an allied payout increase: current settlement rates must remain the same even if choosing allies changes aggregate income.

`AiTradeCapacity` retains geometric bootstrap before any completed voyage. `AiTradeOpportunities` continues to observe actual successful completed cycles. New cycle route/intake wait fields distinguish a full source blocked by routing from a supply shortage. No new AI caller may call `waterPaths.find` to evaluate every port. `sourceStatus`, current stock/capacity and lane service observations suffice for this scope.

Source-loss, receiver-loss, block/pause, conquest and controller changes use the current world facts/lifecycle. Derived index invalidation is separate from canonical dispatch invalidation. A research or stack change updates capacity/receiving facts without flushing valid sea geometry. A permission change may remove a subscriber or future destination, but cannot restart another owner's unrelated water search.

## 18 Test files and exact assertions

Create the following test files. Use existing fixture helpers where they preserve real production routing; do not replace deferred planning with a stub that always produces a route. Small pure policy tests may use supplied candidate facts. All time thresholds use `secondsToTicks` except assertions specifically about an exact copy/queue quantum.

| New file under `tests/skirmish/` | Required cases and assertions |
| --- | --- |
| `SeaTradePolicy.test.ts` | Neutral lengths 10/12 and allied length 13 select allied; allied length 100 does not beat those near neutrals; zero-intake ally loses to an available neutral; ties rotate deterministically; only actual successful commit advances cursor; visited physical tile rejects a different stacked building at the same tile; all filtered candidates yield a typed wait/return outcome. |
| `SeaTradePorts.test.ts` | First berth isolated, second basin productive; two basins stay distinct; actual-start endpoint retained for alternate berth; stack removal/upgrade keeps geometry; own port excluded outward but legal home/salvage; new owned receiver discovered during a pending catalog rebuild; repeated construction cannot starve an older rebuild; restore halfway through discovery produces the same next candidates/work. |
| `SeaTradeRoutes.test.ts` | Many owners acquiring A/B submit one request; B/A joins it with reversed view; repeated `acquire` neither calls `request` again nor changes age; source and actor same numeric ID cannot collide; accepted-key replacement count is zero; unrelated subscriber survives leader capture/cancel; queue refusal preserves geometry identity and cargo; limited is not negative cached; wrong epoch callback changes nothing; same-tile path is length one. |
| `SeaTradeRouteMemory.test.ts` | Under deliberately tiny caps, active/trail pins never evict; soft source retention evicts before recovery blocks; reference count does not underflow on repeated release; memory refusal takes no source goods; source-retention size stays two; metadata heaps stay bounded after 10,000 acquire/release operations; staging/output cells are accounted during partial copy and after cancellation; no path has a duplicate per-actor payload. |
| `SeaTradeReturn.test.ts` | Two/three outward legs return in reverse sequence with no new planner request; ready direct home wins; a direct lane becoming ready after retrace begins does not churn the route; reverse prefix begins at the last reached tile while actor is between centers; no teleport, intermediate sale, tariff, intake or handling; each movement step obeys existing speed/rounding; final unsold cargo returned once; source loss mid-return becomes salvage. |
| `SeaTradeLifecycle.test.ts` | Capture/recapture during queued/search/packing/outbound/returning; source/receiver destruction; same-tile rebuild with new IDs; owner zero; elimination/controller changes; paused normal trade with prize receiver; receiver built later wakes salvage; blast affects several subscribers but leaves surviving users' route; interrupted stale callback cannot revive retired actor/cargo. |
| `SeaTradeCheckpoint.test.ts` | Cold/portable restore at each lane/voyage phase; same-instance repeated restore; saved hard counts and exact next work agree; corrupt references/unknown subversion reject; orphan planner job rejects; valid reclamation-only job accepted; registry reset clears former world's lanes; absent new option preserves old checkpoint fields; new option with absent sub-checkpoint rejects. |
| `SeaTradePublication.test.ts` | Full and borrowed streams agree for cargo/planning/capacity/handling transitions; route internals absent recursively; polling does not create detail updates every tick; publishing does not change checkpoint or receiving state; reconnect/keyframe reproduces current actor wait and position. |
| `SeaTradeFleetProgress.test.ts` | Full sources, recurrent voyages and continuous legitimate arrivals use the real planner; ready attachment does not wait for a management turn; source count larger than 40 still satisfies ready-route departure threshold; idle followers are correctly classified; finite cold batch completes and steady-state fresh-search demand stays below completion rate; mixed human requests retain their established share. |

Extend `TradeFleet`, `TradeReceiving`, `AiTradeCapacity`, `StateDelta` and existing planner suites where the new mode touches their contracts. Run all existing old-mode tests unchanged. For currency accounting, independently sum actual arrival transfers and tariff rules; do not test payout by calling the same implementation helper to generate both expected and actual results. For route symmetry, compare each reversed cardinal step and exact endpoints, not just reversed array length.

Add a converter test: snapshot actor IDs, positions, cargo, stocks, shipment counters and paid totals before conversion; require equality after immediate new-mode restore. Then advance through one complete imported shipment and the first new-mode shipment. The former may use a direct return; the latter must demonstrate the chosen retrace rule. Reject an unknown map reconstruction or an output path that would overwrite the source fixture.

When using fake planner ports in unit tests, return a path only after explicit stepped work and keep separate accepted/complete/cancel counters. End-to-end lifecycle tests must also use the actual `Simulation` callback adapter so an omitted `interactiveRoute`/consumer branch cannot pass behind a mock.

## 19 Qualification harness and saved evidence

Create `scripts/profileSeaTrade.ts`; reuse map reconstruction and fixture generation from the existing harnesses rather than hardcoding a new simplified world. Supported flags:

```text
--checkpoint <v8 path> OR --fresh --map <id> --size <250|500|1000>
--seed <integer> --ai <integer> --tribes <integer> --technology-speed <value>
--policy <legacy|lanes-v1> --ticks <integer> --warmup <integer>
--out <new directory> --publish-every <integer> --sample-every <integer>
--trace-routing <boolean> --cpu-profile <boolean>
```

Do not invent defaults for an existing checkpoint: use its saved options and map. A checkpoint whose policy differs from `--policy` requires the explicit converter and manifest. Refuse to overwrite existing evidence or use a fresh world under the same run name. Log source SHA, uncommitted file hashes, Node version, platform, options, map signature supplied by the fixture, seed, checkpoint hash, start/end tick, actual winner/termination, instrumentation and publication cadence.

Every result contains:

- Step/routing/trade/packing/discovery CPU means, p50/p95/p99/max, GC and actual game-seconds-per-wall-second. Run clean timing separately from detailed instrumentation.
- Distinct lane requests, accepted requests, refused attempts, completed lanes, ready hits, reversed hits, component rejections, limited outcomes, stale callbacks and cancellations by cause. Attempts are explicitly separate from unique routes; the new mode has no negative-cache hits.
- Per-source eligible-full-stock wait and first-demand age; per-actor movement samples; departures, each arrival and completed cycles; normal/empty return, direct/retrace/legacy return counts and distances.
- Pending demand by departure/continuation/return/salvage, hard/soft reference counts, victim counts, payload/staging/heap/encoded checkpoint sizes and high-water marks.
- Classified outliers with source/actor/lane IDs, actual coordinates, current cargo/stock/capacity, receiver permission/intake, private wait cause, ready-lane availability and timestamps. Save all unmatched waits, not just a convenient sample.
- A rolling 60-game-second arrival/completion balance and ten-minute final backlog trend. New port construction, receiver scarcity and genuine supply shortage are reported separately from route capacity.

Define the metrics before computing gates:

| Metric | Exact population and clock |
| --- | --- |
| Ready departure delay | Begins on the first trade phase with an idle actor, completed source, full current stock, handling expired, legal positive-intake receiver, ready fitting lane and available required references. Ends at goods debit/leg binding. Persistent eligibility is required; do not charge a later intake/ownership/cargo interruption to routing. Target at most eight ticks at 8 Hz. |
| Lane acquisition | From the first canonical subscription for a selected geometry to ready, including queue refusals, packing and memory waits. Discovery-to-selected time is a separate metric so catalog latency cannot disappear from evidence. Target p95 <= five seconds, p99 <= fifteen on the declared load. |
| Reuse rate | Ready acquisitions divided by acquisitions for recurring eligible port pairs after five game minutes of stable network warm-up. Report first-use/emergency/converted-legacy legs separately. Repeated polling of one pending demand is not an acquisition or cache miss. Target at least 95%. |
| Stationary route failure | Two continuous game minutes without movement or a useful shipment transition, while a legal ready lane could serve the actor/source throughout the qualifying wait. Exclude documented cargo/handling/intake/permission waits; include unexplained followers and wrong ownership of route work. Target zero. |
| Backlog slope | Outstanding distinct route demands at the start/end of each of the final ten one-minute windows, with arrivals/completions and port-count changes alongside. No sustained positive slope under stable legitimate demand. |
| Retrace correctness | Direct/retraced physical distances and cycle completions, with zero fresh return searches for nonlegacy normal voyages. Recovery after source loss is separately allowed to search. |
| Human latency | Submit-to-executed receipt for matching accepted movement commands in the same workload. Existing historical missed targets remain reported; no new trade-priority advantage is hidden as a human improvement. |

Use seeds `1606492585`, `42` and `47` for the first fresh Migration 1000 set, with 14 AI, 30 tribes and technology speed 3; explicitly record current lobby time limit. Run until 90 game minutes or legitimate termination. A no-trade extinction before maturity does not substitute for a mature run; use the saved mature fixtures for that gate and record why that seed ended. Run separate 250/500 and a coastal/archipelago map supported by the current map catalog; record the chosen catalog ID rather than assuming it is Migration-compatible.

Mature comparisons use the existing 45/60-minute fixture worlds for at least ten measured game minutes plus warm-up, with explicit converted legacy legs reported separately. To measure only lane-service change versus policy change, retain two new-mode variants during development behind a harness-only injected policy: original candidate selection with lanes, and the final cheap policy with lanes. Do not ship a proliferation of public feature flags. The old normal behavior remains the one supported legacy option.

Use at least three serial isolated timing repetitions with alternating control/candidate order; report each repetition and distributions, not a single favorable mean. The full world is intentionally different after policy changes. Compare cargo/payment invariants and same-version determinism, not old/new world hash parity. Retain exact per-publication and checkpoint parity for mode-off/refactor patches.

A browser pass must cover full/borrowed publication, source wait visibility, one successful trade cycle, capture/salvage, reconnect and final state agreement. The creator-hosted private-match path and server-hosted path are both consumers of the same option; test each actually used path. Target-host ARM measurements and deployment require their own environment/access. No local timings certify Oracle performance, and no live overload traffic is needed for the correctness pass.

## 20 Ordered implementation tickets

Each ticket states a deliverable and a stop condition so the implementer cannot declare success at an arbitrary intermediate point.

| Ticket | Required patch | Must pass before next ticket |
| --- | --- | --- |
| T00 | Recheck status/worktrees/chats/open PRs and record baseline SHA. Read linked prior contracts. Preserve the two existing plan documents. | No unexplained edits to implementation targets; intended base recorded. Do not switch to the historical optimization branch. |
| T01 | Add reproducible baseline harness and bounded telemetry. Archive checkpoint manifests and direct retained-path sizing. Write the parked-source regression against actual routing. | Telemetry changes no mode-off state/publications. Regression fails for its intended cause on baseline, not because of missing assets or timeout. |
| T02 | Extract shared `commitLoad`, wait helper and next-waypoint abstraction without enabling new behavior. | Existing focused suites and exact mode-off publication/checkpoint parity pass; no economy change. |
| T03 | Add option validation, private types, consumer owner/adapter and disabled-mode construction. | New owner maps to background caller `trade`, never actor lookup/interactive work. Omission preserves old serialized object shape. |
| T04 | Implement registry acquire/release/request states, callback fences, packing, hard/soft accounting and bounded queues. | All route/memory unit tests, wrong-callback tests, reference reconstruction and finite-work counters pass. No cargo writes in registry. |
| T05 | Implement port discovery/catalog continuations and pure nearby/allied policy. | Discovery restores identically, emits candidates before a full pass, respects read/move budgets and eventually explores outside nearest four. |
| T06 | Wire sea source dispatch and ready attachment with the old selector initially; route miss uses shared service. | Two ships cannot debit one full load, cancelled source leaders do not cancel other subscribers, more than 40 ready sources are not admission-throttled. |
| T07 | Implement active leg cursors, pinned outward trail, ready direct/retraced return and interrupted prefix. | Movement, exact return accounting and zero normal fresh-return-search assertions pass; no intermediate sales/waits. |
| T08 | Wire capture/source loss/salvage/death/pause/ownership cleanup and cycle wait evidence. | Every lifecycle phase conserves cargo/payment and releases counts; new owned receiver can rescue a prize despite paused trade. |
| T09 | Implement sub-checkpoint/portable state, post-planner validation and explicit offline converter. | Cold restore at each phase matches next work and future state; converted legacy voyage behavior is explicit; malformed links fail. |
| T10 | Activate final cheap policy within new mode; keep DTO projection private and AI bootstrap/evidence compatible. | Pure reference policy, UI/sparse/full publication, AI growth and accounting tests pass. Record deliberate income/return-length changes. |
| T11 | Run mature continuations, fresh seeds, memory churn, mixed human load and rendered-client checks. | All declared gates pass, or identify the specific design limit and revise that slice. Do not relabel a missed gate as complete. |
| T12 | Remove obsolete sea-only fallback/cache paths once caller-free; retain legacy mode and land cache. Update original contracts and durable evidence links. | Complete scoped review; no duplicated service, unresolved lane ownership or unbounded queue. |
| T13 | Enable `lanes-v1` in new normal local/creator-hosted and server match factories. | Full skirmish suite, TypeScript, skirmish and multiplayer production builds, scoped lint, diff checks, actual new-match option and reconnect smoke pass. No implicit push/deploy. |

T02/T03 can remain small commits; shared integration files have one serialized owner. T11 cannot be replaced by T04's isolated tests. A failing routing gate should identify which resource is saturated before any cap changes. Maximum path bytes, descriptor counts and public policy parameters are reported in each evidence manifest so tuning cannot escape review.

## 21 Commands and final review checklist

Use the repository-local executables from PowerShell if npm shims fail. Representative commands after new files exist:

```powershell
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts tests/skirmish/SeaTradePolicy.test.ts tests/skirmish/SeaTradeRoutes.test.ts tests/skirmish/SeaTradeReturn.test.ts tests/skirmish/SeaTradeLifecycle.test.ts tests/skirmish/SeaTradeCheckpoint.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts tests/skirmish/TradeFleet.test.ts tests/skirmish/SharedTradeRouting.test.ts tests/skirmish/PlannerActiveLimits.test.ts tests/skirmish/TradeReceiving.test.ts tests/skirmish/CheckpointPurity.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=4
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
node --import tsx scripts/buildMultiplayer.ts
git diff --check
```

Run all new test files as a group too; the first line is a quick subset, not the complete gate. Apply scoped Oxlint/ESLint to every changed implementation/test file using the installed project versions. Record known baseline failures separately; do not bypass a known release failure without the owner's explicit exception. Do not add tests which merely restate a helper's implementation or weaken timeouts to obtain green output.

Final code review must answer yes to all of these:

- Is one shared geometry request the only accepted request for a lane, even across owners and reverse direction?
- Can any source/actor cancellation accidentally erase another user's search or hard reference?
- Can soft source retention consume all recovery storage indefinitely?
- Does an unchanged ready lane bypass planner/management admission and avoid path copying?
- Can a return occur from an interrupted partial segment without teleporting or visiting the untravelled suffix?
- Can any intermediate retrace waypoint sell, pay, wait for handling or invoke new-market permission?
- Does any actor-private route state leak through either public projection?
- Are all capacity waits distinct from geographic impossibility and all retry ages preserved?
- Does cold restore reconstruct the same next queue/copy/search work, not just a visually similar fleet?
- Are new source catalog updates usable while building churn continues?
- Are every payload, metadata, subscription, discovery and cleanup structure bounded with independently checked counters?
- Do the mature/fresh workload results show actual launches, deliveries, empty returns and stable memory, rather than merely a lower CPU average?

Negative answers block completion. The implementation report links exact failing/passing evidence and leaves unrun hardware or browser gates explicitly open. This specification is sufficiently concrete to begin T00–T01; it does not claim that unimplemented algorithms or proposed resource defaults have passed their gates.

## 22 Audit evidence and remaining qualification

The 21 October document audit performed source/interface checks, current-checkpoint sizing, a cursor arithmetic check and a contradiction pass across both documents. It rechecked HEAD (`ea9514b1`), local changes, worktree inventory, returned active chats and open PRs. Only the two planning documents are new; the returned inventory shows no competing active chat or open repository PR. This remains a point-in-time visible-work check, not a lock on unpublished work elsewhere.

The reverse-prefix formula passed 10,100 combinations: path lengths 1–100, both orientations, every possible last-reached index. The generated prefix matched reversing exactly the visited outward prefix. This validates the indexing algebra, not map routing, interpolation, cargo settlement or a production return implementation.

Both checkpoints were reread to verify that their 128-entry cache limits bind at only 4,278/5,337 retained tiles. The recorded unique-path sizing and maximum lengths come directly from their actor arrays; consumed paths were not mislabeled as active movement. TypeScript example fences were syntax-checked, local Markdown links and whitespace were checked, and no production files were changed. Syntax checking examples is not type-checking an unimplemented cross-module API.

The 97-test/five-suite baseline result is the earlier 20 October run. No new production test pass or performance improvement is claimed by this document audit. T00–T13 specify the implementation and proof still required, including measured validation of the initial resource bounds, forward-compatible wait-detail transport, mature fleet progress and actual hosting-path qualification.
