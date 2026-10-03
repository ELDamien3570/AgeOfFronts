import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { affordableRefitCount } from "../../src/skirmish/domain/RefitQuote";
import { unitRefitCost } from "../../src/skirmish/domain/Refitting";
function fixture() {
  const data = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const player = game.players[0],
    e = game.expansion!;
  game.owners.fill(1);
  player.gold = 1600;
  e.progression.states[1].age = "BronzeAge";
  e.progression.states[1].completed = TECHNOLOGIES.filter((t) =>
    ["StoneAge", "BronzeAge"].includes(t.age),
  ).map((t) => t.id);
  const original = game.squads.find((s) => s.playerId === 1)!;
  for (const s of [...game.squads])
    if (s.playerId === 1) game.removeSquad(s.id);
  const squads = Array.from({ length: 6 }, (_, i) =>
    game.addSquad({
      ...original,
      id: game.allocateId(),
      definitionId: "stoneage-infantry",
      troops: 1000,
      x: (20 + i + 0.5) * FIXED,
      y: 20.5 * FIXED,
      order: { type: "hold" },
      refit: null,
      fighting: false,
      moved: false,
    }),
  );
  const target = UNITS.find((u) => u.id === "bronzeage-infantry")!,
    cost = unitRefitCost(target);
  e.supply.inventories[1] = {
    ...cost.items,
    ...Object.fromEntries(
      Object.entries(cost.items ?? {}).map(([id, n]) => [id, n * 2]),
    ),
  };
  return { game, player, e, squads, target, cost };
}
describe("mass refit and completed-asset survival", () => {
  it("quotes and pays only the affordable stationary subset, leaving the selection intact", () => {
    const f = fixture();
    f.game.updateSquad(f.squads[0].id, { fighting: true });
    const selection = {
      selected: new Set(f.squads.map((s) => s.id)),
      selectedShips: new Set<number>(),
      selectedBuilding: null,
    };
    const quote = new EmpireViewModel(f.game.snapshot(), selection).refit()!;
    expect(quote.affordable).toHaveLength(2);
    expect(quote.eligibleCount).toBe(5);
    expect(quote.reason).toBeNull();
    const before = {
      gold: f.player.gold,
      items: { ...f.e.supply.inventories[1] },
    };
    expect(
      f.game.applyCommand({
        type: "refit",
        playerId: 1,
        squadIds: f.squads.map((s) => s.id),
        definitionId: f.target.id,
      }),
    ).toBeNull();
    expect(
      f.game.squads.filter((s) => s.playerId === 1 && s.refit),
    ).toHaveLength(2);
    expect(f.game.squad(f.squads[0].id)!.refit).toBeNull();
    expect(f.player.gold).toBe(before.gold - (f.cost.gold ?? 0) * 2);
    for (const [id, n] of Object.entries(f.cost.items ?? {}))
      expect(f.e.supply.inventories[1][id]).toBe(before.items[id] - n * 2);
    expect(selection.selected.size).toBe(6);
  });
  it("selects the largest upgradeable group and a focused group's whole eligible selection", () => {
    const f = fixture();
    f.game.updateSquad(f.squads[0].id, {
      definitionId: "stoneage-archer",
      kind: "archer",
    });
    const selected = new Set(f.squads.map((s) => s.id));
    const vm = new EmpireViewModel(f.game.snapshot(), {
      selected,
      selectedShips: new Set(),
      selectedBuilding: null,
    });
    expect(vm.refit()!.target!.role).toBe("frontline");
    expect(vm.refit(f.squads[0].id)!.target!.role).toBe("ranged");
  });
  it("bounds affordability by each actual resource and handles free costs", () => {
    expect(
      affordableRefitCount(
        { gold: 800, items: { steel: 2, oil: 3 } },
        100000,
        { steel: 7, oil: 4 },
        20,
      ),
    ).toBe(1);
    expect(affordableRefitCount({}, 0, {}, 20)).toBe(20);
  });
  it("eliminates a foundation-only faction and purges its unfinished buildings", () => {
    const f = fixture(),
      victim = f.game.players[1];
    for (const squad of [...f.game.squads])
      if (squad.playerId === victim.id) f.game.removeSquad(squad.id);
    for (const b of [...f.game.buildings])
      if (b.playerId === victim.id) f.game.removeBuilding(b.id);
    const foundation = f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: victim.id,
      type: "barracks",
      tile: victim.base,
      remainingTicks: 500,
      health: 1000,
    });
    f.game.step();
    expect(victim.eliminated).toBe(true);
    expect(f.game.building(foundation.id)).toBeUndefined();
  });
  it("keeps a faction with a completed building alive", () => {
    const f = fixture(),
      victim = f.game.players[1];
    for (const squad of [...f.game.squads])
      if (squad.playerId === victim.id) f.game.removeSquad(squad.id);
    f.game.owners[victim.base] = victim.id;
    f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: victim.id,
      type: "city",
      tile: victim.base,
      remainingTicks: 0,
      health: 1200,
    });
    f.game.step();
    expect(victim.eliminated).toBe(false);
  });
});
