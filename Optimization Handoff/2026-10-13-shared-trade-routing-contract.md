# Shared trade routing contract

Implementation scope: hierarchical preparation, the existing match planner, trade route admission/cache keys, captured-cargo delivery and wait diagnostics. Domain movement, shipment sizing, market pricing and troop control remain authoritative and unchanged.

## Ownership and bounds

- A local cluster tree is prepared by one canonical owner per origin and cluster cost epoch. Concurrent corridors subscribe to it. Shared readiness and incremental heap state are checkpointed; physical cache warmth never grants free logical progress.
- Each navigation medium retains at most 1,024 shared preparation entries. Eviction is deterministic and excludes active subscribers. Trees and heaps are cluster bounded. Route construction, validation and publication still consume the existing 4,096 planner work units and at most 32 preparation units per tick.
- New matches use planner scheduling version 4. Legacy version 1–3 checkpoints retain their prior scheduling/preparation behavior. Shared state is explicitly restored and validated before active corridors resume.
- Interactive commands retain their two-of-three scheduling share. Background loaded trade has a reserved share, with faction/caller round-robin and aging to prevent new empty jobs from starving delivered/returning/captured cargo or vice versa. Queue admission also reserves slots for committed cargo.

## Route reuse and validity

- Water route geometry is keyed by start, goal and water topology epoch, independent of ownership/diplomacy. Every subscriber separately validates actor identity, shipment, receiver ownership and permissions before committing. Pending work is shared only where geometry and traversal constraints agree.
- Land geometry retains its owner/access-policy boundary. Ordinary obstacle changes preserve ongoing plain searches; completed routes are revalidated against the current mask. Actual access/receiver changes still reject stale commitments.
- Capacity is not unreachable. A limited preparation request preserves canonical shared work; bounded retry/alternate-market handling preserves cargo. Unreachable outcomes are reserved for proven geographic/access failure.
- Immutable compressed row/column water intervals are built once with the static topology. They certify two possible axis orders without scanning a long blocked leg during a live tick. A certified cardinal monotone path is copied incrementally under the normal work allowance. Uniform water costs mean it attains the Manhattan lower bound. Other routes use the shared hierarchy.
- Water corridors also reuse up to 128 abstract backbones, capped at 65,536 portal identifiers and 4,096 identifiers per backbone. Endpoints are refined against their own local trees; invalid refinement retires the backbone. This bounded canonical reuse is checkpointed independently of physical caches.
- Limit active background arena searches to 16, reserving four of these against new uncommitted work. The remaining requests retain their identity in the bounded queue. Queue slots and arena concurrency are distinct resources.

## Capture and observability

- A captured naval courier carries a delivery obligation to a reachable completed port belonging to its current owner, even with normal trade paused or no trade technology researched. Cargo is preserved until arrival, recapture or destruction. Arrival pays all remaining cargo at its recorded value once and retires the actor.
- Loaded trade, including the leader of geometry shared with loaded subscribers, is exempt from speculative autonomous quote deadlines. Its paid delivery obligation stays queued under bounded scheduling rather than restarting every 40 ticks.
- No valid owned receiver, source refill, planner queue/capacity and handling waits are distinguishable in actor snapshots and diagnostics. Building a receiver, changing ownership or destroying a receiver re-evaluates the obligation.

## Qualification

- Test shared cold preparation, cancellation of a subscriber, cost invalidation, bounded eviction, malformed state, legacy restore and portable checkpoint continuation with identical results/scheduling.
- Test continuous interactive work plus loaded/new trade across factions, admission saturation and no starvation.
- Test captured cargo with paused trade, absent/disconnected/destroyed ports, recapture, alternate receivers and exact-once full payment.
- Compare the existing 120-route/37-faction long-water workload before/after, including distinct routes, repeated routes, cold restore, latency percentiles, limits, retained memory and deterministic work bounds. The original proposed p95 <= 40 ticks and p99 <= 100 ticks goals are missed in the cold narrow-channel workload (101 ticks for both). The user subsequently accepted about five seconds as the target. The measured maximum is 102 ticks, or 5.10 simulation seconds at 20 Hz; this is a workload result, not a universal worst-case guarantee.
- Run focused and full skirmish tests, TypeScript, production build and diff checks. Local correctness is distinct from Oracle hardware qualification and public deployment. No deployment is authorized by this implementation request.

## Local routing evidence

Measured on the local PC with 120 distinct requests across 37 factions, cold hierarchical preparation, idle preparation lending and committed-cargo priority. The channel map has a single cardinal passage through a vertical barrier. No interactive traffic is present in this latency profile; continuous interactive traffic is tested separately for fairness and progress.

| Workload | Policy | Completed | Limited | Still queued after test | Longest successful route wait |
| --- | --- | ---: | ---: | ---: | ---: |
| Open water | Legacy version 3 | 86 | 8 | 26 at 4,000 ticks | 3,965 ticks |
| Open water | Shared version 4 | 120 | 0 | 0 | 31 ticks / 1.55 seconds |
| Single channel | Legacy version 3 | 68 | 7 | 45 at 4,000 ticks | 3,943 ticks |
| Single channel | Shared version 4 | 120 | 0 | 0 | 102 ticks / 5.10 seconds |

The channel profile retained 584 shared trees (about 3.52 MB of typed tree/heap storage), 15 backbones and 989 backbone identifiers. Its peak search arena used 9,648 of 65,536 slots and peak work was 4,096. Existing physical start-tree storage was about 3.92 MB; these byte counts are not total JavaScript process memory. Isolated planner p95 CPU was 9.18 ms during the concurrent verification run, not a full-match server tick qualification.

The stress fixture now checks the measured 102-tick channel completion bound and validates every returned cardinal step. Cold restore checks portable state transport and identical next-step work/results; bounds, cancellation, forest cost epochs, admission fairness and captured-cargo receiver changes have focused regressions. The existing human automatic equipment target remains 100 kits, with production regression fixtures updated to that approved stock target.

## Verification results

- Full skirmish suite: 335 files / 2,309 tests passed in 502.54 seconds. Expected invalid-operation logs from multiplayer rejection tests were emitted without test failures.
- After the final dynamic-water-mask fence and regression were added, the three affected routing/trade files passed all 79 tests. The earlier six-file routing/production/fairness run passed all 100 tests.
- Final TypeScript check, production skirmish build, scoped oxlint and diff whitespace check passed. The build reports the existing large-chunk warning.
- ESLint passes the routing implementation and new/updated test files. The broader touched-file lint check still reports 18 existing unused-variable errors in Simulation, TraderStream, EmpireView and Trade; those unrelated lines were preserved. The new prefer-const error was corrected.
- These checks establish local correctness and the specified synthetic routing bounds. Oracle full-match tick latency, memory and competing-load qualification remain release work. The changes have not been pushed or deployed.
