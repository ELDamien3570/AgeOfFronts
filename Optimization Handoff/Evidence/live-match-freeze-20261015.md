# Live match-269 freeze and blast-edge ownership — 2026-10-15

The deployed e63a07300051bd8722fc7f822f8e6ea6286a9370 build stopped match-269 at 00:28:43 EDT (04:28:43 UTC). Docker logged:

~~~text
Match executor operation failed advance TypeError: Cannot read properties of undefined (reading 'completed')
at Trade.cargoEffects (Trade.ts:909:53)
at Trade.capacity (Trade.ts:921:26)
at Trade.siteSnapshot (Trade.ts:1022)
at Expansion.snapshot
at Skirmish.replicationSource
~~~

The coordinator container remained running, with restart count zero and OOMKilled=false. Investigation began after the match worker had already been released; no restart, match termination or production patch was performed during investigation. The last sampled tick was 29791 at 2026-10-15T04:28:35.297279263Z, with 180 squads, 133 ships and 825 buildings. Mean rolling tick time was 42.72 ms. The immediately preceding sampled intervals advanced at roughly 1x; whole-match cumulative pace was 0.9276x. Sustained CPU overload did not cause this termination.

Trade sites cached mutable building references. When end-of-tick capture/elimination changed a source's owner to neutral, publication reused the old site and dereferenced progression state for owner zero. Capturing one member of a stack also incorrectly published the entire old stack under its new owner. Regression tests reproduced both defects before the fix.

The fix factors a current owner-market read view from the existing indexed building queries. Publication derives its site membership from current ownership while retaining normal caching for unchanged inputs. It does not synchronize receiving limits, redirect couriers or otherwise mutate authoritative trade state during snapshot extraction. Tests assert checkpoint purity and exercise neutral factories, neutral ports, split captured stacks, real defeat cleanup, binary snapshot decoding and continued simulation.

The established-session non-completed match-ended path also called status before disabling commands. The game's status callback ignored that status while commands were still available, leaving both clients looking frozen. Failed termination now uses the existing fatal-error path, disabling commands and surfacing the error. Completed victory presentation behavior is preserved.

A second reproduced defect matches the reported nuclear aftermath: fallout neutralizes land while surviving edge buildings retain their live faction owner. Defeat cleanup then walked only remaining owned tiles, leaving those buildings assigned to an eliminated faction. Cleanup now resolves all remaining buildings in that faction's building index to the same recipient already selected by existing conquest and diplomacy rules. This preserves survivor HP, terrain ownership and fallout. Tests cover war inheritance, raid-only neutralization, uncredited defeat and checkpoint restoration. The HUD labels owner-zero buildings Neutral rather than Enemy.

Validation: 180 focused tests passed, including all new reproductions. TypeScript, skirmish production build and git diff whitespace checks passed. The four original trade/client repro cases failed before repair and passed afterward; the four ownership/HUD repro cases likewise failed before repair and passed afterward.

The server stores coordinator/lobby metadata, not recoverable full simulation checkpoints for this match. Once the failed worker was closed, its authoritative state was released. Client screens may retain their last presentation, but this is not a lossless checkpoint from which this match can resume.

Raw evidence is retained locally in out/8hz-20261014: live-freeze-full-20261015.log, live-freeze-coordinator-summary.json, freeze-red.json, freeze-green.json, orphan-red.json, orphan-green.json, freeze-and-orphans-validation.json and the type/build logs. Investigation fixes are local and not deployed.
