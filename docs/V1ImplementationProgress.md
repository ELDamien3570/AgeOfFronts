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
| 6b | Bounded server encoding/publication pipeline | Passed; 990 tests; normal advances release before off-thread encoding, ordered publication and flushed barriers |
| 5b | Independent dirty-tile journal and snapshot extraction | Passed; 993 tests; independent bounded cursors, restore/overflow fallback and network-only borrowed terrain fields |
| 7a | Geographic diplomacy and recipient cooldowns | Passed; 997 tests; maintained land borders, bounded same-sea port facts, checkpointed recipient cooldowns |
| 7b | Optional AI operations and local defensive wake | Passed initial policy; 1003 tests, deterministic single offensive commitment, declarations, recovery, local multi-aggressor defence and footprint guards |
| 8a1 | Terrain-aware city enclosure planning | Passed; 1006 tests, resumable terrain-band search/copy/outline, exact paid links and friendly access |
| 8a2 | Stable defence sectors and staffed Modern sections | Passed; 1012 tests, bounded stable sector facts, actual payment, garrison/support/reserve, withdrawal and reuse |
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
correctness suite establishes the requested capacity. Initial-tech availability was resolved by the user: start with the first node
of every branch plus all prior-age technologies; see phase 3b.

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

### Phase 6b server replication separation

A dedicated pure encoding worker now owns packing/compression/hashing. Normal
production advances enqueue at most two coherent publications and return before
encoding finishes. At capacity, capture is skipped without advancing the shared
delta cursor; the next admitted capture includes accumulated state changes.
Publication order is retained, captured ticks are not relabelled with a later
simulation tick, and encoding errors terminate the affected executor visibly.
Join, recovery and terminal barriers drain earlier publications before taking
aligned baselines. The simulation remains the only authoritative owner.

The immutable boundary is the synchronous worker postMessage clone. It occurs
before any later simulation step, including for expansion records shared by the
snapshot projection. Encoder backlog, memory and skipped-capture counters join
the bounded diagnostics. The encoder has a 256 MiB old-generation ceiling, in
addition to the existing simulation worker ceiling; this is a limit, not total
process memory certification. Ordinary advances do not await compression;
explicit join/recovery barriers still wait for required earlier encoding.

Tests cover two-slot admission, no capture at capacity, ordered completion,
failure cleanup, live-worker publications, mutable research timer coherence,
aligned join baselines and delayed publication tick labels. Full gate: 990/990
(150 files), TypeScript/build/whitespace and targeted lint passed. Actual ARM
CPU/RSS and multi-match admission remain external acceptance. Full-map snapshot
extraction and the wider entity lifecycle journal remain separate work.

### Phase 5b dirty extraction

A match-owned bounded journal records owner/claim/progress mutations. Each
snapshot encoder owns an independent cursor; one-off baselines never drain the
shared publication stream. Ordinary network snapshots borrow terrain fields
only until immediate packet extraction, avoiding three map-sized copies. Normal
snapshot callers still receive isolated arrays. Encoders inspect sorted changed
tiles, preserving the existing packet ordering; overflow and restore force the
exact full-scan path. No tile authority moved out of the simulation.

Tests compare journal-backed packets byte-for-byte with full scanning over
changing capture state, exercise independent baselines, overflow/restore and
normal snapshot isolation, and assert reduced cell-read counts. Full gate:
993/993 (151 files), TypeScript/build/whitespace/targeted lint passed. Persistent
entity/producer revisions and broader lifecycle read models remain additional
work; this journal currently covers terrain ownership and capture fields.

### Phase 7a geographic diplomacy

AI offers now require a genuine shared land border, a nearby connected land
base, or usable nearby ports in the same sea. A fixed-size maintained border
index updates from ownership mutations and rebuilds on restore. Port discovery
uses shared naval facts with a deterministic global read budget and retained
cursors, rather than repeatedly scanning every building. Actual port ownership,
completion and health are revalidated before use. Recipient-wide AI offer
cooldowns prevent several factions repeatedly approaching the same recipient;
human offers and replies retain their ordinary behavior.

Independent full-border reference checks cover 240 ownership changes, water
exclusion and rebuilding. Geography and diplomacy tests cover connected versus
distant bases, genuine borders, sea identity, bounded cold discovery, captured
and unfinished ports, cross-proposer cooldowns and checkpoint restoration. Full
gate: 997/997 tests (153 files), TypeScript/build/whitespace and targeted lint
passed. This constrains proactive AI diplomacy only; physical hostility and
human combat/capture are unchanged. Optional military operations follow in 7b.

### Phase 7b optional military operations

The new `aiWarPolicy` switch defaults off. Regular AI nations keep one stable
offensive commitment through peace, preparation, declared war and recovery.
Candidate discovery is geographic, staggered, limited to sixteen reads per tick
across factions, and weighted against piling onto an existing offensive target.
Preparation uses personality readiness and deadline rules; shortages, invalid
targets and campaign expiry lead to recovery. Public events show declarations
and offensive withdrawal, without exposing private preparation.

