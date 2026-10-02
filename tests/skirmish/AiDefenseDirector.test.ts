import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
function fixture() {
  const data = new Uint8Array(100 * 70).fill(133),
    map = new GameMapImpl(100, 70, data, data.length),
    game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      runAi: false,
      tribes: false,
      ruleset: "ages-v1",
      aiEconomy: true,
      aiDefenses: true,
    }),
    player = game.players[1],
    economy = game.expansion!.economy,
    defenses = economy.defenses;
  game.owners.fill(player.id);
  player.gold = 100000;
  player.land = data.length;
  game.expansion!.supply.deposits.splice(0);
  game.expansion!.supply.resourceSites.update([]);
  game.expansion!.progression.states[player.id].completed.push(
    ...TECHNOLOGIES.filter((t) => t.age === "StoneAge").map((t) => t.id),
  );
  game.buildings.splice(
    0,
    game.buildings.length,
    {
      id: game.allocateId(),
      playerId: player.id,
      type: "city",
      tile: map.ref(12, 25),
      remainingTicks: 0,
      age: "StoneAge",
    },
    {
      id: game.allocateId(),
      playerId: player.id,
      type: "factory",
      tile: map.ref(28, 41),
      remainingTicks: 0,
      age: "StoneAge",
    },
  );
  const own = game.squads.filter((s) => s.playerId === player.id);
  for (let i = own.length; i < 10; i++) {
    const squad = structuredClone(own[0]);
    squad.id = game.allocateId();
    squad.kind = "infantry";
    squad.definitionId = "stoneage-infantry";
    game.squads.push(squad);
    own.push(squad);
  }
  own.forEach((s, i) => {
    s.x = (i < 2 ? 12.5 + i * 2 : 60.5 + (i % 3) * 2) * FIXED;
    s.y = (i < 2 ? 25.5 : 20.5 + Math.floor(i / 3) * 2) * FIXED;
  });
  game.squads
    .filter((s) => s.playerId !== player.id)
    .forEach((s, i) => {
      s.x = 90.5 * FIXED;
      s.y = (50.5 + i * 2) * FIXED;
    });
  game.restore(game.checkpoint());
  for (let tick = 0; tick < 10000; tick++) {
    economy.cities.step(tick);
    if (!economy.cities.diagnostics.pending) break;
  }
  game.tick = 300;
  defenses.step();
  const saved = defenses.checkpoint();
  saved.allowances.forEach(([, a]) => (a.amount = 100000));
  defenses.restore(saved);
  return {
    game,
    map,
    player: game.players[1],
    economy,
    defenses,
    own: game.squads.filter((s) => s.playerId === player.id),
  };
}
describe("persistent funded city defenses", () => {
  it("completes an actual circuit before marking it defended and preserves a paid repair on takeover", () => {
    const { game, player, defenses } = fixture();
    game.tick = 420;
    for (let ticks = 0; ticks < 5000; ticks++) {
      game.step();
      defenses.step();
      const project = defenses.projects.get(player.id)!;
      expect(project.phase).not.toBe("abandoned");
      if (project.phase === "defended") break;
    }
    const project = defenses.projects.get(player.id)!;
    expect(project.phase).toBe("defended");
    expect(project.paid).toHaveLength(project.sites.length);
    expect(
      project.paid.every(
        (id) => game.buildings.find((b) => b.id === id)!.remainingTicks === 0,
      ),
    ).toBe(true);
    const tower = game.buildings.find((b) => b.id === project.paid[0])!;
    tower.health = tower.maxHealth! - 40;
    game.tick = project.nextDecision + 3 - (project.nextDecision % 3);
    const gold = player.gold;
    defenses.step();
    expect(player.gold).toBe(gold - 8);
    expect(game.expansion!.fortifications.repairing("building", tower.id)).toBe(
      true,
    );
    game.setAiController(player.id, false);
    expect(game.expansion!.fortifications.repairing("building", tower.id)).toBe(
      true,
    );
    for (let tick = 0; tick < 30; tick++) game.step();
    expect(tower.health).toBe(tower.maxHealth);
  });
  it("funds the useful opening phase, pays one real tower and preserves only its unpaid remainder", () => {
    const { game, player, economy, defenses } = fixture(),
      project = defenses.projects.get(player.id)!;
    expect(project).toBeDefined();
    expect(project.next).toBe(0);
    game.tick = 420;
    const gold = player.gold;
    defenses.step();
    const after = defenses.projects.get(player.id)!;
    expect(after.next).toBe(1);
    expect(after.paid).toHaveLength(1);
    expect(player.gold).toBe(gold - project.quote.steps[0].cost.gold!);
    expect(economy.ledger.protected(player.id)).toEqual({
      gold: project.quote.steps[1].cost.gold,
      reserves: 0,
      items: project.quote.steps[1].cost.items ?? {},
    });
    const paid = game.buildings.find((b) => b.id === after.paid[0])!;
    expect(paid.type).toBe("tower");
    expect(paid.remainingTicks).toBeGreaterThan(0);
    game.tick = 441;
    defenses.step();
    expect(after.next).toBe(1);
    expect(economy.assets.leases.size).toBe(2);
    const beforeTakeover = player.gold;
    game.setAiController(player.id, false);
    expect(defenses.projects.size).toBe(0);
    expect(economy.ledger.reservations.size).toBe(0);
    expect(economy.assets.leases.size).toBe(0);
    expect(player.gold).toBe(beforeTakeover);
    expect(game.buildings).toContain(paid);
  });
  it("abandons future spending when its hub is lost while retaining already paid construction", () => {
    const { game, player, economy, defenses, map } = fixture();
    game.tick = 420;
    defenses.step();
    const project = defenses.projects.get(player.id)!,
      paid = game.buildings.find((b) => b.id === project.paid[0])!;
    const gold = player.gold;
    game.owners[map.ref(12, 25)] = 1;
    game.tick = 441;
    defenses.step();
    expect(project.phase).toBe("abandoned");
    expect(economy.ledger.reservations.size).toBe(0);
    expect(economy.assets.leases.size).toBe(0);
    expect(player.gold).toBe(gold);
    expect(game.buildings).toContain(paid);
  });
});
