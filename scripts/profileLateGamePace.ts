import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { Session } from "node:inspector";
import { createHash } from "node:crypto";
import { generateMigration } from "../src/skirmish/MigrationMap";
import { Skirmish } from "../src/skirmish/Simulation";
import { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } from "../src/skirmish/SnapshotCodec";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const checkpoint = value("--checkpoint", "out/local-stability-20261012/fixed-browser-seed/final.v8");
const output = value("--out", "out/late-game-pace-20261012/baseline");
const count = Number(value("--ticks", "400"));
if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid measured tick count");
const saved = deserialize(readFileSync(checkpoint));
const loaded = generateMigration(saved.width, saved.options.seed);
const game = new Skirmish(loaded.map, saved.options);
game.restore(saved);
const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
const publish = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
decoder.decodeLatest(publish());
for (let i = 0; i < 40; i++) { game.step(); decoder.decodeLatest(publish()); }
let phases: Record<string, number> = {};
game.onPhase = (name, ms) => { phases[name] = ms; };
const session = new Session();
const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => session.post(method as any, params, (error, result) => error ? reject(error) : resolve(result)));
if (args.includes("--cpu")) { session.connect(); await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 1000 }); await post("Profiler.start"); }
const rows: any[] = [];
const started = performance.now();
for (let i = 0; i < count; i++) {
  phases = {};
  let at = performance.now(); game.step(); const simulation = performance.now() - at;
  at = performance.now(); const packet = publish(); const encoding = performance.now() - at;
  at = performance.now(); const delivered = structuredClone(packet, { transfer: snapshotTransfers(packet) }); const transfer = performance.now() - at;
  at = performance.now(); decoder.decodeLatest(delivered); const decoding = performance.now() - at;
  rows.push({ tick: game.tick, simulation, encoding, transfer, decoding, worker: simulation + encoding + transfer, total: simulation + encoding + transfer + decoding, phases, squads: game.squads.length, ships: game.ships.length });
  if ((i + 1) % 100 === 0) { console.log(JSON.stringify({ measured: i + 1, tick: game.tick, squads: game.squads.length, mean: rows.slice(-100).reduce((sum, r) => sum + r.worker, 0) / 100 })); await new Promise(resolve => setImmediate(resolve)); }
}
mkdirSync(output, { recursive: true });
if (args.includes("--cpu")) { const { profile } = await post("Profiler.stop"); session.disconnect(); writeFileSync(`${output}/cpu.cpuprofile`, JSON.stringify(profile)); }
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.ceil(values.length * .95) - 1], p99: sorted[Math.ceil(values.length * .99) - 1], max: sorted[sorted.length - 1], above50: values.filter(v => v > 50).length };
};
const final = serialize(game.checkpoint());
const result = { checkpoint, initialTick: saved.tick, ticks: count, node: process.version, elapsed: performance.now() - started, entities: { squads: game.squads.length, ships: game.ships.length }, timings: Object.fromEntries(["simulation", "encoding", "transfer", "decoding", "worker", "total"].map(key => [key, stats(rows.map(row => row[key]))])), phases: Object.fromEntries(Object.keys(rows[0].phases).map(key => [key, stats(rows.map(row => row.phases[key]))])), finalHash: createHash("sha256").update(final).digest("hex"), limitations: "Node replay, 40 warmup ticks, publication every tick, no renderer/HUD. Transfer measures structured clone rather than browser delivery delay. CPU sampling adds overhead when enabled." };
writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
writeFileSync(`${output}/rows.json`, JSON.stringify(rows));
writeFileSync(`${output}/final.v8`, final);
console.log(JSON.stringify(result));
