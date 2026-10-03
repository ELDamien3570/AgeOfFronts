import { describe, expect, it, vi } from "vitest";
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
  it("recovers an occupied final destination without dropping later player orders", () => {
    const {match,map,own}=fixture(), mover=own[0], blocker=own[1];
    const goal=map.ref(70,35);
    expect(match.applyCommand({type:"order",playerId:1,squadIds:[mover.id],order:{type:"move",tile:goal}})).toBeNull();
    for(let i=0;i<400 && match.movementAdmission.pendingCount;i++)match.step();
    expect(mover.order.type).toBe("move");
    const order=mover.order as Extract<typeof mover.order,{type:"move"}>;
    match.updateSquad(blocker.id,{x:order.x ?? (map.x(order.tile)+.5)*256,y:order.y ?? (map.y(order.tile)+.5)*256,order:{type:"hold"}});
    const later={type:"move" as const,tile:map.ref(65,45)};
    match.updateSquad(mover.id,{queuedOrders:[later]});
    let replacement=false;
    for(let i=0;i<800;i++){
      match.step();
      if(mover.order.type==="move" && (mover.order.tile!==order.tile || mover.order.x!==order.x || mover.order.y!==order.y))replacement=true;
      if(mover.order.type==="hold")break;
    }
    expect(replacement).toBe(true);
    expect(mover.order.type).toBe("hold");
    expect(Math.hypot(mover.x-blocker.x,mover.y-blocker.y)).toBeGreaterThan(100);
    expect(Math.abs(mover.y-(45.5*256))).toBeLessThan(256);
  });
  it("backs off limited replacement routes and rejects capacity exhaustion without changing current orders", () => {
    const { match, map, own } = fixture();
    const orders = own.map(s => structuredClone(s.order));
    match.applyCommand({ type: "order", playerId: 1, squadIds: own.map(s => s.id), order: { type: "move", tile: map.ref(75, 50) } });
    const id = match.movementAdmission.events.slice(-1)[0]!.id;
    match.movementAdmission.completed(id, own[0].id, "limited", [], 10);
    const saved = match.checkpoint();
    expect(saved.admission.pending[0][1].members[0]).toMatchObject({ limitedAttempts: 1, retryAt: 30 });
    match.restore(saved);
    match.movementAdmission.completed(id, own[0].id, "limited", [], 40);
    match.movementAdmission.completed(id, own[0].id, "limited", [], 100);
    expect(match.movementAdmission.pendingCount).toBe(0);
    expect(match.movementAdmission.events.slice(-1)[0]).toMatchObject({ status: "rejected", reason: expect.stringContaining("capacity") });
    expect(match.squads.filter(s => s.playerId === 1).map(s => s.order)).toEqual(orders);
  });
  it("activates committed land waypoints without synchronous searches and retains later legs across restore", () => {
    const { match, map, own } = fixture(), squad = own[0];
    const first = map.ref(45, 35), second = map.ref(48, 35);
    match.updateSquad(squad.id, { queuedOrders: [{ type: "move", tile: first }, { type: "move", tile: second }] });
    const sync = vi.spyOn(match.paths, "find");
    (match as unknown as { finishOrder(s: typeof squad): void }).finishOrder(squad);
    expect(sync).not.toHaveBeenCalled();
    expect(squad.order).toEqual({ type: "move", tile: first });
    expect(squad.queuedOrders).toEqual([{ type: "move", tile: second }]);
    expect(match.checkpoint().queuedLegs.size).toBe(1);
    const restored = new Skirmish(map, match.options); restored.restore(match.checkpoint());
    for (let i = 0; i < 50; i++) { match.step(); restored.step(); }
    expect(restored.checkpoint()).toEqual(match.checkpoint());
    expect(sync).not.toHaveBeenCalled();
    expect(match.checkpoint().queuedLegs.size).toBe(0);
    expect(match.squad(squad.id)!.queuedOrders).toEqual([{ type: "move", tile: second }]);
  });
  it("keeps an unchanged AI route while another faction has pending Shift intentions, including after restore", () => {
    const {match,map,own}=fixture();
    const other=match.squads.filter(s=>s.playerId===2);
    match.setAiController(2,false);
    const human = {type:"order" as const,playerId:2,squadIds:other.map(s=>s.id),order:{type:"move" as const,tile:map.ref(55,30)}};
    expect(match.applyCommand(human)).toBeNull();
    expect(match.applyCommand({...human,append:true,order:{type:"move",tile:map.ref(60,40)}})).toBeNull();
    match.setAiController(1,true);
    const ai = {type:"order" as const,playerId:1,squadIds:own.map(s=>s.id),order:{type:"move" as const,tile:map.ref(75,50)}};
    expect(match.applyCommand(ai)).toBeNull();
    expect(match.movementAdmission.queued(human.squadIds)).toBe(1);
    const saved=match.checkpoint();
    const clone = new Skirmish(map,match.options);clone.restore(saved);
    expect(clone.movementAdmission.queued(human.squadIds)).toBe(1);
    expect(match.applyCommand(ai)).toBeNull();expect(clone.applyCommand(ai)).toBeNull();
    expect(match.checkpoint()).toEqual(saved);expect(clone.checkpoint()).toEqual(saved);
  });
  it("admits ordinary AI moves without restarting the same pending intention", () => {
    const { match, map, own } = fixture();
    match.setAiController(1, true);
    const ids = own.map((s) => s.id),
      tile = map.ref(75, 50);
    const command = {
      type: "order" as const,
      playerId: 1,
      squadIds: ids,
      order: { type: "move" as const, tile },
    };
    const oldOrders = own.map((s) => structuredClone(s.order));
    expect(match.applyCommand(command)).toBeNull();
    expect(own.map((s) => s.order)).toEqual(oldOrders);
    const saved = match.movementAdmission.checkpoint();
    expect(match.applyCommand(command)).toBeNull();
    expect(match.movementAdmission.checkpoint()).toEqual(saved);
    for (let i = 0; i < 400 && match.movementAdmission.pendingCount; i++)
      match.step();
    expect(match.movementAdmission.pendingCount).toBe(0);
    expect(status(match)).toBe("executed");
    expect(own.every((s) => s.order.type === "move")).toBe(true);
  });
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
    const replacementId = match.movementAdmission.checkpoint().pending[0][0];
    const clone = new Skirmish(map, match.options);
    clone.restore(match.checkpoint());
    let executed = false;
    for (let i = 0; i < 300; i++) {
      match.step();
      clone.step();
      if (match.movementAdmission.events.some(e => e.id === replacementId && e.status === "executed")) {
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
