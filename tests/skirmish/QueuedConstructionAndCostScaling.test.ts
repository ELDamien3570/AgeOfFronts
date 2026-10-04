import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  buildingCost,
  buildingCostMultiplier,
  buildingTicks,
} from "../../src/skirmish/content/Buildings";
import { Skirmish } from "../../src/skirmish/Simulation";
import { BUILDING_RULES } from "../../src/skirmish/Rules";

function createMatch() {
  const width = 64;
  const height = 64;
  const data = new Uint8Array(width * height).fill(133); // all land
  const match = new Skirmish(
    new GameMapImpl(width, height, data, data.length),
    { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
  );
  // Claim territory for player 1
  for (let i = 0; i < match.owners.length; i++) {
    match.owners[i] = 1;
  }
  const player1 = match.player(1)!;
  player1.gold = 50000;
  return { match, player1 };
}

describe("building cost scaling", () => {
  it("computes cost multiplier scaling from 1.0x to 4.0x capped at 10 buildings", () => {
    expect(buildingCostMultiplier(0)).toBeCloseTo(1.0);
    expect(buildingCostMultiplier(1)).toBeCloseTo(1.3);
    expect(buildingCostMultiplier(2)).toBeCloseTo(1.6);
    expect(buildingCostMultiplier(5)).toBeCloseTo(2.5);
    expect(buildingCostMultiplier(9)).toBeCloseTo(3.7);
    expect(buildingCostMultiplier(10)).toBeCloseTo(4.0);
    expect(buildingCostMultiplier(15)).toBeCloseTo(4.0);
    expect(buildingCostMultiplier(-1)).toBeCloseTo(1.0);
  });

  it("scales buildingCost gold and item amounts with multiplier", () => {
    const baseCost = BUILDING_RULES.barracks.cost;
    expect(buildingCost("barracks", "StoneAge", 0).gold).toBe(baseCost);
    expect(buildingCost("barracks", "StoneAge", 1).gold).toBe(
      Math.round(baseCost * 1.3),
    );
    expect(buildingCost("barracks", "StoneAge", 10).gold).toBe(baseCost * 4);
    expect(buildingCost("barracks", "StoneAge", 15).gold).toBe(baseCost * 4);
  });
});

describe("building construction duration scaling", () => {
  it("scales buildingTicks with the same multiplier as cost", () => {
    const baseTicks = BUILDING_RULES.barracks.ticks;
    expect(buildingTicks("barracks", 0)).toBe(baseTicks);
    expect(buildingTicks("barracks", 1)).toBe(Math.round(baseTicks * 1.3));
    expect(buildingTicks("barracks", 2)).toBe(Math.round(baseTicks * 1.6));
    expect(buildingTicks("barracks", 10)).toBe(baseTicks * 4);
    expect(buildingTicks("barracks", 15)).toBe(baseTicks * 4);
  });
});

describe("tile stacking limit", () => {
  it("allows up to 15 buildings stacked on one tile and rejects the 16th", () => {
    const { match } = createMatch();
    const tile = match.map.ref(10, 10);
    for (let i = 0; i < 15; i++) {
      const rejection = match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "barracks",
        tile,
      });
      expect(rejection).toBeNull();
    }
    expect(match.buildings.filter((b) => b.tile === tile)).toHaveLength(15);
    const rejection16 = match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile,
    });
    expect(rejection16).toBe(
      "A single site can support at most 15 stacked buildings",
    );
  });
});

describe("queued construction for stacked buildings", () => {
  it("queues construction sequentially on the same tile while different tiles build concurrently", () => {
    const { match } = createMatch();
    const tileA = match.map.ref(10, 10);
    const tileB = match.map.ref(20, 20);

    // Place 2 barracks on tile A
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tileA,
    });
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tileA,
    });

    // Place 1 barracks on tile B
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tileB,
    });

    const [bA1, bA2] = match.buildings.filter((b) => b.tile === tileA);
    const [bB1] = match.buildings.filter((b) => b.tile === tileB);

    const ticksA1 = buildingTicks("barracks", 0);
    const ticksA2 = buildingTicks("barracks", 1);
    const ticksB1 = buildingTicks("barracks", 2);

    expect(bA1.remainingTicks).toBe(ticksA1);
    expect(bA2.remainingTicks).toBe(ticksA2);
    expect(bB1.remainingTicks).toBe(ticksB1);

    // Step 20 ticks
    for (let i = 0; i < 20; i++) match.step();

    // bA1 and bB1 should have decremented by 20; bA2 must remain at ticksA2!
    expect(bA1.remainingTicks).toBe(ticksA1 - 20);
    expect(bA2.remainingTicks).toBe(ticksA2);
    expect(bB1.remainingTicks).toBe(ticksB1 - 20);

    // Step until bA1 finishes
    for (let i = 0; i < ticksA1 - 20; i++) match.step();

    expect(bA1.remainingTicks).toBe(0);
    expect(bB1.remainingTicks).toBe(ticksB1 - ticksA1);
    expect(bA2.remainingTicks).toBe(ticksA2);

    // Next tick: bA1 is finished, so bA2 starts ticking down!
    match.step();
    expect(bA1.remainingTicks).toBe(0);
    expect(bA2.remainingTicks).toBe(ticksA2 - 1);
  });

  it("scales gold cost with each additional building placed", () => {
    const { match, player1 } = createMatch();
    const initialGold = 50000;
    player1.gold = initialGold;

    const baseCost = BUILDING_RULES.barracks.cost;

    // First barracks: 0 existing -> cost = 1.0x
    const tile1 = match.map.ref(10, 10);
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tile1,
    });
    const cost1 = initialGold - player1.gold;
    expect(cost1).toBe(baseCost);

    // Second barracks: 1 existing -> cost = 1.3x
    const goldBefore2 = player1.gold;
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tile1,
    });
    const cost2 = goldBefore2 - player1.gold;
    expect(cost2).toBe(Math.round(baseCost * 1.3));

    // Third barracks: 2 existing -> cost = 1.6x
    const goldBefore3 = player1.gold;
    match.applyCommand({
      type: "build",
      playerId: 1,
      buildingType: "barracks",
      tile: tile1,
    });
    const cost3 = goldBefore3 - player1.gold;
    expect(cost3).toBe(Math.round(baseCost * 1.6));
  });
});
