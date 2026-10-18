import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { recruitmentVariant } from "../../src/skirmish/content/FormationRecipes";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import {
  campaignAdvantage,
  campaignDeploymentCapacity,
  campaignForce,
} from "../../src/skirmish/domain/AiCampaignPolicy";
import type { AiOperation } from "../../src/skirmish/domain/AiOperations";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { createFormation } from "../../src/skirmish/domain/FormationGeometry";
import {
  createManpower,
  scaledRecipeCost,
} from "../../src/skirmish/domain/Manpower";

function fixture(own = 20, enemy = 8, enemyDefinition = "stoneage-infantry") {
  const cells = new Uint8Array(128 * 128).fill(133),
    map = new GameMapImpl(128, 128, cells, cells.length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 2,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    aiWarPolicy: true,
    aiEconomy: true,
    deferredPlanning: true,
    diplomacyRules: "raids-v1",
    armyTravel: "corridors-v1",
    aiDifficulty: "hard",
  });
  const e = game.expansion!,
    ops = e.operations,
    actor = game.players[1],
    rival = game.players[2];
  game.players[0].eliminated = true;
  actor.base = map.ref(24, 40);
  rival.base = map.ref(72, 40);
  actor.personalityId = "balanced";
  actor.reserves = 2000;
  for (const p of game.players) {
    const age =
      p.id === actor.id ? "EarlyModern" : UNIT.get(enemyDefinition)!.age;
    e.progression.states[p.id].completed = TECHNOLOGIES.filter(
      (t) => AGES.indexOf(t.age) <= AGES.indexOf(age),
    ).map((t) => t.id);
    e.progression.states[p.id].age = age;
  }
  // Keep conquest targets aligned with the explicit fixture bases rather
  // than the generator's incidental starting positions on this map shape.
  for (const building of [...game.buildings]) {
    const owner = game.players.find((p) => p.id === building.playerId)!;
    if (owner.eliminated) game.removeBuilding(building.id);
    else if (building.type === "city")
      game.updateBuilding(building.id, { tile: owner.base });
  }
  const template = structuredClone(game.squads[0]);
  for (const squad of [...game.squads]) game.removeSquad(squad.id);
  function add(
    owner: number,
    count: number,
    definition = owner === actor.id ? "earlymodern-infantry" : enemyDefinition,
  ) {
    const unit = UNIT.get(definition)!,
      p = game.players.find((p) => p.id === owner)!;
    for (let i = 0; i < count; i++)
      game.addSquad({
        ...structuredClone(template),
        id: game.allocateId(),
        playerId: owner,
        kind: unit.line,
        definitionId: unit.id,
        troops: unit.formationRecipe!.capacity,
        manpower: createManpower(unit),
        formation: createFormation(unit.id),
        x: (map.x(p.base) + (i % 4)) * FIXED,
        y: (map.y(p.base) + Math.floor(i / 4)) * FIXED,
      });
  }
  add(actor.id, own);
  add(rival.id, enemy);
  vi.spyOn(game, "hasUnclaimedFrontier").mockReturnValue(true);
  vi.spyOn(e.economy.routes, "request").mockImplementation(
    (_key, _owner, start, goal) => ({ pending: false, path: [start, goal] }),
  );
  function think(seconds: number) {
    game.tick = secondsToTicks(seconds);
    ops.step(
      new Map(
        game.players.map((p) => [
          p.id,
          game.squadFacts().aliveByOwner(p.id).length,
        ]),
      ),
    );
  }
  function war(intent?: AiOperation["intent"]) {
    game.tick = secondsToTicks(60);
    expect(
      e.diplomacy.establishWar(actor.id, rival.id, game.tick, "invasion"),
    ).toBeNull();
    ops.restore({
      records: [
        [
          actor.id,
          {
            phase: "war",
            target: rival.id,
            since: game.tick,
            nextThink: 0,
            threats: [],
            cursor: 0,
            score: 0,
            intent,
          },
        ],
      ],
      revision: 1,
      territorialRevision: 0,
    });
  }
  return { game, e, ops, actor, rival, map, add, think, war };
}

