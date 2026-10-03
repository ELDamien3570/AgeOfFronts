# Optimization handoff

## Multiplayer stability continuation — 3 October 2026

The six playtest issues, normal all-policy AI defaults, and progression deadlocks are addressed in the current stability candidate. Real local/Oracle ARM profiling reproduced and removed the multi-second legacy river-routing stall; controlled public release verification follows the tested candidate. See [implementation, profiling, validation and remaining acceptance limits](Evidence/multiplayer-stability-20261003.md). The opt-in/no-deployment wording below describes the earlier checkpoint, not the current release posture. P02 largest-world memory and native/ten-browser P29–P30 acceptance remain separate gates.

## Local continuation - 3 October 2026

The five previously deferred plans **P17, P20, P21, P22 and P25** and the remaining Antigravity tuneups/lobby fixes are now implemented locally in source commit `fd34e956513686fc66523ff313d940ad31666b41` on `codex/optimization-lifecycle-indexes`. The combined full run covered 1,101 tests; its 11 failures were resolved in the affected-file group, whose final **132 tests pass**. TypeScript, build, whitespace and scoped Oxlint pass; scoped ESLint retains one pre-existing unused local. See [exact combined validation and limits](Evidence/remaining-five-combined-validation.md). This evidence is cumulative full-run plus focused repairs, not a repeated all-green exhaustive run. P02 largest-world memory, P29 native browser qualification and P30 actual ARM/ten-browser capacity remain open. Experimental defaults remain opt-in; no push, merge or deployment occurred.

## Historical handoff - 2 October 2026

