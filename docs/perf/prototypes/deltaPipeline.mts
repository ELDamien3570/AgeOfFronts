// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
// Host and server cost of delta commits (every 4 ticks), on a natural 20-faction game.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadMap } from "../../../src/skirmish/Terrain";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { encodeState, decodeState } from "../../../src/skirmish/multiplayer/StateCodec";
import { applyDelta, diffState } from "../../../src/skirmish/multiplayer/StateDelta";
import { chainStateId } from "../../../src/skirmish/multiplayer/application/HostedRuntime";
(globalThis as any).fetch = async (url: string) => { const buf = fs.readFileSync(process.cwd() + "/resources" + url);
  return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const [mapId = "africa", size = "500", minutes = "10"] = process.argv.slice(2);
const loaded: any = await loadMap(mapId, Number(size));
const make = () => new Skirmish(createSkirmishMap(loaded.map.width(), loaded.map.height(), loaded.terrain, loaded.elevation, loaded.forest, loaded.resourceTerrain),
  { seed: 42, aiCount: 19, tribes: false, ruleset: "ages-v1", territoryIncomeScale: loaded.territoryIncomeScale } as any);
const host: any = make(), server: any = make();
let hostBase = host.checkpoint(), serverCommitted = hostBase, id = (await encodeState(hostBase)).hash;
const rows: Record<number, any[]> = {};
const mean = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const p95 = (a: number[]) => +[...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(1);
for (let i = 1; i <= Number(minutes) * 1200; i++) {
  host.step();
  if (i % 4) continue;
  let t = performance.now();
  const next = host.checkpoint();
  const delta = await encodeState(diffState(hostBase, next));
  const nextId = await chainStateId(id, delta.hash);
  const hostMs = performance.now() - t;
  hostBase = next;
  t = performance.now();
  const rebuilt = applyDelta(serverCommitted, await decodeState(delta));
  if ((await chainStateId(id, delta.hash)) !== nextId) throw new Error("id");
  const tApply = performance.now() - t;
  t = performance.now();
  server.restore(rebuilt);
  const tRestore = performance.now() - t;
  serverCommitted = rebuilt; id = nextId;
  (rows[Math.ceil(i / 1200)] ??= []).push({ hostMs, tApply, tRestore, kb: delta.payload.length / 1024 });
}
const last = await encodeState(host.checkpoint());
for (const [m, r] of Object.entries(rows)) console.log(JSON.stringify({ minute: +m, commits: r.length,
  hostMs: mean(r.map((x) => x.hostMs)), hostP95: p95(r.map((x) => x.hostMs)),
  serverDecodeApplyMs: mean(r.map((x) => x.tApply)), serverRestoreMs: mean(r.map((x) => x.tRestore)),
  serverP95: p95(r.map((x) => x.tApply + x.tRestore)),
  uploadKB: mean(r.map((x) => x.kb)), uploadKBp95: p95(r.map((x) => x.kb)) }));
console.log("final full checkpoint KB", Math.round(last.payload.length / 1024), "equal:", JSON.stringify(Object.keys(serverCommitted)) === JSON.stringify(Object.keys(host.checkpoint())));
