/** Local frozen-source continuation. No sockets, cloud operations or rule overrides.
 * Prepare baseline with git archive 6409654 src, extracted under out/optimization-baseline-6409654.
 * Run each trial in a fresh process: node --import tsx tests/skirmish/optimizationReplay.ts baseline 0 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deserialize } from "node:v8";
import type { createSkirmishMap } from "../../src/skirmish/Elevation";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { computeRuntimeBuild } from "../../src/skirmish/multiplayer/infrastructure/RuntimeBuild";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import type { Skirmish } from "../../src/skirmish/Simulation";
import type { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";

const mode = process.argv[2],
  trial = Number(process.argv[3]);
if (
  !["baseline", "candidate"].includes(mode) ||
  !Number.isSafeInteger(trial) ||
  trial < 0 ||
  trial > 3
)
  throw new Error("Expected baseline|candidate and trial 0..3");
const root = process.cwd(),
  source =
    mode === "baseline"
      ? join(root, "out/optimization-baseline-6409654")
      : root;
const checkpointPath = join(
  root,
  "out/overnight-1000/seed42-filtered/checkpoint-60000.v8",
);
const input = readFileSync(checkpointPath),
  saved = deserialize(input) as ReturnType<Skirmish["checkpoint"]>;
const Game = (
  await import(pathToFileURL(join(source, "src/skirmish/Simulation.ts")).href)
).Skirmish as typeof Skirmish;
const Encoder = (
  await import(
    pathToFileURL(join(source, "src/skirmish/SnapshotCodec.ts")).href
  )
).SnapshotEncoder as typeof SnapshotEncoder;
const loaded = await loadServerMap(defaultLobbySettings("old-world", 1000));
const createMap = (
  await import(pathToFileURL(join(source, "src/skirmish/Elevation.ts")).href)
).createSkirmishMap as typeof createSkirmishMap;
const data = structuredClone(loaded.map),
  map = createMap(
    data.width,
    data.height,
    data.terrain,
    data.elevation,
    data.forest,
    data.resourceTerrain,
  );
const game = new Game(map, saved.options);
game.restore(saved);
const encoder = new Encoder(true),
  raw: Record<string, number[]> = {},
  tickMs: number[] = [],
  snapshotMs: number[] = [];
const maxSamples = 1200;
game.onPhase = (phase, ms) => {
  const rows = (raw[phase] ??= []);
  if (rows.length >= maxSamples)
    throw new Error("Replay timing envelope exceeded");
  rows.push(ms);
};
const start = performance.now(),
  fromTick = game.tick,
  initial = {
    squads: game.squads.length,
    ships: game.ships.length,
    buildings: game.buildings.length,
    traders: game.expansion?.trade.actors.length,
  };
for (let at = 0; at < maxSamples; at++) {
  if (game.winner !== null)
    throw new Error("Replay terminated before required coverage");
  if (performance.now() - start > 180000)
    throw new Error("Replay exceeded local 180-second stop condition");
  let now = performance.now();
  game.step();
  tickMs.push(performance.now() - now);
  if (game.tick % 4 === 0) {
    now = performance.now();
    encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    snapshotMs.push(performance.now() - now);
  }
}
const summary = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    samples: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.ceil(values.length * 0.95) - 1],
    p99: sorted[Math.ceil(values.length * 0.99) - 1],
    maximum: sorted[sorted.length - 1],
    above50Ms: values.filter((v) => v > 50).length,
    above100Ms: values.filter((v) => v > 100).length,
  };
};
const digest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, row: unknown) => {
        if (row instanceof Map) return { entries: [...row] };
        if (row instanceof Set) return { values: [...row] };
        if (ArrayBuffer.isView(row)) return Array.from(row as Uint8Array);
        if (row && typeof row === "object" && !Array.isArray(row))
          return Object.fromEntries(
            Object.entries(row).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          );
        return row;
      }),
    )
    .digest("hex");
const snapshot = game.snapshot(),
  checkpoint = game.checkpoint();
const report = {
  evidence: "local headless full-source checkpoint continuation",
  mode,
  trial,
  baseline: "6409654",
  sourceFingerprint: computeRuntimeBuild(source),
  checkpointSha256: createHash("sha256").update(input).digest("hex"),
  checkpointProvenance:
    "Existing seed42-filtered checkpoint: earlier diagnostic transport-candidate filtering; no filtering or rule overrides applied in this replay.",
  options: saved.options,
  map: { id: "old-world", width: map.width(), height: map.height() },
  factions: game.players.length,
  fromTick,
  toTick: game.tick,
  elapsedMs: performance.now() - start,
  initial,
  final: {
    squads: game.squads.length,
    ships: game.ships.length,
    buildings: game.buildings.length,
    traders: game.expansion?.trade.actors.length,
  },
  tick: summary(tickMs),
  snapshot: summary(snapshotMs),
  phases: Object.fromEntries(
    Object.entries(raw).map(([phase, rows]) => [phase, summary(rows)]),
  ),
  raw: { tickMs, snapshotMs, phases: raw },
  memory: process.memoryUsage(),
  snapshotHash: digest(snapshot),
  checkpointHash: digest(checkpoint),
  fieldHashes: Object.fromEntries(
    Object.entries(snapshot).map(([field, value]) => [field, digest(value)]),
  ),
  limitations:
    "37 factions (10 AI, 25 tribes, 2 idle human seats); 60 simulated seconds; workstation x64; no active human input, real-time pacing, sockets, encoding/compression, rendered clients, ARM or long-soak qualification.",
};
writeFileSync(
  join(
    root,
    `Optimization Handoff/Evidence/1.2.1/replay-${trial}-${mode}.json`,
  ),
  JSON.stringify(report, null, 2),
);
process.stdout.write(
  JSON.stringify({
    mode,
    trial,
    tick: report.tick,
    snapshot: report.snapshot,
    snapshotHash: report.snapshotHash,
    checkpointHash: report.checkpointHash,
  }),
);
