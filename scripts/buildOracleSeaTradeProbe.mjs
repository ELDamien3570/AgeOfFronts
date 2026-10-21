// Builds an isolated fixture probe; production bundles/source are never patched.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const out = process.argv[2] ?? "build/sea-trade-probe";
const runtime = "src/skirmish/multiplayer/application/MatchRuntime.ts";
const original = readFileSync(runtime, "utf8"),
  needle = "match = new Skirmish(makeMap(map), options);";
if (original.split(needle).length !== 2)
  throw Error("Fixture seam changed; review before building");
const injected =
  `import {restoreProbeFixture,probeFixtureOptions} from ${JSON.stringify(resolve("scripts/oracleSeaTradeFixture.mjs"))};\n` +
  original.replace(
    needle,
    "options = probeFixtureOptions(options);\n    " +
      needle +
      "\n    restoreProbeFixture(match);",
  );
let seams = 0;
await build({
  entryPoints: {
    server: "scripts/oracleSeaTradeProbeServer.mjs",
    serverMatchWorker:
      "src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts",
    snapshotEncoderThread:
      "src/skirmish/multiplayer/infrastructure/snapshotEncoderThread.ts",
    client: "scripts/oracleSeaTradeProbeClient.mjs",
  },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: "linked",
  keepNames: false,
  logLevel: "info",
  plugins: [
    {
      name: "isolated-fixture-restore-only",
      setup(b) {
        b.onLoad({ filter: /[\\/]application[\\/]MatchRuntime\.ts$/ }, () => {
          seams++;
          return {
            contents: injected,
            loader: "ts",
            resolveDir: resolve("src/skirmish/multiplayer/application"),
          };
        });
      },
    },
  ],
});
if (seams !== 1) throw Error("Expected one fixture restore seam");
mkdirSync(out, { recursive: true });
writeFileSync(
  out + "/fixture-seam.json",
  JSON.stringify(
    {
      runtime,
      originalSha256: createHash("sha256").update(original).digest("hex"),
      needle,
      insertion:
        "exact saved options before construction; restoreProbeFixture(match) immediately after construction, before production runtime attaches callbacks/runner",
      productionSourceUnchanged: true,
      limitations:
        "Fixture initialization and bounded timing instrumentation only; ordinary production LiveMatch, worker caps, command, encoder and socket paths. No renderer.",
    },
    null,
    2,
  ),
);
