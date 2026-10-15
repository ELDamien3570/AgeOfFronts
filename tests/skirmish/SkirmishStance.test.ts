import {secondsToTicks} from '../../src/skirmish/Protocol';
import { describe, expect, it } from "vitest";
import { FIXED } from "../../src/skirmish/Protocol";
import { trenchLineScene } from "./fixtures/TrenchLine";
function ready() {
  const scene = trenchLineScene(true),
    { game, defenders, riders } = scene,
    s = defenders[0],
    e = game.expansion!;
  game.updateSquad(riders[0].id, { x: s.x, y: s.y + 4 * FIXED });
  game.updateSquad(s.id, {
    weaponState: {
      sharedReadyTick: 0,
      ranged: { nextTick: secondsToTicks(5), remainder: 0, shots: 0, reloadStartedTick: 0 },
    },
  });
  game.applyCommand({
    type: "stance",
    playerId: 2,
    squadIds: [s.id],
    stance: "skirmish",
  });
  return { ...scene, s, e };
}
describe("Explicit reload skirmish", () => {
  it("withdraws only on a dangerous reload and preserves weapon commitment", () => {
    const { game, s, e } = ready(),
      before = structuredClone(game.squad(s.id)!.weaponState);
    e.skirmish.step();
    expect(game.squad(s.id)!.lastWithdrawTick).toBe(0);
    expect(game.squad(s.id)!.order.type).toBe("move");
    expect(game.squad(s.id)!.weaponState).toEqual(before);
    expect(e.skirmish.active(s.id)).toBe(true);
  });
  it("does not retreat by default, during short reloads, or after a direct Hold", () => {
    const { game, s, e } = ready();
    game.applyCommand({
      type: "stance",
      playerId: 2,
      squadIds: [s.id],
      stance: "default",
    });
    e.skirmish.step();
    expect(game.squad(s.id)!.lastWithdrawTick).toBeUndefined();
    game.applyCommand({
      type: "stance",
      playerId: 2,
      squadIds: [s.id],
      stance: "skirmish",
    });
    game.updateSquad(s.id, {
      weaponState: {
        sharedReadyTick: 0,
        ranged: { nextTick: secondsToTicks(1)-1, remainder: 0, shots: 0, reloadStartedTick: 0 },
      },
    });
    e.skirmish.step();
    expect(game.squad(s.id)!.lastWithdrawTick).toBeUndefined();
    game.updateSquad(s.id, {
      weaponState: {
        sharedReadyTick: 0,
        ranged: { nextTick: secondsToTicks(5), remainder: 0, shots: 0, reloadStartedTick: 0 },
      },
    });
    game.applyCommand({
      type: "order",
      playerId: 2,
      squadIds: [s.id],
      order: { type: "hold" },
    });
    e.skirmish.step();
    expect(game.squad(s.id)!.lastWithdrawTick).toBeUndefined();
  });
  it("never abandons a reserved trench", () => {
    const { game, s, e } = ready();
    e.fortifications.addBarrier({
      id: game.allocateId(),
      a: 0,
      b: 0,
      kind: "trench",
      playerId: 2,
      age: "Modern",
      tiles: [game.map.ref(29, 28), game.map.ref(30, 28)],
      health: 5000,
      maxHealth: 5000,
      remainingTicks: 0,
    });
    game.applyCommand({
      type: "occupy",
      playerId: 2,
      squadIds: [s.id],
      tile: game.map.ref(29, 28),
    });
    e.skirmish.step();
    expect(game.squad(s.id)!.lastWithdrawTick).toBeUndefined();
  });
  it("restores a mid-withdrawal without resetting reload or movement", () => {
    const { game, e } = ready();
    e.skirmish.step();
    const copy = trenchLineScene(true).game;
    copy.restore(game.checkpoint());
    expect(copy.checkpoint()).toEqual(game.checkpoint());
    for (let i = 0; i < secondsToTicks(1.25); i++) {
      game.step();
      copy.step();
    }
    expect(copy.checkpoint()).toEqual(game.checkpoint());
  });
  it("finishes a loose withdrawal at reload completion", () => {
    const { game, s, e } = ready();
    e.skirmish.step();
    game.tick = secondsToTicks(5);
    e.skirmish.step();
    expect(e.skirmish.active(s.id)).toBe(false);
    expect(game.squad(s.id)!.order.type).toBe("hold");
  });
});
