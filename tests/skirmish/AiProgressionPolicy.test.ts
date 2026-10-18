import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AI_PERSONALITIES } from "../../src/skirmish/content/AiPersonalities";
import { buildingCost } from "../../src/skirmish/content/Buildings";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS, VESSELS } from "../../src/skirmish/content/Units";
import { researchUtility } from "../../src/skirmish/domain/AiResearchUtility";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { productionBootstrap } from "../../src/skirmish/domain/AiPlacementCandidates";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import {
  advanceRejection,
  progressionRaceStarted,
  startingProgression,
} from "../../src/skirmish/domain/Progression";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(age: Age) {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const player = game.players[1],
    state = game.expansion!.progression.states[player.id];
  player.gold = 1_000_000;
  state.age = age;
  state.completed = TECHNOLOGIES.filter(
    (t) => AGES.indexOf(t.age) <= AGES.indexOf(age),
  ).map((t) => t.id);
  for (const b of game.buildings.filter((b) => b.playerId === player.id))
    game.updateBuilding(b.id, { remainingTicks: 0, age });
  game.addBuilding({
    id: game.allocateId(),
    playerId: player.id,
    type: "barracks",
    tile: player.base,
    remainingTicks: 0,
    age,
  });
  const next = UNITS.find(
    (u) => u.age === AGES[AGES.indexOf(age) + 1] && u.line === "infantry",
  )!;
  const snapshot = economicSnapshot({
    player,
    tick: 0,
    generation: 0,
    age,
    research: state.completed,
    inventory: { ...next.cost.items },
    buildings: game.buildings,
    squads: game.squads,
    ships: [],
    jobs: [],
    production: {},
    cap: game.squads.filter((s) => s.playerId === player.id).length,
    threatTroops: 0,
  });
  snapshot.readyTroops = 1000;
  const opportunity = {
    resources: [],
    usableCoast: false,
    seaThreat: 0,
    goods: 0,
    protectedItems: {},
  };
  const choices = () =>
    economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} },
      1,
      [],
      opportunity,
    );
  return { game, player, state, snapshot, choices };
}

