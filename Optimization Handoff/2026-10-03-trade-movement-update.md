# Trade, formations, production and fortifications — 2026-10-03

This update implements the six issues raised after the 30-minute playtest. Rules and costs stay in the authoritative domain; the interface issues ordinary commands. This document does not change the completion status of the original 30 optimization plans.

## Trade rules

- Factories support land merchants; ports support sea merchants and produce their own goods. Factories no longer funnel goods or additional merchants into ports.
- Let `F` and `P` be completed, researched factory and port stack levels. The normal fleet target is `T = min(48, F + P)`, with `round(T * F / (F + P))` land merchants and the remainder at sea. For example, 40 factory levels and 20 port levels target 32 land and 16 sea merchants. One factory supports one merchant, rather than instantly filling the whole fleet.
- Each physical site can spawn at most one merchant every 20 seconds. A stack shares its site's cooldown. Capturing an actor does not reset the cooldown; a checkpoint preserves it.
- Cargo uses `1 + 2 * sqrt((clamp(level, 1, 10) - 1) / 9)`. This rises from 1× at level 1 to 3× at level 10, with diminishing marginal gains. The existing researched vessel capacity and cargo-handling bonuses still apply. Extra stack levels past 10 add no cargo multiplier.
- Captured merchants have no health. They deliver captured cargo to their new owner once, then leave service permanently. Normal spawning stops at 48 owned actors. Transferred prize couriers can temporarily put a recipient above 48 while completing that delivery; transfers add no world actors, and normal spawning also respects a global limit of 48 times the number of surviving regular factions.
- Rebalancing retires excess empty merchants at their next loading boundary, rather than destroying loaded cargo.

### Markets and diplomacy

Sea merchants choose one port and deliver their entire load. They prefer allied ports, then neutral ports, then enemy ports, using approximate distance within each tier and at most eight route candidates. There is no sea self-trade. Civilian routes reuse bounded shared corridors; AI investment observes those trips instead of starting a second multi-stop trading planner.

Land merchants use owned cities and ports, or nearby allied/neutral markets across a shared faction border. Foreign land markets must be within `max(12 tiles, 5% of map width)` of the source. Nearby foreign markets attract merchants using the payout premium, without changing the payout by distance. They cannot choose enemy markets or cross unrelated hostile/unowned territory.

Trade neutrality follows the accepted existing war-policy rule: an enabled AI is neutral unless either side's AI has an active war or retaliation; allies remain allied. Two non-allied human factions remain enemies for land trading. Combat diplomacy itself is unchanged.

Production has independent Stop/Resume overland and overseas trade controls. Diplomacy has Stop/Resume trade with the inspected nation. Pausing a mode returns its cargo without payment and stops spawning/loading that mode; it leaves the other fleet's active trips alone. Blocking a nation acts in both directions and redirects affected trips. Captured deliveries can still complete.

### Payout and pace

Starting land rates are **5 / 10 / 20 gold per good** for self / allied / other permitted foreign trade. There is no age or land-distance multiplier. The original 25 / 50 / 100 suggestion established the 1:2:4 ratio, rather than those exact values.

A Stone Age factory costs 1,000 gold and makes two goods per second. At 5 gold per good, ideal self-trade earns 10 gold per second, giving a 100-second production payback before construction, route and handling delays. At 25 gold per good the same ideal payback would be only 20 seconds. Factory costs and goods production both increase by age; leaving the per-good rate constant avoids multiplying both production and payout by age.

Existing building-count prices make the first ten Stone Age factories cost 23,500 gold in total. A ten-level stack can supply twenty goods per second, while its merchants carry at most three times their normal researched cargo. Cargo scaling improves the ability to move production; it does not multiply the production rate or remove travel time. These are initial balance values requiring playtesting, not an empirical claim that the economy is perfectly balanced.

Sea payouts use the same allied/foreign rates, multiplied by straight-line distance relative to map width. Below 1% of width the multiplier tapers below 1×; from 1% to 25% it rises from 1× to 3×, and then caps. Every non-empty foreign delivery pays at least one gold. Captured cargo pays its base salvage value to the captor, without a foreign/distance premium.

Reducing the former 64-merchant ceiling to 48 reduces the maximum normal fleet's actor count by 25%, or 160 actors across ten fully capped factions. That is not a claim of 25% lower total match CPU. The greater routing saving comes from eliminating duplicate trade searches and multi-stop planning.

## Movement and large selections

Selections remain unrestricted. A large order is internally partitioned into spatial cohorts of at most 30 squads with distinct destination slots. Compatible cohorts share one long corridor for the command, with bounded exact entry and exit connectors. A failed connector falls back to its own route; it never treats the shared corridor as proof that the individual squad is unreachable. Pending corridors, connectors and command outcomes survive restore.

Human movement and ship admissions receive two thirds of their contested work allowance, with unused work returned to fair scheduling. Route scheduling also prioritizes interactive human movement, armies and shore transport over AI/background trade, and reserves queue capacity for human requests. This gives priority rather than a hard latency guarantee; an exclusive workspace recovery can still briefly delay other callers.

Friendly physical separation changes from 0.7× to 0.5× of combined squad radii. Terrain footprints, enemy separation and normal avoidance comfort remain unchanged. The movement recovery also joins a nearby point on an existing route from the squad's actual position, avoiding repeated repairs toward an occupied coarse tile centre. Structure attacks distribute legal firing positions across exposed sides, use deferred admissions, and retain their structure target during recovery. Physical frontage still limits how many melee squads can attack a small structure at once.

