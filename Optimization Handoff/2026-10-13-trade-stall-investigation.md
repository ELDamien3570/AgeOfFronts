# Trade stalls observed on 2026-10-13

The public server was running `0f59ac2e35c85d89dcd56191dada8764ea40d6b7`, matching the local checkout. Health reported one running match and no stopped simulation. Read-only runtime logs showed the shared planner holding 120 requests; trade requests were pending for 1,904–2,327 ticks (95–116 seconds). A later sample showed one trade request aged 3,754 ticks (188 seconds). This is route latency while the match advances, rather than a stopped server tick.

## Confirmed causes

1. Civilian trade is always background planning, including human-owned and captured couriers. Default matches restricted the entire background fleet to eight corridor-preparation units per tick. The existing reserved preparation allowance could rise to 32 when no player route waited, but its lending option was enabled only for a separate autonomous-deadline configuration.
2. A capacity-limited route result used the same exponential cooldown as an unreachable route: 400 through 6,000 ticks. Capacity exhaustion does not establish that a market is inaccessible.
3. Returning couriers intentionally wait for a full shipment. Goods refill once per simulated second. This explains some clustering at source factories and ports, but cannot explain loaded couriers or traders waiting at receiving cities.

## Local corrections and verified contracts

- Enable the existing idle preparation loan for default matches. The total preparation ceiling stays 32; waiting interactive routes retain their reserved share.
- Capacity failures receive shared, bounded 20–100 tick market cooldowns. The actor's existing no-candidate polling can add up to 100 ticks. Proven unreachable routes retain their longer cooldown.
- Captured sea trade routes to a completed port owned by its current owner, preserves cargo while waiting, and pays `cargo * valuePerGood` once on arrival. Its payout already bypasses ordinary market intake and distance premiums. A regression exercises capture, travel through the shared multiplayer planner, paused trade controls, retirement and single full-value payment.
- Human automatic troop-equipment production has a category minimum of 100 kits, counting finished plus paid incoming output. Explicitly selected troop patterns share that category target; vehicle/siege targets and AI demand remain separate. A recruitment burst creates a deficit and resumes production.

## Remaining architectural limit

A reproducible isolated stress probe (`tests/skirmish/tradePlannerBacklogProfile.ts`, run with the project-local tsx CLI) used 120 distinct 1,000-tile-wide open-water route requests distributed over 37 player identities. After 4,000 ticks, the old preparation policy completed seven routes. With idle lending, 86 completed, eight returned capacity limits, and 26 remained pending. This demonstrates a substantial improvement, but is not acceptable evidence that high-load trade latency is solved.

Further work should reduce duplicated preparation across simultaneous corridors while preserving bounded work, player fairness, and identical cold-restore scheduling. Raising work limits repeatedly would shift the queue problem into server tick time. That broader planner change needs its own contract and workload validation; the local corrections must not be presented as a complete throughput redesign.

Validation: 128 focused production, trade and routing tests passed; TypeScript, production build and diff checks passed. No public deployment was performed. No direct actor-level snapshot of the reported live stolen ship was available, so its individual wait state was not established from the server logs.
