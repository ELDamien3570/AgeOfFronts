# Delivery and validation

Status: proposed implementation sequence and acceptance plan. September 30, 2026.

Documentation is the current deliverable. Do not interpret this file as authorization to modify source, raise caps, or implement fog of war in the present task.

Priority correction dependency: [defeat and territory inheritance](defeat-and-territory-inheritance.md) reproduces immediate whole-nation annexation after a building-free starting army is wiped. The user accepted recovery on usable owned territory; settle the exact terminal control/annexation conditions and validate the correction before implementing conquest-based tribe graduation. Existing tests currently encode the conflicting rule and need deliberate revision when source correction is authorized.

## Work packages

| Order | Package | Reviewable completion evidence |
| --- | --- | --- |
| 1 | Reproducible baselines and lifecycle audit | Pinned source/content/configuration, representative fixtures, current per-phase/worker/browser measurements, and mutation inventory. |
| 2 | Faction force projection | Live type counts/strength with consistent revisions, lifecycle integration, indexed queries, and independent-scan validation. |
| 3 | Diplomacy force inspection | Exact own/allied rows; observer-derived enemy estimates after observation scope is decided; validated payloads, transitions, and UI behaviour. |
| 4 | Capture and publication optimization | Equivalent capture/fortification/diplomacy results, dirty state publication, and measured integrated improvement. |
| 5 | Fair scheduling and representation | Dynamic faction fairness; queue metrics; widened IDs/protocol before approaching the current limit; all boundary round trips. |
| 6 | Opening and production planner | Protected opening commitments, material/equipment dependencies, viable replacement production, and meaningful failure reasons. |
| 7 | Smart defensive construction | Protected objectives, full tower/link/gate quotes, useful connected layouts, access throughout construction, real support forces, repair/replan and distinct ground/air/missile responses. Required in this push. |
| 8 | Armies, tier capacities, tactics and conquest | Legal Bronze Armies/20-squad membership, cohesive columns/role deployment, manual and automatic tactics, tier-aware strength/recruitment/refit, bounded routing, and completed objectives without repeated individual camp raids. |
| 9 | Personalities and diplomacy | Distinct legal behaviours, deliberate betrayal, useful renewal in both modes, and credible ally defence. |
| 10 | Tribe development | Legal milestones, stable identity, shared planner, correct capabilities/caps/victory, and balanced emergence rate. |
| 11 | Supported population increase | Integrated one-hour playtests and worst-case fixtures passing explicit hardware/throughput/latency criteria. |

Packages can overlap after their contracts are agreed. Keep each source change directly scoped, and explain any departure from DDD/MVVM before implementation. Avoid cosmetic fixes that leave duplicated gameplay authorities or routine all-world scans in place.

The [defensive construction plan](ai-defensive-construction.md) is mandatory scope, not a follow-up after declaring the army/AI work done. Its placement/access/maintenance validation and joint army support must pass before completing this push.

## Lifecycle audit before incremental counting

Identify every existing path for initial spawn, recruit, damage resolution, replenishment, death/removal, embark/disembark, refit begin/complete/cancel, promotion, ownership change, aircraft loss, sinking, match reset/load, and elimination. Centralize committed change publication or a coalesced journal around those paths.

Counter drift is an architectural failure, not something to repair by scanning the whole world every frame. A debug/reference scan is appropriate to detect it, while normal queries stay incremental. Tests should compare independent state reconstruction and observable outcomes rather than merely repeat the index's update formulas.

## Force correctness scenarios

| Scenario | Required result |
| --- | --- |
| Initial regular and tribal deployment | Counts equal actual entities, including configured grants and real starting strengths. |
| Successful versus rejected recruitment | Exactly one new contribution for success; none for rejection. |
| Simultaneous combat and lethal damage | Final strength matches resolved damage; each dead entity is removed once. |
| Partial replenishment / exhausted reserves | Add only actual strength; do not count reserve production as fielded troops. |
| Refit completion and cancellation | Atomic definition change on completion, unchanged total formations, correct retained strength and reset XP; cancellation does not create a recruit. |
| Embarked armies and transport sinking | Passengers count once; actual survivors/deaths and vessel loss reconcile independently. |
| Mixed ages and culture variants | Stable definition rows remain distinct after player advancement. |
| Tier-based capacity and army membership | Older definitions retain smaller capacity; capacity and surviving strength remain separate through refit/replenishment. Army assignment never duplicates faction counts. |
| Vehicle, siege, anti-air, and launcher facets | Overlapping tags never inflate totals; equipment/payload is not a unit. |
| Trader capture | Civilian ownership/logistics change does not alter military counts. |
| Creation and removal within one tick | Coalesced before/after state and optional lifetime counters remain correct. |
| Elimination, reset, and restore | No leftover contributions or cross-match histories; restored summaries match restored entities. |

## Intelligence and diplomacy scenarios

- Own and direct active allies receive exact composition at the declared revision; allies of allies do not inherit exact access.
- Enemy sightings are deduplicated; no contacts is unknown rather than confirmed zero; old sightings are dated.
- Alliance acceptance switches to authorized exact counts, expiry/break ends new exact disclosure, and UI/query caches invalidate immediately.
- Stale former-allied totals remain historical observations, not current truth.
- AI counter decisions receive the same permitted enemy knowledge; debug access cannot leak into ordinary planning.
- An approved visibility policy is enforced in packet fields and entity detail, not just labels. If full-world units stay public, record that estimated diplomacy totals are a presentation choice.
- Allied count sharing does not grant supplies, control, shared replenishment, or unrestricted map vision.
- Territory changes during inspection and rapid faction switching preserve correct identity and action targets.

