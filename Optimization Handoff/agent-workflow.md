# Shared local-agent workflow

## Authority and branch discipline

- Read `handoff.md`, `remaining-work-index.md` and the assigned plan before edits
- Start from the latest published `v1-phased-ai-optimization` branch, not V1 or a historical local-source SHA
- The user requested this handoff for local agents. This folder does not itself authorize new deployment, account access, destructive cleanup or production testing
- Preserve every concurrent `Art/` file. The user says this is in-progress art they will implement later. Do not wire it into gameplay, regenerate it, remove it or overwrite it
- Do not merge into V1 or push/deploy to Oracle. Keep the feature gates off until independently accepted
- Use one branch/worktree per task. Do not share an editable working directory across agents
- Reserve shared integration files (`Simulation.ts`, `domain/Expansion.ts`, `Protocol.ts`, `AiEconomicDirector.ts`, multiplayer protocol/server coordinator) to one integrator. A task agent proposes narrow interface patches; the integrator serializes them after dependencies pass
- Never resolve a conflict by replacing the entire file with an older task snapshot. Review both changes and rerun the affected gates

## Reproduce the baseline

Use the repository's Node/npm engine ranges (Node >=24.15 <25; npm >=12.1 <13).
The tested cloud runtime was Node 24.19.0, Linux x64. Dependencies were installed
from the existing lockfile with lifecycle scripts disabled. Honor the repo's
current instructions if they change. Do not upgrade dependencies as incidental
cleanup.

Git LFS matters. Initial failures came from pointer files in runtime maps/art.
Use normal authorized LFS retrieval for runtime assets before diagnosing tests.
The implementation workspace fetched resources and the Wall Kit used by the
build; it did not resolve every unused artwork pointer. Never interpret a tiny
LFS pointer as an image or silently fabricate missing assets.

Run from the repository root:

```sh
npm run test:skirmish -- --maxWorkers=4
npx tsc --noEmit
npm run build:skirmish
git diff --check
```

Run focused tests before that full gate and the repo's scoped Oxlint/ESLint on
changed files. Preserve timeout/assertion strength. A pre-existing unused local
`tile` in the legacy Simulation movement path means an old full-file lint
failure must not be relabelled as a new clean full-lint result. Investigate any
current new diagnostic separately. The Vite large-chunk warning is known.

## Sequential acceptance

1. Record the source commit, exact flags, map/seed/age and relevant starting state
2. Write a failing regression or independent reference before the change
3. Implement one coherent lifecycle boundary. Persist partial state and explicit outcomes where needed
4. Verify cold and warm execution, save/restore mid-phase, cancellation, replacement, controller transfer, death/capture and treaty changes
5. Assert deterministic work and retained-memory bounds. A queue around a synchronous loop is not a completed bounded planner
6. Run focused tests, the full skirmish suite, TypeScript, production build and whitespace/scoped lint
7. Commit only the complete passing slice. Update the task plan with exact evidence and residual limits
8. Only then start the next dependent slice or integrate another agent's patch

## Invariants

One simulation owns all mutable authoritative state. AI reservations hold only
unpaid commitments; ordinary commands perform actual spending/refunds. One
lease owner controls each asset. Input acknowledgement is not execution.
Physical hostility, damage and capture remain separate from optional AI
strategic war policy. Human unannounced movement/attack/capture stays legal
under its existing rules. Wall-clock measurements must never choose simulation
outcomes.

Preserve ordered canonical deltas and join/recovery barriers. Presentation may
coalesce, canonical state may not. Preserve changes which revert between
presentations, removal identities, captured publication ticks and explicit
terminal command receipts.

## Performance and safe qualification

Measure ordinary local correctness and bounded legitimate play scenarios first.
Do not reconstruct the previously stopped stress scripts, run live overload
traffic, or evade a refused action through another route. If qualification
needs unavailable hardware, browser clients, data or authorization, record the
exact blocker and leave that gate unverified.

Largest map + 14 AI nations + 30 tribes + at least 10 humans is the requested
target (54 initial factions with ten humans), not an achieved capacity tier.
Local x64 tests cannot certify the user's ARM machine. Record real client
presence; ten server-side reserved seats do not prove ten browser clients.
