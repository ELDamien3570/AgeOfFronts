# Armies, formations, tactics, and squad sizes

Status: confirmed gameplay direction with proposed contracts and tuning values. September 30, 2026. Documentation only; no simulation or UI changes.

## Confirmed rules

- Add **Armies** as a fifth Bronze Warfare technology. Keep Bowcraft and Fortified Settlements.
- An army initially contains at most **20 selectable squad formations**, not 20 individual soldiers. Its cap increases in later ages.
- Select several squads and organize them into a persistent army with a convenient clickable icon.
- Movement uses a cohesive marching column travelling roughly **10% faster than its slowest troop**.
- Combat deployment supports infantry in the centre, archers behind, and cavalry on the flanks.
- Include flanking and archer fire-and-retreat tactics, both player-selected and available through an **automatic-tactics toggle**.
- Squad sizes increase by unit tier. Older units retain their smaller capacity until explicitly upgraded; faction advancement alone does not enlarge them.
- Additional squad HP is the primary intended size benefit. Improved armour reduces incoming damage; it does not implicitly change reload speed.
- Gunpowder should be fairly inaccurate before Modern. Early Modern firearms also have slow reloads. Accuracy, armour, reload and HP require separate balance controls.
- Existing paid research, manual unit-card upgrades, manufactured weapons, horse/tank costs, promotion reset, reserve conservation, independent allied ownership, and legal command rules continue to apply.

The exact later caps, squad sizes, Armies prerequisite/quote, formation dimensions, automatic-tactics default, and tactical timing values below are proposals. They are not approved numerical balance or runtime evidence.

## Source foundations and missing pieces

The inspected source already supports multiple selected squads, shared group routes, legal separated destination slots, queued orders, local avoidance, passage handling, and client control groups. Reuse those systems; replacing them with a second pathfinder or an independent army movement engine would create conflicting authorities.

| Existing source | Current responsibility / integration consequence |
| --- | --- |
| [Formations](../../../src/skirmish/Formations.ts) | Plans roughly square destination slots with legal fallbacks. It does not maintain role-based battle deployment or a continuous marching column. |
| [Simulation orders and movement](../../../src/skirmish/Simulation.ts) | Validates selected IDs, destinations and paths; derives individual movement speed from terrain, unit/charge profile and defensive slow zones. Army movement must cooperate with these rules. |
| [Route work](../../../src/skirmish/RouteWork.ts) | Deterministic FIFO; an entry larger than the remaining budget waits. Current background routing drains 24 squad work units/tick and AI raids use cohorts of at most 16. A later 50-squad army cannot become one indivisible 50-unit queue entry. |
| [Control groups](../../../src/skirmish/client/ControlGroups.ts) | Client selection shortcuts, not authoritative membership or gameplay bonuses. Keep selection groups distinct from domain armies. |
| [Unit definitions](../../../src/skirmish/domain/Definitions.ts) | Have role, age, attacks, armour, speed and costs; no authored squad capacity or attack accuracy yet in the inspected contract. |
| [Combat](../../../src/skirmish/domain/Combat.ts) | Clamps strength to 1,000 when scaling damage. Changing only `SQUAD_TROOPS` would leave incorrect combat scaling. |
| [HUD ViewModel](../../../src/skirmish/client/HudViewModel.ts) | Several recruitment labels and strength meters use the global squad constant. Later-tier capacities must come from the actual definition. |

Recruitment, spawn, replenishment and AI's 650-strength recovery threshold also assume the fixed 1,000-strength squad. Renderer strength bars/sizing have similar assumptions. Recheck every consumer before implementation; this is a coordinated domain change, not a larger number in a single constant.

## Technology and growth placement

Proposed B-W5: **Armies**, prerequisite B-W1 Bronze Equipment, **7,000 gold / 45 seconds**. Research unlocks organizational capabilities without requiring a completed army or 20 recruits. Army creation organizes existing owned units; proposed creation itself consumes no manpower/equipment or extra fee.

All five Bronze Warfare nodes count for completion. B-W4 still requires Bowcraft and Chariot Warfare; Armies is a separate branch from Bronze Equipment. Classical Professional Infantry requires both B-W4 and B-W5, preserving catch-up when the player advanced using Naval/Economic. No Economic/Naval prerequisite is added to organizational research.

