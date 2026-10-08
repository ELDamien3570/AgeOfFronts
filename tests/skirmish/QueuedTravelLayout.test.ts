import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
function fixture(count = 3) {
  const terrain = new Uint8Array(100 * 100).fill(133);
  const game = new Skirmish(
    new GameMapImpl(100, 100, terrain, terrain.length),
    {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
      deferredPlanning: true,
      formationLocomotion: true,
      formationReorientation: true,
      formationFreeTravel: true,
    },
  );
  const template = game.squads.find((s) => s.playerId === 1)!;
  const enemy = game.squads.find((s) => s.playerId === 2)!;
  for (const s of game.squads.slice())
    if (s.id !== enemy.id) game.removeSquad(s.id);
  game.updateSquad(enemy.id, { x: 90 * FIXED, y: 90 * FIXED });
  const squads: Squad[] = [];
  for (let i = 0; i < count; i++)
    squads.push(
      game.addSquad({
        ...template,
        id: game.allocateId(),
        kind: "infantry",
        x: (10.5 + (i % 10) * 2) * FIXED,
        y: (10.5 + Math.floor(i / 10) * 2) * FIXED,
        order: { type: "hold" },
        path: [],
        queuedOrders: [],
        charge: null,
      }),
    );
  const issue = (x: number, y: number, append = false) =>
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: squads.map((s) => s.id),
        order: { type: "move", tile: game.map.ref(x, y) },
        append,
      }),
    ).toBeNull();
  return { game, squads, issue };
}
const offsets = (points: { x: number; y: number }[]) =>
  points.map((p) => [p.x - points[0].x, p.y - points[0].y]);
describe("persistent queued squad placement", () => {
  for (const pending of [true, false])
    it(`keeps ID-owned offsets through ordinary Shift corners (pending=${pending})`, () => {
      const { game, squads, issue } = fixture();
      issue(50, 50);
      if (!pending) for (let i = 0; i < 12; i++) game.step();
      issue(65, 40, true);
      issue(60, 65, true);
      for (let i = 0; i < 80; i++) game.step();
      const positions = squads.map((s) => {
        expect(s.order.type).toBe("move");
        expect(s.queuedOrders).toHaveLength(2);
        if (s.order.type !== "move") throw new Error("missing move");
        return {
          x: s.order.x ?? ((s.order.tile % 100) + 0.5) * FIXED,
          y: s.order.y ?? (Math.floor(s.order.tile / 100) + 0.5) * FIXED,
        };
      });
      for (let leg = 0; leg < 2; leg++) {
        const queued = squads.map((s) => {
          const o = s.queuedOrders[leg];
          if (o.type !== "move") throw new Error("missing queued move");
          return {
            x: o.x ?? ((o.tile % 100) + 0.5) * FIXED,
            y: o.y ?? (Math.floor(o.tile / 100) + 0.5) * FIXED,
          };
        });
        expect(offsets(queued)).toEqual(offsets(positions));
      }
      const restored = fixture().game;
      restored.restore(game.checkpoint());
      for (let i = 0; i < 30; i++) {
        game.step();
        restored.step();
      }
      expect(restored.snapshot()).toEqual(game.snapshot());
    });
  it("keeps one shared layout across a 61-squad pending selection and restores during capture", () => {
    const { game, squads, issue } = fixture(61);
    issue(60, 50);
    issue(75, 65, true);
    for (let i = 0; i < 25; i++) game.step();
    const restored = fixture(61).game;
    restored.restore(game.checkpoint());
    let checked = false;
    for (let i = 0; i < 500; i++) {
      game.step();
      restored.step();
      const saved = game.checkpoint();
      const members = saved.admission.pending.flatMap(([, a]) => a.members);
      const points = squads.map((s) => {
        const m = members.find((m) => m.id === s.id);
        const q = m?.queued[0] ?? s.queuedOrders[0];
        const first =
          m?.destination ??
          (s.order.type === "move"
            ? {
                x: s.order.x ?? ((s.order.tile % 100) + 0.5) * FIXED,
                y: s.order.y ?? (Math.floor(s.order.tile / 100) + 0.5) * FIXED,
              }
            : undefined);
        return q?.type === "move" && first
          ? {
              first,
              next: {
                x: q.x ?? ((q.tile % 100) + 0.5) * FIXED,
                y: q.y ?? (Math.floor(q.tile / 100) + 0.5) * FIXED,
              },
            }
          : undefined;
      });
      if (points.every((p) => p)) {
        expect(offsets(points.map((p) => p!.next))).toEqual(
          offsets(points.map((p) => p!.first)),
        );
        checked = true;
        break;
      }
    }
    expect(checked).toBe(true);
    expect(restored.snapshot()).toEqual(game.snapshot());
  });
});
