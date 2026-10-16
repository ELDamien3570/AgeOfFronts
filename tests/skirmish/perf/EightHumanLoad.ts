/**
 * EightHumanLoad: in-process load harness for roadmap Next #1 (perf ranks 1-3, 5).
 *
 * 8 scripted ACTIVE humans + 14 AI nations + 30 tribes on a 500-wide map.
 * Mirrors serverMatchWorker "advance" (1 tick per advance, LiveMatch 5 Hz
 * sim-time publication gate, publish-on-command) in one process: Skirmish +
 * CommandApplications + SnapshotEncoder + the snapshot encoding worker.
 * Humans act on a seeded PRNG in simulated time, so a run is deterministic
 * apart from the wall-clock measurements.
 *
 * NOT part of any test suite (it is a .ts script, not a .test.ts file).
 * Ported from the review harness (notes 16) and its Now-batch adaptation.
 *
 * Usage (from the repo root; one Med 500 run takes about 10 minutes):
 *   node --import tsx tests/skirmish/perf/EightHumanLoad.ts <med|mig> <humans|idle> [seed=1272661902] [warm=1200] [measure=4800] [tag]
 * Environment:
 *   OUTDIR=<dir>   where out-<map>-<mode><tag>.json (+ .summary.json, .commands.json) go (default ".")
 *   PROFILE=1      per-window admission/planner profile (instance wrappers, no prototype patching)
 *   ARMY=<n>       squads injected per human seat at the warm-up boundary (default 60)
 *   DUMP=1         also write every measured publication to out-...pubs.bin
 *   DESIGN_B=1     publish only at the 5 Hz gate (Next #4 N6a), not on commands
 *   CHECKPOINT_EVERY=<n>  take match.checkpoint() every n ticks, as the worker's
 *                  MatchJournal does (Next #10; 20 in production). Timed apart
 *                  from tickAll, reported as checkpointMs and tickPlusCheckpoint.
 *   SAVE_CKPT=<file>  write the warm checkpoint (v8.serialize) after tick <warm>
 *   CKPT=<file>    restore that warm checkpoint instead of running the warm-up
 *                  (same map, seed and warm; the measured run is identical)
 *   HPA_PROBE=1    time every synchronous HierarchicalPaths.find (R2-P2) and
 *                  report the slowest calls with their callers in the summary
 * Mode "idle" is the control: same seed and armies, human seats on human
 * control, but no commands are issued.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import * as v8 from "node:v8";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { SnapshotEncoder } from "../../../src/skirmish/SnapshotCodec";
import { CanonicalStateStream } from "../../../src/skirmish/client/CanonicalStateStream";
import { RuntimeDiagnostics } from "../../../src/skirmish/RuntimeDiagnostics";
import { commandSchema } from "../../../src/skirmish/multiplayer/CommandSchema";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";
import { researchRejection } from "../../../src/skirmish/domain/Progression";
import { availableGold } from "../../../src/skirmish/domain/Gold";
import { SnapshotEncodingWorker } from "../../../src/skirmish/multiplayer/infrastructure/SnapshotEncodingWorker";
import { HierarchicalPaths } from "../../../src/skirmish/HierarchicalPaths";

/* eslint-disable @typescript-eslint/no-explicit-any */
const REPO_FS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const encoding = new SnapshotEncodingWorker();

const [mapArg = "med", mode = "humans", seedArg = "1272661902", warmArg = "1200", measureArg = "4800", tag = ""] = process.argv.slice(2);
const seed = Number(seedArg), WARM = Number(warmArg), MEASURE = Number(measureArg);
const mapId = mapArg === "mig" ? "migration" : "heightmap-test1";
const OUT = `${(process.env.OUTDIR ?? ".")}/out-${mapArg}-${mode}${tag}.json`;
const FIXED = 256, TICK_MS = 125, SNAPSHOT_MS = 200, QUEUE_CAP = 100;
const SHAPES = ["mass", "shield-wall", "square", "line", "wedge", "modern-loose", "column"];
const BUILD_TYPES = ["barracks", "archery", "stables", "city", "factory", "mine", "blacksmith", "depot", "tower", "port", "armory", "siege-workshop"];

