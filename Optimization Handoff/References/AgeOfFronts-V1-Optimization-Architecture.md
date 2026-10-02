# Age of Fronts V1 optimization architecture review

Prepared for Damien • 2 October 2026 • V1 commit 1f8df2d1535aa912fe3fdf525c34ec5692f6f432

## The recommendation

Keep the authoritative simulation, but make its expensive work explicitly bounded, make shared facts incremental, and stop rebuilding and shipping so much unchanged state. The end state is one predictable simulation owner per match, a separate bounded replication pipeline, and a browser that applies every necessary state change while rendering only the newest useful view. Build the AI war policy on top of that foundation.

I would not begin with a wholesale ECS rewrite, a different programming language, or distributing one match across many machines. V1 already has useful domain boundaries, spatial grids, terrain components, hierarchical routes, typed-array state and a substantial new bounded-planning layer. Those are worth building on. The biggest architectural weakness is that the limits do not yet cover the complete operation: a bounded queue can still contain an expensive synchronous job, and a small network packet can still require a large copy or scan to produce it.

The two-core Oracle machine should be treated as a one-serious-match qualification target initially. Extra RAM does not make a single simulation thread finish a 50 ms tick. No static review can promise perfect performance or certify a player count: the achievable envelope depends on map cells, total entities, concentrated combat, routes, structures, traders, wall tiles, clients and concurrent worlds.

### Five decisions I would make first

1. Record actual per-phase latency and memory on the Oracle ARM machine during ordinary play, including the failure reason. Separate a slow browser, a slow world, a terminated match worker and a restarted server process.
2. Finish and qualify the bounded planner before enabling it. Extend it to army commands, queued-leg activation, ships, transport, trade and structure approaches rather than enabling only the existing partial land path.
3. Introduce a match-owned change journal and lifecycle-maintained entity indexes. Use those changes for dirty snapshots, faction facts, diplomacy adjacency, cargo, resources and structure geometry.
4. Move compression and publication work off the simulation's advance dependency; retain a small ordered queue and explicit recovery. Reduce copying before introducing another worker.
5. Add AI peace, preparation and declared-war operations with event-driven border defence and geographically eligible diplomacy. This reduces strategic churn and makes AI more purposeful; it does not remove physical simulation or replication costs.

## Source and deployment boundaries

The exact branch is uppercase V1. It resolved to commit 1f8df2d1535aa912fe3fdf525c34ec5692f6f432, “Big Changes,” authored at 17:53:51 UTC on 2 October. Its parent is 900ba87a24325a0db3343d070bc0cbe6474e31db. All source references below are frozen to that commit, so ongoing local implementation cannot silently change the basis of the findings.

At approximately 18:04 UTC, the public game bundle /assets/game-k_gRmrV4.js identified live source revision 69a611440bc9d65c6e4fce0e0161e09083852d54. It still contains the old “This device cannot keep up with the match updates” failure and lacks the new match-state-applied flow-control message. V1 therefore must not be assumed deployed. A harmless /healthz read reported status ok and one active match. That proves the coordinator answered, not that a match was maintaining its target tick rate.

The current hardware premise is the user's reported 2 cores and 20 GB RAM on Oracle ARM. Repository deployment prose still describes 2 OCPUs and 12 GB. The exact VM shape, available memory, container limits, Node flags and deployed configuration need verification on that machine. V1's compose.yml and runnable server default both admit 3 matches; older prose says 1. Neither documentation nor the one-active-match health response establishes the deployed admission ceiling. [S01–S04]

This is a static architecture review. No game code, tests, load fixtures or live player actions were executed, and no repository code was changed, pushed or deployed. The historical command timings from an earlier x64 investigation are not measurements of this V1 or Oracle and are not used as capacity claims here. Current production error logs, worker memory curves and ARM profiles were not available.

## What V1 already improves

The new commit materially changes the earlier review. Repeating every old finding would be misleading.

| Area | Present in V1 | Remaining qualification |
| --- | --- | --- |
| Human land planning | MovementAdmission, FormationPlanning, RoutePlanner and a shared PlanningWorkspace provide checkpointed continuations, cancellation, result validation and bounded cleanup | deferredPlanning is deliberately opt-in and is not enabled by the production options; coverage and progress guarantees remain incomplete |
| Client state pressure | Worker-owned canonical state, coalesced presentation, a four-publication credit window, byte/count bounds and baseline recovery | Every decoded update still creates a full presentation clone; slow clients can trigger costly baseline generation |
| Placement preview | Visible 16-cell chunks, resumable 256-candidate passes, resource/building indexes and eviction of off-screen chunks | Signature construction still scans structures, walls and deposits; a candidate count is not a CPU bound for complex tower quoting |
| Land route reuse with walls | An unobstructed cached corridor is now validated against current obstacles before exact fallback | Finite-limit calls, including wall-aware trade, bypass this fast path; long corridor validation and blocked fallbacks remain synchronous |
| Formations | Reused occupancy scratch grid, spatial buckets for assigned slots and perimeter-only ring enumeration | Closest-member assignment is still quadratic; synchronous callers remain |
| Combat and capture | Tile-local building lookup, cached unit definitions, trench spatial queries, no projectile-index rebuild when no live projectile exists | Repeated stage indexes, full-map pressure clearing and busy-combat double rebuilds remain |
| Economy and defences | Shared budget/asset ownership, fair economic decisions, bounded city discovery, defence projects and build throttles | aiEconomy and aiDefenses are intentionally disabled in production options; candidate preparation and downstream commands are not all bounded |
| Rejoining | Separate worker-wait, baseline-capture and client-apply deadlines; the earlier one-second rollback assumption is removed | Recovery and control-transfer work still shares the match worker; no durable server-failure recovery exists |

These are architectural progress, not evidence that their integrated performance gates have passed. Protocol.ts explicitly labels deferredPlanning and aiEconomy as experimental pending qualification. [S05–S11]

## Why a match can deteriorate after twenty minutes

Time itself is not an obvious 20-minute cutoff in the active runtime. The likely pressure is the state accumulated by that point and the concentration of work, with several distinct failure modes.

### The serial online path

