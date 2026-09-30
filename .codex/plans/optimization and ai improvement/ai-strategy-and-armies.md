# AI strategy and armies

Status: proposed architecture and behaviour. September 30, 2026.

Build one planner shared by regular nations and developing tribes. Their capabilities and personalities select different legal actions; they should not require separate copies of economy and combat logic.

## Architecture

| Responsibility | Proposed owner |
| --- | --- |
| Simulation authority | Existing domain entities, combat/supply/progression/diplomacy rules, and command validation. |
| Faction facts | Revisioned faction force, producer, resource, relationship, and regional knowledge read models. |
| Goal selection | A faction strategy service scoring a bounded set of legal goals. |
| Dependencies and budgets | Economy/production/research planner resolving the chosen goals into achievable tasks. |
| Operations | Persistent army plans, composition demand, membership, objectives, and reinforcement assignments. |
| Defensive construction | Persistent protected-site/layout plans, shared placement quotes, gate/access dependencies, repair and supporting-force demand. |
| Movement and engagement | Existing command, formation, navigation, and combat systems with explicit operation intent. |
| UI | ViewModels format selected profile, operation status, and permitted force summaries; Views never run planners. |

AI sends ordinary validated commands. It never creates resources, ignores manufactured weapons, teleports forces, grants research, attacks active allies, or replenishes through allied services without an explicit permission. Rejected commands return structured waiting/failure reasons and do not mutate budget commitments or force counts as though they succeeded.

Use deterministic seeded tie-breaking and explicit simulation ticks. Runtime language models, reinforcement learning, and unbounded full-world search are not necessary for this design. Utility scoring plus bounded dependency planning and persistent operation state are inspectable and sufficient starting tools.

## Shared faction facts

Read own live composition and permitted allied/enemy knowledge through the [force projection](faction-force-read-model.md). Also query:

- Available and committed gold, reserves, horses, raw/refined materials, equipment, payloads, and producer capacity.
- Completed research, active research/advancement, legal next technologies, and exact configured prices/timers.
- Cities, factories, delivery endpoints, route access, and observed delivery income/losses.
- Owned accessible deposits, available construction sites, defended objectives, relevant routes, and regional threats.
- Existing operations and forces committed to defence, escort, attack, refit, or reserve.
- Treaty duration, relationship history, betrayal exposure, and confirmed attacked allied objectives.

Facts are updated by relevant events and revisioned indexes. Each AI does not scan every entity or duplicate the complete global force index. Enemy uncertainty is an input to the decision, not a licence to read exact hidden totals.

## Goal selection

Candidate goals include establish economy, fix a production bottleneck, secure a resource, improve trade, prepare an army, conquer an objective, defend home, assist an ally, recover losses, research/advance, negotiate, and exploit an opportunity.

Gate impossible actions cheaply before evaluating expensive routes or outcomes. Score achievable candidates using strategic value, threat, expected cost/losses, travel time, supply feasibility, uncertainty, current commitments, personality, and victory mode. Keep a small shortlist for detailed planning.

Retain the current goal for a minimum commitment period unless a material event invalidates it. Add cooldowns and switching thresholds to prevent army orders or production recipes oscillating between similar scores. Reevaluate immediately eligible threats through the deterministic urgency queue; routine strategy uses a slower staggered cadence.

Smart [defensive construction](ai-defensive-construction.md) is required in this push. Compare protecting valuable cities/producers/routes with recruiting, repairing, counterattacking or retreating. Maintain persistent staged layouts, not one structure of every type near the original camp. Include actual tower links and gates in budgets, preserve trade/reinforcement access through construction, and assign real garrisons/mobile support. Choose aircraft anti-air separately from strategic missile defence; profile preferences do not alter legal target classes.

Log a compact decision explanation: goal, principal reasons, known input revision, expected cost, and rejection/wait reason. This is useful for debugging and balancing, not a permanent per-unit per-tick transcript.

## Opening and spending discipline

The current source researches before construction and can spend its entire initial gold on Craft Workshops. Replace that order with explicit commitments:

