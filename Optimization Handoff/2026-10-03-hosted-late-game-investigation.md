# Hosted late-game investigation — October 3, 2026

Status: live triage, 60-minute diagnostic continuation and sequential local ablations complete. A transport lifecycle fix, priority-aware planner reservations and persistent trade route backoff are implemented. ARM comparison and release qualification are recorded below. This is not an unconditional sub-second or long-session multiplayer certification.

## Requested reproduction

Old World, size 1000, 10 AI, 25 tribes, two humans. Multiplayer became very slow after approximately 40 minutes; offline skirmish remained playable. Investigate AI rebuilding under capture pressure and multiple Armies, along with hosted-only costs.

Baseline deployed revision verified through Oracle's revision marker: `4973f7b7865846794bd5c09104199c6ce092e8b7`. One live match was running during passive collection; competing ARM tests were delayed until it ended. Production fixes are listed below.

## Live evidence

Collected existing container diagnostics into `out/overnight-1000/oracle-runtime.jsonl`; extracted coordinator records into `live-summary.json`. There are 257 coordinator diagnostic records and 204 worker records in this capture. Match `match-152` supplies the long-running series. Its exact lobby settings have not been independently recovered from these timing-only records, so do not assert that it is definitively the reported reproduction.

Representative rolling windows, selected by nearest simulation minute:

| Simulation minute | Tick mean / p95, ms | Advance mean / p95, ms | Squads | Buildings | Traders |
| --- | --- | --- | --- | --- | --- |
| 10 | 30.35 / 40.41 | 50.60 / 81.88 | 346 | 522 | 29 |
| 20 | 35.39 / 49.23 | 95.43 / 166.34 | 381 | 647 | 50 |
| 40 | 31.32 / 43.08 | 57.35 / 97.72 | 368 | 939 | 95 |
| 50 | 42.16 / 59.08 | 122.29 / 196.73 | 550 | 1009 | 112 |
| 60 | 50.86 / 62.58 | 204.18 / 270.96 | 637 | 1139 | 117 |
| 80 | 40.52 / 51.96 | 176.24 / 220.65 | 627 | 1338 | 123 |
| 100 | 40.63 / 47.15 | 153.13 / 202.06 | 684 | 1415 | 176 |

These are rolling 256-sample summaries, not percentiles recomputed over each whole game interval. Advance batches contain between one and four ticks; their durations are not per-tick timings.

The worst mean-tick window in the capture, at simulation minute 74.33, measured:

- Tick mean 64.42 ms, p95 179.29 ms, maximum 229.92 ms (50 ms budget).
- Routing mean 24.01 ms, p95 139.03 ms, maximum 191.90 ms.
- Capture mean 9.40 ms; movement 11.78 ms; AI 10.06 ms.
- Worker request queue p95 319.63 ms; advance p95 303.00 ms.
- Snapshot extraction mean 0.23 ms; snapshot assembly mean 11.80 ms.
- Encoding elapsed p95 301.51 ms. This includes asynchronous waiting and contention; it is not compression CPU time.
- GC maximum 44.34 ms in this window. GC alone cannot account for the complete slowdown.

Latest captured progress was 101.10 simulation minutes over 124.48 wall minutes, approximately 81.2% speed. Container CPU was approximately 104.5% (one saturated CPU equivalent on the two-core host); memory approximately 849 MiB. Simulation work remains predominantly serial, so spare aggregate CPU does not imply headroom on its critical thread.

Socket buffered bytes were zero throughout the sampled coordinator records. This supports a simulation/scheduling bottleneck rather than an outbound socket backlog; it does not rule out browser work, network RTT, or packet loss. No rendered-client trace has been collected in this investigation yet.

## Trade routing: strongest measured lead

At worker tick 121449, cumulative exact-planner work totaled 469,204,000 units:

| Caller | Work units | Share |
| --- | --- | --- |
| Trade | 357,320,739 | 76.15% |
| Movement admission | 93,104,051 | 19.84% |
| Navigation | 12,760,365 | 2.72% |
| Ship admission | 4,104,626 | 0.87% |
| Shore | 1,236,956 | 0.26% |
| Army | 677,263 | 0.14% |