The coordinator schedules at 20 Hz. One worker request applies up to 100 accepted queued commands, advances one to four fixed ticks, optionally builds and encodes a snapshot, then returns. The worker chains requests through one promise, including asynchronous compression. LiveMatch allows one advance in flight. Consequently, both a synchronous planning pause and an awaited snapshot delay postpone subsequent world progress. Four-tick catch-up prevents an unbounded catch-up loop; it cannot make an overloaded world run at real time. [S01, S12]

Local play does not establish server headroom. It uses the player's CPU and local worker channel and avoids the online codec, hashing, gzip/base64 and server socket fan-out. The browser, server core, map, AI count and maturity can also differ. Smooth rendering is not evidence of 20 simulation ticks per real second.

### Separate the observed outcomes

- A client falls behind: the old live client exits after too many pending updates. The worker could still be healthy. V1 instead attempts controlled state recovery.
- The world becomes slow: simulation time falls behind wall time, planner queues age, or the worker spends too long serializing. Clients may render smoothly while orders respond late.
- A match ends: the worker adapter terminates on a 30-second request timeout or worker failure; CoordinatorServer then ends that match.
- The process restarts: an uncaught process failure, host/container OOM or operator restart requires separate exit and system evidence. It is not proven by the client message.
- A slow connection closes: CoordinatorServer closes a socket above 512,000 queued outbound bytes; that is separate from the browser's decode/presentation backlog. [S07, S12–S14]

### Growth that matters

The regular-faction squad cap rises from 60 in Stone Age to 200 in Modern. A 1-human, 14-AI, 30-tribe configuration can permit 1,200 fielded squads at Stone caps and 3,300 at Modern caps before tribe promotion changes the mix. These are arithmetic ceilings, not a prediction that they will all be fielded or a measured supported size. A squad represents up to 1,000 troops: performance scales principally with squad entities and interactions, not the troop number displayed on each entity. [S15]

As the match matures, additional costs include independent stacked buildings, producers/jobs, traders, longer materialized routes, more capture frontier, more warmed routing trees and more concurrent projectiles. New wall and naval AI can increase both the number of entities and the cost of each query. More clients mostly multiply replication/fan-out work; replacing AI seats with humans can reduce AI work while increasing command and network work. Count both separately.

## Prioritized weak points

Confidence here refers to the source mechanism. No row claims measured dominance on Oracle.

| Priority | Weak point | Why it matters | Evidence confidence |
| --- | --- | --- | --- |
| P0 | Missing operational separation of tick, command, encoding, queue and memory time | Cannot determine which limit actually ends the game or whether a change helps | High |
| P0 | Bounded planning remains opt-in and only partially covers routing | Large ordinary operations can monopolize an advance, even with queue limits | High |
| P0 | Simulation and publication share one serialized request lifecycle | Snapshot cost and recovery interfere with gameplay deadlines | High |
| P1 | Full-map/full-entity snapshot work and full client presentation copies | Costs grow with world size and entities even when few fields change | High |
| P1 | Trade routing budget checks only before a whole load and reads land work only | One load can exceed budget; water routes and other lifecycle replans evade it | High |
| P1 | Repeated global scans and rebuilds across domain services | Multiplies mature-world cost and temporary allocation | High |
| P1 | Walls increase exact routing, sweep and projectile work | Activating defences changes the cost regime, not just the building count | High |
| P1 | Naval cargo and shore operations have multiplicative scans and retries | Existing small fleets understate future naval AI cost | High |
| P2 | Every AI faction prepares strategic data every tick | Sleeping strategic operations and shared frontier facts can reduce unnecessary work | High |
| P2 | Memory grows with caches, world occupancy, paths and retained IDs | Heap limit and allocation pressure can bite before host RAM is exhausted | High mechanism; runtime impact unknown |
| P2 | AI diplomacy is throttled per pair but not per recipient/geography | Repeated offers are a design issue and unnecessary decision churn | High |

## Bounded planning must cover the entire transaction

### Active default path

LiveMatch constructs its MatchOptions without deferredPlanning. In that configuration, a human move still reaches synchronous formation planning, group routing and sometimes per-squad transport assessment. The new fast path handles only non-appended human moves whose selected squads are not in armies and are connected to the destination by static land topology. AI commands, army moves, water crossings, manual boarding, structure approaches and several continuation paths remain outside it. [S05, S16]

The default Shift path now avoids computing and discarding full routes when all selected squads are already executing orders. That is a real fix. It still synchronously assigns formation destinations, and finishOrder later computes a route per squad. Army-order still computes a leader route before its append branch. Sail now avoids speculative pathfinding for an already-moving ship's appended waypoint, but executing the next waypoint still calls waterPaths.find synchronously. [S16–S18]

RouteWork's 24-unit/20,000-effort budget checks after executing a whole job and measures only land path work. Water search, shoreline sorting, formation work, copying and lazily built hierarchy crossing trees are not comprehensively included. It is an admission/throughput limit, not a maximum pause guarantee. [S19]

### New planner strengths and limits

RoutePlanner is a good foundation: 128 jobs, 4,096 work units per step, 64-unit quanta, 256 preparation units, 32 LOS rays, a 65,536-slot shared search workspace, and budgeted path copying and cleanup. Each slot has 32 bytes of typed-array storage, giving a 2 MiB core workspace before Map/heap/path overhead. Unlike the older queue, it yields inside a search. [S06]

Four things need explicit qualification before rollout:

1. Coverage: route every expensive command class and automatic continuation through the same scheduler. A bounded first click is insufficient if its next queued leg, unload or army deployment can block.
2. Progress: the new planner performs exact sparse search and does not automatically reuse the old HPA corridor/cache. Its finite shared workspace can return limited. MovementAdmission keeps such work deferred and may submit it again. Measure oldest age and repeated limited outcomes; a queue that remains small but never completes is still a failure. Add deterministic escalation or corridor refinement, reservation of workspace among jobs, and a meaningful terminal/deferred outcome.
3. Equivalence: enabling the new connected-land fast path bypasses the later automatic transport-usefulness assessment for those orders. That can choose land where the existing policy would prefer a faster sea leg. Decide and test whether that policy change is intended; do not call a flag flip a semantics-free optimization.
4. Fairness: round-robin jobs are not automatically fair among players. One large selection can own many jobs. Schedule bounded command cohorts with per-player shares and separate urgent navigation, player intent, AI strategy and trade classes. Preserve deterministic tie breaks and prevent routine work from starving.

