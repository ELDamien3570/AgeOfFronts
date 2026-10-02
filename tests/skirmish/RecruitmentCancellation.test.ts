import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Recruitment } from "../../src/skirmish/domain/Recruitment";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { Skirmish } from "../../src/skirmish/Simulation";

function queue() {
  const q = new Recruitment();
  const add = (buildingId = 1, kind: "infantry" | "archer" = "infantry", playerId = 1) =>
    q.enqueue({ buildingId, playerId, category: "land", kind, totalTicks: 100,
      cost: { gold: 100, reserves: 1000, items: { stone: 2 } } });
  return { q, add };
}

describe("single paid recruitment cancellation", () => {
  it("removes the newest inactive matching job while retaining head progress and notifying indexes", () => {
    const { q, add } = queue();
    add(); add(); add();
    q.jobs[0].remainingTicks = 20;
    const head = q.jobs[0], tail = q.jobs[2];
    const refund = vi.fn(), change = vi.fn();
    q.onChange(change);
    expect(q.cancel(1, { kind: "infantry" }, refund)).toBe(tail);
    expect(q.jobs).toHaveLength(2);
    expect(q.jobs[0]).toBe(head);
    expect(head.remainingTicks).toBe(20);
    expect(q.byId(tail.id)).toBeUndefined();
    expect(refund).toHaveBeenCalledExactlyOnceWith(tail);
    expect(change).toHaveBeenCalledExactlyOnceWith(tail, false);
  });
  it("recognizes the real producer head before filtering and respects ownership and selected producers", () => {
    const { q, add } = queue();
    add(1, "archer"); add(1); add(2); add(3, "infantry", 2);
    const expected = q.jobs[1];
    expect(q.cancel(1, { kind: "infantry", buildingIds: new Set([1]) }, () => {})).toBe(expected);
    expect(q.jobs).toHaveLength(3);
    expect(q.cancel(1, { buildingIds: new Set([3]) }, () => {})).toBeUndefined();
  });
  it("chooses the least advanced active job and handles the final job exactly once", () => {
    const { q, add } = queue();
    add(1); add(2);
    q.jobs[0].remainingTicks = 20;
    q.jobs[1].remainingTicks = 80;
    const last = q.jobs[0];
    expect(q.cancel(1, {}, () => {})?.buildingId).toBe(2);
    expect(q.cancel(1, {}, () => {})).toBe(last);
    const refund = vi.fn();
    expect(q.cancel(1, {}, refund)).toBeUndefined();
    expect(refund).not.toHaveBeenCalled();
  });
  it.each(["land", "ship", "aircraft"] as const)("refunds %s costs through the authoritative command and survives restore", category => {
    const data = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(64, 64, data, data.length), {
      seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
    });
    const p = game.players[0], inventory = game.expansion!.supply.inventories[p.id];
    const gold = p.gold, reserves = p.reserves, stone = inventory.stone;
    game.recruitment.enqueue({ playerId: p.id, buildingId: 999, category,
      kind: category === "aircraft" ? "fighter" : category === "ship" ? "warship" : "infantry",
      definitionId: "test", totalTicks: 100,
      cost: { gold: 21, reserves: 50, items: { stone: 3 } },
    });
    game.recruitment.restore(game.recruitment.checkpoint());
    const command = { type: "cancel-recruitment" as const, playerId: p.id, category, definitionId: "test", buildingIds: [999] };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(game.applyCommand(command)).toBeNull();
    expect([p.gold, p.reserves, inventory.stone]).toEqual([gold + 21, reserves + 50, stone + 3]);
    expect(game.applyCommand(command)).toMatch(/No matching/);
    expect([p.gold, p.reserves, inventory.stone]).toEqual([gold + 21, reserves + 50, stone + 3]);
  });
});
