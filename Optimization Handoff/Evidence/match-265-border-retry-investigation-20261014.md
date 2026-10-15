# Match-265 border retry investigation

Investigated the active Oracle match on deployed revision `a0d27b15eb36d2dc6f5848c0e71caa39a8ea0735`. No game-code changes, orders, restart, frequency changes or deployment were made. The user approved a lossless checkpoint export; temporary container-local inspector was closed after export and again after a bounded CPU sample. The match remained healthy/running with container restart count zero.

## Finding

**There is confirmed repeated work and a navigation permission mismatch.** Local repair/smoothing can generate a path through a faction's forbidden territory, while actual movement correctly refuses entry. The existing stuck recovery then tries to repair the same move again. This explains some border units that hold a Move order but cannot make progress. It is not evidence that every stationary squad is broken or that fixing those eleven conspicuous units alone will recover the whole tick budget.

The earlier constructed qualification did not reproduce this mature territorial, trade and diplomatic workload. Entity totals alone were insufficient qualification.

## Live workload and pace

Normal production diagnostics before capture:

- 578–583 squads, 45–49 ships, 752–778 buildings, 649–669 traders.
- Two successive active-time intervals ran **0.540x and 0.547x**, below the user's approximately 0.75x observation. These ratios come from deltas of accumulated active simulation/wall time; UI smoothing, observation time and subsequent state differ.
- Latest tick window mean **83.25 ms**, movement **37.87 ms**, routing **16.71 ms**, combat **12.75 ms**, AI **7.60 ms**. Planner pending 104, oldest job 197 ticks.
- Over 1,304 ticks, trade planner graph-work delta was **3,653,062**, versus squad admission **1,229,887**, navigation 16,611 and army 16,706. Trade is approximately 74% of those recorded graph-work units. Those units are not milliseconds or requested routes.

Checkpoint at tick **22,434**: map 1,000 × 500; 588 squads, 94 ships, 812 buildings, 693 traders, 16 regular factions and 30 tribes. Orders: 307 move, 62 attack, 204 hold, 15 replenish. There were 33 fighting squads, 73 formation transitions and eight recorded war pairs. It starts in Stone Age and has progressed naturally; this is not the Napoleonic-only constructed Migration fixture.

Later normal intervals after export, before CPU sampling, ran **0.409x and 0.447x**. Corresponding mean tick windows were 118.12 and 106.68 ms; movement 47.14/45.09 ms and routing 31.29/21.86 ms. Population, war, transport and trade activity were evolving, so these are not paired causal measurements of the export. Diagnostic export/sampling windows are excluded from normal timing conclusions.

## Exact offline continuation

Restore the captured map/checkpoint and continue 300 ticks without future human commands. Baseline local Ryzen 7 3700X mean **74.99 ms**, p95 97.83 ms, p99 125.84 ms. Timed trace and CPU-sampled runs are slower due to instrumentation. Baseline, timed trace, attribution trace and a diagnostic preflight experiment all produced final checkpoint hash:

`2707db4275d0ab2b580878bdd77ee654a744d73ae0bbc9f608dbdb7bc1a60f0e`

Unit observations over that continuation:

- 40 squads recorded restricted passage at least once; 11 were restricted for more than half the window.
- 19 initially moving squads travelled less than one tile in 300 ticks. A Move order/status is not proof of net progress; some blocked units also briefly move or change orders.
- Example squad 403, faction 7: zero displacement; restricted for 208 ticks; 5,824 restriction-callback reads and ten recovery attempts.
- Example squad 400, faction 20: zero displacement; restricted for 247 ticks; 2,470 callback reads and twelve recovery attempts.
- Those eleven most visibly restricted units contributed 37,759 callback reads, approximately 3.4% of the total **1,108,560**. Repeated work also affects other movers, turns, temporary obstacles and legal paths; don't attribute every read to those eleven units.

Movement recovery attempted **3,834 local detours**, accepted **3,087**, and **2,238 accepted detours contained a point forbidden by the current entry predicate**. That broad figure includes units already outside permitted territory, so a stricter separate 120-tick audit required a permitted starting root. It found **896 accepted detours from permitted starts into forbidden land**, out of 1,243 accepted detours. Examples:

| Squad | Faction | Starting tile / owner | Forbidden detour tile / owner |
| --- | --- | --- | --- |
| 97 | 23 | 117949 / 23 | 117951 / 43 |
| 131 | 30 | 112289 / 30 | 113289 / 36 |
| 198 | 43 | 79910 / 43 | 79909 / 20 |

This is direct evidence of a policy mismatch, independent of the UI label.

## Source paths causing it

