import { describe, expect, it } from "vitest";
import { FIXED } from "../../src/skirmish/Protocol";
import { trenchLineScene } from "./fixtures/TrenchLine";
const ticks = (game: ReturnType<typeof trenchLineScene>["game"], n: number) => {
  for (let i = 0; i < n; i++) game.step();
};
describe("Trench occupation", () => {
  it("derives bounded contiguous segments with distinct soldier anchors", () => {
    const { game } = trenchLineScene(),
      t = game.expansion!.trenches;
    t.rebuild();
    expect(t.segments.size).toBe(6);
    for (const s of [...t.segments.values()].filter((s) =>
      s.key.startsWith("r:"),
    )) {
      expect(s.capacity).toBe(24);
      expect(s.tiles).toHaveLength(4);
      expect(s.anchors).toHaveLength(24);
      expect(new Set(s.anchors.map((p) => `${p.x},${p.y}`)).size).toBe(24);
      expect(s.neighbours.length).toBeGreaterThan(0);
    }
  });
  it("never grants proximity or entering cover, and grants only front-side cover after arrival", () => {
    const { game, defenders } = trenchLineScene(),
      e = game.expansion!,
      s = defenders[0],
      tile = game.map.ref(30, 32);
    game.updateSquad(s.id, { x: 30.5 * FIXED, y: 32.5 * FIXED });
    expect(e.battle.cover(s)).toBe(0);
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: [s.id],
        tile,
      }),
    ).toBeNull();
    expect(e.trenches.occupants.get(s.id)?.phase).toBe("entering");
    expect(e.battle.cover(s)).toBe(0);
    ticks(game, 80);
    const live = game.squad(s.id)!;
    expect(e.trenches.occupants.get(s.id)?.phase).toBe("occupying");
    expect(e.battle.cover(live, { x: live.x, y: live.y + 10 * FIXED })).toBe(
      2000,
    );
    expect(e.battle.cover(live, { x: live.x, y: live.y - 10 * FIXED })).toBe(0);
    expect(live.formation?.occupationSlots).toHaveLength(
      live.manpower!.capacity,
    );
  });
  it("reserves purchased capacity, unique slots and contiguous segments despite casualties", () => {
    const { game, defenders } = trenchLineScene(),
      e = game.expansion!,
      tile = game.map.ref(30, 32);
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: defenders.map((s) => s.id),
      tile,
    });
    const records = [...e.trenches.occupants.values()];
    const slots = records.flatMap((o) =>
      o.slots.map((s) => `${s.segment}/${s.index}`),
    );
    expect(new Set(slots).size).toBe(slots.length);
    const s = defenders[0],
      capacity = s.manpower!.capacity;
    game.updateSquad(s.id, { troops: 1 });
    e.trenches.step();
    expect(e.trenches.occupants.get(s.id)!.reservedCapacity).toBe(capacity);
    expect(e.trenches.reserveChanges([{ id: s.id, capacity: 40 }])).toBe(true);
    expect(e.trenches.occupants.get(s.id)!.segments.length).toBeGreaterThan(1);
  });
  it("reserves enlargement atomically or leaves every reservation unchanged", () => {
    const { game, defenders } = trenchLineScene(),
      t = game.expansion!.trenches;
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: defenders.map((s) => s.id),
      tile: game.map.ref(30, 32),
    });
    const before = t.checkpoint();
    expect(
      t.reserveChanges([
        { id: defenders[0].id, capacity: 72 },
        { id: defenders[1].id, capacity: 72 },
      ]),
    ).toBe(false);
    expect(t.checkpoint()).toEqual(before);
  });
  it("rejects allies, mounted actors, queued occupation and insufficient space", () => {
    const { game, defenders, riders, add } = trenchLineScene(),
      tile = game.map.ref(30, 32);
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 1,
        squadIds: [riders[0].id],
        tile,
      }),
    ).toMatch(/owned trench/);
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: [defenders[0].id],
        tile,
        append: true,
      }),
    ).toMatch(/Queued/);
    const mounted = add("latemedieval-cavalry", 2, 29, 28);
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: [mounted.id],
        tile,
      }),
    ).toMatch(/foot soldiers/);
    game.updateSquad(defenders[0].id, {
      manpower: { ...defenders[0].manpower!, capacity: 144 },
    });
    expect(
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: [defenders[0].id],
        tile,
      }),
    ).toBe("Not enough trench space");
  });
  it("holds preserve cover, move orders disable cover immediately and release on exit", () => {
    const { game, defenders } = trenchLineScene(),
      e = game.expansion!,
      s = defenders[0];
    game.updateSquad(s.id, { x: 30.5 * FIXED, y: 32.5 * FIXED });
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [s.id],
      tile: game.map.ref(30, 32),
    });
    ticks(game, 80);
    game.applyCommand({
      type: "order",
      playerId: 2,
      squadIds: [s.id],
      order: { type: "hold" },
    });
    expect(e.battle.cover(game.squad(s.id)!)).toBe(2000);
    expect(
      game.applyCommand({
        type: "order",
        playerId: 2,
        squadIds: [s.id],
        order: { type: "move", tile: game.map.ref(30, 20) },
      }),
    ).toBeNull();
    expect(e.battle.cover(game.squad(s.id)!)).toBe(0);
    ticks(game, 200);
    expect(e.trenches.occupants.has(s.id)).toBe(false);
  });
  it("evicts destroyed trenches and releases dead or embarked occupants", () => {
    const { game, defenders } = trenchLineScene(),
      e = game.expansion!,
      s = defenders[0];
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [s.id],
      tile: game.map.ref(30, 32),
    });
    e.fortifications.updateBarrier(e.fortifications.barriers[0].id, {
      health: 0,
    });
    e.trenches.step();
    expect(e.trenches.occupants.size).toBe(0);
    expect(game.squad(s.id)!.order.type).toBe("hold");
    expect(e.battle.cover(s)).toBe(0);
  });
  it.each([1, 50, 160])(
    "restores reservations, actor anchors and continuation at tick %i",
    (n) => {
      const { game, defenders } = trenchLineScene();
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: defenders.map((s) => s.id),
        tile: game.map.ref(30, 32),
      });
      ticks(game, n);
      const restored = trenchLineScene().game;
      restored.restore(game.checkpoint());
      expect(restored.checkpoint()).toEqual(game.checkpoint());
      ticks(game, 15);
      ticks(restored, 15);
      expect(restored.checkpoint()).toEqual(game.checkpoint());
    },
  );
});
