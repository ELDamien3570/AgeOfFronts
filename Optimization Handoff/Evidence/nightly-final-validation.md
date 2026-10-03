# Final local roadmap validation - 3 October 2026

Source commit: `a4145f4230cabe58023bc60d58b835407a111956`.
Branch: `codex/optimization-lifecycle-indexes`.
Runtime build ID: `84de069d3cd1af4ee22349705f63106f6f8f0ab039602573b300022d21578b2a`.
Windows x64, Node 24.18.0, Vitest 4.1.11. The isolated checkout is
`C:/Users/Damien/.codex/worktrees/optimization-roadmap/AgeOfFronts`.

The user requested one complete code pass followed by testing, and deferred P17,
P20, P21, P22 and P25. No test/type/build command ran while that implementation
pass was being written. Final validation exposed integration defects; production
repairs preceded the final clean combined run. No push, merge, deployment,
external stress traffic or default experimental flag change was performed.
Concurrent primary-checkout Art work was not modified.

## Local implementation closed

- P04: Resource geometry and ownership stay separate; completed producer capability buckets and canonical producer-ID views remove repeated paid-job scans.
- P06: Army leader corridors, materialization, formation footprints and member paths use persisted transactional admission; replacement intent leaves old movement intact until the selected cohort passes live checks.
- P07: Formation setup, orientation, stable insertion, occupancy and member selection resume inside deterministic allowances. Selected-input capture and the final atomic live check retain the existing 200-squad cap; Army role preparation retains its authored 20-member cap.
- P08: Shared crossing graphs, stable edge ranking, exact approach/arrival/water searches, subscriber cancellation and connected-land travel-time comparisons persist and yield.
- P09: Boarding stages a real vessel and whole selected shore footprint, validates actual capacity and cargo identity, and commits both sides together. Landing retains physical cargo until the legal whole footprint is admitted.
- P10: Trade enumerates bounded market candidates and admits exact routes before taking source goods; source/port/cargo/generation checks fence the payment boundary, with finite capacity retry.
- P12: Independent metadata revisions omit unchanged research, diplomacy, production controls, events and static headers from deltas; decoder-owned metadata requires a complete baseline and resets on restored source identity.
- P15: Stable connected regions aggregate the existing eight-sector envelope; up to three Modern sections share paid staffing/support/reserves. Owner/ID facts and a capped perimeter bound older construction and repair preparation.
- P16: Research-gated AI Army objectives select a supported leased roster with a mobile reserve and persist rally, assembly, advance, engagement and survivor recovery through normal commands.
- P18: All eleven authored profiles now share explicit economy, role, reserve, assembly, engagement and naval choices. P17 tactical and P20 research-utility acceptance cases remain deferred.
- P19: Dependency DAG quotes aggregate shared inputs once, separate paid incoming and protected stock, retain finite bottleneck reasons and time to output, and resume demand preparation with persisted bounded work.
- P23: Bounded intended-sea ranking includes owned/coastal goods value, local threats, actual ready/researched fleet and queues, and retained casualty/purchase evidence. P21 remote acquisition and P22 cycle-risk acceptance remain deferred.
- P24: Fleet recovery consolidates survivors and honors real paid repair subtasks, seeks an alternative legal same-sea port, and reaches explicit completion/abort with retained evidence and bounded history.
- P26: Strategic transport selects real researched capacity and cargo, retains mobile reserves, acquires escorts, executes normal boarding/sail/unload, returns surviving cargo when conditions collapse, and hands the physical beachhead off once. P25 bombardment acceptance remains deferred.
- P27: Selective operations require live force/role/logistics readiness and wake on relevant territorial/force/diplomacy changes; AI diplomacy has configurable global/proposer/recipient/pair contact limits with human replies preserved.
- P28: New integrated fixtures cover bounded ranking/formation/cohort/crossing, transaction/cancel/restore behavior, Army admission, metadata, production chains, doctrines, readiness and real cargo recovery. Original all-roadmap acceptance remains open while five plans are deferred.

P03/P05/P13 foundation work and supplied P11/P14 were already committed before
this pass and remain integrated. P04/P06-P10/P12/P15-P16/P18-P19/P23-P24/P26-P27
have local implementation and regression evidence; this is not target-capacity
certification or proof of every original plan's broader acceptance case.

## Gates

