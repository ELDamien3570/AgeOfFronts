# Oracle sea-trade test qualification

Requested by the owner after review of the missed local total-CPU gate. This authorizes an isolated test deployment of the sea-trade implementation; production defaults and the public service remain unchanged. The existing unrelated Russian asset calibration failure is disclosed and unchanged. This test is not production promotion.

## Owner criteria

- More than 90% of complete ten-second wall windows advance at least 79 ticks (9.875 game seconds). The owner explicitly accepted one tick of sampling tolerance. Also report strict >=80-tick windows and overall simulated/wall time.
- Report crashes, worker/encoder exits, transport faults and state disagreements without hiding failed runs.
- Report movement latency distributions; owner will judge them. Do not invent a passing latency threshold. Separate acknowledgement, executed receipt and first decoded authoritative movement, with short and long routes, unresolved commands and rejections.

## Test design

Run the actual production coordinator, LiveMatch scheduler, reserved worker (384MiB heap), separate encoder (256MiB heap), publication flow control, WebSockets and snapshot decoder on Oracle's existing ARM machine. The separately built probe inserts checkpoint restoration immediately after simulation construction, using exact saved options before construction. This is a test initialization seam; it never edits production runtime source or its hot loops. The test wrapper records each tick time and batches completed advances by eight, flushing at measurement boundaries; instrumentation overhead is included.

Use separate loopback-only ports 18081/18082 and a separate SQLite database. No production restart, Caddy change, DNS change or revision-marker change. The guard stops only this test if production admits a match, health becomes unavailable, or one hour elapses. A run stopped by this guard is not a passing stability run. Two remote socket clients connect over an SSH forward. Their decode overhead runs locally; WAN and tunnel delay are included in client response measurements. Rendering/input-device latency is not measured.

Claim existing factions 1 and 2 as humans; preserve all units, technologies, resources, diplomacy and trade cargo. This intentionally removes those two AI controllers and exercises actual player paths. Eight existing noncombat available squads per player may be held. Only owned, standable same-component destinations are used; destinations are selected from owned, standable same-component tiles and filtered at send time to 2-6 versus 25-50 tiles. Selection sizes cycle through one, four and eight existing squads; report each size separately and retain skipped sampling opportunities. No larger-group claim follows from these samples. Record precise current distance as well as initial category in final evidence. Commands begin only after a held squad has three unchanged publications, so inherited motion cannot masquerade as a response. A new sample does not supersede a still-pending prior sample for that squad. First movement means a displacement greater than eight fixed units in a decoded state for at least one selected member after an executed receipt. This measures first group response, not arrival or movement by every member; the first observation records how many members moved. Skipped sampling opportunities and all still-unresolved commands remain explicit.

Begin with a 60-minute converted Migration1000 checkpoint and continue for 15 wall minutes; repeat with the independently evolved 75-minute lane checkpoint for 12 wall minutes, leaving room before its legitimate 90-minute match limit. Use an equal-window legacy control from the original 60-minute fixture on the same implementation's omitted routing mode to quantify movement/pace impact. If a crash, sustained slowdown or unresolved-command problem appears, retain evidence and diagnose before claiming acceptance. No concurrent heavy profiles/builds during measured runs. A short local smoke only validates the harness; it cannot qualify Oracle.

Measure completed advance timestamps against wall-time boundaries, including stalls inside the measured interval. Do not infer time-at-1x from a fraction of fast ticks or from an average alone. Raw tick samples and cumulative coordinator cadence remain cross-checks. The final partial ten-second tail is explicitly excluded from the window fraction but included in overall speed. Require the same match at measurement start/end; missing end samples cannot pass.

## Publication and run procedure

The full exact tested commit must be published on refs/heads/codex/sea-trade-lanes, then independently verified with git ls-remote. Git publication preflight currently returns HTTP403; no unpublished substitute may be deployed. After the owner publishes the prepared branch, verify the SHA and run deploy/oracle/sea-trade-test.sh with that full SHA, absolute input fixture path and a unique run label. It builds the canonical Dockerfile from an isolated checkout and builds the fixture probe inside that exact image.

The remote release uses the original release asset list and keeps production checkout unchanged. Test images, source and evidence live under /opt/ageoffronts/sea-trade-test/<SHA>. Fixtures are outside Git and must be transferred with SHA256 verification. No credentials or guest tokens are recorded in evidence.

Local smoke evidence stays in out/sea-trade/oracle-probe-local-smoke-*. Final Oracle evidence must record source SHA/image ID/input hashes, hardware, measured bounds, raw timing rows, client results, container logs/exit/OOM status, production before/after health and revision, and pace/movement summaries.


## Preparation evidence (local only)

- Local two-minute real-socket smoke v5: 24 orders, eight each for selections of one/four/eight squads; all executed and moved, no unresolved/rejected samples, no client disagreement. All 12 complete ten-second windows meet the owner-approved one-tick tolerance. This is harness validation on the Windows desktop, with ordinary desktop work including TypeScript validation; it is not an Oracle qualification or an isolated timing comparison.
- Final-source 20-second smoke: 126 matching client publications compare ownership, players, squads, ships, buildings and traders; no failures. Four sampled orders execute and move. This confirms the final comparison path only; its small sample is not a stability/latency qualification.
- Synthetic analyzer self-tests verify exact 1x and a stalled second half, including a correct strict greater-than-90-percent gate and retention of unresolved commands.
- All six new JavaScript scripts pass recommended JavaScript lint plus equality checks. The isolated deployment script passes Bash syntax validation. Probe bundle builds. TypeScript passes. All 22 previously qualified implementation authority files remain byte-identical, so the earlier full-suite and production bundle evidence remains applicable.
- GitHub publication dry run returns HTTP403 for the authorized test branch. The published-SHA gate remains enforced. Test source has not been executed on Oracle, and the public service has not been restarted or changed.

- Final-source legacy-control smoke also restores and completes four movement samples with matching client state and no failures. This verifies both policies use the same probe; the twenty-second controls are too short and not isolated enough for a performance comparison.
- All three staged Oracle fixture SHA256 hashes match their local originals (60-minute lanes, 75-minute lanes, 60-minute legacy). Production remains healthy with zero active matches at revision ea9514b1e40420aca9336dbbf583370301e1e52b. Only input files were copied remotely; no test source/image/service was deployed.
