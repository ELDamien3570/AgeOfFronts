# Age of Fronts design plans

Updated September 30, 2026.

These documents specify planned behaviour and balance hypotheses. They do not establish that the simulation implements these systems.

## Documents

- [Technology, ages, and cultures](tech-tree-and-cultures.md): tree structure, culture content, starting grants, and explicit troop upgrades.
- [Complete base technology catalogue](base-tech-tree.md): all 85 nodes, including Bronze Armies, with prerequisites, capability bundles, proposed prices/timers and budget.
- [Base technology map](base-tech-tree-map.md): seven age-by-age diagrams of the catalogue.
- [Art coverage audit](base-tech-tree-art-audit.md): all nine Art categories, exact unit identities, source families and missing assets.
- [Combat, promotions and charge](combat-and-promotions.md): separate attack/armour/reload stats, experience, star levels, triggered charge abilities, and separate projectile/blast dimensions.
- [Match pacing and opening](pacing-and-opening.md): one-hour target, proposed advancement curve, three-melee opening, and bootstrap economy.
- [Trade, cargo, and factory logistics](trade-and-economy.md): automatic free traders, multi-stop cargo, foreign/allied returns, and military capture.
- [Strategic resources and weapon production](strategic-resources.md): horses first, nodes, stables, mining/refining, blacksmiths, arms factories, and late rigs.
- [Fortifications, walls, and siege](fortifications-and-siege.md): tower-linked barriers, city access, destruction, Modern gun nests/trenches, and siege in every age.
- [Modern defences and strategic weapons](modern-defences-and-strategic-weapons.md): retained walls, aircraft-only anti-air vehicles, fixed/mobile MIRV launchers, payload separation and counterplay.
- [Diplomacy and alliances](diplomacy-and-alliances.md): territory-click offers, OpenFront timing, renewal, betrayal, and victory modes.
- [Materials and technology UI](ui-materials-and-technology.md): current HUD review, resource strip, Supplies/Technology panels, recruitment tiers, and left-card upgrades.
- [Optimization and AI improvement](<optimization and ai improvement/README.md>): scale investigation, faction force indexes, army/economy planning, personality profiles, developing tribes, and diplomacy force inspection.
- [Armies, formations, and squad sizes](<optimization and ai improvement/armies-formations-and-squad-sizes.md>): Bronze 20-squad armies, marching cohesion, manual/automatic tactics, tier-based squad HP and manpower demand.
- [AI defensive construction](<optimization and ai improvement/ai-defensive-construction.md>): required in this AI push; strategic defensive sites, staged tower/wall layouts, gates/access, supporting forces and Modern counters.

## Confirmed decisions

