import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { infrastructureCapacity } from "../../src/skirmish/domain/AiInfrastructureCapacity";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import {
  preferredRecruitmentUnit,
  recruitmentTierAllowed,
} from "../../src/skirmish/domain/AiRecruitmentPolicy";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";

function fixture(age: Age = "ClassicalAge") {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const player = game.players[1];
  player.gold = 100000;
  player.reserves = 10000;
  const research = TECHNOLOGIES.filter(
    (t) => AGES.indexOf(t.age) <= AGES.indexOf(age),
  ).map((t) => t.id);
  const state = game.expansion!.progression.states[player.id];
  state.age = age;
  state.completed = research;
  const snapshot = economicSnapshot({
    player,
    age,
    research,
    tick: 0,
    generation: 0,
    inventory: { stone: 1000 },
    buildings: [
      {
        id: 900,
        playerId: player.id,
        type: "barracks",
        tile: player.base,
        age: "StoneAge",
        remainingTicks: 0,
      },
    ],
    squads: [],
    ships: [],
    jobs: [],
    production: {},
    cap: 20,
    threatTroops: 0,
  });
  snapshot.readyTroops = 1000;
  return { game, player, state, snapshot };
}

describe("AI intended equipment and obsolete recruitment", () => {
  it("asks for researched equipment before its workshop or raw resources exist", () => {
    const { player, snapshot } = fixture();
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(preferredRecruitmentUnit(snapshot, "frontline")?.age).toBe(
      "ClassicalAge",
    );
    expect(demand.equipment["equipment:classicalage"]).toBeGreaterThan(0);
    expect(demand.bottlenecks?.length).toBeGreaterThan(0);
  });

  it("keeps replacement equipment reserves with no recruitment headroom", () => {
    const { player, snapshot } = fixture();
    snapshot.headroom = 0;
    const demand = militaryDemand(
      snapshot,
      personalityOf(player),
      new Set(["ironOre"]),
    );
    expect(demand.equipment["equipment:classicalage"]).toBeGreaterThan(0);
    const losses = militaryDemand(
      snapshot,
      personalityOf(player),
      new Set(["ironOre"]),
      8,
    );
    expect(losses.equipment["equipment:classicalage"]).toBeGreaterThan(
      demand.equipment["equipment:classicalage"],
    );
  });

  it("preserves bootstrap without multiplying workshops for explicitly unavailable inputs", () => {
    const { snapshot } = fixture();
    const demand = {
      units: {},
      equipment: { "equipment:classicalage": 1000 },
      materials: {},
      bottlenecks: [
        { item: "equipment:classicalage", reason: "resource" as const },
      ],
    };
    expect(
      infrastructureCapacity(snapshot, demand).workshops.get("blacksmith"),
    ).toBe(1);
    demand.bottlenecks = [];
    expect(
      infrastructureCapacity(snapshot, demand).workshops.get("blacksmith"),
    ).toBeGreaterThan(1);
  });

  it("waits for equipment instead of recruiting severely obsolete troops in a safe economy", () => {
    const { player, state, snapshot } = fixture();
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(
      economicCandidates(
        snapshot,
        state,
        personalityOf(player),
        demand,
        1,
        [],
      ).some((c) => c.kind === "recruit"),
    ).toBe(false);
    // Some danger alone does not turn an equipment shortage into desperation.
    snapshot.threatTroops = snapshot.readyTroops;
    expect(
      recruitmentTierAllowed(snapshot, UNIT.get("stoneage-infantry")!),
    ).toBe(false);
  });

  it("allows affordable obsolete defenders when the observed force is overwhelming", () => {
    const { player, state, snapshot } = fixture();
    snapshot.threatTroops = 2000;
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    const recruits = economicCandidates(
      snapshot,
      state,
      personalityOf(player),
      demand,
      1,
      [],
    ).filter((c) => c.command.type === "recruit");
    expect(recruits.length).toBeGreaterThan(0);
    expect(recruits[0].priority).toBe("emergency");
  });

  it("applies the same obsolescence policy to later tiers and permits a nearby fallback", () => {
    const { snapshot } = fixture("EarlyMedieval");
    expect(
      recruitmentTierAllowed(snapshot, UNIT.get("bronzeage-infantry")!),
    ).toBe(false);
    expect(
      recruitmentTierAllowed(snapshot, UNIT.get("classicalage-infantry")!),
    ).toBe(true);
  });

  it("funds current equipment refining while finished older equipment is still stockpiled", () => {
    const { player, snapshot } = fixture();
    snapshot.liquid.items = { ironOre: 1000, "equipment:bronzeage": 100 };
    snapshot.buildings = [
      {
        id: 901,
        playerId: player.id,
        type: "blacksmith",
        tile: player.base,
        age: "ClassicalAge",
        remainingTicks: 0,
      },
      {
        id: 902,
        playerId: player.id,
        type: "factory",
        tile: player.base + 10,
        age: "ClassicalAge",
        remainingTicks: 0,
      },
    ];
    const demand = militaryDemand(
      snapshot,
      personalityOf(player),
      new Set(["ironOre"]),
    );
    const jobs = automaticProduction({
      buildings: snapshot.buildings,
      research: snapshot.research,
      inventory: snapshot.liquid.items,
      incoming: {},
      recipes: PRODUCTION_RECIPES,
      plans: new Map(),
      busy: new Set(),
      renewable: new Set(["ironOre"]),
      squadCount: 10,
      ai: true,
      aiDemand: demand,
    });
    expect(jobs.get(902)).toBe("refine-iron");
    expect(jobs.get(901)).not.toBe("make-bronzeage-equipment");
  });
});