Capture pressure and actual land, naval and structural damage wake only the
affected faction. Multiple defensive aggressors are remembered independently
for 600 ticks; border hopping refreshes that memory. Defensive pursuit is local
to observed aggression. Sleeping nations avoid offensive target/raid work;
ordinary squad tactical staggering remains. Route obstacles include the actual
three-tile capture footprint, and live movement guards stop entry after border
changes. Landing selection and controlled-water movement check the same policy;
recovery retains former-theater transit for withdrawal and returns cargo toward
friendly coast. Existing combat and capture rules, including human unannounced
invasion and incidental combat, remain authoritative.

Tests cover declaration uniqueness, one offensive versus multiple defensive
targets, losses/recovery, capture pressure before owner change, hostile damage,
allied exclusion, remembered aggression, local pursuit, interior route/footprint
blocking, human control transfer, disabled behavior, bounded candidate work,
checkpoint restoration and feed rendering. Full gate: 1003/1003 tests (154
files), TypeScript/build/whitespace and targeted lint passed. This is the initial
operations layer: richer force/logistics readiness belongs to 8b/8d; broader
regional lifecycle indexes, remaining bounded planners and field qualification
remain explicit open acceptance work.

### Phase 8a1 terrain-aware city enclosures

City defence retains its simple exact rectangle when legal, then resumes a
four-tile lattice search in exterior terrain bands when it is obstructed. The
result can bend around unusable or unowned cells while enclosing the protected
hub. Search, trace copying and final perimeter construction yield explicitly;
a slice consumes at most 32 outline work units. Search storage and the final
32-tower/384-cell construction limits are capped. Failed proposals back off.

Actual production tower quotes still decide links and costs. Legal automatic
shortcuts at bends are included in the paid footprint, and every intended
circuit edge must exist before the proposal is accepted. Friendly/allied access
uses the existing gate/passability rules. Tests independently check polygon
containment, exact spacing, unusable cells, work bounds, checkpoint continuation
and a real terrain-aware project through paid completion and friendly access.
Full gate: 1006/1006 tests (155 files), TypeScript/build/whitespace and focused
lint passed. An initial integration test correctly rejected an automatic link
outside the planned footprint; the quote reconciliation now retains legal
shortcuts while verifying all intended edges. Modern staffed fronts remain 8a2.

### Phase 8a2 stable sectors and staffed Modern sections

A constant-time shared boundary cursor feeds resumable 16-by-16 sector
assessments. Each faction retains at most eight stable hostile sectors. Equal
quality discoveries do not churn that shortlist; live ownership and treaty
checks invalidate lost fronts. Sector work shares the existing 128-unit facts
allowance without taking away the city minimum. Checkpoints retain exact scans.

The Modern controller builds at most one active three-site section per faction:
two trenches, a supported gun position and a mobile reserve, with additional
unleased force left available. Resumable roster/threat assessments consume at
most 32 work units per slice. Real researched construction commands own payment;
the full unpaid useful section is reserved, approaching threats suppress unsafe
construction, and holding requires actual garrison arrival. Control changes,
lost fronts and depleted garrisons release unpaid funds/leases; paid buildings
remain. A later section reuses compatible paid structures instead of buying
duplicates. Existing friendly passability and combat remain authoritative.

Tests compare border facts to an independent edge scan, restore mid-scan and
mid-construction, prove stable bounded shortlists, verify exact 49,980 gold and
40 steel construction payments, cover/support/reserve staffing, funding cleanup,
takeover, withdrawal, reuse and rejection of unsupported/unsafe spending. Full
gate: 1012/1012 tests (156 files), TypeScript/build/whitespace and focused lint
passed. This is a completed bounded sector/section implementation, not connected
whole-front aggregation or final performance acceptance. Broader defence
optimization and multi-region doctrine remain handoff tasks.

## Requested stopping point

The user requested completion/testing of the active defence slice followed by a
local-agent handoff, replacing further implementation in this run. Feature work
stops after 8a2. `Optimization Handoff/` records the exact checkpoint and separate
remaining-task plans. No later land/economy/naval phase was started. Experimental
features remain opt-in; no deployment readiness or ARM capacity is asserted.
Concurrent remote `Art/` additions are the user's in-progress artwork and must
be preserved without wiring them into gameplay or treating them as this scope.

## Local roadmap continuation, 2 October 2026

The user subsequently authorized the full remaining roadmap, staged in dependency
order. The prior stopping point remains historical evidence. The continuation
starts from published branch source `357fa7d5f8a8b2c54b55812f860b4918591693a3`.

