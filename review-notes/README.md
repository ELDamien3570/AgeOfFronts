# Code review notes — 2026-10-15/16

Read-only review of the Age of Fronts skirmish codebase (branch `1.5.7-10hz-prototype`,
working tree including uncommitted changes). No source files were modified during this
review. Produced in two multi-agent rounds: area reviewers each wrote one notes file, every
suspected bug/perf/security finding was checked by two adversarial verifiers (a third broke
ties), a completeness critic drove round 2, and the summary was rewritten against the
verified ledgers.

Round 1 read the tree as of 2026-10-15 ~19:40; round 2 (Opus 5.5 agents) read it as of
2026-10-16 ~02:00-03:00; round 3 read HEAD 0d1783ce "pre-ultra" plus the ranged-preparation delta (~06:00). The tree kept changing during both rounds (new cavalry assault,
carrier/drone/airbase work), so where a round-1 note and a round-2 note disagree, round 2
and the ledgers win. `09-working-tree-delta.md` holds a citation remap for drifted lines.

| File | Area |
| --- | --- |
| 00-summary.md | Consolidated verdict, answers to the owner's questions, roadmap with exit criteria |
| 08-latent-bugs.md | Round-1 verified bug ledger (confirmed / refuted) |
| 08e-round2-ledger.md | Round-2 verified bug ledger (confirmed / refuted) |
| 01-structure.md | Overall architecture and code organisation |
| 02-network.md | Replication pipeline, wire format, bandwidth, latency |
| 02b-server-lifecycle.md | Coordinator, lobby, match lifecycle, failure handling |
| 03-combat.md | Battle model, melee/ranged/charge, proposed improvements |
| 04-ai.md | Strategic AI, tribes, diplomacy; first pop-up design sketch |
| 04b-ai-economy-naval.md | Economic, research, placement, trade and naval AI |
| 05-balance-economy.md | Unit/economy/tech balance model, exploits, numeric proposals |
| 06-simulation-perf.md | Tick loop, movement, pathfinding, spatial indexes, perf at 52 factions |
| 07-client.md | Renderer, HUD, decode worker, RTS usability |
| 08a-sweep-simulation.md | Raw sweep of Simulation.ts |
| 08b-sweep-ownership.md | Raw sweep of ownership, territory, elimination, trade lifecycles |
| 08c-sweep-determinism.md | Raw sweep of determinism, checkpoint completeness, 8 Hz remnants |
| 08d-sweep-working-tree.md | PR-style review of the uncommitted working tree (as of round 1) |
| 09-working-tree-delta.md | Post-round-1 delta (CavalryAssault, airfield transfer, cavalryMode) and citation remap |
| 10-test-baseline.md | Authoritative HEAD vs working-tree test results, RiverExpansion trace, green-tree plan |
| 11-map-generation.md | Procedural map generation: cross-engine determinism, cost, fairness |
| 12-air-strategic.md | Aircraft, airfields, missiles, nuclear: model, balance, AI, perf |
| 13-gameplay-design.md | Gameplay design review against Rise of Nations; playtest blockers |
| 14-popup-factions-spec.md | Buildable spec for nomads (per the owner's PLAN.md), pirates, other pop-ups |
| 15-ai-tactics.md | AI battle-level tactics measured against a naive policy |
| 16-load-test-8-humans.md | Measured 8-active-human load at 52 factions (sim, queues, bandwidth, client) |
| 17-client-unread.md | Remaining client files and a real-browser renderer measurement |
| 18-command-fuzzing.md | Schema-valid command fuzzer results and exception-containment design |
| 19-movement-core.md | HierarchicalPaths, formation core, route-cache memory measurement |
| 20-naval.md | Naval combat model, per-age naval balance matrix, pirate counterplay |
| 21-ranged-preparation-delta.md | Round 3: the ranged-preparation delta that appeared after HEAD 0d1783ce, test results, citation remap |
| 22-idle-tick-and-heap.md | Round 3: where the idle 52-faction tick goes, per-squad costs, heap with human seats |

Raw sweep files (08a-08d) contain unverified suspicions; the ledgers are the verified view
and take precedence where they disagree. Reviewer scratch scripts and harnesses live outside
the repository (session scratchpad) and were not committed.
