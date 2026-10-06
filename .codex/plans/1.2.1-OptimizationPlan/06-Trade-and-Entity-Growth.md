# 06 — Indexed trade and controlled entity-growth costs

## Status and scope

Planning only, written 2026-10-04 against remote branch `1.2` at `a62b35b8faf69fab97f28ee941910a0830db9f00`. No implementation or performance certification is claimed. The earlier review used `60803c8`; the two intervening commits are HUD changes. Recheck the implementation head before changing code. These plans improve the existing TypeScript/browser/server project; no engine migration is proposed.

The target is one match on the existing Oracle two-ARM-core, approximately 20 GB host: largest supported map, 14 AI nations, 30 tribes and at least 10 actively participating humans. Ten humans means 54 initial factions. Every additionally advertised seat count, map size and speed requires its own qualification. RAM capacity is not a CPU budget or a worker-heap limit. Retain the existing one-match hosting policy until measurements support a change.

Work incrementally. Every phase must pass its focused correctness tests before the next phase; final integration must pass the complete skirmish suite, TypeScript and production build on the exact release candidate. Do not lower assertions, disable AI features, reduce populations, relax collision rules or silently slow the simulation to obtain a pass. Any intended rule change needs a separate design decision.

## Current evidence

`domain/Trade.ts:766` filters all actors separately for each eligible faction during spawning, then filters owner actors again for land/sea counts. `Trade.ts:934` linearly finds each actor's player during its per-tick step and rebuilds interception indexes. There are already route-planning and fleet controls; preserve them. `TradeFleet.test.ts`, `TradeUnlocks.test.ts` and `WaterTradeDistance.test.ts` capture existing rules.

At ten humans + fourteen AIs + thirty tribes, 54 factions x the current shared 48-actor cap is a nominal 2,592 traders. Eligibility, sites, research and quotas may produce fewer. The previous long soak ended with 236 traders and predates tribe merchant participation, so it is not a ceiling test. Do not silently lower trade caps or income to achieve performance.

## End-state architecture

A single authoritative trade actor store owns identity, membership and mutation. Derived indexes provide O(1) player lookup and owner/mode/state counts. Eligible sites and destinations are revisioned facts, not re-filtered world arrays on every decision. Idle/waiting actors use bounded due-work scheduling; moving/interacting actors still obey exact tick semantics. Route planning shares the existing fair scheduler. Replication uses plan-05 deltas.

## Implementation phases

1. **Specify the lifecycle.** Inventory spawn, move, wait, load/unload, deliver, capture/prize, ownership transfer, sink/destroy, source removal, player elimination, pause controls and restore. Define separate counts for owned actors, quota-eligible land/sea actors and global actors. Preserve the existing prize exception: exclude prizes only from the categories current rules exclude, never from global retention accounting.
2. **Introduce checked indexes.** Maintain owner -> actor IDs, owner/mode/non-prize counts, player ID -> player and stable site IDs. Route every lifecycle mutation through plan-07 APIs. Debug tests recompute all counts from canonical actors after each event. Restore rebuilds indexes from canonical state before consumers resume. Promotion of tribes must preserve identity and recompute eligibility without duplicate fleets.
3. **Bound spawning and eligibility.** Reuse owner counts instead of O(factions x actors) filters. Maintain site cooldowns and eligibility revisions for buildings, research, ownership, diplomacy, coastal connectivity and trade controls. If many sites become eligible at once, process a deterministic rotating cursor with a documented maximum wait, rather than always favoring lowest IDs. Do not change spawn rates silently: carry due work forward and verify resulting tick timing against intended rules.
4. **Optimize actor stepping.** Replace linear player lookup. Share the correct phase land/naval interception indexes from plan 04. For waiting actors, prototype a simulation-tick due queue or timing wheel with cancellation generations and stable ordering. Use lazy stale-entry rejection only with a bounded compaction policy; otherwise the heap can grow forever. Derived remaining wait time must still render and restore correctly.
5. **Reuse destination and route facts.** Keep economic choice per actor where cargo, risk or destination differs; share topology/connectivity and static legal-site facts. Re-evaluate when a destination disappears or diplomacy changes. Bound unreachable retry/backoff and clear it when the cause changes. Never let repeated trade routing starve human armies or transport.
6. **Integrate growth diagnostics.** Report live actors by owner/mode/state, productive deliveries, idle/unreachable time, path work, spawn eligibility and actor churn. Test economy progression with all intended policies. More research and improved economy can create much more workload even without a higher hard cap.

