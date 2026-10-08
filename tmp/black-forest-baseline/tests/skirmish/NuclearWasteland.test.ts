import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
function fixture() {
  const terrain = new Uint8Array(100 * 80).fill(133);
  const game = new Skirmish(new GameMapImpl(100, 80, terrain, terrain.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const state = game.checkpoint();
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 100; x++) state.owners[y * 100 + x] = x < 50 ? 1 : 2;
  game.restore(state);
  for (const player of game.players) player.reserves = 100000;
  return game;
}
describe("nuclear land damage", () => {
  it("unclaims both factions' land and charges each prior owner once per cell, with no repeat charge for already neutral cells", () => {
    const game = fixture(),
      before = game.players.map((p) => p.land);
    game.nuclearBlast(50.5 * FIXED, 40.5 * FIXED, 5 * FIXED);
    const cells = [...game.wasteland.tiles()];
    expect(cells.length).toBe(81);
    for (const player of game.players) {
      const lost = cells.filter(([, owner]) => owner === player.id).length;
      expect(player.reserves).toBe(100000 - lost * 100);
      expect(player.land).toBe(before[player.id - 1] - lost);
    }
    expect(cells.every(([tile]) => game.owners[tile] === 0)).toBe(true);
    const reserves = game.players.map((p) => p.reserves);
    game.nuclearBlast(50.5 * FIXED, 40.5 * FIXED, 5 * FIXED);
    expect(game.players.map((p) => p.reserves)).toEqual(reserves);
  });
  it("persists fallout through cold restore and canonical snapshot publication", () => {
    const game = fixture();
    game.nuclearBlast(50.5 * FIXED, 40.5 * FIXED, 5 * FIXED);
    const saved = game.checkpoint(),
      cold = fixture();
    cold.restore(saved);
    expect(cold.wasteland.checkpoint()).toEqual(game.wasteland.checkpoint());
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(cold.snapshot()),
    );
    expect(decoded.expansion!.fallout).toEqual(game.wasteland.snapshot());
  });
  it("charges the capturing squad once and removes fallout only through successful squad capture", () => {
    const game = fixture(),
      squad = game.squads.find((s) => s.playerId === 1)!;
    for (const s of [...game.squads])
      if (s.id !== squad.id) game.removeSquad(s.id);
    game.updateSquad(squad.id, {
      x: 30.5 * FIXED,
      y: 30.5 * FIXED,
      troops: 1000,
      order: { type: "hold" },
    });
    game.nuclearBlast(squad.x, squad.y, 2 * FIXED);
    const count = game.wasteland.size;
    expect(count).toBe(13);
    const capture = game as unknown as { capture(): void };
    for (let tick = 0; tick < 30; tick++) {
      game.tick++;
      capture.capture();
    }
    expect(game.wasteland.size).toBe(0);
    expect(game.squad(squad.id)!.troops).toBe(1000 - count * 10);
    for (let tick = 0; tick < 60; tick++) {
      game.tick++;
      capture.capture();
    }
    expect(game.squad(squad.id)!.troops).toBe(1000 - count * 10);
    expect(game.snapshot().expansion!.fallout).toHaveLength(0);
  });
  it("keeps contested fallout contaminated until one side can actually capture it", () => {
    const game = fixture(),
      one = game.squads.find((s) => s.playerId === 1)!,
      two = game.squads.find((s) => s.playerId === 2)!;
    for (const s of [one, two])
      game.updateSquad(s.id, {
        x: 50.5 * FIXED,
        y: 40.5 * FIXED,
        order: { type: "hold" },
      });
    game.nuclearBlast(one.x, one.y, 2 * FIXED);
    const capture = game as unknown as { capture(): void };
    for (let i = 0; i < 60; i++) capture.capture();
    expect(game.wasteland.size).toBe(13);
    expect(game.squad(one.id)!.troops).toBe(1000);
    expect(game.squad(two.id)!.troops).toBe(1000);
  });
  it("gives a quiet AI a stable cleanup order and releases it when an invasion starts", () => {
    const game = fixture(),
      player = game.players[1],
      template = game.squads.find((s) => s.playerId === player.id)!;
    game.options.aiEconomy = true;
    for (let i = 0; i < 5; i++)
      game.addSquad({
        ...structuredClone(template),
        id: game.allocateId(),
        x: 60.5 * FIXED,
        y: 40.5 * FIXED,
        troops: 1000,
        order: { type: "hold" },
      });
    game.nuclearBlast(70.5 * FIXED, 40.5 * FIXED, 3 * FIXED);
    const recovery = game.expansion!.economy.recovery;
    recovery.step();
    const cleanup = recovery.checkpoint().cleanup[0];
    expect(cleanup).toBeDefined();
    const squad = game.squad(cleanup[1].squadId)!;
    expect(squad.order).toMatchObject({ type: "move" });
    const previous = { ...squad.order };
    game.tick += 60;
    recovery.step();
    expect(game.squad(squad.id)!.order).toEqual(previous);
    const invasion = game.expansion!.economy.military.armyPlanner.invasion;
    const original = invasion.active.bind(invasion);
    invasion.active = (id) => id === player.id || original(id);
    game.tick += 60;
    recovery.step();
    expect(recovery.checkpoint().cleanup).toHaveLength(0);
    expect(
      game.expansion!.economy.assets.owns(
        `squad:${squad.id}`,
        `fallout:${player.id}`,
      ),
    ).toBe(false);
  });
});
