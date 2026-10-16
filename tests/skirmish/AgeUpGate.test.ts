// Balance row "Age-up gate" (05 issue 3 / rec 2; 13 R8(1)). A nation needs all
// three current-age trees, or two of them with warfare at most
// ADVANCE_WARFARE_SHORTFALL technologies short. Tribes keep "any two trees".
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AI_PERSONALITIES } from "../../src/skirmish/content/AiPersonalities";
import { TECHNOLOGIES, treeWorkload } from "../../src/skirmish/content/Technology";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { AGES, type Age, type ProgressionState } from "../../src/skirmish/domain/Definitions";
import {
  ADVANCE_WARFARE_SHORTFALL,
  advanceRejection,
  NATION_ADVANCE_TREES_MESSAGE,
  startingProgression,
} from "../../src/skirmish/domain/Progression";
import { Skirmish } from "../../src/skirmish/Simulation";
import { advanceStatusText } from "../../src/skirmish/client/ProgressionText";
import english from "../../resources/lang/en.json";

const AGE: Age = "BronzeAge";
const mandatory = (tree: string) =>
  TECHNOLOGIES.filter(t => t.age === AGE && t.tree === tree && !t.optional).sort((a, b) => a.slot - b.slot);
function bronze(warfare: number, trees: readonly string[] = ["economic", "naval"]): ProgressionState {
  const state = startingProgression("BronzeAge");
  const keep = new Set([
    ...TECHNOLOGIES.filter(t => AGES.indexOf(t.age) < AGES.indexOf(AGE)).map(t => t.id),
    ...trees.flatMap(tree => mandatory(tree).map(t => t.id)),
    ...mandatory("warfare").slice(0, warfare).map(t => t.id),
  ]);
  state.completed = [...keep];
  return state;
}

describe("age-up gate", () => {
  const W = treeWorkload(AGE, "warfare");
  it("rejects a nation with two non-warfare trees and no warfare", () => {
    expect(advanceRejection(bronze(0), 1e9)).toBe(NATION_ADVANCE_TREES_MESSAGE);
  });
  it("rejects a nation one technology further short than the allowance", () => {
    expect(advanceRejection(bronze(W - ADVANCE_WARFARE_SHORTFALL - 1), 1e9)).toBe(NATION_ADVANCE_TREES_MESSAGE);
  });
  it("accepts two trees with warfare at its workload minus the allowance", () => {
    expect(ADVANCE_WARFARE_SHORTFALL).toBe(1);
    expect(advanceRejection(bronze(W - ADVANCE_WARFARE_SHORTFALL), 1e9)).toBeNull();
  });
  it("accepts warfare as one of the two complete trees, and all three trees", () => {
    expect(advanceRejection(bronze(W, ["economic"]), 1e9)).toBeNull();
    expect(advanceRejection(bronze(W), 1e9)).toBeNull();
  });
  it("keeps any two trees for tribes", () => {
    expect(advanceRejection(bronze(0), 1e9, 1, undefined, "tribe")).toBeNull();
    expect(advanceRejection(bronze(0, ["economic"]), 1e9, 1, undefined, "tribe")).toMatch(/any two/);
  });
  it("applies the nation rule to an advance-age command and leaves state unchanged", () => {
    const terrain = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
      seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", startingAge: "BronzeAge",
    });
    const player = game.players[0], progression = game.expansion!.progression;
    Object.assign(progression.states[player.id], bronze(0));
    player.gold = 1e9;
    const before = JSON.stringify(progression.states[player.id]);
    expect(game.applyCommand({ type: "advance-age", playerId: player.id })).toBe(NATION_ADVANCE_TREES_MESSAGE);
    expect(JSON.stringify(progression.states[player.id])).toBe(before);
    expect(player.gold).toBe(1e9);
    progression.states[player.id].completed.push(...mandatory("warfare").slice(0, W - 1).map(t => t.id));
    expect(game.applyCommand({ type: "advance-age", playerId: player.id })).toBeNull();
  });
  it("shows the gate and the ready state through translated text", () => {
    expect(advanceStatusText(NATION_ADVANCE_TREES_MESSAGE)).toBe(english.skirmish_progression.advance_needs_warfare);
    expect(advanceStatusText(null)).toBe(english.skirmish_progression.advance_ready);
    expect(advanceStatusText("Needs 5 more gold")).toBe("Needs 5 more gold");
  });
  it("makes a racing AI research warfare when its two complete trees exclude it", () => {
    const terrain = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
      seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
    });
    const player = game.players[1], state = bronze(0);
    state.age = AGE;
    const snapshot = economicSnapshot({
      player, tick: 0, generation: 0, age: AGE, research: state.completed,
      inventory: {}, buildings: game.buildings, squads: game.squads,
      ships: [], jobs: [], production: {}, cap: 0, threatTroops: 0,
    });
    snapshot.readyTroops = 1000;
    const candidates = economicCandidates(snapshot, state, AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} }, 1, [],
      { resources: [], usableCoast: false, seaThreat: 0, goods: 0, protectedItems: {}, progressionRace: true });
    expect(candidates.some(c => c.kind === "advance")).toBe(false);
    expect(candidates.some(c => c.kind === "research" && c.reason.startsWith("research:warfare:progression-race:"))).toBe(true);
  });
});
