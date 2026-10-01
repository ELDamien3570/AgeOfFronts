// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadMap } from "../../../src/skirmish/Terrain";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { encodeState } from "../../../src/skirmish/multiplayer/StateCodec";
(globalThis as any).fetch = async (url: string) => { const buf = fs.readFileSync(process.cwd() + "/resources" + url);
  return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const loaded: any = await loadMap("africa", 500);
const m: any = new Skirmish(createSkirmishMap(loaded.map.width(), loaded.map.height(), loaded.terrain, loaded.elevation, loaded.forest, loaded.resourceTerrain),
  { seed: 42, aiCount: 19, tribes: false, ruleset: "ages-v1", territoryIncomeScale: loaded.territoryIncomeScale } as any);
for (let i = 0; i < 8 * 1200; i++) m.step();
const cp = m.checkpoint();
const rep = (k: string, v: any) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : ArrayBuffer.isView(v) ? { typed: v.byteLength } : v;
const rows: any[] = [];
const measure = async (name: string, v: any) => {
  const json = JSON.stringify(v, rep).length;
  let typed = 0; JSON.stringify(v, (k, x) => { if (ArrayBuffer.isView(x)) typed += x.byteLength; return rep(k, x); });
  const t = performance.now(); const e = await encodeState(v); const ms = performance.now() - t;
  rows.push({ name, jsonKB: +(json / 1024).toFixed(0), typedKB: +(typed / 1024).toFixed(0), encodeMs: +ms.toFixed(1), gzipB64KB: +(e.payload.length / 1024).toFixed(0) });
};
for (const [k, v] of Object.entries(cp)) await measure(k, v);
if (cp.expansion) for (const [k, v] of Object.entries(cp.expansion)) await measure("expansion." + k, v);
rows.sort((a, b) => b.encodeMs - a.encodeMs);
console.log("squads", m.squads.length, "buildings", m.buildings.length, "map cells", m.owners.length);
for (const r of rows.slice(0, 18)) console.log(JSON.stringify(r));