Work units are deterministic planner accounting, not measured CPU percentages. Army formation work also appears elsewhere, so the last row cannot establish that Armies are cheap overall.

Trade had 2,171 capacity-limited outcomes and 79 pending jobs. Faction 2 alone accumulated over 330 million trade work units, 2,076 limited outcomes, and 74 pending trade jobs in the latest coordinator sample; its oldest was 2,403 ticks old (120 simulation seconds).

Source findings:

1. `Simulation` correctly excludes domain trade/strategy from the human priority reserve. Autonomous trade is not directly misclassified as player interaction.
2. `RoutePlanner.selectJob` nevertheless allows a capacity-limited search to acquire the entire workspace exclusively. While draining the arena, new allocations wait; while exclusive, normal fair scheduling is bypassed. This is a concrete route for background work to interfere with human latency.
3. `Trade.stepPlanning` allows three limited attempts, then cancels admission and waits 200 ticks. `Trade.begin` subsequently starts a new admission with attempts reset to zero and reconstructs the same preferred candidate list. There is no persistent candidate failure memory across these cycles.
4. Land candidate selection checks terrain connectivity, while the eventual route also restricts traversable territory. A terrain-connected market need not be reachable under those permissions. The caller can repeatedly attempt such a market, expanding a large search.

Recommended first change to measure: persistent bounded failure/backoff by market corridor and access revision, move to another candidate after repeated capacity failure, and prevent background full-arena retries from monopolizing player movement capacity. Do not reinterpret capacity exhaustion as proof that a route is geographically impossible. Reserve/preemptible workspace ownership should preserve that distinction.

## AI construction and recapture

`constructionRejection` validates ownership, terrain, technology/payment, spacing and stack limits. AI placement candidates use this legal-site check but do not evaluate per-site hostile pressure or recent site loss. The economic director samples military losses, not a construction loss history. Capital-centered placement can therefore build on a technically friendly tile about to be captured.

Regular economic decisions are spaced at least 60 ticks per faction. Tribe development can try sixteen sites each strategic pass; this can produce a large rejected-command count without sixteen buildings actually appearing. New building affordability also becomes cheaper when same-type buildings leave the faction's ownership.

Initial local seed-42 observation at 14.5 simulation minutes: 396 additions, 368 building ownership-change events, nine ownership-change events within 30 seconds of addition, and 35,016 build command attempts of which 34,620 were rejected. This seed does not yet reproduce the user's concentrated late-game destruction. Counts include tribe development and all observed domain commands; capture events are not unique destroyed buildings. Exact rejection reasons and per-command CPU are instrumented for the checkpoint comparisons.

Recommended approach: an AI construction policy that requires a defendable site for economic replacement, records recent site/type loss with a cooldown, and budgets accepted construction independently of rejected site probes. Keep this AI planning policy separate from the shared legal-building validator and player controls. Measure immediate loss rate, accepted builds, failed probes and tick cost before choosing limits.

## Armies

`AiArmyPlanner` keeps one objective per faction, but objective release drops leases and the objective without necessarily disbanding its Army. Certain invalidation paths can therefore leave a persistent Army while a subsequent objective creates another. This is a lifecycle hypothesis requiring a targeted reproduction, not proof that every pair of AI Armies is erroneous.

Army deployment sorts remaining members repeatedly while assigning slots and can scan roles repeatedly. Deployment caching reduces this work when anchor/facing stay stable. New cohort connectors and slot planning also consume shared routing capacity. Disabling Armies globally is not supported by the current measurements.

The new latency fixture compares 100 loose squads against two synthetic 50-squad Armies from the same late-game checkpoint. It explicitly unlocks capacity for that fixture, so it is a controlled stress test, not naturally evolved AI gameplay.

## Confirmed transport lifecycle exception

The initial seed-42 run stopped shortly after tick 34200 (28.5 simulation minutes). `AiTransportPlanner.step`, line 530, reads `world.squad(id)!.troops` when computing initial mission strength. A squad in `mission.eligible` had disappeared. Assessment is resumable across ticks, but cargo candidates accumulated earlier are not fully revalidated before grouping and acquiring leases.

