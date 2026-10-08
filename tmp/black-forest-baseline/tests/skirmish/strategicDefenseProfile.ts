import { writeFileSync } from "node:fs";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { defaultUnit } from "../../src/skirmish/content/Units";
const width = 1000,
  height = 660,
  terrain = new Uint8Array(width * height).fill(133);
const game = new Skirmish(
  new GameMapImpl(width, height, terrain, terrain.length),
  { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
);
const state = game.checkpoint();
state.owners.fill(2);
game.restore(state);
for (let i = 0; i < 32; i++)
  for (let stack = 0; stack < 10; stack++)
    game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "missile-defence",
      tile: game.map.ref(100 + i * 22, 320),
      age: "Modern",
      remainingTicks: 0,
      health: 6000,
      maxHealth: 6000,
    });
for (let i = 0; i < 128; i++)
  game.expansion!.battle.fire(
    {
      id: 999,
      playerId: 1,
      domain: "building",
      x: (150 + (i % 32) * 22) * FIXED,
      y: 320.5 * FIXED,
    },
    { x: (100.5 + (i % 32) * 22) * FIXED, y: 320.5 * FIXED },
    {
      ...defaultUnit("infantry").attack,
      projectile: { diameter: FIXED / 2, speed: FIXED, blastRadius: 3 * FIXED },
    },
    3000,
    "warhead",
    120,
  );
const ticks: number[] = [];
for (let i = 1; i <= 120; i++) {
  game.tick = i;
  const active = game.expansion!.battle.projectiles.some((p) => !p.impacted);
  const start = performance.now();
  game.expansion!.battle.advanceProjectiles();
  if (active) ticks.push(performance.now() - start);
}
// Cost of an unprotected H-bomb's 2,453-cell territorial impact, separately
// from the ordinary tick baseline and the interceptor workload above.
const blastStart = performance.now();
game.nuclearBlast(500.5 * FIXED, 200.5 * FIXED, 28 * FIXED);
const blastMs = performance.now() - blastStart;
const sorted = [...ticks].sort((a, b) => a - b),
  result = {
    scope:
      "Local isolated Battle phase, 320 launchers and 128 simultaneous warheads; not a full-match release gate",
    launchers: 320,
    warheads: 128,
    battle: {
      activeTicks: ticks.length,
      meanMs: ticks.reduce((a, b) => a + b, 0) / ticks.length,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
    },
    hydrogenTerritory: { milliseconds: blastMs, cells: game.wasteland.size },
  };
writeFileSync(
  "out/strategic-defense-profile.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
