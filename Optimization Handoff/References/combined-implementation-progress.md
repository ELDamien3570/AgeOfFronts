# Combined AI and reliability implementation

User authorization: implement all three downloaded packages in stages and deploy
to Oracle after implementation and validation. The shared checkout was released for continuation
after a second writer pause on 2 October 2026. Preserve its MapSymbols, trader
presentation and renderer changes.

Packages: complete-AI-implementation-handoff, AI-Economy-and-Naval-Implementation-Plan,
and reliability-review in C:/Users/Damien/Downloads. The original foundation report
is ai-handoff-implementation-review.md. This file records progress, not acceptance.

## Implemented locally

- Foundation and cheap hostile-territory border glow are in commit 900ba87,
  created by another writer. This chat did not publish that commit.
- Opt-in `aiEconomy` application coordinator, typed liquid/incoming snapshot,
  demand-aware shared production, unpaid reservations, emergency preemption,
  saving expiry, takeover cleanup and checkpointed candidate/fair scheduling.
- Placement legality is quoted separately from payment; purchases still use
  authoritative commands. Owned coast candidates have an ownership-maintained
  index and can lie beyond the camp's 256 closest tiles.
- Shared trade payout formula; viable foreign water market required for sea
  selection; empty-source boundary mode switching preserves actor identity.
- Legacy navy respects repair/refit/boarding ownership and allied shores.
- Resource placement index and visible incremental preview; no full synchronous
  map enumeration at mode entry. Resource facts also back domain construction.
- Rejoin waits, baseline preparation and client application have independent
  deadlines. Client timeout no longer invokes a one-second executor watchdog.
- Canonical worker applies ordered deltas; complete presentation frames can
  coalesce with changed-tile unions. Negotiated per-client credits and serial
  baseline recovery fence epochs without pausing the match or shared cursor.
  Rate-limit failures now report explicit errors; worker diagnostics retain stacks.
- Resource facts transmit at baseline/geometry changes and owner changes use
  deltas. Preview funding updates independently and off-screen chunks are evicted.
- Checkpointable sparse A* and fair exact land/water scheduler account for
  search, reconstruction, path copies and candidate sampling. Blocked/smoothed
  navigation and pursuit use it; pursuit tries reachable firing alternatives
  with global 256 candidate-cell/32 LOS budgets. Cost epochs survive restore.
- Formation fallback enumerates perimeter cells in original tie order and
  indexes its slots sparsely. Shift moves preserve slots and omit discarded
  route searches. Center destinations normalize identically to active orders.
- Physical wall clearance uses swept squad radii; firing rays retain their
  existing rule. Empty/impacted-only projectile phases skip collision reindexing.
- Shared atomic movement leases and exact scratch defense quotes, including
  sequential completion, count-scaled times/costs and production automatic links.
  Rectangle corners/even side spacing and closure quotes have focused tests.
- Checkpointed productive city/outpost records deduplicate stacked sites, bound
  their owned connectivity search, avoid chained sprawling clusters and debounce
  material geometry. Trial city defense persists funding, two available defenders,
  normal tower construction, actual wall closure, repair, abandonment and takeover.
  Paid construction and repairs survive controller release without refunds.
- Military dependencies quote researched chains through absent workshops,
  aggregate upstream demand, retain viable older-unit fallbacks and include
  unpaid refit kits. Funded modernization respects ledger/movement ownership,
  pressure, its existing cap and takeover. Bounded recent-loss history expires.
- Production no longer adds AI refining demand twice or temporarily falls back
  to legacy buffers before its first demand decision. Exhausted dependency
  exploration reports unknown rather than rejecting a potentially viable chain.
- Trial human replacement land moves continue old orders while their entire
  formation is admitted. Checkpointed Shift intent handles subsets, distinct
  pending cohorts and mixed idle members, preserves later legs and cancels
  overlapping newer manual replacements without partial route activation.
- Trial exact searches share a 2 MiB typed workspace and a 128-job queue.
  Indexed heaps cannot accumulate duplicate cell entries. Search storage cleanup,
  cancellation and replacement coalescing consume the work allowance. Memory
  exhaustion remains unknown; route validity is checked again after cleanup.
  Background pursuit/repair uses the legacy path unless deferredPlanning is on.
- Tower endpoint sectors and one pure production auto-link quote serve domain
  construction, AI quotes and preview. Preview includes wall gold and troop
  clearance, reacts to endpoint completion/tier/liveness, and invalidates only
  nearby visible chunks for troop movement. Funding updates reuse geometry.
- Four outstanding publications tolerate ordinary network/worker latency.
  Skipped deltas still require a fresh baseline after outstanding applications.
  Recovery captures and forced join baselines fence superseded epochs.
- Trial replacement sails and later waypoints use the exact shared planner;
  old voyages continue until the whole selection is ready. Dock recovery and
  the return to patrol use executable route admissions that preserve repair
  ownership, patrol anchors and takeover semantics.
- Shared naval facts index actual spawn seas, ports, ships and paid queues.
  One bounded global pass and mutation hooks serve every faction. Stable
  checkpointed ID continuations avoid replaying iterators on controller resume.
