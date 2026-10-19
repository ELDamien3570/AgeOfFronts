// Parity-gated A/B of two source trees on a late-game fixture
// (scripts/createLateGameFixture.ts). Both matches restore the same
// checkpoint in one process and step in alternating order, so drift and
// background load do not favor either side. Publications follow the server
// path (replicationSource() + network SnapshotEncoder) every --publish-every
// ticks.
//
// Parity: every publication packet and, every --hash-every ticks, the
// checkpoint (canonical sha256, see digest(): numbers by value) must be
// byte-identical. Any difference is reported with its first tick and the
// process exits 1. Timings exclude hashing.
//
//   node node_modules/tsx/dist/cli.mjs scripts/fixtureParityPair.ts \
//     --fixture out/profile-1h-20261018/checkpoint-sim60.v8 \
//     [--control-ref HEAD | --control <dir>/src/skirmish] [--candidate src/skirmish] \
//     [--warmup 200] [--ticks 400] [--publish-every 2] [--hash-every 50] [--out out/parity/<name>]
//     [--candidate-borrowed]   candidate publishes borrowed traders (replicationSource(true))
//     [--bundled]              run each tree as an esbuild bundle without keepNames,
//                              as the production server does (scripts/buildMultiplayer.ts)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deserialize, serialize } from "node:v8";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const integer = (key: string, fallback: string, minimum: number) => {
  const parsed = Number(value(key, fallback));
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid ${key}`);
  return parsed;
};
const fixture = value("--fixture", "out/profile-1h-20261018/checkpoint-sim60.v8");
const warmup = integer("--warmup", "200", 0);
const ticks = integer("--ticks", "400", 1);
const publishEvery = integer("--publish-every", "2", 1);
const hashEvery = integer("--hash-every", "50", 1);
const output = value("--out", `out/parity/${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** A control tree from a git ref, archived once under out/parity/control-<sha>. */
function controlTree(): string {
  if (args.includes("--control")) return resolve(value("--control", ""));
  const sha = execFileSync("git", ["rev-parse", value("--control-ref", "HEAD")], { encoding: "utf8" }).trim();
  const root = resolve(`out/parity/control-${sha.slice(0, 12)}`);
  if (!existsSync(`${root}/src/skirmish/Simulation.ts`)) {
    mkdirSync(root, { recursive: true });
    const archive = execFileSync("git", ["archive", "--format=tar", sha, "src"],{ maxBuffer: 1 << 30 });
    execFileSync("tar", ["-x", "-C", root], { input: archive, maxBuffer: 1 << 30 });
  }
  return `${root}/src/skirmish`;
}

const saved = readFileSync(fixture);
type Run = Awaited<ReturnType<typeof load>>;
/** The four entry points a run needs, from source (tsx) or a production-style bundle. */
async function entryPoints(source: string) {
  const files = { loadServerMap: "multiplayer/infrastructure/ServerMap.ts", createSkirmishMap: "Elevation.ts",
    Skirmish: "Simulation.ts", SnapshotEncoder: "SnapshotCodec.ts" } as const;
  if (!args.includes("--bundled")) {
    const at = (file: string) => import(pathToFileURL(resolve(source, file)).href);
    return { loadServerMap: (await at(files.loadServerMap)).loadServerMap, createSkirmishMap: (await at(files.createSkirmishMap)).createSkirmishMap,
      Skirmish: (await at(files.Skirmish)).Skirmish, SnapshotEncoder: (await at(files.SnapshotEncoder)).SnapshotEncoder };
  }
  const { build } = await import("esbuild");
  const id = createHash("sha256").update(source).digest("hex").slice(0, 12), dir = resolve("out/parity/bundles");
  mkdirSync(dir, { recursive: true });
  const entry = `${dir}/${id}-entry.ts`, outfile = `${dir}/${id}.mjs`;
  writeFileSync(entry, Object.entries(files).map(([name, file]) =>
    `export { ${name} } from ${JSON.stringify(resolve(source, file).split("\\").join("/"))};`).join("\n"));
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm", packages: "external",
    target: `node${process.versions.node}`, keepNames: false, logLevel: "warning" });
  // A query string keeps the two bundles distinct module instances.
  return await import(`${pathToFileURL(outfile).href}?tree=${id}`);
}
async function load(source: string, borrowedTraders = false) {
  const { loadServerMap, createSkirmishMap, Skirmish, SnapshotEncoder } = await entryPoints(source);
  const state = deserialize(saved);
  const loaded = await loadServerMap(state.settings, undefined, state.seed);
  const m = loaded.map;
  const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), state.options);
  game.restore(state.checkpoint);
  // The coordinator's network encoder (serverMatchWorker.ts): sparse baseline, compact rows.
  const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
  let phases: Record<string, number> = {};
  game.onPhase = (name: string, ms: number) => { phases[name] = (phases[name] ?? 0) + ms; };
  const rows: { tick: number; simulation: number; publish: number; phases: Record<string, number> }[] = [];
  const publish = () => encoder.encode(game.replicationSource(borrowedTraders), game.tileChanges, game.replicationFacts());
  publish(); // Establish the encoder's baseline.
  return {
    source, game, rows,
    step(measured: boolean): unknown {
      phases = {};
      let started = performance.now();
      game.step();
      const simulation = performance.now() - started;
      let packet: unknown, publishMs = 0;
      if (game.tick % publishEvery === 0) {
        started = performance.now();
        packet = publish();
        publishMs = performance.now() - started;
      }
      if (measured) rows.push({ tick: game.tick, simulation, publish: publishMs, phases });
      return packet;
    },
  };
}
/** sha256 of a canonical encoding. v8.serialize writes a small integer and the
 * same number held as a heap double differently, and which one V8 uses depends
 * on JIT state, so equal checkpoints from two module instances can differ in
 * bytes. Every number is hashed as its float64 value instead (-0 stays
 * distinct); strings, key order, Map/Set order and typed-array contents count. */
