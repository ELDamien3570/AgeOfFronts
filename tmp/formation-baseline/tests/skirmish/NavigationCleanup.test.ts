import { expect, it } from "vitest";

it("does not retain a removed unit's navigation generation", async () => {
  const { GameMapImpl } = await import("../../src/core/game/GameMap");
  const { Skirmish } = await import("../../src/skirmish/Simulation");
  const cells = new Uint8Array(64 * 48).fill(133);
  const match = new Skirmish(new GameMapImpl(64, 48, cells, cells.length), { seed: 47, aiCount: 1, runAi: false, tribes: false });
  const squad = match.squads[0];
  match.applyCommand({ type: "order", playerId: squad.playerId, squadIds: [squad.id], order: { type: "hold" } });
  expect(match.checkpoint().orderRevisions.has(squad.id)).toBe(true);
  for (const record of match.squads.slice(match.squads.indexOf(squad), (match.squads.indexOf(squad)) + (1))) match.removeSquad(record.id); match.step();
  const saved = match.checkpoint();
  expect(saved.orderRevisions.has(squad.id)).toBe(false);
  expect(saved.queuedLegs.has(squad.id)).toBe(false);
});
