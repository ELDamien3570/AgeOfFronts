import { readFileSync } from "node:fs";
import { generateMigration } from "../src/skirmish/MigrationMap";
function metrics(
  width: number,
  height: number,
  h: Float32Array,
  land: Uint8Array,
  minimumHeight = 0,
) {
  const gradient: number[] = [],
    curvature: number[] = [];
  let peak = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const t = y * width + x,
        ns = [t - 1, t + 1, t - width, t + width];
      if (!land[t] || h[t] < minimumHeight || ns.some((n) => !land[n]))
        continue;
      peak = Math.max(peak, h[t]);
      gradient.push(
        Math.hypot(h[t + 1] - h[t - 1], h[t + width] - h[t - width]) / 2,
      );
      curvature.push(Math.abs(h[t] - ns.reduce((s, n) => s + h[n], 0) / 4));
    }
  const stats = (a: number[]) => {
    a.sort((x, y) => x - y);
    return {
      mean: a.reduce((s, n) => s + n, 0) / a.length,
      p50: a[Math.floor(a.length * 0.5)],
      p90: a[Math.floor(a.length * 0.9)],
      p99: a[Math.floor(a.length * 0.99)],
    };
  };
  return {
    width,
    height,
    minimumHeight,
    interiorSamples: gradient.length,
    peak,
    gradientMetresPerCell: stats(gradient),
    curvatureMetres: stats(curvature),
  };
}
const bytes = readFileSync("resources/maps/heightmap-test1/1000.heights.f32"),
  view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  h = new Float32Array(bytes.length / 4);
for (let i = 0; i < h.length; i++) h[i] = view.getFloat32(i * 4, true);
const terrain = readFileSync("resources/maps/heightmap-test1/1000.terrain.bin");
console.log(
  JSON.stringify({
    map: "Mediterranean",
    ...metrics(
      1000,
      500,
      h,
      Uint8Array.from(terrain, (v) => Number((v & 128) !== 0)),
    ),
  }),
);
console.log(
  JSON.stringify({
    map: "Mediterranean uplands",
    ...metrics(
      1000,
      500,
      h,
      Uint8Array.from(terrain, (v) => Number((v & 128) !== 0)),
      600,
    ),
  }),
);
for (const seed of [614546621, 3, 42]) {
  const m = generateMigration(1000, seed);
  const land = Uint8Array.from(m.terrain, (_, t) => Number(m.map.isLand(t)));
  console.log(
    JSON.stringify({
      map: "Migration",
      seed,
      ...metrics(1000, 1000, m.elevation!.values, land),
    }),
  );
  console.log(
    JSON.stringify({
      map: "Migration uplands",
      seed,
      ...metrics(1000, 1000, m.elevation!.values, land, 600),
    }),
  );
}