The preserved original failure is in `seed42-console.log`. The same exception was not found in the captured Oracle logs; it is not established as the cause of the reported hosted lag.

The driver replayed the original planner from the 20-minute checkpoint and preserved the failure at tick 34651 (28.876 minutes), checkpoint and CPU profile. The diagnostic continuation used a **benchmark-only candidate revalidation prototype**: prune invalid uncommitted cargo/ships during assessment, leaving committed voyages/cargo untouched. This is labelled `filterStaleTransportCandidates` in run configuration. Baseline ablations share that prototype and must not be presented as unmodified production results. The permanent domain fix instead revalidates the complete roster at the commit boundary, including ownership, health, availability, leases and required naval support. Regression coverage includes a dead squad, a captured squad and a lost transport during assessment, plus existing committed-cargo recovery.

## Overnight work and tools

An hourly thread heartbeat named **AgeOfFronts overnight late-game profiling** is active. It should continue this investigation, avoid competing with live Oracle matches, report material findings, and disable itself when the report is complete. The desktop host must remain available for local work.

Original baseline console: `out/overnight-1000/seed42-console.log`. The continuation completed 60 simulation minutes on Old World 1000, two idle human seats, 10 AI and 25 tribes with all five AI flags enabled. It does not replay the two players' real commands, battle history, browser load or networking. Final diagnostic entities: 596 squads, five ships, 675 buildings and 27 traders; last rolling local tick p95 52.56 ms.

Completed sequential driver: `scripts/runOvernightLateGameBenchmarks.mjs`, with `--baseline out/overnight-1000/seed42-filtered --recover-transport-failure`. Ledger: `out/overnight-1000/experiments.jsonl`. It used the 50-minute checkpoint for four-minute comparisons:

1. Baseline.
2. Suppress trade planning, leaving actors present.
3. Disband Armies and suppress new Army planning.
4. Suppress new AI construction.
5. Enable the production snapshot encoding worker/publication queue, without sockets or rendered clients.
6. Compare loose 100-squad movement against two synthetic Armies, four directions each.

These are diagnostic ablations, not proposed production behavior. Subsequent worlds can diverge; inspect entity counts and state changes before claiming causal savings. The worker-encoding run measures replication overhead but is not a complete network/browser benchmark.

`profileSkirmishStability.mjs` now supports `--humans`, `--inspect-churn`, named diagnostic experiments and `--worker-encoding`; checkpoints are saved at 20, 32, 40, 50 and 60 minutes. Army methods have separate bounded timing windows. The original running baseline predates that separate Army timing correction; Army-specific comparisons use the corrected harness.

## Completed local comparisons

All start from the same tick-60000 diagnostic checkpoint and finish at tick 64800. Each variant runs separately. Absolute timings are local x64, not Oracle ARM.

| Variant | Wall seconds | Mean of reported tick means, ms | Final squads / buildings / traders |
| --- | ---: | ---: | --- |
| Baseline | 162.02 | 33.19 | 533 / 634 / 26 |
| No trade planning | 167.79 | 35.06 | 526 / 636 / 26 |
| No Armies | 167.12 | 34.24 | 528 / 637 / 26 |
| No new AI construction | 161.50 | — | 490 / 619 / 25 |
| Production encoding worker | 170.84 | — | 533 / 634 / 26 |

These do not demonstrate general CPU savings from disabling trade or Armies. The construction variant improved wall time by about 0.3%, with a different resulting world. Encoding added about 5.4% elapsed time in this fixture; 1199 publications completed, one startup capture was skipped, pending work ended at zero, compression p95 was 1.58 ms. This does not measure real socket or browser costs.

Baseline construction: 7745 attempts, 7730 rejections, 15 additions, 85 ownership-change events, zero captures within 30 seconds of addition. Build command calls took 37.94 ms total across 4800 ticks. Port/coastal and resource-site validation account for most rejections. AI placement enumeration has additional cost not represented by command-call timing.

