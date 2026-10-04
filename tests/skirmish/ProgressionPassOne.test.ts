import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Building, MatchOptions } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { BuildingDeletionViewModel } from "../../src/skirmish/client/BuildingDeletionViewModel";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import {
  buildingIntegrity,
  buildingTechnology,
} from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AutomaticBuildingTiers } from "../../src/skirmish/domain/AutomaticBuildingTiers";
import { availableGold } from "../../src/skirmish/domain/Gold";
import {
  PRODUCTION_RECIPES,
  costRejection,
} from "../../src/skirmish/domain/Supply";
import {
  defaultLobbySettings,
  validateLobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";

function fixture(options: Partial<MatchOptions> = {}) {
  const data = new Uint8Array(64 * 64).fill(133);
  const m = new Skirmish(new GameMapImpl(64, 64, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    ...options,
  });
  m.owners.fill(1);
  const e = m.expansion!,
    p = m.players[0];
  const building = (
    type: Building["type"] = "barracks",
    patch: Partial<Building> = {},
  ) =>
    m.addBuilding({
      id: m.allocateId(),
      playerId: 1,
      type,
      tile: p.base,
      remainingTicks: 0,
      age: "StoneAge",
      health: 1200,
      maxHealth: 1200,
      ...patch,
    });
  return { m, e, p, building };
}

describe("research driven military tiers", () => {
  it("preserves damage and production queues without charging or restarting construction", () => {
    const { m, e, p, building } = fixture();
    const b = building("barracks", { health: 600 }),
      city = building("city");
    e.progression.states[1].age = "BronzeAge";
    e.progression.states[1].completed = [
      buildingTechnology("barracks", "BronzeAge")!,
    ];
    m.recruitment.enqueue({
      playerId: 1,
      buildingId: b.id,
      category: "land",
      kind: "infantry",
      cost: {},
      totalTicks: 100,
    });
    const gold = p.gold;
    e.beforeStep();
    expect(b.age).toBe("BronzeAge");
    expect(b.health).toBe(
      Math.floor(buildingIntegrity("barracks", "BronzeAge") / 2),
    );
    expect(b.remainingTicks).toBe(0);
    expect(city.age).toBe("StoneAge");
    expect(p.gold).toBe(gold);
    expect(m.recruitment.jobs[0].remainingTicks).toBe(100);
    expect(
      m.applyCommand({
        type: "upgrade-building",
        playerId: 1,
        buildingIds: [b.id],
      }),
    ).toMatch(/automatically/);
    const tiers = new AutomaticBuildingTiers();
    tiers.step(
      m.players,
      e.progression.states,
      m.buildingFacts(),
      (id, patch) => m.updateBuilding(id, patch),
    );
    const lookup = vi.spyOn(m.buildingFacts(), "byOwner");
    tiers.step(
      m.players,
      e.progression.states,
      m.buildingFacts(),
      (id, patch) => m.updateBuilding(id, patch),
    );
    expect(lookup).not.toHaveBeenCalled();
  });
  it("updates newly completed structures, preserves higher captured tiers, and restores eligibility", () => {
    const { m, e, building } = fixture();
    e.progression.states[1].age = "BronzeAge";
    e.progression.states[1].completed = [
      buildingTechnology("barracks", "BronzeAge")!,
    ];
    const b = building("barracks", { remainingTicks: 2 }),
      captured = building("barracks", { age: "Modern" });
    e.beforeStep();
    expect(b.age).toBe("StoneAge");
    m.updateBuilding(b.id, { remainingTicks: 0 });
    e.beforeStep();
    expect(b.age).toBe("BronzeAge");
    expect(captured.age).toBe("Modern");
    const saved = m.checkpoint();
    m.restore(saved);
    e.beforeStep();
    expect(m.buildingFacts().byId(b.id)!.age).toBe("BronzeAge");
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: captured.id,
        definitionId: "modern-infantry",
      }),
    ).not.toBeNull();
  });
  it.each(["refine-bronze", "refine-iron", "refine-steel"])(
    "Stone factories can run researched %s",
    (recipeId) => {
      const { m, e, building } = fixture();
      const b = building("factory");
      e.progression.states[1].age = "Modern";
      e.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
      const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId)!;
      Object.assign(e.supply.inventories[1], recipe.inputs);
      expect(
        m.applyCommand({
          type: "produce",
          playerId: 1,
          buildingId: b.id,
          recipeId,
        }),
      ).toBeNull();
      e.supply.step(1, m.players, m.buildings, m.owners);
      expect(e.supply.jobs[b.id]?.recipeId).toBe(recipeId);
      expect(b.age).toBe("StoneAge");
    },
  );
});

