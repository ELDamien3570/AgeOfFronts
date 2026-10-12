import { describe, expect, it } from "vitest";
import { trenchFrontage } from "../../src/skirmish/domain/TrenchFrontage";
import { FIXED } from "../../src/skirmish/Protocol";
import { trenchLineScene } from "./fixtures/TrenchLine";
const advance = (g: ReturnType<typeof trenchLineScene>["game"], n: number) => {
  for (let i = 0; i < n; i++) g.step();
};
describe("Trench frontage and moving reforms", () => {
  it("snaps a drawn frontage to its connected trench and rejects disconnected endpoints", () => {
    const { game } = trenchLineScene(),
      snap = game.snapshot();
    const tiles = trenchFrontage(
      64,
      2,
      snap.buildings,
      snap.expansion!.barriers,
      { x: 28.5 * FIXED, y: 32.5 * FIXED },
      { x: 35.5 * FIXED, y: 32.5 * FIXED },
    )!;
    expect(tiles).toHaveLength(8);
    expect(tiles[0]).toBe(game.map.ref(28, 32));
    expect(tiles[tiles.length-1]).toBe(game.map.ref(35, 32));
    expect(
      trenchFrontage(
        64,
        2,
        snap.buildings,
        [],
        { x: 24.5 * FIXED, y: 32.5 * FIXED },
        { x: 41.5 * FIXED, y: 32.5 * FIXED },
      ),
    ).toBeUndefined();
  });
  it("single clicks claim a compact stretch around the click rather than a chunk origin", () => {
    const { game, defenders } = trenchLineScene(),
      t = game.expansion!.trenches;
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [defenders[0].id],
      tile: game.map.ref(32, 32),
    });
    const o = t.occupants.get(defenders[0].id)!,
      points = o.slots.map(
        (slot) => t.segments.get(slot.segment)!.anchors[slot.index],
      );
    expect(
      Math.abs(
        points.reduce((n, p) => n + p.x, 0) / points.length - 32.5 * FIXED,
      ),
    ).toBeLessThan(FIXED / 2);
    expect(
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    ).toBeLessThan(2 * FIXED);
  });
  it("drawn occupation retains squad order and stays inside the requested frontage", () => {
    const { game, defenders } = trenchLineScene(),
      t = game.expansion!.trenches,
      tiles = Array.from({ length: 8 }, (_, i) => game.map.ref(28 + i, 32));
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: defenders.map((s) => s.id).reverse(),
        tile: tiles[0],
        frontageTiles: tiles,
      }),
    ).toBeNull();
    const centers = defenders.map((s) => {
      const o = t.occupants.get(s.id)!;
      const anchors = o.slots.map((slot) => {
        const segment = t.segments.get(slot.segment)!;
        expect(tiles).toContain(segment.tiles[Math.floor(slot.index / 6)]);
        return segment.anchors[slot.index];
      });
      return anchors.reduce((n, p) => n + p.x, 0) / anchors.length;
    });
    expect(centers[0]).toBeLessThan(centers[1]);
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: [defenders[0].id],
        tile: tiles[0],
        frontageTiles: [tiles[0], tiles[3]],
      }),
    ).toMatch(/contiguous/);
  });
  it("begins spreading on approach, clears the reform, and starts leaving immediately", () => {
    const { game, defenders } = trenchLineScene(),
      id = defenders[0].id;
    game.updateSquad(id, { x: 30.5 * FIXED, y: 30.5 * FIXED });
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [id],
      tile: game.map.ref(30, 32),
    });
    advance(game, 2);
    expect(game.squad(id)!.formation?.transition?.occupationReform).toBe(true);
    expect(game.squad(id)!.formation?.occupationSlots).toBeDefined();
    advance(game, 100);
    expect(game.squad(id)!.occupancy?.phase).toBe("occupying");
    expect(game.squad(id)!.formation?.transition).toBeUndefined();
    const before = { x: game.squad(id)!.x, y: game.squad(id)!.y };
    game.applyCommand({
      type: "order",
      playerId: 2,
      squadIds: [id],
      order: { type: "move", tile: game.map.ref(30, 20) },
    });
    expect(game.expansion!.battle.cover(game.squad(id)!)).toBe(0);
    advance(game, 10);
    expect(
      Math.hypot(game.squad(id)!.x - before.x, game.squad(id)!.y - before.y),
    ).toBeGreaterThan(10);
  });
  it("preserves entering and leaving motion across save/restore", () => {
    const { game, defenders } = trenchLineScene(),
      id = defenders[0].id;
    game.updateSquad(id, { x: 30.5 * FIXED, y: 30.5 * FIXED });
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [id],
      tile: game.map.ref(30, 32),
    });
    advance(game, 8);
    const copy = trenchLineScene().game;
    copy.restore(game.checkpoint());
    advance(game, 80);
    advance(copy, 80);
    expect(copy.checkpoint()).toEqual(game.checkpoint());
    game.applyCommand({
      type: "order",
      playerId: 2,
      squadIds: [id],
      order: { type: "move", tile: game.map.ref(30, 20) },
    });
    advance(game, 2);
    copy.restore(game.checkpoint());
    advance(game, 15);
    advance(copy, 15);
    expect(copy.checkpoint()).toEqual(game.checkpoint());
  });
});
