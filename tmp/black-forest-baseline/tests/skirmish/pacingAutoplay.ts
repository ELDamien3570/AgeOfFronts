import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
const label = process.argv[2] ?? "candidate";
const maximumTicks = Number(process.argv[3] ?? 4000);
const results = [];
for (const seed of [47, 72]) {
  const width = 240,
    height = 160,
    data = new Uint8Array(width * height).fill(133);
  data.fill(0, 100 * width, 140 * width);
  const game = new Skirmish(new GameMapImpl(width, height, data, data.length), {
    seed,
    aiCount: 3,
    tribes: false,
    ruleset: "ages-v1",
    runAi: true,
    startingAge: "BronzeAge",
    ...DEFAULT_AI_POLICIES,
  });
  game.players[0].ai = true;
  const commands: Record<string, number> = {},
    apply = game.applyCommand.bind(game);
  game.applyCommand = (command) => {
    commands[command.type] = (commands[command.type] ?? 0) + 1;
    return apply(command);
  };
  const samples = [];
  let moving = 0,
    observations = 0;
  for (let tick = 0; tick < maximumTicks && game.winner === null; tick++) {
    const start = performance.now();
    game.step();
    if (tick >= 100) samples.push(performance.now() - start);
    if (tick % 20 === 0) {
      moving += game.squads.filter((s) => s.moved || s.fighting).length;
      observations += game.squads.length;
    }
  }
  const saved = game.checkpoint(),
    restored = new Skirmish(game.map, game.options);
  restored.restore(saved);
  if (!isDeepStrictEqual(restored.checkpoint(), saved))
    throw Error("Checkpoint round trip changed state");
  let firstDivergence: number | undefined;
  for (let step = 0; step < 30 && game.winner === null; step++) {
    game.step();
    restored.step();
    if (
      firstDivergence === undefined &&
      !isDeepStrictEqual(restored.checkpoint(), game.checkpoint())
    ) {
      firstDivergence = step + 1;
      writeFileSync(
        `out/pacing-first-divergence-${label}-${seed}-original.json`,
        JSON.stringify(game.checkpoint()),
      );
      writeFileSync(
        `out/pacing-first-divergence-${label}-${seed}-restored.json`,
        JSON.stringify(restored.checkpoint()),
      );
    }
  }
  if (!isDeepStrictEqual(restored.checkpoint(), game.checkpoint())) {
    writeFileSync(
      `out/pacing-diverged-original.json`,
      JSON.stringify(game.checkpoint()),
    );
    writeFileSync(
      `out/pacing-diverged-restored.json`,
      JSON.stringify(restored.checkpoint()),
    );
    console.error(
      `Checkpoint continuation diverged: ${label}, seed ${seed}, step ${firstDivergence}`,
    );
  }
  samples.sort((a, b) => a - b);
  results.push({
    seed,
    tick: game.tick,
    winner: game.winner,
    combatTicks: game.combatTicks,
    movingOrFightingFraction: moving / Math.max(1, observations),
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    commands,
    players: game.players.map((p) => ({
      id: p.id,
      land: p.land,
      losses: p.losses,
      age: game.expansion!.progression.states[p.id].age,
      squads: game.squadFacts().byOwner(p.id).length,
      ships: game.shipFacts().byOwner(p.id).length,
    })),
    checkpointContinuation:
      firstDivergence === undefined
        ? "equal-after-30-ticks"
        : `diverged-at-step-${firstDivergence}`,
  });
}
writeFileSync(
  `out/pacing-autoplay-${label}.json`,
  JSON.stringify({ label, results }, null, 2),
);
console.log(JSON.stringify(results));
if (
  results.some((row) => row.checkpointContinuation !== "equal-after-30-ticks")
)
  process.exitCode = 1;