1. Reserve the configured cost of a first city and barracks, plus an authored survival/replacement buffer.
2. Establish legal construction sites and actual completed producers; construction orders are not completed buildings.
3. Budget access to commercial production and a reachable city/port delivery endpoint.
4. Start discretionary research only when it does not consume protected commitments or when an urgent strategy explicitly reprioritizes them.

The buffer and priority rules are proposals. Use configured costs rather than hard-coded 3,000/800/400 values. A frightened AI may legitimately delay economy to survive, but it should record that decision rather than accidentally spend its opening away.

Reserve planned spending once per task; release it on cancellation or rejection. The domain still performs the actual atomic spending. A commitment is not a second balance that can drift from real gold or inventory.

Commercial income comes from completed physical deliveries. Forecast from production, route capacity, journey time, endpoint reachability, and observed losses; do not assume passive port income. Keep strategic materials and equipment separate from commercial cargo.

Manpower forecasts follow [paid city upgrades](manpower-and-city-upgrades.md): slow opening growth, first substantial acceleration at Classical, and actual output only after the selected city upgrade completes. Reserve upgrade spending explicitly; research unlock alone does not improve every city. Plan manpower for replenishing survivors as well as creating new formations. Defensive layouts share this budget and the real supply/production commitments; their walls, gates and support troops are not a separate free spending pool. Optional Medieval plague response is deferred until its effects are agreed.

## Production and technology dependencies

Starting from a desired unit/army, walk authored recruitment costs, equipment recipes, processing recipes, extraction capabilities, producer requirements, and technology prerequisites. Use a bounded dependency graph with cycle validation and reusable subplans. Do not hard-code a separate checklist for every age or future culture.

For example, a Bronze mounted army needs reserves, horses, its retained-age equipment, raw inputs for bronze, refining, a weapon producer, and suitable recruitment facilities. Owning a stable or researching the cavalry definition alone is insufficient.

Translate demand into target buffers using the planned number of recruits/refits, expected losses, input lead time, and replacement horizon. The existing arbitrary low-output recipe preference is not an army-production plan. Schedule producer capacity deliberately, including safe recipe changes and competing material consumers. Do not repeatedly cancel funded jobs to chase a new preference.

Preserve confirmed rules:

- Stone Age troops need no manufactured weapons; mounted Stone units still require horses.
- Every post-Stone recruit needs its own definition's manufactured equipment.
- Older unlocked troops remain recruitable with their retained equipment even without newer-age materials.
- Mounted cavalry retains horse costs in later ages. Tanks instead need manufactured armament, steel, oil, and reserves.
- Upgrade/refit existing units through the same domain requirements as human orders; completion resets promotion to recruit.
- Complete every node in any two trees within the current age to advance. Do not silently change that rule because an AI production plan prefers Economic research.

Prefer viable older-age replacements when current-age production cannot sustain an army. Evaluate a refit against equipment demand, downtime, actual combat improvement, lost promotion, and threat; do not upgrade every eligible idle formation immediately.

Research priorities follow dependencies, current opponents, geography, and personality. Age advancement uses its exact configured fee and eligibility, not a permanent 50K threshold. An AI may finish two trees or revisit the unfinished third according to its plan, while obeying all prerequisites.

## Persistent army model

An army operation references existing units; it is not a new physical blob replacing them. Proposed state includes:

| Field | Purpose |
| --- | --- |
| Stable operation and army IDs | Persist intent across decision cycles and diagnostics. |
| Owner and member IDs | Authoritative assignment; a formation cannot be promised to two armies. |
| Mission and objective IDs | Defend city/front, capture resource, breach defences, conquer production, assist ally, or recover. |
| Composition target | Roles/definitions, required strength, siege/counter needs, and admissible older replacements. |
| Muster/rally/reinforcement points | Reachable positions where arriving recruits assemble safely. |
| State | Planning, mustering, moving, engaging, breaching, reinforcing, retreating, recovering, completed, or cancelled. |
| Readiness and retreat policy | Minimum assembled capability, loss thresholds, uncertainty margin, and fallback route. |
| Route/supply references | Shared corridor/topology revisions and actual resupply/replacement access. |
| Commitment and evaluation ticks | Prevent unnecessary reorders and schedule material rechecks. |

