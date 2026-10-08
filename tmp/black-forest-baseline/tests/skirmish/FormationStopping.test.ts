import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LocalAvoidance } from "../../src/skirmish/LocalAvoidance";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";

describe("formation stopping under friendly steering", () => {
  it.each([0, 100])("does not restore full-speed travel with %i stopping distance", stopDistance => {
    const data = new Uint8Array(20 * 20).fill(133);
    const map = new GameMapImpl(20, 20, data, data.length);
    const mover = { id: 1, playerId: 1, x: 10 * FIXED, y: 10 * FIXED,
      kind: "infantry", embarkedOn: null, order: { type: "move", tile: 210 } } as Squad;
    const neighbor = { ...mover, id: 2, x: mover.x - FIXED / 2, order: { type: "hold" } } as Squad;
    const grid = new SpatialGrid<Squad>(20 * FIXED, 20 * FIXED, 2 * FIXED, s => s.playerId);
    grid.rebuild([mover, neighbor]);
    let end = { x: mover.x, y: mover.y };
    new LocalAvoidance(map).step([mover, neighbor], [{ squad: mover,
      goal: { x: mover.x + stopDistance + 1, y: mover.y }, speed: 64, stopDistance }],
      grid, (id, changes) => { if (id === mover.id) end = changes; });
    expect(end.x - mover.x).toBe(1);
    expect(end.y).toBe(mover.y);
  });
});
