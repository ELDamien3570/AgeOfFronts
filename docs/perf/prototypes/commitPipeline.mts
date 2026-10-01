// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
// Cost of the host->server commit pipeline (every COMMIT_TICKS=4 ticks = 5 Hz), on a natural 20-faction game.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadMap } from "../../../src/skirmish/Terrain";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { encodeState, decodeState } from "../../../src/skirmish/multiplayer/StateCodec";
import { SnapshotEncoder } from "../../../src/skirmish/SnapshotCodec";
(globalThis as any).fetch = async (url: string) => { const buf = fs.readFileSync(process.cwd() + "/resources" + url);
  return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const [mapId = "africa", size = "500", minutes = "10"] = process.argv.slice(2);
const loaded: any = await loadMap(mapId, Number(size));
const mk = () => new Skirmish(createMap(), { seed: 42, aiCount: 19, tribes: false, ruleset: "ages-v1", territoryIncomeScale: loaded.territoryIncomeScale } as any);
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
function createMap() { return createSkirmishMap(loaded.map.width(), loaded.map.height(), loaded.terrain, loaded.elevation, loaded.forest, loaded.resourceTerrain); }
const host: any = mk(), verifier: any = mk(), enc = new SnapshotEncoder();
const rows: Record<number, any[]> = {};
const ms = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const p95 = (a: number[]) => +[...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(1);
for (let i = 1; i <= Number(minutes) * 1200; i++) {
  host.step();
  if (i % 4 || i % 40 || i < 1200) continue; // sample every 40 ticks after minute 1
  let t = performance.now();
  const cp = host.checkpoint(); const tCp = performance.now() - t;
  t = performance.now(); const e = await encodeState(cp); const tEnc = performance.now() - t;
  t = performance.now(); const dec: any = await decodeState(e); const tDec = performance.now() - t;
  t = performance.now(); verifier.restore(dec); const tRes = performance.now() - t;
  t = performance.now(); const snap = verifier.snapshot(); const tSnap = performance.now() - t;
  t = performance.now(); const pkt = enc.encode(snap); const ep = await encodeState(pkt); const tPkt = performance.now() - t;
  (rows[Math.ceil(i / 1200)] ??= []).push({ tCp, tEnc, tDec, tRes, tSnap, tPkt, cpKB: e.payload.length / 1024, pktKB: ep.payload.length / 1024 });
}
for (const [m, r] of Object.entries(rows)) console.log(JSON.stringify({ minute: +m, samples: r.length,
  hostCheckpointMs: ms(r.map((x) => x.tCp)), hostEncodeMs: ms(r.map((x) => x.tEnc)), hostTotalMsP95: p95(r.map((x) => x.tCp + x.tEnc)),
  serverDecodeMs: ms(r.map((x) => x.tDec)), serverRestoreMs: ms(r.map((x) => x.tRes)), serverSnapshotMs: ms(r.map((x) => x.tSnap)), serverPacketEncodeMs: ms(r.map((x) => x.tPkt)),
  serverTotalMsP95: p95(r.map((x) => x.tDec + x.tRes + x.tSnap + x.tPkt)),
  commitUploadKB: +ms(r.map((x) => x.cpKB)).toFixed(0), broadcastKBperClient: +ms(r.map((x) => x.pktKB)).toFixed(0) }));