Army method rolling means were approximately 0.018 ms step, 0.013 ms planning and 0.010 ms reconciliation. A synthetic 100-squad loose order began moving after 76 ticks in all four directions; two 50-squad Armies began after one tick. This tests first movement, not complete deployment, and explicitly unlocks Army capacity.

CPU samples identify hierarchical path construction, exact planning, simulation/capture loops and spatial queries as useful next optimization targets. Function attribution is reliable; transpiled TypeScript line numbers in profiles are not source line evidence.

## Implemented stability changes

1. **Transport commit validation:** reject stale cargo/hulls before leases, grouping and strength calculation; preserve committed voyages.
2. **Priority-aware arena ownership:** a background full-arena reservation waits while interactive work is pending. An already active background search yields, reclaims its nodes through charged cleanup, and retains a resumable retry without reporting a fabricated route failure. Human priority remains two-thirds of contested normal work. Checkpoint coverage includes both waiting and active reservations.
3. **Trade failure memory:** bounded 512-entry corridor/access-revision backoff persists across admissions and restore. Limited/unreachable outcomes move to another market and retry that corridor after 20, 40, 80, 160, then up to 300 seconds. Capacity limitation remains unknown, not proof of impossibility. Trade no longer receives autonomous exclusive retries. Successful routes clear failures; merchants share failures discovered after their admission was created. Goods are loaded only after a valid route is available.
4. **Hierarchical hot loop:** reuse already decoded tile coordinates for local-cluster indexing, preserving the weighted search result.

An initial candidate prohibited exclusive retries for every background route. It improved first player movement but raised AI limited outcomes from 19 to 2844 in the short ARM fixture without meaningful aggregate CPU savings. That policy was rejected. The final candidate preserves AI large-route retries and makes reservations yield to interactive work.

Final local 30-squad fixture: first movement after two ticks in four directions (95–186 ms wall). A follow-through trial admitted all 30 and executed the command after 12 ticks, 600.76 ms wall; first movement was 191.93 ms in that run. These are synchronous simulation fixtures, excluding pointer gesture delay, network travel, publication and rendering.

## Validation and remaining work

### Final ARM replay and latency comparison

Oracle's two-core ARM host, isolated read-only containers limited to two CPUs and 2 GiB, no external networking. Both replays start at the same tick-60000 checkpoint and end at tick 62400 (two simulation minutes), with snapshot extraction enabled. Stable uses the labelled transport prototype; candidate uses the permanent domain fix. The host was idle and the harness aborts if a production match appears.

| Metric | Baseline | Priority-aware candidate |
| --- | ---: | ---: |
| Replay wall seconds | 126.71 | 120.38 |
| Last rolling tick mean, ms | 47.67 | 49.40 |
| Last rolling tick p95, ms | 66.35 | 65.70 |
| Last rolling tick maximum, ms | 127.34 | 131.23 |
| Completed routes | 1848 | 2496 |
| Capacity-limited outcomes | 19 | 6 |
| Admission-deferred events | 70455 | 40766 |
| Final squads / buildings / traders | 518 / 631 / 26 | 515 / 631 / 26 |

Approximately 5.0% less replay wall time is an observation from one short comparison, not a universal throughput gain. Final rolling means differ from whole-replay timing and the resulting worlds diverge. Candidate tick p95 still exceeds 50 ms. A higher oldest-pending age (240 versus 105 ticks) means fairness improvements do not establish every autonomous job has prompt completion.

Four-direction 30-squad ARM command fixture: baseline first movement **76 ticks**, 3375–4564 ms wall; candidate **two ticks**, 149–334 ms wall. Receipts are still deferred at first movement because follower admission continues. These fixture times exclude actual network, pointer gesture and rendered-client presentation. The local follow-through result above measures all-member command execution separately.

Artifacts: `out/overnight-1000/oracle-baseline`, `oracle-preemptive`, `oracle-latency-baseline.json`, `oracle-latency-preemptive.json`. An intermediate candidate and latency run overlapped; they are excluded from final comparison claims. Final runs above were sequential.

Final TypeScript check, build and broad suite passed **1220/1220 tests**. The final reservation refinement has targeted regressions for active preemption, waiting reservations and checkpoint continuation.

