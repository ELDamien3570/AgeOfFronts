// Render a small atlas image from the same baked terrain/elevation as the game.
// Run: node scripts/generateLobbyMapPreview.mjs (no additional dependencies).
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createServer } from "vite";

const assetRoot = process.argv[2] ?? "heightmap-test1";
if (!/^[a-z0-9-]+$/.test(assetRoot))
  throw new Error("Invalid map asset directory");
const root = new URL(`../resources/maps/${assetRoot}/`, import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
const { width, height } = manifest.variants[500];
const terrain = await readFile(new URL("500.terrain.bin", root));
const heights = await readFile(new URL("500.heights.f32", root));
if (terrain.length !== width * height || heights.length !== width * height * 4)
  throw new Error(
    "Heightmap preview input dimensions do not match the manifest",
  );

const pixels = Buffer.alloc(height * (1 + width * 3));
// Reuse the game's environment, forest cover and relief rather than inventing
// a thumbnail-only biome classifier. This server transpiles modules; it never listens.
const server = await createServer({
  configFile: "vite.skirmish.config.ts",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
let loaded, map, environment, relief;
try {
  const [decoder, elevation, forests, painted, presentation] =
    await Promise.all([
      server.ssrLoadModule("/src/skirmish/HeightmapMap.ts"),
      server.ssrLoadModule("/src/skirmish/Elevation.ts"),
      server.ssrLoadModule("/src/skirmish/ForestGeneration.ts"),
      server.ssrLoadModule("/src/skirmish/client/PaintedTerrain.ts"),
      server.ssrLoadModule("/src/skirmish/client/TerrainEnvironment.ts"),
    ]);
  const environmentBytes = manifest.environment
    ? new Uint8Array(await readFile(new URL("500.environment.bin", root)))
    : undefined;
  loaded = decoder.decodeHeightmap(
    manifest,
    500,
    new Uint8Array(terrain),
    heights.buffer.slice(
      heights.byteOffset,
      heights.byteOffset + heights.length,
    ),
    environmentBytes,
  );
  const forest = forests.generateForestCover(loaded.map, loaded.environment);
  map = elevation.createSkirmishMap(
    width,
    height,
    loaded.terrain,
    loaded.elevation,
    forest,
  );
  environment = new presentation.TerrainEnvironment(
    map,
    loaded.geography,
    loaded.environment,
  );
  relief = painted.terrainRelief(map);
} finally {
  await server.close();
}
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const tile = map.ref(x, y);
    const color = environment.colorAt(tile);
    const shade = relief?.[tile] ?? 0;
    const index = y * (1 + width * 3) + 1 + x * 3;
    for (let channel = 0; channel < 3; channel++)
      pixels[index + channel] = Math.min(
        255,
        Math.max(0, Math.round(color[channel] + shade)),
      );
  }
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const bytes = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  bytes.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8; // RGB, 8 bits per channel, no interlacing.
header[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
await writeFile(new URL("lobby-preview.png", root), png);
console.log(
  `${manifest.name} lobby preview: ${width}×${height}, ${png.length} bytes`,
);
