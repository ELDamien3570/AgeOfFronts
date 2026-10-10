import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
const label = process.argv[2] ?? "current";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use a simple diagnostic label");
await mkdir("out", { recursive: true });
await build({ entryPoints: ["tests/skirmish/pacingAutoplay.ts"], bundle: true,
  platform: "node", format: "esm", target: "node24", outfile: `out/ai-pacing-${label}.mjs`,
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
