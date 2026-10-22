// Builds the same isolated measurement harness around either the current source
// or an exact Git control revision. Production files are never rewritten.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
const args = process.argv.slice(2),
  get = (key, fallback) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const out = get("--out", "build/player-movement-probe"),
  control = get("--control-ref");
if (control && !/^[a-f0-9]{40}$/.test(control))
  throw Error("Full control commit required");
const source =
    control ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runtime = "src/skirmish/multiplayer/application/MatchRuntime.ts";
const commonNetworkFiles=[runtime,"src/skirmish/multiplayer/application/LiveMatch.ts"];
const read = (file) =>
  control && !commonNetworkFiles.includes(file)
    ? execFileSync("git", ["show", `${control}:${file}`], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      })
    : readFileSync(file, "utf8");
const inject = (original) => {
  const needle = "match = new Skirmish(makeMap(map), options);",
    branch =
      'if (request.type === "initialize" || request.type === "prepare") {';
  if (
    original.split(needle).length !== 2 ||
    original.split(branch).length !== 2
  )
    throw Error("Review fixture seam");
  return (
    `import {restoreProbeFixture,probeFixtureOptions,captureProbeCheckpoint,finishProbeProfiling} from ${JSON.stringify(resolve("scripts/oracleSeaTradeFixture.mjs"))};\n` +
    original
      .replace(
        needle,
        "options = probeFixtureOptions(options);\n" +
          needle +
          "\nrestoreProbeFixture(match);",
      )
      .replace(
        branch,
        'if (request.type === "probe-checkpoint") { if (!match) throw Error("No probe match"); await finishProbeProfiling(match); result = captureProbeCheckpoint(match); } else ' +
          branch,
      )
  );
};
let seams = 0;
await build({
  entryPoints: {
    server: "scripts/oracleSeaTradeProbeServer.mjs",
    serverMatchWorker:
      "src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts",
    snapshotEncoderThread:
      "src/skirmish/multiplayer/infrastructure/snapshotEncoderThread.ts",
    client: "scripts/oracleSeaTradeProbeClient.mjs",
    replay: "scripts/replayOracleSeaTradeProbe.ts",
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
      name: "versioned-measurement-source",
      setup(b) {
        b.onLoad({ filter: /\.ts$/ }, (args) => {
          const file = relative(process.cwd(), args.path).replace(/\\/g, "/");
          if (file === runtime) {
            seams++;
            return {
              contents: inject(read(file)),
              loader: "ts",
              resolveDir: resolve("src/skirmish/multiplayer/application"),
            };
          }
          if (control && file.startsWith("src/"))
            return {
              contents: read(file),
              loader: "ts",
              resolveDir: resolve(args.path, ".."),
            };
        });
      },
    },
  ],
});
if (seams !== 1) throw Error("Expected one runtime injection");
mkdirSync(out, { recursive: true });
const hashes = Object.fromEntries(
  [
    "server",
    "serverMatchWorker",
    "snapshotEncoderThread",
    "client",
    "replay",
  ].map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(`${out}/${name}.mjs`))
      .digest("hex"),
  ]),
);
writeFileSync(
  out + "/measurement-build.json",
  JSON.stringify(
    {
      source,
      control: !!control,
      commonNetworkFiles:Object.fromEntries(commonNetworkFiles.map(file=>[file,createHash("sha256").update(readFileSync(file)).digest("hex")])),
      node: process.version,
      bundles: hashes,
      scope:
        "Common isolated harness and recovery cursor fix around an exact control simulation or current candidate; no renderer or production deployment.",
    },
    null,
    2,
  ),
);
