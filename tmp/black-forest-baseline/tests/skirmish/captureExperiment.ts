/** Isolated fixed-radius prototype. Never used by the simulation. */
import { writeFileSync } from "node:fs";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { CAPTURE_RADIUS } from "../../src/skirmish/Protocol";

const width = 128,
  height = 96,
  radius = CAPTURE_RADIUS;
const terrain = new Uint8Array(width * height).fill(133);
const map = new GameMapImpl(width, height, terrain, terrain.length),
  paths = new LandPaths(map);
const spans = Array.from({ length: radius * 2 + 1 }, (_, i) =>
  Math.floor(Math.sqrt(radius ** 2 - (i - radius) ** 2)),
);
const masks = new Map<string, Uint32Array>();
let retainedTiles = 0;
const visit = (center: number, fn: (tile: number) => void) => {
  const cx = map.x(center),
    cy = map.y(center),
    component = paths.component[center];
  for (
    let y = Math.max(0, cy - radius);
    y <= Math.min(height - 1, cy + radius);
    y++
  ) {
    const span = spans[y - cy + radius];
    for (
      let x = Math.max(0, cx - span);
      x <= Math.min(width - 1, cx + span);
      x++
    ) {
      const tile = map.ref(x, y);
      if (paths.walkable(tile) && paths.component[tile] === component) fn(tile);
    }
  }
};
const cached = (center: number, fn: (tile: number) => void) => {
  const key = `${center}:${radius}`;
  let mask = masks.get(key);
  if (mask) {
    masks.delete(key);
    masks.set(key, mask);
  } else {
    const rows: number[] = [];
    visit(center, (tile) => rows.push(tile));
    while (masks.size >= 4096 || retainedTiles + rows.length > 262144) {
      const [oldest, old] = masks.entries().next().value!;
      masks.delete(oldest);
      retainedTiles -= old.length;
    }
    mask = Uint32Array.from(rows);
    masks.set(key, mask);
    retainedTiles += mask.length;
  }
  for (const tile of mask) fn(tile);
};
const centers = Array.from({ length: 1000 }, (_, i) =>
  map.ref(4 + (i % 120), 4 + Math.floor(i / 120)),
);
for (const center of centers) {
  const a: number[] = [],
    b: number[] = [];
  visit(center, (tile) => a.push(tile));
  cached(center, (tile) => b.push(tile));
  if (a.join(",") !== b.join(","))
    throw new Error("Capture prototype mismatch");
}
let visits = 0;
const count = () => {
  visits++;
};
const samples = { baselineMs: [] as number[], candidateMs: [] as number[] };
const measure = (run: typeof visit) => {
  const start = performance.now();
  for (const center of centers) run(center, count);
  return performance.now() - start;
};
for (let i = 0; i < 68; i++) {
  const first = i % 2 ? measure(cached) : measure(visit),
    second = i % 2 ? measure(visit) : measure(cached);
  if (i >= 8) {
    samples.baselineMs.push(i % 2 ? second : first);
    samples.candidateMs.push(i % 2 ? first : second);
  }
}
const summary = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.ceil(values.length * 0.95) - 1],
    p99: sorted[Math.ceil(values.length * 0.99) - 1],
  };
};
const report = {
  evidence: "synthetic fixed-radius capture prototype",
  radius,
  centers: centers.length,
  baseline: summary(samples.baselineMs),
  candidate: summary(samples.candidateMs),
  raw: samples,
  retainedTileBytes: retainedTiles * 4,
  visits,
  limitation:
    "Stationary warm cache only; excludes invalidation, moving misses, callback gameplay and full-tick cost. Prototype is not integrated.",
};
writeFileSync(
  "Optimization Handoff/Evidence/1.2.1/capture-radius3-experiment.json",
  JSON.stringify(report, null, 2),
);
process.stdout.write(JSON.stringify(report, null, 2));
