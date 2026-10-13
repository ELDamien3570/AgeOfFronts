import { readFileSync, writeFileSync } from "node:fs";
import { deserialize } from "node:v8";
import { serializeLateGameFixture } from "./LateGameFixture";

// Benchmark-only transport for the captured Node fixture, including legacy
// nonfinite AI scores. Domain restore still validates the original values.
const root = "out/performance-investigation-20261012";
const saved = deserialize(readFileSync(process.argv[2] ?? `${root}/fresh-checkpoint.v8`));
writeFileSync(
  process.argv[3] ?? `${root}/fresh-browser-fixture.json`,
  serializeLateGameFixture(saved),
);
