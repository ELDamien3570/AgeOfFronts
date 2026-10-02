# Smooth boat presentation investigation

Base: `ce5a316f3c8ed62be58637a63c5d222978a40dd0` (main, 2026-10-02).
Branch: `boat-presentation`. Local analysis/prototype; no merge or deployment.

## Recommendation

Use inexpensive, boat-only, adaptive linear interpolation first. Retarget from the
currently displayed pose when a packet arrives early; never restart interpolation
for unchanged duplicate ticks. Smooth heading by its shortest angular difference.
Use a separate continuously advancing clock for looping idle/sailing artwork.
Keep the recent single-authority server design, simulation rules, 20 Hz ticks,
200 ms multiplayer snapshots, and existing 60/30 FPS renderer budget.

The prototype implements this recommendation for both military/transport ships
(including automatic shore-transfer transports) and naval trade actors. Land
traders, land squads, aircraft, projectiles and combat clocks remain unchanged.

## Exact causes on main

- `Renderer.draw` draws `snapshot.ships` directly at authoritative x/y. Ships
  have heading tracking but no position interpolation, so 5 Hz online snapshots
  necessarily make them jump every ~200 ms.
- Naval traders already have position interpolation, but the renderer resets
  received time on duplicate ticks while TraderPresentation preserves its old
  endpoints. A duplicate packet can visibly rewind the trade boat. Early
  advancing packets can also jump to an endpoint not yet reached on screen.
- `PresentationClock.sample` advances only one tick at 1x (50 ms), then freezes.
  Normal 200 ms online packets therefore leave looping ship art stationary for
  about 150 ms. It jumps again when the next snapshot arrives.
- Ships and traders change headings at packet boundaries. Ship sailing state
  comes from destination rather than observed movement.

The base already has an adaptive global blend; the main issue is not a universal
hard-coded 100 ms interval. Military ships bypass that blend entirely.

## Prototype behavior and cost boundaries

`BoatPresentation` adds one small state record per ship or naval trader. It
maintains separate ID namespaces, reuses pose objects, and computes atan2/wrapped
turns only on snapshot updates. Per-frame sampling is arithmetic plus Map lookup.
Snapshot updates are O(boats); storage is bounded by live entities.

The current pose is reused for hull/artwork, strategic sprite batches, culling,
selection outlines, labels, route origins, click selection, double-click visible
selection and drag-box selection. Existing renderer drawing/culling/batching and
art zoom thresholds are preserved. All ships are sampled before existing viewport
culling; offscreen hulls do not perform artwork/draw work. There are no new draw
passes, effects, sprite sheets, network packets, simulation steps or workers.

Positions never extrapolate beyond the latest received target. A stopped boat
keeps its heading. Pause/winner settles to the authoritative location and freezes
cosmetic time. New/reused IDs spawn in place; removed IDs are discarded. Backward
ticks reset the cache. A gap of at least 1 second or a displacement greater than
8 map cells snaps rather than drawing a long crossing. Same-tick coordinate
corrections also snap. The 8-cell safeguard is deliberately presentation-only and
should be reviewed if future ships can travel more than that between packets.

Cosmetic time advances at 1x/2x/4x and freezes after 1.5 observed packet intervals
(minimum 100 ms) without another advancing snapshot. Its phase is independent of
combat timing. Merely stopping motion does not add a new rocking/wake effect.

## Measured comparison

Reproduce the dependency-free presentation benchmark with:

    node --expose-gc --import tsx scripts/benchmarkBoatPresentation.ts --output boat-presentation-benchmark.json

Node v24.19.0 on the shared cloud CPU. These are presentation-math microbenchmarks,
not complete browser frame times or FPS guarantees. No rendering, GPU work,
transport or simulation is included. The sampler was stress-tested at 120 Hz;
the real renderer still targets 60 FPS, or 30 above 1,000 squads+ships.

| Moving entities | Median pose pass | Raw-position baseline | Median snapshot update | Retained cache |
| --------------- | ---------------: | --------------------: | ---------------------: | -------------: |
| 100             | 0.0024–0.0027 ms |    See benchmark JSON |     See benchmark JSON |         ~35 KB |
| 1,000           | 0.0278–0.0279 ms |            ~0.0012 ms |         0.074–0.075 ms |        ~348 KB |
| 10,000          |   0.388–0.395 ms |            ~0.0143 ms |         0.891–0.921 ms |       ~3.65 MB |

Updates run at snapshot cadence (nominal 5/sec), not every rendered frame.
The 1,000-boat update therefore averages about 0.375 ms of CPU per second.
Stationary pose costs are similar. Despawn and repeated identity churn released
cache memory; a bounded 1,000-update test showed no unbounded retention.
Reported benchmark p95 values are percentiles of eleven amortized batches, not
individual browser frame tails; shared-host scheduling/GC caused outliers.

Synthetic continuous sailing results:

