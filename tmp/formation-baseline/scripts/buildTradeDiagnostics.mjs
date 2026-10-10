import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("out", { recursive: true });
const label = process.argv[2] ?? "current", full = process.argv.includes("--full");
await build({ entryPoints: [full ? "tests/skirmish/multiplayerReleaseProfile.ts" : "tests/skirmish/tradeThroughputProfile.ts"], bundle: true, platform: "node", format: "esm",
  target: "node24", outfile: `out/trade-${full ? "full-" : ""}${label}.mjs`,
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
