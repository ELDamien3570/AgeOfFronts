# Manpower and city upgrades

Status: confirmed direction with proposed balance values and unresolved event rules. September 30, 2026. Documentation only; no simulation changes.

## Confirmed direction

- Population in this request means troop reserves/manpower for recruitment and replenishment, not a separate civilian population simulation.
- Slow early-game manpower growth.
- City upgrade technologies unlock paid upgrades for individual cities; research does not automatically increase every existing city's output.
- Classical is the first substantial growth breakpoint, rather than waiting for Late Medieval or Early Modern.
- The user is considering Medieval plague events to bring manpower back down. Plagues are an optional proposal, not a confirmed implemented system or an agreed casualty rule.
- Squad capacity increases with each unit tier; older troops remain smaller until refitted. Increased HP is the primary size benefit. Fund actual tier costs rather than treating every new formation as 1,000 reserves; see [armies and squad sizes](armies-formations-and-squad-sizes.md).

## Current source behaviour and its limits

In the inspected `ages-v1` path, [Simulation.produceReserves](../../../src/skirmish/Simulation.ts) grants 40 reserves/second per living faction plus `40 * (city age index + 1)` for each completed city. One Stone city therefore yields 80/second including baseline, enough for 1,000 fresh reserves in 12.5 seconds. The reserve ceiling is 200,000.

The starting manpower budget is 12,000. The three 1,000-strength starting formations consume 3,000 through `spawnSquad`, leaving 9,000 reserves before income. Those nine additional formations can be recruited once facilities permit, regardless of how much growth is slowed. Review the starting bank alongside growth; do not claim the early-army problem is solved by lowering a rate alone.

Current city income uses the building's stored age; the inspected paths do not establish the required paid upgrade lifecycle for existing cities. Source values are observations, not accepted new balance values, and must be refreshed before implementation.

## Growth model

Use authored city definitions/tiers with explicit manpower output. An empire-age transition changes eligibility, not the effective output of existing cities. Research grants a city-upgrade capability; a successful paid upgrade changes the individual city tier after its job completes under the eventual agreed timing policy.

Proposed normal output is a small faction baseline plus completed owned cities' effective outputs. Resolve effective city output from its actual tier and current modifiers. Do not use the faction's newest age as a substitute for the tier of every city.

The ordinary output is independent of the fielded-unit index. Newly generated reserves are not soldiers spawned on the map. Recruitment and replenishment continue to consume the one authoritative reserve balance. Weapon stocks, horses, steel/oil, recruitment facilities, and army commitments remain separate constraints.

## Candidate curve for testing

These numbers are starting hypotheses, not approved prices/rates or a one-hour balance result. They assume a proposed 2 reserves/second recovery baseline and one completed city of the listed tier, with no plague modifier and space below the reserve ceiling. The last column measures a fixed 1,000-reserve budget, not necessarily a complete later-tier squad. The army plan pairs these rates with proposed rising squad capacities; its Modern example needs about 54 seconds for 5,000 reserves, rather than 11 seconds for a full new squad.

| City tier | Existing Economic technology | Proposed city output / second | Baseline + one city | Time to generate 1,000 new reserves |
| --- | --- | ---: | ---: | ---: |
| Stone | S-E1 Settlements | 8 | 10 | 100 seconds |
| Bronze | B-E2 Urban Workshops | 12 | 14 | About 71 seconds |
| Classical | C-E2 Urban Planning | 30 | 32 | About 31 seconds |
| Early Medieval | EMed-E1 Agricultural Organisation | 35 | 37 | About 27 seconds |
| Late Medieval | LMed-E3 Guild Commerce | 45 | 47 | About 21 seconds |
| Early Modern | EMod-E2 Manufactories | 65 | 67 | About 15 seconds |
| Modern | M-E2 Industrial Production | 90 | 92 | About 11 seconds |

This deliberately makes Classical's city investment a large improvement over Bronze. Medieval normal output remains useful; an optional plague is a temporary disruption, not an automatic permanent downgrade on entering an age. Later city investments support larger armies if weapons and other supplies can keep up.

Recommend testing a starting reserve bank around 2,000 after the three granted formations, enough for two full replacements before growth. With today's setup deduction, that would require a 5,000 total initial manpower budget, not 2,000 before spawning the starting army. Both the bank and baseline remain proposals.

Tune reserve storage separately from output. The current 200,000 ceiling allows extensive early hoarding; lowering growth does not remove stock already accumulated. Review storage, recruitment throughput, initial reserves, multiple cities, and casualty replacement together before assigning a new ceiling.

## Existing technology bindings

Keep the seven city technologies inside the current 85-node catalogue, including the separate Bronze Armies addition. The table above binds manpower capabilities to existing nodes; city growth requires no additional counted research nodes or altered two-tree advancement rule.

Stone Settlements allows the initial city with slow growth. Bronze Urban Workshops allows a modest city improvement. Classical Urban Planning unlocks the first major paid city improvement. The Medieval/Modern city nodes unlock further tiers; their other production/trade capabilities remain intact.

A city upgrade requires its researched capability. Advancing through Warfare/Naval alone does not silently grant an Economic city tier. This makes economic investment strategically meaningful, but its army advantage must be tested so Economic does not become a compulsory tree in practice despite the two-tree choice. Test sustained older troops, multiple lower-tier cities, naval advantage, and technology prices without quietly changing advancement eligibility.

Sequential city upgrades are a proposed default. Whether an older city may jump directly to an unlocked later tier, at what cumulative cost, and how catch-up technologies apply are open content rules. Do not infer them from its current art or empire age.

## Paid city upgrade lifecycle

