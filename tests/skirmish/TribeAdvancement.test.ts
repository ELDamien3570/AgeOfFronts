import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { squadCap, tradeActorCap } from "../../src/skirmish/FactionRules";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { tribeAdvanceRejection } from "../../src/skirmish/domain/TribeDevelopment";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { Progression, researchTerms } from "../../src/skirmish/domain/Progression";

function fixture() {
  const terrain = new Uint8Array(120 * 80).fill(133);
  const game = new Skirmish(new GameMapImpl(120, 80, terrain, terrain.length), {
    seed: 42, aiCount: 1, tribes: true, tribeCount: 1, runAi: false, ruleset: "ages-v1",
  });
  const tribe = game.players.find(p => p.kind === "tribe")!;
  const progression = game.expansion!.progression;
  return { game, tribe, progression, state: progression.states[tribe.id] };
}

describe("tribe catch-up progression", () => {
  it("unlocks at three of four survivors and remains a paid advancement",()=>{
    const {game,tribe,progression}=fixture();
    const regular=game.players.filter(p=>p.kind!=="tribe");
    const more=[{...regular[0],id:20},{...regular[0],id:21}];
    for(const p of more)progression.add(p.id,"StoneAge");
    const players=[...game.players,...more];
    for(const p of regular)progression.states[p.id].age="BronzeAge";
    expect(tribeAdvanceRejection(tribe,players,progression.states)).not.toBeNull();
    progression.states[20].age="BronzeAge";
    expect(tribeAdvanceRejection(tribe,players,progression.states)).toBeNull();
    progression.states[tribe.id].completed=TECHNOLOGIES.filter(t=>t.age==="StoneAge").map(t=>t.id);
    tribe.gold=2999;expect(progression.advance(tribe)).toBe("Needs 1 more gold");
    tribe.gold=3000;expect(progression.advance(tribe)).toBeNull();expect(tribe.gold).toBe(0);
    more[0].eliminated=true;
    expect(tribeAdvanceRejection(tribe,players,progression.states)).not.toBeNull();
  });
  it("the tribe AI starts an ordinary advancement when the gate opens", () => {
    const { game, tribe, progression, state } = fixture();
    tribe.gold = 100_000;
    state.completed = TECHNOLOGIES.filter(t => t.age === "StoneAge").map(t => t.id);
    game.options.runAi = true;
    game.tick = (tribe.id % 20) * 3;
    game.expansion!.beforeStep();
    expect(state.advancement).toBeNull();
    for (const player of game.players.filter(p => p.kind !== "tribe")) progression.states[player.id].age = "BronzeAge";
    game.tick += 60;
    game.expansion!.beforeStep();
    expect(state.advancement).toMatchObject({ target: "BronzeAge", remainingTicks: 700 });
  });
  it("rounds the 75% threshold up and ignores eliminated factions", () => {
    const { game, tribe, progression, state } = fixture();
    progression.states[1].age = "BronzeAge";
    expect(tribeAdvanceRejection(tribe, game.players, progression.states)).toContain("75%");
    game.players[1].eliminated = true;
    expect(tribeAdvanceRejection(tribe, game.players, progression.states)).toBeNull();
    state.age = "BronzeAge";
    expect(tribeAdvanceRejection(tribe, game.players, progression.states)).not.toBeNull();
    progression.states[1].age = "Modern";
    expect(tribeAdvanceRejection(tribe, game.players, progression.states)).toBeNull();
    game.players[0].eliminated = true;
    expect(tribeAdvanceRejection(tribe, game.players, progression.states)).not.toBeNull();
  });

  it("unlocks a paid job with two completed trees, then permits next-age research", () => {
    const { game, tribe, progression, state } = fixture();
    tribe.gold = 100_000;
    const command = { type: "advance-age" as const, playerId: tribe.id };
    expect(game.applyCommand(command)).toContain("75%");
    for (const player of game.players.filter(p => p.kind !== "tribe")) progression.states[player.id].age = "BronzeAge";
    expect(game.applyCommand(command)).toContain("two current-age trees");
    state.completed = TECHNOLOGIES.filter(t => t.age === "StoneAge" && t.tree !== "naval").map(t => t.id);
    tribe.gold = 2999;
    expect(game.applyCommand(command)).toBe("Needs 1 more gold");
    tribe.gold = 100_000;
    expect(game.applyCommand(command)).toBeNull();
    expect(tribe.gold).toBe(97_000);
    expect(state.age).toBe("StoneAge");
    expect(state.advancement?.remainingTicks).toBe(700);
    for (let i = 0; i < 700; i++) progression.step(game.players);
    expect(state.age).toBe("BronzeAge");
    const technology = TECHNOLOGIES.find(t => t.age === "BronzeAge" && t.tree === "warfare" && t.slot === 1)!;
    expect(game.applyCommand({ type: "research", playerId: tribe.id, technologyId: technology.id })).toBeNull();
  });

  it("scales tribe caps and preserves regular caps", () => {
    expect(AGES.map(age => squadCap({ kind: "tribe" }, age))).toEqual([10, 15, 20, 25, 30, 35, 40]);
    expect(AGES.map(age => tradeActorCap({ kind: "tribe" }, age))).toEqual([16, 18, 20, 22, 24, 26, 28]);
    expect(AGES.map(age => tradeActorCap({ kind: "regular" }, age))).toEqual(AGES.map(() => 48));
    expect(squadCap({ kind: "regular" }, "Modern")).toBe(200);
  });
});

describe("age-up pacing", () => {
  it("preserves gold discounts with 35 to 60 second advancement at every technology speed", () => {
    const original = [{ gold: 3000, ticks: 2000 }, { gold: 75000, ticks: 900 }, { gold: 110000, ticks: 1000 },
      { gold: 160000, ticks: 1100 }, { gold: 230000, ticks: 1200 }, { gold: 330000, ticks: 1300 }];
    for (const speed of [1, 2, 3] as const) for (let i = 0; i < ADVANCES.length; i++) {
      const progression = new Progression(speed);
      progression.add(1, AGES[i]);
      const state = progression.states[1];
      state.completed = TECHNOLOGIES.filter(t => AGES.indexOf(t.age) <= i).map(t => t.id);
      const { game } = fixture();
      const player = game.players[0];
      player.gold = 1_000_000;
      const terms = researchTerms(ADVANCES[i], speed);
      const factor = i === 0 ? 1 : 0.75;
      expect(terms).toEqual({ gold: Math.ceil(original[i].gold * factor / speed), ticks: Math.ceil((700 + i * 100) / speed) });
      expect(progression.advance(player)).toBeNull();
      expect(state.advancement?.totalTicks).toBe(terms.ticks);
      expect(player.gold).toBe(1_000_000 - terms.gold);
    }
  });
});