function digest(value: unknown): string {
  const hash = createHash("sha256"), scratch = Buffer.alloc(1 << 16);
  let used = 0;
  const flush = () => { if (used) { hash.update(scratch.subarray(0, used)); used = 0; } };
  const tag = (t: number) => { if (used + 9 > scratch.length) flush(); scratch[used++] = t; };
  const number = (n: number) => { tag(1); scratch.writeDoubleLE(n, used); used += 8; };
  const text = (s: string) => { tag(2); number(s.length); flush(); hash.update(s); };
  const walk = (v: unknown): void => {
    if (v === undefined) return tag(3);
    if (v === null) return tag(4);
    switch (typeof v) {
      case "number": return number(v);
      case "string": return text(v);
      case "boolean": return tag(v ? 5 : 6);
      case "bigint": return text(`n${v}`);
      case "object": break;
      default: throw new Error(`Cannot digest ${typeof v}`);
    }
    if (ArrayBuffer.isView(v)) { text(v.constructor.name); flush(); hash.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return; }
    if (v instanceof Map) { tag(7); number(v.size); for (const [k, x] of v) { walk(k); walk(x); } return; }
    if (v instanceof Set) { tag(8); number(v.size); for (const x of v) walk(x); return; }
    if (Array.isArray(v)) { tag(9); number(v.length); for (let i = 0; i < v.length; i++) walk(v[i]); return; }
    tag(10);
    const keys = Object.keys(v as object);
    number(keys.length);
    for (const key of keys) { text(key); walk((v as Record<string, unknown>)[key]); }
  };
  walk(value);
  flush();
  return hash.digest("hex");
}

const controlSource = controlTree();
const candidateSource = resolve(value("--candidate", "src/skirmish"));
console.log(JSON.stringify({ fixture, control: controlSource, candidate: candidateSource }));
const control = await load(controlSource);
const candidate = await load(candidateSource, args.includes("--candidate-borrowed"));
const divergence: { kind: string; tick: number }[] = [];
const compare = (kind: string, a: unknown, b: unknown) => {
  if (divergence.length < 20 && digest(a) !== digest(b)) {
    // The first divergence of each kind is saved for diffing (out/<name>/diverged-*.v8).
    if (!divergence.some((d) => d.kind === kind)) {
      mkdirSync(output, { recursive: true });
      writeFileSync(`${output}/diverged-${kind}-control.v8`, serialize(a));
      writeFileSync(`${output}/diverged-${kind}-candidate.v8`, serialize(b));
    }
    divergence.push({ kind, tick: control.game.tick });
  }
};
compare("restore", control.game.checkpoint(), candidate.game.checkpoint());
let publications = 0, checkpoints = 1;
for (let index = 0; index < warmup + ticks; index++) {
  const measured = index >= warmup;
  const order: Run[] = index % 2 ? [candidate, control] : [control, candidate];
  const packets = new Map<Run, unknown>();
  for (const run of order) packets.set(run, run.step(measured));
  if (packets.get(control) !== undefined || packets.get(candidate) !== undefined) {
    publications++;
    compare("publication", packets.get(control), packets.get(candidate));
  }
  if (control.game.tick % hashEvery === 0) { checkpoints++; compare("checkpoint", control.game.checkpoint(), candidate.game.checkpoint()); }
  if (divergence.length && args.includes("--stop-on-divergence")) break;
  if (measured && (index - warmup + 1) % 100 === 0) {
    const mean = (run: Run) => (run.rows.slice(-100).reduce((n, r) => n + r.simulation + r.publish, 0) / 100).toFixed(2);
    console.log(JSON.stringify({ measured: index - warmup + 1, control: mean(control), candidate: mean(candidate), divergences: divergence.length }));
  }
}
const finalHashes = { control: digest(control.game.checkpoint()), candidate: digest(candidate.game.checkpoint()) };
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((n, v) => n + v, 0) / values.length;
  return { mean: +mean.toFixed(3), p50: +sorted[Math.floor(values.length / 2)].toFixed(3),
    p95: +sorted[Math.ceil(values.length * 0.95) - 1].toFixed(3), max: +sorted.at(-1)!.toFixed(3) };
};
const summary = (run: Run) => ({
  total: stats(run.rows.map((r) => r.simulation + r.publish)),
  simulation: stats(run.rows.map((r) => r.simulation)),
  publish: stats(run.rows.filter((r) => r.publish > 0).map((r) => r.publish)),
  phases: Object.fromEntries([...new Set(run.rows.flatMap((r) => Object.keys(r.phases)))]
    .map((phase) => [phase, stats(run.rows.map((r) => r.phases[phase] ?? 0)).mean])),
});
const result = {
  fixture, warmup, ticks, publishEvery, hashEvery, finalTick: control.game.tick,
  parity: { identical: divergence.length === 0 && finalHashes.control === finalHashes.candidate,
    publicationsCompared: publications, checkpointsCompared: checkpoints, divergence, finalHashes },
  control: summary(control), candidate: summary(candidate),
};
const saving = result.control.total.mean - result.candidate.total.mean;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ parity: result.parity.identical, divergence: divergence.slice(0, 3),
  controlMs: result.control.total.mean, candidateMs: result.candidate.total.mean,
  savingMs: +saving.toFixed(2), savingPct: +(100 * saving / result.control.total.mean).toFixed(1), out: output }));
process.exit(result.parity.identical ? 0 : 1);
