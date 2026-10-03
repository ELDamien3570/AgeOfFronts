# AI handoff review and staged implementation

This historical foundation review predates the later implementation and releases.
See [`Optimization Handoff/handoff.md`](../../Optimization%20Handoff/handoff.md)
and its evidence files for subsequent completion and verification.

Reviewed 2 October 2026 against the current AgeOfFronts checkout. Source package:
`C:/Users/Damien/Downloads/Age-of-Fronts-complete-AI-implementation-handoff/Age-of-Fronts-complete-AI-implementation-handoff`.
All 72 files listed in its SHA256SUMS.txt verified successfully.

The user selected implementation of the full plan in stages. This document tracks
actual implemented work separately from the remaining design. The authoritative
design is the package's `02-current-plans/ai-walls-personality-tactics.md`;
the earlier investigation describes the two-fix prototype, not completed defense AI.

## Architecture review

Keep decision policies in domain modules. Expansion and Simulation coordinate
them through shared commands; Fortifications, Battle, Recruitment, Supply,
Pathfinding and researched Armies remain authorities for their existing rules.
No presentation-side AI or alternate combat/movement engine is justified.

The dependency order is sound: fix legal contact and economics, introduce bounded
planning and spending ownership, then execute defenses and persistent operations.
Adding building quotas to the generic construction loop would produce empty
defenses and would not satisfy the plan.

Current-source corrections to the handoff:

- `buildingCost(type, age, existingCount)` scales both gold and items. A Modern
  two-trench/one-nest phase starting from zero costs 49,980 gold and 40 steel,
  rather than the plan's 46,200 gold. Six trenches and three nests starting from
  zero cost 214,200 gold and 156 steel. Existing buildings increase these quotes.
  Each future quote must simulate the full ordered build sequence and wall costs.
- Concurrent construction-duration work now scales timers with building count.
  The plan's eight/ten-second durations are only the first copies' base durations.
- RouteWork currently charges effort after a synchronous job. Its limit is not a
  hard preemption budget. Finite TilePaths searches now bypass the unbounded
  hierarchy; future planner jobs still need incremental search and explicit
  pending/unknown results rather than interpreting an exhausted budget as no path.
- Towers currently lack autonomous fire. This plan does not add it; implementing
  previously discussed tower weapons requires a separate shared combat change.
- Trenches remain owner-only, non-stacking cover pockets, with six eligible
  squads within one tile. Nests acquire land squads. No gates, continuous trench
  barriers, high-ground bonuses, aircraft/nest acquisition or resource gifts are
  introduced by this work.

## Implemented foundation slice

- Retained the two-fix patch and its eight regression tests: ranged approach
  enters exact range despite integer rounding; unchanged live hostile siege
  targets preserve routes and deployed firing.
- Added AiForceInventory, a per-pass derived index of living squads and paid
  recruitment. Core composition uses tactical roles. Specialist quotas include
  live and queued copies across tiers, preventing obsolete quota fall-through.
  Resource/producer constraints can still select an older available tier.
  Ship and aircraft demand includes paid queues; multiple airstrips share quota.
- Pruned unaffordable building types before location enumeration, using current
  shared count-scaled costs. Final commands still validate and pay normally.
- Excluded allied frontier pockets from home consolidation and expansion goals
  at decision time, so treaty changes do not depend on cached frontier warmth.
- Filtered attack choices by the shared weapon target tags. Retained unbiased
  nearest hostile threat distance for replenishment safety, including enemies an
  anti-air unit cannot shoot.
- Direct pursuit checks hostile LOS even inside range. Ranged firing-cell
  selection checks terrain standability, blocked cells and actual fortification
  LOS. Regression fixtures verify infantry and archers detour around a hostile
  tower and resume attacks.
- Shared StructureTargeting between structure-order planning and Battle. Both
  use actual fixed-point range and exposed cells across a barrier's full span.
  Per-squad approach searches consider at most 32 route finalists and spend at
  most 4,096 exact node expansions. Failure reports a planning-budget limit,
  not a proof of physical unreachability.
- Reused cached terrain corridors with fresh owner-relative wall validation,
  including diagonal side cells. Dynamic obstacle detours remain uncached.
- Added observational path/combat counters for searches, cache hits, obstacle
  checks, expansions, combat rebuilds, trench candidates and idle nest searches.
  These counters are excluded from checkpoints and never select behavior.

## Validation

- Retained prototype plus siege/modernization/personality/wall/world tests:
  48 passed before the additional foundation fixtures.
- Full skirmish suite: 808 tests in 116 files passed with `--maxWorkers=2`.
  The first heavily parallel run hit eleven default five-second timeouts;
  reducing worker contention resolved them without changing timeouts or tests.
- TypeScript `--noEmit` and skirmish production build passed. Build retains the
  large-bundle warning. Changed-file ESLint passed.
- Additional foundation fixtures cover bankrupt build work, paid role demand,
  obsolete recruitment, treaty eligibility, anti-air threat safety, dynamic
  corridor masks, finite hierarchy budgets, legal firing cells, actual tower
  detours and continuation with different route-cache warmth.
- No browser review, saturated Modern outcome tournament or two-core ARM
  benchmark is claimed. These results establish functional regressions, not
  stronger AI, unchanged performance tails or production readiness.

## Remaining stages and gates

1. Finish the foundations: incremental route jobs and queue-age telemetry,
   globally charged siege/shore planning, radius-aware fortification clearance,
   reachable alternative firing positions, and measured combat-index/nest cost.
   Do not multiply defenses before the geometry and tail-latency gates pass.
2. Add deterministic city/front records, local invalidation, exact ordered quotes,
   candidate jobs and rejection cooldowns. Run wall/trench plans without spending.
   Validate real X-then-Y automatic links, both neighbors and closure sequencing.
3. Add shared spending reservations and staged funded construction, staffing,
   selective repair and abandonment. One active project per faction initially;
   preserve economy/military floors and release only unspent reservations.
4. Add persistent operation state and single-controller leases. Integrate existing
   Armies only after research; preserve modernization, boarding, recovery and
   manual interrupts. Test save/restore and stale-job cancellation explicitly.
5. Connect the eleven existing personalities to objectives, spending, reserves,
   supported pushes, one useful flank, siege escorts, breaches and withdrawal.
   Keep eligible in-range shots and dense-melee damage/contact as regression gates.
6. Measure each independently switchable configuration on seeded scenarios and
   the actual ARM host. Leave new planners off until their acceptance gates pass.
   Physical gates and other gameplay-rule changes remain separate decisions.

## Shared-checkout coordination

Another process created commit `1b8c6e0` during this implementation, titled
"Scale building construction duration with building count, matching cost
multiplier". It included both that process's construction work and this chat's
foundation edits. This chat did not create that commit or publish anything.
Further stages are awaiting the user's choice of isolated worktree or exclusive
use of this checkout; do not reset or rewrite the mixed commit.
