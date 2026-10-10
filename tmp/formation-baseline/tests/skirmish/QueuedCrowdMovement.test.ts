import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Order } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { squadRadius, traversable } from "../../src/skirmish/SquadGeometry";

function fixture(deferredPlanning = true, obstruction = false) {
  const terrain = new Uint8Array(48 * 48).fill(133);
  if (obstruction) for (let y = 0; y < 24; y++) terrain[y * 48 + 20] = 0;
  const game = new Skirmish(new GameMapImpl(48, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    deferredPlanning,
    formationLocomotion: true,
    formationReorientation: true,
    formationFreeTravel: true,
  });
  const squad = game.squads.find(
    (s) => s.playerId === 1 && s.kind === "infantry",
  )!;
  const enemy = game.squads.find((s) => s.playerId === 2)!;
  game.updateSquad(enemy.id, { x: 44.5 * FIXED, y: 44.5 * FIXED });
  for (const other of game.squads.slice())
    if (other.id !== squad.id && other.id !== enemy.id)
      game.removeSquad(other.id);
  game.updateSquad(squad.id, {
    x: 8.5 * FIXED,
    y: 12.5 * FIXED,
    locomotion: {
      heading: -Math.PI / 2,
      targetHeading: -Math.PI / 2,
      speed: 0,
    },
  });
  const order = (x: number, y: number): Order => ({
    type: "move",
    tile: game.map.ref(x, y),
    x: (x + 0.5) * FIXED,
    y: (y + 0.5) * FIXED,
  });
  const issue = (next: Order, append = false) =>
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [squad.id],
        order: next,
        append,
      }),
    ).toBeNull();
  return { game, squad, order, issue };
}