const settings = { ...defaultLobbySettings(mapId, 500), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" } as any;
const loaded = await loadServerMap(settings, `${REPO_FS}/resources`, seed);
const humanNames = Array.from({ length: 8 }, (_, i) => `H${i + 1}`);
const options = { ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed,
  humanNames, aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1", victoryMode: "solo", technologySpeed: 1,
  startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1, infiniteGoldForPlayers: false, alliances: false,
  territoryIncomeScale: loaded.territoryIncomeScale } as any;
const m = loaded.map;
const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), options);
const map = game.map, W = m.width, H = m.height;
// Optional profiling of admission/planner internals (PROFILE=1): wall+CPU inside stepAdmissions, planner refusals by class.
const prof = { stepAdmCalls: 0, stepAdmMs: 0, stepAdmCpu: 0, stepAdmPrioMs: 0, stepAdmPending: 0, reqHuman: 0, reqHumanRefused: 0, reqAi: 0, reqAiRefused: 0, reqTrade: 0, reqTradeRefused: 0, humanByKind: {} as Record<string, { requests: number; refused: number }> };
const measuringRef = { on: false };
if (process.env.PROFILE) {
  // Explicit instance wrappers of the public entry points (the private
  // stepAdmissions is no longer patched): wall + CPU per admission call and
  // planner refusals by request class.
  const admission = game.movementAdmission as any;
  const wrapStep = (name: "step" | "stepInteractive", priority: boolean) => {
    const original = admission[name].bind(admission);
    admission[name] = (tick: number, budget: number) => {
      const c0 = (process as any).threadCpuUsage(), t = performance.now();
      try { return original(tick, budget); }
      finally {
        const ms = performance.now() - t, c1 = (process as any).threadCpuUsage();
        if (measuringRef.on) { prof.stepAdmCalls++; prof.stepAdmMs += ms; prof.stepAdmCpu += (c1.user - c0.user + c1.system - c0.system) / 1000; if (priority) prof.stepAdmPrioMs += ms; prof.stepAdmPending += game.movementAdmission.pendingCount; }
      }
    };
  };
  wrapStep("step", false); wrapStep("stepInteractive", true);
  const planner = game.routePlanner as any, request = planner.request.bind(planner);
  planner.request = (r: any) => { const ok = request(r); if (measuringRef.on) { const c = r.context; const human = c.playerId >= 1 && c.playerId <= 8 && !game.player(c.playerId)?.ai; const trade = c.kind === "domain" && c.owner === "trade";
    if (human) { prof.reqHuman++; if (!ok) prof.reqHumanRefused++; const kind = `${c.kind}${c.operation ? ":" + c.operation : ""}${c.owner ? ":" + c.owner : ""}`, row = (prof.humanByKind[kind] ??= { requests: 0, refused: 0 }); row.requests++; if (!ok) row.refused++; } else if (trade) { prof.reqTrade++; if (!ok) prof.reqTradeRefused++; } else { prof.reqAi++; if (!ok) prof.reqAiRefused++; } } return ok; };
}
// R2-P2 probe: synchronous hierarchical finds (cold crossing trees build inside them).
const hpaFinds = { calls: 0, over50: 0, maxMs: 0, slowest: [] as { tick: number; ms: number; caller: string }[] };
if (process.env.HPA_PROBE) {
  const find = HierarchicalPaths.prototype.find;
  HierarchicalPaths.prototype.find = function (this: HierarchicalPaths, start: number, goal: number) {
    const t = performance.now();
    try { return find.call(this, start, goal); }
    finally {
      const ms = performance.now() - t;
      if (measuringRef.on) {
        hpaFinds.calls++; if (ms > 50) hpaFinds.over50++; hpaFinds.maxMs = Math.max(hpaFinds.maxMs, ms);
        if (ms > 20) {
          hpaFinds.slowest.push({ tick: game.tick, ms: +ms.toFixed(1), caller: String(new Error().stack).split(String.fromCharCode(10)).slice(2, 7).map(l => l.trim().replace(/\(.*[\\/]/, "(")).join(" < ") });
          hpaFinds.slowest.sort((a, b) => b.ms - a.ms); hpaFinds.slowest.length = Math.min(hpaFinds.slowest.length, 12);
        }
      }
    }
  };
}
console.log("map", mapId, W, "x", H, "players", game.players.length);
for (let id = 1; id <= 8; id++) game.setAiController(id, true);

// ---- instrumentation ----
const phaseRows = new Map<string, number[]>();
game.onPhase = (phase: string, ms: number) => { let r = phaseRows.get(phase); if (!r) phaseRows.set(phase, r = []); r.push(ms); };
const outcomesThisAdvance = new Map<string, any>();
let commandProgress = false;
const outcomeLog: { id: string; playerId: number; tick: number; status: string; reason?: string }[] = [];
game.commandApplications.onOutcome = (o: any) => { outcomesThisAdvance.set(`${o.playerId}:${o.id}`, o); outcomeLog.push({ id: o.id, playerId: o.playerId, tick: o.tick, status: o.status, reason: o.reason }); };
game.commandApplications.onProgress = () => { commandProgress = true; };
const exceptions: { tick: number; stage: string; message: string; detail?: any }[] = [];
game.commandApplications.onValidationFailure = (f: any) => { exceptions.push({ tick: game.tick, stage: "command-contained", message: String(f?.message ?? f?.error ?? "validation failure"), detail: f }); console.log("CONTAINED-THROW", JSON.stringify(f).slice(0, 2000)); };
const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
const client = new CanonicalStateStream(W * H, 65_536, { width: W, height: H });
const encDiag = new RuntimeDiagnostics();
const DESIGN_B = process.env.DESIGN_B === "1", CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY ?? 0) || 0;
const checkpointMsSeries: number[] = [], tickPlusCheckpoint: number[] = [];
const DUMP = process.env.DUMP ? openSync(OUT.replace(/\.json$/, ".pubs.bin"), "w") : undefined;
const dump = (tick: number, enc: any) => { if (DUMP === undefined) return; const hdr = Buffer.alloc(76); hdr.writeUInt32LE(tick, 0); hdr.writeUInt32LE(enc.binary.byteLength, 4); hdr.write(enc.hash, 8, 64, "latin1"); hdr.writeUInt32LE(0, 72); writeSync(DUMP, hdr); writeSync(DUMP, enc.binary); };