Bronze Armies is a fifth Warfare technology with a confirmed initial cap of 20 squad formations. Later researched army caps and definition-tier squad capacities grow; see [armies, formations and squad sizes](armies-formations-and-squad-sizes.md) for membership, columns, role deployment and manual/automatic tactics. Strategic operations can coordinate ordinary legal units before Bronze, but may not receive Armies bonuses or unlocked tactics without research. AI operations and domain army entities are separate responsibilities, not two owners of squad state.

Readiness and timing thresholds are authored tuning values. Avoid a global minimum of eight squads or sending every fourth squad irrespective of mission needs. Small scouts, cavalry raids, city guards, and siege armies need different readiness criteria. Budget both formations and their actual tier-based manpower/equipment costs; refitting creates capacity, not free replacement soldiers.

Recruitment fills operation demand by capability: screen/frontline, ranged support, mounted mobility, siege/artillery, anti-air, transport/escort, and reserves as applicable. Content tags distinguish vehicles from mounted units even when the input line is shared. Do not assume each role is mutually exclusive or count the same unit twice.

## Conquest behaviour

Evaluate reachable objectives by useful land/resources, enemy production/recruitment, defensive geometry, expected combat outcome, reinforcement distance, replacement cost, and strategic exposure. An enemy's original camp is one possible objective, not a universal conquest destination.

Assemble the chosen force, keep vulnerable ranged/siege units screened, and use the existing shared movement systems. Siege identifies a valuable breach; ordinary troops do not endlessly attack a wall while available siege pursues an unrelated building. Use authored charge capabilities when path, impact geometry, cooldown, target value, and risk justify them.

Local self-preservation and immediate engagement can interrupt movement, but must preserve the army mission and leash/return policy. Prevent a distant decoy from pulling every member away from defending a city or escorting siege. Rejoin, reinforce, or retreat according to the operation rather than forgetting the objective.

After capturing a camp, evaluate remaining sovereign control and recovery under the accepted [defeat direction](defeat-and-territory-inheritance.md), alongside surviving hostile forces/production. A building-free army wipe cannot stand in for nation conquest. Consolidate valuable production and pursue a bounded completion plan instead of camping permanently or scattering into unrelated fights.

Naval transport operations need boarding capacity, reachable embark/landing points, escort requirements, and a feasible landing army. Aircraft and strategic launchers select worthwhile legal objectives using capability, payload cost, expected effect, air/missile defence, and ally safety. Lowest entity ID is not a strategic targeting rule.

## Combat estimates

Use the authoritative combat model to evaluate a bounded candidate force/defence comparison, with cached matchup terms. Include actual age, XP, capacity and current strength/HP, armour, accuracy, damage channel, range, reload, target bonuses, charge, projectiles/blast, cover, structures, and travel/supply context. Forecast poor pre-Modern gunpowder accuracy and slow Early Modern firearm reloads rather than assuming every displayed damage value lands continuously. Do not independently preserve the old 1,000-strength clamp in an AI power formula.

A single global troop count cannot tell whether an enemy has cavalry, siege, anti-air, tanks, or aircraft. Confidence and missing observations affect risk margins. Anti-air targets aircraft only; missile interception is a separate capability. Retained older units can be effective against the right matchup, but promotion alone must not override the confirmed next-age benchmark.

## Acceptance

Validate bootstrap, sustained replacement production, mixed-age recruitment, resource loss recovery, coordinated muster, reinforcement, siege breaches, retreats, conquest completion, and ally defence. Include staged connected defence, safe gates/trade access, useful trench/nest placement, repair/fallback decisions and appropriate air/missile counters as acceptance for this push. Record rejected-command rate, idle producers, stranded stock, decision switching, force assembly time, protected-asset survival and actual territory/objective outcomes. A higher win rate achieved by privileged resources or hidden exact enemy data is not success.