Updated 2 October 2026. Repository: [ELDamien3570/AgeOfFronts](https://github.com/ELDamien3570/AgeOfFronts).
Working/publishing branch: **`v1-phased-ai-optimization`**.

## Where implementation stopped

The user changed the scope: finish and test the active defence work, then create
this folder and separate plans for local agents. That active slice is complete.
**No further land, economy or naval feature phase was started after that request.**

Last tested implementation commit:
**`7def4ee6376ec8c79971d461dae56bbae9b79752`**
(`feat: fund and staff stable Modern defensive sectors`).

This includes `e48dd4b` terrain-aware city enclosures and all earlier tested
checkpoints. The final implementation gate passed **1012 tests across 156 files**,
TypeScript and the skirmish production build. Scoped lint and whitespace passed.
Documentation created after that commit is in this folder; its final enclosing
commit may have a different source/UI-publication SHA, without a further feature
implementation. See the publication map below before trying to cherry-pick a
local-source ID from the remote repository.

Start the next work from the latest remote branch and read:

1. [Shared agent workflow](agent-workflow.md)
2. [Remaining work index](remaining-work-index.md)
3. The relevant one of the **30 separate task plans** in `Plans/`
4. [Integrated implementation/evidence record](../docs/V1ImplementationProgress.md)
5. `References/` when historical requirements are needed

**This is a tested handoff checkpoint, not a deploy-ready or capacity-certified release.**

## Completed in this implementation run

- One-at-a-time recruitment cancellation: newest inactive item first, otherwise least-progress active head; exact single refund; ownership/filter safety; right-click UI
- Paid, researched, one-tier building upgrades with aggregate atomic quote, half-price/timed construction, paused production, preserved health ratio and the U action; no free automatic military modernization
- Authoritative age-correct mine/oil placement visibility
- Catalogue-funded seven-age openings, legal tribe infrastructure/research and age-locking; initial free squads do not consume the opening reserve bank
- Confirmed technology policy: all prior-age research plus the first node of every current-age branch. Remaining current-age nodes are researched normally, including for tribes
- Bounded runtime diagnostics and public liveness versus aggregate match-progress separation
- Queued land-leg and patrol route continuation, explicit limited replacement outcomes, deterministic retry backoff and dead-navigation cleanup
- Sparse capture-pressure clearing and one cargo grouping per ship movement stage
- Demand-driven browser projections while canonical application/acknowledgement continues
- Dedicated bounded encoding worker, two-slot ordered publication, captured-tick preservation and flushed join/recovery/terminal barriers
- Independent bounded dirty-tile extraction cursors; borrowed terrain only until immediate network extraction; exact scan fallback on overflow/restore
- Geographic AI diplomacy through genuine borders/connected nearby land/same-sea ports, bounded coast discovery and recipient-wide AI offer cooldowns
- Optional regular-AI peace/preparation/declared-war/recovery policy, one offensive commitment, local remembered multi-aggressor defence, anti-dogpile target scoring, footprint/landing/transit guards and public declaration/withdrawal events
- Terrain-aware city enclosure fallback: resumable exterior-band search/copy/outline, actual tower-link/cost reconciliation, closure validation, safe friendly access and paid completion
- Stable hostile sector facts: constant-time boundary cursors, bounded assessment, at most eight retained 16x16 sectors per faction and no equal-quality shortlist churn
- Funded Modern section controller: one active three-site section per faction, two occupied trenches, supported gun position, mobile reserve plus unleased force; safe construction window, exact normal payment, actual arrival before holding, takeover/loss withdrawal and paid-structure reuse

The current Modern implementation uses stable sectors, not connected whole-front
aggregation. More extensive defensive-region policy and older child-query
budgeting remain P15. Presence of the new classes is not acceptance for those
larger behaviors.

## Feature and behavior gates

| Feature | Current production/default posture | Additional requirement |
|---|---|---|
| Recruitment/upgrades/visibility/opening/grants | Normal implemented behavior | Real-browser acceptance P29 |
| Runtime metrics, sparse capture/cargo, dirty terrain, server encoding, browser projection | Implemented production paths | Broader extraction/memory/browser/performance acceptance P01–P14/P28–P30 |
| AI geographic offers/recipient cooldown | Applied to AI offers; manual replies/offers retain ordinary mechanics | Additional quotas/window tuning P27 |
| `aiEconomy` | Off unless explicitly supplied in trial `MatchOptions` | P19–P23 and qualification |
| `aiDefenses` | Off; requires trial economy coordinator | Current city/Modern slice passed, broader P15 and field qualification open |
| `aiNaval` | Off; requires economy and deferred planning | P23–P26 and qualification |
| `deferredPlanning` | Off in default production options | Complete P06–P11 caller coverage and qualification |
| `aiWarPolicy` | Off unless explicitly supplied | Initial policy passed; P27/readiness/integrated qualification open |

Do not flip every experimental flag to demonstrate progress. Qualify one coherent
feature set at a time. Physical `Diplomacy.hostile`, damage and capture remain
separate from AI operation policy; human unannounced movement/attack/capture is
not made illegal by these AI switches. No extra fog/intelligence mechanic was
introduced.

## Exact source and publication map

GitHub publication used normal folder uploads with their own commit history.
**Local-source SHAs below may not be reachable from the remote branch.** Compare
content, not commit ancestry; do not replay all local commits over already
published equivalent files.

| Checkpoint | Local source | Verified GitHub publication | Evidence |
|---|---|---|---|
| V1 base | `bca41f59a8b2b3d23dbe391d964fc2bffd3d6708` | Branch created from this base | Latest V1 at checkout |
| 977 tests | `6b0eefac34e9bab47ceafd4fa47b32c7f4e79f76` | `c4167abfa0f6646215af49b19e179787c965f963` | Whole tree equal: `62a3109279d9122be2ba19b320d15d7c75b7d14d` |
| 986 tests | `80cd464f1abbfcd06ab778c0552ad47aacabe694` | `629c3d5acd6ef63ab4cce9ccdd3fd714181fdc99` | Whole tree equal: `6bbee3fcdb30198821f6ea35312a032b3aab9cfe` |
| 1003 tests | `01033f26cb77e8d38a92b76bc1b6ac746c09e482` | `0fc0af4f089141de4bc1094b7d3c506d8b6c64bc` | All 30 exported files and all src/tests/progress matched; remote additionally contains 145 concurrent Art changes |
| 1006 tests, terrain enclosures | `e48dd4b` | Included in final cumulative handoff export | Full source gate passed |
| 1012 tests, Modern sectors | `7def4ee6376ec8c79971d461dae56bbae9b79752` | Included in final cumulative handoff export | Full source gate passed |

The final export is cumulative from local source `01033f2`, not from the V1
base, and includes this folder. It has an exact manifest/hash for each changed
file and an explicit deletion list. After the final upload, fetch the latest
remote branch and compare it against the exported source plus preserved remote
Art files. Publication verification must not overwrite unrelated concurrent
changes merely to force an old full-tree hash. Record the final remote SHA in
the delivery/verification result; this document cannot self-reference the hash
of its own enclosing publication commit.

## Concurrent artwork

During publication, remote commit `0df3a22` and merge `205e5cd` added/changed 145
files under `Art/`. The user confirmed: **“thats inprogress art, I will implement
that later”**. Preserve these files exactly. Do not hook them up to gameplay,
regenerate them, replace their manifests or treat their completion as an
optimization task. Source/tests at the verified 1003 checkpoint matched despite
this intentional full-tree difference. Final remote-tree validation must include
whatever authoritative Art files are present, and distinguish missing LFS assets
from code regressions.

## Test evidence and environment

- Source gate: 1012/1012 tests, 156 files, Node 24.19.0 on Linux x64
- Commands: `npm run test:skirmish -- --maxWorkers=4`, `npx tsc --noEmit`, `npm run build:skirmish`, `git diff --check`, scoped Oxlint on changed slice
- Focused Modern tests: independent boundary-edge comparison, bounded stable shortlist, mid-scan/mid-construction checkpoint, exact **49,980 gold / 40 steel** three-site payment, cover/support/reserve staffing, lease/funding cleanup, takeover, withdrawal, reuse, insufficient reserve/support and unsafe-contact rejection
- Terrain tests: independent polygon containment, spacing/perimeter limits, obstructed/unowned cells, resumable search/copy/outline and real paid enclosure completion/access
- Earlier focused tests cover refund/upgrade/progression, canonical-only worker/session flow, independent tile journals, bounded encoding/admission and live worker/WebSocket join barriers
- The initial 936-test checkout failed because runtime assets were Git LFS pointers. Fetching actual resources/Wall Kit fixed those environmental failures. All unused Art assets were not downloaded
- Known build output: the Vite large-chunk warning remains. No claim of clean full-file legacy Simulation lint or of hosted GitHub CI success is made; verified local gates are listed explicitly
- Full browser gameplay acceptance, actual ARM profiling, largest-map target capacity, real ten-browser concurrency and final combined experimental-flag qualification remain unverified

## Remaining tasks and integration boundaries

All remaining combined-document requirements are mapped in
[remaining-work-index.md](remaining-work-index.md). Notable unfinished items:

- Full bounded transactional Army/formation/shore/boarding/landing/trade planning, successful limited-search progress and per-player/class fairness
- Maintained entity/resource/producer/combat facts and immutable/dynamic revisions; remaining whole-world scans and snapshot metadata/entity extraction
- Full runtime/browser/GC/queue/consumer-memory evidence and recovery baseline reuse
- Connected defensive regions and remaining older child work; researched coordinated Armies, supported pushes/flanks/breach/escort/recovery and all eleven doctrines
- Economic dependency/bottleneck/viability, research/age utility, remote coast, shared trade-cycle risk and intended-sea purchasing
- Strategic naval theater/value/casualty selection, complete recovery/terminal lifecycle, bombardment, escorted cargo/capacity, landing and beachhead handoff
- Additional AI strategic readiness/sleep and proposer/global/reject/expiry/break diplomacy controls
- Cold/warm/save-restore, conservation, integrated behavior, real-browser and authorized hardware qualification

Do not assign the same integration files to simultaneous writers. Shared
`Simulation.ts`, `Expansion.ts`, `Protocol.ts`, `AiEconomicDirector.ts` and
multiplayer boundaries need one integrator; independent module work can proceed
in separate worktrees with explicit interface patches and sequential gates.

## Authority, target and stopping rules

The target remains **largest supported map, 14 AI nations, 30 tribes, at least
10 humans**. With ten humans this is 54 initial factions, not “14 total players.”
No measured capacity claim follows from the local correctness suite.

The latest scope excludes Oracle pushing/deployment and replaces further work
here with this local-agent handoff. Historical input text suggesting Oracle
deployment is superseded. Do not merge into V1, deploy, obtain credentials or
raise production admission without separate current authorization. Do not
reconstruct the previously stopped stress tests, run live overload traffic or
use another route to evade a refusal.

Use ordinary, bounded, legitimate local correctness/play scenarios. If target
hardware or real clients are unavailable, leave that acceptance gate open. A
safe handoff clearly says what was observed and what still needs proof.
