import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";

function fixture() {
  const map = new GameMapImpl(
    96,
    64,
    new Uint8Array(96 * 64).fill(133),
    96 * 64,
  );
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    aiEconomy: true,
    runAi: true,
  });
  const player = game.players[1],
    expansion = game.expansion!;
  return { game, player, expansion };
}
describe("coordinated AI economy", () => {
  it("funds an attainable workshop dependency before its refined equipment input exists", () => {
    const { player, expansion } = fixture();
    const research = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "BronzeAge",
      research,
      inventory: { copper: 80, tin: 20 },
      buildings: [
        {
          id: 900,
          playerId: player.id,
          type: "barracks",
          age: "BronzeAge",
          remainingTicks: 0,
          tile: player.base,
        },
      ],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(demand.equipment["equipment:bronzeage"]).toBeGreaterThan(0);
    expect(demand.materials.bronze).toBeGreaterThan(0);
    const candidates = expansion.economy.placements.candidates(
      player,
      snapshot,
      demand,
    );
    // Rotation keeps exact tile work bounded; production-chain utility itself
    // must not require an already-built blacksmith or a finished bronze batch.
    expect(
      new AiProductionDependencies(snapshot, new Set()).available(
        "equipment:bronzeage",
        1,
      ),
    ).toBe(true);
    expect(candidates.length).toBeLessThanOrEqual(8);
  });
  it("merges shared refining demand before subtracting paid input batches", () => {
    const { player } = fixture(),
      research = TECHNOLOGIES.map((t) => t.id);
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "Modern",
      research,
      inventory: {},
      buildings: [],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    snapshot.incoming.bronze = 10;
    const recipe = PRODUCTION_RECIPES.find(
      (r) => r.outputs["equipment:bronzeage"],
    )!;
    const materials = new AiProductionDependencies(
      snapshot,
      new Set(["copper", "tin"]),
    ).materials({ "equipment:bronzeage": 2 });
    expect(materials.bronze).toBe(recipe.inputs.bronze * 2);
    expect(materials.copper).toBe(
      8 * Math.ceil((recipe.inputs.bronze * 2 - 10) / 10),
    );
  });
  it("pays refits once, respects shared savings, and releases only unpaid work at takeover", () => {
    const { game, player, expansion } = fixture();
    const research = expansion.progression.states[player.id];
    research.age = "BronzeAge";
    research.completed = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    for (const squad of game.squads.filter((s) => s.playerId === player.id)) {
      squad.kind = "infantry";
      squad.definitionId = "stoneage-infantry";
      squad.x = (game.map.x(player.base) + 0.5) * 256;
      squad.y = (game.map.y(player.base) + 0.5) * 256;
    }
    player.gold = 100000;
    expansion.supply.inventories[player.id]["equipment:bronzeage"] = 20;
    const now = player.gold;
    expansion.economy.ledger.tryReserve(
      {
        id: "research",
        claimant: "research",
        playerId: player.id,
        generation: game.aiGeneration(player.id),
        priority: "committed",
        amounts: { gold: now },
        createdTick: 0,
        progressTick: 0,
        expiresTick: 500,
      },
      { gold: now },
    );
    expect(expansion.economy.military.decide(player)).toBe(false);
    expansion.economy.ledger.release("research");
    expect(expansion.economy.military.decide(player)).toBe(true);
    const paid = game.squads.find((s) => s.playerId === player.id && s.refit)!;
    expect(paid).toBeDefined();
    expect(player.gold).toBeLessThan(now);
    expect(expansion.economy.assets.held(`squad:${paid.id}`)).toBe(true);
    game.setAiController(player.id, false);
    expect(paid.refit).not.toBeNull();
    expect(expansion.economy.assets.leases.size).toBe(0);
    expect(expansion.economy.ledger.reservations.size).toBe(0);
  });
  it("bounds purchases to one faction per global slot and releases unpaid savings on takeover", () => {
    const { game, player, expansion } = fixture();
    player.gold = 1;
    const commands = vi.spyOn(game, "applyCommand");
    expansion.economy.decide(player);
    expect(commands).not.toHaveBeenCalled();
    expect(expansion.economy.ledger.reservations.size).toBe(1);
    game.setAiController(player.id, false);
    expect(expansion.economy.ledger.reservations.size).toBe(0);
    expect(expansion.economy.production(player.id)).toEqual({});
    expect(player.gold).toBe(1);
  });
  it("continues identically after restoring candidate cursors, savings and production demand", () => {
    const { game, player } = fixture();
    player.gold = 500;
    for (let i = 0; i < 100; i++) game.step();
    const saved = game.checkpoint();
    const clone = fixture().game;
    clone.restore(saved);
    for (let i = 0; i < 120; i++) {
      game.step();
      clone.step();
    }
    expect(clone.checkpoint()).toEqual(game.checkpoint());
  });
  it("quotes placement without granting funds or bypassing authoritative purchases", () => {
    const { game, player } = fixture();
    player.gold = 0;
    const tile = game
      .ownedLandNearest(player.id, player.base, 256)
      .find((t) => game.buildingSite(player.id, "city", t) === null)!;
    expect(tile).toBeDefined();
    expect(game.buildingSite(player.id, "city", tile)).toBeNull();
    expect(
      game.applyCommand({
        type: "build",
        playerId: player.id,
        buildingType: "city",
        tile,
      }),
    ).not.toBeNull();
    expect(player.gold).toBe(0);
  });
  it("uses only compatible completed producers and never requests equipment for unbuildable Modern units", () => {
    const { game, player, expansion } = fixture();
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "Modern",
      research: TECHNOLOGIES.map((t) => t.id),
      inventory: { stone: 1000 },
      buildings: [
        {
          id: 900,
          playerId: player.id,
          type: "barracks",
          age: "StoneAge",
          remainingTicks: 0,
          tile: player.base,
        },
      ],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(
      Object.keys(demand.equipment).every((id) => id.includes("stoneage")),
    ).toBe(true);
    expect(expansion.economy.enabled(player)).toBe(true);
    expect(game.options.aiEconomy).toBe(true);
  });
  it("protects reserved production inputs and subtracts paid incoming output exactly once", () => {
    const recipe = PRODUCTION_RECIPES.find(
      (r) => r.outputs["equipment:bronzeage"],
    );
    expect(recipe).toBeDefined();
    const context = {
      buildings: [
        {
          id: 1,
          playerId: 1,
          type: recipe!.building,
          age: "BronzeAge" as const,
          remainingTicks: 0,
          tile: 0,
        },
      ],
      research: TECHNOLOGIES.map((t) => t.id),
      inventory: { ...recipe!.inputs },
      incoming: {},
      recipes: PRODUCTION_RECIPES,
      plans: new Map(),
      busy: new Set<number>(),
      renewable: new Set<string>(),
      squadCount: 0,
      ai: true,
      aiDemand: {
        equipment: { "equipment:bronzeage": 1 },
        materials: {},
        units: {},
      },
    };
    expect(
      automaticProduction({
        ...context,
        protectedInputs: { ...recipe!.inputs },
      }).size,
    ).toBe(0);
    expect(
      automaticProduction({
        ...context,
        incoming: { "equipment:bronzeage": 1 },
      }).size,
    ).toBe(0);
  });
});