1. Begin with one default culture; later add cultures such as Italians and Americans. Choose culture once per match.
2. Use Naval, Warfare, and Economic trees across the seven art ages. Complete every technology in any two trees within the current age to advance; the third may remain unfinished.
3. Research costs gold and takes time. Reset technology each match. Use one research queue per tree, following the accepted proposal.
4. A match progressing through the whole technology tree should take about one hour.
5. Age advancement itself costs gold and takes time. First transition: 50,000 gold and 30-45 seconds; later transitions grow somewhat in cost and duration.
6. Default culture starts with Flint Weapons and Settlements completed. Under the four-node draft, Warfare and Economic start at 1/4 and Naval at 0/4.
7. Start with three melee units, no buildings, and enough gold for a city plus barracks.
8. Upgrade existing troops by selecting them and clicking Upgrade in the unit card on the left.
9. Factories automatically generate traders with no recruitment cost. A finite factory load supports several delivery stops; capacity affects how many.
10. Traders drop goods only at cities and ports. Completed deliveries earn gold. Foreign trade pays substantially more than domestic; allied trade pays more again.
11. Enemy troops/ships must intercept traders to capture them. Foreign territory alone does not trigger capture. Captured land traders return to the captor's nearest city for money; captured trade ships cash out at the nearest reachable owned port.
12. Physical trader deliveries replace passive port trade income. The user will supply animated trader and trade-ship sprites.
13. Horses are the first resource unlock. Early cavalry relies on capturing horse nodes; stables generate horses slowly at first and faster through later research. Mounted cavalry always costs horses, including older mounted units recruited in later ages. Tanks replace the horse requirement with manufactured armament, steel, oil and reserves.
14. Add stone, bronze, iron, steel, gunpowder, and oil. Unlock mines early for stone; research enables other raw extraction. Mines extract raw materials and factories process manufactured materials. Rigs unlock late for oil.
15. Blacksmiths and arms factories consume strategic materials to make weapons required for post-Stone Age troops. Stone Age troops do not require manufactured weapons. Older unlocked troop types retain their original weapon requirements and remain recruitable without the current age's material. Strategic materials and weapon production remain separate from commercial trader cargo.
16. Add towers that form walls to nearby towers, with fortification research and siege weapons in every age. Ordinary troops destroy defences slowly; siege can breach without infantry doing the damage.
17. Diplomacy starts from clicking another player's territory and offering an alliance. Alliances expire and require mutual renewal.
18. Use OpenFront timing: offers 20 seconds, request cooldown 30 seconds, alliance term five minutes, renewal window thirty seconds, and betrayal status thirty seconds.
19. Betrayal makes the betrayer's territory easier for enemies to capture and walls weaker. Initial numerical magnitudes are proposals.
20. Solo versus Allied Victory is a selectable game mode configured before the match; default and joint-win eligibility remain open.
21. Allies initially retain independent units, buildings, gold/resources, research, recruitment, and replenishment. Commercial delivery bonuses are not shared ownership.
22. Preserve MVVM and Domain-Driven Design. Domain rules own progression, production, delivery/capture, diplomacy, fortifications, and financial transactions.
23. Mining stays independent of Horsemanship; earliest horse access does not impose a global Warfare prerequisite.
24. Basic naval gunpowder unlocks in Late Medieval to match the cannon-equipped ship art; handheld infantry firearms and larger powder production arrive in Early Modern.
25. Aviation and strategic weapons are Modern unlocks, including the airstrip, fighters/bombers, missile silo, ICBM and hydrogen-bomb capabilities.
26. Troop stats include Melee Armour, Ranged Armour, Melee Attack, Ranged Attack, Range and Reload Time; charge-capable definitions also expose Charge Speed, Damage and Reload Time.
27. Promotions use the seven-level star art and combat experience from damage, kills and objectives. Maximum promotion should remain slightly below next-age recruits in the corresponding branch. Successful age refits reset promotion to recruit.
28. Certain units charge on double right-clicking an enemy or area: valid-path acceleration, small-area impact damage and partial armour penetration.
29. Projectile Size and Blast Radius are separate stats for siege weapons and bombs: projectile/hitbox footprint versus damage area.
30. Modern gun nests and trenches replace the new Modern wall tier. Older walls remain usable; advancing does not automatically convert them.
31. Modern includes fixed MIRV launcher buildings and mobile MIRV launcher vehicles for multiple-warhead missiles.
32. The new support vehicles are anti-air: they target aircraft only. Missile defence is separate.
33. Keep the wall kit age labels: Stone palisades, Bronze stone walls, Classical massive stone walls. These attach to existing Warfare final nodes; Early Medieval retains its planned wall upgrade.
34. Scaling priorities are more AI factions, more tribes, and larger tribal armies. Improve AI economy, army construction, and conquest, with configurable war/economy/betrayal/ally-defence profiles.
35. Maintain queryable unit composition by faction and type for AI decisions.
36. Diplomacy inspection shows exact own/allied unit counts and enemy estimates. Enemy observation, visibility, and estimate calibration remain to be designed explicitly.
37. Tribes can become full AI nations after defeating a human player or nation. The gradual settlement-development path remains a proposal; its stages and numerical gates are not yet confirmed. Conquest attribution and activation details need explicit policy.
38. Slow early troop-reserve/manpower growth. City upgrade technologies unlock paid upgrades for each city; Classical is the first substantial city-driven growth breakpoint. This request does not add a separate civilian population system.
39. Keep a faction alive when it retains usable owned territory from which it can rebuild, even if its army and buildings are gone. An army wipe alone must not annex the whole nation; precise terminal control/surrender rules remain open.
40. Add Armies as a fifth Bronze Warfare technology. Initial organized-army capacity is 20 squad formations, with a clickable selection icon and increasing capacity in later ages.
41. Armies move in cohesive marching columns roughly 10% faster than their slowest member, and deploy infantry in the centre, archers behind and cavalry on the flanks. Flanking and archer fire-and-retreat support both manual orders and an automatic-tactics toggle.
42. Squad capacity grows with its unit tier; older troops stay smaller until explicitly upgraded. Additional squad HP is the primary size benefit. Armour reduces incoming damage, independently of attack/reload cadence.
43. Pre-Modern gunpowder is fairly inaccurate; Early Modern firearms also reload slowly. Accuracy, armour, HP and reload require separate tuning.
44. Include smart AI defensive building in this same push: connected tower/wall layouts around important sites, plus appropriate Modern trenches, gun nests, anti-air and missile defence where unlocked. Use shared legal placement/cost rules and preserve city/port trade and reinforcement access.
45. Towers automatically fire arrows at passing hostile ground troops in legal range. Ships, aircraft, strategic projectiles, civilian traders and friendly/allied units are not eligible. Tower weapons are bundled into existing tower unlocks; exact combat values and firing-over-wall rules remain open.

Medieval plague events are under consideration. Their adoption, reserve/fielded casualty scope, timings, spread and mitigation remain open; see [manpower and city upgrades](<optimization and ai improvement/manpower-and-city-upgrades.md>).

The expanded trade decisions supersede the earlier owned-endpoint-only, paid city recruitment, and destruction-only trader sketch.

## Current working proposals