The broad suite before the final reservation refinement passed 1219/1219. Final release results and ARM metrics are appended after completion. The initial two-client local Old World 1000 Modern smoke passed movement for both players, construction, all five AI defaults, trade controls, rejected command handling, reconnect and canonical-state equality. All ten regular AI moved. It ran 90 monitoring seconds, not 40 minutes; publication gap p95 was 253 ms, with no failures. It preceded the last priority-aware refinement and is not the final release gate.

Remaining bottlenecks: serial tick CPU, hierarchical preprocessing/query duplication, movement/capture spatial work, asynchronous worker contention and full rendered-client latency. The user's rebuilding-under-invasion history is not reproduced by the current seed. A separate focused review covers AI recovery, island trade, combat spacing, selection limits and progression. No global Army removal, AI gameplay disablement, tick-rate reduction or networking rewrite was made on unsupported evidence.

Release qualification must explicitly distinguish the short idle-only ARM replay and WSS smoke from a 60–90-minute rendered two-human battle. Keep one simultaneous Oracle match and continue meaningful follow-up diagnostics while preserving live players.

### Extended hosted qualification

`runHostedStabilitySoak.mjs` starts a separate coordinator, real match worker and encoding/publication pipeline, then two WebSocket clients on Old World 1000 with 10 AI and 25 tribes. It starts in Modern age to stress later unlocked systems and issues periodic human movement orders, records input-to-observed-state movement, checks canonical agreement and reconnects. This is a protocol soak, not rendered browser testing or a replay of the user's game. The Oracle mode is isolated and automatically stops if a live production match starts. Long-soak results must be reviewed before claiming the networking issues resolved or deploying under that qualification condition.

Final local short smoke passed with this harness: both humans and all ten AI moved, construction and trade controls replicated, rejection and reconnect worked, 24 common canonical state samples agreed. Two periodic orders reached observed movement in 123 and 129 ms; publication gap p95 was 255 ms. This is only a 40-second monitoring check, useful for validating the soak tool rather than proving long-session behavior.

Oracle long soak label: `overnight-hosted-soak`; remote output `/home/ubuntu/perf-v11/results/overnight-hosted-soak`, console sibling `overnight-hosted-soak-console.log`. Duration 2400 monitoring seconds. Production remains on the baseline revision until the soak and deployment gates are reviewed. Do not deploy while this isolated benchmark is running.

The soak completed successfully and its container exited before deployment started. Collected evidence: `out/overnight-1000/oracle-hosted-soak/smoke.json` and `server.log`.

- 2422.90 wall seconds including setup; final client tick 48168 (40.14 simulation minutes).
- 158 periodic movement orders: input-to-observed-state first motion p95 **329 ms**, maximum **381 ms**.
- Both clients advanced and reconnected successfully; 300 retained common state samples agreed; no recorded smoke errors.
- Publication gap p95 222/223 ms, maximum 513/515 ms; client decode p95 6.62/9.53 ms.
- Last diagnostic progress ratio **0.999924**; last tick mean 17.36 ms and p95 28.94 ms.
- Largest reported rolling tick p95 across the soak: 34.08 ms. Largest sampled tick maximum: 114.77 ms. Worker queue p95 stayed at or below 0.0111 ms; sampled socket buffered bytes stayed zero.
- Final diagnostic world: **133 squads, eight ships, 148 buildings and eight traders**. This is much smaller than the captured heavy production match and the 50-minute replay. The soak establishes sustained protocol stability and responsive ordinary orders for this controlled scenario; it does **not** certify a 600-squad/1400-building battle, large formations or rendered browser behavior.

Deployment qualification: the tested stability revision can be released as a measured improvement, with the heavy-world tick-budget limitation explicitly retained. No claim is made that all late-game networking or CPU problems are solved. Release started only after production `activeMatches: 0`; public verification is recorded below.

## Oracle release and public verification