describe("human demolition and confirmation", () => {
  it("deletes exactly one stack member without a building refund and cleans jobs", () => {
    const { m, e, p, building } = fixture();
    const b = building("factory"),
      other = building("factory");
    const gold = p.gold;
    e.supply.jobs[b.id] = {
      owner: 1,
      recipeId: "paused",
      remainingTicks: 50,
      totalTicks: 50,
    };
    expect(e.supply.setProduction(p, b, null)).toBeNull();
    m.recruitment.enqueue({
      playerId: 1,
      buildingId: b.id,
      category: "land",
      kind: "infantry",
      cost: { gold: 50, reserves: 1000 },
      totalTicks: 100,
    });
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 1,
        buildingId: b.id,
      }),
    ).toBeNull();
    expect(m.buildingFacts().byId(b.id)).toBeUndefined();
    expect(m.buildingFacts().byId(other.id)).toBeDefined();
    expect(p.gold).toBe(gold + 50); // Only prepaid training is refunded.
    expect(m.recruitment.byProducer(b.id)).toHaveLength(0);
    expect(e.supply.jobs[b.id]).toBeUndefined();
    expect(Boolean(e.supply.productionPlans()[b.id])).toBe(false);
  });
  it("removes tower walls immediately while retaining other tower stack members", () => {
    const { m, e, building } = fixture();
    const a = building("tower"),
      stacked = building("tower"),
      b = building("tower", { tile: m.players[0].base + 1 });
    const forts = e.fortifications;
    forts.barriers.push({
      id: 1,
      a: a.id,
      b: b.id,
      age: "StoneAge",
      playerId: 1,
      tiles: [a.tile, b.tile],
      health: 2000,
      maxHealth: 2000,
      remainingTicks: 0,
    });
    forts.step(1, m.buildings);
    expect(forts.blocked(a.tile, 2)).toBe(true);
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 1,
        buildingId: a.id,
      }),
    ).toBeNull();
    expect(forts.barriers).toHaveLength(0);
    expect(forts.blocked(a.tile, 2)).toBe(true);
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 1,
        buildingId: stacked.id,
      }),
    ).toBeNull();
    expect(forts.blocked(a.tile, 2)).toBe(false);
  });
  it("rejects AI, foreign, stale and lost-territory deletion", () => {
    const { m, building } = fixture();
    const b = building();
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 2,
        buildingId: b.id,
      }),
    ).toMatch(/AI/);
    m.setAiController(2, false);
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 2,
        buildingId: b.id,
      }),
    ).not.toBeNull();
    m.owners[b.tile] = 2;
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 1,
        buildingId: b.id,
      }),
    ).not.toBeNull();
    expect(m.buildingFacts().byId(b.id)).toBeDefined();
    expect(
      commandSchema.safeParse({
        type: "delete-building",
        playerId: 1,
        buildingId: 1.5,
      }).success,
    ).toBe(false);
  });
  it("pins the confirmed identity and invalidates captured buildings", () => {
    const { m, building } = fixture();
    const b = building();
    const vm = new BuildingDeletionViewModel();
    expect(vm.request(m.snapshot(), 1, b.id)).toBe(true);
    vm.cancel();
    expect(vm.confirm(m.snapshot(), 1)).toBeUndefined();
    vm.request(m.snapshot(), 1, b.id);
    m.updateBuilding(b.id, { playerId: 2 });
    vm.reconcile(m.snapshot(), 1);
    expect(vm.pendingId).toBeNull();
    expect(vm.confirm(m.snapshot(), 1)).toBeUndefined();
  });
  it("counts individual owned stack members including construction and updates on capture/removal", () => {
    const { m, building } = fixture();
    const a = building(),
      b = building("barracks", { remainingTicks: 20 });
    building("barracks", { playerId: 2 });
    const model = () =>
      new HudViewModel(
        new SkirmishViewModel(m.snapshot(), {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: null,
        }),
      );
    expect(model().buildingCounts.get("barracks")).toEqual({
      total: 2,
      ready: 1,
    });
    m.updateBuilding(b.id, { playerId: 2 });
    m.removeBuilding(a.id);
    expect(model().buildingCounts.has("barracks")).toBe(false);
  });
});

describe("infinite human gold", () => {
  it("bypasses only gold, records no refundable gold, excludes AI and survives restore", () => {
    const { m, e, p, building } = fixture({
      infiniteGoldForPlayers: true,
      humanNames: ["A", "B"],
    });
    p.gold = 0;
    const b = building();
    e.progression.states[1].completed = [
      buildingTechnology("barracks", "StoneAge")!,
    ];
    expect(
      m.players
        .filter((player) => !player.ai)
        .every((player) => availableGold(player) === Infinity),
    ).toBe(true);
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: b.id,
        definitionId: "stoneage-infantry",
      }),
    ).toBeNull();
    expect(p.gold).toBe(0);
    expect(m.recruitment.jobs[0].cost.gold).toBe(0);
    expect(costRejection(p, {}, { gold: 999999, items: { steel: 1 } })).toMatch(
      /steel/,
    );
    expect(
      m.applyCommand({
        type: "delete-building",
        playerId: 1,
        buildingId: b.id,
      }),
    ).toBeNull();
    expect(p.gold).toBe(0);
    const saved = m.checkpoint();
    m.restore(saved);
    expect(availableGold(m.players[0])).toBe(Infinity);
    expect(JSON.stringify(m.snapshot())).not.toContain('"gold":null');
    m.setAiController(2, true);
    m.players[1].gold = 0;
    expect(availableGold(m.players[1])).toBe(0);
    m.setAiController(2, false);
    expect(availableGold(m.players[1])).toBe(Infinity);
  });
  it("keeps normal games finite and validates the custom rule", () => {
    const { p } = fixture();
    expect(availableGold(p)).toBe(p.gold);
    expect(
      validateLobbySettings({
        ...defaultLobbySettings("africa"),
        infiniteGoldForPlayers: true,
      }).infiniteGoldForPlayers,
    ).toBe(true);
    expect(() =>
      validateLobbySettings({
        ...defaultLobbySettings("africa"),
        infiniteGoldForPlayers: "yes" as unknown as boolean,
      }),
    ).toThrow();
  });
});
