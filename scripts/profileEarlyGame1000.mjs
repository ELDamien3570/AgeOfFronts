import fs from "node:fs";
import path from "node:path";
import { Session } from "node:inspector";
import { PerformanceObserver } from "node:perf_hooks";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { RuntimeDiagnostics } from "../src/skirmish/RuntimeDiagnostics.ts";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};

const mapId = value("--map", "valles-kairulia");
const mapSize = Number(value("--size", "1000"));
const ticks = Number(value("--ticks", "1200"));
const seed = Number(value("--seed", "42"));

console.log(`=== Profiling Skirmish Early Game ===`);
console.log(`Map: ${mapId} (size ${mapSize})`);
console.log(`Ticks: ${ticks} (~${ticks / 20} simulated seconds)`);
console.log(`Seed: ${seed}`);

const settings = {
  ...defaultLobbySettings(mapId, mapSize),
  aiCount: 14,
  tribeCount: 30,
};
console.log(`Loading map assets...`);
const loaded = await loadServerMap(settings, undefined, seed);
const map = createSkirmishMap(
  loaded.map.width,
  loaded.map.height,
  loaded.map.terrain,
  loaded.map.elevation,
  loaded.map.forest,
  loaded.map.resourceTerrain
);

console.log(`Map dimensions: ${map.width()} x ${map.height()} (${map.width() * map.height()} tiles)`);

const options = {
  seed,
  aiCount: 14,
  tribeCount: 30,
  tribes: true,
  ruleset: "ages-v1",
  territoryIncomeScale: loaded.territoryIncomeScale,
  startingAge: "StoneAge",
  humanNames: ["Player 1"],
  aiEconomy: true,
  deferredPlanning: true,
  aiDefenses: true,
  aiNaval: true,
  aiWarPolicy: true,
};

const initStart = performance.now();
const game = new Skirmish(map, options);
// Make player 1 AI as well so match runs completely autonomously
game.players[0].ai = true;
const initMs = performance.now() - initStart;
console.log(`Initialization completed in ${initMs.toFixed(1)}ms`);
console.log(`Factions: ${game.players.length} (${game.players.filter(p => !p.ai).length} human, ${game.players.filter(p => p.ai && p.kind !== 'tribe').length} AI, ${game.players.filter(p => p.kind === 'tribe').length} tribes)`);
console.log(`Starting squads: ${game.squads.length}, buildings: ${game.buildings.length}`);

// GC Tracking
const gcEvents = [];
const gcObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcEvents.push({
      kind: entry.detail?.kind,
      duration: entry.duration,
      startTime: entry.startTime,
    });
  }
});
gcObserver.observe({ entryTypes: ["gc"] });

// Phase tracking
const phaseTimings = {};
const tickDurations = [];
game.onPhase = (phase, ms) => {
  if (!phaseTimings[phase]) phaseTimings[phase] = [];
  phaseTimings[phase].push(ms);
};

// Instrument subphases
const subphases = {};
const wrap = (name, obj, fnName) => {
  if (!obj || typeof obj[fnName] !== "function") return;
  const original = obj[fnName].bind(obj);
  obj[fnName] = (...params) => {
    const t0 = performance.now();
    try {
      return original(...params);
    } finally {
      const dt = performance.now() - t0;
      (subphases[name] ??= []).push(dt);
    }
  };
};

wrap("paths_warm_land", game.paths, "warm");
wrap("paths_warm_water", game.waterPaths, "warm");
wrap("routePlanner_step", game.routePlanner, "step");
wrap("drainRoutes", game, "drainRoutes");
wrap("capture_internal", game, "capture");
if (game.expansion) {
  wrap("expansion_beforeStep", game.expansion, "beforeStep");
  wrap("expansion_afterMovement", game.expansion, "afterMovement");
  wrap("expansion_engagements_step", game.expansion.engagements, "step");
  wrap("trade_stepPlanning", game.expansion.trade, "stepPlanning");
  wrap("battle_step", game.expansion.battle, "step");
  wrap("armies_step", game.expansion.armies, "step");
}
wrap("localAvoidance_step", game.avoidance, "step");
wrap("spatial_rebuild", game.heldSpatial, "rebuild");
wrap("territoryAbsorption_step", game.territoryAbsorption, "step");
wrap("coastalTerritory_step", game.coastalTerritory, "step");

// Setup CPU Profiler
const session = new Session();
session.connect();
const post = (method, params = {}) =>
  new Promise((res, rej) =>
    session.post(method, params, (err, r) => (err ? rej(err) : res(r)))
  );

await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 1000 }); // 1ms sample
await post("Profiler.start");

console.log(`Starting ${ticks} simulation ticks...`);
const simStart = performance.now();

for (let i = 0; i < ticks; i++) {
  const t0 = performance.now();
  game.step();
  const dt = performance.now() - t0;
  tickDurations.push(dt);

  if ((i + 1) % 300 === 0) {
    const elapsed = ((performance.now() - simStart) / 1000).toFixed(1);
    const avgMs = (tickDurations.slice(-300).reduce((a, b) => a + b, 0) / 300).toFixed(2);
    console.log(
      `Tick ${i + 1}/${ticks} (${elapsed}s elapsed) | Last 300 avg: ${avgMs}ms/tick | Squads: ${game.squads.length} | Buildings: ${game.buildings.length}`
    );
  }
}

const simTotalMs = performance.now() - simStart;
const cpuProfile = (await post("Profiler.stop")).profile;
session.disconnect();
gcObserver.disconnect();

