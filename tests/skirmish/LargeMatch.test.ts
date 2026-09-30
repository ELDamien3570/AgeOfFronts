import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, MAX_FACTIONS, MAX_SQUADS } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
import { COLORS } from "../../src/skirmish/client/Renderer";

describe("large match domain", () => {
  it.each(["world", "thebox"])(
    "deploys twenty factions on the current %s map",
    (id) => {
      const manifest = JSON.parse(
        fs.readFileSync(`resources/maps/${id}/manifest.json`, "utf8"),
      );
      const source = fs.readFileSync(`resources/maps/${id}/map16x.bin`),
        m = manifest.map16x;
      const stride = Math.ceil(Math.max(m.width, m.height) / 256);
      const width = Math.ceil(m.width / stride),
        height = Math.ceil(m.height / stride);
      const terrain = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          terrain[y * width + x] =
            source[
              Math.min(m.height - 1, y * stride + Math.floor(stride / 2)) *
                m.width +
                Math.min(m.width - 1, x * stride + Math.floor(stride / 2))
            ];
      const match = new Skirmish(new GameMapImpl(width, height, terrain, 0), {
        seed: 42,
        aiCount: MAX_FACTIONS - 1,
      });
      expect(match.players).toHaveLength(20);
      expect(new Set(match.players.map((p) => p.name)).size).toBe(20);
      expect(new Set(match.players.map((p) => COLORS[p.id])).size).toBe(20);
      expect(match.squads).toHaveLength(80);
      for (let i = 0; i < 100; i++) match.step();
      expect(
        match.players.every((p) => Number.isFinite(p.gold) && p.land >= 0),
      ).toBe(true);
      const accounted =
        match.players.reduce((sum, p) => sum + p.reserves + p.losses, 0) +
        match.squads.reduce((sum, s) => sum + s.troops, 0);
      expect(accounted).toBe(20 * 12000 + match.producedTroops);
    },
  );

  it("counts embarked squads toward the 200-unit cap and admits the next recruit when space opens", () => {
    const data = new Uint8Array(100 * 100).fill(133);
    const match = new Skirmish(new GameMapImpl(100, 100, data, data.length), {
      seed: 42,
      aiCount: 1,
      runAi: false,
    });
    const template = match.squads.find((s) => s.playerId === 1)!;
    match.squads.length = 0;
    for (let i = 0; i < MAX_SQUADS; i++)
      match.squads.push({
        ...template,
        id: 10000 + i,
        x: (20 + (i % 20) * 2) * FIXED,
        y: (60 + Math.floor(i / 20) * 2) * FIXED,
        embarkedOn: i < 4 ? 999 : null,
        path: [],
        queuedOrders: [],
      });
    match.players[0].reserves = 20000;
    const building = match.buildings.find((b) => b.playerId === 1)!;
    expect(
      match.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: building.id,
      }),
    ).toMatch(/limit/);
    match.squads.pop();
    expect(
      match.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: building.id,
      }),
    ).toBeNull();
    expect(match.squads).toHaveLength(200);
  });

  it("rejects a faction count beyond the configured maximum", () => {
    const data = new Uint8Array(100 * 100).fill(133);
    expect(
      () =>
        new Skirmish(new GameMapImpl(100, 100, data, data.length), {
          seed: 42,
          aiCount: 20,
        }),
    ).toThrow(/19/);
  });
});

describe("spatial nearest queries and reservation lifecycle", () => {
  it("matches brute force across cells and removes released reservations", () => {
    const grid = new SpatialGrid<{ x: number; y: number; faction: number }>(
      100,
      80,
      4,
    );
    const items = Array.from({ length: 150 }, (_, i) => ({
      x: ((i * 37) % 100) + 0.2,
      y: ((i * 23) % 80) + 0.1,
      faction: i % 3,
    }));
    grid.rebuild(items);
    for (let x = 1; x < 100; x += 11)
      for (let y = 1; y < 80; y += 13) {
        const expected = items
          .filter((p) => p.faction !== 1)
          .sort(
            (a, b) =>
              (a.x - x) ** 2 +
              (a.y - y) ** 2 -
              ((b.x - x) ** 2 + (b.y - y) ** 2),
          )[0];
        expect(grid.nearest(x, y, (p) => p.faction !== 1)).toBe(expected);
      }
    const point = items[0];
    grid.remove(point);
    expect(grid.nearest(point.x, point.y, (p) => p === point)).toBeUndefined();
    grid.insert(point);
    expect(grid.nearest(point.x, point.y, (p) => p === point)).toBe(point);
    grid.rebuild([]);
    expect(grid.nearest(1, 1, () => true)).toBeUndefined();
  });
});
