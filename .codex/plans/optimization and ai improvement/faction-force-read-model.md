# Faction force read model

Status: proposed architecture. September 30, 2026.

The user requested queryable records of every soldier type used by each faction so AI can make better decisions. This document defines the live composition projection and distinguishes it from historical logging. Diplomacy must show exact own/allied counts and estimates for enemies.

## Authority and ownership

Authoritative squads, ships, aircraft, structures, and their domain lifecycles remain the source of truth. A match-owned force projection indexes committed entity state. AI and presentation consume immutable views; neither can recruit, kill, transfer, or refit a unit by editing a counter.

Maintain the projection in the simulation worker, near the application boundary coordinating lifecycle changes. It is derived data and can be rebuilt from valid match entities after loading. Do not turn an entire faction and all of its units into one giant new mutable aggregate merely to make counting convenient.

The proposed `FactionForceIndex`, query methods, and event names below describe contracts, not implemented types. A change journal may apply coalesced deltas without allocating one object per tiny health change. An event-sourced rewrite or database is unnecessary.

## Count semantics

| Metric | Meaning |
| --- | --- |
| Live formation count | Number of living land squad entities. A depleted squad counts as one formation until it is destroyed. |
| Live troop strength | Sum of each living land squad's actual `troops`, not formation count multiplied by 1,000. |
| Live squad capacity | Sum of each living squad's actual definition-specific maximum strength. Tier-based capacity and current strength stay separate; research/army membership does not refill soldiers. |
| Naval vessel count | Living military warship/transport entities by vessel definition; hull health is tracked separately. |
| Aircraft count | Living aircraft entities by definition, including airborne and returning aircraft. |
| Reserves | Unrecruited manpower in the economy; never counted as fielded troops. |
| Refit count | Existing units undergoing refit, not newly created replacement formations. |
| Recruitable types | A separate capability query; unlocking a type does not create a live force entry. |
| Equipment and payload stocks | Supply inventory, not units. A MIRV launcher is distinct from its stored missiles. |
| Defensive structures | A separate structure summary. Towers, gun nests, trenches, fixed launchers, and missile defence are not soldiers. |
| Civilian traders | A separate economy/logistics summary, including trade ships. Do not inflate military fleet counts with civilians. |

Use the current game's formation model honestly. A tank squad row should say "Tank formations" unless the domain gains an authored physical vehicle-count model. Do not infer a thousand tanks or aircrew from the land `troops` field or ship/aircraft health.

The [Armies plan](armies-formations-and-squad-sizes.md) adds domain membership as a secondary query dimension. A squad contributes once to its faction totals regardless of army assignment. Refits change capacity/definition and reset XP, while retaining surviving strength under the proposed refit policy; all three changes invalidate relevant summaries. Enemy army markers must not expose hidden exact members or capacity beyond the eventual observation contract.

## Keys and dimensions

The primary live index is faction ID -> entity domain -> stable content definition ID. Domain names distinguish land, naval, and air definitions even if their string IDs later overlap. A per-entity contribution record uses a domain-qualified entity ID, so independently numbered entity collections cannot collide.

Each definition entry exposes:

- Definition ID and metadata reference; resolve localized name, art, age, line, role, and target tags from content.
- Live count and troop strength or hull/aircraft health totals, according to domain.
- Embarked, refitting, and operational-state counts where the domain has reliable state.
- Promotion distribution across the seven levels for promoted unit domains, not an invented average star level.
- Summary revision and committed simulation tick.

Retain older-age definitions after advancement. A Bronze swordsman and Classical infantry are separate entries even when both use the `infantry` input line. Culture variants also remain distinct by authored definition ID. For legacy entities missing a definition ID, resolve the existing fallback once on registration; do not infer current-age units from the faction's age.

Broad filters such as melee, mounted, vehicle, siege, artillery, anti-air, naval, and air are content-derived views. Tags can overlap and must not be added together to produce the total. Current `kind`/`line` alone is insufficient: a tank may share a cavalry recruitment line while its target tags identify it as a vehicle.

## Lifecycle updates

| Committed change | Projection action |
| --- | --- |
| Initial spawn / successful recruitment | Register the entity once with its actual definition, owner, strength, and state. |
| Successful recruitment command rejected | No change. Requested or queued production is not a living unit. |
| Combat damage | Apply the actual post-resolution strength/health delta, after simultaneous damage is resolved. |
| Replenishment or healing | Add only actual replenished strength. Reserve production belongs to a separate economy projection. |
| Death, sinking, or aircraft loss | Remove the live contribution once. Record lifetime loss counters separately. |
| Refit begins | Keep the old definition and live count; mark refitting/unavailable as appropriate. |
| Refit completes | Atomically transfer one contribution from old definition to new; preserve actual strength according to refit rules and reset promotion to recruit. Total live formations stays constant. |
| Refit cancels | Clear job state according to domain outcome. No fictitious new unit or recruitment history entry. |
| Embark / disembark | Update state without changing faction total. A transport does not duplicate its passengers in troop strength. |
| Promotion changes | Move the contribution between promotion buckets after XP changes. No new formation appears. |
| Unit ownership changes, if supported | Remove from former faction and add to new faction atomically; do not mistake a captured civilian trader for a captured army. |
| Army assignment / release | Update assignment and availability without changing total force size. |
| Faction elimination | Reflect actual surviving entity outcomes; do not erase valid survivors solely because a label changed. |
| Match restore | Rebuild once from valid entity state; do not replay snapshot deliveries as new recruitment events. |

