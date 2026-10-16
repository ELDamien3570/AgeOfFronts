/**
 * IdleTick: opt-in idle-tick probe for roadmap Next #2 (I-0 to I-3).
 *
 * 8 human seats + 14 AI nations + 30 tribes (52 factions) on a 500-wide map.
 * A 1,200-tick all-AI warm-up is generated at run time (or read from CKPT),
 * then a variant is measured in 400-tick windows. Ported from the review
 * harness (review-notes 22, scratch idle-tick/ common/fork/warm/movers/ab).
 *
 * NOT part of any test suite (a .ts script, not a .test.ts file) and NOT a
 * gate on its own: run it on a quiet host. Every window reports thread CPU
 * against wall time; a window with wall/CPU > 1.5 is flagged as contended.
 *
 * Usage (from the repo root):
 *   npm run perf:idle-tick -- [mig|med] [idle|ai|hold] [measure=4800] [perSeat=60] [tag]
 * Environment:
 *   OUTDIR=<dir>     output directory (default out/idle-tick, gitignored)
 *   CKPT=<file>      restore this v8-serialized warm checkpoint instead of warming
 *   SAVE_CKPT=<file> write the warm checkpoint (v8.serialize) after warming
 *   WARM=<ticks>     warm-up ticks (default 1200)
 *   CAP=0            run on the main thread without the 384 MB old-space cap
 * Variants: "ai" = all 52 factions on AI; "idle" = 8 seats on human control
 * with perSeat injected squads each (480) and no commands (the Next #2 gate
 * configuration); "hold" = idle plus an explicit hold order per seat.
 * The gate window is ticks 1,200 to 6,000 (measure 4,800).
 * Behaviour equality: windows[].squadDigest of two builds run from the same
 * CKPT must match window by window (Mig 500 idle at aof/next-1 da24feff:
 * tick 1600 f8470043..., tick 2000 e28594b7...). Do not combine with
 * --cpu-prof: the profiler makes the thread CPU clock under-read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { Skirmish } from "../../../src/skirmish/Simulation";
import type { Squad } from "../../../src/skirmish/Protocol";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { CPU_WINDOW_TICKS, ThreadCpuWindow, threadCpuClock, WALL_PER_CPU_FLAG } from "../../../src/skirmish/RuntimeDiagnostics";
import { squadDigest } from "../fixtures/IdleTickFixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SEED = 1272661902;

export async function buildIdleTickMatch(mapArg: string, seed = SEED): Promise<Skirmish> {
  const mapId = mapArg === "mig" ? "migration" : "heightmap-test1";
  const settings = { ...defaultLobbySettings(mapId, 500), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" } as any;
  const loaded = await loadServerMap(settings, `${REPO}/resources`, seed);
  const options = { ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed,
    humanNames: Array.from({ length: 8 }, (_, i) => `H${i + 1}`), aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1",
    victoryMode: "solo", technologySpeed: 1, startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1,
    infiniteGoldForPlayers: false, alliances: false, territoryIncomeScale: loaded.territoryIncomeScale } as any;
  const m = loaded.map;
  return new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), options);
}

/** Same deterministic injection as review-notes 16/22: the six most common
 * regular-faction squad types, perSeat per human seat on owned land near base. */
export function injectArmies(game: Skirmish, perSeat = 60, stride = 3): number[] {
  const g = game as any;
  const counts = new Map<string, { kind: string; definitionId: string; n: number }>();
  for (const s of game.squads) {
    const p = game.player(s.playerId);
    if (!p || p.kind !== "regular" || !s.definitionId || s.embarkedOn !== null || s.afloat) continue;
    const key = `${s.kind}|${s.definitionId}`;
    const row = counts.get(key) ?? { kind: s.kind, definitionId: s.definitionId, n: 0 }; row.n++; counts.set(key, row);
  }
  const mix = [...counts.values()].sort((a, b) => b.n - a.n || (a.definitionId < b.definitionId ? -1 : 1)).slice(0, 6);
  const total = mix.reduce((a, r) => a + r.n, 0);
  const plan: { kind: string; definitionId: string }[] = [];
  for (const r of mix) for (let i = 0; i < Math.round(perSeat * r.n / total); i++) plan.push(r);
  while (plan.length < perSeat) plan.push(mix[0]);
  plan.length = perSeat;
  const before = g.nextId as number;
  for (let id = 1; id <= 8; id++) {
    const player = game.player(id);
    if (!player || player.eliminated) continue;
    const tiles = game.ownedLandNearest(id, player.base, stride === 3 ? 2000 : 6000).filter(t => game.map.isLand(t));
    for (let k = 0; k < plan.length && tiles.length; k++)
      g.spawnSquad(player, plan[k].kind, tiles[Math.min(tiles.length - 1, 4 + k * stride)], plan[k].definitionId, false);
  }
  return game.squads.filter(s => s.id >= before).map(s => s.id);
}

