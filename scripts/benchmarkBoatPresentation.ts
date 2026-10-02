/**
 * Reproduce: node --expose-gc --import tsx scripts/benchmarkBoatPresentation.ts \
 *   --output ../boat-presentation-results/boat-presentation-benchmark.json
 *
 * Node microbenchmark only. No canvas, sprites, GPU, browser main-thread work,
 * culling, simulation, serialization, transport, or FPS measurement is included.
 * 60/120 Hz below are simulated invocation rates, not a display measurement.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { BoatPresentation } from "../src/skirmish/client/BoatPresentation";
import { TraderPresentation } from "../src/skirmish/client/TraderPresentation";
import { FIXED, type Snapshot } from "../src/skirmish/Protocol";

type Actor = { id: number; x: number; y: number; naval?: boolean };
type Vec = { x: number; y: number };
const rounded = (n: number) => Number(n.toFixed(6));
const percentile = (items: number[], q: number) => {
  const sorted = [...items].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  );
};
const stats = (values: number[]) => ({
  samples: values.length,
  mean: rounded(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
  p50: rounded(percentile(values, 0.5)),
  p95: rounded(percentile(values, 0.95)),
  max: rounded(values.length ? Math.max(...values) : 0),
});
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Vec, b: Vec, fraction: number): Vec => ({
  x: a.x + (b.x - a.x) * fraction,
  y: a.y + (b.y - a.y) * fraction,
});
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
let sink = 0;

// Synthetic fixture intentionally supplies only fields read by these presentation
// modules. It does not construct or benchmark a domain simulation or its packets.
function fixture(count: number, offset = 0) {
  const ships: Actor[] = [];
  const traders: Actor[] = [];
  for (let i = 0; i < count; i++) {
    const actor = { id: offset + i, x: i * 32, y: i * 16, naval: true };
    (i % 2 === 0 ? ships : traders).push(actor);
  }
  return { tick: 0, ships, expansion: { traders } } as unknown as Snapshot;
}
function actors(snapshot: Snapshot): Actor[] {
  return [...snapshot.ships, ...(snapshot.expansion?.traders ?? [])];
}
function mutate(snapshot: Snapshot, moving: boolean) {
  snapshot.tick += 4;
  if (moving)
    for (const actor of actors(snapshot)) {
      actor.x += 32;
      actor.y += 16;
    }
}

function benchmarkCost() {
  const records: object[] = [];
  for (const count of [100, 1_000, 10_000]) {
    for (const hz of [60, 120]) {
      for (const scenario of [
        { name: "moving_all_visible", moving: true, visibleFraction: 1 },
        { name: "stationary_all_visible", moving: false, visibleFraction: 1 },
        {
          name: "moving_90_percent_culled",
          moving: true,
          visibleFraction: 0.1,
        },
        { name: "moving_all_culled", moving: true, visibleFraction: 0 },
      ]) {
        const snapshot = fixture(count);
        const presentation = new BoatPresentation();
        presentation.update(snapshot, 0);
        const visibleShips = snapshot.ships.slice(
          0,
          Math.ceil(snapshot.ships.length * scenario.visibleFraction),
        );
        const visibleTraders = snapshot.expansion!.traders.slice(
          0,
          Math.ceil(
            snapshot.expansion!.traders.length * scenario.visibleFraction,
          ),
        );
        const rawBatch: number[] = [],
          poseBatch: number[] = [],
          updates: number[] = [];
        // Warm both paths. Alternate their order on later repetitions.
        for (let repetition = 0; repetition < 14; repetition++) {
          let rawElapsed = 0,
            poseElapsed = 0;
          for (let frame = 0; frame < hz; frame++) {
            const now = ((repetition * hz + frame) * 1_000) / hz;
            if (frame % (hz / 5) === 0) {
              mutate(snapshot, scenario.moving);
              const start = performance.now();
              presentation.update(snapshot, now);
              const elapsed = performance.now() - start;
              if (repetition >= 3) updates.push(elapsed);
            }
            const raw = () => {
              const start = performance.now();
              let sum = 0;
              for (const actor of visibleShips) sum += actor.x + actor.y;
              for (const actor of visibleTraders) sum += actor.x + actor.y;
              sink += sum;
              rawElapsed += performance.now() - start;
            };
            const posed = () => {
              const start = performance.now();
              presentation.frame(now, 1, false);
              let sum = 0;
              for (const actor of visibleShips) {
                const pose = presentation.shipPose(actor.id)!;
                sum += pose.x + pose.y + pose.angle + Number(pose.moving);
              }
              for (const actor of visibleTraders) {
                const pose = presentation.traderPose(actor.id)!;
                sum += pose.x + pose.y + pose.angle + Number(pose.moving);
              }
              sink += sum;
              poseElapsed += performance.now() - start;
            };
            if (repetition % 2) {
              posed();
              raw();
            } else {
              raw();
              posed();
            }
          }
          if (repetition >= 3) {
            rawBatch.push(rawElapsed / hz);
            poseBatch.push(poseElapsed / hz);
          }
        }
        const rawMedian = percentile(rawBatch, 0.5);
        const poseMedian = percentile(poseBatch, 0.5);
        const updateMean = updates.reduce((a, b) => a + b, 0) / updates.length;
        records.push({
          totalEntities: count,
          shipCount: snapshot.ships.length,
          traderCount: snapshot.expansion!.traders.length,
          simulatedCallsPerSecond: hz,
          scenario: scenario.name,
          cullBeforeSamplingIsHypothetical: scenario.visibleFraction < 1,
          sampledEntitiesPerFrame: visibleShips.length + visibleTraders.length,
          rawAmortizedMsPerFrame: stats(rawBatch),
          poseAmortizedMsPerFrame: stats(poseBatch),
          incrementalMedianMsPerFrame: rounded(poseMedian - rawMedian),
          snapshotUpdateMsAt5Hz: stats(updates),
          estimatedPresentationElapsedMsPerSimulatedSecond: rounded(
            poseMedian * hz + updateMean * 5,
          ),
          estimatedIncrementalElapsedMsPerSimulatedSecond: rounded(
            (poseMedian - rawMedian) * hz + updateMean * 5,
          ),
        });
      }
    }
  }
  return records;
}

function benchmarkMemory() {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) return { available: false, reason: "Run node with --expose-gc." };
  const collect = () => {
    gc();
    gc();
    gc();
    return process.memoryUsage().heapUsed;
  };
  const records: object[] = [];
  // Ensure module/JIT initialization is not charged wholly to the first size.
  {
    const warm = new BoatPresentation();
    warm.update(fixture(100), 0);
    warm.frame(100, 1, false);
  }
  collect();
  for (const count of [100, 1_000, 10_000]) {
    const live: number[] = [],
      afterLongRun: number[] = [],
      afterDespawn: number[] = [],
      afterChurn: number[] = [];
    let removedIdsAbsent = true;
    for (let repeat = 0; repeat < 5; repeat++) {
      const snapshot = fixture(count);
      const empty = fixture(0);
      const presentation = new BoatPresentation();
      const baseline = collect();
      presentation.update(snapshot, 0);
      live.push(collect() - baseline);
      for (let i = 1; i <= 1_000; i++) {
        mutate(snapshot, true);
        presentation.update(snapshot, i * 200);
        presentation.frame(i * 200 + 100, 1, false);
        sink += presentation.shipPose(snapshot.ships[0].id)!.x;
      }
      afterLongRun.push(collect() - baseline);
      empty.tick = snapshot.tick + 4;
      presentation.update(empty, 200_200);
      removedIdsAbsent &&=
        presentation.shipPose(snapshot.ships[0].id) === undefined;
      removedIdsAbsent &&=
        presentation.traderPose(snapshot.expansion!.traders[0].id) ===
        undefined;
      afterDespawn.push(collect() - baseline);
      // Reuse the source fixture so newly allocated packet arrays cannot be
      // mistaken for retained presentation state during the identity-churn test.
      for (let generation = 0; generation < 30; generation++) {
        for (const actor of snapshot.ships) actor.id += count;
        for (const actor of snapshot.expansion!.traders) actor.id += count;
        snapshot.tick = empty.tick + generation * 4 + 4;
        presentation.update(snapshot, 200_400 + generation * 200);
      }
      empty.tick += 128;
      presentation.update(empty, 207_000);
      afterChurn.push(collect() - baseline);
      // Keep the source arrays observably live through the final GC measurement.
      sink += snapshot.ships[0].x + snapshot.expansion!.traders[0].y;
    }
    records.push({
      totalEntities: count,
      cacheRetainedBytes: stats(live),
      after1000UpdatesBytes: stats(afterLongRun),
      afterDespawnBytes: stats(afterDespawn),
      after30FullIdentityChurnsAndDespawnBytes: stats(afterChurn),
      removedIdsAbsent,
    });
  }
  return {
    available: true,
    note: "GC heap deltas are noisy and not allocation counts; source fixtures existed before baseline, all numbers include V8 Map capacity/runtime effects. Negative deltas indicate GC/measurement noise. Five independent repetitions per size.",
    records,
  };
}

type Packet = {
  receiveAt: number;
  sourceAt: number;
  tick: number;
  position: Vec;
  duplicate: boolean;
};
type Model = { update(packet: Packet): void; sample(now: number): Vec };
type Motion = "straight" | "turn_and_stop";
function truePosition(t: number, motion: Motion): Vec {
  const seconds = Math.max(0, t) / 1_000;
  if (motion === "straight") return { x: seconds, y: 0 };
  return {
    x: Math.min(seconds, 4.1),
    y: Math.max(0, Math.min(seconds - 4.1, 3)),
  };
}
function packetsFor(cadence: string, motion: Motion) {
  const packets: Packet[] = [];
  const cadenceMs = cadence === "local_50ms" ? 50 : 200;
  for (let i = 0; i <= 10000 / cadenceMs; i++) {
    const sourceAt = i * cadenceMs;
    const receiveAt =
      sourceAt + 100 - (cadence === "jitter_150_250ms" && i % 2 ? 50 : 0);
    const packet = {
      sourceAt,
      receiveAt,
      tick: sourceAt / 50,
      position: truePosition(sourceAt, motion),
      duplicate: false,
    };
    packets.push(packet);
    if (cadence === "duplicate_tick_at_50ms")
      packets.push({ ...packet, receiveAt: receiveAt + 50, duplicate: true });
  }
  return packets.sort((a, b) => a.receiveAt - b.receiveAt);
}
function singleSnapshot(packet: Packet) {
  const actor = {
    id: 0,
    x: packet.position.x * FIXED,
    y: packet.position.y * FIXED,
    naval: true,
  };
  return {
    tick: packet.tick,
    ships: [actor],
    expansion: { traders: [actor] },
  } as unknown as Snapshot;
}
function makeModel(name: string): Model {
  if (name === "raw_authoritative") {
    let current: Vec = { x: 0, y: 0 };
    return {
      update: (p) => {
        current = p.position;
      },
      sample: () => ({ ...current }),
    };
  }
  if (name === "prototype_retargeted_adaptive") {
    const model = new BoatPresentation();
    return {
      update: (p) => model.update(singleSnapshot(p), p.receiveAt),
      sample: (now) => {
        model.frame(now, 1, false);
        const pose = model.shipPose(0);
        return pose ? { x: pose.x / FIXED, y: pose.y / FIXED } : { x: 0, y: 0 };
      },
    };
  }
  if (
    name === "naive_previous_fixed_100ms" ||
    name === "existing_trader_previous_adaptive"
  ) {
    const trader = new TraderPresentation();
    let receivedAt = 0,
      arrivalMs = 0,
      previousTick = 0,
      tick = 0;
    return {
      update: (p) => {
        // This intentionally reproduces Renderer arrival-clock behavior, including
        // duplicate-packet resets, while using the real TraderPresentation class.
        previousTick = tick;
        tick = p.tick;
        if (receivedAt) {
          const gap = p.receiveAt - receivedAt;
          if (gap < 1_000)
            arrivalMs = arrivalMs ? arrivalMs * 0.8 + gap * 0.2 : gap;
        }
        receivedAt = p.receiveAt;
        trader.update(singleSnapshot(p));
      },
      sample: (now) => {
        const interval =
          name === "naive_previous_fixed_100ms"
            ? 100
            : arrivalMs
              ? Math.min(600, Math.max(50, arrivalMs))
              : Math.max(50, (tick - previousTick) * 50);
        const pose = trader.pose(
          0,
          tick,
          Math.min(1, (now - receivedAt) / interval),
        );
        return pose ? { x: pose.x / FIXED, y: pose.y / FIXED } : { x: 0, y: 0 };
      },
    };
  }
  const history: Packet[] = [];
  return {
    update: (packet) => {
      if (!packet.duplicate) history.push(packet);
      if (history.length > 12) history.shift();
    },
    sample: (now) => {
      if (!history.length) return { x: 0, y: 0 };
      if (name === "buffered_linear_300ms_source_delay") {
        const target = now - 300;
        const index = history.findIndex((p) => p.sourceAt >= target);
        if (index === 0) return { ...history[0].position };
        if (index < 0) return { ...history[history.length - 1].position };
        const a = history[index - 1],
          b = history[index];
        return mix(
          a.position,
          b.position,
          clamp01((target - a.sourceAt) / (b.sourceAt - a.sourceAt)),
        );
      }
      const latest = history[history.length - 1],
        prior = history[history.length - 2];
      if (!prior) return { ...latest.position };
      // Experimental hybrid: interpolate when the target is already bracketed;
      // otherwise predict from the two latest samples for at most 250 ms.
      // Assumes tick->wall-clock alignment and a known 100 ms transport baseline.
      const target = now - 100;
      if (target < latest.sourceAt) {
        const index = history.findIndex((p) => p.sourceAt >= target);
        if (index === 0) return { ...history[0].position };
        const a = history[index - 1],
          b = history[index];
        return mix(
          a.position,
          b.position,
          clamp01((target - a.sourceAt) / (b.sourceAt - a.sourceAt)),
        );
      }
      const predict = Math.max(0, Math.min(250, target - latest.sourceAt));
      return mix(
        prior.position,
        latest.position,
        1 + predict / (latest.sourceAt - prior.sourceAt),
      );
    },
  };
}
function benchmarkCadence() {
  const rows: object[] = [];
  const names = [
    "raw_authoritative",
    "naive_previous_fixed_100ms",
    "existing_trader_previous_adaptive",
    "prototype_retargeted_adaptive",
    "buffered_linear_300ms_source_delay",
    "bounded_extrapolation_250ms",
  ];
  for (const cadence of [
    "regular_200ms",
    "jitter_150_250ms",
    "duplicate_tick_at_50ms",
    "local_50ms",
  ]) {
    for (const hz of [60, 120])
      for (const motion of ["straight", "turn_and_stop"] as Motion[])
        for (const name of names) {
          const model = makeModel(name),
            packets = packetsFor(cadence, motion);
          let nextPacket = 0,
            previous: Vec | undefined;
          let staticFrames = 0,
            frameCount = 0,
            backwardsDistance = 0;
          const frameSteps: number[] = [],
            updateJumps: number[] = [],
            duplicateJumps: number[] = [],
            errorNow: number[] = [],
            errorDelayed: number[] = [];
          let maxCornerCut = 0,
            maxStopOvershoot = 0;
          for (let frame = 0; frame <= 10 * hz; frame++) {
            const now = (frame * 1_000) / hz;
            while (
              nextPacket < packets.length &&
              packets[nextPacket].receiveAt <= now + 1e-7
            ) {
              const packet = packets[nextPacket++];
              const before = model.sample(packet.receiveAt);
              model.update(packet);
              const after = model.sample(packet.receiveAt);
              if (packet.receiveAt >= 1_000 && packet.receiveAt <= 9_500) {
                (packet.duplicate ? duplicateJumps : updateJumps).push(
                  distance(before, after),
                );
              }
            }
            const p = model.sample(now);
            if (now >= 1_000 && now <= 9_500 && previous) {
              frameCount++;
              const step = distance(p, previous);
              // Plateau/jump metrics apply only to continuous straight-line motion.
              if (step < 1e-9) staticFrames++;
              backwardsDistance += Math.max(0, previous.x - p.x);
              frameSteps.push(step);
              errorNow.push(distance(p, truePosition(now, motion)));
              errorDelayed.push(distance(p, truePosition(now - 300, motion)));
              if (motion === "turn_and_stop") {
                if (p.x < 4.1 && p.y > 0)
                  maxCornerCut = Math.max(
                    maxCornerCut,
                    Math.min(4.1 - p.x, p.y),
                  );
                if (now >= 7_100)
                  maxStopOvershoot = Math.max(
                    maxStopOvershoot,
                    p.y - 3,
                    p.x - 4.1,
                  );
              }
            }
            previous = p;
          }
          rows.push({
            cadence,
            simulatedRenderHz: hz,
            motion,
            model: name,
            measuredFrames: frameCount,
            staticFramePercent: rounded((staticFrames / frameCount) * 100),
            frameDisplacementTiles: stats(frameSteps),
            maxFrameStepRelativeToStraightIdeal: rounded(
              Math.max(...frameSteps) * hz,
            ),
            deliveryDiscontinuityTiles: stats(updateJumps),
            duplicateDeliveryDiscontinuityTiles: stats(duplicateJumps),
            totalBackwardsXDistanceTiles: rounded(backwardsDistance),
            meanPositionErrorVsPresentTiles: stats(errorNow).mean,
            meanPositionErrorVs300msDelayedTruthTiles: stats(errorDelayed).mean,
            maxCornerCutTiles: rounded(maxCornerCut),
            maxStopOvershootTiles: rounded(maxStopOvershoot),
          });
        }
  }
  return {
    parameters: {
      durationMs: 10_000,
      measuredWindowMs: [1_000, 9_500],
      velocityTilesPerSecond: 1,
      baseTransportDelayMs: 100,
      jitterTransportDelaysMs: [100, 50],
      jitterReceiveIntervalsMs: [150, 250],
      duplicateOffsetMs: 50,
      turnAtSourceMs: 4_100,
      stopAtSourceMs: 7_100,
      bufferedTargetSourceDelayMs: 300,
      extrapolationCapMs: 250,
    },
    caveats: [
      "Deterministic synthetic trajectories, not recorded match telemetry or screen capture.",
      "Cadence metrics do not time CPU. Static-frame percentage only diagnoses smoothness on straight continuous motion; stops intentionally create static frames.",
      "Delivery discontinuity compares position immediately before and after a packet at the same timestamp. This separates mathematical jumps from frame-rate sampling.",
      "One tile/second gives a 1/60 or 1/120 tile ideal per-frame step. Overshoot, lag and corner-cut metrics are in world tiles, not screen pixels.",
      "The buffered and extrapolated candidates assume server/source tick mapping to local wall time; they are conceptual candidates, not production integrations.",
      "The fixed 300ms source delay includes a synthetic 100ms transport baseline plus 200ms presentation lag.",
      "Bounded extrapolation can be wrong around a turn or stop, and does not establish authoritative gameplay position.",
    ],
    rows,
  };
}

const started = performance.now();
// Discard one complete pass to warm V8 at every size and visibility shape.
benchmarkCost();
const costs = benchmarkCost();
const memory = benchmarkMemory();
const cadence = benchmarkCadence();
const output = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : "../boat-presentation-results/boat-presentation-benchmark.json";
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    pid: process.pid,
  },
  implementationSha256: createHash("sha256")
    .update(
      readFileSync(
        new URL("../src/skirmish/client/BoatPresentation.ts", import.meta.url),
      ),
    )
    .digest("hex"),
  command:
    "node --expose-gc --import tsx scripts/benchmarkBoatPresentation.ts --output ../boat-presentation-results/boat-presentation-benchmark.json",
  scope:
    "Presentation update + frame clock + shipPose/traderPose only. CPU timings exclude rendering/GPU/canvas/culling, DOM/UI, worker work, transport, deserialization, and snapshot construction. Not an FPS measurement or a whole-game performance prediction.",
  method:
    "Half military ships / half naval traders; one complete discarded pass, then 3 simulated seconds warmup + 11 measured one-second batches per case. Pose/raw order alternates; observed positions are consumed in a sink. Frame statistics summarize amortized per-frame costs across batches, not real-time frame-tail latency. Updates are timed separately at 5 Hz; Offscreen cases hypothetically preselect visible entities and exclude culling cost; the current Renderer samples every ship pose before viewport culling. The actual renderer remains capped at 60/30 FPS: 120 Hz here is sampler stress only. Timing 100-entity batches can be dominated by timer/JIT/scheduler noise. Shared-host measurements should be reproduced on target devices.",
  costResults: costs,
  memoryResults: memory,
  cadenceResults: cadence,
  elapsedWallSeconds: rounded((performance.now() - started) / 1000),
  sink,
};
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Wrote ${resolve(output)} in ${report.elapsedWallSeconds}s (${costs.length} cost cases; ${cadence.rows.length} cadence cases).`,
);
