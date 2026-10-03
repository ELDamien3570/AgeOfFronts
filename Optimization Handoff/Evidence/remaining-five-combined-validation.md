# Remaining five plans, tuneups and lobby fixes - 3 October 2026

Source commit: `fd34e956513686fc66523ff313d940ad31666b41`.
Branch: `codex/optimization-lifecycle-indexes`.
Runtime build ID: `0e62e61070e7ccb28b3a7217a6a19d98825d650dcdc8c1feac537491b1b48f7d`.
Environment: Windows x64, Node 24.18.0, Vitest 4.1.11.
Workspace: `C:/Users/Damien/.codex/worktrees/optimization-roadmap/AgeOfFronts`.

## Scope completed locally

- P17: exact reachable side/rear flanks with finite fallback; researched siege firing approaches and physical escorts; normal retreat/disband/replenishment/paid refit and one rejoin. Rejoined asset leases extend through the original objective deadline.
- P20: useful legal research chosen from actual resources, attainable chains, force roles, logistics and sea opportunity. Age changes require a paid viable production path. Existing progression/tribe legality and the shared budget ledger remain authoritative.
- P21: useful coast/foreign-market search, available-force acquisition, existing researched physical shore transport, normal occupation, and paid port/factory dependencies. Neutral ownership is never assigned by the planner.
- P22: one cycle quote contract for trade admission and economic/naval opportunity scans, including stock/capacity, settlement payout, handling, certified market legs and return. Risk is a conservative observation of local non-owned traffic, not a guaranteed loss or predicted future enemy.
- P25: legal coastal targets, capable hulls, escort support, exact firing-water certificates, normal sail/attack/reload and withdrawal on loss or observed threat. Combat enforces weapon target tags, range and line of sight.
- `.antigravity/tuneups.md`: issues 1-4 were already implemented and remain covered by the full suite. Issues 5-6 add affordable subset land/vessel refits with exact ordinary payment and completed-asset survival; defeated foundations are removed before territory transfer.
- `.antigravity/lobby-fixes.md`: explicit room presence, immediate empty custom-room removal/FIFO promotion, awaited cleanup across matches, bounded reserved-seat reconnect without pending-command replay, 8 MiB socket buffering threshold, a 15-second baseline application timeout, finite admission protection across the original empty deadline, reserved-seat URLs and navigation teardown. Resize preserves the tactical camera and the toast no longer changes battlefield geometry.

The new strategic route consumer uses the existing fair exact planner. It keeps at most 64 finite route certificates; capacity rejection terminates after four bounded admission attempts. No synchronous search fallback is introduced in these strategic controllers. Coast shortlists retain eight candidates and a finite 6,000-tick objective; bombardment scans at most 64 coastal structures and 24 approach points. Flanks use 12 candidates and siege approaches use 24. Route-cost work streams through existing allowances. Existing manual movement/combat paths retain their own bounded handling.

## Validation cadence and exact results

All five feature implementations and both Antigravity packages were written before the first full suite. The user requested batching, so the exhaustive suite was run once, followed by focused checks of repairs instead of another exhaustive run.

| Check | Result |
| --- | --- |
| Combined full skirmish suite | 1,101 tests / 166 files: **1,090 passed, 11 failed**, 279.35 seconds |
| First affected-file repair run | **130 passed / 12 files**, 25.22 seconds |
| Final affected-file run, including two additional land regressions | **132 passed / 12 files**, 22.62 seconds |
| Final TypeScript | Passed, exit 0, no errors |
| Final production build | Passed, exit 0; existing chunk-size/plugin-timing warnings |
| Final scoped Oxlint | Passed, exit 0 |
| Final scoped ESLint | One pre-existing unused `tile` local in Simulation.ts, now line 1039; no new findings |
| Staged whitespace | Passed |

The final coverage combines 971 unchanged passing cases from the full run with 132 passing cases in the repaired group, totaling **1,103 covered tests**. This is cumulative validation, **not a claim that an exhaustive 1,103-test run was repeated and green on the final commit**.

The initial failures were fixed or migrated to the requested semantics: stale whole-group refit/foundation-survival/home-resurrection expectations; missing starting-camp/tower endpoints in new fixtures; asynchronous Army admission; explicit seat URLs; finite sync cancellation; and fleet recovery membership. Type repairs narrow shared refit input contracts to the data that presentation snapshots actually contain and preserve the concrete type of indexed naval facts. Reconnect commands stay locked across queued status messages until a replacement baseline completes.

Diagnostic logs (line endings and trailing whitespace normalized only): [full suite](remaining-five-vitest.log), [first repairs](remaining-five-repairs-vitest.log), [final regressions](remaining-five-final-regressions.log), [TypeScript](remaining-five-final-typescript.log), [build](remaining-five-final-build.log), [Oxlint](remaining-five-final-oxlint.log), [ESLint](remaining-five-final-eslint.log).

## Qualification limits

Synthetic seed-42 land/coast fixtures, domain conservation/restore tests, transport mocks and DOM/camera checks establish local behavior. They do not certify native Opera, largest-map late-game memory/latency, actual ARM hosting, or ten simultaneous browsers. P02/P29/P30 external qualification remains open.

Experimental AI/economy/naval/deferred-planning defaults remain opt-in. No remote push, merge or deployment was performed. The original checkout and concurrent Art edits were not changed.
