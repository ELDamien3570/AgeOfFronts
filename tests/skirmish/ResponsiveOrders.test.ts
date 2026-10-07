import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { UNITS } from "../../src/skirmish/content/Units";
import { canCharge, chargeReadiness } from "../../src/skirmish/client/ChargeReadiness";
import { retainSquads } from "./UnitFixtures";

const cavalry = UNITS.find(u => u.age === "StoneAge" && u.charge)!;
function fixture() {
  const data = new Uint8Array(100 * 70).fill(133), map = new GameMapImpl(100, 70, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
  const template = match.squads.find(s => s.playerId === 1)!;
  const [squad] = retainSquads(match, [...match.squads.filter(s => s.playerId !== 1), {
    ...template, id: match.allocateId(), kind: "cavalry" as const, definitionId: cavalry.id, x: 20.5 * FIXED, y: 35.5 * FIXED,
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  }]).filter(s => s.playerId === 1);
  return { map, match, squad };
}

describe("double-click charge over an order already sent", () => {
  it("keeps the charge when the first click's move is still being planned", () => {
    const { map, match, squad } = fixture();
    // First click: the ordinary move leaves immediately and enters admission.
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(90, 60) } })).toBeNull();
    expect(match.movementAdmission.hasPending(squad.id)).toBe(true);
    // Second click: the charge supersedes that pending move.
    expect(match.applyCommand({ type: "charge", playerId: 1, squadIds: [squad.id], x: 26.5 * FIXED, y: 35.5 * FIXED })).toBeNull();
    expect(match.movementAdmission.hasPending(squad.id)).toBe(false);
    const chargeTile = map.ref(26, 35);
    let charged = false;
    for (let tick = 0; tick < 200; tick++) {
      match.step();
      const live = match.squad(squad.id)!;
      if (live.charge) charged = true;
      // The superseded move to (90,60) never takes over.
      if (live.order.type === "move") expect(live.order.tile).not.toBe(map.ref(90, 60));
    }
    expect(charged).toBe(true);
    expect(Math.hypot(match.squad(squad.id)!.x - 26.5 * FIXED, match.squad(squad.id)!.y - 35.5 * FIXED)).toBeLessThan(3 * FIXED);
    expect(chargeTile).toBe(map.ref(26, 35));
  });

  it("rejects a charge that is not ready and leaves the move in place", () => {
    const { map, match, squad } = fixture();
    match.updateSquad(squad.id, { chargeReadyTick: match.tick + 200 });
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(60, 35) } })).toBeNull();
    expect(match.applyCommand({ type: "charge", playerId: 1, squadIds: [squad.id], x: 26.5 * FIXED, y: 35.5 * FIXED })).toMatch(/ready charge/);
    for (let tick = 0; tick < 20; tick++) match.step();
    expect(match.squad(squad.id)!.order).toMatchObject({ type: "move" });
  });
});

describe("client charge readiness", () => {
  it("reports no bar for units without a charge and the recovered cooldown fraction otherwise", () => {
    const base = { x: 0, y: 0, charge: null, afloat: null, refit: null };
    expect(chargeReadiness({ ...base, definitionId: "stoneage-infantry" }, 0)).toBeUndefined();
    const cooldown = cavalry.charge!.cooldownTicks;
    expect(chargeReadiness({ ...base, definitionId: cavalry.id, chargeReadyTick: 0 }, 10)).toBe(1);
    expect(chargeReadiness({ ...base, definitionId: cavalry.id, chargeReadyTick: 100 + cooldown / 2 }, 100)).toBeCloseTo(0.5);
    expect(chargeReadiness({ ...base, definitionId: cavalry.id, charge: { phase: "approach", x: 0, y: 0, startTick: 0, committedTick: 0 } }, 10)).toBe(0);
    expect(canCharge({ ...base, definitionId: cavalry.id }, 10, 3 * FIXED, 0)).toBe(true);
    expect(canCharge({ ...base, definitionId: cavalry.id }, 10, cavalry.charge!.maximumDistance + FIXED, 0)).toBe(false);
  });
});