1. `Simulation.clearCorridor()` checks fortifications, terrain and held hostile roots, but does not check diplomatic entry along the segment. Navigation's look-ahead smoothing can therefore shortcut a legal route across forbidden land.
2. `Simulation.recoverNavigation()` treats insufficient positional progress as generic route failure and schedules `repair` roughly every twenty ticks. It has a yielding exception but no durable diplomatic-blocked state tied to the failed crossing/order/permission generation.
3. `Simulation.repairNavigation()` calls `LocalDetours.find()`. That local lattice checks terrain and settled squad root separation; it has no diplomatic entry predicate. Its accepted detour is installed without a diplomatic certificate. The fallback synchronous `findExact` blocker also tests held units, not the same fortification/territorial predicate as normal route admission.
4. `LocalAvoidance` then tries preferred motion, reciprocal correction and rotated/half-speed alternatives. The actual restriction callback correctly enforces territory after transport/formation/fortification checks. This retains Move and produces Passage restricted rather than completing the requested crossing.

The exact planner's normal routes already have entry blockers; the mismatch is specifically in short-path repair/smoothing and movement recovery. A repair need not request a new global route to waste work.

## Route queue pressure

Over 300 ticks the exact planner received:

| Caller | Attempts | Accepted |
| --- | ---: | ---: |
| Squad admission | 18,445 | 238 |
| Trade | 2,139 | 243 |
| Ship admission | 1,724 | 39 |
| Navigation | 471 | 4 |
| Army | 23 | 3 |

Almost all attempts were new keys rather than replacements of a pending job. Most false returns are bounded planner admission/backpressure, **not failed path searches**. In the normal live interval, squad admission nevertheless recorded 806 completions and 621 supersessions. Both queue retry/polling and actual search churn need attention. Enlarging the queue or raising graph-work budgets would not repair the movement-policy mismatch.

## CPU evidence

The 300-tick local timed trace recorded approximately **1,846 transport-step checks and 5,548 movement-envelope reads per tick**. Avoidance inclusive time was 24.67 ms and transport-step clearance 12.39 ms; these overlap and include tracing overhead, so they cannot be added together or called exact saved CPU.

A twenty-second live CPU sample confirms the simulation worker is the busy JavaScript thread. Avoidance accounts for approximately **26%** of sampled elapsed time inclusive, route draining **19%**, and transport-step clearance **15%**. Geometry key functions account for approximately **7.8% self time** combined. These are nested sampled stacks, not independent costs. Coordinator JavaScript is approximately 99% idle. Encoder JavaScript is mostly idle; native compression/libuv CPU is not fully attributed by this profiler, so idle JavaScript does not prove encoding has zero cost. The evidence supports simulation/navigation as the dominant current bottleneck.

An offline experiment moved the same endpoint policy rejection ahead of physical geometry work, preserving the existing escape condition. It retained the canonical hash but mean tick time was **74.18 ms versus baseline 74.99 ms** in a single unpaired trial. This is within ordinary run variability, not a demonstrated meaningful gain. Cheap early rejection alone is insufficient; the invalid intent and recovery cycle must be removed at its source. The experiment exists only in the ignored driver and was not added to product code.

## Recommended implementation contract

Use one authoritative movement-leg permission certificate in admission, corridor smoothing, local repair and actual commit, including permitted escape from newly forbidden territory and the existing human crossing/peace rules. Check the full crossed segment, not just its endpoint. Keep physical formation validation authoritative.

When no permitted continuation exists, retain the player's explicit order as a diplomatic wait or return a meaningful failure to the AI mission owner. Suspend repeated velocity exploration/repair for that known blocked crossing. Wake on a relevant order, owner/territory, treaty, peace-protection expiry or physical-corridor change; do not globally sleep moving units or wake every unit for unrelated world changes. AI should choose an actually reachable expansion destination or recover its mission, not declare an unwanted war to break the wait.

Separately make deferred caller retries respond to relevant planner capacity/progress rather than polling unsuccessful admission every tick, preserving fairness, player priority, cargo commitment and deterministic state/checkpoints. Audit trade route lifetimes and caller supersession against this capture. Trade remains most of graph work, so fixing border recovery alone is unlikely to achieve the entire 0.85x goal.

Validate with this exact replay and dynamic border/war/peace/alliance/escape tests, measure job and clearance reductions, compare canonical continuation where behavior is preserved, and then repeat actual multiplayer pace. Do not use 10 Hz as the first fix for these correctness loops.

Artifacts: ignored `out/border-live-a0d27b15/` contains capture, live logs, replay drivers, baseline/trace/attribution JSON, local CPU profile, live worker/coordinator/encoder CPU profiles and summaries. All production diagnostic attachment was closed; no active game was ended.
