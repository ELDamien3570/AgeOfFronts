# V1 integrated implementation and qualification

Updated 2 October 2026. Base: `bca41f59a8b2b3d23dbe391d964fc2bffd3d6708`
(`V1`, More Naval work). Work branch: `v1-phased-ai-optimization`.

## Scope and evidence rules

Combine the existing optimization/AI plans, `OptimizationFixPlan.md`,
`AgeProgressionImplementation.md`, and all three supplied documents:
`combined-implementation-progress.md`, the V1 architecture review, and
`tuneups.md`. The combined progress document arrived after phase 2 and was read
in full before further implementation. It describes the 936-test baseline now
verified here. This document is the integrated current record; older timings
and design proposals retain their historical meaning. The attachment's older
Oracle deployment instruction is superseded by the latest no-Oracle scope.

Target: largest supported map, 14 AI nations, 30 tribes, and at least 10 human
players. This is a qualification target, not a certified capacity claim. Local
correctness checks do not prove Oracle ARM performance. Nothing here authorizes
Oracle access, deployment, merging into V1, or live overload tests.

Keep one authoritative simulation owner. Use deterministic work budgets for
planning; wall-clock metrics must never choose simulation outcomes. Keep human
combat/capture mechanics unchanged by optional AI operations policy. Existing
experimental economy/defence/naval/planning switches stay gated until their
specific acceptance evidence exists.

## Latest-source reconciliation

- V1 now includes `AiNavalPlanner`, shared naval facts and ship movement
  admission, added after the architecture review's `1f8df2d` base
- Land, naval, economy, defence, armies, force inventory, rejoin flow control,
  and bounded planner foundations exist. Their presence is not proof that every
  requested behavior or every synchronous fallback is complete
- Recruitment cancellation, explicit paid building upgrades, age-correct
  placement visibility, advanced opening budgets and expanded age-locked tribes
  were missing at the new base
- Free military-building modernization remained active at the base
- Production worker snapshot compression still shares the serialized advance
  lifecycle; target hardware qualification and deployment are outstanding

## Sequential gates

Every implementation phase requires focused regression tests, the complete
skirmish suite, TypeScript checking and a skirmish production build before the
next dependent phase starts. Tests may legitimately update old expectations
only for explicitly requested gameplay changes. Record failures, missing assets,
and never-run checks rather than calling a partial run a pass.

| Phase | Deliverable | Status / acceptance |
|---|---|---|
| 0 | Reconcile latest V1, inputs, isolated branch, reproducible baseline | Passed; 936/936 tests, TypeScript and production build after resolving LFS assets |
| 1 | Recruitment one-at-a-time cancellation; age-correct deposit placement | Passed; 945 tests, TypeScript, build; exact one-item refunds, producer-head preservation and age invalidation |
| 2 | Paid one-tier building upgrades; no free auto-modernization | Passed; 951 tests, TypeScript, build; shared atomic quote, timed production pause, paid AI and U shortcut |
| 3a | Advanced opening budgets and age-locked tribe progression | Passed functional gate: 967 tests, TypeScript, build; initial research-grant choice remains separate |
| 3b | Regular-player immediate starting-package technology grants | Passed; 986 tests; all prior-age research plus first node of each starting-age branch, remaining nodes require research |
| 4a | Production-path bounded runtime diagnostics | Passed; 970 tests, typecheck/build, active worker and liveness/progress separation |
| 4b | Remaining blocking planning paths and retention | Passed narrow slice: 973 tests; land queued-leg/patrol integration and limited-input outcomes; army/trade/shore admission still open |
| 5 | Shared facts and less repeated work | Passed narrow slice: 977 tests; sparse capture pressure and one cargo grouping per movement stage; wider lifecycle/journal work remains |
| 6a | Demand-driven browser presentation copies | Passed; 979 tests; canonical apply continues without throwaway clones while rendering is busy |
| 6b | Server replication pipeline and dirty publication journal | Pending; separate coherent bounded encoding pipeline, recovery baselines and lifecycle revisions |
| 7 | AI operations, geography and diplomacy | Pending; optional policy, local defensive wake, recipient cooldowns, no human mechanic change |
| 8a | Stable terrain-aware defence fronts and staffed Modern sections | Pending; terrain outlines, access/gates, reserves, withdrawal/reuse and funded bounded work |
| 8b | Coordinated land Armies and eleven doctrines | Pending; researched Armies, supported pushes, flank/breach/escort and recovery |
| 8c | Economic dependency and utility decisions | Pending; bottlenecks, research/age utility, remote coast, shared cycle/risk and intended-sea quotes |
| 8d | Complete strategic naval missions | Pending; theater ranking, combat evidence, bombardment, cargo/escort/capacity/boarding/landing and handoff |
| 8e | Final integration, browser and release qualification | Pending; all preceding gates, exact SHA/archive, flag acceptance and external ARM handoff |

