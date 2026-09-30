# Optimization and AI improvement

Status: implementation planning only. Updated September 30, 2026.

This folder records the investigation and proposed work for more AI factions, more and larger tribes, stronger economic and military planning, configurable personalities, and queryable faction forces. Creating these plans does not change simulation or UI code. Source observations describe the working tree inspected on September 30; it is under active development and must be rechecked before implementation.

## Confirmed scope

- Scale priorities are more AI factions, more tribes, and larger tribal armies.
- Improve AI recruitment, army construction, and conquest.
- Smart defensive construction is required in this same push: connected tower/wall layouts around important assets, preserved gates/trade/reinforcement access, and appropriate Modern trenches, gun nests, anti-air and missile defence where legally unlocked.
- Allow profiles that favour warfare, economic growth, betrayal, or defending allies.
- The user is open to tribes developing if the result is feasible and interesting. The stages and thresholds below are proposals, not approved numerical rules.
- A tribe that defeats a human player or nation can graduate to a full AI nation. Terminal conquest credit, not camp capture alone, is the proposed integration boundary; ordinary settlement development remains an additional proposed path.
- Track every faction's live unit composition in a form AI can query efficiently.
- Include unit counts by type in diplomacy inspection: exact own/allied counts and enemy estimates, as confirmed by the user.
- Slow early troop-reserve growth; researched city upgrades require individual paid upgrades, with Classical as the first substantial growth breakpoint. Medieval plagues are under consideration, not an agreed casualty system.
- A faction with usable owned territory from which it can rebuild survives losing its army, even without buildings. Exact terminal defeat and annexation conditions remain open.
- Bronze Armies is an additional fifth Warfare technology. It enables persistent selectable armies, marching columns around 10% faster than their slowest member, role-based deployment, and manual tactics plus an automatic-tactics toggle. Army and squad capacities increase through later ages; squad capacity follows its unit tier, so older units stay smaller until refitted.
- Preserve MVVM and Domain-Driven Design. Human and AI actions use the same domain rules and command validation.
- At this stage, write documentation only; do not implement these systems.

## Documents

| Document | Purpose |
| --- | --- |
| [Investigation and baseline](investigation-and-baseline.md) | Verified source findings, diagnostic conditions, performance evidence, and uncertainty. |
| [Defeat and territory inheritance](defeat-and-territory-inheritance.md) | Reproduced whole-nation transfer after a building-free army wipe; sovereignty/recovery correction and tribe-graduation dependency. |
| [Simulation scaling](simulation-scaling.md) | Capture, faction indexes, scheduling, movement, snapshots, and faction ID expansion. |
| [Faction force read model](faction-force-read-model.md) | Live counts by unit definition, troop strength, lifecycle updates, queries, history, and consistency. |
| [AI strategy and armies](ai-strategy-and-armies.md) | Economic dependencies, budgets, persistent armies, composition, and conquest. |
| [AI defensive construction](ai-defensive-construction.md) | Threat-aware protected sites, staged tower/wall layouts, access/gates, defence budgets, supporting armies and Modern counters; required in this push. |
| [Armies, formations, and squad sizes](armies-formations-and-squad-sizes.md) | Bronze Armies research, 20-squad selection, cohesive columns, role deployment, manual/automatic tactics, tier capacities and HP/accuracy/reload integration. |
| [Profiles and diplomatic behaviour](profiles-and-diplomacy.md) | Configurable motivations, relationship memory, betrayal, renewal, and ally defence. |
| [Tribe development](tribe-development.md) | Gradual development using shared systems, stable identities, and explicit capability policy. |
| [Manpower and city upgrades](manpower-and-city-upgrades.md) | Slow opening growth, Classical acceleration through paid city upgrades, starting-bank review, and optional Medieval plague design. |
| [Diplomacy force inspection](diplomacy-force-inspection.md) | Faction-click UI, unit counts, visibility, freshness, and MVVM integration. |
| [Delivery and validation](delivery-and-validation.md) | Implementation order, correctness scenarios, scale matrix, and acceptance evidence. |

## Architecture direction

