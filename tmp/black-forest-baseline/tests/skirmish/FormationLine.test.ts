import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  deploymentLine,
  type DeploymentLine,
} from "../../src/skirmish/FormationLine";
import { FIXED, type Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
const point = (x: number, y: number) => ({ x: x * FIXED, y: y * FIXED });
const draw: DeploymentLine = {
  start: point(10.5, 20.5),
  end: point(19.5, 20.5),
};
function fixture(deferredPlanning = false) {
  const terrain = new Uint8Array(48 * 48).fill(133);
  const map = new GameMapImpl(48, 48, terrain, terrain.length);
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    formationLocomotion: true,
    formationReorientation: true,
    deferredPlanning,
  });
  const squads = game.squads.filter((s) => s.playerId === 1).slice(0, 3);
  squads.forEach((s, i) =>
    game.updateSquad(s.id, {
      ...point(10.5 + i * 4.5, 10.5),
      order: { type: "hold" },
      path: [],
      queuedOrders: [],
    }),
  );
  for (const s of game.squads.filter((s) => s.playerId !== 1))
    game.updateSquad(s.id, point(35, 35));
  const issue = (line = draw, append = false): Command => ({
    type: "order",
    playerId: 1,
    squadIds: squads.map((s) => s.id),
    order: { type: "move", tile: 0 },
    deploymentLine: line,
    append,
  });
  return { game, squads, issue };
}
describe("drawn squad deployment lines", () => {
  it.each([false, true])(
    "retains a drawn layout across ordinary Shift moves and after arrival (deferred=%s)",
    (deferred) => {
      const { game, squads, issue } = fixture(deferred);
      expect(game.applyCommand(issue())).toBeNull();
      const destinations = [
        { x: 16, y: 25 },
        { x: 21, y: 29 },
      ];
      for (const destination of destinations)
        expect(
          game.applyCommand({
            type: "order",
            playerId: 1,
            squadIds: squads.map((s) => s.id),
            append: true,
            order: {
              type: "move",
              tile: game.map.ref(destination.x, destination.y),
            },
          }),
        ).toBeNull();
      for (let rank = 0; rank < destinations.length; rank++) {
        const orders = squads.map((s) => s.queuedOrders[rank]);
        expect(
          orders.every((o) => o.type === "move" && o.facing !== undefined),
        ).toBe(true);
        const points = orders.map((o) =>
          o.type === "move"
            ? {
                x: o.x ?? ((o.tile % 48) + 0.5) * FIXED,
                y: o.y ?? (Math.floor(o.tile / 48) + 0.5) * FIXED,
              }
            : { x: 0, y: 0 },
        );
        expect(points.map((p) => p.x - points[0].x)).toEqual([
          0,
          4.5 * FIXED,
          9 * FIXED,
        ]);
        expect(new Set(points.map((p) => p.y)).size).toBe(1);
      }
      for (let i = 0; i < 800; i++) game.step();
      expect(squads.map((s) => s.x - squads[0].x)).toEqual([
        0,
        4.5 * FIXED,
        9 * FIXED,
      ]);
      expect(
        squads.every(
          (s) => s.order.type === "hold" && s.order.facing !== undefined,
        ),
      ).toBe(true);
      expect(
        game.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: squads.map((s) => s.id),
          append: true,
          order: { type: "move", tile: game.map.ref(18, 25) },
        }),
      ).toBeNull();
      for (let i = 0; i < 400; i++) game.step();
      expect(squads.map((s) => s.x - squads[0].x)).toEqual([
        0,
        4.5 * FIXED,
        9 * FIXED,
      ]);
      expect(squads.every((s) => s.y === 25.5 * FIXED)).toBe(true);
    },
  );
  it("keeps projection order, expands cramped frontages, and reverses facing with the drag", () => {
    const members = [
      { id: 2, origin: point(5, 5) },
      { id: 1, origin: point(1, 5) },
      { id: 3, origin: point(9, 5) },
    ];
    const line = deploymentLine(members, {
      start: point(10, 20),
      end: point(11, 20),
    })!;
    expect([...line.slots.keys()]).toEqual([1, 2, 3]);
    expect(line.end.x - line.start.x).toBe(5.5 * FIXED);
    const reverse = deploymentLine([...members].reverse(), {
      start: point(11, 20),
      end: point(10, 20),
    })!;
    expect(Math.abs(Math.cos(line.facing - reverse.facing) + 1)).toBeLessThan(
      1e-10,
    );
    expect([...line.slots.entries()].sort()).toEqual(
      [...reverse.slots.entries()].sort(),
    );
  });
  it.each([false, true])(
    "moves to exact slots and holds the requested facing (deferred=%s)",
    (deferred) => {
      const { game, squads, issue } = fixture(deferred);
      expect(squads).toHaveLength(3);
      const expected = deploymentLine(
        squads.map((s) => ({ id: s.id, origin: s })),
        draw,
      )!;
      expect(game.applyCommand(issue())).toBeNull();
      for (const squad of squads)
        expect(squad.order).toMatchObject({
          type: "move",
          facing: expected.facing,
        });
      for (let i = 0; i < 500; i++) game.step();
      for (const squad of squads) {
        expect({ x: squad.x, y: squad.y }).toEqual(
          expected.slots.get(squad.id),
        );
        expect(squad.order).toEqual({ type: "hold", facing: expected.facing });
        expect(
          Math.abs(
            Math.atan2(
              Math.sin(squad.locomotion!.targetHeading - expected.facing),
              Math.cos(squad.locomotion!.targetHeading - expected.facing),
            ),
          ),
        ).toBeLessThan(1e-9);
      }
    },
  );
  it("queues separate line destinations and transports their facing through full/delta snapshots and restore", () => {
    const { game, squads, issue } = fixture();
    expect(game.applyCommand(issue())).toBeNull();
    const queued = { start: point(19.25, 26.25), end: point(10.75, 26.75) };
    expect(game.applyCommand(issue(queued, true))).toBeNull();
    expect(squads.every((s) => s.queuedOrders.length === 1)).toBe(true);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const decode = () =>
      decoder.decode(
        encoder.encode(
          game.replicationSource(),
          game.tileChanges,
          game.replicationFacts(),
        ),
      );
    const first = decode();
    expect(
      first.squads
        .filter((s) => squads.some((selected) => selected.id === s.id))
        .map((s) => [s.order, s.queuedOrders]),
    ).toEqual(squads.map((s) => [s.order, s.queuedOrders]));
    const restored = new Skirmish(game.map, game.options);
    restored.restore(game.checkpoint());
    for (let i = 0; i < 600; i++) {
      game.step();
      restored.step();
    }
    expect(restored.snapshot()).toEqual(game.snapshot());
    expect(
      decode()
        .squads.filter((s) => squads.some((selected) => selected.id === s.id))
        .map((s) => s.order),
    ).toEqual(squads.map((s) => s.order));
  });
  it("rejects invalid geometry, foreign selection and blocked slots without partially applying", () => {
    const { game, squads, issue } = fixture();
    const before = squads.map((s) => s.order);
    expect(
      game.applyCommand(issue({ start: point(-1, 20), end: point(8, 20) })),
    ).not.toBeNull();
    expect(squads.map((s) => s.order)).toEqual(before);
    expect(game.applyCommand({ ...issue(), playerId: 2 })).not.toBeNull();
    expect(
      game.applyCommand(issue({ start: point(12, 12), end: point(12, 12) })),
    ).not.toBeNull();
    expect(
      game.applyCommand(issue({ start: { x: NaN, y: 0 }, end: point(8, 20) })),
    ).not.toBeNull();
    const enemy = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(enemy.id, point(19.5, 20.5));
    expect(game.applyCommand(issue())).toContain("blocked");
    expect(squads.map((s) => s.order)).toEqual(before);
    expect(commandSchema.safeParse(issue()).success).toBe(true);
    expect(
      commandSchema.safeParse(
        issue({ start: { x: Infinity, y: 0 }, end: point(8, 20) }),
      ).success,
    ).toBe(false);
    expect(squads.map((s) => s.order)).toEqual(before);
  });
});