describe("AI progression scoring", () => {
  it("chooses prerequisite research over optional growth once a safe standing force exists", () => {
    const { state, snapshot } = fixture("BronzeAge");
    const unfinished = TECHNOLOGIES.filter(
      (t) => t.age === "BronzeAge" && t.slot >= 4,
    ).map((t) => t.id);
    state.completed = state.completed.filter((id) => !unfinished.includes(id));
    snapshot.research = state.completed;
    snapshot.readyTroops = 6000;
    snapshot.liquid.gold = 1;
    const candidates = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} },
      1,
      [
        {
          type: "factory",
          tile: 0,
          objective: 5500,
          reason: "capacity:factory",
        },
      ],
    );
    expect(candidates[0].kind).toBe("research");
    expect(candidates[0].priority).toBe("committed");
    expect(candidates[0].cost.gold).toBeGreaterThan(snapshot.liquid.gold!);
  });
  it("saves for a viable age-up instead of repeatedly buying profitable infrastructure", () => {
    const { game, player, state, snapshot } = fixture("BronzeAge");
    game.options.aiEconomy = true;
    game.owners.fill(player.id);
    const template = game.squads[0];
    for (const squad of [...game.squads]) game.removeSquad(squad.id);
    for (let i = 0; i < 4; i++)
      game.addSquad({
        ...template,
        id: game.allocateId(),
        playerId: player.id,
        definitionId: "bronzeage-infantry",
        troops: 1000,
        embarkedOn: null,
        refit: null,
      });
    game.expansion!.supply.inventories[player.id] = {
      ...snapshot.liquid.items,
    };
    player.gold = 1000;
    const capacity = vi.spyOn(game, "squadCapacity").mockReturnValue(4);
    const placements = vi
      .spyOn(game.expansion!.economy.placements, "candidates")
      .mockReturnValue([
        {
          type: "factory",
          tile: player.base,
          objective: 5500,
          reason: "capacity:factory",
        },
      ]);
    const refitting = vi
      .spyOn(game.expansion!.economy.military, "decide")
      .mockReturnValue(false);
    try {
      game.expansion!.economy.decide(player);
      expect(player.gold).toBe(1000);
      expect(game.expansion!.economy.ledger.protected(player.id).gold).toBe(
        1000,
      );
      const saved = game.expansion!.economy.checkpoint();
      game.expansion!.economy.restore(saved);
      while (player.gold < ADVANCES[1].gold) {
        player.gold = Math.min(ADVANCES[1].gold, player.gold + 1000);
        game.tick += 60;
        game.expansion!.economy.decide(player);
        if (state.advancement) break;
      }
      expect(state.advancement?.target).toBe("ClassicalAge");
      expect(player.gold).toBe(0);
      expect(refitting).not.toHaveBeenCalled();
    } finally {
      capacity.mockRestore();
      placements.mockRestore();
      refitting.mockRestore();
    }
  });
  it("prioritizes affordable emergency troops over an age-up", () => {
    const { state, snapshot } = fixture("BronzeAge");
    snapshot.headroom = 10;
    snapshot.threatTroops = 600;
    const candidates = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: { frontline: 10 }, equipment: {}, materials: {} },
      1,
      [],
    );
    expect(candidates[0].priority).toBe("emergency");
    expect(candidates[0].kind).toBe("recruit");
  });
  it.each(["production-prerequisite", "production-capacity", "trade-capacity"])(
    "keeps repeatable %s growth selectable without displacing a legal age-up",
    (reason) => {
      const { state, snapshot } = fixture("BronzeAge");
      const candidates = economicCandidates(
        snapshot,
        state,
        AI_PERSONALITIES[0],
        { units: {}, equipment: {}, materials: {} },
        1,
        [
          {
            type: "factory",
            tile: 0,
            objective: 9000,
            reason: `${reason}:factory`,
          },
        ],
      );
      expect(candidates[0].kind).toBe("advance");
      expect(candidates.some(c => c.reason === `${reason}:factory`)).toBe(true);
      expect(candidates.some((c) => c.kind === "advance")).toBe(true);
    },
  );
  it("keeps emergency survival above measured economic bottlenecks", () => {
    const { state, snapshot } = fixture("BronzeAge");
    snapshot.headroom = 10;
    snapshot.threatTroops = 600;
    const candidates = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: { frontline: 10 }, equipment: {}, materials: {} },
      1,
      [
        {
          type: "factory",
          tile: 0,
          objective: 20000,
          reason: "production-capacity:factory",
        },
      ],
    );
    expect(candidates[0].priority).toBe("emergency");
    expect(candidates[0].kind).toBe("recruit");
  });
  it("processes available inputs before buying another missing extractor", () => {
    const { state, snapshot } = fixture("BronzeAge");
    snapshot.liquid.items = { copper: 1000, tin: 1000 };
    const candidates = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      {
        units: {},
        equipment: { "equipment:bronzeage": 100 },
        materials: { bronze: 1200 },
      },
      1,
      [
        {
          type: "mine",
          tile: 0,
          objective: 12000,
          reason: "production-prerequisite:mine",
        },
        {
          type: "factory",
          tile: 1,
          objective: 9000,
          reason: "production-ready:factory",
          bottleneck: "bootstrap",
        },
      ],
    );
    expect(candidates[0].reason).toBe("production-ready:factory");
  });
  it.each(["advance", "race"])(
    "interrupts restored %s savings for a first core-chain producer, then resumes progression",
    (saving) => {
      const { game, player, state, snapshot } = fixture("BronzeAge"),
        economy = game.expansion!.economy;
      game.options.aiEconomy = true;
      game.owners.fill(player.id);
      game.expansion!.supply.inventories[player.id] = {
        ...snapshot.liquid.items,
      };
      if (saving === "race") {
        state.completed = state.completed.filter(
          (id) =>
            !TECHNOLOGIES.some(
              (t) => t.id === id && t.age === "BronzeAge" && t.slot >= 4,
            ),
        );
        game.expansion!.progression.states[game.players[0].id].completed =
          TECHNOLOGIES.filter((t) => t.age === "BronzeAge").map((t) => t.id);
      }
      const tile = Array.from({ length: 64 * 64 }, (_, i) => i).find(
        (i) => game.buildingSite(player.id, "factory", i, state.age) === null,
      )!;
      expect(tile).toBeDefined();
      const placements = vi
        .spyOn(economy.placements, "candidates")
        .mockReturnValue([]);
      const refitting = vi
        .spyOn(economy.military, "decide")
        .mockReturnValue(false);
      const capacity = vi.spyOn(game, "squadCapacity").mockReturnValue(0);
      try {
        player.gold = 1;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.kind).toBe(
          saving === "advance" ? "advance" : "research",
        );
        const saved = economy.checkpoint();
        economy.restore(saved);
        placements.mockReturnValue([
          {
            type: "factory",
            tile,
            objective: 9000,
            reason: "production-capacity:factory",
            bottleneck: "bootstrap",
          },
        ]);
        game.tick += 24;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.reason).toBe(
          "production-capacity:factory",
        );
        // Bounded placement rotates through other types between decisions. Its
        // absence on the next page must not immediately restart research saving.
        placements.mockReturnValue([]);
        player.gold = 1000;
        game.tick += 24;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.reason).toBe(
          "production-capacity:factory",
        );
        const cost = buildingCost(
          "factory",
          state.age,
          game.buildings.filter(
            (b) => b.playerId === player.id && b.type === "factory",
          ).length,
        ).gold!;
        player.gold = cost;
        game.tick += 24;
        economy.decide(player);
        expect(
          game.buildings.some(
            (b) =>
              b.playerId === player.id &&
              b.type === "factory" &&
              b.tile === tile,
          ),
        ).toBe(true);
        expect(player.gold).toBe(0);
        expect(state.advancement).toBeNull();
        game.tick += 24;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.kind).toBe(
          saving === "advance" ? "advance" : "research",
        );
      } finally {
        placements.mockRestore();
        refitting.mockRestore();
        capacity.mockRestore();
      }
    },
  );
  it.each(["advance", "research"] as const)(
    "preserves funded %s savings under recurring capacity growth and real incremental funding",
    (kind) => {
      const { game, player, state, snapshot } = fixture("BronzeAge"),
        economy = game.expansion!.economy;
      game.options.aiEconomy = true;
      game.owners.fill(player.id);
      if (kind === "research")
        state.completed = state.completed.filter(
          (id) =>
            !TECHNOLOGIES.some(
              (t) => t.id === id && t.age === state.age && t.slot >= 4,
            ),
        );
      game.expansion!.supply.inventories[player.id] = {
        ...snapshot.liquid.items,
      };
      const placements = vi
          .spyOn(economy.placements, "candidates")
          .mockReturnValue([]),
        refits = vi.spyOn(economy.military, "decide").mockReturnValue(false),
        cap = vi.spyOn(game, "squadCapacity").mockReturnValue(0);
      try {
        player.gold = 1;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.kind).toBe(kind);
        const saved = economy.checkpoint();
        economy.restore(saved);
        const buildings = game.buildings.length;
        let income = 0;
        for (
          let i = 0;
          i < 90 &&
          !state.advancement &&
          !Object.values(state.research).some(Boolean);
          i++
        ) {
          // Repeatable targets move each decision; incoming gold is real liquid
          // credit, never a production forecast or a free accepted command.
          placements.mockReturnValue([
            {
              type: i % 2 ? "city" : "siege-workshop",
              tile: i,
              objective: 30000 + i * 100,
              reason:
                i % 2
                  ? "production-capacity:city"
                  : "production-ready:siege-workshop",
              bottleneck: "capacity",
            },
          ]);
          player.gold += 250;
          income += 250;
          game.tick += 24;
          economy.decide(player);
          if (!state.advancement && !Object.values(state.research).some(Boolean))
            expect(economy.checkpoint().saving[0][1].intent.kind).toBe(kind);
        }
        expect(
          !!state.advancement || Object.values(state.research).some(Boolean),
        ).toBe(true);
        expect(player.gold).toBeGreaterThanOrEqual(0);
        expect(player.gold).toBeLessThan(1 + income);
        expect(game.buildings).toHaveLength(buildings);
      } finally {
        placements.mockRestore();
        refits.mockRestore();
        cap.mockRestore();
      }
    },
  );
  it.each(["construct", "research"] as const)(
    "replaces an untyped legacy %s capacity goal with a genuine first core-chain producer",
    (kind) => {
      const { game, player, state } = fixture("BronzeAge"),
        economy = game.expansion!.economy;
      game.options.aiEconomy = true;
      game.owners.fill(player.id);
      const placements = vi
          .spyOn(economy.placements, "candidates")
          .mockReturnValue([]),
        refits = vi.spyOn(economy.military, "decide").mockReturnValue(false),
        cap = vi.spyOn(game, "squadCapacity").mockReturnValue(0);
      try {
        player.gold = 1;
        economy.decide(player);
        const saved = economy.checkpoint(),
          old = saved.saving[0][1].intent;
        old.kind = kind;
        old.id = "legacy-capacity";
        old.reason = "production-ready:city";
        delete old.bottleneck;
        if (kind === "research") {
          const technology = TECHNOLOGIES.find(
            (t) => t.age === state.age && t.tree === "economic" && t.slot === 2,
          )!;
          state.completed = state.completed.filter((id) => id !== technology.id);
          old.command = {
            type: "research",
            playerId: player.id,
            technologyId: technology.id,
          };
          old.reason = "prerequisite:production-capacity:factory";
        }
        saved.ledger = [];
        economy.restore(saved);
        placements.mockReturnValue([
          {
            type: "factory",
            tile: 0,
            objective: 9000,
            reason: "production-capacity:factory",
            bottleneck: "bootstrap",
          },
        ]);
        game.tick += 24;
        economy.decide(player);
        expect(economy.checkpoint().saving[0][1].intent.bottleneck).toBe(
          "bootstrap",
        );
        expect(economy.checkpoint().saving[0][1].intent.reason).toBe(
          "production-capacity:factory",
        );
        expect(player.gold).toBe(1);
      } finally {
        placements.mockRestore();
        refits.mockRestore();
        cap.mockRestore();
      }
    },
  );
  it("bootstraps a missing core chain, counts foundations and leaves siege buffers as ordinary growth", () => {
    const { snapshot } = fixture("BronzeAge");
    snapshot.liquid.items = { copper: 100, tin: 100, stone: 100 };
    const core = {
      units: { frontline: 10 },
      equipment: { "equipment:bronzeage": 100 },
      materials: {},
    };
    const missing = productionBootstrap(snapshot, core);
    expect(missing.buildings.has("blacksmith")).toBe(true);
    expect(missing.buildings.has("factory")).toBe(true);
    snapshot.buildings = [
      ...snapshot.buildings,
      ...["factory", "blacksmith"].map((type, i) => ({
        id: 900 + i,
        playerId: snapshot.playerId,
        type: type as "factory" | "blacksmith",
        tile: i,
        remainingTicks: 100,
        age: snapshot.age,
      })),
    ];
    expect(productionBootstrap(snapshot, core).buildings.size).toBe(0);
    const siege = {
      units: { siege: 2 },
      equipment: { "equipment:bronzeage-siege": 20 },
      materials: {},
    };
    expect(
      productionBootstrap(snapshot, siege).buildings.has("siege-workshop"),
    ).toBe(false);
    snapshot.invasion = { target: 1, squads: 10 };
    expect(
      productionBootstrap(snapshot, siege).buildings.has("siege-workshop"),
    ).toBe(true);
  });

  it.each(AGES.slice(0, -1))(
    "keeps a viable funded %s age transition selectable",
    (age) => {
      const { choices } = fixture(age);
      const advance = choices().find((c) => c.kind === "advance");
      expect(advance).toBeDefined();
      expect(advance!.score).toBeGreaterThan(0);
    },
  );
  it.each(AGES.slice(0, -1))(
    "keeps useful unfinished %s research selectable",
    (age) => {
      const { state, snapshot, choices } = fixture(age);
      const technology = TECHNOLOGIES.find(
        (t) => t.age === age && t.tree === "economic" && t.slot === 4,
      )!;
      state.completed = state.completed.filter((id) => id !== technology.id);
      snapshot.research = state.completed;
      const research = choices().find(
        (c) =>
          c.command.type === "research" &&
          c.command.technologyId === technology.id,
      );
      expect(research).toBeDefined();
      expect(research!.score).toBeGreaterThan(0);
    },
  );
  it("lets a wealthy balanced AI pay for and complete the Bronze-to-Classical transition", () => {
    const { game, player, state, snapshot } = fixture("BronzeAge");
    player.personalityId = "balanced";
    game.options.aiEconomy = true;
    game.owners.fill(player.id);
    const template = game.squads[0];
    for (const squad of [...game.squads]) game.removeSquad(squad.id);
    game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: player.id,
      definitionId: "bronzeage-infantry",
      troops: 1000,
      embarkedOn: null,
      refit: null,
    });
    game.expansion!.supply.inventories[player.id] = {
      ...snapshot.liquid.items,
    };
    const capacity = vi.spyOn(game, "squadCapacity").mockReturnValue(1);
    const placements = vi
      .spyOn(game.expansion!.economy.placements, "candidates")
      .mockReturnValue([]);
    const refitting = vi
      .spyOn(game.expansion!.economy.military, "decide")
      .mockReturnValue(false);
    try {
      game.expansion!.economy.decide(player);
      expect(state.advancement?.target).toBe("ClassicalAge");
      expect(player.gold).toBe(1_000_000 - ADVANCES[1].gold);
      for (let i = 0; i < ADVANCES[1].ticks; i++)
        game.expansion!.progression.step(game.players);
      expect(state.age).toBe("ClassicalAge");
    } finally {
      capacity.mockRestore();
      placements.mockRestore();
      refitting.mockRestore();
    }
  });
  it("keeps a legal age-up selectable despite material shortages or danger, without bypassing payment or trees", () => {
    const { game, player, state, snapshot, choices } = fixture("BronzeAge");
    player.gold = ADVANCES[1].gold - 1;
    expect(advanceRejection(state, player.gold)).toBe("Needs 1 more gold");
    expect(game.expansion!.progression.advance(player)).toBe(
      "Needs 1 more gold",
    );
    expect(state.advancement).toBeNull();
    snapshot.liquid.items = {};
    expect(choices().some((c) => c.kind === "advance")).toBe(true);
    snapshot.liquid.items = {
      ...UNITS.find((u) => u.id === "classicalage-infantry")!.cost.items,
    };
    snapshot.threatTroops = snapshot.readyTroops;
    expect(choices().some((c) => c.kind === "advance")).toBe(true);
    snapshot.threatTroops = 0;
    state.completed = state.completed.filter(
      (id) => !TECHNOLOGIES.some((t) => t.id === id && t.age === "BronzeAge"),
    );
    expect(choices().some((c) => c.kind === "advance")).toBe(false);
  });
  it("ages up despite an inconclusive bounded equipment query", () => {
    const { game, player, state } = fixture("BronzeAge");
    game.options.aiEconomy = true;
    game.expansion!.supply.inventories[player.id] = {};
    const query = vi
      .spyOn(AiProductionDependencies.prototype, "availability")
      .mockImplementation(function (this: AiProductionDependencies) {
        this.deferred = true;
        return "deferred";
      });
    try {
      game.expansion!.economy.decide(player);
      expect(query).toHaveBeenCalled();
      expect(state.advancement?.target).toBe("ClassicalAge");
    } finally {
      query.mockRestore();
    }
  });
  it("starts the race at two completed trees, retains it across advancement and restore, and ignores one tree", () => {
    const state = startingProgression();
    const finish = (tree: string) =>
      state.completed.push(
        ...TECHNOLOGIES.filter(
          (t) => t.age === "StoneAge" && t.tree === tree,
        ).map((t) => t.id),
      );
    finish("naval");
    expect(progressionRaceStarted({ 1: state }, "StoneAge")).toBe(false);
    finish("economic");
    expect(progressionRaceStarted({ 1: state }, "StoneAge")).toBe(true);
    state.age = "BronzeAge";
    expect(
      progressionRaceStarted(structuredClone({ 1: state }), "StoneAge"),
    ).toBe(true);
    expect(progressionRaceStarted({ 1: state }, "BronzeAge")).toBe(false);
  });
  it("races toward two trees even with a small army and useful economic expansion available", () => {
    const { snapshot } = fixture("StoneAge"),
      state = startingProgression();
    snapshot.research = state.completed;
    snapshot.readyTroops = 1000;
    snapshot.liquid.gold = 200;
    const choices = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} },
      1,
      [
        {
          type: "factory",
          tile: 0,
          objective: 9000,
          reason: "capacity:factory",
        },
      ],
      {
        resources: [],
        usableCoast: false,
        seaThreat: 0,
        goods: 0,
        protectedItems: {},
        progressionRace: true,
      },
    );
    expect(choices[0].kind).toBe("research");
    expect(choices[0].reason).toContain("progression-race:");
    expect(choices[0].priority).toBe("committed");
  });
  it("funds a first core-chain producer before racing, including its prerequisite research", () => {
    const { snapshot } = fixture("StoneAge"),
      state = startingProgression();
    snapshot.research = state.completed;
    snapshot.readyTroops = 1000;
    const choices = economicCandidates(
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} },
      1,
      [
        {
          type: "factory",
          tile: 0,
          objective: 9000,
          reason: "production-prerequisite:factory",
          bottleneck: "bootstrap",
        },
      ],
      {
        resources: [],
        usableCoast: false,
        seaThreat: 0,
        goods: 0,
        protectedItems: {},
        progressionRace: true,
      },
    );
    expect(choices[0].reason).toBe("prerequisite:production-prerequisite:factory");
    expect(choices[0].bottleneck).toBe("bootstrap");
    expect(choices.some((c) => c.reason.includes("progression-race:"))).toBe(
      true,
    );
  });
});


