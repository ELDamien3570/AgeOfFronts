import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CrowdRecovery } from "../../src/skirmish/CrowdRecovery";
import { LocalAvoidance } from "../../src/skirmish/LocalAvoidance";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
import {
  squadRadius,
  squadSeparation,
  standable,
  traversable,
} from "../../src/skirmish/SquadGeometry";
function scenario(
  offsets = [
    [0, 0],
    [105, -55],
    [29, -145],
    [-76, -91],
  ],
) {
  const data = new Uint8Array(60 * 40).fill(133),
    map = new GameMapImpl(60, 40, data, data.length);
  let squads = offsets.map(
    ([x, y], i) =>
      ({
        id: i + 1,
        playerId: 1,
        x: 15 * FIXED + x,
        y: 15 * FIXED + y,
        troops: 1000,
        kind: "infantry",
        embarkedOn: null,
        lastCombatTick: 0,
        moved: false,
        firingCharge: 0,
        order: { type: "move", tile: 15 * 60 + 35 },
        queuedOrders: [{ type: "move", tile: 20 * 60 + 35 }],
        path: [],
        nextPathIndex: 0,
        plannedTile: -1,
        lastPlanTick: 0,
        fighting: false,
        combatTargetId: null,
      }) as Squad,
  );
  const grid = new SpatialGrid<Squad>(60 * FIXED, 40 * FIXED, 4 * FIXED),
    solver = new LocalAvoidance(map);
  const goals = new Map(
    squads.map((s, i) => [
      s.id,
      { x: (35 + i * 1.5) * FIXED, y: 15 * FIXED + i * 2 * FIXED },
    ]),
  );
  const recorded = [
    [991, -920],
    [223, -152],
    [479, -152],
    [1503, -920],
  ];
  if (offsets.length === 4)
    for (let i = 0; i < 4; i++)
      goals.set(i + 1, {
        x: 15 * FIXED + recorded[i][0],
        y: 15 * FIXED + recorded[i][1],
      });
  solver.restore({
    previous: new Map(squads.map((s) => [s.id, { x: 0, y: 0 }])),
    recovery: { waiting: new Map(), leases: [] },
  });
  return {
    map,
    solver,
    goals,
    grid,
    get squads() {
      return squads;
    },
    step(
      tick: number,
      reverse = false,
      restriction?: (s: Squad, end: { x: number; y: number }) => boolean,
    ) {
      const ordered = [...squads].sort((a, b) => a.id - b.id);
      grid.rebuild(ordered);
      const intents = ordered
        .filter((s) => s.order.type === "move")
        .map((s) => ({
          squad: s,
          goal: goals.get(s.id)!,
          speed: 40,
          revision: 0,
        }));
      if (reverse) intents.reverse();
      const before = new Map(ordered.map((s) => [s.id, s]));
      solver.step(
        reverse ? [...ordered].reverse() : ordered,
        intents,
        grid,
        (id, changes) => {
          squads = squads.map((s) => (s.id === id ? { ...s, ...changes } : s));
        },
        tick,
        restriction,
      );
      for (const s of squads) {
        expect(standable(map, s, squadRadius(s.kind))).toBe(true);
        expect(
          traversable(map, before.get(s.id)!, s, squadRadius(s.kind)),
        ).toBe(true);
        for (const other of squads)
          if (s.id < other.id) {
            // Check the entire simultaneous trajectory, including fractional times.
            const a = before.get(s.id)!,
              b = before.get(other.id)!,
              dx = a.x - b.x,
              dy = a.y - b.y;
            const vx = s.x - a.x - (other.x - b.x),
              vy = s.y - a.y - (other.y - b.y),
              v2 = vx * vx + vy * vy;
            const t = v2
              ? Math.max(0, Math.min(1, -(dx * vx + dy * vy) / v2))
              : 0;
            expect(
              (dx + vx * t) ** 2 + (dy + vy * t) ** 2,
            ).toBeGreaterThanOrEqual(squadSeparation(s, other) ** 2);
          }
      }
    },
    change(id: number, changes: Partial<Squad>) {
      squads = squads.map((s) => (s.id === id ? { ...s, ...changes } : s));
    },
  };
}
describe("cooperative crowd recovery", () => {
  it("passes a compact four-way cluster with sustained progress and preserved queues", () => {
    const f = scenario(),
      initial = f.squads.map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        queue: s.queuedOrders,
      }));
    let sawYield = false;
    for (let tick = 1; tick <= 160; tick++) {
      f.step(tick);
      sawYield ||= f.squads.some(
        (s) => s.movementStatus?.reason === "yielding",
      );
    }
    // The reduced friendly footprint opens this former jam without a lease.
    expect(sawYield).toBe(false);
    for (const p of initial) {
      const s = f.squads.find((s) => s.id === p.id)!;
      expect(
        Math.hypot(s.x - f.goals.get(s.id)!.x, s.y - f.goals.get(s.id)!.y),
      ).toBeLessThan(64);
      expect(s.queuedOrders).toEqual(p.queue);
    }
  });
  it("passes through a held friendly position without moving its owner", () => {
    const f = scenario([
        [0, 0],
        [164, 0],
      ]),
      held = f.squads[1];
    f.change(held.id, { order: { type: "hold" } });
    f.goals.set(1, { x: held.x, y: held.y });
    for (let tick = 1; tick <= 100; tick++) f.step(tick);
    expect(f.squads[1]).toMatchObject({
      x: held.x,
      y: held.y,
      order: { type: "hold" },
    });
    expect(Math.hypot(f.squads[0].x - held.x, f.squads[0].y - held.y)).toBeLessThan(4);
    expect(f.squads[0].movementStatus).toBeUndefined();
  });
  it("does not recruit enemy or held blockers into a friendly yield lease", () => {
    const f = scenario([
      [0, 0],
      [232, 0],
    ]);
    f.change(2, { playerId: 2 });
    f.goals.set(1, { x: f.squads[1].x, y: f.squads[1].y });
    f.goals.set(2, { x: f.squads[0].x, y: f.squads[0].y });
    for (let tick = 1; tick <= 60; tick++) f.step(tick);
    expect(f.solver.checkpoint().recovery.leases).toHaveLength(0);
  });
  it("retires legacy friendly yield leases and remains deterministic across reversed storage", () => {
    const a = scenario(),
      b = scenario();
    const recovery = new CrowdRecovery(), intents = new Map(a.squads.map(s =>
      [s.id, { squad: s, goal: a.goals.get(s.id)!, speed: 40, revision: 0 }])),
      stalled = new Set(a.squads.map(s => s.id));
    a.grid.rebuild(a.squads);
    recovery.frame(-20, intents, a.grid, stalled, () => true);
    recovery.frame(0, intents, a.grid, stalled, () => true);
    const seeded = { previous: new Map(a.squads.map(s => [s.id, {x:0,y:0}])), recovery: recovery.checkpoint() };
    a.solver.restore(seeded); b.solver.restore(seeded);
    for (let tick = 1; tick <= 24; tick++) {
      a.step(tick);
      b.step(tick, true);
    }
    expect(a.solver.checkpoint().recovery.leases).toHaveLength(0);
    b.solver.restore(a.solver.checkpoint());
    for (let tick = 25; tick <= 130; tick++) {
      a.step(tick);
      b.step(tick, true);
    }
    expect(b.squads).toEqual(a.squads);
    expect(b.solver.checkpoint()).toEqual(a.solver.checkpoint());
  });
  it("checks restrictions during yield selection and stops an explicit Hold immediately", () => {
    const f = scenario(),
      line = 15 * FIXED;
    for (let tick = 1; tick <= 26; tick++)
      f.step(tick, false, (s, p) => p.y <= line);
    expect(f.squads.every((s) => s.y <= line)).toBe(true);
    const held = f.squads[0];
    f.change(held.id, { order: { type: "hold" } });
    for (let tick = 27; tick <= 100; tick++)
      f.step(tick, false, (s, p) => p.y <= line);
    expect(f.squads[0]).toMatchObject({
      x: held.x,
      y: held.y,
      moved: false,
    });
    expect(f.squads[0].movementStatus).toBeUndefined();
    expect(
      f.solver
        .checkpoint()
        .recovery.leases.every((l) => l.members.every((m) => m.id !== held.id)),
    ).toBe(true);
  });
  it("rotates right of way by waiting age and caps coordinated work", () => {
    const f = scenario(),
      recovery = new CrowdRecovery(),
      intents = new Map(
        f.squads.map((s) => [
          s.id,
          { squad: s, goal: f.goals.get(s.id)!, speed: 40, revision: 0 },
        ]),
      );
    f.grid.rebuild(f.squads);
    const stalled = new Set(f.squads.map((s) => s.id));
    recovery.frame(0, intents, f.grid, stalled, () => true);
    const first = recovery.frame(20, intents, f.grid, stalled, () => true)
      .leases[0];
    const second = recovery.frame(80, intents, f.grid, stalled, () => true)
      .leases[0];
    expect(second.leader).not.toBe(first.leader);
    expect(second.members.length).toBeLessThanOrEqual(8);
    expect(recovery.checkpoint().leases.length).toBeLessThanOrEqual(8);
  });
  it("replicates blocker IDs, waiting start, yield and status removal through sparse packets", () => {
    const data = new Uint8Array(60 * 40).fill(133),
      world = new Skirmish(new GameMapImpl(60, 40, data, data.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
      });
    const squad = world.squads[0],
      encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const packet = () =>
      encoder.encode(
        world.replicationSource(),
        world.tileChanges,
        world.replicationFacts(),
      );
    world.updateSquad(squad.id, {
      movementStatus: { reason: "crowd", since: 10, blockerIds: [2, 3] },
    });
    expect(
      decoder.decode(packet()).squads.find((s) => s.id === squad.id)
        ?.movementStatus,
    ).toEqual(squad.movementStatus);
    world.updateSquad(squad.id, {
      movementStatus: { reason: "yielding", since: 30, blockerIds: [] },
    });
    const next = packet();
    expect(next.entityMode).toBe("delta");
    expect(
      decoder.decode(next).squads.find((s) => s.id === squad.id)?.movementStatus
        ?.reason,
    ).toBe("yielding");
    world.updateSquad(squad.id, { movementStatus: undefined });
    expect(
      decoder.decode(packet()).squads.find((s) => s.id === squad.id)
        ?.movementStatus,
    ).toBeUndefined();
  });
});
