/** Run before/after with: node --import tsx tests/skirmish/pacingBenchmark.ts label */
import { writeFileSync } from "node:fs";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { DETAIL_STRIDES } from "../../src/skirmish/SnapshotDetails";
const label = process.argv[2] ?? "candidate";
const results = [];
for (const count of [256, 1024]) {
  const width = 250,
    height = 180,
    terrain = new Uint8Array(width * height).fill(133);
  terrain.fill(0, 60 * width, 160 * width);
  const game = new Skirmish(
    new GameMapImpl(width, height, terrain, terrain.length),
    {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
      deferredPlanning: true,
    },
  );
  for (let i = 0; i < count; i++)
    game.addShip({
      id: game.allocateId(),
      playerId: 1,
      kind: "warship",
      definitionId: "stoneage-warship",
      x: (5 + (i % 235) + 0.5) * FIXED,
      y: (65 + Math.floor(i / 235) * 12 + 0.5) * FIXED,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
    });
  const samples: number[] = [];
  let moved = 0;
  for (let tick = 0; tick < 360; tick++) {
    const positions = game.ships.map((s) => [s.x, s.y]);
    const start = performance.now();
    game.step();
    const elapsed = performance.now() - start;
    if (tick >= 120) {
      samples.push(elapsed);
      moved += game.ships.filter(
        (s, i) => s.x !== positions[i][0] || s.y !== positions[i][1],
      ).length;
    }
  }
  samples.sort((a, b) => a - b);
  const encoder = new SnapshotEncoder();
  encoder.encode(
    game.replicationSource(),
    game.tileChanges,
    game.replicationFacts(),
  );
  let wireBytes = 0,
    changedShips = 0,
    encodingMs = 0;
  for (let sample = 0; sample < 5; sample++) {
    for (let step = 0; step < 10; step++) game.step();
    const start = performance.now(),
      packet = encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      ),
      wire = await encodeState(packet);
    encodingMs += performance.now() - start;
    wireBytes += Math.floor((wire.payload.length * 3) / 4);
    changedShips += (packet.details?.ships.length ?? 0) / DETAIL_STRIDES.ship;
  }
  results.push({
    wireBytesPerHalfSecond: wireBytes / 5,
    changedShipsPerHalfSecond: changedShips / 5,
    encodingMs: encodingMs / 5,
    ships: count,
    ticks: samples.length,
    movingFraction: moved / (samples.length * count),
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
  });
}
writeFileSync(
  `out/pacing-${label}.json`,
  JSON.stringify({ label, results }, null, 2),
);
console.log(JSON.stringify(results));