Deployed exact gameplay revision **`20a6a78fd669edeadf2aaa3b5baa71d84508178a`**, published on `V1.1.5` and `V1.1-`. Build-first release succeeded after its idle check. Application image and revision marker match the tested commit; application health is healthy and proxy is running. The public browser bundle `assets/home-ySgpYPJ6.js` identifies the same source revision. Runtime identity **`fd59c1a64d82793c8564da80e787bcdbbfd50cbb3b87182fee6672c4a792a4a9`** matches the isolated candidate soak.

SQLite release backup: `/opt/ageoffronts/backups/multiplayer-20261003T232805Z.sqlite`; `PRAGMA integrity_check` returned `ok`. Previous revision marker preserved for rollback.

Public HTTPS/WSS two-client smoke passed on Valles Kairulia 500, Modern, 10 AI and 25 tribes: movement, construction, all five AI defaults, trade controls, rejection, water embarkation, automatic shore landing, inland continuation, reconnect and 55 common canonical state samples. Periodic movement p95 was 226 ms (two samples only). Publication gap p95 216–217 ms, maximum 452 ms. No recorded failures. Artifact: `out/overnight-1000/public-release-smoke.json`; owned smoke match `match-154` is allowed to expire through the normal empty-match grace period.

The overnight follow-up remains active for one heavier capacity diagnostic: replay the original 50-minute checkpoint through minute 60 on ARM with the production encoding worker/publication queue enabled. This isolates CPU and replication costs in the denser world; it does not add rendered clients or reproduce actual player battle history. Label `overnight-heavy-encoding`, idle-only and abort-on-live-match as before. No second gameplay pass is implemented.

## Heavier 50–60-minute ARM encoding replay

Completed tick 72000 in **633.61 wall seconds** for 600 simulation seconds of work (about 94.7% of real-time throughput when run without pacing). Final world: 566 squads, five ships, 655 buildings and 28 traders. This fixture retains the original Stone/Bronze progression instead of starting in Modern.

Last rolling tick mean **57.30 ms**, p95 **80.29 ms**, maximum 134.60 ms. Worst reported rolling p95 across the run: **102.69 ms**. Last phase means: routing 20.63 ms, movement 11.32 ms, capture 8.92 ms. Planner ended with 49 pending routes, oldest 36 ticks; 11083 completed, 21 capacity-limited and 15913 superseded. New route creation/cancellation and tactical churn remain significant even after starvation is fixed.

All **3000** offered publications completed: zero skipped, zero pending at exit, 45.62 MB encoded output. Last encoder compression p95 7.70 ms. This rules out a persistent encoding backlog in this replay but excludes actual sockets/browser rendering. It does not establish the encoding worker is free of CPU contention.

CPU self samples over this replay: anonymous simulation frames 101.91 s, `eachInRadius` 60.05 s, GC 31.87 s, exact `PlanningWorkspace.step` 29.60 s, `canCaptureTile` 19.99 s and swept fortification checks 18.81 s. These are sampled function attribution, not subsystem-inclusive totals. They support targeting repeated capture-area geometry and collision queries alongside routing, rather than treating every symptom as a network issue.

A focused radial scan candidate hoists map bounds and enumerates precomputed disk row spans. It preserves row-major tile order, clipping and walkability. Tests compare against a whole-map geometric oracle, including edges and radii beyond the precomputed range. The controlled A/B/B/A harness restores the same 50-minute checkpoint, uses the original loop for its legacy mode, and compares full canonical snapshot hashes after 400 ticks. Local and ARM hashes match in all four trials. No capture rules, friendly collision behavior or troop limits are changed by this optimization.

### Radial scan result

ARM A/B/B/A completed with the **same canonical snapshot hash in all four trials**. Original capture means: 7.825 and 7.698 ms; candidate: 7.687 and 7.540 ms. Mean capture cost fell approximately **1.9%**. Mean overall elapsed time fell approximately **4.0%**, but startup/JIT/order effects contribute: the warm original versus warm candidate pair differs by about 2.2%. Local capture means improved only about 1.9% as well. This is a modest hot-loop improvement, not a cure for the heavy-world 80 ms tick p95.

The change is retained because it removes repeated work while preserving exact authoritative behavior, not because the short wall-time difference proves a universal speedup. Artifacts: `radius-comparison.json`, `radius-comparison-arm.json`, and `scripts/profileRadiusScan.mjs`. Final TypeScript, build and broad release suite passed **1221/1221 tests**.

