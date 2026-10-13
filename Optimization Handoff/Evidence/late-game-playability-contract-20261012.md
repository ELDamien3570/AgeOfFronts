# Late-game local playability contract

Primary target: local single-player on the user's PC, 1× speed, 1000-cell maps,
14 AI and tribes. The current late-game replay has about 530 squads and 270 ships.
Other populations and eras require their own evidence; this does not certify
2,000 squads or hosted capacity.

The test page must restore a saved checkpoint immediately and use the ordinary
local worker, renderer, HUD and command path. Diagnostic timing is observation
only. It must show actual simulated/wall-time progress, phase costs and command
latency, and permit returning to the same replay for comparisons. Normal matches
keep their existing startup and validation.

Acceptance: sustained 1× progress over a meaningful late-game continuation,
worker average below 50 ms with headroom toward 40 ms, bounded tick spikes,
responsive human orders, no worker/snapshot failures and stable retained memory.
Rendering and replication are included in the final browser run. No outcome may
depend on a CPU clock measurement, camera position or elapsed wall time.

Movement refactor: prepare exact current and next transition geometry once per
physical pose. Candidate roots only translate prepared geometry. Preserve the
existing swept region, rounding skin, completed-transition body, enemy-overlap
escape rule, column row union, cavalry penetration, shoreline and transport rules.
Invalidation includes root position, soldier count/capacity, definition, formation
container, transition tick and charge phase. No administrative-only mutation may
hide an actual physical change. Derived caches remain bounded or weakly owned.

Every retained optimization requires focused correctness tests, checkpoint/state
comparison on the same continuation and isolated browser measurements. Alternate
baseline and candidate measurements using the archived pre-change source. Do not
interpret a Node-only improvement as browser acceptance.

Next exact passes: resolving damage still computes the same troops, wounds, hull
health, revision and casualties. If those values are unchanged, retain the owned
manpower container and publish no entity write. Never suppress a real wound,
zero-health removal or casualty. Verify against an always-write reference.

Formation slot memoization uses the same immutable formation owner and exact
definition, count, shape, frontage, seed and normalized transition progress.
Replace per-lookup JSON key allocation with bounded scalar facts. Transition
assignment may reuse an immutable source/destination pair through weak ownership;
retain existing content-based fallback and matching/tie behavior. Derived facts
do not enter checkpoints and cannot affect route or combat outcomes.

Spatial extent queries reuse the existing CombatGeometry pose owner. Its checks
include position, count, capacity/variant, definition/kind, immutable formation,
charge phase and animated tick. The query still observes live casualties after
index construction. Contact AABBs are derived once per immutable footprint parts
array; exact polygon contact, row traversal and tie order remain unchanged.

Candidate clearance reuse extends the existing movement proof owner. Cache at
most eight exact endpoints per squad, and expire them on tick or squad spatial
revision changes. The synchronous avoidance phase does not mutate terrain,
fortification or political permission between probes; movement/transport commits
advance spatial revision before later probes. Every returned proof still updates
the endpoint used by the existing rollback guard. Steering-cone checks stay
outside this cache. Verify canonical equality and transport/overlap scenarios.

Assignment preparation retains the original Hungarian iteration, strict cost
comparisons and tie order. Precompute unchanged squared pair distances and reuse
per-call min/used arrays between augmentation iterations. Compare complete
assignments against the archived original on duplicate, fractional and full-size
inputs; canonical continuation remains the acceptance guard.

Ground and alive-ground phase views may share a grid only after proving all
unembarked source rows are alive at the same spatial revision. Dead rows require
the existing independent inclusion contract. Boarding, casualties and restores
must invalidate this proof through the existing unit index revisions. Source
order, exact queries and live extent checks are preserved.

The local coordinator uses deadline timers while ahead of schedule and a queued
MessageChannel task when overdue, avoiding nested zero-timer clamping. Both paths
advance at most one tick, then yield. Every replacement or cancellation invalidates
the pending generation token, so a queued wakeup cannot advance a restarted, paused or
failed match. Command processing remains outside the tick task. Canonical clocks,
planner budgets, publication cadence and bounded suspension debt are unchanged.
Verify overdue yielding, cancellation/replacement, worker restart and failure.

HUD recruitment quotes may be reused only within the same synchronous update.
The next snapshot or selection update recomputes them. No persistent quote cache
or delayed button-availability policy is introduced. Empty control groups need
no repeated full-snapshot pruning during selection projection.

The match owns one CombatGeometry instance for movement, facing, phase spatial
views and battle consumers. Standalone BattleWorld adapters may keep an independent
fallback. Every lookup retains position, count, immutable formation, definition,
capacity/variant, charge and animation checks; no historical prepared body is
borrowed after its scalar inputs change. Contact reuse preserves traversal and
exact ties. Derived ownership is not serialized. Differential checkpoint and
combat/charge coverage qualify the shared owner.

A CombatGeometry pose prepares its full body lazily. Envelope-only consumers
(spatial indexing and broad rejection) keep the same envelope and scalar guard;
body/contact consumers acquire the exact current body on first use. No mutation
occurs between the pose check and body acquisition in a synchronous query. This
removes derived allocations from broad-only queries without changing geometry.

