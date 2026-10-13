import { readFileSync } from "node:fs";
import { deserialize } from "node:v8";
import { generateMigration } from "../src/skirmish/MigrationMap";
import { Skirmish } from "../src/skirmish/Simulation";
import { SnapshotEncoder } from "../src/skirmish/SnapshotCodec";
const state = deserialize(readFileSync(process.argv[2] ?? "out/local-stability-20261012/fixed-browser-seed/final.v8"));
const game = new Skirmish(generateMigration(state.width, state.options.seed).map, state.options);
game.restore(state);
const encoder = new SnapshotEncoder(false, { compactFormationSlots: true });
encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
game.step();
const packet = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
function inspect(value: unknown) {
  let strings = 0, stringBytes = 0, objects = 0, numbers = 0, bufferBytes = 0;
  const seen = new Set<object>();
  function walk(v: unknown) {
    if (typeof v === "string") { strings++; stringBytes += Buffer.byteLength(v); }
    else if (typeof v === "number") numbers++;
    else if (v && typeof v === "object" && !seen.has(v)) {
      seen.add(v); objects++;
      if (ArrayBuffer.isView(v)) bufferBytes += v.byteLength;
      else for (const child of Object.values(v)) walk(child);
    }
  }
  walk(value); return { objects, numbers, strings, stringBytes, bufferBytes };
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(packet).map(([key, value]) => [key, inspect(value)])), null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(packet.expansion ?? {}).map(([key, value]) => [key, inspect(value)])), null, 2));