describe("AI naval research demand", () => {
  const demand = { units: {}, equipment: {}, materials: {} };
  it("values peaceful fleet development and its prerequisites without waiting for an enemy navy", () => {
    const { snapshot } = fixture("BronzeAge");
    const vessel = VESSELS.find(v => v.age === "BronzeAge" && v.kind === "warship")!;
    const technology = TECHNOLOGIES.find(t => t.id === vessel.technologyId)!;
    snapshot.research = snapshot.research.filter(id => id !== technology.id);
    const opportunity = { resources: [], usableCoast: true, seaThreat: 0, goods: 0, protectedItems: {} };
    const baseline = researchUtility(technology, snapshot, demand, opportunity);
    const needed = researchUtility(technology, snapshot, demand, { ...opportunity, navalDemand: 3 });
    expect(needed.benefit - baseline.benefit).toBe(8000);
    expect(needed.reason).toContain("fleet-development");
    const parent = TECHNOLOGIES.find(t => technology.prerequisites.includes(t.id) && t.tree === "naval")!;
    expect(parent).toBeDefined();
    snapshot.research = snapshot.research.filter(id => id !== parent.id);
    expect(researchUtility(parent, snapshot, demand, { ...opportunity, navalDemand: 3 }).benefit -
      researchUtility(parent, snapshot, demand, opportunity).benefit).toBe(8000);
  });
  it("does not grant fleet demand utility without usable coastal access", () => {
    const { snapshot } = fixture("BronzeAge");
    const vessel = VESSELS.find(v => v.age === "BronzeAge" && v.kind === "warship")!;
    const technology = TECHNOLOGIES.find(t => t.id === vessel.technologyId)!;
    snapshot.research = snapshot.research.filter(id => id !== technology.id);
    const opportunity = { resources: [], usableCoast: false, seaThreat: 0, goods: 0, protectedItems: {} };
    expect(researchUtility(technology, snapshot, demand, { ...opportunity, navalDemand: 3 })).toEqual(
      researchUtility(technology, snapshot, demand, opportunity));
  });
});
