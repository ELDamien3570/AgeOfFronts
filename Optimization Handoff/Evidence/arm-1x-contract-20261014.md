# ARM simulation optimization contract

Continue from the qualified multiplayer pipeline candidate toward sustained 1x
on the existing two-core ARM server. Preserve 20 Hz simulation, canonical tick
ordering, exact gameplay, deterministic RNG consumption, query ordering,
planning work budgets, replay and multiplayer semantics. Do not deploy or start
paid hardware. Preserve the prior uncommitted pipeline changes.

Use the validated Migration 1000-cell fixture, 10 AI, 25 tribes, three human
empires, Napoleonic cap, initial 700 squads/300 warships. Freeze the starting
source as this pass's baseline. Collect ARM CPU profiles to identify redundant
work before editing; retain only changes justified by current measurements.
Caches need complete validity keys or phase-scoped lifetimes, never stale state.

Compare exact checkpoint continuations and meaningful subsystem tests before
matched ARM measurements. Simulation-only profiles identify cost; actual
three-client coordinator tests qualify end-to-end pace and responsiveness.
Keep production isolated and stop profiling if a production match becomes active.
Report remaining distance to 1x and any regressions rather than asserting success
from averages or local-PC results alone.