export const stats = (values: number[]) => {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))];
  const r = (v: number) => +v.toFixed(2);
  return { n: s.length, mean: r(values.reduce((a, b) => a + b, 0) / values.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) };
};

async function main(argv: string[]) {
  const [mapArg = "mig", variant = "idle", measureArg = "4800", perArg = "60", tag = ""] = argv;
  const MEASURE = Number(measureArg), PER = Number(perArg), WARM = Number(process.env.WARM ?? 1200);
  const OUTDIR = process.env.OUTDIR ?? path.join(REPO, "out", "idle-tick");
  mkdirSync(OUTDIR, { recursive: true });
  const OUT = path.join(OUTDIR, `idle-tick-${mapArg}-${variant}-${MEASURE}${tag}.json`);
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  const mb = (bytes: number) => +(bytes / 1048576).toFixed(1);
  const game = await buildIdleTickMatch(mapArg), g = game as any;
  const warmStarted = performance.now();
  if (process.env.CKPT) game.restore(v8.deserialize(readFileSync(process.env.CKPT)));
  else {
    for (let id = 1; id <= 8; id++) game.setAiController(id, true);
    for (let i = 1; i <= WARM; i++) { game.step(); if (i % 400 === 0) console.log("warm", i, game.squads.length); }
    if (process.env.SAVE_CKPT) writeFileSync(process.env.SAVE_CKPT, v8.serialize(game.checkpoint()));
  }
  const warmMs = performance.now() - warmStarted;
  let injected = 0;
  if (variant !== "ai") {
    const ids = injectArmies(game, PER);
    injected = ids.length;
    for (let id = 1; id <= 8; id++) game.setAiController(id, false);
    if (variant === "hold") for (let id = 1; id <= 8; id++) {
      const own = ids.filter(sid => game.squad(sid)?.playerId === id);
      if (own.length) game.applyCommand({ type: "order", playerId: id, squadIds: own, order: { type: "hold" } } as any);
    }
  }
  // ---- instrumentation (instance wrappers only; the simulation is unchanged) ----
  const phaseRows = new Map<string, number[]>();
  game.onPhase = (phase: string, ms: number) => { let r = phaseRows.get(phase); if (!r) phaseRows.set(phase, r = []); r.push(ms); };
  let marchRequests = 0;
  const routeWork = g.routeWork, request = routeWork.request.bind(routeWork);
  routeWork.request = (key: string, units: number, task: unknown) => { if (key.startsWith("march:")) marchRequests++; return request(key, units, task); };
  const counters = () => ({ ...(g.idleTickWork ?? {}), envelope: { ...g.facingGeometry.telemetry } });
  const delta = (a: any, b: any): any => {
    const out: any = {};
    for (const k of Object.keys(b)) out[k] = typeof b[k] === "number" ? +(((b[k] - (a?.[k] ?? 0)) / CPU_WINDOW_TICKS).toFixed(2)) : delta(a?.[k], b[k]);
    return out;
  };
  const cpuWindow = new ThreadCpuWindow(CPU_WINDOW_TICKS);
  const prev = new Map<number, number>();
  const windows: any[] = [], tickAll: number[] = [], cpuAll: number[] = [];
  let movers = { all: 0, tribe: 0, tribeMove: 0 }, peakHeap = 0, lastCounters = counters();
  console.log("start", JSON.stringify({ map: mapArg, variant, tick: game.tick, squads: game.squads.length, injected, warmMs: Math.round(warmMs) }));
  for (const [, r] of phaseRows) r.length = 0;
  const measureStarted = performance.now();
  for (let i = 1; i <= MEASURE; i++) {
    const c0 = threadCpuClock(), w0 = performance.now();
    game.step();
    const wall = performance.now() - w0, c1 = threadCpuClock();
    const cpu = c0 === undefined || c1 === undefined ? undefined : c1 - c0;
    cpuWindow.add(1, wall, cpu);
    if (cpu !== undefined) cpuAll.push(cpu);
    for (const s of game.squads as readonly Squad[]) {
      if (s.embarkedOn !== null) continue;
      const key = s.x * 4096 + s.y, moved = prev.has(s.id) && prev.get(s.id) !== key;
      prev.set(s.id, key);
      if (!moved) continue;
      movers.all++;
      if (game.player(s.playerId)?.kind === "tribe") { movers.tribe++; if (s.order.type === "move") movers.tribeMove++; }
    }
    if (i % 25 === 0) peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    if (i % CPU_WINDOW_TICKS === 0 || i === MEASURE) {
      const n = Math.max(1, phaseRows.get("tick")?.length ?? 1);
      const phases: any = {};
      for (const [phase, rows] of phaseRows) { phases[phase] = stats(rows); if (phase === "tick") tickAll.push(...rows); rows.length = 0; }
      const heapUsed = process.memoryUsage().heapUsed, gcStarted = performance.now();
      gc();
      const fullGcMs = performance.now() - gcStarted, liveHeap = process.memoryUsage().heapUsed;
      const now = counters(), cpuSummary = cpuWindow.snapshot();
      const row = {
        tick: game.tick, squads: game.squads.length, alive: game.players.filter(p => !p.eliminated).length,
        cpu: cpuSummary && { perTickMs: +cpuSummary.meanThreadMs.toFixed(2), wallPerTickMs: +cpuSummary.meanWallMs.toFixed(2),
          wallPerCpu: cpuSummary.wallPerCpu && +cpuSummary.wallPerCpu.toFixed(3), flagged: cpuSummary.flagged, complete: cpuSummary.complete },
        heap: { usedMb: mb(heapUsed), liveMb: mb(liveHeap), peakMb: mb(peakHeap), fullGcMs: +fullGcMs.toFixed(1) },
        squadDigest: squadDigest(game.squads),
        movers: { all: +(movers.all / n).toFixed(1), tribe: +(movers.tribe / n).toFixed(1), tribeMove: +(movers.tribeMove / n).toFixed(1) },
        marchCohortsPerTick: +(marchRequests / n).toFixed(2),
        planner: game.routePlanner.pendingCount, admissions: game.movementAdmission.pendingCount,
        work: delta(lastCounters, now), phases,
      };
      windows.push(row);
      lastCounters = now; movers = { all: 0, tribe: 0, tribeMove: 0 }; marchRequests = 0; peakHeap = 0;
      console.log(JSON.stringify({ t: row.tick, tick: phases.tick?.mean, p99: phases.tick?.p99, cpu: row.cpu, heap: row.heap, movers: row.movers, cohorts: row.marchCohortsPerTick, digest: row.squadDigest.slice(0, 12) }));
      writeFileSync(OUT, JSON.stringify({ map: mapArg, variant, perSeat: PER, measure: MEASURE, warm: WARM, cap: process.env.CAP !== "0",
        flagRule: `wall/CPU > ${WALL_PER_CPU_FLAG}`, wallSec: +((performance.now() - measureStarted) / 1000).toFixed(0),
        tickAll: stats(tickAll), cpuAll: stats(cpuAll), windows }, null, 1));
    }
  }
  console.log("done", OUT, JSON.stringify({ tick: stats(tickAll), cpu: stats(cpuAll) }));
}

// The production match worker runs with a 384 MB old-space cap (ReservedMatchWorker).
const entry = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === entry;
if (!isMainThread && workerData?.idleTick) await main(workerData.argv).finally(() => parentPort?.close());
else if (invokedDirectly) {
  if (process.env.CAP === "0") await main(process.argv.slice(2));
  else {
    const worker = new Worker(entry, { execArgv: ["--import", "tsx"], resourceLimits: { maxOldGenerationSizeMb: 384 },
      workerData: { idleTick: true, argv: process.argv.slice(2) } });
    worker.on("error", error => { console.error("WORKER ERROR", error); process.exitCode = 1; });
    worker.on("exit", code => { if (code) process.exitCode = code; });
  }
}
