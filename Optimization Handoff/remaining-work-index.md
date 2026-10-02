# Remaining work index

Each numbered file is a separate local-agent task with ownership, dependencies,
implementation slices, tests and rollback. Completed features are summarized in
`handoff.md`; these plans intentionally retain unfinished acceptance rather
than marking foundations complete merely because their files exist.

## Suggested scheduling

- First independent wave: P01 diagnostics, P02 measurement preparation, P03 lifecycle design, P11 planner fairness and P14 browser profiling. P02 final measurements depend on P01
- Foundational routing/index wave: P04–P10 and P12. Serialize shared Simulation/Expansion changes; P07/P08 precede dependent Army/shore work
- Replication/browser wave: P13/P14 can proceed independently once their stated contracts are available
- Strategic wave: P15–P27 follow their explicit dependencies. Land/economy/navy agents share interfaces through the integrator rather than editing each other's live modules
- Final qualification: P28, P29, P30. Never enable the combined experimental workload before individual feature gates

The dependency graph in the plans, rather than numeric order alone, is the
execution order. Every dependent phase starts only after its prerequisite tests,
TypeScript and build pass.

## Task files

- [P01 Complete production-path diagnostics](Plans/01-runtime-diagnostics.md)
- [P02 Qualify consumer limits and transient memory](Plans/02-consumer-memory-limits.md)
- [P03 Maintain entity and ownership indexes](Plans/03-entity-lifecycle-indexes.md)
- [P04 Separate resource geometry and producer revisions](Plans/04-resource-producer-revisions.md)
- [P05 Bound local combat and defensive queries](Plans/05-combat-spatial-queries.md)
- [P06 Make Army routes transactional and resumable](Plans/06-army-route-admission.md)
- [P07 Resume formation setup and clearance](Plans/07-formation-clearance-budgeting.md)
- [P08 Resume shared shore and crossing searches](Plans/08-shore-crossing-planning.md)
- [P09 Complete boarding and landing admission](Plans/09-boarding-landing-admission.md)
- [P10 Make trade routing resumable and transactional](Plans/10-trade-route-admission.md)
- [P11 Guarantee limited-search progress and fairness](Plans/11-planner-progress-fairness.md)
- [P12 Extend dirty replication beyond terrain](Plans/12-entity-replication-journal.md)
- [P13 Cache coherent recovery and join baselines](Plans/13-recovery-baseline-cache.md)
- [P14 Reduce remaining browser presentation work](Plans/14-browser-rendering-budget.md)
- [P15 Finish broader defensive-region policy](Plans/15-defense-connected-fronts.md)
- [P16 Create researched coordinated AI Armies](Plans/16-researched-army-coordination.md)
- [P17 Complete flank, breach, escort and recovery](Plans/17-land-tactical-operations.md)
- [P18 Make all eleven AI doctrines operational](Plans/18-eleven-personality-doctrines.md)
- [P19 Complete dependency, bottleneck and utility decisions](Plans/19-economic-dependencies.md)
- [P20 Select useful research and age advances](Plans/20-research-age-utility.md)
- [P21 Plan reachable remote coast acquisition](Plans/21-remote-coast-acquisition.md)
- [P22 Share complete trade cycle and risk quotes](Plans/22-trade-cycle-risk-quotes.md)
- [P23 Rank naval theaters and fund intended-sea purchases](Plans/23-naval-theaters-evidence.md)
- [P24 Finish persistent fleet recovery and completion](Plans/24-naval-recovery-completion.md)
- [P25 Add supported coastal bombardment](Plans/25-naval-bombardment.md)
- [P26 Complete escorted naval transport and beachheads](Plans/26-naval-transport-handoff.md)
- [P27 Complete selective operations and diplomacy quotas](Plans/27-operations-diplomacy-completion.md)
- [P28 Qualify deterministic integrated outcomes](Plans/28-deterministic-integration.md)
- [P29 Verify real-browser tuneups and presentation](Plans/29-browser-tuneup-acceptance.md)
- [P30 Qualify the requested capacity and release boundary](Plans/30-target-capacity-release.md)

## Coverage of the supplied inputs

- Reliability: P01–P05, P11–P14 and P28–P30 cover full stage diagnostics, consumer/heap evidence, immutable/dynamic facts, worker/browser pipeline and external qualification
- Complete bounded planning: P06 Army admission; P07 formation setup/clearance; P08 shared shore/crossing rankings; P09 boarding/landing/capacity; P10 trade; P11 limits/fairness/progress. Ordinary queued legs and sails are already implemented, but these wider lifecycles are not
- Original AI: P15 broader connected fronts/bounded older child work; P16 researched Armies; P17 push/flank/breach/escort/recovery; P18 all eleven doctrines. The single-sector Modern section and terrain-aware city enclosure slices are completed
- Economy: P19 dependencies/bottlenecks/viability; P20 research/age; P21 remote coast; P22 complete shared trade cycle/risk; P23 intended-sea purchasing
- Navy: P23 threatened-sea ranking/casualty/value funding; P24 persistent recovery/complete; P25 coastal bombardment; P26 escorted cargo, actual capacity, boarding/landing and beachhead handoff
- Architecture AI policy: P27 remaining sleep/readiness/contact quotas, with current human mechanics preserved
- Tuneups: domain/UI code and automated tests are complete. P29 performs the still-unverified real-browser acceptance, including all-age opening and tribe checks with the final first-node research choice
- Largest map / 14 AI / 30 tribes / at least 10 humans: P28 supplies legitimate bounded correctness scenarios; P29 browser evidence; P30 actual authorized hardware/client capacity evidence. This remains a target, not a result
- Concurrent artwork: intentionally outside all tasks. Preserve existing remote Art files; the user will implement that work later