## Correctness and safety contracts

Gold/cargo settlement and captured value are exactly-once authoritative events. Optimization must not duplicate delivery after restore, prize capture or rerouting. Owner transfer changes all relevant indexes and journals atomically. The owner's total cap and global cap remain authoritative; temporary prize behavior must match current rules and never become a permanent cap escape. Repeated rejected spawn attempts consume bounded work and do not consume resources.

Changes to prices, quotas, fleet size, spawn cadence or AI risk preferences are balance changes, not free performance fixes. Keep them out of this work unless separately approved. If an indexed/due-work implementation changes observable ordering, document and test the intended compatibility rather than assuming equivalent totals are enough.

## Tests and acceptance

Extend trade fleet/unlock/control/distance tests plus checkpoint, journal and faction identity tests. Use a slow recount/reference implementation independent of indexes. Exercise every lifecycle transition, same-tick delivery/destruction, simultaneous prizes, paused land versus sea trade, captured factory/port, eliminated faction and promoted tribe. Assert counts and financial totals after every step and restore.

Benchmark zero traders, observed ~236, intermediate fleets and a legal near-cap fixture approaching 2,592. Include many eligible but disconnected destinations and active naval interception. Near-cap fixtures are isolated deterministic tests, not traffic against the public server. Record site counts and research eligibility so an empty fleet cannot accidentally pass a maximum-work scenario.

Done when spawning no longer filters all actors per faction, per-actor player lookup is indexed, index memory is bounded, lifecycle/settlement reference tests pass, and the integrated target-count tick/publication gates pass. Measure total work including maintaining indexes and journals. Quantify expected O(actors + due sites + exact interactions), acknowledging dense interception can still dominate.

## Alternatives and final design review

A single-pass temporary counts map may be a simpler first win than a permanent owner index; keep it if it meets measured budgets and avoids lifecycle complexity. A timing wheel is optional: if wait scans are insignificant, retain the straightforward scan. Do not replace exact hostile interception with sampled neighbors merely because sampling is cheaper. Off-thread trade simulation would create expensive coordination with capture and resources; retain authoritative ownership.

Reviewed loose ends: prize accounting, tribe promotion, due-queue tombstones, source/destination destruction, late research unlocks, idle fleets hiding capacity and double settlement after restore. Dependencies are plan 07 lifecycle contracts, plan 04 spatial views, plan 03 fair route service and plan 05 trader journals. Roll back an index implementation by rebuilding derived state at a match boundary; preserve canonical actors and money.

## Second-pass review amendments

- **Counter invariants:** owned counts, quota counts and global counts are different. A prize may be excluded from one quota while still occupying ownership/global memory; encode each predicate explicitly and verify against a full recount.
- **Mature-world coverage:** tribe merchants may unlock later than the old soak. Build a valid researched late-game fixture in addition to organic progression, ensuring both land and sea traders actually deliver and interact.
- **Scheduling equivalence:** a due queue must account for pause controls, tick-based wait decrements and checkpoint restoration without skipping a delivery tick. Do not turn every waiting actor into an independent real-time timer.
- **Stale-entry bounds:** generation-based heap cancellation needs a size/age trigger for deterministic compaction, with charged cleanup. Otherwise a supposedly efficient queue leaks work after repeated route/site changes.
- **Simplest acceptable implementation:** begin with direct player lookup and a once-per-spawn-pass owner tally if that removes the measured cost. Promote to fully persistent indexes only where their saved scans exceed lifecycle-maintenance complexity.

## Completion evidence and handoff

Record implemented commit, runtime/build identifier, changed files, exact test commands and results, fixture/seed/options, hardware and limits, raw artifact locations, before/after distributions and remaining limitations. Label evidence as source inspection, deterministic test, synthetic benchmark, hosted headless or rendered-client acceptance. Do not substitute one class for another. An incomplete or failed gate stays open. See plan 01 for the common release qualification and the dependency order. This document is a plan, not evidence that its checkboxes are complete.