Measured on the same open 300×200 map, Modern infantry, with AI disabled and a long movement order:

| Squads | Previous complete admission | Updated complete admission |
| ---: | ---: | ---: |
| 20 | 10.80 seconds | 1.05 seconds |
| 50 | 25.35 seconds | 1.70 seconds |
| 100 | 50.95 seconds | 2.75 seconds |
| 200 | 109.35 seconds | 5.00 seconds |

These are simulation-time admission delays, not total journey duration or Oracle measurements. The 200-squad case completed without workspace escalation or route-limit outcomes. Its first cohort committed at 4.4 seconds. Congested terrain and mixed unit kinds can take longer.

## AI production, ports and walls

The AI can bootstrap its first owned coastal port without requiring another faction to have built a foreign port first. It subsequently targets at least one port level per eight factory levels, subject to normal research, ownership, cost and placement validation.

Missing compatible blacksmiths, armories and arms factories are production prerequisites even at the squad cap. They can preempt growth/research saving goals and routine refitting. Profiling exposed another dependency loop: owning ore was not sufficient to request its mine, so an AI could keep selecting Stone Age troops despite owning copper and tin. Planning now considers owned, researched deposits attainable and prioritizes the missing extraction and refining steps. Normal commands and production still require real gold and stock; attainable resources grant no purchasing credit. A runtime regression starts from zero stock and unmined copper/tin, builds both mines, a factory and a blacksmith, and actually produces Bronze Age equipment.

The same long run exposed a separate placement trap: a crowded capital could exhaust the nearest 64 owned tiles and revisit that same window indefinitely. Construction now pages through owned land in stable distance/tile order, retaining its eight exact placement checks per decision. A page contains at most 64 tiles; exhausted searches wrap only after traversing the owned territory. Page cursors survive checkpoints, and every candidate still goes through current domain validation. The crowded-capital regression verifies a legal workshop beyond the initial window. After resuming the 32-minute checkpoint with this correction, all eight substantial surviving AI factions had blacksmiths by minute 40, with 115 Bronze Age squads between them. The two remaining regular AI factions had only 87 and zero land respectively.

Placing a second tower can quote and fund its wall link while the first tower is still under construction. The wall waits at least as long as either endpoint's remaining construction, and is charged once. Walls and trenches remain enabled; trenches retain their existing movement/cover rules.

## Transport durability

Transport health equals the damage of one same-age warship hit after transport armour, multiplied by `1 + 0.5 * ageIndex`. The authored health values are 128, 249, 432, 703, 1,095, 1,663 and 2,468 across the seven ages. The resulting whole-hit thresholds are 1, 2, 2, 3, 3, 4 and 4. Half-hit increments describe health, rather than fractional attack events. Merchant actors do not use health or combat destruction.

## Validation and release scope

Validation results are saved in `out/transport-land-orders-20261003/`:

- Combined Vitest suite: **1,194 / 1,194 tests passed**, 176 test files (`trade-movement-final-suite.json`). TypeScript and production build passed. Changed-file ESLint retains one pre-existing unused `tile` variable in `Simulation.ts`; this update's new planner/trade checks introduce no lint diagnostics.
- Trade control DOM interactions, neutrality/capture, stock conservation, quotas/cooldown, restore and replication; production dependencies; movement priority/cohort restore; simultaneous tower construction; all-age naval damage thresholds.
- Ten authenticated local multiplayer protocol clients: **passed**, 500 map size, ten AI, 25 tribes, all five AI policies (`trade-movement-final-online-smoke.json`). Covered all human movement receipts and physical movement, AI movement, building completion, all six trade-control commands and replication, water embarkation, land-click disembarkation and inland continuation, invalid unload rejection, reconnect, and 38 matching canonical-state samples. Command execution took 5–9 simulation ticks (0.25–0.45 seconds) for the tested three-squad human moves.
- Seeded Valles Kairulia 500 simulation reached **40 game minutes without a stall**, with 468 squads, eight military ships, 652 buildings and 47 merchant actors. All five AI policies were enabled. The resource-planning correction was profiled from the saved 17.785-minute checkpoint, and the placement correction from minute 32; this is not a fresh-from-tick-zero run of both corrections. Reports, checkpoints, timelines and CPU profiles are in `trade-movement-profile-complete/` and `trade-movement-placement-recovery/`.

At minute 32, the final 256-tick window measured mean tick 21.4 ms and p95 30.5 ms. At minute 40, it measured mean 29.8 ms, p95 39.4 ms and p99 41.8 ms; routing mean/p95 was 8.9/17.1 ms, movement 6.9/8.6 ms and capture 4.9/6.5 ms. Snapshot encoding p95 was 0.81 ms. Those final windows fit the 50 ms budget for 20 ticks per second on this local x64 machine. Earlier windows still had transient p95 spikes around 53–74 ms, sometimes while build/test/client work shared the machine. Therefore these results do not establish that all stutter is eliminated. The route queue also still had 40 jobs and a 127-tick oldest job at the final sample, so human prioritization and shared corridors improve responsiveness without proving every late-game order is immediate.

The browser surface returned `net::ERR_BLOCKED_BY_CLIENT` for localhost, so DOM tests do not establish visual browser acceptance. Ten protocol clients are not ten rendered browsers. Local x64 profiling does not establish Oracle ARM capacity. These are the implementation's pre-release validation results; Oracle release verification is recorded separately. The changed runtime/catalog hash requires a matching client build and fresh matches when released.