// ---- deterministic PRNG ----
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
interface Human { id: number; rng: () => number; apm: number; credit: number; next: number; followUps: { tick: number; cmd: any }[]; groupCursor: number }
const humans: Human[] = Array.from({ length: 8 }, (_, i) => { const rng = mulberry32(seed ^ (0x9E3779B1 * (i + 1))); return { id: i + 1, rng, apm: 40 + Math.floor(rng() * 41), credit: 0, next: 0, followUps: [], groupCursor: 0 }; });

const ownLand = (pid: number) => game.squads.filter((s: any) => s.playerId === pid && s.embarkedOn === null && !s.afloat);
const groupsOf = (pid: number) => { const own = ownLand(pid).slice().sort((a: any, b: any) => a.id - b.id); const g: any[][] = []; for (let i = 0; i < own.length; i += 30) g.push(own.slice(i, i + 30)); return g; };
const centroid = (sq: any[]) => ({ x: sq.reduce((a, s) => a + s.x, 0) / sq.length, y: sq.reduce((a, s) => a + s.y, 0) / sq.length });
const nearestAny = (pid: number, c: { x: number; y: number }) => { let best: any, bd = Infinity; for (const s of game.squads) { if (s.playerId === pid || s.embarkedOn !== null) continue; const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
const nearestEnemy = (pid: number, c: { x: number; y: number }) => { let best: any, bd = Infinity; for (const s of game.squads) { if (s.playerId === pid || s.embarkedOn !== null || !game.hostile(pid, s.playerId)) continue; const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
const nearestEnemyBuilding = (pid: number, c: { x: number; y: number }) => { let best: any, bd = Infinity; for (const b of game.buildings) { if (b.playerId === pid || b.playerId === 0) continue; const x = map.x(b.tile) * FIXED, y = map.y(b.tile) * FIXED; const d = (x - c.x) ** 2 + (y - c.y) ** 2; if (d < bd) { bd = d; best = b; } } return best; };
const clampTile = (x: number, y: number) => map.ref(Math.max(0, Math.min(W - 1, Math.floor(x / FIXED))), Math.max(0, Math.min(H - 1, Math.floor(y / FIXED))));
function landNear(rng: () => number, x: number, y: number, spread: number): number | undefined {
  for (let i = 0; i < 10; i++) { const t = clampTile(x + (rng() * 2 - 1) * spread * FIXED, y + (rng() * 2 - 1) * spread * FIXED); if (map.isLand(t)) return t; }
  return undefined;
}
let cmdSeq = 0;
const actionCounts: Record<string, number> = {};
function makeAction(h: Human, tick: number): any[] {
  const r = h.rng, groups = groupsOf(h.id), player = game.player(h.id);
  if (!player || player.eliminated) return [];
  const roll = r() * 100;
  const pickGroup = () => groups.length ? groups[(h.groupCursor++ + Math.floor(r() * 2)) % groups.length] : undefined;
  const tag = (kind: string, cmd: any) => { actionCounts[kind] = (actionCounts[kind] ?? 0) + 1; return cmd; };
  if (roll < 3) { const g = pickGroup(); if (!g) return []; const n = nearestAny(h.id, centroid(g)); if (!n || game.hostile(h.id, n.playerId)) return [];
    return [tag("declare-war", { type: "alliance", playerId: h.id, otherId: n.playerId, action: "declare" })]; }
  if (roll < 40) { // move (30-squad group), sometimes followed by Shift-queued legs
    const g = pickGroup(); if (!g) return [];
    const c = centroid(g), e = nearestEnemy(h.id, c);
    const tx = e && r() < 0.6 ? c.x + (e.x - c.x) * 0.7 : c.x, ty = e && r() < 0.6 ? c.y + (e.y - c.y) * 0.7 : c.y;
    const tile = landNear(r, tx, ty, 12 + r() * 25); if (tile === undefined) return [];
    const ids = g.map((s: any) => s.id);
    const out = [tag("move", { type: "order", playerId: h.id, squadIds: ids, order: { type: "move", tile } })];
    if (r() < 0.35) { const legs = 1 + Math.floor(r() * 3); let lx = map.x(tile) * FIXED, ly = map.y(tile) * FIXED;
      for (let k = 0; k < legs; k++) { const t2 = landNear(r, lx, ly, 10 + r() * 20); if (t2 === undefined) break; lx = map.x(t2) * FIXED; ly = map.y(t2) * FIXED;
        h.followUps.push({ tick: tick + 1 + k * (1 + Math.floor(r() * 3)), cmd: { type: "order", playerId: h.id, squadIds: ids, order: { type: "move", tile: t2 }, append: true } }); } }
    return out;
  }
  if (roll < 55) { // attack nearest enemy squad
    const g = pickGroup(); if (!g) return []; const e = nearestEnemy(h.id, centroid(g)); if (!e) return [];
    return [tag("attack", { type: "order", playerId: h.id, squadIds: g.map((s: any) => s.id), order: { type: "attack", targetId: e.id } })];
  }
  if (roll < 63) { const g = pickGroup(); if (!g) return [];
    return [tag("formation", { type: "formation", playerId: h.id, squadIds: g.map((s: any) => s.id), shape: SHAPES[Math.floor(r() * SHAPES.length)] })]; }
  if (roll < 68) { const g = pickGroup(); if (!g) return []; const cav = g.filter((s: any) => s.kind === "cavalry"); const use = cav.length ? cav : g.slice(0, 6);
    const e = nearestEnemy(h.id, centroid(use)); if (!e) return [];
    return [tag("charge", { type: "charge", playerId: h.id, squadIds: use.map((s: any) => s.id), x: Math.round(e.x), y: Math.round(e.y), targetId: e.id })]; }
  if (roll < 72) { const g = pickGroup(); if (!g) return []; const b = nearestEnemyBuilding(h.id, centroid(g)); if (!b) return [];
    return [tag("attack-structure", { type: "attack-structure", playerId: h.id, squadIds: g.map((s: any) => s.id), buildingId: b.id })]; }
  if (roll < 82) { const tiles = game.ownedLandNearest(h.id, player.base, 256); if (!tiles.length) return [];
    return [tag("build", { type: "build", playerId: h.id, buildingType: BUILD_TYPES[Math.floor(r() * BUILD_TYPES.length)], tile: tiles[Math.floor(r() * tiles.length)] })]; }
  if (roll < 90) { const own = game.buildings.filter((b: any) => b.playerId === h.id && ["barracks", "archery", "stables"].includes(b.type)); if (!own.length) return [];
    return [tag("recruit", { type: "recruit", playerId: h.id, buildingId: own[Math.floor(r() * own.length)].id, autoRecruit: true })]; }
  if (roll < 96) { const state = game.expansion?.progression.states[h.id]; if (!state) return [];
    const ok = TECHNOLOGIES.filter((t: any) => !researchRejection(state, availableGold(player), t.id, 1)); const pick = ok.length ? ok[Math.floor(r() * ok.length)] : TECHNOLOGIES[Math.floor(r() * TECHNOLOGIES.length)];
    return [tag("research", { type: "research", playerId: h.id, technologyId: pick.id })]; }
  if (roll < 98) { const g = pickGroup(); if (!g) return []; return [tag("stance", { type: "stance", playerId: h.id, squadIds: g.map((s: any) => s.id), stance: r() < 0.5 ? "skirmish" : "default" })]; }
  return [tag("advance-age", { type: "advance-age", playerId: h.id })];
}

// ---- latency tracking ----
interface Track { key: string; human: number; submit: number; members: number[]; start: Map<number, { x: number; y: number }>; first?: number; half?: number; stationary: number }
const tracks: Track[] = [];
const latencyDone: { human: number; kind: string; first?: number; half?: number; outcome?: string; outcomeTick?: number; submit: number; stationary: number }[] = [];
const prevPos = new Map<number, { x: number; y: number }>();
const snapHumanPositions = () => { prevPos.clear(); for (const s of game.squads) if (s.playerId >= 1 && s.playerId <= 8) prevPos.set(s.id, { x: s.x, y: s.y }); };

// ---- metrics ----
const stats = (v: number[]) => { if (!v.length) return null; const s = v.slice().sort((a, b) => a - b); const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))];
  return { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), p99: +q(.99).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
const windows: any[] = [];
let cpuAll = 0, wallAll = 0;
let win = { wallSum: 0, cpuSum: 0, ticks: 0, pubs: 0, pubsGate: 0, raw: [] as number[], gz: [] as number[], capture: [] as number[], transfer: [] as number[], encode: [] as number[], decode: [] as number[], apply: [] as number[], project: [] as number[], clone: [] as number[],
  plannerPending: [] as number[], admissions: [] as number[], prep: [] as number[], receipts: [] as number[], shipAdm: [] as number[], cmds: 0, cmdsPerAdvanceMax: 0, validateMs: [] as number[], applyCmdMs: [] as number[], squadRows: [] as number[],
  cohortSamples: 0, cohorts: {} as Record<string, number>, humanPhases: {} as Record<string, number> };
const allTick: number[] = [], allTickPhase = new Map<string, number[]>();
const rejections: Record<string, number> = {};
const perHumanCmds = new Map<number, number>();
const cmdArrivalTicks: { tick: number; human: number }[] = [];
const tickMsSeries: number[] = [];
let lastSnapSim = 0, nextSnapshotSimulationMs = SNAPSHOT_MS;
const t0 = performance.now();
let measuring = false, dumpedBaseline = false;
const commandLog: { tick: number; commands: any[] }[] = [];
// Baseline for the client (join).


const TOTAL = WARM + MEASURE;
let firstTick = 1;
if (process.env.CKPT) {
  game.restore(v8.deserialize(readFileSync(process.env.CKPT)));
  if (game.tick !== WARM) throw new Error(`CKPT is at tick ${game.tick}, expected the warm boundary ${WARM}`);
  firstTick = WARM + 1;
}
for (let i = firstTick; i <= TOTAL; i++) {
  if (i === WARM + 1 && process.env.SAVE_CKPT && !process.env.CKPT) writeFileSync(process.env.SAVE_CKPT, v8.serialize(game.checkpoint()));
  if (i === WARM + 1) {
    measuring = true; measuringRef.on = true;
    if (mode === "humans" || mode === "idle") {
      console.log("injected", JSON.stringify(injectArmies(game, Number(process.env.ARMY ?? 60))));
      for (let id = 1; id <= 8; id++) game.setAiController(id, false);
    }
    for (const r of phaseRows.values()) r.length = 0;
    console.log("measurement starts", { tick: game.tick, squads: game.squads.length, humanSquads: humans.map(h => ownLand(h.id).length) });
  }
  // 1. scripted human input (simulated time), shared queue capped at 100 like LiveMatch.admitCommand.
  const queue: { id: string; command: any }[] = [];
  if (measuring && mode === "humans") {
    for (const h of humans) {
      const due = h.followUps.filter(f => f.tick <= game.tick); h.followUps = h.followUps.filter(f => f.tick > game.tick);
      const batch: any[] = due.map(f => { actionCounts["shift-leg"] = (actionCounts["shift-leg"] ?? 0) + 1; return f.cmd; });
      h.credit += h.apm / 60 / 8;
      while (h.credit >= 1) { h.credit -= 1; batch.push(...makeAction(h, game.tick)); }
      // A human's APM counts every command, including Shift legs: spend credit on them.
      h.credit -= due.length;
      for (const cmd of batch) {
        if (queue.length >= QUEUE_CAP) { rejections["Command queue is full"] = (rejections["Command queue is full"] ?? 0) + 1; continue; }
        const id = `g${h.id}-${++cmdSeq}`;
        queue.push({ id, command: cmd }); cmdArrivalTicks.push({ tick: game.tick, human: h.id });
        perHumanCmds.set(h.id, (perHumanCmds.get(h.id) ?? 0) + 1);
      }
    }
  }
  // 2. validation (coordinator thread) + apply (sim thread, like serverMatchWorker).
  snapHumanPositions();
  outcomesThisAdvance.clear();
  const tv = performance.now();
  const parsed: { id: string; command: any }[] = queue.map(q => ({ id: q.id, command: commandSchema.parse(q.command) }));
  if (parsed.length) commandLog.push({ tick: game.tick, commands: parsed });
  const validateMs = performance.now() - tv;
  const ta = performance.now();
  for (const item of parsed) {
    let outcome: any;
    try { outcome = game.commandApplications.apply(item.id, item.command); }
    catch (error: any) { exceptions.push({ tick: game.tick, stage: "command", message: String(error?.message ?? error), detail: { command: item.command, stack: String(error?.stack ?? "").split(String.fromCharCode(10)).slice(0, 12) } }); console.log("COMMAND-THROW", error?.stack); break; }
    if (outcome.status === "rejected") rejections[outcome.reason ?? "?"] = (rejections[outcome.reason ?? "?"] ?? 0) + 1;
    const c = item.command;
    if ((c.type === "order" && !c.append) || c.type === "charge" || c.type === "attack-structure") {
      const start = new Map<number, { x: number; y: number }>(); let stationary = 0;
      for (const id of c.squadIds) { const s = game.squad(id); if (!s) continue; start.set(id, { x: s.x, y: s.y }); }
      tracks.push({ key: `${c.playerId}:${item.id}`, human: c.playerId, submit: game.tick, members: c.squadIds, start, stationary: 0, kind: c.type === "order" ? c.order.type : c.type } as any);
    }
  }
  const applyCmdMs = performance.now() - ta;
  // 3. one tick
  const cpu0 = (process as any).threadCpuUsage(); const ts = performance.now(); try { game.step(); } catch (error: any) { exceptions.push({ tick: game.tick, stage: "tick", message: String(error?.message ?? error), detail: { stack: String(error?.stack ?? "").split(String.fromCharCode(10)).slice(0, 12), fault: (game as any).tickFault } }); console.log("TICK-THROW", error?.stack); finalize(); process.exit(2); } const tickMs = performance.now() - ts; const cpu1 = (process as any).threadCpuUsage(); const tickCpu = (cpu1.user - cpu0.user + cpu1.system - cpu0.system) / 1000;
  // latency: first movement of members (any change of x/y after submission)
  for (let k = tracks.length - 1; k >= 0; k--) {
    const t = tracks[k] as any; const age = game.tick - t.submit;
    let moved = 0, alive = 0;
    for (const id of t.members) { const s = game.squad(id); if (!s) continue; alive++; const p = t.start.get(id); if (p && (s.x !== p.x || s.y !== p.y)) moved++; }
    if (moved > 0 && t.first === undefined) t.first = age;
    if (alive && moved * 2 >= alive && t.half === undefined) t.half = age;
    if ((t.half !== undefined) || age >= 160) {
      const o = [...outcomeLog].reverse().find(x => `${x.playerId}:${x.id}` === t.key && x.status !== "deferred");
      latencyDone.push({ human: t.human, kind: t.kind, first: t.first, half: t.half, outcome: o?.status, outcomeTick: o ? o.tick - t.submit : undefined, submit: t.submit, stationary: 0 });
      tracks.splice(k, 1);
    }
  }
  // 4. publication decision: LiveMatch 5 Hz sim-time gate || executed command || committed cohort.
  const gate = game.tick * TICK_MS >= nextSnapshotSimulationMs;
  if (gate) nextSnapshotSimulationMs += (Math.floor((game.tick * TICK_MS - nextSnapshotSimulationMs) / SNAPSHOT_MS) + 1) * SNAPSHOT_MS;
  const executed = [...outcomesThisAdvance.values()].some(o => o.status === "executed");
  const publish = DESIGN_B ? gate : gate || commandProgress || executed;
  let checkpointMs = 0;
  if (CHECKPOINT_EVERY && game.tick % CHECKPOINT_EVERY === 0) { const tk = performance.now(); game.checkpoint(); checkpointMs = performance.now() - tk; if (measuring) checkpointMsSeries.push(checkpointMs); }
  commandProgress = false;
  if (measuring) {
    tickMsSeries.push(tickMs); tickPlusCheckpoint.push(tickMs + checkpointMs); win.wallSum += tickMs; win.cpuSum += tickCpu; cpuAll += tickCpu; wallAll += tickMs;
    win.ticks++; win.cmds += parsed.length; win.cmdsPerAdvanceMax = Math.max(win.cmdsPerAdvanceMax, parsed.length);
    if (parsed.length) { win.validateMs.push(validateMs); win.applyCmdMs.push(applyCmdMs); }
    win.plannerPending.push(game.routePlanner.pendingCount); win.admissions.push(game.movementAdmission.pendingCount);
    // Where human admissions wait (PROFILE): admission-ticks per phase over the window.
    if (process.env.PROFILE) {
      const adm: any = game.movementAdmission.checkpoint();
      const ids = new Set(adm.pending.map(([id]: any) => id));
      for (const [, a] of adm.pending) {
        if (game.player(a.playerId)?.ai) continue;
        const lead = a.corridorId !== undefined && a.corridorId !== a.id && ids.has(a.corridorId);
        const sub = a.phase !== "routes" ? "" : a.members.some((m: any) => m.requested) ? ":planner" : lead ? ":lead" :
          a.members.some((m: any) => !m.path && (m.retryAt ?? 0) > game.tick) ? ":backoff" : ":ready";
        win.humanPhases[a.phase + sub] = (win.humanPhases[a.phase + sub] ?? 0) + 1;
      }
    }
    // Planner occupancy by class (PROFILE): mean pending jobs per human/AI caller over the window.
    if (process.env.PROFILE && game.tick % 20 === 0) {
      win.cohortSamples++;
      for (const c of game.routePlanner.diagnosticCohorts(game.tick)) {
        const key = `${c.playerId >= 1 && c.playerId <= 8 && !game.player(c.playerId)?.ai ? "human" : "ai"}:${c.caller}`;
        win.cohorts[key] = (win.cohorts[key] ?? 0) + c.pending;
      }
    }
    win.prep.push(game.movementAdmission.preparationCount); win.receipts.push(game.commandApplications.diagnostics.pending);
    win.shipAdm.push((game.shipAdmission as any).pendingCount ?? 0);
    if (gate) win.pubsGate++;
  }
  if (publish) {
    const tc = performance.now();
    const packet = encoder.encode(game.replicationSource(true), game.tileChanges, game.replicationFacts());
    const captureMs = performance.now() - tc;
    const squadRows = packet.squads.length / 14;
    const te = performance.now(); const pending = encoding.encode(packet); const transferMs = performance.now() - te; const encoded: any = await pending; const encodeMs = performance.now() - te;
    const rawBytes = 0, decodeMs = 0, applyMs = 0, projectMs = 0, cloneMs = 0;
    if (game.tick === WARM + 1 || (measuring && DUMP !== undefined && !dumpedBaseline)) { dumpedBaseline = true; const b = encoder.encodeBaseline(game.replicationSource(true), game.tileChanges, game.replicationFacts()); const tb = performance.now(); const be: any = await encoding.encode(b); console.log('baseline capture+encode ms', (performance.now()-tb).toFixed(0)); dump(game.tick, be); console.log("baseline gz", be.binary.byteLength); }
    else if (measuring) dump(game.tick, encoded);
    if (measuring) {
      win.pubs++; win.transfer.push(transferMs); win.gz.push(encoded.binary!.byteLength); win.capture.push(captureMs); win.encode.push(encodeMs); win.decode.push(decodeMs); win.apply.push(applyMs); win.project.push(projectMs); win.clone.push(cloneMs); win.squadRows.push(squadRows);
      // raw (uncompressed) size: the decoder reports it via diagnostics; approximate from gunzip length
      win.raw.push(rawBytes);
    }
  }
  if (measuring && win.ticks === 400) {
    const phases: any = {}; for (const [p, r] of phaseRows) { phases[p] = stats(r); (allTickPhase.get(p) ?? allTickPhase.set(p, []).get(p)!).push(...r); r.length = 0; }
    const row = { tick: game.tick, tickCpuMean: +(win.cpuSum / win.ticks).toFixed(2), tickWallMean: +(win.wallSum / win.ticks).toFixed(2), alive: game.players.filter((p: any) => !p.eliminated).length, squads: game.squads.length, ships: game.ships.length, buildings: game.buildings.length,
      traders: game.expansion?.trade.actors.length ?? 0, heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(0),
      humanSquads: humans.map(h => ownLand(h.id).length), cmds: win.cmds, cmdsPerAdvanceMax: win.cmdsPerAdvanceMax,
      pubsPerSimSec: +(win.pubs / (win.ticks / 8)).toFixed(2), gatePubsPerSimSec: +(win.pubsGate / (win.ticks / 8)).toFixed(2),
      gz: stats(win.gz), raw: stats(win.raw), capture: stats(win.capture), transfer: stats(win.transfer), encode: stats(win.encode), decode: stats(win.decode), apply: stats(win.apply), project: stats(win.project), clone: stats(win.clone), squadRows: stats(win.squadRows),
      plannerPending: stats(win.plannerPending), admissions: stats(win.admissions), prep: stats(win.prep), receipts: stats(win.receipts), shipAdm: stats(win.shipAdm),
      validateMs: stats(win.validateMs), applyCmdMs: stats(win.applyCmdMs), connectors: { ...game.movementAdmission.connectorDiagnostics },
      humanAdmissionTicksByPhase: win.humanPhases,
      plannerByClass: Object.fromEntries(Object.entries(win.cohorts).map(([k, v]) => [k, +(v / Math.max(1, win.cohortSamples)).toFixed(1)])), prof: { ...prof, stepAdmMsPerTick: +(prof.stepAdmMs / 400).toFixed(2), stepAdmCpuPerTick: +(prof.stepAdmCpu / 400).toFixed(2), meanPending: +(prof.stepAdmPending / Math.max(1, prof.stepAdmCalls)).toFixed(1) }, plannerDiag: { ...game.routePlanner.diagnostics }, phases };
    windows.push(row);
    console.log(JSON.stringify({ cpu: row.tickCpuMean, tick: row.tick, S: row.squads, H: row.ships, B: row.buildings, tr: row.traders, alive: row.alive, heap: row.heapMB, tick_ms: phases.tick, pubs: row.pubsPerSimSec, gz: row.gz?.mean, plan: row.plannerPending?.mean, adm: row.admissions?.mean, cmds: row.cmds }));
    for (const k of Object.keys(prof)) (prof as any)[k] = k === "humanByKind" ? {} : 0;
    win = { wallSum: 0, cpuSum: 0, ticks: 0, pubs: 0, pubsGate: 0, raw: [], gz: [], capture: [], transfer: [], encode: [], decode: [], apply: [], project: [], clone: [], plannerPending: [], admissions: [], prep: [], receipts: [], shipAdm: [], cmds: 0, cmdsPerAdvanceMax: 0, validateMs: [], applyCmdMs: [], squadRows: [], cohortSamples: 0, cohorts: {}, humanPhases: {} };
    const summaryPhases: any = {}; for (const [p, r] of allTickPhase) summaryPhases[p] = stats(r);
    const lat = (sel: (x: any) => boolean, k: "first" | "half" | "outcomeTick") => stats(latencyDone.filter(sel).map(x => x[k]).filter((v): v is number => v !== undefined));
    const perHuman = humans.map(h => ({ human: h.id, apm: h.apm, cmds: perHumanCmds.get(h.id) ?? 0, first: lat(x => x.human === h.id, "first"), half: lat(x => x.human === h.id, "half"), outcome: lat(x => x.human === h.id, "outcomeTick"),
      noMove: latencyDone.filter(x => x.human === h.id && x.first === undefined).length, tracked: latencyDone.filter(x => x.human === h.id).length }));
    const byKind: any = {}; for (const k of ["move", "attack", "charge", "attack-structure"]) byKind[k] = { first: lat(x => x.kind === k, "first"), half: lat(x => x.kind === k, "half"), outcome: lat(x => x.kind === k, "outcomeTick"), noMove: latencyDone.filter(x => x.kind === k && x.first === undefined).length,
      // Outcome latency per terminal status: "executed" is the commit latency the gate is about.
      outcomeByStatus: Object.fromEntries(["executed", "superseded", "rejected"].map(status => [status, lat(x => x.kind === k && x.outcome === status, "outcomeTick")])) };
    const outcomeStatus: Record<string, number> = {}; for (const o of outcomeLog) if (o.status !== "deferred") outcomeStatus[o.status] = (outcomeStatus[o.status] ?? 0) + 1;
    writeFileSync(OUT.replace(/\.json$/, ".commands.json"), JSON.stringify({ warm: WARM, measure: MEASURE, seed, mapId, partialAtTick: game.tick, commandLog }));
    writeFileSync(OUT, JSON.stringify({ map: mapId, mode, seed, W, H, warm: WARM, measure: MEASURE, wallSec: +((performance.now() - t0) / 1000).toFixed(0), humans: humans.map(h => ({ id: h.id, apm: h.apm })),
      tickAll: stats(tickMsSeries), tickCpuMeanAll: +(cpuAll / tickMsSeries.length).toFixed(2), tickWallMeanAll: +(wallAll / tickMsSeries.length).toFixed(2), summaryPhases, perHuman, byKind, rejections, outcomeStatus, actionCounts, receiptsDiag: { ...game.commandApplications.diagnostics }, windows, tickMsSeries: tickMsSeries.map(v => +v.toFixed(1)), cmdArrivalTicks }, null, 1));
  }
}
/** Order-independent digests for before/after records of behaviour changes. */
function digests() {
  const replacer = (_key: string, value: any) => value instanceof Map ? [...value] : value instanceof Set ? [...value] : ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value;
  const squads = [...game.squads].sort((a: any, b: any) => a.id - b.id).map((s: any) => [s.id, s.playerId, s.x, s.y, s.troops, s.order, s.path, s.queuedOrders]);
  return {
    squads: createHash("sha256").update(JSON.stringify(squads)).digest("hex"),
    checkpoint: createHash("sha256").update(JSON.stringify(game.checkpoint(), replacer)).digest("hex"),
  };
}
function finalize() {
  writeFileSync(OUT.replace(/\.json$/, ".summary.json"), JSON.stringify({ map: mapId, mode, seed, warm: WARM, measure: MEASURE, reachedTick: game.tick, digests: digests(), measuredTicks: tickMsSeries.length, exceptions, tickAll: stats(tickMsSeries), designB: DESIGN_B, checkpointEvery: CHECKPOINT_EVERY, ...(process.env.HPA_PROBE ? { hpaFinds } : {}), checkpointMs: stats(checkpointMsSeries), tickPlusCheckpoint: stats(tickPlusCheckpoint), pubsPerSimSec: +(windows.reduce((n: number, w: any) => n + w.pubsPerSimSec, 0) / Math.max(1, windows.length)).toFixed(2), tickCpuMeanAll: +(cpuAll / Math.max(1, tickMsSeries.length)).toFixed(2), rejections, actionCounts, squads: game.squads.length, alive: game.players.filter((p: any) => !p.eliminated).length, winner: (game as any).winner ?? null, wallSec: +((performance.now() - t0) / 1000).toFixed(0) }, null, 1));
  console.log("SUMMARY", JSON.stringify({ reachedTick: game.tick, digests: digests(), exceptions: exceptions.length, tickAll: stats(tickMsSeries) }));
}
finalize();
if (DUMP !== undefined) closeSync(DUMP);
writeFileSync(OUT.replace(/\.json$/, ".commands.json"), JSON.stringify({ warm: WARM, measure: MEASURE, seed, mapId, commandLog, finalState: { tick: game.tick, squads: game.squads.length, buildings: game.buildings.length, ships: game.ships.length, squadXY: game.squads.reduce((a: number, s: any) => (a * 31 + s.x * 7 + s.y + s.id) % 1000000007, 0) } }));
console.log("encoder thread timings", JSON.stringify(encoding.timings), JSON.stringify(encoding.memory));
await encoding.close();
console.log("done", ((performance.now() - t0) / 1000).toFixed(0), "s");

// Load-test fixture: give each of the 8 human seats a realistic mid-game army (default 60 squads) at the
// warm-up boundary, using the same private spawn path recruitment uses. Deterministic: depends only on state.
function injectArmies(game: any, perHuman = 60): { injected: number; perHuman: number[] } {
  const counts = new Map<string, { kind: string; definitionId: string; n: number }>();
  for (const s of game.squads) {
    const p = game.player(s.playerId);
    if (!p || p.kind !== "regular" || !s.definitionId || s.embarkedOn !== null || s.afloat) continue;
    const key = `${s.kind}|${s.definitionId}`;
    const row = counts.get(key) ?? { kind: s.kind, definitionId: s.definitionId, n: 0 }; row.n++; counts.set(key, row);
  }
  // Composition mirrors what AI nations field at this point of the match, most common first, id tiebreak.
  const mix = [...counts.values()].sort((a, b) => b.n - a.n || (a.definitionId < b.definitionId ? -1 : 1)).slice(0, 6);
  const total = mix.reduce((a, r) => a + r.n, 0);
  const plan: { kind: string; definitionId: string }[] = [];
  for (const r of mix) for (let i = 0; i < Math.round(perHuman * r.n / total); i++) plan.push(r);
  while (plan.length < perHuman) plan.push(mix[0]);
  plan.length = perHuman;
  const result: number[] = [];
  for (let id = 1; id <= 8; id++) {
    const player = game.player(id);
    if (!player || player.eliminated) { result.push(0); continue; }
    const tiles: number[] = game.ownedLandNearest(id, player.base, 2000).filter((t: number) => game.map.isLand(t));
    let n = 0;
    for (let k = 0; k < plan.length && tiles.length; k++) {
      // spread over owned land, every third tile from the nearest outward, skip the base tile itself
      const tile = tiles[Math.min(tiles.length - 1, 4 + k * 3)];
      // Private recruitment spawn path, reached deliberately for the fixture.
      game.spawnSquad(player, plan[k].kind, tile, plan[k].definitionId, false);
      n++;
    }
    result.push(n);
  }
  return { injected: result.reduce((a, b) => a + b, 0), perHuman: result, mix } as any;
}
