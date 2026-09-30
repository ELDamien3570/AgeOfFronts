# AI defensive construction and defensive layouts

Status: required scope for the optimization/AI/army push; contracts and tuning below are proposals. September 30, 2026. Documentation only; no source changes.

## Confirmed scope

The user explicitly included smart defensive building in this push, including connected tower/wall layouts around important sites and appropriate Modern trenches, gun nests, anti-air and missile defence where unlocked. This is a delivery requirement, not a later optional AI feature.

Defence planning must share the economy planner, researched capabilities, terrain/navigation rules, enemy knowledge, personality profiles and army operations. All actual construction, gate conversion, repair and recruitment use the same validated commands and real costs as human players. Independent allied ownership still prohibits construction on an ally's land or commandeering its structures.

The AI should protect valuable assets and usable approaches, preserve trade and reinforcement access, and adapt to observed threats. It should not place one building of every type near its original base or wall every captured tile. No new paid technology node is added by this planning feature; the catalogue remains 85 nodes.

## Current source evidence

These observations are from static source inspection, not runtime qualification of wall layouts or defence effectiveness.

| Source | Observation and consequence |
| --- | --- |
| [Expansion.thinkProgression](../../../src/skirmish/domain/Expansion.ts) | The inspected building list omits towers, gun nests and trenches. It includes missile defence, but uses the first 256 owned tiles sorted near the original base and generally wants one building of a type/current age. This is a production checklist, not threat-aware defensive placement. |
| [Simulation.developAi](../../../src/skirmish/Simulation.ts) | The legacy non-expanded builder also chooses missing types near the base; it returns immediately for the expanded ruleset. Do not patch only this function and claim the age-based AI now fortifies. |
| [Construction validation](../../../src/skirmish/Construction.ts) | Placement checks owned passable land, spacing and basic costs, with coastal rules for ports. General legality alone does not prove strategic usefulness or preserved access. |
| [Expansion.buildRejection / built](../../../src/skirmish/domain/Expansion.ts) | Adds researched capability, full material/gold quote, tower/wall costs, and occupied tower/link-tile checks. Use this shared domain path rather than a cheaper AI-only build. |
| [Fortifications.towerPlan](../../../src/skirmish/domain/Fortifications.ts) | Chooses up to two nearby completed same-owner/same-age towers within 12 tiles, with a fixed cardinal L-shaped path and extra length-based gold cost. Links are created when the new tower is built; the inspected `step` does not independently add missing links when two initially unfinished towers later complete. Construction sequencing therefore matters. These distances/prices are existing values, not accepted new tuning. |
| [Fortifications gates / blocking](../../../src/skirmish/domain/Fortifications.ts) | Gate conversion requires a completed owned barrier and costs gold. The inspected blocker considers positive barrier health without excluding construction time. A plan must preserve access during intermediate construction, not only after its final gate is ready. |
| [Building definitions](../../../src/skirmish/content/Buildings.ts) | Tower access is age-specific; new Modern towers are unavailable while old walls remain. Modern gun nests/trenches and missile defence have researched gates and authored costs. Current source places missile defence under Combined Arms, while its final design placement remains open in the Modern plan. |
| [Battle cover / gun nests / interception](../../../src/skirmish/domain/Battle.ts) | Trenches cover eligible nearby owned infantry; nests require range and a clear firing path; missile defence intercepts specified strategic projectile families under its cooldown. Towers must not be scored as automatic gun damage merely because they are called defensive buildings. |

Three direct architectural risks follow: simultaneously placing a whole ring can leave disconnected towers; nearest-tower links can create unwanted barriers; and a nest behind a solid wall can lack a legal firing path. A count or distance heuristic cannot solve these cases.

## Planning ownership

| Responsibility | Proposed owner |
| --- | --- |
| Structure, barrier, construction, gate, repair, attack and interception legality | Existing domain services and authored definitions. |
| Placement quote / projected links / access effects | Shared read-only domain/application query used by human previews and AI; commands revalidate on commit. |
| Own assets, structure state, damaged barriers, routes and local threat knowledge | Revisioned faction/regional read models, derived from committed state and permitted observations. |
| Defence goals and budget commitments | Shared faction strategy/economy planner. |
| Persistent layout and construction schedule | Small AI planning record referencing real asset/structure IDs and ordinary commands. |
| Garrison, mobile reserve, escort and anti-air movement | Shared army/unit operation planner. |
| Presentation and diagnostics | Immutable summaries formatted by ViewModels; no renderer-owned placement or barrier logic. |

