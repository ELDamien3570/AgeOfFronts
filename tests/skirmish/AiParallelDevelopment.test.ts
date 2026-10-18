import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { buildingCost } from "../../src/skirmish/content/Buildings";
import { recruitmentVariant } from "../../src/skirmish/content/FormationRecipes";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import * as planner from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { manpowerCapacity } from "../../src/skirmish/domain/AiManpowerCapacity";
import { militaryPosture } from "../../src/skirmish/domain/AiMilitaryPosture";
import { scaledRecipeCost } from "../../src/skirmish/domain/Manpower";
import { researchTerms } from "../../src/skirmish/domain/Progression";
import { landRecruitmentTicks } from "../../src/skirmish/domain/Recruitment";

function fixture() {
  const map = new GameMapImpl(160, 80, new Uint8Array(12800).fill(133), 12800);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    startingAge: "BronzeAge",
    maximumAge: "BronzeAge",
    aiEconomy: true,
    deferredPlanning: true,
    runAi: false,
  });
  const saved = game.checkpoint();
  saved.owners.fill(2);
  game.restore(saved);
  const player = game.players[1],
    e = game.expansion!,
    state = e.progression.states[2];
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  player.gold = 100000;
  player.reserves = 10000;
  player.personalityId = "scholar";
  state.age = "BronzeAge";
  state.completed = TECHNOLOGIES.filter(
    (t) =>
      ["StoneAge", "BronzeAge"].includes(t.age) &&
      t.id !== "formation-capacity-bronzeage",
  ).map((t) => t.id);
  state.research = {};
  state.advancement = null;
  for (const unit of UNITS)
    for (const [item, count] of Object.entries(unit.cost.items ?? {}))
      e.supply.inventories[2][item] = count * 1000;
  const add = (
    type: Parameters<typeof game.buildingSite>[1],
    x: number,
    y = 30,
  ) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type,
      tile: map.ref(x, y),
      age: "BronzeAge",
      remainingTicks: 0,
      health: 1000,
    });
  add("city", 20);
  add("barracks", 40);
  add("archery", 60);
  add("stables", 80);
  add("blacksmith", 100);
  add("factory", 120);
  for (const s of game.squads)
    game.updateSquad(s.id, { x: 30.5 * FIXED, y: 40.5 * FIXED });
  const snapshot = (target = game) =>
    economicSnapshot({
      player: target.players[1],
      tick: target.tick,
      generation: target.aiGeneration(2),
      age: target.expansion!.progression.states[2].age,
      research: target.expansion!.progression.states[2].completed,
      inventory: target.expansion!.supply.inventories[2],
      buildings: target.buildingFacts().byOwner(2),
      squads: target.squadFacts().aliveByOwner(2),
      ships: [],
      jobs: target.recruitment.byOwner(2),
      production: target.expansion!.supply.jobs,
      cap: target.squadCapacity(target.players[1]),
      threatTroops: 0,
    });
  const decide = () => {
    game.tick += secondsToTicks(3);
    e.economy.decide(player);
  };
  return { game, player, e, state, add, snapshot, decide };
}
describe("paid parallel AI development", () => {
  it("keeps research funded while paying actual additional Bronze recruits from surplus", () => {
    const f = fixture(),
      commands = vi.spyOn(f.game, "applyCommand");
    for (let n = 0; n < 10 && !Object.keys(f.state.research).length; n++)
      f.decide();
    expect(Object.keys(f.state.research).length).toBeGreaterThan(0);
    const recruits = commands.mock.calls.filter(
      ([c], n) =>
        c.type === "recruit" && commands.mock.results[n].value === null,
    );
    expect(recruits.length).toBeGreaterThan(0);
    expect(f.player.gold).toBeLessThan(100000);
    expect(f.player.reserves).toBeLessThan(10000);
    expect(f.player.gold).toBeGreaterThanOrEqual(
      militaryPosture(f.snapshot(), personalityOf(f.player)).protectedGold,
    );
  });
  it("quotes manpower using actual formation reserves and counts already-paid cities", () => {
    const f = fixture(),
      snapshot = f.snapshot();
    snapshot.reserveIncome = 0;
    snapshot.liquid.reserves = 0;
    const demand = { equipment: {}, materials: {}, units: {}, manpower: 1000 };
    expect(manpowerCapacity(snapshot, demand).shortage).toBe(1000);
    const city = f.add("city", 140);
    f.game.updateBuilding(city.id, { remainingTicks: secondsToTicks(60) });
    const funded = {
      ...snapshot,
      buildings: f.game.buildingFacts().byOwner(2),
    };
    expect(manpowerCapacity(funded, demand).shortage).toBeLessThan(1000);
  });
  it("keeps optional recruitment within the research floor and rejects missing equipment", () => {
    const f = fixture();
    f.player.gold = militaryPosture(
      f.snapshot(),
      personalityOf(f.player),
    ).protectedGold;
    const commands = vi.spyOn(f.game, "applyCommand");
    f.decide();
    expect(
      commands.mock.calls.filter(
        ([c], n) =>
          c.type === "recruit" && commands.mock.results[n].value === null,
      ).length,
    ).toBeLessThanOrEqual(1);
    for (const id of Object.keys(f.e.supply.inventories[2]))
      f.e.supply.inventories[2][id] = 0;
    commands.mockClear();
    f.state.age = "Modern";
    f.state.completed = TECHNOLOGIES.map((t) => t.id);
    for (const building of f.game.buildingFacts().byOwner(2))
      f.game.updateBuilding(building.id, { age: "Modern" });
    f.player.gold = 100000;
    f.decide();
    expect(commands.mock.calls.some(([c]) => c.type === "recruit")).toBe(false);
  });
  it("rechecks live headroom after the ordinary order instead of overbooking the last squad slot", () => {
    const f = fixture(),
      source = f.game.squadFacts().aliveByOwner(2)[0];
    while (
      f.game.squadFacts().aliveByOwner(2).length <
      f.game.squadCapacity(f.player) - 1
    )
      f.game.addSquad({ ...structuredClone(source), id: f.game.allocateId() });
    const before = f.e.economy.diagnostics.rejected;
    f.decide();
    expect(
      f.game.squadFacts().aliveByOwner(2).length +
        f.game.recruitment.byOwner(2).filter((j) => j.category === "land")
          .length,
    ).toBeLessThanOrEqual(f.game.squadCapacity(f.player));
    expect(f.e.economy.diagnostics.rejected).toBe(before);
  });
  it.each([true, false])(
    "admits measured concurrent construction only with its actual surplus budget (%s)",
    (funded) => {
      const f = fixture(),
        technology = TECHNOLOGIES.find(
          (t) => t.id === "formation-capacity-bronzeage",
        )!;
      const researchCost = researchTerms(technology, 1).gold,
        cityCost = buildingCost("city", "BronzeAge", 1);
      const common = {
        playerId: 2,
        generation: f.game.aiGeneration(2),
        priority: "growth" as const,
        earliestTick: 0,
        expiresTick: secondsToTicks(120),
        prerequisites: [],
      };
      const quote = vi.spyOn(planner, "economicCandidates").mockReturnValue([
        {
          ...common,
          id: "parallel-research",
          kind: "research",
          command: {
            type: "research",
            playerId: 2,
            technologyId: technology.id,
          },
          cost: { gold: researchCost },
          score: 20000,
          reason: "research",
        },
        {
          ...common,
          id: "parallel-city",
          kind: "construct",
          command: {
            type: "build",
            playerId: 2,
            buildingType: "city",
            tile: f.game.map.ref(140, 50),
          },
          cost: cityCost,
          score: 10000,
          reason: "production-capacity:city",
        },
      ]);
      try {
        if (!funded)
          f.player.gold =
            researchCost +
            militaryPosture(f.snapshot(), personalityOf(f.player))
              .protectedGold;
        const gold = f.player.gold;
        f.decide();
        expect(f.state.research.warfare?.technologyId).toBe(technology.id);
        expect(f.game.buildingFacts().byType(2, "city")).toHaveLength(
          funded ? 2 : 1,
        );
        expect(f.player.gold).toBe(
          gold - researchCost - (funded ? (cityCost.gold ?? 0) : 0),
        );
        expect(f.e.economy.ledger.reservations.size).toBe(0);
      } finally {
        quote.mockRestore();
      }
    },
  );
  it("pays for missing intended archery while already-paid technology remains active", () => {
    const f = fixture();
    for (const building of f.game.buildingFacts().byType(2, "archery"))
      f.game.removeBuilding(building.id);
    expect(
      f.game.applyCommand({
        type: "research",
        playerId: 2,
        technologyId: "formation-capacity-bronzeage",
      }),
    ).toBeNull();
    const commands = vi.spyOn(f.game, "applyCommand");
    for (
      let n = 0;
      n < 10 && !f.game.buildingFacts().byType(2, "archery").length;
      n++
    )
      f.decide();
    expect(f.state.research.warfare).toBeDefined();
    expect(
      commands.mock.calls.some(
        ([c], n) =>
          c.type === "build" &&
          c.buildingType === "archery" &&
          commands.mock.results[n].value === null,
      ),
    ).toBe(true);
    expect(f.game.buildingFacts().byType(2, "archery")).toHaveLength(1);
    for (let n = 0; n < 3; n++) f.decide();
    expect(f.game.buildingFacts().byType(2, "archery")).toHaveLength(1);
  });
  it("continues paid parallel decisions identically after checkpoint restoration", () => {
    const f = fixture();
    f.decide();
    const clone = new Skirmish(f.game.map, f.game.options);
    clone.restore(f.game.checkpoint());
    for (let n = 0; n < 4; n++) {
      f.decide();
      clone.tick += secondsToTicks(3);
      clone.expansion!.economy.decide(clone.players[1]);
    }
    expect(clone.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("never lets an urgent optional recruit borrow an existing commitment or the research cushion", () => {
    const f = fixture(),
      units = ["frontline", "ranged"].map(
        (role) => UNITS.find((u) => u.age === "BronzeAge" && u.role === role)!,
      );
    const costs = units.map((u) =>
      scaledRecipeCost(u, recruitmentVariant(u.id, f.state.completed)),
    );
    const floor = militaryPosture(
      f.snapshot(),
      personalityOf(f.player),
    ).protectedGold;
    const held = f.player.gold - (costs[0].gold ?? 0) - floor + 1;
    expect(
      f.e.economy.ledger.tryReserve(
        {
          id: "existing",
          claimant: "existing",
          playerId: 2,
          generation: f.game.aiGeneration(2),
          priority: "growth",
          amounts: { gold: held },
          createdTick: 0,
          progressTick: 0,
          expiresTick: 100000,
        },
        f.snapshot().liquid,
      ),
    ).toBe(true);
    const quote = vi.spyOn(planner, "economicCandidates").mockReturnValue(
      units.map((unit, n) => ({
        id: `urgent-${n}`,
        playerId: 2,
        generation: f.game.aiGeneration(2),
        kind: "recruit",
        command: {
          type: "recruit",
          playerId: 2,
          definitionId: unit.id,
          buildingId: f.game.buildingFacts().byType(2, unit.building)[0].id,
        },
        cost: costs[n],
        priority: "emergency",
        score: 10000 - n,
        reason: "force-deficit",
        earliestTick: 0,
        expiresTick: 100000,
        prerequisites: [],
      })),
    );
    try {
      const commands = vi.spyOn(f.game, "applyCommand");
      f.decide();
      expect(
        commands.mock.calls.filter(
          ([c], n) =>
            c.type === "recruit" && commands.mock.results[n].value === null,
        ),
      ).toHaveLength(1);
      expect(
        f.e.economy.ledger.reservations.get("existing")?.amounts.gold,
      ).toBe(held);
    } finally {
      quote.mockRestore();
    }
  });
  it("quotes actual paid queue completion and resumes recruitment at a newly completed producer", () => {
    const f = fixture(),
      unit = UNITS.find(
        (u) => u.age === "BronzeAge" && u.role === "frontline",
      )!;
    const producer = f.game.buildingFacts().byType(2, unit.building)[0];
    f.player.gold = 1000000;
    for (let n = 0; n < 60; n++)
      expect(
        f.game.applyCommand({
          type: "recruit",
          playerId: 2,
          buildingId: producer.id,
          definitionId: unit.id,
        }),
      ).toBeNull();
    const demand = { equipment: {}, materials: {}, units: { frontline: 180 } };
    const quotes = () =>
      planner.economicCandidates(
        f.snapshot(),
        f.state,
        personalityOf(f.player),
        demand,
        1,
        [],
        undefined,
        "BronzeAge",
      );
    expect(
      quotes().some(
        (c) =>
          c.command.type === "recruit" && c.command.buildingId === producer.id,
      ),
    ).toBe(false);
    const fresh = f.add(unit.building, 140, 50),
      quote = quotes().find(
        (c) =>
          c.command.type === "recruit" && c.command.buildingId === fresh.id,
      )!;
    expect(quote).toBeDefined();
    const gold = f.player.gold;
    expect(f.game.applyCommand(quote.command)).toBeNull();
    const paid = f.game.recruitment.byProducer(fresh.id)[0];
    const actual = UNITS.find((u) => u.id === paid.definitionId)!;
    expect(paid.totalTicks).toBe(
      landRecruitmentTicks(
        actual,
        recruitmentVariant(actual.id, f.state.completed),
      ),
    );
    expect(f.player.gold).toBe(gold - (paid.cost.gold ?? 0));
  });
  it.each([false, true])(
    "prioritizes bounded missing-role/manpower search beyond first64 sites and resumes mid-search (%s)",
    (limited) => {
      const f = fixture();
      f.player.base = f.game.map.ref(24, 40);
      f.e.supply.replaceDeposits([]);
      for (const building of [...f.game.buildingFacts().byOwner(2)])
        if (["city", "archery", "siege-workshop"].includes(building.type))
          f.game.removeBuilding(building.id);
      f.add("city", 24, 40);
      // A valid developed capital blocks the initial nearest page with real
      // occupied/reserved footprints, rather than mocked placement rejections.
      for (const [x, y] of [
        [18, 40],
        [24, 34],
        [18, 34],
      ]) {
        expect(
          f.game.buildingSite(2, "city", f.game.map.ref(x, y), "BronzeAge"),
        ).toBeNull();
        f.add("city", x, y);
      }
      const sites = f.game.ownedLandNearest(2, f.player.base, 256);
      expect(
        sites.findIndex(
          (tile) =>
            f.game.buildingSite(2, "archery", tile, "BronzeAge") === null,
        ),
      ).toBeGreaterThanOrEqual(64);
      expect(
        sites.findIndex(
          (tile) =>
            !f.game
              .buildingFacts()
              .byOwner(2)
              .some((b) => b.tile === tile) &&
            f.game.buildingSite(2, "city", tile, "BronzeAge") === null,
        ),
      ).toBeGreaterThanOrEqual(64);
      expect(
        f.game.applyCommand({
          type: "research",
          playerId: 2,
          technologyId: "formation-capacity-bronzeage",
        }),
      ).toBeNull();
      if (limited) f.player.reserves = 0;
      const demand = {
        equipment: {},
        materials: {},
        units: { ranged: 10, siege: 2, artillery: 2 },
        manpower: limited ? 1000 : 0,
      };
      const exact = vi.spyOn(f.game, "buildingSite");
      for (let n = 0; n < 10; n++) {
        exact.mockClear();
        f.e.economy.placements.candidates(f.player, f.snapshot(), demand);
        expect(exact.mock.calls.length).toBeLessThanOrEqual(8);
      }
      const clone = new Skirmish(f.game.map, f.game.options);
      clone.restore(f.game.checkpoint());
      for (
        let n = 0;
        n < 90 &&
        (!f.game.buildingFacts().byType(2, "archery").length ||
          !f.game.buildingFacts().byType(2, "siege-workshop").length ||
          (limited && f.game.buildingFacts().byType(2, "city").length < 5));
        n++
      ) {
        exact.mockClear();
        const a = f.e.economy.placements.candidates(
            f.player,
            f.snapshot(),
            demand,
          ),
          b = clone.expansion!.economy.placements.candidates(
            clone.players[1],
            f.snapshot(clone),
            demand,
          );
        expect(a).toEqual(b);
        expect(exact.mock.calls.length).toBeLessThanOrEqual(8);
        for (const candidate of a
          .filter((c) =>
            [
              "archery",
              "siege-workshop",
              ...(limited ? ["city"] : []),
            ].includes(c.type),
          )
          .slice(0, 1)) {
          const command = {
            type: "build" as const,
            playerId: 2,
            buildingType: candidate.type,
            tile: candidate.tile,
          };
          expect(f.game.applyCommand(command)).toBeNull();
          expect(clone.applyCommand(command)).toBeNull();
        }
        expect(clone.checkpoint()).toEqual(f.game.checkpoint());
      }
      expect(f.game.buildingFacts().byType(2, "archery")).toHaveLength(1);
      expect(f.game.buildingFacts().byType(2, "siege-workshop")).toHaveLength(
        1,
      );
      if (limited)
        expect(f.game.buildingFacts().byType(2, "city").length).toBeGreaterThan(
          4,
        );
    },
  );
});
