// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
// Independent natural-run profile of the skirmish sim (no production code changed).
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadMap } from "../../../src/skirmish/Terrain";
import { SpatialGrid } from "../../../src/skirmish/SpatialGrid";
import { Skirmish } from "../../../src/skirmish/Simulation";

const [mapId = "world", size = "500", ai = "19", tribes = "0", minutes = "20", label = "run"] =
  process.argv.slice(2);

const PATCH0 = process.env.PATCH ?? "";
if (PATCH0.includes("grid")) {
  const proto: any = SpatialGrid.prototype;
  const origInsert = proto.insert;
  proto.insert = function (item: any) {
    origInsert.call(this, item);
    const key = Math.floor(item.x / this.cellSize) + Math.floor(item.y / this.cellSize) * this.columns;
    if (this.buckets[key].length === 1) (this.__act ??= []).push(this.buckets[key]);
  };
  proto.rebuild = function (items: Iterable<any>) {
    const act = (this.__act ??= []);
    for (const b of act) b.length = 0;
    act.length = 0;
    for (const it of items) this.insert(it);
  };
}

(globalThis as any).fetch = async (url: string) => {
  const path = process.cwd() + "/resources" + url;
  const buf = fs.readFileSync(path);
  return {
    ok: true,
    json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const loaded = await loadMap(mapId, Number(size));
const match: any = new Skirmish(loaded.map, {
  seed: 42,
  aiCount: Number(ai),
  tribes: tribes === "1",
  ruleset: "ages-v1",
  territoryIncomeScale: loaded.territoryIncomeScale,
});
console.log(label, mapId, size, "factions", match.players.length);

const PATCH = process.env.PATCH ?? "";
if (PATCH.includes("tree") && (match.paths as any).hierarchy) {
  const h: any = (match.paths as any).hierarchy;
  const orig = h.localTree.bind(h);
  const cache = new Map<number, { tree: any; rev: number }>();
  const rev = new Map<number, number>(); // per-cluster cost revision
  h.topology.onCostsChanged((tiles: readonly number[]) => {
    for (const c of new Set(tiles.map((t) => h.cluster(t)))) rev.set(c, (rev.get(c) ?? 0) + 1);
  });
  let hits = 0, misses = 0;
  (globalThis as any).__treeStats = () => ({ hits, misses });
  h.localTree = (start: number, clusterId: number) => {
    const r = rev.get(clusterId) ?? 0;
    const hit = cache.get(start);
    if (hit && hit.rev === r) { hits++; cache.delete(start); cache.set(start, hit); return hit.tree; }
    misses++;
    const tree = orig(start, clusterId);
    cache.set(start, { tree, rev: r });
    if (cache.size > 512) cache.delete(cache.keys().next().value);
    return tree;
  };
}

if (PATCH.includes("coast")) {
  const N = match.owners.length;
  const coastal: number[] = [];
  for (let land = 0; land < N; land++) {
    if (!match.paths.walkable(land)) continue;
    if (match.map.neighbors(land).some((w: number) => match.waterPaths.walkable(w))) coastal.push(land);
  }
  console.log("coastal land tiles", coastal.length, "of", N);
  match.coastalDestination = (ship: any, player: any) => {
    let best: any, distance = Infinity;
    const shipTile = match.tileOf(ship);
    for (const land of coastal) {
      if (match.owners[land] === player.id) continue;
      if (!match.owners[land] && match.paths.connected(player.base, land)) continue;
      for (const water of match.map.neighbors(land)) {
        if (!match.waterPaths.connected(shipTile, water)) continue;
        const d = match.map.euclideanDistSquared(shipTile, water) + (match.owners[land] ? 0 : 10000);
        if (d < distance) { best = { land, water }; distance = d; }
      }
    }
    return best;
  };
}

function stateHash(): string {
  let a = 2166136261 >>> 0;
  const mix = (v: number) => { a = Math.imul(a ^ (v | 0), 16777619) >>> 0; };
  mix(match.tick);
  for (const v of match.owners) mix(v);
  for (const q of match.squads) { mix(q.id); mix(q.x); mix(q.y); mix(q.troops); }
  for (const b of match.buildings) { mix(b.id); mix(b.tile); mix(b.playerId); }
  for (const p of match.players) { mix(p.gold); mix(p.land); mix(p.reserves); }
  for (const t of match.expansion.trade.actors) { mix(t.id); mix(t.x); mix(t.y); mix(t.cargo); }
  return a.toString(16);
}
const acc = { trade: 0, findCalls: 0, findMs: 0, clearCalls: 0 };
const trade = match.expansion.trade;
const origStep = trade.step.bind(trade);
let tradeTick = 0;
trade.step = () => {
  const t = performance.now();
  origStep();
  const d = performance.now() - t;
  acc.trade += d;
  tradeTick += d;
};
const origFind = match.paths.find.bind(match.paths);
let findTick = 0;
match.paths.find = (...a: any[]) => {
  const t = performance.now();
  const r = origFind(...a);
  acc.findMs += performance.now() - t;
  acc.findCalls++;
  findTick++;
  return r;
};
const forts = match.expansion.fortifications;
const origClear = forts.clear.bind(forts);
forts.clear = (...a: any[]) => {
  acc.clearCalls++;
  return origClear(...a);
};


const phase: Record<string, number> = {};
const wrap = (obj: any, name: string, label = name) => {
  const o = obj[name].bind(obj);
  obj[name] = (...a: any[]) => { const t = performance.now(); try { return o(...a); } finally { phase[label] = (phase[label] ?? 0) + performance.now() - t; } };
};
for (const n of ["thinkAi", "fight", "fightShips", "capture", "replenish", "processBoarding", "checkWinner", "produceReserves"]) wrap(match, n);
wrap(match.avoidance, "step", "avoidance.step"); wrap(match, "coastalDestination");
wrap(match.routeWork, "drain", "routeWork.drain");
wrap(match.expansion.armies, "step", "armies.step");
wrap(match.expansion, "beforeStep");
wrap(match.expansion, "afterMovement");
wrap(match.expansion.trade, "step", "trade.step");
wrap(match.paths, "findExact", "findExact(all callers)");
const slow: any[] = [];
const phaseTotals: Record<string, number> = {};

const tstat: any = { loads: 0, selects: 0, loadMs: 0, selectMs: 0, loadFinds: 0, selectFinds: 0, cand: 0, valid: 0, findMsInTrade: 0, hpaMs: 0, hpaCalls: 0, lens: [] as number[], dist: [] as number[] };
{
  const tr: any = match.expansion.trade;
  let depth: "load" | "select" | "other" = "other";
  const origFind = match.paths.find;
  match.paths.find = (...a: any[]) => {
    const t = performance.now(); const r = origFind(...a); const d = performance.now() - t;
    if (depth === "load") { tstat.loadFinds++; tstat.findMsInTrade += d; } else if (depth === "select") { tstat.selectFinds++; tstat.findMsInTrade += d; }
    if (depth !== "other") { tstat.hpaCalls++; tstat.hpaMs += d; if (r) tstat.lens.push(r.length); }
    return r;
  };
  const ol = tr.load.bind(tr), os = tr.select.bind(tr);
  tr.load = (a: any) => { const prev = depth; depth = "load"; const t = performance.now(); try { return ol(a); } finally { tstat.loads++; tstat.loadMs += performance.now() - t; depth = prev; } };
  tr.select = (a: any) => { const prev = depth; if (prev !== "load") depth = "select"; const t = performance.now(); try { return os(a); } finally { if (prev !== "load") { tstat.selects++; tstat.selectMs += performance.now() - t; } depth = prev; } };
}
const total = Number(minutes) * 60 * 20;
const windows: any[] = [];
let times: number[] = [];
let wTrade = 0, wFind = 0, wFindMs = 0, wClear = 0, wTradeMax = 0;
const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
process.on("uncaughtException", (e) => {
  console.log("CRASH", String(e).slice(0, 80), "tick", match.tick);
  const live = new Set(match.squads.map((q: any) => q.id));
  const grid = match.spatial; let stale = 0, total = 0, shown = 0;
  for (const b of grid.buckets) if (b) for (const it of b) { total++; if (!live.has(it.id) || it.embarkedOn !== null) { stale++; if (shown++ < 4) console.log("stale item", it.id, "alive?", live.has(it.id), "embarked", it.embarkedOn, "x", it.x); } }
  console.log("spatial items", total, "stale", stale, "squads", match.squads.length, "act", grid.__act?.length, "allocated", grid.allocated.length);
  process.exit(1);
});
for (let i = 1; i <= total; i++) {
  tradeTick = 0; findTick = 0; for (const k in phase) phase[k] = 0;
  const t = performance.now();
  match.step();
  const d = performance.now() - t;
  times.push(d);
  if (d > 40) slow.push({ tick: match.tick, ms: +d.toFixed(0), top: Object.entries(phase).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(" ") });
  for (const k in phase) phaseTotals[k] = (phaseTotals[k] ?? 0) + phase[k];
  wTradeMax = Math.max(wTradeMax, tradeTick);
  if (i % 1200 === 0) {
    const minute = i / 1200;
    const alive = match.players.filter((p: any) => !p.eliminated && p.kind !== "tribe").length;
    const row = {
      minute,
      alive,
      squads: match.squads.length,
      buildings: match.buildings.length,
      towers: match.buildings.filter((b: any) => b.type === "tower").length,
      barriers: match.expansion.fortifications.barriers.length,
      traders: match.expansion.trade.actors.length,
      mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
      p95: +pct(times, 0.95).toFixed(1),
      p99: +pct(times, 0.99).toFixed(1),
      max: +Math.max(...times).toFixed(1),
      over50: times.filter((x) => x > 50).length,
      tradeMsPerTick: +((acc.trade - wTrade) / times.length).toFixed(2),
      tradeMaxTick: +wTradeMax.toFixed(1),
      findCalls: acc.findCalls - wFind,
      findMs: +(acc.findMs - wFindMs).toFixed(0),
      clearCalls: acc.clearCalls - wClear,
      hash: stateHash(),
    };
    windows.push(row);
    console.log(JSON.stringify(row), JSON.stringify((globalThis as any).__treeStats?.() ?? {}));
    times = []; wTrade = acc.trade; wFind = acc.findCalls; wFindMs = acc.findMs; wClear = acc.clearCalls; wTradeMax = 0;
  }
  if (match.winner !== null) { console.log("winner at tick", i); break; }
}
console.log("TRADE", JSON.stringify({ ...tstat, lens: undefined, dist: undefined, meanPathLen: +(tstat.lens.reduce((a: number, b: number) => a + b, 0) / Math.max(1, tstat.lens.length)).toFixed(0),
  msPerFind: +(tstat.hpaMs / Math.max(1, tstat.hpaCalls)).toFixed(2), findsPerLoad: +(tstat.loadFinds / Math.max(1, tstat.loads)).toFixed(0), findsPerSelect: +(tstat.selectFinds / Math.max(1, tstat.selects)).toFixed(1),
  loadMsEach: +(tstat.loadMs / Math.max(1, tstat.loads)).toFixed(1), selectMsEach: +(tstat.selectMs / Math.max(1, tstat.selects)).toFixed(2) }));
console.log("SLOW TICKS", slow.length);
const topCount: Record<string, number> = {};
for (const x of slow) { const k = x.top.split(" ")[0].split("=")[0]; topCount[k] = (topCount[k] ?? 0) + 1; }
console.log("slow-tick dominant phase counts", JSON.stringify(topCount));
console.log("phase totals (s)", JSON.stringify(Object.fromEntries(Object.entries(phaseTotals).map(([k, v]) => [k, +(v / 1000).toFixed(1)]))));
console.log(slow.filter((x) => x.ms > 100).slice(0, 25).map((x) => JSON.stringify(x)).join("\n"));
fs.writeFileSync(
  `/tmp/perf-out/${label}.json`,
  JSON.stringify(windows, null, 1),
);
