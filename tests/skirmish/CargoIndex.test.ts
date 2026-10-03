import { unitOwner } from "./UnitFixtures";
import { expect, it } from "vitest";
import { cargoByShip } from "../../src/skirmish/CargoIndex";
import type { Squad } from "../../src/skirmish/Protocol";

it("groups exact live cargo and refreshes embark, unload, removal and restored identities", () => {
  const owner = unitOwner([null, 10, 10, 20].map((embarkedOn, id) => ({ id, embarkedOn }) as Squad));
  let squads = owner.values;
  let index = cargoByShip(squads);
  expect(index.get(10)).toEqual([squads[1], squads[2]]);
  expect(index.get(20)).toEqual([squads[3]]);
  owner.update(squads[1].id, { embarkedOn: null }); owner.update(squads[0].id, { embarkedOn: 20 });
  owner.remove(squads[2].id); squads = owner.values; index = cargoByShip(squads);
  expect(index.has(10)).toBe(false); expect(index.get(20)).toEqual([squads[0], squads[2]]);
  const restored = structuredClone(squads), fresh = cargoByShip(restored);
  expect(fresh.get(20)).toEqual(index.get(20));
  expect(fresh.get(20)![0]).toBe(restored[0]); expect(fresh.get(20)![0]).not.toBe(squads[0]);
});

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
