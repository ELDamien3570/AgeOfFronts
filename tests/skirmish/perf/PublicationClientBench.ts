// N4 bench (summary N4 / P1 / R2-P8): client cost per publication, replayed
// from a dump written by PublicationDump.ts. Not a test and not a gate; run it
// on an idle machine.
//
//   npx tsx tests/skirmish/perf/PublicationClientBench.ts <dump.pubs.bin> <W> <H> [out.json]
//
// Per publication it measures, on one thread:
//  - worker path (multiplayerStateWorker "entities" mode): decodeState, CanonicalStateStream.apply,
//    presentationState, and the postMessage structured clone split into its
//    worker half (v8.serialize) and main-thread half (v8.deserialize);
//  - packed path: presentationPacket + serialize (worker), deserialize +
//    SnapshotDecoder.decode (main thread);
//  - bytes per expansion key and per entity class of the decoded packet.
// Decision rule (summary N4): adopt the packed path on the main thread only if
// its main-thread cost (deserialize + decode) is below the entity path's
// main-thread clone half; otherwise use the lazy row view (WP7).
import { readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { decodeState } from "../../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../../src/skirmish/multiplayer/StateLimits";
import { CanonicalStateStream } from "../../../src/skirmish/client/CanonicalStateStream";
import { SnapshotDecoder } from "../../../src/skirmish/SnapshotCodec";
import type { SnapshotPacket } from "../../../src/skirmish/Protocol";

const [file, widthArg, heightArg, outArg] = process.argv.slice(2);
if (!file || !widthArg || !heightArg) throw new Error("usage: PublicationClientBench.ts <dump.pubs.bin> <W> <H> [out.json]");
const W = Number(widthArg), H = Number(heightArg);
const buffer = readFileSync(file);
const entityStream = new CanonicalStateStream(W * H, 65_536, { width: W, height: H });
const packedStream = new CanonicalStateStream(W * H, 65_536, { width: W, height: H });
const mainDecoder = new SnapshotDecoder();
const byteLength = (value: unknown) => {
  if (value === undefined) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return JSON.stringify(value, (_k, v) => ArrayBuffer.isView(v) ? `<${(v as ArrayBufferView).byteLength}>` : v)?.length ?? 0;
};
const rows: Record<string, number>[] = [];
const keyBytes = new Map<string, number[]>();
const classBytes = new Map<string, number[]>();
const add = (map: Map<string, number[]>, key: string, value: number) => { let list = map.get(key); if (!list) map.set(key, list = []); list.push(value); };
let at = 0;
while (at < buffer.length) {
  const tick = buffer.readUInt32LE(at), length = buffer.readUInt32LE(at + 4), hash = buffer.toString("latin1", at + 8, at + 72);
  const binary = new Uint8Array(buffer.buffer.slice(buffer.byteOffset + at + 76, buffer.byteOffset + at + 76 + length));
  at += 76 + length;
  let raw = 0, metadata = 0;
  const t0 = performance.now();
  const packet = await decodeState<SnapshotPacket>({ hash, payload: "", binary },
    { ...SNAPSHOT_STATE_LIMITS, onDecoded: stats => { raw = stats.wireBytes; metadata = stats.metadataBytes; } });
  const t1 = performance.now();
  // Two independent canonical streams so both paths see identical input.
  const packedInput = structuredClone(packet);
  entityStream.apply(packet);
  const t2 = performance.now();
  const view = entityStream.presentationState();
  const t3 = performance.now();
  const serialized = serialize(view);
  const t4 = performance.now();
  deserialize(serialized);
  const t5 = performance.now();
  entityStream.acknowledge(view.canonicalSequence);

  packedStream.apply(packedInput);
  const p0 = performance.now();
  const packed = packedStream.presentationPacket();
  const packedSerialized = serialize(packed);
  const p1 = performance.now();
  const received = deserialize(packedSerialized) as typeof packed;
  const p2 = performance.now();
  mainDecoder.decode(received.viewPacket);
  const p3 = performance.now();
  packedStream.acknowledge(packed.canonicalSequence);

  rows.push({ tick, gz: length, raw, metadata, cloneBytes: serialized.byteLength, packedBytes: packedSerialized.byteLength,
    decode: t1 - t0, apply: t2 - t1, project: t3 - t2, cloneWorker: t4 - t3, cloneMain: t5 - t4,
    packedWorker: p1 - p0, packedMainDeserialize: p2 - p1, packedMainDecode: p3 - p2,
    squads: view.view.snapshot.squads.length });
  for (const [key, value] of Object.entries(packet.expansion ?? {})) add(keyBytes, key, byteLength(value));
  add(classBytes, "tiles", byteLength(packet.tiles));
  add(classBytes, "squads", byteLength(packet.squads));
  add(classBytes, "orders", byteLength(packet.orders));
  add(classBytes, "buildings", byteLength(packet.buildingChanges) + byteLength(packet.removedBuildings));
  add(classBytes, "players", byteLength(packet.players));
  add(classBytes, "details", packet.details ? byteLength(packet.details) : 0);
  add(classBytes, "traderChanges", byteLength(packet.traderChanges));
  add(classBytes, "barrierChanges", byteLength(packet.barrierChanges));
}
const stats = (values: number[]) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(v.length * p) - 1))];
  return { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), p99: +q(.99).toFixed(2), max: +v[v.length - 1].toFixed(2) };
};
const body = rows.slice(1); // the first record is the join baseline
const all: Record<string, unknown> = {};
for (const key of Object.keys(body[0] ?? {})) if (key !== "tick") all[key] = stats(body.map(r => r[key]));
const total = (r: Record<string, number>) => r.decode + r.apply + r.project + r.cloneWorker + r.cloneMain;
all.clientTotal = stats(body.map(total));
all.mainThreadEntity = stats(body.map(r => r.cloneMain));
all.mainThreadPacked = stats(body.map(r => r.packedMainDeserialize + r.packedMainDecode));
const mean = (key: string) => (all[key] as { mean: number } | null)?.mean ?? NaN;
const decision = mean("mainThreadPacked") < mean("mainThreadEntity") ? "packed" : "lazy-row-view";
const meanOf = (map: Map<string, number[]>) => Object.fromEntries([...map].map(([k, v]) => [k, Math.round(v.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, v.length - 1))]).sort((a, b) => b[1] - a[1]));
const span = body.length ? (body[body.length - 1].tick - (rows[0]?.tick ?? 0)) / 8 : 0;
const result = { file, publications: rows.length, publicationsPerSimSecond: span ? +(body.length / span).toFixed(2) : null,
  gzKBPerSimSecond: span ? +(body.reduce((a, r) => a + r.gz, 0) / 1024 / span).toFixed(1) : null,
  decision, all, expansionKeyBytesMean: meanOf(keyBytes), entityClassBytesMean: meanOf(classBytes) };
if (outArg) writeFileSync(outArg, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