## Final bottleneck assessment and next focused work

1. **Interactive latency:** the confirmed planner reservation starvation is fixed and measured. Full large-order transport/deployment and rendered browser latency still need the separate movement pass; a first moving leader is not proof all followers are ready.
2. **Serial routing:** approximately 20.6 ms mean in the final dense window. Measure duplicate route preparation, corridor/connector reuse and invalidation/supersession before increasing budgets. Raising work per tick can make commands queue less while slowing the simulation further.
3. **Movement and obstacle geometry:** approximately 11.3 ms mean movement in that window, with swept fortification checks in CPU samples. Reuse local broad-phase candidates and pure geometry under obstacle revisions; preserve enemy blocking. Do not solve this by globally disabling collision or AI Armies.
4. **Capture:** approximately 8.9 ms mean. The radial loop improvement removes a small amount of repeated geometry. Next measure repeated defensive-building and barrier-ray checks within the same capture footprint, and consider a revisioned per-owner/tile exclusion projection. Invalidate it on construction, destruction, capture and diplomacy changes; a stale cache would alter conquest rules.
5. **Replication/network:** no persistent publication backlog in the dense replay, no buffered-socket accumulation in captured diagnostics, and responsive WSS movement in the lighter 40-minute soak. Browser main-thread work, actual RTT and player-driven world growth remain unqualified. The game cannot yet claim universally sub-second late-game inputs.
6. **AI behavior:** concentrated rebuild/recapture spam is plausible from the legal-site policy but was not reproduced by this seed. Army disabling did not help the matched CPU fixture. Island investment, productive trade targets, recovery/stragglers and combat spacing remain the separate requested design pass; its deliverables are documented, not silently implemented here.

One simultaneous match remains the supported Oracle admission setting. Faster single-core CPU can provide headroom; increasing core count alone does not eliminate the serial tick bottleneck. Prefer the measured focused passes above before declaring public-consumption readiness for the largest battles.

## Final release acceptance

Final deployed gameplay revision: **`3f99dbdd0a020a35fc8cd1426caa3264bd47c6b1`** on `V1.1.5`, including the previous stability changes and the state-equivalent radial scan. TypeScript, build and **1221/1221** tests passed. Application container is healthy; proxy is running. Public `assets/home-DT9rrk0a.js`, the image tag, application `GIT_COMMIT` and revision marker identify the tested commit.

Final runtime identity: `5f5f55264eefa9999bbbd13f0cca007204cdf4f027f79b1bc520c1037dacc8f7`. Final public two-client WSS smoke passed movement, construction, all ten regular AI moving, five policy defaults, trade controls, rejection, water embarkation, automatic shore landing/inland continuation, reconnect and 25 common canonical state samples. Two periodic commands started in observed state after 311/314 ms; publication gap p95 was 216/219 ms. No recorded failures. Artifact: `out/overnight-1000/public-radius-smoke.json`.

Final SQLite backup `/opt/ageoffronts/backups/multiplayer-20261004T003713Z.sqlite` passed integrity checking. The previous release marker preserves `20a6a78` for rollback. Smoke match `match-156` expired through the normal grace period; no match was forcibly stopped. Final public health returned `status: ok`, `activeMatches: 0`, with no running, stalled or preparing matches.

The profiling investigation and separate eleven-item review are complete. Final idle health is verified; the hourly follow-up is disabled to avoid redundant tests or releases. The next gameplay passes remain review deliverables awaiting the user's next direction, not unreported implementation.

## Authorized follow-up: permission and capture query reuse

The user's next direction authorized two measured read optimizations before the eleven-item gameplay work. See [the 2026-10-04 comparison and release-candidate report](2026-10-04-query-reuse-performance.md). The final matched ARM comparison preserves canonical snapshot hashes and planner outcomes in all eight trials, reduces processing elapsed about 7%, and reduces mean trial tick p95 about 5%. Dense tick p95 remains above the 50 ms budget. This follow-up prepares a candidate; it does not replace the deployed revision recorded above.