## Required coverage within the later phases

Planning must cover ordinary and queued squad orders, army routes/formations,
ship continuation, shore embark/landing, trade, structure approaches, limited
search progress and fair command cohorts. Do not describe a flag flip or a
queue around synchronous work as complete bounded planning.

Defence acceptance includes stable terrain-aware fronts, access/gates,
garrisons/support/reserves, withdrawal and reuse. Land acceptance includes
coordinated armies, flank/breach/escort, recovery and personalities. Economy
acceptance includes dependency bottlenecks, research, industry and trade. Navy
acceptance includes bombardment, escort, transport, boarding, landing and land
handoff. Existing implementations must be audited and tested against these
criteria, with incomplete slices kept explicit.

Replication work must preserve coherent base/sequence/removals, avoid dropped
reverted changes, retain join barriers, cap queued publications, cache safe
baselines, and allow latest-view rendering without skipping canonical changes.

Memory validation includes bounded caches, pending IDs, planner state and
cleanup after death/cancel/restore. Capacity evidence must state map, seed, age,
entity counts, feature switches, clients and machine, plus latency/queue-age and
memory outcomes. Real ARM ordinary-play qualification remains a deployment
handoff, not something an x64 cloud test can establish.

## Validation ledger

- Environment: Linux x64 cloud workspace; Node 24.19.0; dependency installation
  uses npm 12.1.0 with the lockfile and `--ignore-scripts`
- Baseline attempt: 140 files / 936 tests; 895 passed, 41 failed. Most failures
  are tracked map/art Git LFS pointers, plus dependent online transport failure
- Clean baseline: all 936 tests / 140 files passed; TypeScript and skirmish production build passed. Initial LFS-related failures were environmental and resolved, without test changes


### Phase 1 evidence

Nine new tests cover land/ship/air refunds, newest inactive versus active head,
producer/owner filters, restore, right-click behavior, hidden mineral rejection
and age-change preview invalidation. Focused checks: 15/15. Full gate: 945/945
(143 files), TypeScript and build passed. One initial highly parallel map test
exceeded its existing timeout; rerun with two workers passed without changing
assertions/timeouts. Targeted Oxlint passed.

### Phase 2 evidence

Six new tests cover half-price rounding, no multi-tier jump, atomic aggregate
affordability and owner checks, duplicates, damage/research rejection, paused
training/supply, restore and building-card/U actions. Current research no longer
upgrades infrastructure for free; the old integration assertion was updated to
the requested policy. Existing wall links retain their independently paid tier.
Default and experimental economic AI now issue normal paid upgrade commands.
Full gate: 951/951 tests (145 files), TypeScript, build and targeted Oxlint passed.

## Combined-progress acceptance reconciliation

The supplied progress record explicitly distinguishes implemented foundations
from final acceptance. Preserve its MapSymbols, trader presentation and renderer
work from V1. In addition to the criteria above, the following remain required:

- Reliability: actual consumer limits and total transient heap; immutable versus
  dynamic revisions; phase diagnostics; browser and external profiling acceptance
- Planning: resume formation setup, clearance, shoreline selection and path
  copying; shared crossing rankings; army, trade, boarding and landing admission
- Original AI: maintained front records, funded/staffed Modern sections,
  terrain-aware city outlines, bounded child work, researched Armies, supported
  pushes/flanks, escort/breach/recovery, all eleven personality doctrines
- Economy: richer dependency/utility branches and viability reason codes,
  bottleneck and research/age utility, reachable remote-coast acquisition,
  shared trade cycle/risk quotes and intended-sea vessel purchases
- Navy: strategic threatened-sea rankings, casualty/value evidence, persistent
  recovery/complete states, coastal attacks, safe cargo/escorts, actual transport
  capacity, boarding, landing and beachhead handoff
- Final gates: deterministic cold/warm save/restore, conservation and work
  bounds, seeded outcome evidence, browser review and external ARM qualification

Existing parser budgets, client credits, checkpointed searches, naval facts,
command receipts and tower quote overlays are retained. New work must not
reconstruct the stopped historical stress experiments or claim that a local
correctness suite establishes the requested capacity. Initial-tech availability
for advanced regular-player starts is awaiting user clarification; budgets and
explicit tribe rules can proceed independently.

### Phase 3a evidence and open decision

Seven-age tests verify actual catalogue purchasing power for two cities, two
barracks, mine, factory, age-compatible smith and two infantry. The supplied gold
matrix underestimates V1 building prices in every age; actual banks use the
larger of that proposal and the rounded current-catalogue package. Stone has no
smith tier. The initial army no longer consumes the stated reserve bank.
Tribes start in the selected age with four matching squads and a matching
barracks, prior technologies, a funded core infrastructure package, one economic
or two military copies, and legal same-age research. Advanced tribe development
rotates types and checks at most sixteen sites per strategic pass; its cursors
survive checkpoints. Sandbox tribe rules remain unchanged.

