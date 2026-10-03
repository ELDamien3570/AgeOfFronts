# Multiplayer stability investigation — 3 October 2026

## Scope and implementation

Playtest report: 500 Valles Kairulia, ten regular AI, 25 tribes, Opera and Chrome, severe slowdown around 20–30 minutes and a stall around 32 minutes. The Opera symptom was a battlefield flash/jump while the match continued.

- Normal solo and online game creation enables `aiEconomy`, `deferredPlanning`, `aiDefenses`, `aiNaval` and `aiWarPolicy` through one shared default. Explicit historical simulation options remain compatible.
- Defensive structures (tower, trench, gun nest and missile defence) no longer sustain a regular AI after its forces and other completed buildings are gone. Walls never sustain a faction. Human survival rules are preserved.
- Human automatic refined-metal and troop-equipment targets scale with active automatic workshops. Thirty factories now target 1,800 refined materials instead of a flat 60; thirty smiths target 90 troop equipment instead of a flat 12, with incoming production counted. Actual recipes, production times, payment and explicit manual orders are preserved.
- Research selection retains a usable progression candidate, evaluates competing branch nodes, and avoids reserve-starved recruitment blocking affordable research from unreserved gold. Advancement evaluates a usable resource/producer chain without requiring the entire future economy's gold upfront. Distant idle foreign garrisons no longer permanently suppress economic research.
- Alliance expiry warnings appear at the top middle during the last 30 seconds, with authoritative Renew and local Dismiss actions. Renewal still requires both allies. Keyed cards preserve focus.
- Placement preview retains visible chunks across ordinary and full ownership snapshots. Local ownership/building changes invalidate affected cells; distant construction no longer repeatedly clears the visible grid. Invalid placement clicks retain the selected building and show the rejection.
- Deferred transport and army movement no longer call the legacy synchronous shoreline shortcut search. Connected land orders retain their land fallback when a bounded optional transport quote is limited. Large search cleanup reuses one iterator within each charged release slice instead of repeatedly traversing deleted map prefixes. Release order, budgets and checkpoint format are unchanged.
- Oracle diagnostics now report the build's source revision.

Rules remain in the domain, renewal choices in the view model, and DOM handling in its view component. Route cleanup retains its existing deterministic budget and domain ownership.

## Root cause evidence

Captured production match 102 at tick 41,259 (34.38 simulated minutes) had 481 squads, 103 ships, 1,719 buildings and 263 traders. Routing p95 was **3,471.63 ms**, whole-tick p95 **3,523.79 ms**, and snapshot encoding queue wait p95 about **6,495 ms**. Actual packing/compression took tens of milliseconds. The deferred planner had no jobs or completions because its default was off.

A local legacy-policy reproduction reached multi-second routing delays by about thirteen simulated minutes. Its CPU profile identified repeated exact land searches inside `ShoreRoutes.between` / legacy transport shortcut assessment, plus topology neighbor generation and priority-queue work. This explains the server starvation and delayed publications; it is stronger evidence than assuming the lag was only rendering or compression.

The material/equipment plateaus were automatic stock thresholds, not a resource integer cap. Completed/queued stock around 60 refined metal and 12 troop kits prevented dozens of workshops from scheduling more work. A real production-step regression starts at 66 materials and 14 kits with thirty factories/smiths, advances recipe time and debits inputs, and verifies more than 1,000 refined materials and at least 80 kits after 120 seconds.

## Profiling and limits

The reusable `scripts/profileSkirmishStability.mjs` records configuration, phase windows, entity counts, memory, planner diagnostics, native checkpoints and CPU profiles. Profiling checkpoints use Node's native V8 format because internal AI checkpoint scores may contain Infinity; the network codec's nonfinite-value rejection remains intact.

Local all-policy play reached 35 simulated minutes without the legacy stall. A checkpoint from that game at 20 minutes was replayed on Oracle ARM in an isolated container with no networking, one CPU and a 3 GB limit through **38 minutes**. Final sample: 453 squads, one ship, 427 buildings, 24 traders; routing p95 **0.783 ms**, tick p95 **17.256 ms**, no winner/time-limit stop. Nine regular AI reached Bronze Age; the remaining faction had only 29 owned tiles. The workload differs from the historical stalled match, especially in naval/industry counts: these are observed samples, not an identical-composition speedup claim.

A normal two-CPU replay from the identical 32-minute checkpoint through 38 minutes finished in 95.67 seconds; final routing p95 **0.709 ms**, tick p95 **14.833 ms**, tick maximum **27.727 ms**. A periodic window still reached about 96 ms routing p95 without cgroup throttling. The first traversal-cache experiment did not improve that spike and was removed. CPU profiling then isolated repeated iteration during large search-workspace reclamation. With one iterator per release slice, the identical tick-43,200 window improved from routing p95 **96.082 ms** / tick p95 **108.353 ms** to **5.382 ms** / **18.506 ms**. The final replay reached tick 45,600 in 93.034 seconds with routing p95 **0.719 ms**, tick p95 **16.661 ms** and the same final entity counts.

Early built-candidate browser review in the in-app Chromium browser ran Modern 500 Valles Kairulia with ten AI through about 14.5 simulated minutes: recent frame p95 1.2 ms, presentation 1.3 ms, HUD 5.7 ms, JS heap about 67 MB. Invalid placement preserved the URL, canvas size/position and placement mode, with a rejection notification. This is browser evidence, not native Opera certification.

Raw local artifacts are retained in `data/investigation-20261003/` (not published). Production logs are captured separately from isolated profiler results. The original stalled match no longer supplied a recoverable complete authoritative checkpoint, so its full entity composition was not replayed exactly.

## Validation

The full skirmish run covered **1,118 tests in 168 files**, with 1,097 passing initially. Three failures revealed/corrected an extra legacy army shortcut call and new fixture setup errors. The other eighteen were map-heavy five-second timeouts under concurrent profiling load. Affected groups were rechecked with limited concurrency and appropriate timeouts; all originally failing tests subsequently passed. This is one full run plus focused repairs, not a second exhaustive all-green run.

Final TypeScript and production build pass. Scoped Oxlint and whitespace checks pass. The final planner/capacity/checkpoint tests (8), war-policy/fairness tests (13), and previously affected routing/holdout tests (33) pass. TypeScript and build were rerun after the reclamation change. Tests cover AI holdouts, actual scaled production, retained grid ownership invalidation, progression under reserve starvation, alliance timing/actions/focus, armies and transport scheduling.

## Release verification

Release and public authenticated multiplayer smoke results will be appended after deploying the tested source. The smoke harness `scripts/smokeOracleStability.mjs` uses ten separately authenticated WebSocket peers, independent canonical decoders, acknowledgements, rejected-action receipts, common-tick state hashes and reconnect recovery. It requires explicit `--public` for external hosts and refuses to start when another match is active.

P02 largest-world memory, P29 native-browser qualification and P30 ten-rendering-browser/concurrent-match capacity remain distinct acceptance items. Ten protocol peers do not satisfy ten-browser rendering acceptance.