The command lifecycle should be cheap validation, intent admission, bounded plan construction, current-state revalidation, atomic commit, then a visible outcome. Replacement orders may supersede obsolete replacement work. Deliberate Shift orders must retain order. Costs and unit ownership must not partly mutate before all required members can commit. Pending work needs generation tokens, reason codes, age limits and checkpointable state.

## Simulation facts should be shared and incremental

Let M be map cells, U squads, B buildings, H ships, T traders, W wall tiles, D deposits, Q queued orders and P live projectiles. These quantities explain the major growth terms better than elapsed minutes alone.

| Stage | Current shape | Next architecture |
| --- | --- | --- |
| Capture | Full pressure clear O(M), then roughly O(U × capture footprint), plus active claims and wall checks | Active pressure tiles or generation stamps; reuse stationary footprints under position/topology/relationship revisions |
| Spatial indexes | Several O(U), O(H), O(B) rebuilds in different services each tick | Stage-valid shared read models; static structures updated on lifecycle changes; retain needed pre/post-movement versions |
| Supply | O(B + jobs + D) each tick, additional allocation passes each second | Producer/job indexes; event-driven completion ticks and ownership changes; dirty economic summaries |
| Frontier strategy | Per-faction preparation every tick; a cached whole-owned-component flood/sort every 60 ticks | Dirty border adjacency and resumable regional connectivity; strategy wakeups and deterministic cadence |
| Trade | Actor-to-building lookups and candidate sorting; up to 64 route candidates per load | Indexed stops, cached eligibility/route quotes, bounded resumable selection and retry lifecycle |
| Ships and cargo | moveShip scans all squads for every ship; transport step repeatedly filters cargo | cargoByShip plus owner/type/sea-component indexes; update only cargo actually aboard |
| Replication | O(M + U + Q + B + expansion graph) per publication, independent of changed cardinality | Change journal, entity revisions, dirty chunks and distinct fast/slow/static channels |
| Rendering | Global entity traversal before viewport rejection and repeated UI derivation | Viewport-first candidate index, retained render entities and revisioned HUD facts |

### Capture and structures

Capture's old building-array search per tile has been improved: building lookup is local, canCapture is hoisted per squad, and obstacle-free capture has a cheap path. However, pressure.fill(0) still touches the whole map every tick, and stationary squads recompute legal capture footprints. At one million cells, the pressure clear alone writes about 20 MB per second; that arithmetic does not imply it is the dominant cost. The expensive portion can instead be many repeated per-squad legality and LOS checks. Preserve contested pressure, allied protection and wall geometry exactly when making it incremental. [S20]

BuildingIndex is useful, but rebuilds every tick. Its ensure method detects collection-length changes, not every owner/type/completion mutation. Before replacing rebuilds with persistent counters, centralize spawn, completion, damage/removal, capture, refit, promotion, embark/disembark, surrender and restore notifications. Compare indexes to an independent reference scan in validation. Same-count replacements and owner transfers are important counter-drift cases. [S21]

### Shared stage indexes

Simulation rebuilds land spatial state before AI, before navigation and after movement; it also builds a held-unit grid. Battle rebuilds its own squads, ships, structures and trench coverage for fight, then again when live projectiles exist. Trade rebuilds its own capture grids when actors exist. These are real overlapping costs. Some ordering is necessary: combat removes entities, ships fight, and projectiles need current survivors. Reuse only indexes valid for that stage, and patch removals/ownership changes rather than deleting every repeated-looking rebuild. [S22]

Use a central faction/entity read model with entitiesById, owner/type sets, completed producers, cargoByShip, active timers, defensive structures, resourcesByOwner and relationship lookup. Keep the domain objects initially. Convert only measured hot fields to struct-of-arrays storage. A full ECS migration would add correctness risk before proving it is the limiting factor.

### Economy and strategic preparation

The new economic coordinator makes at most one faction decision every three ticks and waits at least 60 ticks before revisiting that faction. City facts are resumable. However, a decision still filters/sorts world entities, and the “eight placement tests” cap does not bound preparation: extraction can inspect deposits against buildings, port candidates can inspect owned coast edges against foreign ports, and ResourceSiteIndex.update constructs an O(D) geometry string each call. Legacy progression can sort many owned candidate tiles too. Bound candidate generation, not only the final eight validations. [S09, S23]

Supply already groups buildings and squads once for its second-level automatic allocation pass. Retain that improvement. It still scans deposits for ownership every tick, scans buildings/jobs and performs per-mine deposit finds. Use ownership-change notifications and the existing deposit index. Completion-tick scheduling can eliminate decrement loops for slow timers, provided simultaneous payment/completion/capture ordering remains unchanged. [S24]

## Walls and navy need their own readiness gates

### Walls are a change in routing conditions

The broad claim that any obstacle predicate disables all route caching is no longer true in V1. LandPaths.find now obtains a terrain corridor, checks its cells and diagonal sides against current hostility, and reuses it when clear. That is good. But blocked corridors fall back to exact search, long validations still scale with route length, and calls supplying a finite expansion limit bypass that new cache-validation path. Wall-aware trade passes 60,000, so it still follows the limited exact-search branch. [S10, S25]

Fortifications already has a tile index and coarse occupancy for weapon rays. Its physical clearMovement path uses swept-radius candidate construction and does not use the same empty-region shortcut before collecting segment tiles. Once any obstacle exists, repeated physical sweeps can allocate sets/arrays even far from the wall. Add a conservative radius-expanded coarse test and allocation-free local query, with proof against corners, gates and allied walls. [S26]

Fortifications.step rebuilds building/tower maps each tick and can reindex all wall tiles on changes. Global obstacle/diplomacy revisions invalidate every pending route after a remote wall or treaty changes. Region-level versions can prevent broad restart storms, but a cached route must depend on all regions it crosses, not merely start and destination. Alliance changes need a relationship revision; forest clearing needs cost revisions; destroyed walls and towers need immediate physical correctness.