- Usually four nodes per tree per age, with a foundation, two branches, and a final technology requiring both; Bronze Warfare additionally has the confirmed Armies node and requires 5/5 completion.
- Culture differences replace comparable progression slots rather than changing advancement workload accidentally.
- Catch-up prerequisites retain missing older tiers in the unfinished third tree.
- Target Modern entry around 52 minutes, leaving roughly eight minutes for final research/endgame.
- Initial advancement curve: 50K/40s, 75K/45s, 110K/50s, 160K/55s, 230K/60s, and 330K/65s.
- Revised Stone content includes Craft Workshops, Stone Mining, Goods Handling, Horsemanship, and Field Engineering with walls/siege.
- Bound free trader generation by factory production and active dispatch capacity. Capacity upgrades increase useful delivery stops, not unbounded free actor spawning.
- Proposed domestic/foreign/allied trade values: 1x/2.5x/3.5x, subject to income-per-second balancing.
- Proposed betrayal modifiers: capture time 80% of normal and wall resistance 50% for the thirty-second status.
- Use shared authoritative barrier/reachability rules for troops, traders, fortifications, capture, and siege.

## Remaining decisions

| Area                      | Still to settle                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual research       | Prices/durations, queue length, cancellation, and refunds. Concurrency and gold-funded research are settled.                                                                                                                                                                                                                                          |
| Opening/economy           | Starting cash, reserve/formation strength, building prices, and bootstrap income sufficient to establish the first factory after city/barracks.                                                                                                                                                                                                       |
| Unit refits               | Costs, timer, location, interruption, health/orders, and multi-selection behaviour. The left-card action is settled.                                                                                                                                                                                                                                  |
| Strategic supply          | Raw recipes/yields, weapon categories and quantities, producer placement by age/tree, equipment use on refits, building/material costs, depletion, and map fairness. Stone exemption, retained older weapon requirements, mounted horse costs and tank armament/steel/oil/reserve inputs are settled; exact quantities and refit recipes remain open. |
| Cargo generation          | Throughput, automatic route priorities/editability, active trader caps, naval launch/transfer, and exact capacity/payout values.                                                                                                                                                                                                                      |
| Factory income            | Whether the prototype's separate 20-gold/second factory payment is removed with goods production. Port payment replacement is settled.                                                                                                                                                                                                                |
| Fortifications            | Connection range/multiple-neighbour policy, wall pricing, gates/access, construction/repair, tower attacks, capture versus destruction, and trench cover/occupancy/crossing/gun-nest links.                                                                                                                                                           |
| Betrayal                  | Confirm exact weakness magnitude and repeated-event handling. Timing and the two penalty types are settled.                                                                                                                                                                                                                                           |
| Victory                   | Default mode, qualifying allied group, and whether all-player agreement alone can end a match.                                                                                                                                                                                                                                                        |
| Combat/promotion          | Exact stats/armour curve, XP thresholds/attribution, promotion benchmark tuning, charge roster/geometry/cooldown/abort policy, and naval/air promotion scope.                                                                                                                                                                                         |
| Aviation/strategic combat | Aircraft sorties, aircraft-only anti-air balance, airfield capacity, fixed/mobile MIRV recipes and launch/deployment rules, bounded warhead targeting, separate missile-defence placement, warnings/flight, damage/friendly fire and victory interaction.                                                                                             |
| Roads                     | Placement/route-generation/upgrade policy and actual movement effects; existing tiles alone do not supply the rules.                                                                                                                                                                                                                                  |
| Shared services           | Keep independent initially; any allied boarding, replenishment, shared vision, or material transfer is later explicit scope.                                                                                                                                                                                                                          |

## Architecture and balance risks

The old prototype gold scale cannot meet a 50K first advancement fee within the new pacing target unchanged. Balance trade output, prices, reserves, strategic materials, and combat/refits together.

Manufactured resources must not be mineable deposits; refining and weapon recipes need conservation. Strategic materials, finished weapons, and commercial cargo have separate inventories. Free traders must not create free duplicate goods or endlessly farmable capture bounties.

Post-Stone weapon-dependent recruitment can make Economic important in practice if extraction and equipment producers require it. The confirmed Stone exemption and retained older recruitment recipes provide fallback forces. Keep Warfare production capabilities explicit and review material access without altering the two-tree advancement condition or forcing every recruit to use the player's newest age.

Walls require dynamic navigation, gate access, and capture constraints. Visible wall lines or movement slowdowns alone do not meet the requested system.

## Implementation sequence proposed

1. Shared domain definitions, match ruleset, startup grants, one-hour balance budget, building-free three-melee setup, and explicit left-card refits.
2. Horses first: capturable nodes, slow stable production, researched improvements, and mounted costs; then early stone mines, refining, blacksmiths, and weapon-dependent recruitment. Commercial goods remain separate.
3. Stone/Bronze research, paid/timed advancement, factory goods, bounded automatic traders, multi-stop delivery, foreign/allied modifiers, capture return, and port-income replacement.
4. Diplomacy at OpenFront timing, betrayal, tower/wall/gate barriers, and Stone/Bronze siege, using the same ownership/navigation policies.
5. Validate that integrated first-two-age slice, then author later resource recipes, unit definitions, fortifications/siege, culture substitutions, and seven-age progression.

All requested systems remain in the overall scope. Sequencing a first playable slice is a production proposal, not an instruction to ship placeholder systems as complete.