Proposed later capacity improvements are bundled into existing Warfare foundations. They do not introduce additional paid nodes. This makes army capacity a researched military capability while each squad's capacity remains a property of its recruited/refitted unit definition.

| Tier | Proposed army cap | Proposed main land-squad capacity | Existing Warfare home for cap increase |
| --- | ---: | ---: | --- |
| Stone | No organized-army capability yet | 1,000 | Ordinary multi-selection/control groups remain available |
| Bronze | **20 confirmed** | 1,500 | B-W5 Armies |
| Classical | 25 | 2,000 | C-W1 Professional Infantry |
| Early Medieval | 30 | 2,500 | EMed-W1 Mail Equipment |
| Late Medieval | 35 | 3,000 | LMed-W1 Steel Equipment |
| Early Modern | 40 | 4,000 | EMod-W1 Firearms |
| Modern | 50 | 5,000 | M-W1 Modern Armaments |

These squad numbers are a first infantry/ranged/mounted tuning curve, not a requirement that siege crews, tanks or aircraft represent thousands of physical machines. Author role-specific reserve/strength semantics. Naval hull health, airframe health and strategic payloads are separate systems. Army cap is a membership cap, not the faction's total formation cap or permission to raise supported simulation populations.

A Classical player with unrefitted Stone infantry keeps 1,000-capacity Stone squads; newly recruited Classical infantry uses its larger definition. Formally organizing Stone troops later is legal after Armies is researched. Developed tribes use the same unlocks and caps, with no free Armies grant on becoming a nation.

## Domain model and ownership

Use a small domain `Army` entity with stable ID, owner, member squad IDs, chosen formation/facing, current army order, march/deployment state, automatic-tactics setting, tactical stance and relevant revisions. Resolve its cap from the owner's researched capability; do not store a second independently mutable research/cap authority inside each army. These are proposed names/contracts, not implemented types. An AI operation references an army; its strategic objective, spending commitments and recruitment demand remain planner state.

Squads retain their own position, strength, definition, XP, attacks, cooldowns and equipment lifecycle. An army coordinates intent and assignments; it neither replaces the squads with one damageable blob nor owns copies of every squad's mutable state. Domain/application command handling validates membership changes and orders atomically. The force index remains a projection of squad lifecycles.

Proposed membership rules:

- Only owned living land squads; one army per squad. Reject duplicates, hostile/allied members and oversize requests with a clear reason. Do not silently choose an arbitrary 20 from a larger selection.
- Add/remove/disband are explicit actions. Creating a new army cannot silently steal members from another army. Ordinary loose-unit multi-selection is not capped at the organized-army limit.
- Death removes a member once. Embarkation/refit temporarily suspends its active slot and march contribution while retaining membership; explicit detach frees capacity. Transport/aircraft are not accidentally counted as land members.
- Joining distant reinforcements assemble before becoming active marching members. A missing, unreachable or blocked member produces a visible regroup/detach decision, not teleportation or indefinite silent dragging.
- A direct individual order is proposed to detach that squad after a visible indication. Whole-army orders preserve membership. Batch refits remain governed by the separately agreed unit-upgrade policy.
- Pausing, save/load/reset and ownership changes preserve/rebuild valid membership and revisions. Disbanding changes organization, not physical unit count, manpower or inventory.

Avoid a faction-sized aggregate that locks every unit transaction together. Commands and committed lifecycle changes maintain the small membership index; AI and ViewModels read immutable projections.

## Marching column

Proposed lifecycle: **assemble -> form column -> march -> deploy -> fight**, with interrupted/regroup/retreat branches. The bonus begins only once an eligible active column is formed, and ends when deploying, fighting, charging or losing required cohesion. Repeated clicks must not restart assembly for free or stack bonuses.

On comparable terrain the column cruise target is `1.10 * min(ordinary eligible member speeds)`. Ordinary speed excludes charge/temporary sprint boosts and respects terrain and defensive slow effects. Evaluate affected members on the actual corridor so a leader on fast ground cannot pull a slower member through a slow zone at illegal speed. During an organized march the slowest member receives the intended 10% organizational bonus; fast cavalry slows to column pace. This does not grant the column 110% of the fastest member's speed.