describe("credible regular campaigns under actual raid diplomacy", () => {
  it("prepares and launches overwhelming upgraded troops despite available neutral land", () => {
    const f = fixture();
    expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeGreaterThan(2);
    f.think(60);
    f.think(64);
    expect(f.ops.state(f.actor.id)).toMatchObject({
      phase: "preparing",
      intent: { motive: "dominance" },
    });
    f.think(68);
    expect(f.ops.recruitmentObjective(f.actor.id)).toBeDefined();
    f.think(80);
    expect(f.ops.state(f.actor.id)?.phase).toBe("war");
    expect(f.e.diplomacy.declaredWar(f.actor.id, f.rival.id)).toBe(true);
  });
  it("does not treat researched age as deployable superiority against a much larger modern force", () => {
    const f = fixture(4, 4);
    f.add(f.rival.id, 24, "earlymodern-infantry");
    expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeLessThan(1);
    f.think(60);
    f.think(64);
    expect(f.ops.state(f.actor.id)?.phase).toBe("peace");
  });
  it("keeps actual advances beyond two minutes, then withdraws after real stalling", () => {
    const f = fixture();
    f.war();
    f.think(60);
    const squad = f.game.squadFacts().aliveByOwner(f.actor.id)[0];
    for (const seconds of [100, 140, 180, 220]) {
      f.game.updateSquad(squad.id, {
        x: f.game.squad(squad.id)!.x + 3 * FIXED,
      });
      f.think(seconds);
    }
    expect(f.ops.state(f.actor.id)?.phase).toBe("war");
    f.think(312);
    expect(f.ops.state(f.actor.id)?.phase).toBe("recovery");
  });
  it("does not count recruitment or healing as campaign progress", () => {
    const f = fixture();
    f.war();
    f.think(60);
    f.rival.base = f.actor.base;
    f.add(f.actor.id, 1); // New spawn near the goal cannot advance the initial force.
    f.think(100);
    expect(f.ops.state(f.actor.id)?.campaign?.progressAt).toBe(
      secondsToTicks(60),
    );
    f.think(152);
    expect(f.ops.state(f.actor.id)?.phase).toBe("recovery");
  });
  it("keeps structure attackers committed and rejects raw-count peace when quality is decisive", () => {
    const f = fixture();
    f.war();
    f.think(60);
    for (const s of f.game.squadFacts().aliveByOwner(f.actor.id))
      f.game.updateSquad(s.id, { structureTarget: { buildingId: 999 } });
    f.think(62);
    expect(f.ops.state(f.actor.id)?.phase).toBe("war");
    expect(f.ops.willingPeace(f.actor, f.rival)).toBe(false);
  });
  it("respects alliances and start/peace protection even with overwhelming strength", () => {
    const f = fixture();
    f.e.diplomacy.state.alliances.push({
      id: 1,
      a: f.actor.id,
      b: f.rival.id,
      expiresTick: secondsToTicks(600),
      renewal: [],
    });
    f.think(60);
    f.think(64);
    expect(f.ops.state(f.actor.id)?.phase).toBe("peace");
  });
  it("preserves fractional decay during unrelated repeated grievance events and caps storage", () => {
    const f = fixture();
    f.ops.rememberGrievance(f.actor.id, 10, "raid", 2);
    for (let second = 30; second <= 360; second += 30) {
      f.game.tick = secondsToTicks(second);
      f.ops.rememberGrievance(f.actor.id, 11, "raid");
    }
    expect(f.ops.grievance(f.actor.id, 10)).toBe(0);
    for (let id = 12; id < 20; id++)
      f.ops.rememberGrievance(f.actor.id, id, "territory");
    expect(f.ops.state(f.actor.id)?.grievances?.length).toBe(4);
    const saved = f.ops.checkpoint();
    f.ops.restore(saved);
    expect(f.ops.checkpoint()).toEqual(saved);
  });
  it.each(["latemedieval-infantry", "napoleonic-infantry"])(
    "presses a weaker %s neighbour with a substantial actual field force",
    (definition) => {
      const f = fixture(60, 4, definition);
      expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeGreaterThan(2);
      f.think(60);
      f.think(64);
      f.think(80);
      expect(f.ops.state(f.actor.id)?.phase).toBe("war");
    },
  );
  it("prepares a reachable specific scarce deposit, keeps contested ground, and seeks peace after securing support", () => {
    const f = fixture(),
      goal = f.map.ref(62, 44);
    f.e.supply.restore({
      ...f.e.supply.checkpoint(),
      deposits: [
        {
          id: 9999,
          tile: goal,
          resource: "ironOre",
          owner: f.rival.id,
          yieldPerSecond: 1,
        },
      ],
    });
    f.e.supply.resourceSites.update(f.e.supply.deposits, 999);
    vi.spyOn(f.e.economy, "resourcePressures").mockReturnValue([
      {
        resource: "ironOre",
        shortage: 100,
        blocked: true,
        sinceTick: 0,
        requiredPerSecond: 3,
        extractionPerSecond: 1,
        paidConsumptionPerSecond: 0,
        inputStarved: true,
      },
    ]);
    f.think(60);
    f.think(64);
    f.think(68);
    expect(f.ops.state(f.actor.id)?.intent).toMatchObject({
      motive: "resource",
      goal,
      resource: "ironOre",
      route: "ready",
    });
    expect(f.ops.recruitmentObjective(f.actor.id)).toBeDefined();
    f.think(80);
    expect(f.ops.resourceObjective(f.actor.id)).toBe(goal);
    f.game.owners[goal] = f.actor.id;
    expect(f.ops.willingPeace(f.actor, f.rival)).toBe(false); // Captured anchor lacks a supported local force.
    for (const s of f.game.squadFacts().aliveByOwner(f.actor.id))
      f.game.updateSquad(s.id, {
        x: f.map.x(goal) * FIXED,
        y: f.map.y(goal) * FIXED,
      });
    expect(f.ops.willingPeace(f.actor, f.rival)).toBe(true);
    f.think(84);
    expect(f.ops.state(f.actor.id)).toMatchObject({
      phase: "recovery",
      reason: "Resource objective secured; seeking settlement",
    });
  });
  it("wakes after refit quality changes without research or squad-count changes", () => {
    const f = fixture(12, 8);
    for (const s of f.game.squadFacts().aliveByOwner(f.actor.id))
      f.game.updateSquad(s.id, {
        definitionId: "stoneage-infantry",
        refit: {
          targetId: "earlymodern-infantry",
          remainingTicks: 2,
          totalTicks: 2,
        },
      });
    f.think(60);
    f.think(64);
    f.think(68);
    expect(f.ops.state(f.actor.id)?.readiness?.squads).toBe(0);
    expect(f.ops.state(f.actor.id)?.sleepKey).toBeDefined();
    f.think(72);
    expect(f.ops.workUsed).toBe(0);
    for (const s of f.game.squadFacts().aliveByOwner(f.actor.id))
      f.game.updateSquad(s.id, {
        definitionId: "earlymodern-infantry",
        refit: null,
        troops: 11,
        manpower: createManpower(UNIT.get("earlymodern-infantry")!),
      });
    f.think(84);
    expect(f.ops.workUsed).toBeGreaterThan(0);
    expect(f.ops.state(f.actor.id)?.readiness?.squads).toBe(12);
  });
  it("records actual attacks once per incident but ignores capture-pressure notifications", () => {
    const f = fixture();
    f.war();
    f.game.notifyHostileAction(f.actor.id, f.rival.id, f.actor.base);
    expect(f.ops.grievance(f.actor.id, f.rival.id)).toBe(0);
    f.game.notifyHostileAction(f.actor.id, f.rival.id, f.actor.base, true);
    f.game.notifyHostileAction(f.actor.id, f.rival.id, f.actor.base, true);
    expect(f.ops.grievance(f.actor.id, f.rival.id)).toBe(1);
  });
  it("restores regular preparation and deterministic continuation without hidden cache state", () => {
    const f = fixture();
    f.think(60);
    f.think(64);
    f.think(68);
    const saved = f.game.checkpoint();
    f.think(80);
    const expected = f.ops.checkpoint();
    f.game.restore(saved);
    f.think(80);
    expect(f.ops.checkpoint()).toEqual(expected);
    expect(f.ops.workUsed).toBeLessThanOrEqual(16);
  });
  it("gives no imaginary opening volley credit to an ongoing contact fight", () => {
    const f = fixture();
    const far = campaignAdvantage(f.e, f.actor, f.rival, true);
    for (const s of f.game.squadFacts().aliveByOwner(f.actor.id))
      f.game.updateSquad(s.id, { x: (f.rival.base % f.map.width()) * FIXED });
    expect(campaignAdvantage(f.e, f.actor, f.rival, true)).toBe(far);
  });
  it("funds a modestly advantaged preparation through legal paid recruitment before launching", () => {
    const f = fixture(40, 4, "latemedieval-infantry");
    expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeGreaterThan(0.9);
    expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeLessThan(1.25);
    expect(f.game.squadCapacity(f.actor)).toBeGreaterThan(44);
    f.think(60);
    f.think(64);
    f.think(68);
    expect(f.ops.state(f.actor.id)?.phase).toBe("preparing");
    expect(f.ops.recruitmentObjective(f.actor.id)!.squads).toBeGreaterThan(40);
    const unit = UNIT.get("earlymodern-infantry")!;
    for (let y = 10; y < 68; y++)
      for (let x = 8; x < 48; x++) f.game.owners[f.map.ref(x, y)] = f.actor.id;
    const building = f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: f.actor.id,
      type: unit.building,
      tile: f.map.ref(14, 20),
      age: "EarlyModern",
      remainingTicks: 0,
      health: 1200,
    });
    const cost = scaledRecipeCost(
      unit,
      recruitmentVariant(unit.id, f.e.progression.states[f.actor.id].completed),
    );
    f.actor.gold = 100000;
    f.e.supply.inventories[f.actor.id] = Object.fromEntries(
      Object.entries(cost.items ?? {}).map(([item, n]) => [item, n * 4]),
    );
    const beforeGold = f.actor.gold,
      beforeReserves = f.actor.reserves;
    for (let i = 0; i < 4; i++)
      expect(
        f.game.applyCommand({
          type: "recruit",
          playerId: f.actor.id,
          buildingId: building.id,
          definitionId: unit.id,
        }),
      ).toBeNull();
    expect(f.actor.gold).toBe(beforeGold - (cost.gold ?? 0) * 4);
    expect(f.actor.reserves).toBe(beforeReserves - (cost.reserves ?? 0) * 4);
    expect(
      Object.values(f.e.supply.inventories[f.actor.id]).every((n) => n === 0),
    ).toBe(true);
    for (
      let tick = 0;
      tick < 1200 && f.game.recruitment.byOwner(f.actor.id).length;
      tick++
    )
      f.game.step();
    expect(f.game.recruitment.byOwner(f.actor.id)).toHaveLength(0);
    expect(f.game.squadFacts().aliveByOwner(f.actor.id)).toHaveLength(44);
    expect(campaignAdvantage(f.e, f.actor, f.rival)).toBeGreaterThanOrEqual(
      1.25,
    );
    f.think(f.game.tick / 8 + 4);
    expect(f.ops.state(f.actor.id)?.phase).toBe("war");
  });
  it("withdraws a supported offensive when a material invasion reaches home", () => {
    const f = fixture();
    f.war();
    for (const s of f.game.squadFacts().aliveByOwner(f.rival.id)) {
      f.game.updateSquad(s.id, {
        x: f.map.x(f.actor.base) * FIXED,
        y: f.map.y(f.actor.base) * FIXED,
      });
    }
    f.game.owners[f.actor.base] = f.actor.id;
    f.game.notifyHostileAction(f.actor.id, f.rival.id, f.actor.base);
    f.think(60);
    expect(f.ops.state(f.actor.id)).toMatchObject({
      phase: "recovery",
      reason: "Home defense takes priority",
    });
  });
  it("reassesses an objective whose required field force exceeds legal capacity", () => {
    const f = fixture(4, 180, "earlymodern-infantry"),
      tick = secondsToTicks(60);
    f.ops.restore({
      records: [
        [
          f.actor.id,
          {
            phase: "preparing",
            target: f.rival.id,
            since: tick,
            nextThink: 0,
            threats: [],
            cursor: 0,
            score: 0,
            intent: {
              motive: "dominance",
              goal: f.rival.base,
              route: "pending",
              desiredSquads: 4,
              bestReady: 4,
              progressAt: tick,
            },
          },
        ],
      ],
      revision: 1,
      territorialRevision: 0,
    });
    f.think(60);
    expect(f.ops.state(f.actor.id)).toMatchObject({
      phase: "recovery",
      reason: expect.stringContaining("exceeds legal deployable capacity"),
    });
  });
  it("assesses and assembles more than one army through the existing detachment scheduler", () => {
    const f = fixture(80, 4, "latemedieval-infantry");
    expect(f.e.armies.capacity(f.actor.id)).toBe(50);
    expect(campaignForce(f.e, f.actor)).toHaveLength(60);
    f.war();
    f.think(60);
    const planner = f.e.economy.military.armyPlanner;
    for (
      let tick = 0;
      tick < 160 &&
      f.e.armies.armies.filter((a) => a.playerId === f.actor.id).length < 2;
      tick++
    ) {
      f.game.tick++;
      planner.step(128);
    }
    const armies = f.e.armies.armies.filter((a) => a.playerId === f.actor.id);
    expect(armies).toHaveLength(2);
    const members = armies.flatMap((a) => a.memberIds);
    expect(members.length).toBeGreaterThan(50);
    expect(new Set(members).size).toBe(members.length);
    expect(
      f.game.squadFacts().aliveByOwner(f.actor.id).length - members.length,
    ).toBeGreaterThanOrEqual(20);
    const saved = planner.checkpoint();
    for (const [, mission] of saved.missions)
      if (mission.purpose === "combat") delete mission.purpose;
    planner.restore(saved);
    expect(planner.nonOffensiveCommitment(f.actor.id)).toEqual({
      defenseSlots: 0,
      coastSlots: 0,
      defenseSquads: 0,
      coastSquads: 0,
    });
  });
  it("withholds planned defense and screen commitments from the shared deployment budget", () => {
    const f = fixture(80, 4, "latemedieval-infantry");
    vi.spyOn(f.ops, "theatres").mockReturnValue([
      {
        id: "defense",
        purpose: "defense",
        tile: f.actor.base,
        target: f.rival.id,
        priority: 3,
        desiredSquads: 20,
      },
      {
        id: "screen",
        purpose: "screen",
        tile: f.actor.base,
        target: f.rival.id,
        priority: 1,
        desiredSquads: 6,
      },
    ]);
    expect(campaignDeploymentCapacity(f.e, f.actor).maxSquads).toBe(50);
    expect(campaignForce(f.e, f.actor)).toHaveLength(34);
  });
});
