# Multiplayer fixes contract

Implement measured pipeline improvements without changing the 20 Hz canonical
simulation, combat/economy/AI rules, planning budgets, or deployment state.

The coordinator services one canonical tick per worker request, retaining a
bounded catch-up deadline. Worker requests and mutations remain serialized;
every tick boundary returns control for publications and queued human input.
Background publication is capped at 5 Hz in both wall and simulated time, so
an overloaded world does not capture more snapshots per logical tick. Executed
commands retain immediate publication. Overdue dispatch yields through the Node
event loop without a mandatory zero-timeout sleep.

Network snapshots use the already supported compact formation/trader encoding.
Baseline encoders must use the same supported representation. Every network
packet remains validated, ordered and applied; no arbitrary delta dropping.

Client canonical application validates once. Worker-to-renderer presentation
may carry decoded entity objects and sparse tile obligations directly, avoiding
JSON re-encoding and revalidation of already validated worker-owned state.
Worker postMessage synchronously isolates object graphs. Canonical tile arrays
are never transferred; presentation map arrays belong to the receiving thread.
Dropped views retain all unacknowledged tile/geometry obligations. Joins,
recovery, removals, roads, deposits, barriers, formation changes and duplicate
ticks must retain existing semantics. Snapshot consumers finish synchronously
and retain only latest map arrays, consistent with existing decodeLatest usage.

Acceptance: focused ordering/recovery tests, full suite, TypeScript/build;
exact decoded-state comparisons, matched checkpoint continuation, repeated
one/three-client pipeline measurements and isolated two-CPU ARM qualification.
Report simulation speed, order receipts separately from visible movement,
publication gaps, encoder wall time versus CPU phases, retained queues and
client presentation work. Do not claim a fixed cause for the missing historical
human match or sustained 1x if it remains unmeasured/unachieved.
