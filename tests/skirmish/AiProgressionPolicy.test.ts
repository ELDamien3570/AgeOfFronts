import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AI_PERSONALITIES } from "../../src/skirmish/content/AiPersonalities";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { advanceRejection } from "../../src/skirmish/domain/Progression";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(age: Age) {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const player = game.players[1], state = game.expansion!.progression.states[player.id];
  player.gold = 1_000_000;
  state.age = age;
  state.completed = TECHNOLOGIES.filter(t => AGES.indexOf(t.age) <= AGES.indexOf(age)).map(t => t.id);
  for (const b of game.buildings.filter(b => b.playerId === player.id))
    game.updateBuilding(b.id, { remainingTicks: 0, age });
  game.addBuilding({ id: game.allocateId(), playerId: player.id, type: "barracks", tile: player.base, remainingTicks: 0, age });
  const next = UNITS.find(u => u.age === AGES[AGES.indexOf(age) + 1] && u.line === "infantry")!;
  const snapshot = economicSnapshot({
    player, tick: 0, generation: 0, age, research: state.completed,
    inventory: { ...next.cost.items }, buildings: game.buildings, squads: game.squads,
    ships: [], jobs: [], production: {}, cap: game.squads.filter(s => s.playerId === player.id).length,
    threatTroops: 0,
  });
  snapshot.readyTroops = 1000;
  const opportunity = { resources: [], usableCoast: false, seaThreat: 0, goods: 0, protectedItems: {} };
  const choices = () => economicCandidates(snapshot, state, AI_PERSONALITIES[0], { units: {}, equipment: {}, materials: {} }, 1, [], opportunity);
  return { game, player, state, snapshot, choices };
}

describe("AI progression scoring", () => {
  it.each(AGES.slice(0, -1))("keeps a viable funded %s age transition selectable", age => {
    const { choices } = fixture(age);
    const advance = choices().find(c => c.kind === "advance");
    expect(advance).toBeDefined();
    expect(advance!.score).toBeGreaterThan(0);
  });
  it.each(AGES.slice(0, -1))("keeps useful unfinished %s research selectable", age => {
    const { state, snapshot, choices } = fixture(age);
    const technology = TECHNOLOGIES.find(t => t.age === age && t.tree === "economic" && t.slot === 4)!;
    state.completed = state.completed.filter(id => id !== technology.id);
    snapshot.research = state.completed;
    const research = choices().find(c => c.command.type === "research" && c.command.technologyId === technology.id);
    expect(research).toBeDefined();
    expect(research!.score).toBeGreaterThan(0);
  });
  it("lets a wealthy balanced AI pay for and complete the Bronze-to-Classical transition", () => {
    const { game, player, state, snapshot } = fixture("BronzeAge");
    player.personalityId = "balanced";
    game.options.aiEconomy = true;
    game.owners.fill(player.id);
    const template = game.squads[0];
    for (const squad of [...game.squads]) game.removeSquad(squad.id);
    game.addSquad({ ...template, id: game.allocateId(), playerId: player.id, definitionId: "bronzeage-infantry", troops: 1000, embarkedOn: null, refit: null });
    game.expansion!.supply.inventories[player.id] = { ...snapshot.liquid.items };
    const capacity = vi.spyOn(game, "squadCapacity").mockReturnValue(1);
    const placements = vi.spyOn(game.expansion!.economy.placements, "candidates").mockReturnValue([]);
    const refitting = vi.spyOn(game.expansion!.economy.military, "decide").mockReturnValue(false);
    try {
      game.expansion!.economy.decide(player);
      expect(state.advancement?.target).toBe("ClassicalAge");
      expect(player.gold).toBe(1_000_000 - ADVANCES[1].gold);
      for (let i = 0; i < ADVANCES[1].ticks; i++) game.expansion!.progression.step(game.players);
      expect(state.age).toBe("ClassicalAge");
    } finally {
      capacity.mockRestore(); placements.mockRestore(); refitting.mockRestore();
    }
  });
  it("does not bypass payment, production viability, tree prerequisites or immediate danger", () => {
    const { game, player, state, snapshot, choices } = fixture("BronzeAge");
    player.gold = ADVANCES[1].gold - 1;
    expect(advanceRejection(state, player.gold)).toBe("Needs 1 more gold");
    expect(game.expansion!.progression.advance(player)).toBe("Needs 1 more gold");
    expect(state.advancement).toBeNull();
    snapshot.liquid.items = {};
    expect(choices().some(c => c.kind === "advance")).toBe(false);
    snapshot.liquid.items = { ...UNITS.find(u => u.id === "classicalage-infantry")!.cost.items };
    snapshot.threatTroops = snapshot.readyTroops;
    expect(choices().some(c => c.kind === "advance")).toBe(false);
    snapshot.threatTroops = 0;
    state.completed = state.completed.filter(id => !id.startsWith("bronzeage-"));
    expect(choices().some(c => c.kind === "advance")).toBe(false);
  });
});