1. Select an owned completed city and request a particular unlocked city definition/tier through the existing left building card.
2. The domain checks ownership, capability, compatible source/target tiers, job state, configured cost, and match state. No ViewModel mutates a city or reserve rate.
3. Spend the configured price once on an accepted command. Rejected/duplicate requests do not charge twice.
4. Proposed behaviour is a timed city upgrade job, keeping its old output until completion. A timer, material inputs, pause/output policy, cancellation/refunds, and capture interruption must be authored before implementation; only a paid per-city upgrade is confirmed.
5. Commit the new tier/output atomically at successful completion and invalidate city-income/read-model revisions. Research alone changes only eligibility.

Do not grant free structural healing or duplicate commercial delivery stock as a side effect of changing tier. Existing health, pending shipments, placement, and ownership follow explicitly chosen upgrade rules. Whether upgrading the visual/production city tier changes its factory access or other services needs content-specific definitions rather than a broad implicit age multiplier.

On capture, remove the city's growth from its former owner and apply the agreed rule for the new owner once. Whether an already upgraded captured city gives full output without the captor's matching research remains open; either rule must be consistent with other captured-producer capabilities and shown in the card.

## Multi-city and recovery balance

Adding cities remains a legitimate alternative to upgrading, with real prices, placement/access needs, and defence obligations. Test whether inexpensive Stone-city spam recreates fast opening growth. Use explicit authored construction costs and any approved placement/returns rules, not a hidden AI-only penalty or an arbitrary multiplier based on CPU load.

Keep a recovery path after the first city is lost. A small recovery baseline is proposed for that purpose; it should not dominate Classical or later upgraded-city output. No background rate increase simply for occupying more land or entering another age is implied by this new direction.

Slower growth can delay fielded populations but does not solve dense late-game scaling. Continue the existing capture, movement, snapshot, and population qualification work. Larger tribal starts must be measured alongside the same manpower rules and explicit development policy.

## Medieval plague proposal

Record plagues as a possible event system over cities/factions, without introducing civilian agents, housing, food demand, or per-person disease simulation. The current reserve ledger is faction-wide; it does not establish where individual reserve soldiers live.

Potential effects need an explicit choice:

| Candidate | Effect and limitation |
| --- | --- |
| Temporary growth suppression | Lowers affected city output; already saved reserves remain available. It slows replacement, but cannot by itself reduce an existing bank or fielded army. |
| Reserve attrition plus suppression | Reduces the stored manpower bank under a bounded authored rule; this can bring manpower down, but requires warnings, mitigation, and a clear relation to affected cities. |
| Fielded military casualties as well | Adds direct losses to live units; substantially harsher, affects the force index and war outcomes, and is outside confirmed plague scope. |

Do not select one implicitly. A growth slowdown must not be described as killing population. A global reserve pool must not be presented as an already modelled local civilian population.

Recommend warning, temporary duration, bounded severity, and recovery/mitigation choices before any attrition rule. Randomly removing a large army without a meaningful response would undermine strategic investment. Whether plague occurs, its location, timing, susceptibility, spread, and counterplay remain design decisions; do not use it as hidden rubber-banding against the strongest faction.

Possible resilience could attach to existing Medieval civic/agricultural capability bundles, but this is a proposal. Do not add extra mandatory research nodes or claim medieval events always occur to justify the hour-long balance curve. Specify whether eligibility follows a global match era or individual faction age so staying Stone cannot accidentally create permanent disease immunity.

Represent an outbreak through deterministic scheduled domain state with event ID, start/end ticks, affected scope, and explicit modifiers. Restore normal authored output when the modifier expires; do not permanently downgrade city tiers or compound the same debuff every tick. Stacking/capture ownership, mitigation costs, and public intelligence follow explicit policy. Enemy estimates cannot use outbreak information to reveal hidden exact force counts.

## AI and UI integration

The AI economy planner budgets per-city upgrades against military survival, weapons, research, and commercial infrastructure. Forecast manpower from actual completed tiers, active modifiers, and bank commitments. At Classical, a paid upgrade can become a valuable bottleneck-removal task; an unlocked upgrade is not already producing income.

Guardian and Warlord operations must reserve manpower for replenishment as well as fresh recruits. If plagues are approved, planners reevaluate losses, upgrade/mitigation options, commitments, and attack readiness rather than continuing orders based on an obsolete growth rate.

Show reserves separately from fielded strength in the resource strip, with net growth and stock ceiling where applicable. City cards show actual tier/output, next legal paid upgrade, exact costs, waiting reasons, and job progress. Technology detail says "Unlocks city upgrade" and previews the output improvement; it does not claim every city improves when research completes.

If events are later approved, show current affected output and source/duration of modifiers. A reserve-generation change updates economy projections; only actual unit creation, replenishment, or casualties changes the live military force index.

## Validation and open choices

Measure replacement time, actual new formations, initial bank use, city construction/upgrade investment, multiple-city growth, equipment bottlenecks, research pacing, military losses, and sustained populations across all seven ages. Compare economic and Warfare/Naval advancement routes and normal versus resource-poor starts.

Check research without city ownership, research without upgrading, age advance with an old city, upgrade completion/cancellation, insufficient payment, duplicate commands, capture/destruction mid-job, storage at ceiling, and city loss recovery. For optional plagues, add stockpiled reserves, changing owners, overlapping events, mitigation, expiry, and independent AI/knowledge behaviour.

Still open: exact growth/storage/starting bank; upgrade prices, timers, skipping and interruption; captured-city research policy; plague adoption/effects/visibility/spread/counterplay. Use proposed values for experiments, not as implemented or user-approved balance.