Proposed service names such as `DefencePlanner` and `PlacementQuery` describe contracts, not implemented classes. A defence plan is AI intent, not a second authoritative wall graph. A hypothetical planning view can project a bounded candidate sequence using shared rules; it cannot mutate the live world, invent gates, or implement a separate approximate legality model that becomes authoritative.

Current/query and commit outcomes can differ because troops, ownership, buildings or inventories change. Return ordinary structured rejection/wait reasons. Commit actual costs once; failed or stale commands produce no phantom building, barrier, garrison or budget spend.

## What to defend

Create a bounded shortlist of own defensive objectives:

- Cities with meaningful paid upgrades/manpower output, including their trade delivery access.
- Barracks/ranges/stables and weapon producers needed to replace the current army.
- Factories, valuable mines, horse nodes and late oil infrastructure whose loss interrupts supply.
- Ports and associated land approaches, trade endpoints and embark/landing access.
- Important reachable crossings, narrow approaches and recently captured forward production that can actually be held.
- Modern airstrips, strategic launchers and dense industry where the appropriate counter is worthwhile.

Score asset value using actual output, supply dependencies, observed attack history, replacement cost, military commitments and vulnerability. A Stone recovery site without existing buildings may need a screening army and viable construction route first; fortification is not the token building required to keep the faction alive under the accepted recovery direction.

Use current valuable sites, not permanently the original camp. Group nearby assets into a defended district to avoid duplicate rings and overlapping spend. Expansion creates new objectives, but does not immediately mandate a complete perimeter around every deposit or city.

Threat summaries retain separate ground assault, siege/artillery, cavalry/vehicle mobility, naval landing, aircraft and strategic-missile channels. Global enemy counts can inform strategy, but local observed positions, approach routes, travel times and estimate freshness determine where protection is useful. Unknown enemy presence is uncertainty, not proof of safety or permission to query hidden troops.

## Choosing a response

| Situation | Proposed preferred responses / checks |
| --- | --- |
| Early exposed city or producer | Affordable entrance/approach protection and a real local force; do not spend the opening city/barracks/replacement budget on an unnecessary full enclosure. |
| Repeated ground attacks through a useful narrow approach | Reachable tower-linked barriers, gate access and supporting ranged/field forces. Score delay and frontage control, not imaginary tower DPS. |
| Broad open frontier | Protect key districts, keep a mobile reserve and improve routes. A continuous map-wide wall is usually poor value and expensive to plan. |
| Observed siege/artillery | Counter-siege/mobile disruption, dispersion and fallback positions; repairing a wall faster than it is shelled is not automatically sensible. |
| Modern infantry/vehicle assault | Occupied trenches, nests with useful firing paths and appropriate ground counters/mobile reserve. Preserve existing walls when useful; do not auto-convert them. |
| Aircraft raids | Researched anti-air vehicles and their patrol/escort operation, with suitable bases protected. A gun nest is not anti-air unless an explicit definition says so. |
| ICBM/MIRV threat | Separately legal missile-defence structures covering valuable locations/approaches, with interception capacity and cooldown considered. Aircraft-only anti-air cannot substitute. |
| Strategic blast risk | Avoid needless concentration; weigh defence and dispersion against real warning, projectile and blast rules. Do not assume one interceptor prevents every simultaneous warhead. |
| Immediate attack before a building can finish | Send/reposition existing forces, retreat or delay the attacker. Unfinished static defence must not be credited as already protecting the site. |

Compare a defensive project with recruiting/replenishing an army, repairing existing structures, improving supply, upgrading a city and taking the attacker's staging area. Use marginal expected protection rather than adding identical defence everywhere. Limit overconfidence in matchup/arrival estimates; current strength, capacity, armour, poor early firearm accuracy and slow reload matter to the support army.

## Connected layouts and protected access

Author reusable, parameterized candidate shapes such as an approach screen, gated district enclosure and bridge/landing protection. These are spatial planning templates rather than prefab buildings spawned atomically. Fit a small number of candidates to terrain and assets, then validate the entire predicted tower/link graph.

Planning must respect actual link range, eligible completed neighbours, age compatibility, occupied cells and cardinal art/geometry. Reuse useful existing anchors. Do not assume an arbitrary pair of planned towers will link, that diagonal drawn lines are legal, or that the automatic nearest-neighbour rule will select only the intended neighbours. Include every actual automatic link and its cost in the quote. If the legal graph differs from the intended layout, reject or redesign the candidate.

