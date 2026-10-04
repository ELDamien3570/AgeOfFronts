import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import type { Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { usableNextAge } from "../../src/skirmish/domain/AiResearchUtility";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";
import { ShoreTransport } from "../../src/skirmish/domain/ShoreTransport";
import {
  PRODUCTION_RECIPES,
  productionTicks,
} from "../../src/skirmish/domain/Supply";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";

function fixture() {
  const data = new Uint8Array(96 * 64).fill(133);
  const map = new GameMapImpl(96, 64, data, data.length);
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    deferredPlanning: true,
  });
  return { game, map };
}
describe("playtest stability regressions", () => {
  it.each(["StoneAge", "Modern"] as const)(
    "moves the player and every AI on 500 Valles in %s with all policies enabled",
    async (startingAge) => {
      const loaded = await loadServerMap(
        defaultLobbySettings("valles-kairulia", 500),
      );
      const map = createSkirmishMap(
        loaded.map.width,
        loaded.map.height,
        loaded.map.terrain,
        loaded.map.elevation,
        loaded.map.forest,
        loaded.map.resourceTerrain,
      );
      const game = new Skirmish(map, {
        seed: 42,
        aiCount: 10,
        tribeCount: 25,
        tribes: true,
        ruleset: "ages-v1",
        startingAge,
        ...DEFAULT_AI_POLICIES,
      });
      const initial = new Map(
        game.squads.map((s) => [s.id, { x: s.x, y: s.y }]),
      );
      const own = game.squads.filter((s) => s.playerId === 1),
        target = game.players[0].base - 6 * map.width();
      expect(
        game.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: own.map((s) => s.id),
          order: { type: "move", tile: target },
        }),
      ).toBeNull();
      let firstMove: number | undefined;
      for (let tick = 0; tick < 80; tick++) {
        game.step();
        if (
          firstMove === undefined &&
          own.some(
            (s) => s.x !== initial.get(s.id)!.x || s.y !== initial.get(s.id)!.y,
          )
        )
          firstMove = game.tick;
      }
      expect(firstMove).toBeLessThanOrEqual(20);
      const moved = new Set(
        game.squads
          .filter(
            (s) =>
              initial.has(s.id) &&
              (s.x !== initial.get(s.id)!.x || s.y !== initial.get(s.id)!.y),
          )
          .map((s) => s.playerId),
      );
      for (const ai of game.players.filter((p) => p.ai && p.kind === "regular"))
        expect(moved.has(ai.id), "AI " + ai.id + " displaced").toBe(true);
    },
  );
  it.each(["tower", "trench", "gun-nest", "missile-defence"] as const)(
    "defeats an AI whose sole surviving building is %s",
    (type) => {
      const { game } = fixture(),
        ai = game.players.find((p) => p.ai)!;
      for (const s of [...game.squads])
        if (s.playerId === ai.id) game.removeSquad(s.id);
      for (const b of [...game.buildings])
        if (b.playerId === ai.id) game.removeBuilding(b.id);
      game.addBuilding({
        id: game.allocateId(),
        playerId: ai.id,
        type,
        tile: ai.base,
        remainingTicks: 0,
        health: 1000,
      });
      game.step();
      expect(ai.eliminated).toBe(true);
    },
  );
  it.each(["city", "factory", "blacksmith", "barracks"] as const)(
    "keeps an AI alive with a completed %s",
    (type) => {
      const { game } = fixture(),
        ai = game.players.find((p) => p.ai)!;
      for (const s of [...game.squads])
        if (s.playerId === ai.id) game.removeSquad(s.id);
      for (const b of [...game.buildings])
        if (b.playerId === ai.id) game.removeBuilding(b.id);
      game.addBuilding({
        id: game.allocateId(),
        playerId: ai.id,
        type,
        tile: ai.base,
        remainingTicks: 0,
        health: 1000,
      });
      game.step();
      expect(ai.eliminated).toBe(false);
    },
  );
  it("preserves the human survival rule", () => {
    const { game } = fixture(),
      human = game.players.find((p) => !p.ai)!;
    for (const s of [...game.squads])
      if (s.playerId === human.id) game.removeSquad(s.id);
    for (const b of [...game.buildings])
      if (b.playerId === human.id) game.removeBuilding(b.id);
    game.addBuilding({
      id: game.allocateId(),
      playerId: human.id,
      type: "tower",
      tile: human.base,
      remainingTicks: 0,
      health: 1000,
    });
    game.step();
    expect(human.eliminated).toBe(false);
  });
  it("does not erase a fully scanned grid on repeated full snapshots or a distant build", () => {
    const { game, map } = fixture();
    game.owners.fill(1);
    game.players[0].gold = 1e9;
    game.expansion!.supply.replaceDeposits([]);
    game.expansion!.progression.states[1].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
    const preview = new PlacementPreview(map),
      bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    preview.begin(game.snapshot(), 1, "factory");
    const sites = [...preview.sites(bounds, 256)],
      tested = preview.diagnostics.tested;
    for (let i = 0; i < 10; i++) {
      preview.update(game.snapshot());
      expect(preview.sites(bounds, 1)).toEqual(sites);
    }
    expect(preview.diagnostics.tested).toBe(tested);
    game.addBuilding({
      id: game.allocateId(),
      playerId: 1,
      type: "factory",
      tile: map.ref(80, 50),
      remainingTicks: 0,
    });
    preview.update(game.snapshot());
    expect(preview.sites(bounds, 1)).toEqual(sites);
    expect(preview.diagnostics.tested).toBe(tested);
    game.owners[sites[0]] = 2;
    preview.update(game.snapshot());
    expect(preview.sites(bounds, 1)).not.toContain(sites[0]);
    expect(preview.sites(bounds, 1).length).toBeGreaterThan(sites.length - 3);
  });
  it("keeps connected army moves out of the synchronous shore-shortcut search", () => {
    const { game } = fixture(),
      own = game.squads.filter((s) => s.playerId === 1);
    game.expansion!.progression.states[1].completed = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    expect(
      game.applyCommand({
        type: "create-army",
        playerId: 1,
        squadIds: own.map((s) => s.id),
      }),
    ).toBeNull();
    const legacy = ShoreTransport.prototype as unknown as {
      preferredLeg: () => unknown;
    };
    const shortcut = vi.spyOn(legacy, "preferredLeg").mockImplementation(() => {
      throw Error("unbounded shortcut");
    });
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: own.map((s) => s.id),
        order: { type: "move", tile: game.map.ref(50, 30) },
      }),
    ).toBeNull();
    expect(shortcut).not.toHaveBeenCalled();
    shortcut.mockRestore();
  });
  it("uses a large human industry beyond the old 60-metal/12-equipment plateau", () => {
    const buildings: Building[] = Array.from({ length: 60 }, (_, id) => ({
      id: id + 1,
      type: id < 30 ? "factory" : "blacksmith",
      playerId: 1,
      tile: 0,
      age: "BronzeAge",
      remainingTicks: 0,
    }));
    const research = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    const inventory: Record<string, number> = {
      copper: 30000,
      tin: 10000,
      bronze: 66,
      "equipment:bronzeage": 14,
    };
    const jobs = new Map<number, { id: string; remaining: number }>();
    for (let tick = 0; tick < 2400; tick += 20) {
      for (const [id, job] of jobs) {
        job.remaining -= 20;
        if (job.remaining <= 0) {
          const recipe = PRODUCTION_RECIPES.find((r) => r.id === job.id)!;
          for (const [item, n] of Object.entries(recipe.outputs))
            inventory[item] = (inventory[item] ?? 0) + n;
          jobs.delete(id);
        }
      }
      const incoming: Record<string, number> = {};
      for (const job of jobs.values())
        for (const [item, n] of Object.entries(
          PRODUCTION_RECIPES.find((r) => r.id === job.id)!.outputs,
        ))
          incoming[item] = (incoming[item] ?? 0) + n;
      const plans = automaticProduction({
        buildings,
        research,
        inventory,
        incoming,
        recipes: PRODUCTION_RECIPES,
        plans: new Map(),
        busy: new Set(jobs.keys()),
        renewable: new Set(["copper", "tin"]),
        squadCount: 6,
        ai: false,
      });
      for (const [id, recipeId] of plans) {
        const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId)!;
        for (const [item, n] of Object.entries(recipe.inputs)) {
          expect(inventory[item] ?? 0).toBeGreaterThanOrEqual(n);
          inventory[item] -= n;
        }
        jobs.set(id, {
          id: recipeId,
          remaining: productionTicks(recipe, research),
        });
      }
    }
    expect(inventory.bronze).toBeGreaterThan(1000);
    expect(inventory["equipment:bronzeage"]).toBeGreaterThanOrEqual(80);
  });
  it("researches with unreserved gold while a recruit waits for troop reserves", () => {
    const { game } = fixture(),
      ai = game.players[1],
      e = game.expansion!;
    game.options.aiEconomy = true;
    game.options.runAi = true;
    for (const squad of [...game.squads])
      if (squad.playerId !== ai.id) game.removeSquad(squad.id);
    e.progression.states[ai.id].completed = TECHNOLOGIES.filter(
      (t) => t.age === "StoneAge" && t.id !== "stoneage-field-engineering",
    ).map((t) => t.id);
    for (const b of game.buildings)
      if (b.playerId === ai.id)
        game.updateBuilding(b.id, { remainingTicks: 0 });
    game.addBuilding({
      id: game.allocateId(),
      playerId: ai.id,
      type: "barracks",
      tile: ai.base,
      remainingTicks: 0,
      health: 1000,
    });
    const investments = vi
      .spyOn(e.economy.placements, "candidates")
      .mockReturnValue([]);
    ai.gold = 1000;
    ai.reserves = 0;
    for (let tick = 3; tick <= 240; tick += 3) {
      game.tick = tick;
      e.economy.step();
    }
    expect(e.progression.states[ai.id].research.warfare?.technologyId).toBe(
      "stoneage-field-engineering",
    );
    expect(ai.gold).toBe(550);
    expect(ai.reserves).toBe(0);
    investments.mockRestore();
    expect(e.economy.ledger.protected(ai.id).gold).toBeLessThanOrEqual(ai.gold);
  });
  it("quotes an attainable next age without requiring later purchases upfront", () => {
    const { game } = fixture(),
      player = game.players[1],
      e = game.expansion!;
    for (const b of game.buildings)
      if (b.playerId === player.id)
        game.updateBuilding(b.id, { remainingTicks: 0 });
    game.addBuilding({
      id: game.allocateId(),
      playerId: player.id,
      type: "barracks",
      tile: player.base,
      remainingTicks: 0,
      health: 1000,
    });
    const research = TECHNOLOGIES.filter((t) => t.age === "StoneAge").map(
      (t) => t.id,
    );
    const snapshot = economicSnapshot({
      player: { ...player, gold: 3000 },
      tick: 0,
      generation: 0,
      age: "StoneAge",
      research,
      inventory: { copper: 80, tin: 20 },
      buildings: game.buildings,
      squads: game.squads,
      ships: [],
      jobs: [],
      production: {},
      cap: 60,
      threatTroops: 0,
    });
    expect(
      usableNextAge(snapshot, {
        resources: ["copper", "tin"],
        usableCoast: false,
        seaThreat: 0,
        goods: 0,
        protectedItems: {},
      }),
    ).toBe(true);
  });
});
