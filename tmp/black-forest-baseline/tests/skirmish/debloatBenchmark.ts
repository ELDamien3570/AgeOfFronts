/** Frozen-source, same-checkpoint continuation; timings are local headless evidence. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deserialize } from "node:v8";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { createSkirmishMap } from "../../src/skirmish/Elevation";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { FIXED } from "../../src/skirmish/Protocol";
import type { Skirmish } from "../../src/skirmish/Simulation";
import type { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";

const source = resolve(process.argv[2]),
  output = resolve(process.argv[3]);
const ticks = Number(process.argv[4] ?? 400);
if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 1200)
  throw new Error("Expected 1..1200 ticks");
const mass = process.argv[5] === "mass";
const input = mass
  ? undefined
  : readFileSync("out/overnight-1000/seed42-filtered/checkpoint-60000.v8");
const Game = (
  await import(
    pathToFileURL(resolve(source, "src/skirmish/Simulation.ts")).href
  )
).Skirmish as typeof Skirmish;
const Encoder = (
  await import(
    pathToFileURL(resolve(source, "src/skirmish/SnapshotCodec.ts")).href
  )
).SnapshotEncoder as typeof SnapshotEncoder;
const createMap = (
  await import(pathToFileURL(resolve(source, "src/skirmish/Elevation.ts")).href)
).createSkirmishMap as typeof createSkirmishMap;
let game: Skirmish;
if (mass) {
  const terrain = new Uint8Array(300 * 200).fill(133);
  game = new Game(new GameMapImpl(300, 200, terrain, terrain.length), {
    seed: 42,
    aiCount: 14,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1",
    deferredPlanning: true,
  });
  const template = game.squads[0];
  for (const squad of game.squads) game.removeSquad(squad.id);
  for (let at = 0; at < 1500; at++) {
    const owner = Math.floor(at / 100),
      member = at % 100;
    const x = 10 + (owner % 5) * 56 + (member % 10) * 2,
      y = 10 + Math.floor(owner / 5) * 60 + Math.floor(member / 10) * 2;
    const tile = game.map.ref(x + 20, y);
    game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: owner + 1,
      troops: 1000,
      x: (x + 0.5) * FIXED,
      y: (y + 0.5) * FIXED,
      embarkedOn: null,
      order: { type: "move", tile },
      path: [tile],
      nextPathIndex: 0,
      plannedTile: tile,
      queuedOrders: [],
      lastPlanTick: 0,
    });
  }
} else {
  const saved = deserialize(input!) as ReturnType<Skirmish["checkpoint"]>;
  const loaded = await loadServerMap(defaultLobbySettings("old-world", 1000));
  const data = structuredClone(loaded.map);
  game = new Game(
    createMap(
      data.width,
      data.height,
      data.terrain,
      data.elevation,
      data.forest,
      data.resourceTerrain,
    ),
    saved.options,
  );
  game.restore(saved);
}
const encoder = new Encoder(true),
  raw: Record<string, number[]> = {};
game.onPhase = (phase, ms) => (raw[phase] ??= []).push(ms);
const step: number[] = [],
  snapshot: number[] = [];
const initial = {
  squads: game.squads.length,
  ships: game.ships.length,
  buildings: game.buildings.length,
  traders: game.expansion?.trade.actors.length,
};
for (let at = 0; at < ticks; at++) {
  if (game.winner !== null) throw new Error("Fixture ended before coverage");
  let start = performance.now();
  game.step();
  step.push(performance.now() - start);
  if (at % 4 === 0) {
    start = performance.now();
    encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    snapshot.push(performance.now() - start);
  }
}
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
const summary = (samples: number[]) => {
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95: sorted[Math.ceil(samples.length * 0.95) - 1],
    p99: sorted[Math.ceil(samples.length * 0.99) - 1],
    maximum: sorted[sorted.length - 1],
  };
};
const report = {
  source,
  ticks,
  initial,
  finalSquads: game.squads.length,
  checkpointSha256: input
    ? createHash("sha256").update(input).digest("hex")
    : undefined,
  snapshotHash: digest(game.snapshot()),
  checkpointHash: digest(game.checkpoint()),
  step: summary(step),
  snapshot: summary(snapshot),
  phases: Object.fromEntries(
    Object.entries(raw).map(([phase, samples]) => [phase, summary(samples)]),
  ),
  memory: process.memoryUsage(),
  raw: { step, snapshot, phases: raw },
  limitations: mass
    ? "Synthetic 1500-squad marching fixture, 15 factions, no AI, no combat, 300x200 all-land map; no multiplayer load or release qualification."
    : "Local x64 headless continuation of an existing diagnostic checkpoint; no rendered client, sockets, active human input, new allocation profile, or release qualification.",
};
writeFileSync(output, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ ...report, raw: undefined }));