describe("continuous queued crowd movement", () => {
  for (const deferred of [false, true])
    it(`runs through straight and corner waypoints and stops exactly at the end (deferred=${deferred})`, () => {
      const { game, squad, order, issue } = fixture(deferred);
      issue(order(16, 12));
      // Let initial group admission settle before appending deliberate Shift legs.
      for (let i = 0; i < 8; i++) game.step();
      issue(order(24, 12), true);
      issue(order(24, 20), true);
      let handoffs = 0;
      const speeds: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const previousTile =
          squad.order.type === "move" ? squad.order.tile : -1;
        game.step();
        if (
          squad.order.type === "move" &&
          previousTile !== squad.order.tile &&
          previousTile !== -1
        ) {
          handoffs++;
          speeds.push(squad.locomotion!.speed);
          expect(squad.locomotion!.speed).toBeGreaterThan(5);
          for (let j = 0; j < 4; j++) {
            game.step();
            expect(squad.locomotion!.speed).toBeGreaterThan(3);
          }
        }
      }
      expect(handoffs).toBe(2);
      expect(speeds[0]).toBeGreaterThan(10);
      expect({ x: squad.x, y: squad.y }).toEqual({
        x: 24.5 * FIXED,
        y: 20.5 * FIXED,
      });
      expect(squad.order.type).toBe("hold");
      expect(squad.locomotion!.speed).toBe(0);
    });
  for (const mounted of [false, true])
    it(`does not orbit or return to crossed waypoints through repeated oblique turns (mounted=${mounted})`, () => {
      const { game, squad, order, issue } = fixture();
      game.updateSquad(squad.id, { kind: mounted ? "cavalry" : "infantry" });
      const points = [
        [14, 13],
        [16, 16],
        [19, 15],
        [21, 18],
        [24, 17],
        [26, 20],
      ];
      issue(order(...(points[0] as [number, number])));
      for (let i = 0; i < 8; i++) game.step();
      for (const point of points.slice(1))
        issue(order(...(point as [number, number])), true);
      let handoffs = 0;
      let awayTicks = 0;
      let maximumAwayTicks = 0;
      for (let i = 0; i < 1600; i++) {
        const previousOrder = squad.order;
        const before = { x: squad.x, y: squad.y };
        game.step();
        if (
          previousOrder.type === "move" &&
          squad.order.type === "move" &&
          previousOrder.tile !== squad.order.tile
        ) {
          handoffs++;
          awayTicks = 0;
        } else if (squad.order.type === "move") {
          const goal = {
            x: squad.order.x ?? ((squad.order.tile % 48) + 0.5) * FIXED,
            y:
              squad.order.y ??
              (Math.floor(squad.order.tile / 48) + 0.5) * FIXED,
          };
          const toward =
            (squad.x - before.x) * (goal.x - before.x) +
            (squad.y - before.y) * (goal.y - before.y);
          awayTicks = toward < -1 ? awayTicks + 1 : 0;
          maximumAwayTicks = Math.max(maximumAwayTicks, awayTicks);
        }
      }
      expect(handoffs).toBe(points.length - 1);
      expect(maximumAwayTicks).toBeLessThan(6);
      expect({ x: squad.x, y: squad.y }).toEqual({
        x: 26.5 * FIXED,
        y: 20.5 * FIXED,
      });
      expect(squad.order.type).toBe("hold");
    });
  it("reaches a reversal waypoint before braking into the return leg", () => {
    const { game, squad, order, issue } = fixture();
    issue(order(16, 12));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(10, 12), true);
    let handedOff = false;
    for (let i = 0; i < 800; i++) {
      const before = squad.order.type === "move" ? squad.order.tile : -1;
      game.step();
      if (
        squad.order.type === "move" &&
        before === game.map.ref(16, 12) &&
        squad.order.tile !== before
      ) {
        handedOff = true;
        expect({ x: squad.x, y: squad.y }).toEqual({
          x: 16.5 * FIXED,
          y: 12.5 * FIXED,
        });
        expect(squad.locomotion!.speed).toBeLessThanOrEqual(10);
      }
    }
    expect(handedOff).toBe(true);
    expect({ x: squad.x, y: squad.y }).toEqual({
      x: 10.5 * FIXED,
      y: 12.5 * FIXED,
    });
    expect(squad.order.type).toBe("hold");
  });
  it("checkpoints pending lookahead and retains deterministic handoffs", () => {
    const { game, squad, order, issue } = fixture();
    issue(order(16, 12));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(24, 12), true);
    game.step();
    expect(game.checkpoint().moveContinuations.size).toBe(1);
    const restored = fixture().game;
    restored.restore(game.checkpoint());
    for (let i = 0; i < 600; i++) {
      game.step();
      restored.step();
    }
    expect(restored.snapshot()).toEqual(game.snapshot());
    expect(squad.order.type).toBe("hold");
  });
  it("invalidates speculative legs when an order is replaced and when the squad is removed", () => {
    const { game, squad, order, issue } = fixture();
    issue(order(16, 12));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(24, 12), true);
    for (let i = 0; i < 4; i++) game.step();
    expect(game.checkpoint().moveContinuations.size).toBe(1);
    issue(order(12, 20));
    for (let i = 0; i < 600; i++) game.step();
    expect(squad.queuedOrders).toHaveLength(0);
    expect({ x: squad.x, y: squad.y }).toEqual({
      x: 12.5 * FIXED,
      y: 20.5 * FIXED,
    });
    expect(game.checkpoint().moveContinuations.size).toBe(0);
    issue(order(16, 20));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(24, 20), true);
    game.step();
    game.removeSquad(squad.id);
    expect(game.checkpoint().moveContinuations.size).toBe(0);
  });
  it("uses the admitted route around blocked terrain rather than cutting a queued corner", () => {
    const { game, squad, order, issue } = fixture(true, true);
    issue(order(16, 12));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(26, 12), true);
    for (let i = 0; i < 1800; i++) {
      const before = { x: squad.x, y: squad.y };
      game.step();
      expect(
        traversable(game.map, before, squad, squadRadius(squad.kind), false),
      ).toBe(true);
    }
    expect({ x: squad.x, y: squad.y }).toEqual({
      x: 26.5 * FIXED,
      y: 12.5 * FIXED,
    });
    expect(squad.order.type).toBe("hold");
  });
  it("retains deployment spacing and facing, with exact arrival at the final Shift destination", () => {
    const { game, squad, order, issue } = fixture();
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [squad.id],
        order: { type: "move", tile: 0 },
        deploymentLine: {
          start: { x: 15.5 * FIXED, y: 12.5 * FIXED },
          end: { x: 17.5 * FIXED, y: 12.5 * FIXED },
        },
      }),
    ).toBeNull();
    const facing = squad.order.type === "move" ? squad.order.facing : undefined;
    for (let i = 0; i < 8; i++) game.step();
    issue(order(24, 12), true);
    for (let i = 0; i < 600; i++) game.step();
    expect({ x: squad.x, y: squad.y }).toEqual({
      x: 24.5 * FIXED,
      y: 12.5 * FIXED,
    });
    expect(squad.order).toEqual({ type: "hold", facing });
    expect(squad.locomotion!.speed).toBe(0);
  });
  it("brakes at the waypoint if lookahead is unavailable, then safely plans the committed leg", () => {
    const { game, squad, order, issue } = fixture();
    const request = game.routePlanner.request.bind(game.routePlanner);
    vi.spyOn(game.routePlanner, "request").mockImplementation((job) => {
      if (
        job.context.kind === "navigation" &&
        job.context.operation === "continuation"
      )
        return false;
      return request(job);
    });
    issue(order(16, 12));
    for (let i = 0; i < 8; i++) game.step();
    issue(order(24, 12), true);
    let handedOff = false;
    for (let i = 0; i < 600; i++) {
      const before = squad.order.type === "move" ? squad.order.tile : -1;
      game.step();
      if (
        squad.order.type === "move" &&
        before === game.map.ref(16, 12) &&
        squad.order.tile !== before
      ) {
        handedOff = true;
        expect({ x: squad.x, y: squad.y }).toEqual({
          x: 16.5 * FIXED,
          y: 12.5 * FIXED,
        });
        expect(squad.locomotion!.speed).toBeLessThanOrEqual(10);
      }
    }
    expect(handedOff).toBe(true);
    expect({ x: squad.x, y: squad.y }).toEqual({
      x: 24.5 * FIXED,
      y: 12.5 * FIXED,
    });
  });
});