Use route arc length and stable member order for longitudinal slots, with authored spacing/footprints and limited lane count according to available width. Follow the same traversable corridor with offsets validated against terrain, fortifications and friendly passages. Do not assign straight world offsets through turns, water or intact walls. Narrow passages compress the column and wider ground allows orderly deployment; do not push the back of the army through an occupied gate merely to preserve visual spacing.

Local avoidance and passage arbitration remain authoritative for actual displacement. Cap speed/spacing corrections, slow the head when the tail falls behind, and expose stragglers. Catch-up cannot create another speed multiplier or let a unit skip a blocked route. Suspend the bonus and regroup when the cohesive state is no longer valid. Exact thresholds and assembly/deployment times need tuning.

Enemies can exploit a column's deployment time and exposed rear. Apply ordinary role positioning and combat rules rather than an unexplained universal column armour debuff. Valid-path charge remains a separate committed ability; it cannot stack with the marching bonus. Retreat does not acquire the bonus immediately while under fire.

Shared navigation jobs must be bounded independently of army cap. Split member connector/repair work into admissible chunks while retaining one army intent and shared corridor. Preserve fair scheduling across factions, bounded queue age, stale-order cancellation and deterministic tie-breaking. Do not increase the route budget to the largest army and thereby hide a new tick spike.

## Battle formations and tactics

Resolve placements from combat roles/tags rather than the three legacy `kind` values. Infantry screens the centre, ranged troops occupy a protected rear, mounted cavalry takes flanks, and siege/artillery uses protected reachable firing positions. Later anti-air, tank and launcher roles need authored assignments; a vehicle does not become horse cavalry because it shares an input line.

Choose facing from the player's formation intent or a bounded observed threat/approach direction. Legal nearby fallback slots handle coasts, gates and crowded fronts. Missing roles leave a compact usable formation rather than permanent empty wings. Preserve useful assignments across movement so changing facing does not continually exchange every member's slot. Depth/width need to reflect available space, range and actual geometry.

| Order / tactic | Proposed execution |
| --- | --- |
| Deploy / hold formation | Assemble legal role slots; maintain a leash around the ordered frontage/objective rather than chasing any distant target. |
| Flank left / right | Retain a central screen; send eligible mobile members along a reachable side route toward a selected or observed vulnerable side. Abort/rejoin if blocked, overextended or too risky. No teleport, hidden enemy query or automatic charge grant. |
| Fire and retreat | Deploy within legal range, stop for an eligible shot/volley, withdraw a bounded distance behind the screen, reload normally and reform. Preserve cooldowns, ammo/payload and movement firing penalties. Poor Early Modern accuracy and slow reload remain real drawbacks. |
| Regroup / retreat | Pick a reachable fallback, recover cohesion and avoid sacrificing isolated reinforcements. No automatic healing or transport creation. |

Manual orders and automatic tactics use the same domain execution contracts. With the toggle off, retain ordinary unit self-defence and execute the chosen orders without the planner starting new flanks/withdrawals. With it on, a bounded tactical planner may choose legal actions consistent with the current objective and stance. A recent explicit player order takes priority; avoid automatic behaviour immediately overriding it. Default toggle state, aggression/leash/loss thresholds and how long explicit intent remains authoritative are open tuning/UI decisions.

Tactical evaluation uses permitted nearby observations and cached role/readiness summaries. Recheck on material threat, terrain or membership changes and a staggered cadence; do not evaluate every possible flank and assign every squad every tick. Friendly treaty changes, dead targets, range loss and new barriers invalidate actions explicitly.

## Larger squads, HP, armour and gunpowder

Keep at least three concepts explicit: **current manpower strength**, **maximum squad capacity**, and **authored combat durability/attack quality**. Current land strength already acts as a durability quantity. A proposed first scope increases its definition-specific ceiling to provide more HP, instead of adding a second unrelated health pool. If vehicles need crew versus hull separation, design that distinction explicitly for their definitions rather than claiming land strength is a count of tanks.

Recommended damage tuning uses authored full-squad attack power multiplied by remaining-strength fraction `currentStrength / definitionCapacity`. Larger capacity therefore primarily adds endurance; full attack power can increase through authored weapon/age quality without automatically multiplying again by headcount. This normalization is a proposal, not a confirmed exact formula. Do not retain the 1,000 clamp or apply both a headcount multiplier and a full-squad tier multiplier without accounting for the combined effect.

