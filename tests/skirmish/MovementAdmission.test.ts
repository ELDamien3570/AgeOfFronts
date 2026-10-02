import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const data = new Uint8Array(100 * 70).fill(133),
    map = new GameMapImpl(100, 70, data, data.length),
    match = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      runAi: false,
      deferredPlanning: true,
    });
  const own = match.squads.filter((s) => s.playerId === 1);
  return { match, map, own };
}
function status(match: Skirmish) {
  const events = match.movementAdmission.events;
  return events[events.length - 1]?.status;
}
describe("transactional replacement movement", () => {
  it("retains later Shift legs when a mixed idle member begins its first deferred move", () => {
    const { match, map, own } = fixture();
    const ids = [own[0].id, own[1].id];
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [ids[0]],
      order: { type: "move", tile: map.ref(70, 35) },
    });
    for (const tile of [map.ref(60, 50), map.ref(45, 50)])
      expect(
        match.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: ids,
          append: true,
          order: { type: "move", tile },
        }),
      ).toBeNull();
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++)
      match.step();
    expect(match.movementAdmission.pendingCount).toBe(0);
    expect(own[0].queuedOrders).toHaveLength(2);
    expect(own[1].queuedOrders).toHaveLength(1);
    expect(own[1].queuedOrders[0].type).toBe("move");
    expect(own[0].queuedOrders[1]).not.toEqual(own[1].queuedOrders[0]);
  });
  it("supersedes an overlapping pending Shift without losing the other cohort's replacement", () => {
    const { match, map, own } = fixture(),
      ids = [own[0].id, own[1].id];
    for (const id of ids)
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [id],
        order: { type: "move", tile: map.ref(70, 35) },
      });
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: ids,
      append: true,
      order: { type: "move", tile: map.ref(60, 50) },
    });
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [ids[1]],
        order: { type: "hold" },
      }),
    ).toBeNull();
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++)
      match.step();
    expect(own[0].order.type).toBe("move");
    expect(own[0].queuedOrders).toHaveLength(0);
    expect(own[1].order.type).toBe("hold");
    expect(own[1].queuedOrders).toHaveLength(0);
  });
  it("keeps subset Shift orders attached to those units across a pending replacement", () => {
    const { match, map, own } = fixture();
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: own.map((s) => s.id),
      order: { type: "move", tile: map.ref(70, 35) },
    });
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own[0].id],
        append: true,
        order: { type: "move", tile: map.ref(60, 50) },
      }),
    ).toBeNull();
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++)
      match.step();
    expect(match.movementAdmission.checkpoint().pending).toHaveLength(0);
    expect(own[0].queuedOrders).toHaveLength(1);
    expect(own.slice(1).every((s) => s.queuedOrders.length === 0)).toBe(true);
  });
  it("uses one Shift formation across different pending cohorts and restores its continuation", () => {
    const { match, map, own } = fixture();
    for (const [index, x] of [68, 74].entries())
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own[index].id],
        order: { type: "move", tile: map.ref(x, 35) },
      });
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own[0].id, own[1].id],
        append: true,
        order: { type: "move", tile: map.ref(60, 50) },
      }),
    ).toBeNull();
    for (let i = 0; i < 5; i++) match.step();
    const clone = new Skirmish(map, match.options);
    clone.restore(match.checkpoint());
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++) {
      match.step();
      clone.step();
    }
    expect(match.movementAdmission.checkpoint().pending).toHaveLength(0);
    expect(clone.checkpoint()).toEqual(match.checkpoint());
    expect(own[0].queuedOrders).toHaveLength(1);
    expect(own[1].queuedOrders).toHaveLength(1);
    expect(own[0].queuedOrders[0]).not.toEqual(own[1].queuedOrders[0]);
  });
  it("preserves a mixed Shift selection containing a pending unit and an idle unit", () => {
    const { match, map, own } = fixture();
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [own[0].id],
      order: { type: "move", tile: map.ref(70, 35) },
    });
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own[0].id, own[1].id],
        append: true,
        order: { type: "move", tile: map.ref(60, 50) },
      }),
    ).toBeNull();
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++)
      match.step();
    expect(match.movementAdmission.checkpoint().pending).toHaveLength(0);
    expect(own[0].queuedOrders).toHaveLength(1);
    expect(own[1].order.type).toBe("move");
    expect(own[1].order).not.toEqual(own[0].queuedOrders[0]);
  });
  it("continues the old orders and commits the entire selection after planning", () => {
    const { match, map, own } = fixture(),
      ids = own.map((s) => s.id),
      old = own.map((s) => ({ ...s.order }));
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: ids,
        order: { type: "move", tile: map.ref(70, 35) },
      }),
    ).toBeNull();
    expect(own.map((s) => s.order)).toEqual(old);
    expect(status(match)).toBe("deferred");
    let executed = false;
    for (let i = 0; i < 300; i++) {
      const moving = own.filter((s) => s.order.type === "move").length;
      expect(moving === 0 || moving === own.length).toBe(true);
      match.step();
      if (status(match) === "executed") {
        executed = true;
        break;
      }
    }
    expect(executed).toBe(true);
    expect(own.every((s) => s.order.type === "move")).toBe(true);
  });
  it("preserves Shift formation intent during pending replacement and restores identically", () => {
    const { match, map, own } = fixture(),
      ids = own.map((s) => s.id);
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: ids,
        order: { type: "move", tile: map.ref(70, 35) },
      }),
    ).toBeNull();
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: ids,
        order: { type: "move", tile: map.ref(60, 50) },
        append: true,
      }),
    ).toBeNull();
    for (let i = 0; i < 3; i++) match.step();
    const clone = new Skirmish(map, match.options);
    clone.restore(match.checkpoint());
    let executed = false;
    for (let i = 0; i < 300; i++) {
      match.step();
      clone.step();
      if (status(match) === "executed") {
        executed = true;
        break;
      }
    }
    expect(executed).toBe(true);
    expect(clone.checkpoint()).toEqual(match.checkpoint());
    expect(own.every((s) => s.queuedOrders.length === 1)).toBe(true);
    expect(
      new Set(own.map((s) => JSON.stringify(s.queuedOrders[0]))).size,
    ).toBe(own.length);
  });
  it("a newer stop supersedes the whole pending selection without activating any route", () => {
    const { match, map, own } = fixture(),
      ids = own.map((s) => s.id);
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: ids,
      order: { type: "move", tile: map.ref(70, 35) },
    });
    match.step();
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [ids[0]],
        order: { type: "hold" },
      }),
    ).toBeNull();
    expect(status(match)).toBe("superseded");
    for (let i = 0; i < 10; i++) match.step();
    expect(own.every((s) => s.order.type === "hold")).toBe(true);
    expect(match.routePlanner.diagnostics.pending).toBe(0);
  });
  it("keeps moving along an active order while its replacement is deferred", () => {
    const { match, map, own } = fixture(),
      ids = own.map((s) => s.id);
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: ids,
      order: { type: "move", tile: map.ref(55, 35) },
    });
    for (let i = 0; i < 300 && status(match) !== "executed"; i++) match.step();
    expect(status(match)).toBe("executed");
    const orders = own.map((s) => ({ ...s.order })),
      positions = own.map((s) => ({ x: s.x, y: s.y }));
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: ids,
      order: { type: "move", tile: map.ref(75, 50) },
    });
    match.step();
    expect(status(match)).toBe("deferred");
    expect(own.map((s) => s.order)).toEqual(orders);
    expect(
      own.some((s, i) => s.x !== positions[i].x || s.y !== positions[i].y),
    ).toBe(true);
    for (let i = 0; i < 300 && status(match) !== "executed"; i++) match.step();
    expect(status(match)).toBe("executed");
  });
});
