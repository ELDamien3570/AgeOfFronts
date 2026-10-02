import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { distanceSquared } from "../../src/skirmish/SquadGeometry";

function create() {
  const match = new Skirmish(
    new GameMapImpl(96, 96, new Uint8Array(96 * 96).fill(133), 96 * 96),
    { seed: 42, aiCount: 1, runAi: false, tribes: false, ruleset: "ages-v1" },
  );
  const archer = match.squads.find((s) => s.playerId === 1)!;
  const enemy = match.squads.find((s) => s.playerId === 2)!;
  match.squads.splice(0, match.squads.length, archer, enemy);
  archer.kind = "archer";
  archer.definitionId = "stoneage-archer";
  enemy.x = enemy.y = 48 * FIXED;
  return { match, archer, enemy };
}

describe("exact ranged approach", () => {
  it("enters real firing range from every sampled angle instead of rounding to zero outside it", () => {
    for (let angle = 0; angle < 360; angle += 5) {
      const { match, archer, enemy } = create();
      archer.x = Math.round(
        (48 + 12 * Math.cos((angle * Math.PI) / 180)) * FIXED,
      );
      archer.y = Math.round(
        (48 + 12 * Math.sin((angle * Math.PI) / 180)) * FIXED,
      );
      expect(
        match.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [archer.id],
          order: { type: "attack", targetId: enemy.id },
        }),
      ).toBeNull();
      for (let tick = 0; tick < 150; tick++) {
        archer.troops = enemy.troops = 1000;
        match.step();
      }
      expect(archer.lastAttackTick, `angle ${angle}`).toBeGreaterThan(0);
      expect(distanceSquared(archer, enemy)).toBeLessThanOrEqual(
        match.unit(archer).attack.range ** 2,
      );
      expect(archer.moved).toBe(false);
    }
  });

  it("holds at legal outer range, resumes chasing a retreat, and obeys a replacement order", () => {
    const { match, archer, enemy } = create();
    const range = match.unit(archer).attack.range;
    archer.x = enemy.x - range;
    archer.y = enemy.y;
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [archer.id],
      order: { type: "attack", targetId: enemy.id },
    });
    const x = archer.x;
    match.step();
    expect(archer.x).toBe(x);
    expect(archer.moved).toBe(false);
    enemy.x += FIXED;
    match.step();
    expect(archer.x).toBeGreaterThan(x);
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [archer.id],
      order: { type: "hold" },
    });
    const held = [archer.x, archer.y];
    for (let i = 0; i < 25; i++) match.step();
    expect([archer.x, archer.y]).toEqual(held);
  });
});
