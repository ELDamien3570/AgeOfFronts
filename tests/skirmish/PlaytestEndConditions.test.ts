import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import type { MatchOptions } from "../../src/skirmish/Protocol";
import { VICTORY_SCORE, victoryOutcome, victoryScore, type VictoryCandidate } from "../../src/skirmish/domain/Victory";
import { timeLimitTick } from "../../src/skirmish/domain/PlaytestRules";

const candidate = (id: number, kind: "regular" | "tribe", extra: Partial<VictoryCandidate> = {}): VictoryCandidate => ({
  id, kind, eliminated: false, land: 0, cities: 0, ageIndex: 0, technologies: 0, kills: 0, ...extra,
});

describe("playtest victory rules (13 R2)", () => {
  it("awards the last living regular faction although tribes survive", () => {
    const players = [candidate(1, "regular"), candidate(2, "regular", { eliminated: true }),
      candidate(3, "tribe"), candidate(4, "tribe"), candidate(5, "tribe")];
    expect(victoryOutcome(players, 10)).toEqual({ winner: 1, reason: "conquest" });
  });

  it("keeps two living regular factions playing before the limit", () => {
    const players = [candidate(1, "regular"), candidate(2, "regular"), candidate(3, "tribe")];
    expect(victoryOutcome(players, 99, 100)).toBeNull();
  });

  it("scores the living regular factions at the limit, ties to the lower id, ignoring tribes", () => {
    const players = [candidate(1, "regular", { land: 200 }), candidate(2, "regular", { cities: 2 }),
      candidate(3, "regular", { cities: 2 }), candidate(4, "tribe", { ageIndex: 5 }),
      candidate(5, "regular", { cities: 9, eliminated: true })];
    expect(victoryOutcome(players, 100, 100)).toEqual({ winner: 2, reason: "time-limit" });
    expect(victoryOutcome(players, 250, 100)).toEqual({ winner: 2, reason: "time-limit" });
  });

  it("is a draw at the limit when only tribes live", () => {
    const players = [candidate(1, "regular", { eliminated: true }), candidate(2, "tribe"), candidate(3, "tribe")];
    expect(victoryOutcome(players, 99, 100)).toBeNull();
    expect(victoryOutcome(players, 100, 100)).toEqual({ winner: 0, reason: "time-limit" });
  });

  it("never ends by time without a configured limit", () => {
    const players = [candidate(1, "regular"), candidate(2, "regular")];
    expect(victoryOutcome(players, Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("keeps historical draws and lone survivors", () => {
    expect(victoryOutcome([candidate(1, "regular", { eliminated: true })], 5)).toEqual({ winner: 0, reason: "extinction" });
    expect(victoryOutcome([candidate(1, "regular", { eliminated: true }), candidate(2, "tribe")], 5))
      .toEqual({ winner: 2, reason: "conquest" });
  });

  it("scores land, cities, age, technologies and kills with integer weights", () => {
    expect(VICTORY_SCORE).toEqual({ landPerPoint: 20, completedCity: 300, age: 1500, completedTechnology: 25, killsPerPoint: 4 });
    // floor(1234/20)=61, 3 cities=900, Bronze (1)=1500, 7 techs=175, floor(99/4)=24.
    expect(victoryScore(candidate(1, "regular", { land: 1234, cities: 3, ageIndex: 1, technologies: 7, kills: 99 }))).toBe(2660);
    expect(victoryScore(candidate(1, "regular", { land: 19, kills: undefined }))).toBe(0);
  });
});

function fixture(options: Partial<MatchOptions> = {}) {
  const width = 160, height = 100, terrain = new Uint8Array(width * height).fill(133);
  return new Skirmish(new GameMapImpl(width, height, terrain, terrain.length), {
    seed: 42, aiCount: 2, runAi: false, ruleset: "ages-v1", ...options,
  });
}

describe("playtest match end in the simulation", () => {
  it("ends at the time limit on the limit tick with a score winner", () => {
    const game = fixture({ timeLimitMinutes: 1 }), limit = timeLimitTick(game.options)!;
    expect(limit).toBe(480);
    // Player 3 owns the most land, so it holds the best score.
    for (let tile = 0; tile < 400; tile++) if (game.owners[tile] === 0) game.changeOwner(tile, 3);
    while (game.tick < limit - 1) game.step();
    expect(game.winner).toBeNull();
    expect(game.endReason).toBeNull();
    game.step();
    expect(game.tick).toBe(limit);
    expect(game.winner).toBe(3);
    expect(game.endReason).toBe("time-limit");
    expect(game.expansion!.winners).toEqual([3]);
    game.step();
    expect(game.tick).toBe(limit);
  });

  it("restores the end reason from a checkpoint", () => {
    const game = fixture({ timeLimitMinutes: 1 });
    while (game.winner === null) game.step();
    const copy = fixture({ timeLimitMinutes: 1 });
    copy.restore(game.checkpoint());
    expect(copy.winner).toBe(game.winner);
    expect(copy.endReason).toBe("time-limit");
  });

  it("does not let surviving tribes block a conquest", () => {
    const game = fixture({ aiCount: 1, tribes: true, tribeCount: 2 });
    expect(game.players.filter(p => p.kind === "tribe")).toHaveLength(2);
    for (const squad of game.squads.filter(s => s.playerId === 2)) game.removeSquad(squad.id);
    for (const building of game.buildings.filter(b => b.playerId === 2)) game.removeBuilding(building.id);
    game.step();
    expect(game.players[1].eliminated).toBe(true);
    expect(game.players.filter(p => p.kind === "tribe" && !p.eliminated)).toHaveLength(2);
    expect(game.winner).toBe(1);
    expect(game.endReason).toBe("conquest");
  });

  it("rejects malformed playtest options", () => {
    expect(() => fixture({ timeLimitMinutes: 0 })).toThrow("Invalid match time limit");
    expect(() => fixture({ startProtectionMinutes: 1.5 })).toThrow("Invalid start protection");
    expect(() => fixture({ aiDifficulty: "easy" as never })).toThrow("Invalid AI difficulty");
  });
});