P01 production-path observers are implemented on
`codex/optimization-runtime-diagnostics`: bounded codec/worker/coordinator/client
stages, active simulation cadence, planner faction/caller outcomes and residency,
worker-local GC, lifecycle failure categories, and correlated periodic summaries.
The observers do not enter checkpoints or select gameplay work. See
`Optimization Handoff/Plans/01-runtime-diagnostics.md` for measurement definitions,
exact local evidence and open external acceptance.

The local gate passed 1018 tests in 156 files, TypeScript, production build,
whitespace and scoped lint. Windows x64 Node 24.18.0 required one-worker tests to
avoid the unchanged five-second baseline timeouts under four workers. Full-file
Simulation ESLint still reports its pre-existing unused `tile`; this was not
changed or counted as a clean full-file lint result. Runtime compatibility hash:
`c2e8bcc5908cd6870c6bf56be1ecce887aa80f9387ac2d25b46ac9c9822b571d`.

P02-P30 remain open at this checkpoint. No experimental default, target-capacity
tier, artwork integration, remote publication or deployment was authorized by
this local code gate. Real-browser acceptance and actual ARM capacity are still
unverified.

### P02 structural consumer envelope and recovery slice

`codex/optimization-consumer-envelopes-local` implements coordinated producer/decoder
envelopes, sparse active arena saves, an explicit reader for legacy full arenas,
finite pending-formation values with legacy sentinel migration, and close-time
cleanup for stalled renderer projections and receipt history. Exact transport
boundaries, malformed partitions, restored free order and deterministic pending
movement are covered by focused tests. Shared limits enter runtime compatibility
identity; experimental defaults and existing protective ceilings are retained.

The inventory and reproducible small local memory samples are in
`Optimization Handoff/Evidence/02-consumer-envelope.md` and its JSON companion.
Runtime identity: `0ab1914af298824ea28f450586520247ccb67c9eb6231a41ec0fb4e7165aa705`.
The fixture is Windows x64 Node 24.18.0, 128 by 96, seed 47, ages-v1, one AI,
no tribes, AI disabled, deferred planning enabled, tick 1 after a human move.
The active arena fixture has 65,536 slots with two in use; its typed save bytes
fall from 2,097,152 to 262,200 while preserving exact future allocation order.
Sampled memory is neither an exact transient peak nor convergence/capacity proof.

Focused regression tests, TypeScript, script typechecking, production build,
whitespace and scoped lint pass. The full unchanged-timeout suite ran all 1024
tests in 156 files: 1019 passed, five timed out in VallesKairuliaMap, ShoreTransport,
Tribes and Movement. The affected four files were rerun unchanged: 34 of 39
passed, with five timeouts (Movement passed). With all P02 files temporarily
set aside, identical P01 source from `14fafeb` produced six timeouts in the same
map/tribe/shore files, 33 of 39 passed. The concurrent Art-only parent `59c4eeb`
was preserved and its simulation/tests were verified identical to `14fafeb`.
This demonstrates baseline timing failures in the current environment; it does
not turn the full suite into a clean pass. Timeouts and assertions are unchanged.
The green full-suite timing gate and mature-world/browser/ARM memory qualification
remain open. P03 is independent of P02 and can proceed with this evidence retained.

The user explicitly approved enforcing read-only entity collections/records with
domain mutation methods and migrating affected fixtures for P03. P03-P30 still
require implementation and their own acceptance evidence.

### P03 building lifecycle checkpoint

Local code commit `1fe9ede1b8ee9c093032d0257423fb90c4e022ab` on
`codex/optimization-lifecycle-indexes` owns building spawn/update/remove/restore
through explicit domain methods. Stable records have TypeScript read-only fields;
public arrays and index views are frozen. Identity, ownership, type, stack/tower,
income, producer revisions and highest live ID update incrementally. Restore
rebuilds derived facts; optional comparison mode detects drift without repairing
canonical state or entering checkpoints. Affected writers and fixtures use the
owner. Squad, ship and cargo lifecycle ownership remain open, so P03 is partial.

Six independent lifecycle tests include 300 seeded mutations, same-length
replacement, unfinished producer death/revival, 240 warm owner queries with no
new rebuild scan rows, and exact restored continuation. The six-file focused
gate passed 37 tests. Full suite: 1,030 tests, 1,029 passed and one unchanged tribe
frontier timeout; all eight tests in that file passed on an unchanged rerun.
The same frontier timeout occurred on the pre-P02 baseline. The full-suite timing
gate remains open. TypeScript, build, whitespace and scoped lint passed, retaining
the known old Simulation unused-local lint exception. Evidence:
`Optimization Handoff/Evidence/03-building-lifecycle.md`. Runtime identity:
`f1a19b5fb9ef323f43bd24912791dd21961533d75a50622119e36c0f06fb4d28`.

The user reserved P11 planner progress/fairness and P14 browser rendering for a
separate session. This session retains P03 and subsequent unassigned plans;
shared Simulation/Protocol integration is serialized here. Reservation is not
implementation or acceptance evidence. Parallel sessions need separate worktrees.
