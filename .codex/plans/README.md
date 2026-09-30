# Age of Fronts design plans

Updated September 30, 2026.

These documents specify planned behaviour and balance hypotheses. They do not establish that the simulation implements these systems.

## Documents

- [Technology, ages, and cultures](tech-tree-and-cultures.md): tree structure, culture content, starting grants, and explicit troop upgrades.
- [Match pacing and opening](pacing-and-opening.md): one-hour target, proposed advancement curve, three-melee opening, and bootstrap economy.
- [Trade, cargo, and factory logistics](trade-and-economy.md): automatic free traders, multi-stop cargo, foreign/allied returns, and military capture.
- [Strategic resources and weapon production](strategic-resources.md): horses first, nodes, stables, mining/refining, blacksmiths, arms factories, and late rigs.
- [Fortifications, walls, and siege](fortifications-and-siege.md): tower-linked barriers, city access, destruction, and siege in every age.
- [Diplomacy and alliances](diplomacy-and-alliances.md): territory-click offers, OpenFront timing, renewal, betrayal, and victory modes.

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
13. Horses are the first resource unlock. Early cavalry relies on capturing horse nodes; stables generate horses slowly at first and faster through later research. Mounted cavalry costs horses.
14. Add stone, bronze, iron, steel, gunpowder, and oil. Unlock mines early for stone; research enables other raw extraction. Mines extract raw materials and factories process manufactured materials. Rigs unlock late for oil.
15. Blacksmiths and arms factories consume strategic materials to make weapons required for troop recruitment. Strategic materials and weapon production remain separate from commercial trader cargo.
16. Add towers that form walls to nearby towers, with fortification research and siege weapons in every age. Ordinary troops destroy defences slowly; siege can breach without infantry doing the damage.
17. Diplomacy starts from clicking another player's territory and offering an alliance. Alliances expire and require mutual renewal.
18. Use OpenFront timing: offers 20 seconds, request cooldown 30 seconds, alliance term five minutes, renewal window thirty seconds, and betrayal status thirty seconds.
19. Betrayal makes the betrayer's territory easier for enemies to capture and walls weaker. Initial numerical magnitudes are proposals.
20. Solo versus Allied Victory is a selectable game mode configured before the match; default and joint-win eligibility remain open.
21. Allies initially retain independent units, buildings, gold/resources, research, recruitment, and replenishment. Commercial delivery bonuses are not shared ownership.
22. Preserve MVVM and Domain-Driven Design. Domain rules own progression, production, delivery/capture, diplomacy, fortifications, and financial transactions.

The expanded trade decisions supersede the earlier owned-endpoint-only, paid city recruitment, and destruction-only trader sketch.

## Current working proposals

- Four nodes per tree per age, with a foundation, two branches, and a final technology requiring both.
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

| Area                | Still to settle                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Individual research | Prices/durations, queue length, cancellation, and refunds. Concurrency and gold-funded research are settled.                                                                                                                         |
| Opening/economy     | Starting cash, reserve/formation strength, building prices, and bootstrap income sufficient to establish the first factory after city/barracks.                                                                                      |
| Unit refits         | Costs, timer, location, interruption, health/orders, and multi-selection behaviour. The left-card action is settled.                                                                                                                 |
| Strategic supply    | Raw recipes/yields, weapon categories and quantities, producer placement by age/tree, equipment use on refits, building/material costs, depletion, and map fairness. Horse costs and weapon-dependent troop recruitment are settled. |
| Resource ordering   | Whether Horsemanship must precede every other resource technology; earliest horse access is settled. Avoid accidental cross-tree dependence.                                                                                         |
| Cargo generation    | Throughput, automatic route priorities/editability, active trader caps, naval launch/transfer, and exact capacity/payout values.                                                                                                     |
| Factory income      | Whether the prototype's separate 20-gold/second factory payment is removed with goods production. Port payment replacement is settled.                                                                                               |
| Fortifications      | Connection range/multiple-neighbour policy, wall pricing, gates/access, construction/repair, tower attacks, and capture versus destruction.                                                                                          |
| Betrayal            | Confirm exact weakness magnitude and repeated-event handling. Timing and the two penalty types are settled.                                                                                                                          |
| Victory             | Default mode, qualifying allied group, and whether all-player agreement alone can end a match.                                                                                                                                       |
| Shared services     | Keep independent initially; any allied boarding, replenishment, shared vision, or material transfer is later explicit scope.                                                                                                         |

## Architecture and balance risks

The old prototype gold scale cannot meet a 50K first advancement fee within the new pacing target unchanged. Balance trade output, prices, reserves, strategic materials, and combat/refits together.

Manufactured resources must not be mineable deposits; refining and weapon recipes need conservation. Strategic materials, finished weapons, and commercial cargo have separate inventories. Free traders must not create free duplicate goods or endlessly farmable capture bounties.

Weapon-dependent recruitment can make Economic compulsory in practice if all extraction and equipment producers require it. Keep Warfare production capabilities explicit and review material access before claiming equivalent development paths; do not alter the confirmed two-tree advancement condition.

Walls require dynamic navigation, gate access, and capture constraints. Visible wall lines or movement slowdowns alone do not meet the requested system.

## Implementation sequence proposed

1. Shared domain definitions, match ruleset, startup grants, one-hour balance budget, building-free three-melee setup, and explicit left-card refits.
2. Horses first: capturable nodes, slow stable production, researched improvements, and mounted costs; then early stone mines, refining, blacksmiths, and weapon-dependent recruitment. Commercial goods remain separate.
3. Stone/Bronze research, paid/timed advancement, factory goods, bounded automatic traders, multi-stop delivery, foreign/allied modifiers, capture return, and port-income replacement.
4. Diplomacy at OpenFront timing, betrayal, tower/wall/gate barriers, and Stone/Bronze siege, using the same ownership/navigation policies.
5. Validate that integrated first-two-age slice, then author later resource recipes, unit definitions, fortifications/siege, culture substitutions, and seven-age progression.

All requested systems remain in the overall scope. Sequencing a first playable slice is a production proposal, not an instruction to ship placeholder systems as complete.