Armour applies to incoming damage in the relevant melee/ranged channel. Reload remains an independent interval: Early Modern firearms have deliberately slow reloads; Modern weapons improve cadence and accuracy through their definitions. Better armour need not rise monotonically for every role: infantry, artillery, cavalry and tanks have different protection/counter relationships. Penetration, siege bonuses and blast keep armour from making combat interminable.

Add an explicit accuracy/spread model to attack profiles, separate from range, reload, projectile size and blast radius. Proposed gunpowder shots sample a deterministic aim error with distance/movement modifiers, then resolve the actual impact/hit geometry. Misses can miss; a visual inaccurate projectile must not secretly deliver guaranteed direct damage. Do not compensate for poor accuracy by inflating the projectile hitbox. Exact scatter distributions, near-range reliability, intended friendly-fire rules and pre-/post-Modern values remain to be authored.

Apply this to early naval cannon, Late Medieval field guns and Early Modern firearms/artillery where appropriate. Modern is more accurate, not automatically perfect. Existing Projectile Size defines collision footprint and Blast Radius defines area damage; neither is an accuracy percentage. Keep per-shot/volley work bounded; do not instantiate one bullet for every represented soldier. Use existing projectile limits and explicit damage budgets for multi-hit blasts.

Promotion benchmarks must now include capacity, actual strength, armour, accuracy and reload. Compare a fully promoted older same-branch squad with a full next-tier recruit in controlled matchups, and separately report damage, survivability and equal-manpower/cost efficiency. The confirmed older-below-next-age goal must survive these changes without making every unrelated counter matchup impossible. Refitting resets promotion and cannot silently refill health.

## Recruitment, refits, reserves and equipment

Recruitment spends the actual definition's full reserve requirement and creates that paid strength once. Replenishment consumes only the available reserves for the missing strength up to the squad's own capacity. Use proportional readiness thresholds rather than `650` for every definition. Older recruits use their older capacities and original weapons, regardless of the faction's latest age.

Recommended refit completion changes definition/capacity and resets XP while retaining current surviving strength; increasing capacity creates room for later paid replenishment, not free soldiers. The refit price and any required newer equipment are a separately authored recipe. Example: a full 1,500-strength Bronze squad upgraded to a 2,000-capacity Classical definition starts at 1,500/2,000 until 500 real reserves replenish it. Cancellation must not leave a larger capacity, duplicated equipment or free restored strength.

Post-Stone equipment costs must account for bigger squads and replacements. Decide whether existing equipment items represent batches/kits for an authored capacity or use quantity-per-strength blocks; the current one-equipment-item-per-formation sketch cannot silently imply unlimited equipment as capacities increase. Cavalry still pays horses; tanks still pay armament, steel, oil and reserves. Exact additional equipment/horse replenishment requirements remain open supply decisions. Commercial cargo stays separate.

The [city/manpower curve](manpower-and-city-upgrades.md) must be evaluated in full contemporary squad costs as well as a 1,000-reserve benchmark. With the proposed sizes and one proposed upgraded city plus the 2/second baseline:

| Tier | New-squad reserves | Proposed growth / second | Time to fund one fresh full squad |
| --- | ---: | ---: | ---: |
| Stone | 1,000 | 10 | 100s |
| Bronze | 1,500 | 14 | About 107s |
| Classical | 2,000 | 32 | About 63s |
| Early Medieval | 2,500 | 37 | About 68s |
| Late Medieval | 3,000 | 47 | About 64s |
| Early Modern | 4,000 | 67 | About 60s |
| Modern | 5,000 | 92 | About 54s |

This preserves the proposed Classical acceleration while ensuring better infrastructure still faces meaningful manpower demand. It is a hypothesis, not validated pacing; multiple cities, weapons, replenishment, losses, research spending and trade can change the actual result substantially. Do not increase growth automatically to keep every largest army instantly full.

## Selection and UI integration

