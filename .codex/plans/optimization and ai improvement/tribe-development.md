# Tribe development

Status: conquest-based graduation is confirmed; ordinary settlement development and numerical thresholds remain proposals. September 30, 2026.

Confirmed addition: a tribe that defeats a human player or nation can become a nation with the full AI capabilities. This is a second development route alongside the proposed gradual settlement path, not a requirement to finish that path first.

Implementation dependency: [the reproduced defeat-rule conflict](defeat-and-territory-inheritance.md) must be corrected first. The current rule eliminates a building-free faction after its starting troops die and transfers still-owned land automatically. The user accepted recovery while usable owned territory permits rebuilding; that recoverable army wipe must not qualify as genuine nation conquest. Exact terminal control/annexation conditions remain open.

## Feasibility and reuse

Current tribes already have stable player IDs, real squads/buildings, ownership, reserves, progression state, and inventory state. Their research/advancement and diplomacy are restricted explicitly, and routine AI economy development skips them. The underlying economy and progression domains can therefore be reused, but removing one `kind === tribe` check does not produce a competent developing faction.

Use the same [strategy and army planner](ai-strategy-and-armies.md) as regular nations, with smaller initial capability sets, budgets, and operations. Build reliable regular AI first. Creating an unrelated tribal planner would duplicate recruitment, materials, diplomacy, and movement decisions and make both harder to improve.

## Proposed development stages

| Stage | Capabilities and role |
| --- | --- |
| Camp | Small Stone force, connected expansion, local defence, and preparation for a viable settlement. Simple strategic tasks with real units and capture. |
| Settled tribe | Establishes a city and basic productive economy, researches selected legal Stone capabilities, acquires resources, and fields larger forces supported by replacements. Formal Armies/column bonuses remain locked until Bronze Armies research. Diplomacy eligibility is an explicit stage policy. |
| Emerging nation | Uses the full nation planner and normal age progression, production, naval/diplomatic capabilities as legally unlocked. It retains the same faction identity and history. |

Larger tribes need not immediately become nations. A successful camp can field a stronger Stone force while remaining a minor faction; development is an additional path tied to productive capacity.

## Graduation through conquest

When the authoritative defeat resolution credits a living tribe with defeating a human faction or full AI nation, it qualifies for nation status. Capturing a camp, winning a skirmish, taking a city, or destroying one army is not sufficient while the victim is still alive under the ruleset's elimination conditions.

Use the same canonical conquest/defeat credit as territory inheritance. The inspected [ConquestCredit](../../../src/skirmish/Conquest.ts) and [Simulation.checkWinner](../../../src/skirmish/Simulation.ts) already resolve terminal batches and beneficiaries. Recheck these changing paths before implementation; do not create another loosely coupled kill counter or derive graduation from a UI notification. Current conquest announcements exclude tribal beneficiaries and would need an explicit domain event path for this feature.

Proposed activation is one automatic graduation after credited terminal conquest, within the deterministic defeat-resolution transaction. It does not wait for optional settlement milestones. Exact activation/notification details are proposals; the qualifying trigger and full-nation capability direction are confirmed.

| Case | Required/proposed handling |
| --- | --- |
| Tribe defeats human player or nation | Qualifies for full-nation AI using canonical defeat credit. |
| Tribe captures the victim's original camp but forces/buildings survive | No graduation yet. |
| Several attackers defeat one victim | Use the single agreed conquest attribution; merely contributing damage does not automatically graduate every tribe. Attribution tuning remains a separate combat rule. |
| Credited attacker is also eliminated that tick | No posthumous nation. Respect the terminal batch's surviving beneficiary policy. |
| Tribe defeats another still-minor tribe | Not the confirmed qualifying case. Shared `Player` class storage must not confuse minor-faction defeat with defeating a player/nation. |
| Victim originated as a tribe but is now a full nation | Treat current full-nation status as qualifying, not its historical origin label. |
| Several qualifying defeats in one tick | Apply the capability transition and announcement once. |

Preserve faction ID, name/identity, culture, personality, troops/XP, buildings, territory, stock, and earned technologies. Do not call regular faction deployment again or grant its starting units/gold. Graduation enables normal nation economy/strategy, research/age advancement, diplomacy, naval planning, and army growth within legally unlocked content and qualified population rules.

Nation status is not an age advance. A Stone tribe becomes a Stone nation and must pay/research its progression normally. It does not inherit the defeated faction's technology, manufactured weapons, or entire treasury unless a separate capture rule explicitly grants them. Classical manpower acceleration still requires the actual researched paid city upgrades in the [manpower plan](manpower-and-city-upgrades.md).

