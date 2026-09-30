# Match pacing and opening

Status: design draft. Updated September 30, 2026.

Related plans: [technology](tech-tree-and-cultures.md), [trade](trade-and-economy.md), [strategic resources](strategic-resources.md), and [the decision register](README.md).

## Confirmed constraints

- A match that goes through the whole technology tree should last about one hour.
- Research uses one queue per tree, following the accepted concurrency proposal. Cancellation/refund policy is still open.
- Age advancement has a gold cost and a timer. The first transition costs 50,000 gold and takes 30-45 seconds; later transitions are somewhat longer and more expensive.
- The default culture starts with Flint Weapons and Settlements unlocked.
- Start with three melee units, no constructed buildings, and enough gold to construct a city and barracks.
- Existing troops are upgraded by selecting them and using the unit card on the left.
- Traders are generated automatically by factories without a recruitment charge.
- Delivery trade replaces passive port income.
- Blacksmiths and arms factories turn strategic materials into weapons required for troop recruitment; commercial cargo is separate.

The hour is a progression/balance target, not a mandatory sixty-minute match timeout. Early victories remain possible. Reaching Modern is not identical to finishing every Modern technology or catching up an unfinished third tree.

## Initial pacing proposal

All values below are starting balance proposals. Only the one-hour target and the first transition's 50K/30-45-second range are confirmed.

| Destination age              | Target arrival after match start | Advance cost                           | Advance timer     |
| ---------------------------- | -------------------------------- | -------------------------------------- | ----------------- |
| Bronze                       | About 7 minutes                  | 50,000 gold                            | 40 seconds        |
| Classical                    | About 15 minutes                 | 75,000 gold                            | 45 seconds        |
| Early Medieval               | About 23 minutes                 | 110,000 gold                           | 50 seconds        |
| Late Medieval                | About 32 minutes                 | 160,000 gold                           | 55 seconds        |
| Early Modern                 | About 42 minutes                 | 230,000 gold                           | 60 seconds        |
| Modern                       | About 52 minutes                 | 330,000 gold                           | 65 seconds        |
| Remaining technology/endgame | About 52-60 minutes              | Individual research/unit-upgrade costs | Individual timers |

The six advancement fees total 955,000 gold and the six advancement timers total 315 seconds. These timers are included in the arrival targets, not added after them.

Four technologies per tree per age gives 84 nodes across seven ages. With two startup grants, full completion entails 82 research purchases. That is more work than the minimum two-tree advancement route: 48 counted nodes across the first six ages, with up to two of those already granted at startup.

Research can overlap across trees. Propose early individual research around 20-35 seconds, rising toward 45-75 seconds late; actual gold prices and all node durations still need a budget pass. Keep room for construction, fighting, resource acquisition, delivery travel, and unit refits. Do not force the hour target by making every technology a long idle timer.

## Economy scale must change coherently

The prototype's 3,000 starting gold, 800-gold city, 400-gold barracks, and 20-gold/second factory income belong to a different scale from a 50K first advancement fee.

For scale: 50,000 divided by 10 gold/second is about 83 minutes; at 30 gold/second it is about 28 minutes, ignoring other spending. Actual camp income also includes a territory term. Those examples demonstrate the mismatch; they are not forecasts of the new trade economy.

Saving the first advancement fee alone within seven minutes requires roughly 119 net gold/second on average. Research, construction, combat spending, and interruptions increase the required gross income. Later fees require rising productive capacity, not just increasing timers.

Rebalance the economy as a whole. Do not multiply the gold display while leaving prices or earnings on inconsistent scales. Gold remains one authoritative integer balance; 50K is game gold, not a second currency.

Use measured budgets per age:

1. Starting cash and early-city/barracks cost.
2. Time to establish the first goods-producing factory and reachable delivery city.
3. Domestic delivered income and reserve generation.
4. Research expenditure and the savings needed for the next age.
5. Weapon producers, material/weapon throughput, horse supply, unit recruitment/refit, and fortification expenditure.
6. Foreign/allied delivery bonuses, losses to capture, and defensive spending.

Domestic trade must support the normal progression target without mandatory diplomacy. Foreign and allied trade can accelerate development or support a larger army, but should not routinely let an uncontested pair finish the game in a small fraction of the target hour.

## Opening setup and bootstrap

Grant exactly three melee units through match setup. Do not create a completed barracks, city, factory, port, stable, or mine.

Starting gold must be at least the current configured city cost plus barracks cost. Recommend a modest buffer as well. Exact starting cash and building prices are provisional; the confirmed guarantee follows the ruleset, not the prototype's old 3,000 constant.

Three melee units refers to three game combat entities. Their troops per formation and starting reserve balance still belong to the balance pass; do not silently turn the instruction into three individual people or retain the old four-unit opening.

A spawn marker or ownership anchor is not a constructed building. Review the current camp-based elimination rule for this new opening so a player is not eliminated merely because no building exists yet.

Avoid an economy deadlock: the player must be able to establish goods production after spending on the required city and barracks. Proposed bootstrap options are modest baseline income independent of buildings, a larger construction buffer, or an initially affordable factory. Choose one coherent setup during the numerical pass; do not claim it is already settled.

Horses are the first resource unlock and Stone extraction follows early in the design. Strict research ordering is still to be settled. The first city/barracks cannot demand mined materials that the player has no means to obtain. Recommend gold-only opening structures or an explicit starting material allowance. New strategic-resource costs need this same bootstrap check.

The weapon chain adds another startup constraint: a barracks alone cannot recruit replacements without equipment. Budget the first blacksmith/basic equipment recipe and its inputs alongside the first commercial factory. Starter weapon stocks versus an immediately viable basic-weapon recipe remains open; the three starting units are granted without constructing a producer.

## Research and troop upgrades are separate

Research grants the player's eligibility to recruit/refit a new definition; it does not silently transform every existing formation.

Selecting troops opens their left unit card. The card shows the available upgrade, gold/material requirements, duration if applicable, and the reason it is unavailable. The Upgrade action submits a domain command targeting the selected owned unit IDs and a specific researched definition.

Propose a visible per-unit refit job for substantial changes. Validate ownership, technology, materials, funds, and upgrade compatibility atomically. Keep health/casualties, identity, and orders according to an explicit refit policy; no free full healing or duplicate resource spending.

Unit-upgrade prices, refit duration, whether units must stop or visit a building, and mixed-selection handling remain open. New troops require produced weapons, and cavalry recruitment additionally spends horses. Weapon quantities, equipment spending for existing-unit refits, and whether a mounted equipment refit needs additional horses are separate recipe decisions.

The Modern armour definition must not consume horses just because it develops from the cavalry line. Horse-to-vehicle conversion needs an explicit available upgrade and material/production rule.

## Balance acceptance

A representative run must cover all three research trees and the full seven-age content when assessing the hour-long target. Track minimum two-tree advancement separately so omitted research cannot make the full-tree goal appear satisfied.

Measure target age arrival, research completion, domestic versus international income, capture losses, force size, resource accessibility, stable production, and siege breaches. Prices in this document are hypotheses until those runs exist.

Do not claim a one-hour balance result from arithmetic or static source inspection alone.