Battle's trench coverage now uses local spatial candidates, so the earlier whole-squad-per-trench concern has been reduced. It still rebuilds coverage twice in ticks with live projectiles. Gun nests do a spatial target/LOS search whenever ready; with no target they do not advance their attack cooldown and therefore can search every tick. Missile interception scans buildings per strategic projectile, and blast damage scans all barriers and their tiles. Index those defensive classes and nearby wall segments. Sleeping empty sectors must wake in time for new enemies and projectiles. [S22, S27]

The new defence director already constrains one project per faction, up to 32 towers and 384 wall tiles per faction in its proposal policy, with at most one global construction action every 20 ticks. Those limits bound its proposed AI construction, not every human-built structure or the cost of a quote. It also leases real defenders and respects economic funds. Keep those safeguards. Validate simultaneous breaches, alliance changes, blocked routes, stationary gun nests and projectiles before enabling it broadly. [S28]

### Naval missions need a shared planner

ShoreTransport.useful can assess every selected squad separately. Each assessment may sort coast candidates, route across water and compare multiple land routes. ShoreRoutes uses a component graph, which is good, but its between method can consider departure/arrival combinations; wall constraints can add land-reachability searches. Transport start then repeats planning per capacity-sized batch and per passenger. Blocked landings retry every simulation tick, and unloading can fall back to repeated single-squad formation searches. [S29]

Regular ship movement scans all squads to update passengers, giving an O(H × U) term even for ships carrying nobody. Automatic transfer step also filters cargo by ship. Naval AI scans/sorts global ships and coast edges; each selected sail or continuation can route synchronously. These costs become much more important with active naval expansion. [S18, S30]

Introduce persistent naval missions: objective, stage, leased ships/passengers, departure/arrival regions, shared sea corridor, reservations, revision dependencies and retry conditions. Use the existing coast/component index to shortlist destinations; do not sort all coast edges per passenger. Share a mission corridor and route cohorts to local slots. Index cargo. Retry landings on occupancy/topology changes plus a bounded fallback interval, with staged alternative beaches. Preserve payment, capacity, atomic boarding, sinking and per-passenger order continuation.

### Trade is a first-class routing client

Trade's 15,000-unit load budget is checked before starting a full load and observes only land work. A naval load routes up to 64 destinations without contributing to that counter. Other select/reselect paths, including prize capture, missing destinations and blocked routes, occur outside the load gate. A 60,000-expansion per-search ceiling can still exceed a 15,000-per-tick objective in one call. This is a priority before more ports and naval activity. [S25]

Make route selection a resumable transaction with a versioned shortlist and lower bounds; preserve cargo accounting while it waits. Cache factory-to-port reachability, foreign ports by sea component, endpoint validity and repeat itineraries. Use explicit “not yet evaluated” versus “unreachable.” Limit aggregate route work across trade, human commands and AI, not separate nominal budgets that can all saturate the same tick.

## Replication and browser state

### Avoid work before reducing the wire size

Skirmish.snapshot slices all three map arrays and copies entity/queue presentation data. SnapshotEncoder scans every cell to discover tile deltas, encodes every squad and current/queued order, and emits extensive expansion object state. Deposits and roads already have sparse/revision handling, but deposit geometry is still rebuilt as a string and most other expansion fields are resent. Then StateCodec walks an object tree, creates JSON metadata, assembles buffers, compresses, hashes and base64-encodes. [S31]

For one million cells, the three source-array slices alone copy 3 MB per publication, about 15 MB/s at five publications per second, before scanning, encoding and browser copies. Squad numeric data is 56 bytes per squad plus 24 bytes per current or queued order. At 3,300 squads with no queued orders this is 264,000 bytes per publication before details, buildings, expansion state and compression. These are format-derived byte counts, not measured bandwidth.

Publish dirty tile chunks and entity changes from committed mutations. Keep compact movement/interpolation updates at the required cadence; send inventory/research/structure details only when their revision changes; send immutable map/deposit geometry once per version. Encode a shared payload once and fan it out with small client-specific sequence/epoch metadata. Binary WebSocket frames can remove base64 expansion and some JSON/string copying after the versioned protocol and migration plan are ready.

### Use the second core deliberately

A useful next boundary is simulation worker → immutable publication batch → replication worker/service → socket delivery. The simulation must capture a coherent tick without handing mutable objects to a worker that can observe later changes. Transfer compact owned buffers or publish through a double-buffer/version protocol. Do not structured-clone the entire simulation at every tick to “offload” it.

Start with a bounded number of pending replication batches. Coalesce state changes before encoding when no client depends on discarded intermediate deltas; preserve event IDs and a complete change union. A blocked encoder must not grow a queue of full snapshots. All clients receive an ordered base/sequence contract. Initial join and recovery should use a cached coherent baseline plus bounded subsequent deltas where possible.

This can use spare second-core capacity, but it is not free parallel speed. Compression may already use background facilities; IPC copies, memory bandwidth, coordinator work and multiple matches compete for the same two cores. Measure whether reduced simulation waiting outweighs transfer overhead before keeping another worker.

### The new client is halfway to the right model

V1 correctly keeps a canonical SnapshotDecoder in the decoding worker, merges dirty-tile knowledge across skipped views, and lets the main thread coalesce presentation. However, multiplayerStateWorker calls stream.presentation for every decoded packet. That method structuredClone's the entire canonical snapshot, then transfers three map buffers to the main thread. Transfer avoids another copy of those buffers; it does not eliminate the clone that made them. Other fields still undergo worker messaging serialization. Dropped presentation views have already paid much of that cost. [S07]

Make presentation pull/credit-driven: apply all required deltas in the worker, then materialize only when the renderer is ready. Prefer stable render entities and dirty chunks, with two bounded interpolation samples for moving objects. Reuse static roads/deposits and memoized own-faction facts. Main-thread updateHud still derives many getters and scans on every presentation, and render traversal prepares squad artwork before viewport rejection. Use viewport-first coarse candidates and avoid building closed-panel data. Existing 30-FPS large-population mode and graphical LOD are useful, but do not reduce authoritative physics based on camera position. [S32]

