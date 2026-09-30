# Simulation scaling

Status: proposed work, subject to profiling. September 30, 2026.

Increase supported populations only after correctness and integrated performance qualification. More factions add strategy and relationship work; larger tribes add movement, collisions, combat, capture, routes, and snapshots. The two pressures need separate and combined measurements.

## Domain and application boundaries

Retain one authoritative simulation and command path. Add purpose-specific match-owned projections for faction entities, forces, buildings/production, relationships, and regional facts. Their mutation inputs come from committed domain changes. Avoid a second persistent store that AI writes independently of the simulation.

The [force index](faction-force-read-model.md) is the first reusable projection. Supporting indexes should expose completed producers by owner/type, owned resource sites, candidate construction locations, active alliances, and current operations. Implement only the indexes justified by measured workloads.

## Capture: first measured bottleneck

The opening diagnostic spent about 27 ms per tick in capture. Each squad currently checks a radius of tiles, resolving its definition, searching all buildings, and allocating/tracing fortification segment tiles repeatedly. The index must preserve capture legality and contested ownership exactly.

Proposed sequence:

1. Resolve unit-level capture capability once per squad/phase. Hoist checks independent of the candidate tile without bypassing allied protection or special-unit restrictions.
2. Query defensive structures by tile using a lifecycle-maintained index. A building collection scan per candidate tile grows with buildings times squads.
3. Provide a shared barrier/reachability query with a cheap empty-topology path and versioned locality checks. Any cached answer must include relevant wall/gate and diplomacy revisions.
4. Reuse capture footprints when position and relevant topology are unchanged. Track contribution deltas or active pressure tiles to avoid clearing untouched world-sized arrays where profiling justifies it.
5. Consider per-faction coverage merging only after individual legality is preserved. Wall clearance depends on squad-to-tile geometry; a simple union of circular footprints is not equivalent.

Capture, movement, projectiles, traders, and route planning must consult compatible fortification policy. Share data and query primitives, not subtly different collision rules. Validate new gates, broken walls, alliance changes, embarked units, contested tiles, and betrayal timing before measuring speedups.

## Faction and relationship queries

Replace routine global `filter`/`find` work inside faction loops with indexed ownership, producer, and definition views. Do not rebuild them independently in AI, supply, diplomacy UI, and rendering.

Use a revisioned pair relationship lookup or adjacency representation for frequent hostility/alliance queries. Bilateral alliances stay non-transitive. Expiry/break updates the lookup at the authoritative tick. Avoid a full dense world-sized influence map per faction; use coarse regional facts and local queries.

Review repeated land-squad sorting and spatial rebuilds across simulation phases. Some rebuilds are necessary after positions change. Reuse a stage-valid index where consumers share the same position state; do not remove rebuilds across movement merely because their method names match. Reduce temporary Maps, Sets, arrays, and string-key creation where traces show meaningful allocation/GC costs.

## Scheduling strategy and production

Replace the fixed `% 20` progression schedule with explicit deterministic fairness across active factions. Use task queues with stable tie-breaking, bounded work units, age limits, and separate urgency classes. A busy faction must not starve others; an urgent threat must not wait behind repeated routine construction attempts.

Proposed starting cadence: faction strategy every 2-5 simulated seconds, army planning every 0.5-1 second, urgent threat reactions at the next eligible decision boundary. These are tuning proposals. Movement, physical collisions, damage, timers, and authoritative capture keep their defined simulation cadence.

Wake relevant planners on production completion, resource arrival/loss, research completion, treaty changes, attacked objectives, army losses, and topology changes. Coalesce repeated notifications within a tick. Waiting for a material should not cause a producer or planner to repeatedly scan all recipes every tick.

Use deterministic completion ticks for research/production/treaties where appropriate, preserving current ordering and resource consumption. Do not delay an actual delivery, timer expiry, or combat outcome merely because a strategic task queue is busy. Schedule callbacks with cancel/version tokens so destruction or capture cannot execute obsolete work.

A wall-clock budget may measure diagnostics, but it must not choose authoritative outcomes or different decision order on faster hardware. Multi-worker planning is later work after deterministic immutable inputs and result acceptance are established; it is not the first remedy for excessive scans.

## Movement and path work

