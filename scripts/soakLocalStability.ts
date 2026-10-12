import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => {
  const at = args.indexOf(key);
  return at < 0 ? fallback : args[at + 1];
};
const output = value("--out", "out/local-stability-20261012/continuation");
const target = Number(value("--ticks", "36000"));
const publishEvery = Number(value("--publish-every", "4"));
if (!Number.isSafeInteger(target) || target < 0 || !Number.isSafeInteger(publishEvery) || publishEvery < 1)
  throw new Error("Use a nonnegative integer target and a positive integer publication interval");
const source = value("--source", "../src/skirmish");
const checkpoint = value("--checkpoint", "out/performance-investigation-20261012/fresh-checkpoint.v8");
const { generateMigration } = await import(`${source}/MigrationMap.ts`);
const { Skirmish } = await import(`${source}/Simulation.ts`);
const { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } = await import(`${source}/SnapshotCodec.ts`);
const { validateFormation } = await import(`${source}/domain/FormationGeometry.ts`);
const { SpawnSelection } = await import(`${source}/domain/SpawnSelection.ts`);
mkdirSync(output, { recursive: true });
const saved = deserialize(readFileSync(checkpoint));
const freshSeed = value("--seed", "");
if (freshSeed) { saved.options = { ...saved.options, seed: Number(freshSeed), humanSpawns: undefined }; }
const loaded = generateMigration(saved.width ?? 1000, saved.options.seed);
let options = saved.options;
if (freshSeed) { const spawn = new SpawnSelection(loaded.map, options); spawn.resolve(); options = { ...options, humanSpawns: spawn.choices }; }
const game = new Skirmish(loaded.map, options);
if (!freshSeed) game.restore(saved);
const startingTick = game.tick;
const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
let lastPhase = "restore", completed = game.tick, packets = 0;
const recent: { tick: number; ms: number; phase: string }[] = [];
const phases: Record<string, { total: number; count: number; max: number }> = {};
game.onPhase = (name: string, ms: number) => {
  lastPhase = name;
  const row = phases[name] ??= { total: 0, count: 0, max: 0 };
  row.total += ms; row.count++; row.max = Math.max(row.max, ms);
};
const publish = () => {
  lastPhase = "encoding";
  const packet = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
  // A separate decoder owner validates the actual packets the local UI sees.
  lastPhase = "decoding";
  decoder.decodeLatest(structuredClone(packet, { transfer: snapshotTransfers(packet) }));
  packets++;
};
const status = (state: string, error?: unknown) => ({
  state, startingTick, tick: game.tick, completed, target, publishEvery, seed: saved.options.seed, packets,
  squads: game.squads.length, ships: game.ships.length, buildings: game.buildings.length,
  winner: game.winner, phase: lastPhase, phases, recent,
  error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  memory: process.memoryUsage(),
});
try {
  publish();
  while (game.tick < target && game.winner === null) {
    if (game.tick % 1000 === 0) writeFileSync(`${output}/last-good.v8`, serialize(game.checkpoint()));
    const at = performance.now();
    lastPhase = "step";
    game.step();
    completed = game.tick;
    if (game.tick % publishEvery === 0) publish();
    recent.push({ tick: game.tick, ms: performance.now() - at, phase: lastPhase });
    if (recent.length > 256) recent.shift();
    if (game.tick % 200 === 0) {
      const state = status("running");
      writeFileSync(`${output}/progress.json`, JSON.stringify(state, null, 2));
      console.log(JSON.stringify({ tick: game.tick, squads: game.squads.length, ships: game.ships.length,
        maxRecent: Math.max(...recent.map(r => r.ms)), heapMiB: process.memoryUsage().heapUsed / 1048576 }));
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  writeFileSync(`${output}/result.json`, JSON.stringify(status(game.winner === null ? "passed" : "winner"), null, 2));
  writeFileSync(`${output}/final.v8`, serialize(game.checkpoint()));
  console.log(JSON.stringify({ state: "finished", tick: game.tick, winner: game.winner }));
} catch (error) {
  const invalid = game.squads.flatMap((s: any) => { try { validateFormation(s.formation, s.definitionId); return []; } catch (e) { return [{ squad: s, error: String(e) }]; } });
  writeFileSync(`${output}/invalid-formations.json`, JSON.stringify(invalid, null, 2));
  writeFileSync(`${output}/failed-state.v8`, serialize(game.checkpoint()));
  writeFileSync(`${output}/failure.json`, JSON.stringify(status("failed", error), null, 2));
  console.error(error);
  process.exitCode = 1;
}