Four-frame flow control and recovery prevent unlimited backlog; they do not guarantee a slow client can process the newest baseline. A slow client currently queues client-baseline work on the same simulation worker, with one recovery drained at a time. Track baseline cost and repeat recovery, rate-limit/cache baseline work, and adapt presentation publication without skipping dependent canonical deltas. Preserve the existing safety limits rather than merely increasing them. [S08, S33]

## Memory and failure containment

ReservedMatchWorker sets maxOldGenerationSizeMb to 384. This is a per-worker JavaScript old-generation ceiling, not a 384 MB total-RSS limit. Node documents that ArrayBuffers are outside these resource limits and that process-wide OOM can still occur; Node flags can affect the effective heap limit. Confirm the actual runtime rather than assuming the VM's 20 GB is available to every match. [S12, S34]

Land and water pathfinders each allocate five four-byte map arrays, plus two one-byte topology arrays. At one million cells that core static state totals approximately 44 MB across the two pathfinders, before hierarchies, route caches, largest-component arrays, map/forest data, spatial indexes and domain objects. Portal crossing trees retain cost/parent buffers per portal, growing as they warm. They are map-bounded caches, but their full resident size should be measured and explicitly budgeted. [S35]

Route caches are bounded to 16,384 entries and 2,000,000 tiles per pathfinder. Roads cap new cosmetic tiles at 20,000; events retain 80; movement admission events retain 128; projectiles cap at 4,096 and remove expired impacts. Commands, duplicate IDs and state windows are also capped. The current online path does not use the legacy HostedRuntime checkpoint/delta verifier loop, so it would be wrong to blame continual full simulation checkpoints or replay history for the live problem. [S01, S06, S13, S36]

There is one concrete lifetime-retention item in new V1: orderRevisions is updated by squad ID but has no ordinary death cleanup. Dead squads are removed and navigation/detour state is cleaned, while old order-revision entries remain until match destruction or restore. Its size can follow ever-ordered squad IDs rather than live squads. This is worth fixing and measuring, but it is not evidence that it explains the reported failures. Other retained structures include explored spatial buckets and ownership/coastal sets; distinguish finite map growth and useful caches from accidental retention. [S37]

The target is a memory ledger per match: heap-used/heap-limit, external/ArrayBuffer bytes, total process RSS, active path tiles, cache tiles/trees, live and historical-ID map sizes, pending work and publication bytes. Normal gameplay should reach a stable band after world activity stabilizes. Do not remove worker limits blindly. Size them from measured peaks plus explicit headroom and the number of admitted matches.

One worker per match already isolates many JavaScript failures from the coordinator, but worker termination loses that world. For durable recovery, later add periodic versioned checkpoints and a bounded append-only accepted-command journal with sequence IDs, crash-consistent writes and restore validation. Keep checkpoints off the critical tick path. This is a reliability project, not a prerequisite to every optimization, and it must not reintroduce per-publication full-world checkpoint work.

## AI war state and bounded diplomacy

### The idea is sound if it controls decisions and operations

Today Diplomacy.hostile means two nonzero, non-allied factions. That predicate is shared by combat, capture, walls, trade capture and other physical rules. Changing it to “only declared wars are hostile” would change human mechanics and could make an unannounced invading player immune. Keep that physical/legal relationship rule unless a separate gameplay change is deliberately approved. [S38]

Instead, introduce an AI strategic policy keyed by rival: peaceful, preparing, active war, defensive response and cooling down. An AI chooses at most a small number of offensive operations and must declare before deliberately violating another faction's territory. Human move, attack, capture and alliance mechanics retain their present rules. An invasion or hostile damage immediately activates defensive response even without a declaration.

This should constrain both objectives and the route itself. A route to a neutral tile must not cross an undeclared rival's border, and a squad's capture radius can touch foreign land before its centre crosses the boundary. Define violation from relevant footprint/capture/contact rules rather than only the squad's centre tile. Incidental combat, allied access, naval landing, neutral expansion and defensive pursuit need explicit policies.

### What can sleep

- Peaceful AI can avoid global enemy selection, offensive coast searches, raid formation work and frequent force-composition reconsideration.
- Preparation can cache one target region, force objective, logistics requirement and production plan until material evidence changes.
- Active war can restrict strategic candidate search to declared fronts while local units retain immediate collision, legal combat, capture and incoming-threat handling.
- Cooldown can suppress new offensive operations without disabling self-defence or cancelling already-paid lifecycle obligations.

What cannot simply sleep: moving units, actual collisions, incoming projectiles, capture pressure, legal damage, transport state, economic completions and canonical network state. The cost will fall only if sleeping strategic states actually prevent work before the scan/query occurs.

Current AI already spreads individual squad decisions over 15 ticks. It nevertheless builds own-squad groupings, per-faction enemy lists, frontier checks and reserved destinations every tick. HomeTerritory caches a flood/sort for 60 ticks, and many factions can expire together because the calls start together. Replace those periodic global preparations with dirty regional facts and staggered decision scheduling. [S39]

### Detect invasion without scanning every unit against every faction

At the authoritative movement/capture/damage commit, update a coarse region occupancy/ownership index and emit coalesced threat facts: hostile unit entering defended territory, capture pressure on a border, damage to an owned entity, a hostile landing or projectile approach. Maintain each faction's relevant border and coastal sectors. Wake only affected planners and nearby defensive units. A bounded periodic local probe is a safety net for missed or initially present threats, not a full-world per-faction scan.

Do not wait for a tile to finish changing owner before reacting. Conversely, do not treat an allied unit as an invasion. If fog or intelligence limits are intended later, use an explicit knowledge adapter for strategic estimates; current full-world arrays otherwise let the AI inspect exact enemy state. Changing what information is available is a separate game-design decision.

### Selective build up

A persistent ThreatAssessment can contain neighbouring faction, reachable front, last observation tick, estimated force classes, confidence, own mobilizable force, logistics, available counters and operation commitment. Feed this into the existing economy budget and asset-lease coordinator. Use uncertainty and minimum plan lifetime so a single observed unit does not cause repeated refits/research churn. Defensive capacity, siege need, transport availability and replacement production should determine readiness, not raw squad count alone.