The simulation's entities and domain rules remain authoritative. Match-owned projections maintain faction and regional facts. AI planning reads those facts, chooses goals, maintains army operations, and submits ordinary commands. Presentation receives purpose-specific immutable projections through the worker boundary and formats them in ViewModels.

The force index is a rebuildable read model, not a second army authority. An append-only log is not the live query mechanism. No database, runtime language model, distributed service, or full conversion to event sourcing is required by this plan.

Keep culture, personality, difficulty, and development stage separate. Culture defines content; personality defines preferences; difficulty defines decision quality and reaction limits; development policy determines which actions are available. None gives permission to bypass resources, alliances, paths, or combat rules.

## Proposed delivery order

1. Record reproducible integrated baselines and establish explicit mutation/lifecycle boundaries.
   Resolve the reproduced defeat/territory-inheritance conflict with the building-free opening before enabling conquest-based tribe graduation; see the dedicated investigation.
2. Implement the faction force read model and supporting faction indexes, with consistency checks.
3. Use those summaries for diplomacy inspection with exact own/allied counts and enemy estimates; establish the observation contract before exposing enemy estimates.
4. Remove the measured capture and snapshot bottlenecks; replace fixed-faction scheduling assumptions and widen faction representation before approaching its limit.
5. Implement reliable opening budgets and bounded production/research dependency planning.
6. Implement smart defensive layouts alongside persistent armies and conquest operations, then personality weights and ally defence. Defensive placement, gates/access, garrisons and Modern counter selection are required acceptance for this push.
7. Add staged tribe development using the same planner and capability rules.
8. Qualify larger populations through integrated matches before increasing supported setup limits.

Correctness and observability come before increasing caps. Independent work can overlap where its contracts are settled; each stage must preserve the earlier gameplay rules.

## Decisions still open

| Decision | Proposed handling until settled |
| --- | --- |
| Enemy observation and battlefield visibility | Exact own/allied counts and enemy estimates are confirmed. Sighting ranges, estimate rules, and enemy map visibility are not. Current snapshots expose all units; meaningful hidden intelligence requires an observation contract and appropriate filtering, not cosmetic noise. |
| Defeat and remaining territory | Recovery on usable owned territory is accepted. Define the exact recovery predicate, terminal sovereignty/control loss and remaining-land disposition before correcting source or enabling tribe graduation. |
| Army and squad balance | Bronze Armies, columns, role formations, manual/automatic tactics and tier-based squad capacity are confirmed. Later caps, squad sizes, tactical timings and research tuning need measurement; see the dedicated army plan. |
| Defensive construction | Connected layouts and appropriate counter selection are confirmed for this push. Gate/link/access policy, material/maintenance budgets, trench/weapon rules and final missile-defence placement still follow their owning design decisions. |
| Required hardware and population | Measure staged targets; no new maximum faction or troop count has been certified. |
| Profile visibility and selection | Author editable presets; whether players see another faction's preset or can customize every trait is a UI/game rule decision. |
| Tribe progression | Conquest of a human player/nation qualifies for full-nation development. The gradual camp/settlement path, attribution tuning, activation details, stage caps, and numerical gates need explicit policy/playtesting. |
| City/manpower balance | Classical acceleration and individual paid upgrades are confirmed; rates, initial reserves/storage, upgrade timing/costs, and plague adoption/effects remain open. |
| Conflict between allied obligations | A guardian cannot attack another active ally without a legal treaty change. Author a priority/mediation policy before enabling that case. |
| History persistence | Keep live summaries and inexpensive cumulative counters in the first scope. Saving full match event history or cross-match analytics needs explicit retention and storage requirements. |

## Related game plans

Use the [main decision register](../README.md), [opening and pacing](../pacing-and-opening.md), [resources and weapons](../strategic-resources.md), [trade](../trade-and-economy.md), [combat](../combat-and-promotions.md), [diplomacy](../diplomacy-and-alliances.md), and [UI integration](../ui-materials-and-technology.md). Their confirmed rules still apply. These documents do not change two-tree advancement, independent allied ownership, retained older equipment requirements, or Modern target categories.
