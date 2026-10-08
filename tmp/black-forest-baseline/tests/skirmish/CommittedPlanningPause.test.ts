import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { MatchRouteTask } from "../../src/skirmish/domain/RouteTask";
import type {
  ExactRouteRequest,
  RoutePlannerPorts,
} from "../../src/skirmish/RoutePlanner";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

type Task = Extract<
  MatchRouteTask,
  { kind: "navigation" | "admission" | "ship-admission" }
>;
describe("committed route capacity pause", () => {
  it("preserves later land orders, restores the pause, publishes status and clears it on replacement", () => {
    const map = new GameMapImpl(100, 70, new Uint8Array(7000).fill(133), 7000);
    const match = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      runAi: false,
      deferredPlanning: true,
    });
    const squad = match.squads.find((s) => s.playerId === 1)!;
    const first = map.ref(45, 35),
      later = map.ref(48, 35);
    match.updateSquad(squad.id, { queuedOrders: [
      { type: "move", tile: first },
      { type: "move", tile: later },
    ] });
    (match as unknown as { finishOrder(s: typeof squad): void }).finishOrder(
      squad,
    );
    const planner = match.routePlanner as unknown as {
      ports: RoutePlannerPorts<Task>;
    };
    const request: ExactRouteRequest<Task> = {
      key: `navigation:${squad.id}`,
      start: map.ref(Math.floor(squad.x / 256), Math.floor(squad.y / 256)),
      goal: first,
      water: false,
      createdTick: 0,
      obstacleRevision: "test",
      context: {
        kind: "navigation",
        squadId: squad.id,
        operation: "blocked",
        revision: 0,
      },
    };
    for (const tick of [10, 40, 100]) {
      match.tick = tick;
      planner.ports.completed(request, "limited", []);
    }
    expect(squad.planningPaused).toBe(true);
    expect(squad.queuedOrders).toEqual([{ type: "move", tile: later }]);
    const saved = match.checkpoint(),
      restored = new Skirmish(map, match.options);
    restored.restore(saved);
    const paused = restored.squad(squad.id)!;
    const requests = vi.spyOn(restored.routePlanner, "request");
    restored.tick = 1000;
    (
      restored as unknown as { navigation(s: typeof squad): unknown }
    ).navigation(paused);
    expect(requests).not.toHaveBeenCalled();
    const encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    expect(
      decoder
        .decode(encoder.encode(restored.snapshot()))
        .squads.find((s) => s.id === squad.id)?.planningPaused,
    ).toBe(true);
    (
      restored as unknown as {
        activateOrder(s: typeof squad, order: { type: "hold" }): void;
      }
    ).activateOrder(paused, { type: "hold" });
    expect(paused.planningPaused).toBeUndefined();
    expect(
      decoder
        .decode(encoder.encode(restored.snapshot()))
        .squads.find((s) => s.id === squad.id)?.planningPaused,
    ).toBeUndefined();
  });
});
