# Sea-trade Oracle follow-up: fixes and local reprofile (2026-10-21)

## Status

The confirmed army-slot corruption mechanism is fixed. The test revision is ready for publication and another isolated Oracle qualification. Routing remains opt-in; production and its revision marker remain unchanged. These local results do not establish that Oracle now meets the owner's greater-than-90-percent pace requirement, nor that the rare long movement waits are resolved.

## Changes

- Army gap closure now treats a vacant casualty slot and replacement of a weak frontline member as separate operations. Filling a casualty gap consumes that gap and does not simultaneously swap an unrelated weak unit. This prevents a later reserve promotion from assigning the same slot index twice. The regression exercises repeated public army updates, production snapshot decoding, and checkpoint restore followed by another update. The validator remains strict. This fixes the reproduced mechanism; the original failing Oracle frames were not retained, so an exact attribution of those two failures remains unproven.
- Trade's general building lookup now treats the supplied authoritative index's absence as final. Array scanning remains available only when a domain fixture supplies no index. The sea-policy callback already followed this rule; ordinary trade lookups now do too.
- Empty couriers skip interception queries: cargo capture could previously only happen when cargo was nonzero, so the discarded query and pure eligibility reads changed no economic outcome.
- Local crossing-tree preparation reuses decoded coordinates when choosing cardinal/diagonal cost, matching the existing resumable-tree implementation. Costs, neighbor ordering, search effort, CPU allowances, memory limits, and scheduling policies are unchanged.

## Local reprofile

Evidence: `out/sea-trade/fixes-controlled-profile/summary.json`, four raw per-tick JSON files and both compiled variants in the same directory. Reproduction helper: `out/sea-trade/runControlledFixProfile.mjs`. Published baseline: `239539d8de94fc69194d887615493557327ce263`; the baseline bundler substitutes that revision's Armies, Trade and HierarchicalPaths sources. All other production sources are common.

The same m75 Migration checkpoint runs with 40 warmup ticks and 800 measured ticks, encoding and decoding a production snapshot every tick. Runs alternate baseline/fixed/baseline/fixed in separate sequential Node processes. These are local x64 all-AI replays, not Oracle, paced multiplayer, or renderer measurements. Compilation, other local activity, GC and JIT variation prevent attributing the entire observed difference to the edits.

| Variant | Mean simulation ms/tick | p95 | p99 | Maximum | Ticks over 125 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 87.302 | 117.099 | 134.132 | 180.163 | 15/800 |
| Fixed 1 | 74.220 | 102.146 | 123.311 | 173.731 | 7/800 |
| Baseline 2 | 78.701 | 105.884 | 127.303 | 201.140 | 9/800 |
| Fixed 2 | 76.601 | 111.078 | 127.738 | 151.407 | 9/800 |

All four final serialized checkpoints have the identical SHA-256 `53dc55d2f601a57abc7cb4e2ba862d36469ad1fd5d99064998cd195eff87c0ac`. Both fixed means are lower, but p95 did not improve in the second pair. Do not promise a particular millisecond saving on Oracle from these results.

A separate current CPU sample (`out/sea-trade/fixes-baseline-cpu`) placed mean routing at 19.962 ms/tick locally before the follow-up edits. It includes CPU sampling and different process conditions and is not a controlled counterpart to the bundled table above.

## Movement investigation and improved evidence

The recorded legacy 61.225-second group response was classified as a short move by the lead squad (4.957 tiles), but two selected members were 130–132 tiles from that destination. The command waited for the entire eight-member admission to finish. This does not establish why those individual searches waited so long.

An approximate 4,500-tick replay of the recorded legacy commands did not reproduce that stall. Original server application times and hold commands were not retained, so the replay uses client-observed ticks plus two ticks for move application and 40 ticks after observed motion for holds. One queued admission was sampled with 32 ticks of observed age; its two far members were waiting for exclusive arena access. This is diagnostic evidence, not an exact replay or a claim that the long-wait issue is fixed. No speculative movement-policy or scheduler change was made.

The next probe retains every submitted movement/hold command and its authoritative server application tick. Once per game second, it records pending human admission phases, member/path/request state, exact-search/corridor phases and workspace occupancy. It records per-tick simulation phase timings while forwarding the production diagnostic callback. The first failing decoded packet per peer is preserved as V8 data with publication metadata. Two-client agreement now includes army metadata. Per-member distance accompanies the lead-distance category.

The existing first-motion metric remains conservative: it requires the whole external receipt to execute and then a decoded displacement over eight fixed units. It may hide earlier motion by a committed cohort; it is not rendered-frame or arrival latency. The new trace does not change that measurement silently.

Each isolated deployment now retains SHA-256 identities for the actual mounted probe bundles and all three production server bundles. Whole-window pace includes observational logging overhead; these are test-only hooks and do not enter production entrypoints.

## Validation

- Full simulation suite: 3,406 passed, seven skipped, one failed assertion, across 469 files. The only failing file is the previously reproduced RussianAssetIntegration truck calibration (expected release y 0.52, actual 0.5390625 at line 42). Vitest's two failed-suite count includes nested suites; there is no second failing file or assertion. Raw report: `out/sea-trade/fixes-full-suite.json`.
- TypeScript passed. Production client and multiplayer builds passed; logs: `out/sea-trade/fixes-client-build.log` and `fixes-multiplayer-build.log`.
- Focused trade/path checks passed 101 tests; the full suite includes the army regression and the existing path/warming/restore tests.
- Scoped ESLint reports three existing, untouched Armies findings. Typed ESLint cannot parse the probe mjs files under the repository's current project-service inclusion rules; a separate JavaScript-recommended check without that unrelated project restriction passes for all four modified probe/analyzer scripts. No lint/config changes or unrelated cleanups were made.
- Analyzer self-tests pass, including wall-time stall counting, strict greater-than-90-percent qualification, retention of unresolved inputs and phase means.
- A real two-client local functional smoke completed 60 wall seconds: 184 matching publications, ten sampled movement orders, no client failures. Application logs, phase timings and nonempty pending-movement traces were verified. This ran alongside the full suite and is not a local or Oracle performance qualification. Evidence: `out/sea-trade/fixes-local-probe-smoke-v2`. An initial 20-second harness incorrectly required a pending-admission trace even when no admission survived to a sample boundary; that harness check was corrected, and its original evidence is preserved.

## Pending Oracle requalification

Use the exact newly published commit on `codex/sea-trade-lanes`, with unique labels m60-lanes-02 (900 seconds), m75-lanes-02 (720 seconds), and m60-legacy-02 (900 seconds). The m75 duration avoids the normal 90-minute match limit. Keep the same saved worlds, two real clients, group sizes 1/4/8, two-CPU isolated container, heap limits and routing budgets. Preserve all previous test artifacts and stopped containers.

Require more than 90 percent of complete nonoverlapping ten-second wall windows to advance at least 79 ticks; also report strict 80-tick windows, sustained speed, failures, input distributions including unresolved samples, and phase distributions. Collect cgroup CPU throttling evidence. Production activity stops only the isolated test. Do not activate the routing default from local results. The owner will judge the input-latency distributions.