Check access for relevant unit footprints and dynamic barriers to:

- City and port delivery points from active factories/trade approaches.
- Recruitment exits, reinforcement staging and army marching/deployment space.
- Mines/resource access, relevant roads and port landing/embark positions.
- Escape/fallback routes and legal gate usage through treaty expiry or betrayal.

A complete layout and every blocking intermediate stage must keep the required access. Schedule a gate on an already completed segment before closing the remaining perimeter, or retain a deliberate open gap if that is the only safe legal sequence. Do not promise a future gate to justify blocking today's city. If no legal usable sequence exists, use a partial screen or army defence and report why an enclosure is unsuitable.

The tower planner currently does not explicitly check ownership of every intermediate link tile. Require proposed AI layout candidates to stay on controlled territory and avoid projecting claims into another faction through a wall. Whether this becomes a universal domain placement requirement is a separate fortification-policy decision; do not quietly grant new player/AI permissions.

Reserve troop staging outside pending walls and move only the AI's own units through ordinary orders before placing obstructed segments. It cannot force allied/enemy troops out of a footprint. Site ownership loss, capture of an anchor, changed topology or a newly blocked route invalidates pending stages; completed legal structures remain real assets.

Mixed-age towers need explicit legal compatibility. Do not overwrite old anchors or force free tier conversion. Gate access, close control, allied passages, tower attacks and wall upgrade/repair policy still follow the open decisions in the fortification plan. If explicit link selection or compound wall/gate construction is needed, design it as a shared player-facing domain capability, not an AI exception.

## Modern positions and actual supporting forces

Trenches should be placed where eligible troops can occupy useful cover and still fire, move and withdraw. Assign a real defensive operation with troop readiness/capacity and a fallback. Empty trenches are not a defensive army. The current six-nearby-infantry cover limit is a source value to revisit with larger squads/armies, not an instruction to spawn six new units per trench.

Place nests according to legal target classes, clear firing paths, effective range and approach coverage. Score marginal coverage and support rather than overlapping ranges alone; two guns blocked by the same wall add no usable frontage. Safe standoff from blast-vulnerable factories and legal construction spacing must both be considered.

Anti-air vehicles remain mobile military units, assigned to defend/patrol/escort objectives by the army planner. Missile-defence structures remain a distinct building/strategic-interception capability. Neither shares an invented generic protection score; missiles, aircraft, ground forces and cover have different domains and cooldowns.

Older walls can support a Modern position when they do not obstruct friendly fire/access. No automatic trench links between nests, free occupancy, free missiles, omniscient radar or inherited all-target turret attack is introduced by this AI plan. Missile launchers are offensive assets that may need defence, not missile-defence structures themselves.

## Budgets, sequencing and maintenance

A persistent layout record references owner, protected objectives, local threat/terrain revisions, candidate layout, total quoted resources, stages, dependencies, actual completed structure IDs, required gate/access state, support operation, and status. Proposed states: assessing, funded, securing site, building anchors, linking, opening gates, garrisoning, operational, repairing, redesigning, abandoned/completed. This is not a new mutable map or a replacement inventory.

Reserve spending through the shared economy commitment ledger. Include tower plus all automatic wall costs, gates, eligible materials, repair and supporting force demand. Protect the opening city/barracks and credible replacement production; personality can reprioritize discretionary spend but cannot duplicate the same committed gold across several walls/armies.

Sequence placements around completed eligible neighbours. Wait for a needed anchor to finish before issuing dependent towers. Nondependent preparation can proceed within the agreed per-faction construction/work budget. Requote before each commit, release obsolete commitments on rejection/cancellation, and never repeatedly submit the same invalid tile without a state change or backoff.

Choose repair versus replacement versus fallback using health, breach importance, repair/build completion time, current damage, access, support forces and resource opportunity cost. Avoid repeatedly repairing an indefensible exposed wall while the replacement economy collapses. Gate conversion, wall repair and structural upgrades have their own legal commands; do not restore HP by toggling a plan or issuing a duplicated build.

Preserve useful layouts after a threat recedes; disband/reassign support deliberately instead of deleting buildings. A frontier shift may make old protection less valuable and stop new spending. Do not demolish paid infrastructure or rebuild everything each age without an agreed demolition/conversion policy.

## Personalities, tribes and allies

Builder prefers protecting productive districts and replacement throughput. Warlord uses lean home protection and supported forward positions. Guardian values reliable defended reinforcement routes and contributes mobile defence to an ally, while building only on its own legal land. Opportunist may secure a staging site, but weighs the confirmed weaker-wall/faster-capture betrayal exposure before deliberately breaking a treaty.

