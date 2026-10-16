# Temporary Oracle late-game hardware qualification

Prepared October 13, 2026. This is a deployment and measurement plan, not proof
that any instance can sustain the target workload. No new resources have been
provisioned by preparing this document.

## Configuration and spending boundaries

Use a separate on-demand `VM.Standard.E5.Flex` instance in Ashburn with
8 OCPUs (8 physical cores, 16 hardware threads), 32 GB RAM, Ubuntu 24.04
**x86_64**, and a small boot volume (50 GB initially). Disable burstable
performance. Admit one match. Do not buy GPUs, bare metal, load balancers,
reserved capacity, extra data volumes, or Marketplace software.

The signed-in trial console offered E5 Flex in AD-1 and AD-2; E6 was not listed
in those selectors. Selecting a shape does not guarantee launch capacity or
tenancy quota. Confirm the image, quota, and final estimate before creating it.
The inspected draft used Oracle Linux; switch to Ubuntu before launch so the
existing bootstrap's Ubuntu 24.04 contract remains valid.

The console estimate for the E5 draft was $226.18/month compute plus $2/month
boot volume, $228.18/month total. Published E5/E6 list rates are $0.03 per
OCPU-hour and $0.002 per GB-hour: $0.304/hour compute and RAM, $7.30/24 hours,
excluding storage and chargeable network usage. This is an estimate, not a cap.
Verify the final Ubuntu/storage estimate and trial accounting before launch.

The user authorizes up to the full unused $300 trial allowance. Start with a
24-hour qualification window; plan less than $15 of credits for that window
and reserve the remainder for investigation rather than consuming it by default.
The trial expires October 30, 2026. Keep the account on Free Trial; do not
upgrade to Pay As You Go. If the selected shape requires an upgrade, stop and
resolve that restriction with the user instead of accepting paid-account terms.
OCI budgets are soft alerts, not automatic spending caps.

Before running, record a UTC teardown deadline and arrange an OCI control-plane
stop schedule or an independently monitored deadline. Verify instance STOPPED
in the console/API; OS shutdown alone is not a billing safeguard. Export results
and remove the disposable instance and its boot volume after qualification.
Retained disks/backups can consume credits independently of compute.

## Code and production safety

The checkout and published `1.5.0-RenderingAndCultures` were both
`eb938f146a6edc0aae627ca4a49ba7cc93669a65` before the engagement fix.
Published `main` was a different revision. After the new push, independently
verify its full remote SHA and deploy that exact SHA. Do not assume `origin/main`
contains the user's current fixes, merge branches, or switch the release target
without checking. Follow `docs/OracleRedeploymentGuide.md` and release gates:
TypeScript, complete skirmish tests, production build, and runtime assets.

Keep the A1 production VM, its database, and public DNS available for rollback.
Never attach its aarch64 boot volume to the x86 test VM. Build the same source
for x86 using the existing architecture-aware Dockerfile/bootstrap.

Use the public SSH key corresponding to the existing approved host key; never
upload the private key. Reuse the existing VCN only after inspecting its rules.
SSH remains restricted to the user's source IP /32. Start testing via SSH
tunneling to the app's loopback port, avoiding new public ingress entirely.
For that isolated test, supply a test-only Compose override allowing the exact
loopback browser origin (for example `http://127.0.0.1:9010` for a local port
9010 forwarded to remote 8080). The production Compose origin list does not
allow localhost. Apply the override explicitly with the base Compose file;
do not widen production's origin list or disable origin validation. Forward
the entire app so the homepage, assets, and WebSocket share the same origin.

On the fresh Ubuntu VM, install using `deploy/oracle/bootstrap.sh`, then deploy
the published SHA using `deploy/oracle/release.sh FULL_SHA staging`. Review the
script from that SHA first. Staging uses `oracle.ageoffronts.com`; provision and
verify that endpoint/certificate only if browser testing requires it, with the
user's authorization for the DNS change. Do not point production DNS at the
test machine merely to conduct a benchmark.
The staging Caddyfile's HTTP catch-all is suitable only for isolated/tunneled
testing; do not send player credentials over a public plain-HTTP endpoint.