After research, multi-selection exposes **Create Army**, showing selected formations versus cap and eligibility reasons. An army icon in the battlefield and a compact owned-army list select its surviving members in one click. The army card on the left exposes name, `members / cap`, actual strength versus combined capacities, role mix, march/deploy status, stance, automatic-tactics toggle and available orders. Show selected older/newer units honestly; do not display one synthetic XP level or one averaged equipment tier as though it belongs to every member.

Army markers are selection handles, not giant replacement sprites. Anchor to a stable reachable leader/assembly point rather than a centroid that can sit in water or inside a wall; display a broken-cohesion indicator when appropriate. Marker clicks take precedence over the units they cover, without intercepting right-click target orders. At close zoom retain individual markers; at distant zoom use decluttering while preserving visible selection and deterministic hit testing.

The existing [formation icon kit](<../../../Art/Formation Icons/README.md>) has seven unit-role markers and separate rank insignias; a dedicated army symbol is still a planned asset. Proposed symbol: a distinct banner over several small formation blocks, faction-tintable, readable at 24-32 pixels. Do not reuse promotion stars as an army or age indicator. New artwork is outside this documentation pass.

ViewModels resolve membership/capacity, eligibility, costs, status, tactics and selection from immutable snapshots. Input sends intent with stable IDs; the domain chooses slots and validates the real state. No UI-owned roster may grant the march bonus or edit troop capacity. Keep existing selection groups useful before Bronze without granting Armies gameplay capabilities.

## AI, force queries and scaling

Smart [defensive construction](ai-defensive-construction.md) is required in this same push. Army demand includes real trench/nest support, gate frontage, breach response, reinforcement/retreat access and mobile aircraft defence. Share commitments and researched capabilities with the construction planner; neither an empty enclosure nor an unassigned anti-air vehicle counts as a protected objective. Manual/automatic army orders retain the same authority and membership contracts.

The shared AI planner recruits against researched army caps and actual squad costs, with role demand expressed in both formation count and manpower strength. It compares depleted large squads and full smaller squads using their real definitions. It reserves forces for defence/reinforcement instead of filling every army solely because capacity exists.

An AI can maintain strategic operation assignments before Bronze, but cannot receive organized-column bonuses or unlocked army tactics before researching Armies. Automatic player tactics and nation/tribe tactics use the same legal commands, observations, routes, cooldowns and costs. Profiles affect risk/priority, not physical capabilities or free formations.

Faction force queries expose actual live strength and summed definition capacities by type, with army assignment as a secondary dimension. Membership changes do not duplicate fielded unit counts. Diplomacy retains exact own/allied counts and observer-derived enemy estimates; organizing hidden units into an army cannot reveal their exact roster.

Growing the represented soldiers in one squad must not create one simulation entity per person. More army members does create real navigation/combat/rendering work, so qualify the proposed 25-50 caps alongside larger faction/tribe populations, not only in a single army demo. Geometry, projectile population, selection, snapshots, force-index revisions and route-queue age need bounded budgets.

## Delivery and acceptance

1. Settle capacity/HP/damage normalization, equipment accounting, research placement and legal order precedence; add authored definition values and domain validation.
2. Integrate tier-aware recruitment/replenishment/refit, combat and HUD consumers; validate reserve conservation and existing promotion benchmarks.
3. Implement persistent membership and immutable army projections, then selection/card affordances.
4. Extend existing navigation with bounded cohesive column control and march/deploy transitions; qualify choke points before enabling the bonus.
5. Add role deployment and manual tactics; add automatic selection using the same execution contracts, then integrate AI operation planning.
6. Tune larger ages against paid city upgrades and run combined scale/pacing qualification before raising supported limits.

Required scenarios: Bronze research locked/unlocked; exactly 20 versus 21 members; all-member selection and detach/death/refit/embark; mixed ages/speeds; slow siege in a cavalry army; sharp turns, bridges/gates, coasts and blocked destinations; ambush during march; repeated-click/charge/retreat bonus exploits; route jobs for 20/25/50-member armies without starvation; depleted larger squads and partial replenishment; refit without free HP; early inaccurate shots versus slow reload and armour; manual order priority with auto toggle; flanking without hidden enemy data; treaty changes mid-tactic; exact force-count reconciliation; one-hour matches at the scale targets.

Gameplay quality requires actual coherent motion, readable deployment and useful tactics in integrated play. A destination-grid screenshot or passing static type checks alone does not establish it.