| Approach                                     | Regular 200 ms arrivals at 60 Hz | Alternating 150/250 ms arrivals                                       | Main trade-off                                                |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Current raw ship position                    | ~91.6% identical-position frames | Snapshot stepping                                                     | Current behavior                                              |
| Fixed 100 ms interpolation                   | ~50.5% identical-position frames | Repeated pauses                                                       | Finishes too early                                            |
| Existing trader-style adaptive interpolation | 0% steady repeats                | Up to 0.054-cell packet jump; duplicate packets can rewind ~0.10 cell | Timing resets                                                 |
| Prototype adaptive retargeting               | 0% steady repeats                | No packet discontinuity; ~12.7% plateau frames                        | Occasional late-packet pauses                                 |
| Buffered linear candidate                    | 0% steady repeats                | 0% in this fixture                                                    | ~300 ms source-time delay, including assumed 100 ms transport |
| Bounded extrapolation candidate              | Smooth straight-line fixture     | Predicts motion beyond evidence                                       | ~0.092-cell stop overshoot; ~0.141-cell turn correction       |

At 120 Hz raw positions repeat on ~95.8% of samples; the prototype remains 0%
under regular arrival and ~13% under that alternating-jitter fixture. At a corner,
linear interpolation can cut the chord between sampled positions; this fixture's
maximum was 0.05 map cells. It does not know the omitted full authoritative path.

**Second option if late-packet pauses remain noticeable:** a small ordered
snapshot buffer with a monotonic, gently adjusted playout time. It smooths jitter
better but adds visual latency and more state/reset complexity. Do not smoothstep
every position segment: repeated acceleration/deceleration makes straight sailing
less even. Do not raise network frequency or restore client simulation.

**Avoid positional extrapolation initially:** snapshots omit ship path segments;
predicting a turn can cross coastlines, overshoot a port, or keep a stopped boat
moving. Sinking/boarding/capture would need extra correction rules.

## Known separate art issue

Warship non-looping attack art currently receives absolute simulation time, so
it can clamp to its final frame. `fighting` also includes taking damage and is not
proof that a weapon fired. Fixing this requires clip-relative time from an
observed firing event and dedicated tests; this movement prototype deliberately
does not change attack events or projectile presentation. Idle/sailing loops use
the new clock. Authored 8/12 FPS artwork remains distinct from smooth 30/60 FPS
position and heading.

## Verification and limits

- 45 focused tests pass across BoatPresentation, TraderPresentation,
  UnitAnimation, FormationArtwork and AircraftPresentation (17 are new boat tests)
- New coverage includes 30/60/120 Hz sampling, 50/200 ms cadence, duplicates,
  early packets, stalls/tab return, pause/resume, 1x/2x/4x, angular wrap,
  stationary heading, teleport/correction, spawn/death/ID reuse, ID namespaces,
  snapshot immutability and reused pose storage
- Actual baseline/prototype Renderer Canvas2D capture passes: 151 deterministic
  frames, 151 aligned interpolated ship click checks, DPR 1 and 2. Native raster
  PNG/MP4 evidence is included; WebGL and a real browser remain unverified
- Full TypeScript check and production skirmish build pass
- Focused ESLint and Oxlint pass; existing build large-chunk warning remains
- OnlineMatchTransport passes in isolation; 26 Movement/Tribes/StateCodec tests
  pass when isolated from parallel broad-suite CPU contention
- Full suite is not green in this checkout: newer map LFS payloads remain
  unavailable locally; the same missing-asset failures occur on unchanged main.
  Broad parallel runs also hit timing tests on both branches. This is not claimed
  as a full regression pass. Hydrated older assets were SHA-256 matched against
  their exact LFS pointers; no asset changes belong to the patch.

Browser visual verification could not run here: locally launched Chromium cannot
create its process socket in this environment (including escalated execution),
and the cloud browser blocks the localhost preview URL. The standalone preview
below is provided for a normal browser playtest. No production FPS claim is made.

## Side-by-side browser preview

With repository LFS assets and ordinary dependencies available:

    git show ce5a316f3c8ed62be58637a63c5d222978a40dd0:src/skirmish/client/Renderer.ts > src/skirmish/client/RendererBoatBaseline.ts
    npm run play

Open `/scripts/boat-presentation-preview.html` on the local Vite server. It renders
main and prototype using the actual renderer and a repeatable fleet. Controls
switch regular cadence, jitter plus duplicate packets, and pause/resume. The
status line checks ship click targets against the displayed position. The
baseline copy is a QA helper, not a production import.

Before shipping, run a normal browser on the user's target hardware with a busy
match at strategic and close zoom, DPR 1/2, selected transports, trading fleets,
boarding/landing, turns near coastlines, and reconnect/pause. Measure full frame
CPU and GPU time, allocation/GC, server tick throughput and networking separately.

## Optional native raster reproduction

The included `scripts/BoatVisualQA.test.ts` uses the actual renderer in a small
Canvas2D/DOM adapter. Install optional `@napi-rs/canvas` in a throwaway checkout
(`npm install --no-save --package-lock=false @napi-rs/canvas`), generate the baseline
copy as above, and run `npx vitest run --config scripts/boat-qa.config.ts`.
It writes PNG frames to `../boat-presentation-results`. The MP4 was produced with
FFmpeg at 30 frames/sec. This is a renderer correctness/motion illustration,
not browser or GPU performance evidence.