Start with a separate database and test identities. To move real player data
later, first wait for zero active matches, take a consistent SQLite backup with
the existing backup workflow, transfer it securely, set ownership, and check
integrity. An active simulation is not migrated by copying SQLite: release
restarts lose active matches. Pin DNS rollback and preserve the old host until
the replacement passes runtime checks. Disable new admissions during any
eventual migration window through an explicitly reviewed mechanism; the current
release script's idle check is not an admission lock.

## Workload and acceptance contract

The user selected this minimum qualification target:

- 1000-cell map; exact map ID and seed must be recorded before the run.
- At least 10 AI factions, 25 tribes, and 3 human players.
- Approximately 700 squads and 300 boats, with actual counts reported throughout
  measurement rather than inferred from initial settings.
- Napoleonic age, exercising its largest formations, ordinary combat, movement,
  and routing. A smaller population, earlier era, or idle held-unit scene cannot
  qualify this target. State whether squad/boat counts cover all factions and
  count tribal entities consistently.
- Use three normal gameplay clients for the final hosted run, including one
  visible browser with rendering and HUD. Lightweight socket clients are useful
  for transport smoke but do not substitute for player-client qualification.

Before spending credits, identify the match to qualify: map ID/size, seed,
AI/tribes, age, unit/ship/army counts, and human client count. Use an existing
compatible late-game checkpoint/replay or a reproducible fresh hosted workload.
Validate old checkpoints against the pushed revision before timing them.
The historical local 1000-cell/14-AI benchmark is not automatically equivalent
to the logged production match, and does not certify arbitrary populations.

First deploy and measure the new revision on A1, or capture a separate A1
baseline using that same revision without disrupting players. Compare it with
E5 using identical state and commands. Otherwise code changes are confounded
with the hardware change. A browser-local benchmark is supplemental; final
qualification must use normal hosted workers, publication cadence, binary
snapshots, clients, HUD, commands, and rendering.

Suggested acceptance for one declared workload:

- At least 30 minutes of late-game continuation at 1x, with simulated/wall time
  measured in active intervals, excluding intentional pauses and setup.
- Sustained normal speed: at least 0.98x over the full interval and no sustained
  five-minute slowdown below 0.95x. Target mean simulation tick <=40 ms,
  p95 <=50 ms, p99 <=100 ms; report any spikes >250 ms and their cause.
- Measure command execution separately from receipt acknowledgement. Require
  p95 server execution <=250 ms and p95 visible response <=500 ms on the test
  connection; report measured RTT and browser rendering effects.
- No stopped workers, engagement exceptions, encoder failures, unexpected
  disconnects, or persistent publication backlog. Exercise reconnect and both
  binary/text clients with `scripts/smokeOracleStability.mjs` before load tests.
- Routing must make useful progress: record oldest request ages, completions,
  supersessions, and interactive latency. A fast tick achieved by starving AI
  routing does not pass. Measure memory trend and GC over the whole interval.
- Record per-thread CPU, CPU steal time, scheduling/queue delay, memory and
  container limits alongside tick phases, snapshots, encoding, and client costs.
  Do not build images or run additional matches during measurement.
- Validate checkpoint continuation/canonical state under the same input stream.
  If a portable hosted checkpoint harness is required, add it as explicit test
  tooling; do not expose unrestricted restore/upload endpoints on production.

The hardware conclusion is conditional. If E5 sustains these criteria, it is
qualified for this one workload; then downsize to find a cost-effective minimum.
If one simulation thread still consumes >50 ms per tick with free cores,
ample memory, low steal time, and healthy transport, the current implementation
misses the performance target on this class of modern hardware. Profile that
thread rather than renting more cores. Low thread CPU with high wall time instead
requires inspecting scheduling, waits, replication, and the VM environment.
A second machine can isolate an abnormal host. None of these outcomes alone
proves the entire architecture must be replaced.

## Sources

- https://blogs.oracle.com/cloud-infrastructure/e5-standard-instance-4th-gen-amd-epyc-processors
- https://blogs.oracle.com/cloud-infrastructure/oci-launches-e6-standard-compute-powered-by-amd
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm
- https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/budgetsoverview.htm
- https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/resource-billing-stopped-instances.htm