console.log(`\nSimulation finished in ${(simTotalMs / 1000).toFixed(2)}s (${(simTotalMs / ticks).toFixed(2)}ms/tick average)`);

// Stats helpers
const stats = (arr) => {
  if (!arr || !arr.length) return { count: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, sum: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    count: arr.length,
    sum: Number(sum.toFixed(1)),
    mean: Number((sum / arr.length).toFixed(2)),
    p50: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p90: Number(sorted[Math.floor(sorted.length * 0.9)].toFixed(2)),
    p95: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    p99: Number(sorted[Math.floor(sorted.length * 0.99)].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
};

const tickStats = stats(tickDurations);

console.log(`\n================ TICK WALL-TIME STATS ================`);
console.log(`Total Ticks: ${tickStats.count}`);
console.log(`Mean: ${tickStats.mean} ms | Median (p50): ${tickStats.p50} ms | p90: ${tickStats.p90} ms | p95: ${tickStats.p95} ms | p99: ${tickStats.p99} ms | Max: ${tickStats.max} ms`);
console.log(`Ticks over 50ms budget: ${tickDurations.filter((t) => t > 50).length} (${((tickDurations.filter((t) => t > 50).length / ticks) * 100).toFixed(1)}%)`);
console.log(`Ticks over 100ms budget: ${tickDurations.filter((t) => t > 100).length} (${((tickDurations.filter((t) => t > 100).length / ticks) * 100).toFixed(1)}%)`);

console.log(`\n================ PHASE BREAKDOWN (via onPhase) ================`);
const phaseSummaries = Object.entries(phaseTimings)
  .map(([phase, samples]) => ({
    phase,
    ...stats(samples),
  }))
  .sort((a, b) => b.sum - a.sum);

console.log(`Phase          | Total (ms) | Mean (ms) | p95 (ms) | Max (ms) | % of Total Tick`);
console.log(`---------------|------------|-----------|----------|----------|----------------`);
for (const p of phaseSummaries) {
  const pct = ((p.sum / tickStats.sum) * 100).toFixed(1);
  console.log(
    `${p.phase.padEnd(14)} | ${String(p.sum).padStart(10)} | ${String(p.mean).padStart(9)} | ${String(p.p95).padStart(8)} | ${String(p.max).padStart(8)} | ${pct}%`
  );
}

console.log(`\n================ SUBPHASE BREAKDOWN ================`);
const subphaseSummaries = Object.entries(subphases)
  .map(([name, samples]) => ({
    name,
    ...stats(samples),
  }))
  .sort((a, b) => b.sum - a.sum);

console.log(`Subphase                    | Total (ms) | Mean (ms) | p95 (ms) | Max (ms)`);
console.log(`----------------------------|------------|-----------|----------|---------`);
for (const sp of subphaseSummaries) {
  console.log(
    `${sp.name.padEnd(27)} | ${String(sp.sum).padStart(10)} | ${String(sp.mean).padStart(9)} | ${String(sp.p95).padStart(8)} | ${String(sp.max).padStart(8)}`
  );
}

// CPU Profile Analysis
console.log(`\n================ V8 CPU PROFILE: TOP SELF-TIME FUNCTIONS ================`);
const nodeMap = new Map(cpuProfile.nodes.map((n) => [n.id, n]));
const selfSamples = new Map();
let totalSamples = cpuProfile.samples.length;
for (const id of cpuProfile.samples) {
  selfSamples.set(id, (selfSamples.get(id) ?? 0) + 1);
}

const topNodes = [...selfSamples.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .map(([id, sampleCount]) => {
    const node = nodeMap.get(id);
    const fnName = node.callFrame.functionName || "(anonymous)";
    const url = node.callFrame.url ? path.basename(node.callFrame.url) : "(native/eval)";
    const line = node.callFrame.lineNumber + 1;
    const pct = ((sampleCount / totalSamples) * 100).toFixed(2);
    return {
      fn: fnName,
      location: `${url}:${line}`,
      samples: sampleCount,
      percent: `${pct}%`,
    };
  });

console.log(`Function Name                  | Location             | Samples | Self %`);
console.log(`-------------------------------|----------------------|---------|-------`);
for (const item of topNodes) {
  console.log(
    `${item.fn.slice(0, 30).padEnd(30)} | ${item.location.slice(0, 20).padEnd(20)} | ${String(item.samples).padStart(7)} | ${item.percent}`
  );
}

// Memory and GC
console.log(`\n================ MEMORY & GC ================`);
const mem = process.memoryUsage();
console.log(`RSS: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`);
console.log(`GC Events: ${gcEvents.length}`);
if (gcEvents.length > 0) {
  const totalGcMs = gcEvents.reduce((a, b) => a + b.duration, 0);
  console.log(`Total GC Time: ${totalGcMs.toFixed(1)} ms`);
  console.log(`Max GC Pause: ${Math.max(...gcEvents.map((e) => e.duration)).toFixed(1)} ms`);
}

// Output JSON for detailed inspection
const outDir = "out/profile-results";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, `earlygame-${mapId}-${mapSize}.json`),
  JSON.stringify(
    {
      mapId,
      mapSize,
      ticks,
      seed,
      tickStats,
      phaseSummaries,
      subphaseSummaries,
      topNodes,
      gcEvents: { count: gcEvents.length, totalMs: gcEvents.reduce((a, b) => a + b.duration, 0) },
      finalEntities: {
        squads: game.squads.length,
        buildings: game.buildings.length,
        ships: game.ships.length,
      },
    },
    null,
    2
  )
);
console.log(`\nSaved summary to ${outDir}/earlygame-${mapId}-${mapSize}.json`);