Preserve personalities: aggressive AI can prepare sooner or tolerate lower confidence; cautious AI can prefer a larger reserve. Bound offensive fronts, not defensive enemies. Include anti-dogpile weighting and a cost for abandoning a campaign. Border hopping must not repeatedly reset the response, and a peace/cooldown state must not permit free hits or block retaliation. An AI can disengage when a threat genuinely ends while remembering recent aggression.

### What diplomacy currently does

- A directed proposer-recipient pair has a 600-tick cooldown: 30 simulated seconds.
- An offer lasts 400 ticks: 20 seconds. An existing outgoing offer to the same recipient is rejected as already pending.
- Rejecting removes the offer; it adds no new decline cooldown. The original 30-second timer remains, so rejecting late in its life can leave a relatively short wait.
- Breaking an alliance creates a 600-tick betrayal penalty; it is not a dedicated bilateral no-contact timer.
- Alliances last 6,000 ticks: five minutes. Renewal opens in the final 600 ticks and adds another 6,000 when both agree.
- Proactive AI offers occur only in allied-conquest mode, after 1,800 ticks, and only for personalities with an offer interval. Configured intervals are 1,200, 1,800 or 2,400 ticks: 60, 90 or 120 seconds. Others never proactively offer.
- Candidate acceptance checks living regular status, betrayal, partner land ratio and the proposer's ally limit. Candidates are then sorted by base-to-base distance. There is no adjacency/reachability eligibility limit and no global/per-recipient offer quota. [S38, S40]

Thus the issue is not the absence of all cooldowns. Several AIs can each be behaving within their own throttle and still repeatedly choose the same player. The source does not prove duplicate UI notifications; distinguish unique offer IDs/proposers from repeated presentation of one offer when collecting evidence.

### Initial policy values to try

These are design starting points, not benchmarked optimums. Keep them configurable and scale distance through regions/connectivity rather than raw map size.

| Policy | Proposed starting value |
| --- | --- |
| Peaceful strategic evaluation | Every 3–5 simulated seconds, staggered, or on a material event |
| Active operation reconsideration | Every 0.5–1 second; immediate defensive wake at the next authoritative boundary |
| Geographical shortlist | Up to 4–8 eligible neighbours/fronts; shared land frontier first, then reachable coastal/sea region |
| Offensive commitments | One active offensive war per AI initially; defence can respond to multiple aggressors |
| Preparation commitment | 20–60 seconds with emergency cancellation; end on readiness or expiry, not endless saving |
| AI outgoing diplomacy | At most one pending offer per proposer and one new offer per 2–3 minutes |
| Offers received by a human | At most one new AI offer per 60 seconds and two pending AI offers total |
| Declined pair | 3-minute bilateral AI re-offer cooldown, starting at rejection |
| Expired pair | 2-minute AI re-offer cooldown, starting at expiry |
| Broken treaty | 5-minute AI re-offer cooldown, while retaining the existing physical betrayal mechanics |
| Global diplomacy work | One bounded evaluation slice per tick; at most one new AI offer per second |

The cooldown additions should constrain AI-generated offers, not silently change the user's current manual alliance controls. Choose neighbours by current shared borders and reachable theatres, not merely original base distance. Ports in the same connected sea can make a non-land-neighbour strategically relevant; a nearby base across impassable mountains may not be. Store pair deadlines and recipient windows in authoritative AI policy state with stable tie-breaking and proper restore behavior.

## A practical end state on two cores

The simulation worker remains the sole mutable owner. It commits commands, fixed-step physics/combat/capture, timers and deterministic scheduled work. One coalesced change journal updates read models and supplies replication. Pure route/AI jobs consume explicit operation budgets; results are revalidated against generations and regional versions before commit.

The replication side consumes coherent tick batches, handles encoding/compression and bounded client state windows, and isolates per-client slowness. The coordinator handles admission, authentication and routing. The browser decoding worker maintains canonical state and emits requested, coalesced render changes. The renderer maintains stable display state and uses viewport/quality LOD without changing the world.

Keep the following boundaries explicit:

- Physical correctness runs at its defined fixed cadence. Strategic AI can think less often; cosmetic views can run at 30 FPS. Off-camera combat cannot be cheaper in a way that changes outcomes.
- Wall-clock timing is telemetry. Deterministic work counters choose planner progress; faster hardware must not select different authoritative outcomes accidentally.
- A pure off-thread calculation receives immutable, versioned input. It must not mutate the simulation. Acceptance order and stale-result handling must be deterministic.
- Static map data can be immutable and shared. Mutable territory/entity state requires ownership, buffer transfer or a carefully versioned shared-memory design. SharedArrayBuffer is not a shortcut around synchronization.
- The current one-worker-per-match model is a good first boundary. Splitting combat or movement within a match introduces deterministic ordering and synchronization costs. Consider it only after profiles show a parallelizable phase still dominates after indexing and scheduling.
- If a single match still exceeds one core's budget at the desired scale, reduce work, establish a smaller supported envelope or use stronger hardware. More match workers on two cores do not create more compute.

### Suggested performance contract

At 20 Hz the whole serial critical path has 50 ms per tick. At five snapshots per second, a publication occupies part of a 200 ms interval. Do not treat “simulation step under 50 ms” as sufficient if commands, snapshot creation or GC consume the remaining time.

An initial engineering target could be p95 ordinary tick critical-path work under 30–35 ms, p99 under 50 ms, and sustained simulated/wall-clock ratio at least 0.98 during normal-speed play, excluding intentional pauses. Reserve headroom for publication, commands and GC. These are proposed release targets, not current results or guarantees. Investigate any persistent p99 violation and any oldest-planner-age growth rather than hiding it in averages.

Track command acknowledgement separately from execution. Suggested initial responsiveness targets are under 100–200 ms for cheap accepted-intent feedback and under 0.5 seconds p95 for ordinary short movement admission, with explicit progress and bounded expectations for long complex routes. Tune these only after representative ARM measurements. “No crashes” with 20-second orders is not a successful release.

Report supported combinations, for example map/content version, live factions, U/B/H/T/W/P, density hotspot, clients, features and concurrent matches. Never publish “supports 20 players” without the world configuration. The safe concurrent-match number is constrained by aggregate CPU, memory and network headroom and each match's single-core critical path.