Background routing budget reduction was tested and rejected: the original
1200-tick continuation remained at its 120-request background ceiling on every
tick, with oldest ages 768-2078 ticks. An age fence would restore the old budget
throughout this run; reducing work without that fence would worsen service.
Retain existing planner allowances and priority. Record per-tick cohort ages,
pending counts and cumulative work/outcomes outside canonical state, and reduce
duplicated requests before reconsidering lower background allowances.

The captured trade queue contains duplicate pending corridor searches. Trade
already reuses completed paths by owner, naval mode, start, goal and permission
revision. Extend that ownership to pending work: at most one live requested
admission for each exact corridor key. Other admissions wait under their own
shipment/control validity, then reuse the existing completed-path cache. Loading,
receiving capacity, cargo and route activation remain separate transactions.
On restore, reconcile duplicate requested admissions through charged planner
cancellation; never abandon retained workspaces. Invalidated or failed leaders
release the reservation, allowing the remaining valid admissions to retry under
existing market backoff. Reservations are derived from checkpointed admissions,
not a new persisted queue. Cancellation of one actor cannot cancel another
actor's independent leader. Include departure territory in the key because it
controls the permitted escape mask; all other dependency guards remain intact.

Formation approach probes reuse the exact pair's Minkowski obstacle polygons.
Those polygons depend on both physical bodies and the simulation tick for an
animated body, but not approach angle or reach. Resolve through the existing
BodyFacts guards, with weak pair ownership so expired bodies release polygons.
Retain the original world-to-local subtraction, corner order, convex hull,
column head choice and radial solver. Angle/reach remain live on every probe.
Do not approximate geometry or reuse polygons across a moved/reformed body.

User-selected autonomous route deadline: 40 simulation ticks (two seconds).
Opt-in MatchOptions.autonomousRouteDeadlineTicks=40 is canonical and checkpointed;
old checkpoints omit it and retain their schedule. New local games enable it
after qualification. Human-commanded routes never receive this deadline.
At the beginning of each planner step, publish expired live requests (including
replacements awaiting cancellation cleanup) as capacity-limited, with no path.
Retire retained search arenas under unique cleanup keys and reclaim only through
the existing charged scheduler. The deadline is a terminal planning receipt,
not proof of geographic impossibility, and not a promise of eventual movement.
Domain owners keep their established retry and alternative-objective policies.
Distinguish live-request ages from reclamation ages in diagnostics. Test exact
40-tick admission receipt, human exemption, replacement expiry, cold restore,
bounded reclamation and no double publication. Do not reduce background work
until the deadline and retry throughput measurement establishes stable service.

Rejected scheduling experiment: a 2048-unit live autonomous allowance, four cold
corridor preparation units and a 30-tick squad strategy period preserved player
and reclamation capacity but did not establish useful pace gains. The rendered
candidate advanced at 0.5566x, and 687 of 798 trade outcomes were capacity-limited.
Removed the smaller allowance/cadence options. Existing work budgets and the
15-tick squad strategy period remain. The 40-tick deadline is retained only as
an opt-in qualification policy; it is not yet a normal-game default.

Confirmed admission churn: a faction's moving defensive threat centers change
its navigation permission revision, causing blanket cancellation of pending exact
routes. Retain fitted layouts and in-flight searches after permission changes;
the planner already revalidates those searches against its live mask. Revalidate
completed member paths and shared spines through checkpointed admission cursors,
at most 64 path positions per charged unit (up to three obstacle checks per
position, including diagonal corners). A changed revision restarts validation,
not route search. Drop only paths/spines actually blocked by the new mask. Do
not activate an admission until its revision validation finishes. Keep the
existing live connector, final destination and per-movement collision guards.
Unfinished formation fitting retains its existing restart semantics. Verify AI
and human cases, blocked paths, unrelated permission changes, strict allowances
and restore in the middle of validation.

Rejected geometry experiments: shared blocked-reform interpolation layouts,
slot/orientation body-fact keys and sorted candidate-sweep merging preserved
canonical values but did not establish a whole-game benefit. The captured
checkpoint has only one blocked reform. Alternating kernel measurements also
showed a regression in the common one-candidate case. Removed those changes;
retain the previously qualified exact geometry owners and sweep implementation.

Rejected reservation revision experiment: separating exact reservation inputs
from other squad facts preserved the canonical replay hash but did not reduce
rebuilds. Both control and candidate rebuilt 1.095 times per tick over the same
200-tick continuation. Removed the separate counter and its invalidation logic;
retain the existing dynamic revision and the profiler's rebuild instrumentation.

Rejected routing experiment: allowing autonomous formation and ship admissions
to use the warmed hierarchical corridor solver under the existing allowances
did not qualify. With the 40-tick deadline, the 400-tick candidate produced fewer
completions (1,450 versus 1,651 measured-window completions) and more limited
receipts (626 versus 456). Removed that eligibility change. A faster replay
with starved AI is not acceptance; bounded age alone is not acceptance either.
