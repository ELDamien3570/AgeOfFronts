import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { squadCap } from "../../src/skirmish/FactionRules";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { AGES } from "../../src/skirmish/domain/Definitions";

describe("age-based squad capacity", () => {
  it("uses the authored caps and leaves tribes capped at ten", () => {
    expect(AGES.map((age) => squadCap({ kind: "regular" }, age))).toEqual([
      60, 80, 100, 120, 140, 160, 200,
    ]);
    expect(AGES.map((age) => squadCap({ kind: "tribe" }, age))).toEqual(
      AGES.map(() => 10),
    );
  });
  it("opens capacity on advancement in both domain commands and HUD quotes", () => {
    const data = new Uint8Array(100 * 100).fill(133);
    const game = new Skirmish(new GameMapImpl(100, 100, data, data.length), {
      seed: 42,
      aiCount: 1,
      runAi: false,
      ruleset: "ages-v1",
    });
    const player = game.players[0],
      template = game.squads.find((s) => s.playerId === player.id)!;
    game.squads.length = 0;
    for (let i = 0; i < 60; i++)
      game.squads.push({
        ...template,
        id: 10000 + i,
        embarkedOn: i < 4 ? 999 : null,
        queuedOrders: [],
        path: [],
      });
    player.reserves = 10000;
    const building = {
      id: game.allocateId(),
      playerId: player.id,
      type: "barracks" as const,
      tile: player.base,
      age: "StoneAge" as const,
      remainingTicks: 0,
    };
    game.buildings.push(building);
    const quote = () =>
      new SkirmishViewModel(game.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: null,
      });
    expect(quote().squadCapacity).toBe(60);
    expect(quote().recruitment("infantry").reason).toMatch(/limit/);
    expect(
      game.applyCommand({
        type: "recruit",
        playerId: player.id,
        buildingId: building.id,
        definitionId: "stoneage-infantry",
      }),
    ).toMatch(/60-squad limit/);
    game.expansion!.progression.states[player.id].age = "BronzeAge";
    expect(game.squadCapacity(player)).toBe(80);
    expect(quote().squadCapacity).toBe(80);
    expect(quote().recruitment("infantry").enabled).toBe(true);
  });
});
