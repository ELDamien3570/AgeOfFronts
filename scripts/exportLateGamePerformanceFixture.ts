import { readFileSync, writeFileSync } from "node:fs";
import { deserialize } from "node:v8";

// Benchmark-only transport for the captured Node fixture, including legacy
// nonfinite AI scores. Domain restore still validates the original values.
const root = "out/performance-investigation-20261012";
const saved = deserialize(readFileSync(process.argv[2] ?? `${root}/fresh-checkpoint.v8`));
writeFileSync(
  process.argv[3] ?? `${root}/fresh-browser-fixture.json`,
  JSON.stringify(saved, (_key, value) => {
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
      return { $benchmark: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    if (value instanceof Map) return { $benchmark: "map", entries: [...value] };
    if (value instanceof Set) return { $benchmark: "set", entries: [...value] };
    if (ArrayBuffer.isView(value))
      return {
        $benchmark: "array",
        type: value.constructor.name,
        bytes: Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).toString("base64"),
      };
    return value;
  }),
);
