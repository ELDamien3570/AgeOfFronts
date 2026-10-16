// Manual probe, outside the vitest include (tests/skirmish/**/*.test.ts). Not a
// gate: the integration lead runs it on a quiet machine.
//   npx tsx tests/skirmish/perf/SpawnSelectProbe.ts [mapId] [size] [seed]
//   npx tsx tests/skirmish/perf/SpawnSelectProbe.ts black-forest 1000
// Constructs SpawnSelection once, then times select() (the full 52-faction
// resolve) on successful tiles, on tiles rejected up front, and on a roster that
// cannot fit (resolve throws after all 16 attempts). Reports median and p95.
// Pass: Black Forest 1000 successful select median < 10 ms on desktop.
import { SpawnSelection } from "../../../src/skirmish/domain/SpawnSelection";
import { generateProceduralMap } from "../../../src/skirmish/ProceduralMaps";

const mapId = process.argv[2] ?? "black-forest";
const size = Number(process.argv[3] ?? 1000);
const seed = Number(process.argv[4] ?? 1);
const CALLS = 30;

const generated = generateProceduralMap(mapId, size, seed);
if (!generated) throw new Error(`${mapId} is not a procedural map`);
const map = generated.map;

const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, medianMs: +at(0.5).toFixed(2), p95Ms: +at(0.95).toFixed(2), maxMs: +sorted[sorted.length - 1].toFixed(2) };
};
const time = <T>(run: () => T) => {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
};

// 8 humans + 14 AI + 30 tribes = 52 factions.
const options = {
  seed,
  aiCount: 14,
  tribes: true,
  tribeCount: 30,
  ruleset: "ages-v1" as const,
  humanNames: Array.from({ length: 8 }, (_, i) => `H${i + 1}`),
};
const built = time(() => new SpawnSelection(map, options));
const setup = built.value;
console.log(JSON.stringify({ probe: "construct", mapId, size, seed, candidates: setup.candidates.length, ms: +built.ms.toFixed(1) }));

// Successful selects: spread seats over distinct, well-separated candidates.
const ok: number[] = [];
const step = Math.max(1, Math.floor(setup.candidates.length / (CALLS + 1)));
for (let i = 0; i < CALLS; i++) {
  const tile = setup.candidates[(i + 1) * step];
  const seat = (i % options.humanNames.length) + 1;
  const { ms, value } = time(() => setup.select(seat, tile));
  if (value === null) ok.push(ms);
}
console.log(JSON.stringify({ probe: "select-success", ...stats(ok), accepted: ok.length }));

// Cheap up-front rejections (water or a non-viable tile).
const rejected: number[] = [];
let water = 0;
while (water < map.width() * map.height() && setup.viable[water]) water++;
for (let i = 0; i < CALLS; i++) rejected.push(time(() => setup.select(1, water)).ms);
console.log(JSON.stringify({ probe: "select-rejected-upfront", ...stats(rejected) }));

// Failure path: a roster far beyond capacity, so every select runs 16 attempts and throws.
const tight = new SpawnSelection(map, { ...options, tribeCount: 4000 });
const failed: number[] = [];
for (let i = 0; i < 20; i++) {
  const tile = tight.candidates[(i + 1) * step];
  const { ms, value } = time(() => tight.select((i % options.humanNames.length) + 1, tile));
  if (typeof value === "string" && value.includes("too little room")) failed.push(ms);
}
console.log(JSON.stringify({ probe: "select-resolve-failure", roster: 8 + 14 + 4000, ...stats(failed), failures: failed.length }));