## Rollout plan and acceptance evidence

### Minimum viable milestone

The first useful milestone is one ordinary multiplayer world that sustains the agreed late-game envelope on the actual Oracle machine, with bounded movement/continuations, no browser backlog failure, and a recorded explanation for any missed deadline. It does not require replacing every object or building a multi-server platform. Keep experimental wall/naval expansion gated while closing this milestone, then qualify each additional workload.

Telemetry is a small-to-medium integration. Completing planning coverage and lifecycle indexes are large refactors because they touch many mutation paths and correctness tests. Dirty publication and retained browser views are medium-to-large protocol/presentation work. A replication-worker split is a separate medium-to-large concurrency change. The AI war policy is a medium strategic-system change once threat and relationship facts exist; it becomes larger if it also introduces fog, new damage rules or campaign diplomacy. These are scope estimates, not delivery dates. Keep each boundary reviewable and independently reversible.

### Phase one Establish a trusted baseline

Instrument the production execution path rather than the unused legacy host verifier. Record a bounded rolling histogram and occasional structured summaries; avoid per-entity/per-tick log floods. Include:

- Command validation/admission time and count by class; worker queue wait; ticks advanced; scheduling lateness and simulated/wall-clock ratio
- Simulation phase time: progression/supply, AI, routing, movement/avoidance, combat, capture, transport/trade, recruitment and cleanup
- Snapshot capture, tile/entity extraction, pack/JSON, compression, hashing, worker transfer, coordinator serialization and socket fan-out time/bytes
- Per-worker heap/external/ArrayBuffer memory, process RSS, GC duration, worker errors/exits, timeout operation and server/container restart cause
- U/B/H/T/W/D/P/Q, active battles, neighbour candidate counts, path lengths, routing work/cache/fallback counts and hierarchy resident trees
- Planner queue age, limited/superseded counts, work by caller/player and completed versus accepted intents
- Browser decode, canonical apply, clone/transfer, presentation/HUD, frame time, queue age/bytes, recovery count and socket close reason

Expose separate liveness and match-progress diagnostics. A healthy HTTP server must not conceal a stalled worker. Correlate records by match ID, source/runtime version, tick and publication sequence. Use the actual Oracle hardware and the actual players' browser class for capacity decisions.

### Phase two Close the remaining blocking paths

Finish the bounded command lifecycle, starting with common movement and queued-leg activation, then armies, transport/ships, trade and structure approaches. Add progress/backoff/escalation for resource-limited exact searches. Retain the default path for controlled comparison until behavior and performance gates pass. Enable one coherent feature set at a time; do not combine new economy, wall AI and naval operations with a replication rewrite in one unmeasurable release.

### Phase three Reduce work at the source

Build the change journal and shared indexes. Prioritize dirty snapshot extraction, cargoByShip, resourcesByTile/Owner, producer facts, stage-valid combat structures and relationship lookup. Replace repeated string signatures with explicit revisions. Move frontier connectivity and large strategic candidate searches into bounded regional jobs. Optimize allocation hot spots demonstrated by profiles; use typed arrays or arenas selectively.

### Phase four Separate replication and improve presentation

Define protocol version, base sequence, removals and reset semantics first. Then move encoding/compression behind coherent compact batches and add binary framing if it pays. Make the browser request render projections only when ready. Cache recovery baselines and measure recovery under ordinary slow-client conditions. Test reset, coalescing and join barriers without missing changes that revert between publications.

### Phase five Add strategic war policy and qualify new systems

Introduce AI-only operation states, threat events, neighbour facts and bounded offers. Connect selective production/research to those facts. Qualify wall and naval policy separately, then together with mature-world combat, trade and rejoining. Current experimental flags and defence caps are useful rollout controls; keep a migration/rollback strategy for newly persisted planner state.

### Phase six Increase capacity only with evidence

Use representative ordinary-play sessions that cover the intended session duration and late-game stage, not only opening minutes. Include multiple maps/seeds and intended maximum configurations, slow clients, real combat density, navy, walls, ally changes and join/leave transitions. If one normal-play world cannot sustain the contract, do not raise concurrent admission from one to three. Record the reason a capacity tier fails and keep the last proven tier.

### Correctness gates

- The same accepted commands produce equivalent authoritative outcomes where an optimization promises equivalence; intended AI-policy changes are evaluated separately
- Cached results invalidate on relevant ownership, completion, removal, forest-cost, wall/gate and bilateral-alliance changes
- Pending commands survive save/restore, controller transfer and cancellation without partial payment or unit mutation
- A bounded planner both respects its work budget and makes eventual progress; resource exhaustion is not misreported as physical impossibility
- Shift order order is preserved; replaced intent cannot later reappear; no faction or command class is starved
- Cargo, trade payouts, building stacks, captures and damage reconcile through lifecycle changes
- Coalesced views retain all relevant dirty changes, removals and event identities; late baselines do not rewind current canonical state
- Long ordinary sessions show a stable memory band for comparable world cardinality; historical-ID collections are explicitly bounded or cleaned
- Full regression/build/type checks and integrated ARM/browser performance checks are recorded against the exact candidate SHA before release

## Decision checklist

The first implementation slice I recommend is telemetry plus complete route admission, followed closely by dirty replication and cargo/entity indexes. Those address the current runtime weaknesses and create the foundation that wall/naval AI needs. The war-policy and diplomacy work should be designed now and integrated after those contracts, rather than used to hide an unbounded planner.

Before declaring the target architecture complete, answer these questions:

1. Which exact event ends the current live sessions: client backlog, worker timeout, worker heap termination, socket pressure or process restart?
2. What are the actual Oracle CPU/RAM/container settings and live match-admission ceiling?
3. Which map sizes, faction/tribe counts, late-game entity counts, clients and simultaneous matches are the product's promised envelope?
4. Should faster same-continent sea routes remain part of ordinary move semantics when deferred planning is enabled?
5. What must an AI declaration govern: deliberate targeting, border crossing, capture footprint and defensive pursuit?
6. What enemy information may strategic AI use, and will future client visibility match that policy?
7. Is durable recovery after a server restart required now, or a later reliability milestone?
8. What measured p95/p99 latency, queue age, memory and long-session results must pass before enabling economy, walls and naval operations together?

