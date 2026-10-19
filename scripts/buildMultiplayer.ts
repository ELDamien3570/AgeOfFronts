// Bundles the multiplayer coordinator and its two worker entries into plain
// ESM for node, so production runs without the tsx loader. tsx transpiles
// with keepNames, which wraps hot closures in __name() calls; the 2026-10-18
// late-game profile measured that runtime overhead at about 2% of the match
// worker. Each entry is a sibling in the output directory, which is how
// WorkerEntry.ts finds them. node_modules packages stay external.
//
//   node node_modules/tsx/dist/cli.mjs scripts/buildMultiplayer.ts [--out build/multiplayer]
import { build } from "esbuild";

const args = process.argv.slice(2);
const outdir = args.includes("--out") ? args[args.indexOf("--out") + 1] : "build/multiplayer";
await build({
  entryPoints: {
    server: "src/skirmish/multiplayer/server.ts",
    serverMatchWorker: "src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts",
    snapshotEncoderThread: "src/skirmish/multiplayer/infrastructure/snapshotEncoderThread.ts",
  },
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: `node${process.versions.node}`,
  packages: "external",
  sourcemap: "linked",
  keepNames: false,
  logLevel: "info",
});
// The coordinator still hashes src/ at startup (RuntimeBuild.ts), so the
// deployed image keeps src/ beside the bundle.
console.log(`multiplayer server bundled to ${outdir}`);
