# Local late-game progress, 2026-10-12

Acceptance remains unmet: the captured Migration 1000 / 14 AI / tribes match
must sustain 20 canonical ticks per second on the user's PC, with the ordinary
worker, replication, renderer, HUD and player command path.

The normal rendered continuation before admission revalidation reached 0.7134
game seconds per wall second. Its rolling 512-worker-tick mean was 63.96 ms,
p95 86.1 ms, p99 98.9 ms. A Hold command was admitted in 39.1 ms. This is a
short continuation, not proof against the reported 25-minute session failure.

Retained work includes exact movement/contact preparation, formation assignment
reuse, narrower entity writes, shared phase geometry, compact local formation
slot replication, deadline-based local scheduling and a checkpoint replay page.
Further changes share identical pending trade corridors and preserve legal
movement admissions through unrelated AI permission revisions. The latter
addresses 87 blanket cancellations observed in a 200-tick trace. Validation
is resumable and charged, including diagonal corner checks; unfinished exact
searches retain their state and check the live permission mask before publishing.

The opt-in autonomous route deadline expires active searches at 40 game ticks.
In a 1,200-tick replay, maximum active age was 39 ticks. It also increased useful
completions and actual route/movement work substantially, while producing many
capacity-limited trade results. It is not enabled in ordinary matches: bounded
age alone does not qualify either performance or trade behavior.

Rejected experiments were removed:

- Halving background route work and spacing AI strategy decisions further apart
  did not establish a whole-game gain. The rendered experiment ran at 0.5566x
  and 687 of 798 recorded trade outcomes were capacity-limited.
- Blocked-reform interpolation caching, physical pose keys and sorted sweep
  merging preserved canonical replay values but did not establish a gain.
  The common one-candidate kernel regressed in alternating measurements.
- A separate reservation revision preserved the 200-tick canonical hash but
  did not reduce occupancy rebuilds: both control and candidate rebuilt 1.095
  times per tick. Keeping the counter would add maintenance without benefit.

After removing these experiments, the movement admission, revision validation
and route planner suites passed all 40 tests. Production Vite build passed.
The previously identified recruitment TargetTag type errors and broader suite
failures are separate unresolved gates; this report does not claim all gates
pass. Unrelated gameplay edits have been preserved.

The rebuilt normal rendered replay reached tick 38,594: 129.7 game seconds in
145.84 wall seconds (0.8893x overall). The latest rolling 512-worker-tick mean
was 59.61 ms, p95 86.9 ms, p99 94.3 ms, max 178.5 ms. Earlier in that run,
recent ticks briefly averaged 43.6 ms, but route cohorts included searches
waiting over 1,200 ticks. This is not bounded AI planning or sustained 1x.

Allowing AI formation/ship admissions to use the existing warmed corridor was
also rejected: with the same deadline, its 400-tick measured-window completion
count was 1,450 versus 1,651, with 626 limited receipts versus 456. Its Node
simulation mean was 100.24 ms, still far above budget. The route eligibility
change was removed. Better queue age must come with useful route throughput.

Long continuation qualification and further optimization are still underway.
Node measurements include encode/clone/decode, but exclude rendering and do
not establish local browser acceptance. No commit, push or deployment was made.