Projection updates must be part of the same deterministic simulation transaction/phase as their committed domain change. Queries observe a stable phase revision. If decisions occur before combat, that phase must already include earlier commands; end-of-tick snapshots include that tick's resolved casualties. Async delivery to the browser may lag and carries its own tick marker.

Retain each entity's previous indexed contribution. Removal and refit can then subtract the correct owner/definition/state even if the entity object has already changed or left its collection. Coalescing is allowed, but it must preserve the first before-state and final after-state, including creation and destruction within one tick.

Lifetime recruitment/loss counters also need committed lifecycle causes: a unit born and destroyed in one tick has zero net live delta but still contributes a birth and loss. Starting grants should be classified as initial deployment rather than silently counted as paid recruitment. Do not reuse the current `Player.recruited` field as a trained-unit count without changing its semantics; the inspected reserve-production code increments it when manpower is generated.

## Query contracts

| Proposed query | Use |
| --- | --- |
| `forcesOf(factionId)` | Exact internal composition at a committed revision. Restricted to authoritative diagnostics and permitted own/allied knowledge adapters. |
| `knownForces(observerId, targetId)` | Exact own/allied summary or observation-based enemy estimate. This is the strategic AI/UI entry point. |
| `countByDefinition(factionId, definitionId, domain)` | Constant-time own/allied production and composition checks. |
| `availableForMission(factionId, filters)` | Retrieve candidate entity IDs without scanning unrelated factions; readiness depends on mission-specific policy. |
| `forcesInRegion(observerId, regionId, filters)` | Bounded spatial/regional force assessment; ownership and knowledge restrictions remain explicit. |
| `compositionDemand(armyId)` | Missing roles/definitions/strength compared with an army plan; a planner result, not a live counter. |
| `forceHistory(factionId, window)` | Own diagnostic/review history from bounded counters or records, separate from enemy knowledge. |

Global faction counts are cheap lookups or enumeration of occupied definition entries. Entity retrieval is indexed by owner and definition. Regional threat queries use spatial indexes and cached coarse summaries, rather than copying every entity into every possible overlapping region. Cache results by force, position, content/research, and relationship revisions as relevant to the query.

Do not repeatedly deep-copy the full index into each AI blackboard. Expose revisioned immutable slices or views. Empty definitions can be omitted from storage and added as zero rows only where a permitted UI filter needs them.

## Enemy knowledge is a separate projection

The authoritative force index always remains exact. For confirmed exact own/allied counts, alliance membership authorizes aggregate force disclosure; it does not authorize shared resources, control, paths, recruitment, or automatic shared battlefield vision.

Enemy estimates must be observer-relative. Store permitted sightings with stable observed IDs or anonymous contacts, last-observed type/strength, time, region, and confidence. Deduplicate repeated sightings. Unknown unit types remain unknown contacts; unknown is not zero.

Do not generate estimates by reading the exact global count and adding a random percentage. That leaks truth, can be averaged to reconstruct it, and gives AI privileged knowledge. A permitted estimate model can use observed contacts, confirmed losses, last-known allied totals, and explicitly permitted public information. Its uncertainty grows with elapsed time and incomplete coverage.

An alliance becoming active switches aggregate counts to exact at the current authorized revision. Expiry/break immediately ends new exact disclosures; retain the last legitimately known totals as dated intelligence and broaden uncertainty. Invalidate cached adapters when relationship or observer identity changes.

The current client receives all enemy entities. Battlefield observation/visibility rules are still open. An estimate label alone cannot promise hidden armies while exact entity data remains globally available. Resolve that scope explicitly before claiming an intelligence system; do not silently implement fog of war as an optimization.

## Combat strength and counter decisions

Counts support composition decisions but are not a universal power score. Evaluate actual age, promotion, health/strength, armour, attack channel, range, reload, target bonuses, charge readiness, terrain, cover, walls, travel time, and supply. Anti-air is useful against aircraft; it is not missile defence. Siege effectiveness against walls is a separate threat dimension.

Use a versioned combat evaluator and cached regional summaries for candidate comparisons. Keep the simulation's combat formulas authoritative. Do not maintain a single irreversible "army power" counter that becomes stale after research, refits, terrain changes, or changing opponents.

## History and observability

Maintain cheap cumulative recruited/destroyed/refitted counters by definition and domain, plus optional rolling summaries for combat losses and recruitment rates. State whether a counter counts formations, personnel loss, hulls, or refit transitions. Transfers and refits do not count as fresh recruits.

Detailed lifecycle records are a bounded diagnostic option with tick, sequence, entity/domain, owner, definition, and cause. Avoid per-tick per-unit logging and unbounded retained event arrays. AI uses the live index and knowledge projection, not repeated replay of logs. Full replay/save persistence is a later explicit requirement.

## Correctness and acceptance

- For every faction/definition/domain, indexed living counts and strength equal an independently rebuilt scan of authoritative state.
- Rejected commands, duplicate notification delivery, refits, transport passengers, and create-then-die cases do not double-count.
- Empty indexes remain valid after elimination and match reset; one match never inherits another's totals.
- Mixed-age and culture-specific entries remain distinguishable.
- All permitted consumers observe a documented revision; no View updates counters from sprite visibility.
- Enemy queries and UI payloads obey the chosen observation policy, including alliance expiry. Historical records cannot bypass that policy.
- Full scans are permitted for loading, debug assertions, and validation; they are not the routine AI/UI query path.
