import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { createFormation } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";

// T-c (3): a loose AI rider meets a close invader with a charge, not a plain attack.
describe("AI loose-squad charges", () => {
  it("charges an invader inside charge range", () => {
    const size = 64, land = new Uint8Array(size * size).fill(133);
    const game = new Skirmish(new GameMapImpl(size, size, land, land.length), { seed: 42, aiCount: 1, tribes: false, runAi: true, ruleset: "ages-v1" });
    const ai = game.players[1], human = game.players[0], e = game.expansion!;
    const template = structuredClone(game.squads[0]);
    for (const s of [...game.squads]) game.removeSquad(s.id);
    for (const p of game.players) { e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id); e.progression.states[p.id].age = "EarlyMedieval"; }
    game.owners.fill(ai.id);
    ai.base = game.map.ref(20, 32);
    const add = (owner: number, id: string, x: number, y: number) => {
      const unit = UNIT.get(id)!;
      return game.addSquad({ ...template, id: game.allocateId(), playerId: owner, definitionId: id, kind: unit.line, troops: unit.formationRecipe!.capacity, manpower: createManpower(unit),
        formation: createFormation(id), x: x * FIXED, y: y * FIXED, order: { type: "hold" }, path: [], queuedOrders: [], charge: null, combatTargetId: null, xp: 0 } as Squad);
    };
    const rider = add(ai.id, "earlymedieval-heavycavalry", 20, 32);
    add(human.id, "earlymedieval-infantry", 25, 32);
    game.expansion!.diplomacy.state.wars = [{ a: ai.id, b: human.id }];
    const apply = vi.spyOn(game, "applyCommand");
    for (let i = 0; i < 40 && !apply.mock.calls.some(([c]) => c.type === "charge"); i++) game.step();
    const charge = apply.mock.calls.map(([c]) => c).find((c) => c.type === "charge");
    expect(charge).toBeDefined();
    expect(charge!.playerId).toBe(ai.id);
    expect((charge as { squadIds: number[] }).squadIds).toEqual([rider.id]);
  });
});