Shared corridors, hierarchical routing, local avoidance, and passage coordination already exist. Persistent armies should share strategic destinations and planned corridors while preserving individual collision and deployment geometry.

Current route work drains 24 squad work units per tick, nominally 480 per second at target speed. That is a job-count budget, not a measured CPU bound. Add queue age, cancellation, replanning cause, path length, and route-cost telemetry. Distinguish urgent defence/navigation repair from routine frontier exploration, with fairness within classes.

Avoid reissuing nearly identical orders on each think cycle. Retain an operation until its target, route, threat, or readiness materially changes. Update frontiers incrementally or by dirty region/version rather than repeating whole connected-land analysis when the result is unchanged.

Dense local avoidance remains a separate scaling concern demonstrated by older stress fixtures. Profile neighbour count, candidate velocity tests, corridor density, and allocations. Keep swept collision safety and narrow-passage rules. Blindly truncating neighbours, reducing physics for off-camera armies, or changing movement based on renderer budgets is not acceptable.

## Defensive planning work

The required [defensive construction planner](ai-defensive-construction.md) must use dirty own-asset/structure/topology regions and a bounded shortlist of candidate layouts. Cache marginal coverage and access checks by relevant revisions; do not scan every frontier tile for every AI each tick. Qualify simultaneous tower/link/gate construction and breach-triggered army rerouting alongside ordinary movement. Defence planning budget and construction concurrency are explicit tuning values, not permission to alter combat or path legality under load.

## Snapshot and presentation work

The encoder's current tile delta detection scans the full map at every publication. Record dirty owner/claim/progress tiles or regions from authoritative mutations and emit each changed tile once per publication, including resets, surrender/inheritance, and restored state.

Coalesce command-triggered publication with the tick's publication where latency permits. A rejected command should not require serializing an unchanged world. Version expanded progression, inventories, trade, barriers, aircraft, and effects so unchanged data does not require full object-graph copying each tick.

Force summaries are compact DTOs keyed by stable definition IDs, with tick/revision and permitted knowledge classification. Do not send AI blackboards, exact hidden enemy indexes, production intentions, or full diagnostic histories. Define reset/removal behaviour and preserve interpolation for moving entities separately from slow-changing composition data.

Exact own/allied counts and enemy estimates require a knowledge adapter; see [force inspection](diplomacy-force-inspection.md). Snapshot filtering and battlefield visibility must be resolved together if the design is intended to hide enemy armies. A render-only estimate does not conceal raw exact data already delivered.

Keep MVVM: Views render labels/rows; ViewModels select and format DTOs; the worker/application adapter controls publication. Virtualize or bound long faction lists. Existing WebGL instancing is useful, but render FPS does not prove simulation speed.

## Faction ID expansion

Current eight-bit owner/claim/pressure arrays, with zero neutral and 255 contested pressure, permit faction IDs 1-254. Plan expansion before approaching this ceiling.

- Widen owner and claimant representation throughout simulation, paths/domain signatures, ownership/capture APIs, snapshots, decoders, and rendering. Capture progress can remain a separately bounded value.
- Represent contested pressure separately or reserve an explicit widened sentinel. Do not confuse the new maximum faction ID with that sentinel.
- Replace the current eight-bit tile packing. Two sixteen-bit IDs plus progress do not fit the existing thirty-two-bit packed value; use explicitly versioned fields/buffers or another validated encoding.
- Update setup validation, palettes, names, selection, faction lists, starting placement, alliance storage, and any index keyed by ID.
- Preserve stable IDs during tribe development; never reuse an eliminated ID within a match without a generation contract.
- Validate round trips around IDs 254, 255, and 256, including conflict, inheritance, allied gates, and reset. State the new supported cap separately from the representation's theoretical capacity.

## Qualification targets

At normal speed the complete worker cycle has 50 ms: simulation plus encoding/publication overhead. Seek headroom under that limit in p95 and sustained throughput, not only a favourable mean. Browser decode/rendering and input latency are separate required measurements.

For 4x speed, four authoritative steps and publication must fit the same interval if 4x is advertised at that population. Qualify it separately; a normal-speed result does not establish accelerated performance.

Use the staged matrix in [delivery and validation](delivery-and-validation.md). Proposed 120/240-faction trials are experiments, not supported limits. Stop raising populations when correctness, queue latency, memory, or sustained tick rate fails the chosen acceptance criteria.