Initial regular-player technology grants are pending clarification; buying power
is tested separately from researched availability. Existing tests were updated
only where they asserted superseded opening banks/tribe ages; the zero-stock UI
test now explicitly depletes stone. Full gate: 967/967 tests (146 files),
TypeScript, build, whitespace and targeted Oxlint passed.

### Phase 4a evidence

Production match workers now retain fixed 256-sample timing windows for command
batches, queue wait, tick stages, snapshot extraction and encoding. Publication
results include current entity/planner/receipt counts and worker heap, external
and ArrayBuffer usage (RSS is explicitly process-wide). A structured diagnostic
record is emitted at most once per 600 simulated ticks. Worker failure messages
name the timed-out operation and exit code. `/healthz` keeps liveness distinct
from aggregate running/preparing/stalled worlds; deliberate joins/empty-match
pauses are not labelled stalled. Detailed measurements remain server-side.

Tests prove diagnostic storage is bounded, invalid readings are ignored,
instrumentation leaves deterministic checkpoints unchanged, real workers return
metrics and a healthy coordinator can distinguish lost world progress. Full
gate: 970/970 tests (147 files), TypeScript/build/whitespace/targeted lint passed.
This is instrumentation, not a measured performance improvement or full tracing:
GC pauses, client frame/heap, detailed codec stages, scheduler lateness and ARM
ordinary-play acceptance are still required.

### Phase 4b reliability slice

Connected-land queued legs now wait on checkpointed bounded navigation work
instead of synchronously searching at activation. Later Shift legs survive,
replacement orders cancel obsolete queued work, and save/restore preserves the
waiting leg. Ordinary warship patrol wandering uses the same recovery admission
as its return voyages. Repeatedly resource-limited replacement land/sail inputs
back off and terminate after three attempts with a capacity reason; they do not
report a disconnected map or partly activate selections. Already committed
background legs keep deterministic capped backoff rather than being silently
cancelled. Dead-unit order revision and navigation state is cleaned up.

Full gate: 973/973 tests (147 files), TypeScript/build/whitespace passed after
correcting an ES library mismatch in new test array indexing. Focused
movement, ships, patrol and checkpoint suite: 30/30. This does not close all
planning acceptance: army formations, trade and shore candidate transactions,
full formation-clearance budgets, successful escalation of large searches and
per-player fair shares remain open. Production feature switches stay disabled.

### Phase 5 work reduction slice

Capture pressure clears only previously touched cells and retains a bounded
sparse typed index, preserving neutral/contested byte semantics. Tests compare
forty evolving rounds with an independent full-array reference and cover empty
rounds, repeated contests and retained-memory bounds. Fleet movement groups
cargo once after boarding instead of scanning every squad per ship. Fresh
stage-local grouping avoids stale embark/unload/removal/restore identities.
Regression also verifies dead-unit navigation generations are removed.

Full gate: 977/977 tests (149 files), TypeScript/build/whitespace and focused
Oxlint passed. This removes known repeated work, without asserting wall-clock
speedups. The broader persistent building/resource/producer lifecycle indexes,
regional facts and dirty publication journal remain open; stage grouping is not
presented as a complete lifecycle event system.

### Phase 6a presentation slice

The decoder worker can apply an update without cloning/transferring a complete
render view. When rendering is busy, the session continues ordered canonical
application and network acknowledgements, then requests one latest projection
through the same serialized decode channel when ready. Dirty change-and-return
unions survive; sync/recovery baselines still demand a complete presentation
before barrier acknowledgement. No server protocol or human simulation changed.

Real-worker and session tests cover canonical-only updates, late projection,
change-and-return, bounded pending presentation, and ordinary/recovery flows.
Focused suite: 33/33. Full gate: 979/979 (149 files), TypeScript/build and
whitespace passed. Browser end-to-end performance review is still outstanding.
Server compression is still on the advance dependency and is tracked separately
in phase 6b; this slice does not claim a complete replication-worker split.

### Phase 3b confirmed starting research

Latest user clarification supersedes the ambiguous immediate-package technology
proposal: every start grants the first actual node in each research branch plus
all prior-age technologies. Other starting-age nodes still require ordinary
research. This applies to regular factions and age-locked tribes in all seven
ages, including Cargo Canoes at Stone start. Snapshots include the starting age
so the UI labels the corresponding current-age roots as starting grants.

Seven new all-age checkpoint tests verify exact grants, no accidental later-node
unlocks and restore. Existing research/transport tests now use the next legal
node, or explicitly construct an unresearched state when testing prerequisite
rejection. Full gate: 986/986 tests (149 files), TypeScript/build/whitespace passed;
focused research, transport, UI and live-join checks: 55/55.
