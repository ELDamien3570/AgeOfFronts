import { engageDemoArmies, stoneAgeDemo } from "./StoneAgeDemoScenario";

const game = stoneAgeDemo();
engageDemoArmies(game);
const steps: number[] = [],
  snapshots: number[] = [];
let peakFighting = 0;
for (let tick = 0; tick < 600; tick++) {
  const start = performance.now();
  game.step();
  steps.push(performance.now() - start);
  peakFighting = Math.max(
    peakFighting,
    game.squads.filter((s) => s.fighting).length,
  );
  const snapshotStart = performance.now();
  structuredClone(game.snapshot());
  snapshots.push(performance.now() - snapshotStart);
}
const summary = (values: number[]) => {
  const ordered = values.slice().sort((a, b) => a - b);
  return {
    meanMs: values.reduce((sum, v) => sum + v, 0) / values.length,
    p95Ms: ordered[Math.floor((ordered.length - 1) * 0.95)],
    maxMs: ordered[ordered.length - 1],
  };
};
console.log(
  JSON.stringify(
    {
      scope: "Node CPU only; no browser rendering or multiplayer network",
      initialSquads: 400,
      simulatedSeconds: 30,
      peakFighting,
      remainingSquads: game.squads.length,
      remainingTroops: game.squads.reduce((sum, s) => sum + s.troops, 0),
      tick: summary(steps),
      snapshotAndClone: summary(snapshots),
      snapshotJsonBytes: Buffer.byteLength(JSON.stringify(game.snapshot())),
    },
    null,
    2,
  ),
);