## AI behaviour scenarios

Use fixed seeds, matched starts, and multiple seeds for conclusions. Required scenarios include:

1. Normal Stone opening, early invasion, and loss of the first production building.
2. Post-Stone recruitment with manufactured equipment, horse shortage, and a current-age material shortage requiring retained older troops.
3. Producer competition, unreachable commercial endpoint, trader loss, and route recovery.
4. Preparing an attack against stronger/uncertain forces; deciding to wait or retreat rather than feed isolated recruits.
5. Wall breach with siege support, narrow route cohesion, transport landing, and finishing a faction whose original camp has fallen but buildings/forces survive.
6. Aircraft threats requiring anti-air; strategic missiles requiring separate defence; target selection beyond lowest enemy ID.
7. Builder under attack, Warlord replacing losses, Opportunist declining unsafe betrayal, and Guardian dispatching useful reachable defence.
8. Treaty expiry mid-operation and conflicting allied obligations without illegal friendly attacks.
9. Tribe settlement, failed resource access, legal development transition, settlement loss, and correct allied-victory eligibility; conquest-based nation graduation after credited human/nation elimination, including partial captures, multiple attackers, and simultaneous defeats.
10. Slow early manpower with a reviewed starting bank; Classical research without buying city upgrades; paid upgrade completion and loss/capture; economic versus Warfare/Naval progression. Optional plague scenarios wait for an agreed effect model.
11. Bronze Armies as the fifth Warfare node: no unlock through age advancement alone, 20-member cap, later researched caps, mixed-tier/speed columns, narrow passages, manual order priority and automatic tactics without technology or intelligence cheats.
12. Larger squad HP, retained older capacities, real reserve/equipment replenishment and refit without free healing; poor pre-Modern accuracy, slow Early Modern reload and separate incoming armour reduction. Recheck promotion/next-age benchmarks and repeated-order/charge/march exploits.
13. Useful defended city/producer/port/approach layouts; anchor completion dependencies and all actual automatic links; gates and uninterrupted trade/reinforcement access during construction; blocked nest firing paths, occupied trenches, siege breaches, repair/fallback and captured anchors.
14. Distinct aircraft and ICBM/MIRV threats, interception saturation/cooldowns, retained Modern walls, owned-land limits for Guardian aid and legal developing-tribe defences. Measure protected-asset survival/economic continuity as well as construction spend and planning latency.

Track opening milestones, net delivered income, recruitment by definition, equipment stock/throughput, blocked task reasons, rejected commands, idle producers, army readiness/reinforcement time, order churn, retreat survival, conquered objectives, aid latency, ally survival, and personality differences. Winning alone does not prove the desired behaviour.

## Performance matrix

First reproduce today's supported settings. Then use experimental increases after representation/setup changes exist. These numbers are test targets, not promised supported populations.

| Axis | Suggested samples |
| --- | --- |
| Total factions | Current largest 60; experimental 120 and 240. Test IDs crossing 255 separately after widening. |
| Tribal force size | Current 5 starting / 10 cap; experimental 25 and 50 living formations per tribe. |
| Development | Minor tribes only, mixed developing tribes, and many established nations. |
| Map | 250 x 125 where placement permits, 500 x 250, 1000 x 500, and representative imported terrain. |
| Economy | Opening, mature producers/trade, disrupted routes, and resource-driven reconfiguration. |
| Defensive planning | Exposed starts, staged connected enclosures/gates, contested approaches, breaches/repair, Modern mixed threats, and many factions constructing simultaneously. |
| Combat | Open march, crowded front, narrow passages, dense walls, fleet/landing, and Modern aircraft/missiles. |
| Speed | Normal first; 2x/4x only where those modes are to be supported. |

Use a staged subset instead of the complete Cartesian product. Hold total units fixed while increasing faction count to isolate strategic overhead; hold faction count fixed while increasing armies to isolate movement/combat. Then test combined growth. Include geographically constrained starts and explicit insufficient-space rejection.

## Measurements and acceptance

Record source/content hash, seed, ruleset, hardware/browser, map/terrain, actual living faction/unit/building/trader counts, duration, warmup, and whether casualty restoration or other synthetic helpers were used. Time construction, progression/production, AI, routing, avoidance, combat, capture, snapshot creation/encoding, structured clone, browser decode, rendering, and garbage collection where available.

The normal-speed worker cycle has 50 ms total for one step and publication. Define p95/p99, sustained 20-tick throughput, queue age, input response, packet size, and memory criteria before increasing the supported cap. Averages alone conceal stalls. Rendered 30/60 FPS and simulation ticks per second are independent metrics.

For accelerated modes, measure the advertised number of steps plus publication per interval. Do not reduce physics/collision fidelity or alter authoritative decisions according to camera visibility or elapsed CPU time to make a benchmark pass.

Run integrated browser fixtures and representative full one-hour matches with changing economies/alliances, developed tribes, and late-game systems. Headless all-land openings identify local costs; they do not qualify sustained gameplay. Repeat only when new changes or unresolved concerns justify it, and retain comparable before/after conditions.

## Decision gates

- Before enemy estimates: agree observation/visibility scope and uncertainty semantics; numeric sensor ranges and confidence rules remain open.
- Before profile UI: agree exposed presets versus private AI motivations and customization scope.
- Before tribe development: agree milestones, capability transitions, cap growth, loss/regression behaviour, and victory treatment.
- Before supported scale expansion: agree target hardware, populations, speed modes, and performance/latency acceptance.
- Before persistent history: agree save/replay retention and storage; no default unbounded event archive.

The [folder overview](README.md) owns the local decision register. Update it when these choices are confirmed; do not present a proposed threshold as user-approved.