## Source inventory

All S references below point to the frozen V1 source unless a live or external source is explicitly identified. Line anchors are entry points; the surrounding method supplies the full context.

- S01 [LiveMatch scheduling and publication](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/LiveMatch.ts#L607-L675) and [worker execution](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts#L144-L183)
- S02 [Oracle compose](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/deploy/oracle/compose.yml#L1-L18) and [server defaults](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/server.ts#L15-L25)
- S03 [Oracle deployment prose](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/docs/OracleDeployment.md) and [runtime notes](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/docs/ServerAuthoritativeMultiplayer.md), which contain stale descriptions identified above
- S04 [Public live game bundle inspected](https://www.ageoffronts.com/assets/game-k_gRmrV4.js) and [health endpoint](https://www.ageoffronts.com/healthz), observed 2 October 2026 around 18:04 UTC
- S05 [Experimental options](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Protocol.ts#L339-L355) and [production options](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/LiveMatch.ts#L120-L143)
- S06 [RoutePlanner](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/RoutePlanner.ts#L55-L84), [budget loop](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/RoutePlanner.ts#L148-L301), [workspace](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/PlanningWorkspace.ts#L1-L40), [admission outcomes](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/MovementAdmission.ts#L279-L306)
- S07 [CanonicalStateStream](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/CanonicalStateStream.ts), [decode worker](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/multiplayerStateWorker.ts), [client queues and presentation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/OnlineMatchSession.ts#L101-L121)
- S08 [ClientStateFlow](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/ClientStateFlow.ts)
- S09 [Economic cadence](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiEconomicDirector.ts#L119-L137) and [city work](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiCityRecords.ts#L161-L240)
- S10 [Obstacle-aware cache validation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Pathfinding.ts#L124-L164)
- S11 [Join phases and cancellation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/LiveMatch.ts#L344-L457)
- S12 [Worker limit and request timeout](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts#L15-L80)
- S13 [Command bounds](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/LiveMatch.ts#L512-L535)
- S14 [Socket limit and sending](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L160-L179) and [match failure handling](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L421-L460)
- S15 [Faction caps and defaults](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/FactionRules.ts) and [tick and entity constants](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Protocol.ts#L17-L26)
- S16 [Human order branches](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L710-L802) and [queued activation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L857-L873)
- S17 [Army routing before append](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Armies.ts#L357-L398), [formation assignment](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Formations.ts#L157-L257) and [structure approach](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Expansion.ts#L629-L707)
- S18 [Sail admission](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L1323-L1377) and [ship continuation and cargo](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L1660-L1695)
- S19 [Legacy RouteWork](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/RouteWork.ts#L16-L37), [drain integration](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L210-L227) and [hierarchy work accounting](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/HierarchicalPaths.ts#L48-L50)
- S20 [Capture](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L2994-L3061) and [capture legality](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Expansion.ts#L1486-L1512)
- S21 [BuildingIndex lifecycle](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/BuildingIndex.ts#L25-L67) and [ownership commit](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L3069-L3091)
- S22 [Simulation stages](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L2213-L2340), [battle indexes](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L152-L181) and [projectile rebuild](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L616-L624)
- S23 [Economic snapshot](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiEconomicSnapshot.ts#L50-L105), [candidate preparation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiPlacementCandidates.ts#L78-L171), [resource signature](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/ResourceSiteIndex.ts#L12-L34)
- S24 [Supply work](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Supply.ts#L199-L389)
- S25 [Trade route selection](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Trade.ts#L124-L233), [load budget](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Trade.ts#L310-L377) and [retry lifecycle](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Trade.ts#L505-L577)
- S26 [Fortification physical sweep](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Fortifications.ts#L166-L210) and [tick maintenance](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Fortifications.ts#L263-L326)
- S27 [Nest targeting](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L519-L556), [missile interception](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L632-L650) and [wall blast scan](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L999-L1023)
- S28 [Defence caps and quote](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiDefenseDirector.ts#L190-L248), [cadence](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiDefenseDirector.ts#L490-L521), [build throttle](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiDefenseDirector.ts#L683-L707)
- S29 [Shore assessment and start](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/ShoreTransport.ts#L53-L170), [landing retries](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/ShoreTransport.ts#L234-L266), [coast search](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/ShoreRoutes.ts#L108-L160)
- S30 [Naval AI](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L3462-L3586), [unload fallback](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L1610-L1657) and [static coast index](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/CoastIndex.ts)
- S31 [Snapshot copies](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L3732-L3769), [snapshot encoding](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/SnapshotCodec.ts#L75-L249), [expansion snapshot](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Expansion.ts#L1527-L1556) and [state codec](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/StateCodec.ts)
- S32 [Presentation and HUD](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/main.ts#L682-L805), [render preparation](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/Renderer.ts#L1193-L1236) and [bounded placement](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/client/PlacementPreview.ts#L263-L325)
- S33 [Per-client recovery](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/multiplayer/application/LiveMatch.ts#L773-L809)
- S34 [Node 24 worker resource limits](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options), primary documentation
- S35 [Pathfinder map arrays](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Pathfinding.ts#L39-L78), [topology arrays](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/PathTopology.ts#L12-L30), [crossing trees](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/HierarchicalPaths.ts#L197-L238)
- S36 [Road cap](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Roads.ts#L19-L53), [projectile cap](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Battle.ts#L186-L205), [event retention](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Expansion.ts#L113-L120)
- S37 [Order revisions](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L844-L854), [death removal](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L2988-L2991) and [navigation cleanup](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L2311-L2316)
- S38 [Diplomacy rules and cooldowns](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Diplomacy.ts#L20-L128)
- S39 [AI preparation and squad cadence](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/Simulation.ts#L3109-L3289) and [frontier cache](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/HomeTerritory.ts#L26-L86)
- S40 [AI diplomacy selection](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/Expansion.ts#L1158-L1230), [acceptance policy](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/domain/AiPersonality.ts#L76-L90) and [personality intervals](https://github.com/ELDamien3570/AgeOfFronts/blob/1f8df2d1535aa912fe3fdf525c34ec5692f6f432/src/skirmish/content/AiPersonalities.ts)