Commit the new capability policy consistently for AI scheduling, recruitment cap, research, diplomacy, UI labels, and victory evaluation. Do not retain minor-tribe pursuit restrictions or a modulo-20 scheduling assumption merely because its original faction ID is above 20. Starting regular-AI setup limits and the number of living developed nations are separate concepts: graduation does not create an extra faction, but may greatly increase its future population/workload.

## Milestones and transition rules

Proposed gates use sustained survival and control, an established settlement, a viable production/replacement economy, and resource/route access. Avoid automatic free advancement based only on elapsed time or a land threshold. A temporary patch of disconnected land is not a productive settlement.

Author capability policy so each stage can legally reach the next. If settlement construction is a gate, its grant/research path must be available before the transition. If productive goods are a gate, the tribe needs lawful Workshop research, a factory, and a reachable city/port. Do not create a circular requirement that asks a tribe to research while its stage prohibits all research.

Advancement costs, research timers, equipment, horses, and two-tree completion remain the normal domain rules. Any explicit starting grant or exceptional stage action must be authored and reviewed as a game rule, not hidden in AI code.

Choose exact milestone thresholds, sustain duration, squad-cap growth, and transition costs through playtests. The current ten-squad tribal cap and 200-squad regular cap are observations, not automatically the correct stage targets. Changing development stage should not suddenly grant an unsupported maximum army.

## Identity and capability model

Separate faction origin/kind from current development and eligibility. An originating tribe can become developed without replacing its player record or assigning another ID. Do not change `kind` to regular and unintentionally inherit every regular capability, cap, scheduling slot, UI label, and victory assumption at once.

Keep existing territory, troops, promotion, buildings, stock, research, personality, relationship history, and culture. Culture is selected once per match; tribe development does not silently switch it. The first implementation uses the default culture unless another explicit starting policy is authored.

Centralize eligibility for research, advancement, diplomacy, construction, recruitment caps, and victory participation. Consumers query that policy; they should not each interpret a tribe label differently. Transitions invalidate capability/read-model caches and publish a clear development event.

## Interesting strategic outcomes

Examples are proposals rather than scripted guaranteed events:

- A tribe controlling horse access grows into a mobile regional threat, using real horse supply and manufactured equipment after Stone.
- A Builder tribe beside useful deposits establishes production and becomes a trading neighbour.
- An Opportunist expands while nearby nations fight, then bargains or attacks according to actual opportunity.
- A Guardian establishes a settlement and becomes a useful defensive partner once diplomacy is legal.

Map opportunity and actual decisions create these outcomes. Do not inject resources or change personality solely to ensure every tribe develops. Most tribes can remain small, fail, or be conquered; successful ones become meaningful emergent rivals.

## Scale and pacing

Use simpler planning and longer routine decision intervals for minor factions, while keeping active movement, combat, capture, and income rules correct. Dormant planners wake on relevant threat/resource/settlement events. The simulation must not change based on whether the player can see the tribe on screen.

Measure how many tribes develop in one-hour matches, how quickly, and how many units/producers/traders they add. Do not assume 40 tribes can each become a 200-squad nation without a new population qualification. A configurable development/population policy is possible, but any cap must be transparent and deterministic rather than a hidden CPU-triggered denial of progression.

Stage transitions interact with faction IDs, setup, palette/list capacity, AI fairness, and late-game memory. Reuse the same indexes and snapshot conventions. No unbounded per-tribe full-world searches or histories.

## Diplomacy and victory

Current diplomacy disallows tribes and current allied-win logic treats remaining tribes specially. Those assumptions must be reviewed together with development. Define when a settled tribe can negotiate and whether a developed originating tribe qualifies for allied victory under the eventual agreed victory rules.

A UI label changing to Nation must not alone alter victory eligibility. Conversely, a developed ally must not remain an unattackable but mandatory elimination target because one victory branch still tests its origin label. Keep conquest and eligibility consistent through development, elimination, and treaty expiry.

Resolve conquest-based graduation before evaluating victory with the updated capability state in that terminal tick. This must not grant a new alliance or a shared win automatically, change unrelated end-of-match rules, or restart a completed match.

## Acceptance

Test a tribe reaching each stage through legal actions, one failing due to resource access, one losing its settlement, and one already under attack during transition. Confirm stable identity, preserved counts/resources, no free unlocks, no duplicate army membership, no culture change, correct diplomacy/victory eligibility, and continued ability to use retained older troops.

Also test credited defeat of a human and AI nation, non-terminal camp capture, minor-tribe defeat, an already developed originating tribe as victim, multiple attackers, simultaneous eliminations, duplicate/ordered event delivery, and several wins in one tick. Nation behaviour must begin without respawning the faction, free age advancement, double land inheritance, or duplicate force-index contributions.

Milestone loss and whether stages can regress remain design decisions. Recommend preserving earned research and identity; do not automatically delete progress or armies when a settlement is lost. Operational recovery and eligibility consequences need an explicit rule before implementation.