Proposed fortification preference can be an authored profile weight, separate from tactical skill, aggression and loyalty. All profiles share competent minimum threat/access checks; a peaceful AI is not allowed to become useless because its war weight is low. Exact trait values and player visibility remain open.

Minor tribes can use only their legal researched/building capabilities. Settled/developed tribes share the same planner, with bounded cheaper strategic evaluation and the same real resource costs. Defeating a nation does not grant free walls, Modern counters, Armies or an instant city enclosure.

Guardians may position their own mobile forces to aid an ally under the treaty/route policy. Placing a fort on allied land or relying on an ally's recruitment/repair facilities would require a new explicit permission, outside the confirmed independent ownership rule. Exact allied force totals do not grant unrestricted intelligence or construction rights.

## Scale and observability

Maintain own asset/defence indexes and dirty regional frontier/route summaries. Reuse the force projection for local support and permitted threat composition. Cache coverage and candidate access by relevant structure/topology, ownership, research, relationship and threat revisions. A wall breach should dirty its affected region, not trigger a full-map search for every faction.

Score a bounded shortlist of assets, approach candidates and layout templates; perform expensive connectivity/fire-path checks only for the best legal candidates. Run strategic defence planning at a staggered tick cadence, with coalesced urgent invalidation for a serious observed attack or breach. Work must be bounded by deterministic budgets, not camera visibility or elapsed CPU time. Exact cadence, candidate counts and construction concurrency are tuning proposals.

Track useful protected objectives, gate/route accessibility, layout completion time, resources committed/spent, rejected-command reasons, time-to-counter, troop cover occupancy, breaches/repairs, actual damage/delivery losses and protected-asset survival. Include planner/query time, candidate/path work, cache hit rate, dirty-region work and queue age at large faction counts.

Expose compact diagnostic explanations such as protecting the upgraded city's only approach, waiting for an anchor, prioritizing anti-air over another nest, or rejecting an enclosure that blocks deliveries. Production snapshots need only appropriate observable summaries; do not publish enemy plans or raw hidden threat data through diplomacy.

## Required delivery and validation

Include this work in the same push as economy/army improvements: shared placement facts and budget contracts first, then connected layout execution and support operations, then adaptive Modern counter selection and personality integration. Qualify these jointly before calling the AI push complete or increasing supported populations.

Required scenarios:

- Building-free three-squad opening and early assault: retain city/barracks funding, recover on owned land, and avoid a token fort as sovereignty.
- Threatened city, producer cluster, distant mine, horse node and port: different useful layouts rather than nearest-base duplication.
- Anchor construction timing, unexpected second automatic link, range/age mismatch, troops in footprint and rejected unaffordable full wall quote.
- Enclosure throughout construction and after gates: deliveries, reinforcement, retreat and port access stay legal; treaty expiry changes passage correctly.
- Irregular coast, tight owned land, bridge approach, nearby neutral/enemy land, disconnected region and crowded existing structures.
- Siege breach, anchor capture/destruction and damaged wall: repair/replan/fallback without free regeneration, duplicate barriers or command spam.
- Nests with blocked fire paths and trenches with no garrison: correctly reduced usefulness and a real supporting-force assignment.
- Aircraft-only threat versus strategic-missile threat versus mixed/saturating attack: choose distinct legal counters and honour cooldowns.
- Modern with retained old walls; inaccurate/slow-firing Early Modern defenders; depleted/larger mixed-tier squads and manual/automatic army tactics.
- Guardian ally defence, betrayal exposure and a developing tribe: no allied-land construction, research bypass or free materials.
- Many factions simultaneously fortifying: bounded layout/coverage/route work, correct force counts and coherent construction/publication.

Compare against the current AI on matched seeds and resources: asset survival, economic continuity, losses per protected objective, construction value, conquest outcomes and scale latency. More defensive buildings alone is not success, and reducing conquest to an hour of ineffective sieges is a failure. This document establishes a plan; source/runtime implementation and playtest proof remain future work.

## Explicit open decisions

The user confirmed layout planning and defence-type selection. Numerical budgets/coverage, gate/connection policies, new wall ownership requirements, repair/refund/upgrade/demolition policies, trench occupancy/crossing, target profiles, missile-defence technology placement/interception limits and enemy observation rules remain open in their owning plans. Resolve those shared rules before depending on them; do not fill the gaps with AI-only mechanics.