- Opt-in `aiNaval` currently implements the first port-defense/concentration
  objective with researched health/range/rate power, same-sea recruitment,
  paid future strength, stable anchors, atomic fleet leases, abort cancellation
  and bounded assessment. It requires economy and deferred planning. Multi-sea
  selection, evidence-driven funding limits, escort/landing and full recovery
  mission transitions remain incomplete; this flag must remain off in production.
  Gathering ports now use a maintained owned-building cursor across seas and
  retain a healthy anchor. Final live sea/readiness/range checks fence resumed
  assessments. Recovery slots preserve dock orders and rejoin after repair;
  displaced roster leases are released. Theater spending evidence survives new
  mission IDs and checkpoints, rejects an inadequate bounded purchase plan,
  and requires improved combat evidence before repeating a failed investment.
  All fact/assessment work shares 128 background units with cities and borders,
  reserving at least sixteen city units even during cold parallel passes.
- Ownership and unpaid funding expire before controllers each economic tick,
  including ticks without a spending decision or with an early military return.
- Empty planning checkpoints omit inactive arena buffers, retain reused free
  slot order and still restore earlier full-buffer states. Active work retains
  all typed search data. The 20-second continuation timeout was resolved without
  increasing it: the focused checkpoint/routing/fleet run completed in 5.31s.
- Ordinary non-Army AI land moves use transactional admission too. Repeated
  unchanged AI intentions preserve the pending search; manual replacement
  retains its Shift cancellation semantics. Pending cohort lookups are indexed.
- Shared boundary facts inspect at most five cells/twenty foreign land edges
  per ownership change. Treaty filtering reads current hostility. Chunk revisions
  remain monotonic through deletion/recreation; sparse checkpoints reconstruct
  their byte mask and cold rebuilds share the background work allowance. This
  is raw geometry input, not connected/staffed Modern sections.
- Browser snapshot decoding accounts for aggregate expanded typed-array
  allocation, including repeated buffer references. Its 64 MB typed limit
  matches the current valid word-array snapshot encoder's wire ceiling; generic
  recovery consumers expose separate configurable limits and allocation stats.
  Canonical dimensions, buffer layout and queued-order ranges validate before
  output construction. Dirty unions cap at 65,536 entries and overflow to an
  acknowledgement-fenced full presentation; baselines need no redundant dirty
  hash entries. Canonical decode also omits its duplicate changed-tile array.
  The worker additionally binds exact dimensions to the already loaded map.
  Metadata bytes, nesting and tokens are checked before JSON.parse; generic
  recovery arrays default to a finite 256 MB budget. Base64 decoding avoids
  its full binary-string temporary, unaligned RLE words use DataView, and
  map/set unpacking avoids a second entry-pair tree. Wire, metadata and expanded
  typed allocation counters reach client diagnostics; these are structural
  allocations, not a V8 heap or whole-process memory certification.
- External command receipts distinguish accepted transport inputs from deferred
  domain planning, execution, rejection and supersession. Original IDs survive
  full checkpoints. Land/ship event callbacks cannot lose outcomes to the small
  diagnostic ring, Shift intent execution means committing its queued order,
  and control changes supersede only pending inputs. Multiplayer worker results
  route only to the original authenticated guest; late ACKs cannot replace a
  terminal result. Worker batches above 100 reject before mutation, not slice.
  Pending receipts cap at 512, history at 2,048; small client outcomes bypass
  slow state decoding rather than accumulate a metadata promise backlog.
- Derived Shift indexes provide per-squad queued counts and admission waits.
  Unchanged AI routes do not restart because another faction has Shift inputs.
- Production defense quotes read the maintained building/spatial queries and
  use at most 32 hypothetical additions plus new wall tiles. They no longer
  clone all buildings, fortifications or map occupancy per candidate. Normal
  construction and tower-link policy still owns spacing, counts, tier prices,
  and link geometry. A regression compares the quote's gold and wall cells
  against actual sequential commands and forbids full-index/fortification clones.

## Verification so far

Latest completed full suite: 936 tests passed across 140 files (15-second
test timeout, two workers), in 127.95 seconds at 16:40:49 on 2 October 2026.
This includes command receipts, parser/worker safeguards, naval recovery/
spending/port selection/fair work and production defense quote overlays.
TypeScript, production build, diff whitespace and scoped ESLint passed for
all changed TypeScript files except Simulation.ts. That file has a pre-existing unused local `tile`
in HEAD's legacy movement path; it remains untouched and fails full-file lint.
These are local functional checks, not ARM profiling, browser proof or final
acceptance. Shared-checkout commits 1f8df2d and 8db942b captured earlier work during this run;
this chat has not committed, pushed or deployed.

## Still required

- Reliability: measure representative consumer limits and total transient heap,
  finish maintained immutable/dynamic revisions and stage diagnostics. Parser
  and typed allocation budgets and explicit command outcomes are implemented;
  they still need final browser, load and external profiling acceptance.
- Planning: complete transactional admission beyond ordinary land moves/sails,
  and resume all formation setup, clearance, land/water/shore/copy work;
  shared crossing rankings, ship/army/trade/boarding/landing integration.
- Original AI: maintained front records, funded Modern staffed sections,
  terrain-aware city outlines and bounded child work; researched Armies, supported pushes/flanks,
  escort/breach/recovery and all eleven personality doctrines.
- Economy: richer dependency/utility branches and viability diagnostics, bottleneck selection,
  research/age utility and reachable remote-coast acquisition; richer shared
  trade cycle/risk quotes and intended-sea vessel purchasing.
- Navy: extend owned-port selection to strategic ranking of threatened seas,
  richer casualty/value evidence and persistent full recovery/complete states,
  coastal attacks, safe cargo/escorts, actual capacity, boarding and beachhead handoff.
- Final tests: deterministic cold/warm save/restore, conservation and work-bound
  fixtures, seeded outcomes/performance evidence, browser review; target ARM
  profiling remains an external gate. New planners remain off by default.