| Check | Result |
| --- | --- |
| Final combined skirmish suite | **1,075 passed, 164 files**, 331.26 seconds |
| Affected-file repair gate | **69 passed, 9 files**, 48.10 seconds |
| New roadmap/naval/operations/economy focused group | **40 passed**, 7.21 seconds |
| TypeScript | Passed, no errors |
| Skirmish production build | Passed; existing large-chunk/plugin timing warnings |
| Git whitespace check | Passed |
| Scoped Oxlint | Passed on all owned source/test paths |
| Scoped ESLint | One existing error: `Simulation.ts:1038`, unused `tile`; same statement verified in source parent `c80935a` |
| Ordinary local browser observations | Partial P29; see separate report |
| Actual ARM and ten-client mature-world qualification | Not run / not certified |

Final command:

```powershell
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=1 --testTimeout=30000
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts --logLevel warn
git diff --check
```

The 30-second CLI timeout applies to functional tests; no repository timeout
setting or assertion was changed. Exhaustive million-cell terrain and repeated
full-versus-delta replication comparisons exceeded the five-second timeout on
this machine. This adjustment does not establish a gameplay latency target.

[Final combined output](nightly-final-suite-repaired.txt),
[repair output](nightly-final-repairs.txt),
[initial failing output](nightly-final-suite.txt).

## Defects repaired at the final boundary

The first full run had 1,055 passing and 20 failing tests. Eighteen failures
covered movement receipt/restore integration, Modern fronts and the old AI
diplomacy cooldown fixture; two exhaustive checks timed out.

- Formation setup now yields before its selected set is complete. Movement
  ownership/deduplication uses the authoritative pending-by-squad map rather than
  mistaking unprepared formation state for lost control. This preserves repeated
  AI intent, whole-cohort admission, old movement, Shift orders and receipts.
- Connected-region policy now tries the bounded legal sector shortlist instead
  of abandoning a region when its representative touches an invalid map edge.
  Region membership prevents duplicate section purchases within that region.
- The alliance-feed fixture uses the authored declined-pair policy window.
  Reciprocal acceptance and the original logging assertions remain intact.
- The new naval selector now creates its initial assessment before exposing a
  mission at an exact allowance boundary, preventing premature completion.

No terrain production code or data was changed. The terrain and replication
checks pass at adequate timeout and all original functional assertions remain.

## Deterministic fixture scope and retained limits

The new roadmap fixtures use explicit small land/two-coast worlds and normal
paid commands, including seed 47 where simulation fixtures are constructed.
They cover ranking ties and one-work-unit restore, staged formation equivalence,
whole-cohort false commit/cancellation, shared shore continuation, Army route
admission, physical boarding cancellation, mid-shore checkpoint equivalence,
metadata baseline/delta restore, shared production-chain inputs, doctrines/live
readiness/contact windows and surviving physical transport cargo on recovery.
They do not inject largest-map density or synthesize ten live clients.

Planning uses deterministic work allowances, not wall-clock deadlines for
choosing simulation outcomes. Important structural bounds include 200 selected
squads per ordinary admission, 20 authored AI Army/cargo members, 128 route/cohort
jobs, 64 trade market candidates, 32 dependency nodes, eight retained front
sectors and three Modern sections per faction. New shore work shares at most
128 jobs/256 subscribers. AI transport bounds are three transports/four escorts.
The shared exact-route arena retains 128 jobs/65,536 nodes; retries are finite.
These are retained-state limits, not measured RSS/heap/frame/tick guarantees.

## Remaining acceptance

- **Deferred:** P17 land tactics, P20 research/age utility, P21 remote coast,
  P22 complete trade cycle/risk, P25 bombardment. Tests that require those
  behaviors remain open for P18/P23/P26/P28.
- **P02:** mature-world/real-browser/ARM memory and garbage-collection convergence
  remain unqualified; existing local envelope measurements are historical.
- **P29:** [browser observations](nightly-browser-observations.md) verify opening
  grants/visibility, normal paid construction, one-item recruit cancellation and
  final-tier U rejection. Positive one-tier upgrade/production pause, all age/
  tribe cases, multiple producers, reconnect and full visual/performance
  qualification remain open. The marker atlas is unavailable in this worktree.
- **P30:** actual authorized ARM hardware, representative late-game density,
  ten real browsers and joins/leaves have not been measured. No deployment-ready
  or lag/disconnection-free claim follows from the local gate.

Experimental economy, defense, navy, war policy and deferred domain planning
keep their pre-existing opt-in defaults. Production lifecycle/index/replication/
presentation optimizations retain their prior integration posture. New strategic
controllers require the corresponding options. Qualify feature combinations in
ordinary authorized sessions before changing the release defaults.

The source checkpoint is a reviewable local implementation. Release integration
and hardware/client qualification are separate actions. Preserve physical paid
jobs, hulls and cargo when disabling optional controllers; do not delete or
teleport them during rollback.
