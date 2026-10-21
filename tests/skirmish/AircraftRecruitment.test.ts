import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { aircraftRecruitmentAge, flightTicks } from "../../src/skirmish/content/FlightOperations";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";

function fixture(modernBombers = false) {
  const pixels = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, pixels, pixels.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const expansion = game.expansion!;
  expansion.progression.states[1].age = "Modern";
  expansion.progression.states[1].completed = TECHNOLOGIES.map(t => t.id)
    .filter(id => modernBombers || id !== "rus-modern-bombers");
  game.players[0].gold = 1000000;
  const field = (age: "EarlyModern" | "Modern", x: number) => {
    const base = game.addBuilding({ id: game.allocateId(), playerId: 1, type: "airstrip",
      tile: 18 * 96 + x, age, remainingTicks: 0, health: 2000, maxHealth: 2000 });
    game.owners[base.tile] = 1;
    return base;
  };
  const quote = (id: number) => new EmpireViewModel(game.snapshot(), {
    selected: new Set(), selectedShips: new Set(), selectedBuilding: id,
    selectedBuildings: new Set([id]),
  }).aircraft("bomber");
  const recruit = (id: number, automatic = false) => game.applyCommand({
    type: "recruit-aircraft", playerId: 1, buildingId: id, definitionId: "bomber", autoRecruit: automatic,
  });
  const complete = (id: number) => {
    const job = game.recruitment.byProducer(id)[0]!;
    game.recruitment.updateJob(job.id, { remainingTicks: 1 });
    game.step();
    return expansion.aircraft.find(a => a.airfieldId === id)!;
  };
  return { game, expansion, field, quote, recruit, complete };
}

describe("aircraft recruitment across launch-site upgrades", () => {
  it("quotes the same aircraft era that mixed selected launch sites actually recruit", () => {
    const f = fixture(true), older = f.field("EarlyModern", 80), modern = f.field("Modern", 18);
    const source = f.game.squads.find(s => s.playerId === 1)!;
    // The closer modern site must not override the authoritative lower-id tie.
    f.game.updateSquad(source.id, { x: 18.5 * 256, y: 18.5 * 256 });
    const selection = {
      selected: new Set([source.id]), selectedShips: new Set<number>(),
      selectedBuilding: older.id, selectedBuildings: new Set([older.id, modern.id]),
    };
    const quote = () => new EmpireViewModel(f.game.snapshot(), selection).aircraft("bomber");
    for (const [base, age] of [[older, "EarlyModern"], [modern, "Modern"]] as const) {
      const q = quote();
      expect(q.reason).toBeNull();
      expect(q.building!.id).toBe(base.id);
      expect(q.age).toBe(age);
      expect(f.game.applyCommand({ type: "recruit-aircraft", playerId: 1,
        buildingId: q.building!.id, buildingIds: q.buildingIds, definitionId: "bomber" })).toBeNull();
      expect(f.game.recruitment.byProducer(base.id)).toHaveLength(1);
    }
    // Complete before the next world step automatically upgrades the older site.
    for (const [base, age] of [[older, "EarlyModern"], [modern, "Modern"]] as const) {
      expect(f.expansion.completeAircraft(f.game.recruitment.byProducer(base.id)[0]!)).toBe(true);
      expect(f.expansion.aircraft.find(a => a.airfieldId === base.id)!.age).toBe(age);
    }
  });

  it("retains pre-modern bomber recruitment after upgrading an airfield and keeps the researched aircraft era", () => {
    const f = fixture(), base = f.field("EarlyModern", 18);
    expect(f.quote(base.id).reason).toBeNull();
    f.game.updateBuilding(base.id, { age: "Modern" });
    expect(f.quote(base.id).reason).toBeNull();
    expect(f.quote(base.id).age).toBe("EarlyModern");
    expect(f.recruit(base.id)).toBeNull();
    const plane = f.complete(base.id);
    expect(plane.age).toBe("EarlyModern");
    expect(plane.fuelTicks).toBe(flightTicks("bomber", "Modern"));
  });
  it("completes a queued pre-modern bomber when its launch site upgrades during recruitment", () => {
    const f = fixture(), base = f.field("EarlyModern", 18);
    expect(f.recruit(base.id)).toBeNull();
    f.game.updateBuilding(base.id, { age: "Modern" });
    expect(f.complete(base.id).age).toBe("EarlyModern");
  });
  it("recruits modern bombers after their specialization and quotes older sites at their supported era", () => {
    const f = fixture(true), modern = f.field("Modern", 18), older = f.field("EarlyModern", 35);
    expect(f.quote(modern.id).age).toBe("Modern");
    expect(f.quote(older.id).age).toBe("EarlyModern");
    expect(f.recruit(modern.id)).toBeNull();
    expect(f.complete(modern.id).age).toBe("Modern");
  });
  it("rejects unresearched bombers in the HUD and authority without spending gold or queuing", () => {
    const f = fixture(), base = f.field("Modern", 18);
    f.expansion.progression.states[1].completed = f.expansion.progression.states[1].completed.filter(id => id !== "rus-earlymodern-bombers");
    const gold = f.game.players[0].gold;
    expect(f.quote(base.id).reason).toMatch(/Research/);
    expect(f.recruit(base.id)).toMatch(/researched aviation/);
    expect(f.game.players[0].gold).toBe(gold);
    expect(f.game.recruitment.jobs).toHaveLength(0);
  });
  it("uses the same fallback for automatic recruitment", () => {
    const f = fixture(), base = f.field("Modern", 18);
    expect(f.recruit(base.id, true)).toBeNull();
    expect(f.complete(base.id).age).toBe("EarlyModern");
  });
  it("does not unlock drones or aircraft at incompatible or obsolete facilities", () => {
    const has = () => true;
    expect(aircraftRecruitmentAge("drone", "EarlyModern", has)).toBeUndefined();
    expect(aircraftRecruitmentAge("drone", "Modern", () => false)).toBeUndefined();
    expect(aircraftRecruitmentAge("bomber", "LateMedieval", has)).toBeUndefined();
    expect(aircraftRecruitmentAge("fighter", "Modern", t => t === "rus-earlymodern-airfields")).toBe("EarlyModern");
  });
});
