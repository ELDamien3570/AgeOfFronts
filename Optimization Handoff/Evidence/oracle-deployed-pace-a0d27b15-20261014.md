# Oracle deployed multiplayer pace — a0d27b15

Deployed `a0d27b15eb36d2dc6f5848c0e71caa39a8ea0735` from `1.5.7-10hz-prototype` to the existing two-core ARM / approximately 12 GB Oracle host. GitHub publication was verified against the exact SHA. The documented release script completed with zero active matches, a SQLite backup and healthy containers. Tick rate remains **20 Hz**. No new hardware or cloud billing changes.

## Actual multiplayer pipeline measurements

| Workload | Observation | Actual pace |
| --- | --- | ---: |
| Public release smoke, opening match-263 | Two binary clients; movement, construction, reconnect and state checks passed | 0.999x over the available diagnostic interval |
| Controlled dense Migration, fixed continuation | Three remote clients; 600 ticks / 30.317 seconds after 100 warm ticks | **0.990x** |
| Controlled dense Migration with player movement orders | Three remote clients; 1,599 ticks / 90.249 seconds | **0.886x** |
| Final 30 seconds of active-order run | Population approaching 898 squads / 312 ships | **0.813x** |
| Final 10 seconds of active-order run | Same evolving test | **0.790x** |

**Sustained 0.85x is not established.** The 90-second average exceeds the goal, but its ending intervals fall below it as population and economic activity grow. These are full-pipeline wall-clock measurements, not estimates calculated from simulation-only means.

## Controlled workload and boundaries

The existing deterministic `out/migration-lag-20261014/scenario.v8` fixture starts at tick 3,000 on a generated 1,000 × 1,000 Migration map, with 700 squads, 300 ships, three human factions, 10 AI and 25 tribes. Starting and maximum age are Napoleonic. It is a constructed workload, not the match-259 capture or a naturally played late-game match. The fixture is restored with `diplomacyRules: raids-v1` and `armyTravel: corridors-v1` to exercise the deployed changes.

An isolated coordinator and fixture worker run inside the **exact deployed image**, importing its source and dependencies. The adapter supplies the fixture in place of initial world construction; the production scheduler, simulation, publication queue, encoding worker, codecs and client decoding/presentation pipeline remain in use. Three clients run on the local PC, connected through SSH tunnels to localhost-only server ports. This measures remote receipt/decoding and flow-control acknowledgements, but excludes a graphical renderer and public Caddy/WSS ingress. Internet latency includes the SSH tunnel. The separate public smoke validates that production ingress, authentication, commands, construction and reconnect work.

The test container is limited to two CPUs / 8 GB, read-only except temporary storage, with dropped capabilities, no extra privileges and a 240-second application lifetime. Production stays online; the test stops if a real production match becomes active. Both test containers and SSH tunnel were removed/closed after measurement.

Fixed continuation: 100 warm ticks, then 600 measured ticks; no new human commands during the measurement. It ended around 774 squads, 306 ships, 168 buildings and 201 traders. Each client received 150 updates at approximately 4.94 Hz, with no rebases/errors. Delivery-gap p95 was 287–291 ms, maxima 381–409 ms. Final rolling tick window: mean 44.70 ms, p95 58.55 ms, p99 77.70 ms.

Active continuation: approximately 15 seconds of additional warm time, then 90 seconds with one selected squad per client receiving a nearby movement command every five seconds. This is modest input activity, not mass army orders or a heavy battle test. Measurement started around 733 squads / 302 ships / 155 buildings / 159 traders and ended at 898 / 312 / 224 / 313. There were 49 executed commands and two deferred commands later superseded. No rejected orders, rebases or client errors were reported. Execution-outcome receipt means were 161–167 ms and p95 210–245 ms; these do **not** measure first visible movement. Each client received 413 updates at about 4.57 Hz. Delivery-gap p95 was 357–359 ms, p99 498–503 ms, and maxima 545–566 ms.

## Remaining cost

The last 256-tick rolling window of the active run averaged **59.83 ms**, p95 **73.77 ms**, p99 **122.63 ms**, maximum **180.80 ms**. Phase means:

| Phase | Mean |
| --- | ---: |
| Movement | 19.89 ms |
| Combat | 11.66 ms |
| Routing | 9.97 ms |
| AI | 5.72 ms |
| Capture | 5.36 ms |
| Ships | 2.40 ms |
| Economy | 2.02 ms |

This final window differs from the full 90-second distribution. It shows why speed deteriorates as the workload grows: simulation exceeds its 50 ms budget. Snapshot extraction averaged 1.05 ms and snapshot preparation 3.03 ms per publication. Asynchronous encoding turnaround averaged 68.37 ms; that is elapsed turnaround, **not exclusive CPU time to add to each simulation tick**. Encoding-worker compression averaged 10.02 ms, packing 1.94 ms, JSON 1.55 ms. The cadence and occasional large tick/encoding times remain relevant to uneven client updates even when mean game speed approaches 1x.

There were few projectiles in observed endpoint snapshots (zero at the end, two in one intermediate sample). This qualification does not establish performance in sustained large-scale combat. Nor does a fixture population automatically reproduce every route, trade and formation pattern of a human late-game match. Observe a naturally played late game before claiming the original multiplayer lag is fully solved.

## Release verification and artifacts

Public smoke initially failed on Migration size 250 because the fixture could not find an affordable barracks site; public connection, orders and movement had already passed. A retry on Valles Kairulia size 500 passed the complete smoke with two clients. This was a fixture limitation, not silently ignored evidence.

Production revision marker and Docker image match the full SHA. Public HTTPS health is healthy/open with zero active matches after the tests. SQLite integrity and the new backup `/opt/ageoffronts/backups/multiplayer-20261014T222738Z.sqlite` both returned `ok`.

Raw artifacts and adapter source are under `out/oracle-live-a0d27b15/`: `public-smoke-retry.json`, `late-target-a0d27b15.json`, `late-active-a0d27b15.json`, `deployed-live.log`, `pace.json`, and `pipeline/`. The preceding implementation report remains `shared-travel-recomputation-profile-20261014.md`.
