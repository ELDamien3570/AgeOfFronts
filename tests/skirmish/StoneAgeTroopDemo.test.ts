import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXED } from "../../src/skirmish/Protocol";
import {
  DEMO_FACTIONS,
  DEMO_TROOP_BY_ID,
  DEMO_TROOPS,
  demoTroopId,
} from "./browser/DemoTroops";
import { engageDemoArmies, stoneAgeDemo } from "./browser/StoneAgeDemoScenario";

describe("four-faction troop load demo", () => {
  it("uses materialized individual clips for every ready Stone and Classical troop", () => {
    for (const troop of DEMO_TROOPS) {
      const root = `Art/Cultures/Russians/Units/${troop.age}/${troop.name}/`;
      const manifest = JSON.parse(
        readFileSync(root + "animations.json", "utf8"),
      );
      expect(manifest.actorCount).toBe(1);
      for (const id of ["idle", "running", "attack", "death"]) {
        const clip = manifest.animations.find(
          (c: { id: string }) => c.id === id,
        );
        expect(clip).toBeTruthy();
        expect(existsSync(root + clip.file)).toBe(true);
        const fd = openSync(root + clip.file, "r"),
          header = Buffer.alloc(24);
        try {
          readSync(fd, header, 0, 24, 0);
        } finally {
          closeSync(fd);
        }
        expect(header.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(clip.frames).toHaveLength(clip.frameCount);
      }
    }
  });
  it("starts 100 squads per faction, balanced across eight types, with four separate deployments", () => {
    const game = stoneAgeDemo();
    expect(game.squads).toHaveLength(400);
    expect(new Set(game.squads.map((s) => `${s.x}:${s.y}`)).size).toBe(400);
    for (const playerId of DEMO_FACTIONS) {
      const army = game.squads.filter((s) => s.playerId === playerId);
      expect(army).toHaveLength(100);
      for (const troop of DEMO_TROOPS)
        expect([12, 13]).toContain(
          army.filter((s) => s.definitionId === demoTroopId(troop)).length,
        );
    }
    for (const troop of DEMO_TROOPS)
      expect(
        game.squads.filter((s) => s.definitionId === demoTroopId(troop)),
      ).toHaveLength(50);
    expect(
      game.squads.every(
        (s) => s.troops === 1000 && DEMO_TROOP_BY_ID.has(s.definitionId!),
      ),
    ).toBe(true);
    const horseArcher = game.squads.find(
      (s) => DEMO_TROOP_BY_ID.get(s.definitionId!)?.name === "HorseArcher",
    )!;
    expect(game.unit(horseArcher).attack.channel).toBe("ranged");
    expect(game.unit(horseArcher).tags).toContain("mounted");
    expect(game.unit(horseArcher).charge).toBeUndefined();
  });
  it("accepts a real cavalry charge and publishes its preparing state", () => {
    const game = stoneAgeDemo();
    const cavalry = game.squads.find(
      (s) => s.playerId === 1 && s.kind === "cavalry" && game.unit(s).charge,
    )!;
    const target = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(target.id, { x: cavalry.x + FIXED * 4, y: cavalry.y });
    expect(
      game.applyCommand({
        type: "charge",
        playerId: 1,
        squadIds: [cavalry.id],
        x: target.x,
        y: target.y,
        targetId: target.id,
      }),
    ).toBeNull();
    expect(
      game.snapshot().squads.find((s) => s.id === cavalry.id)!.charge,
    ).toBeTruthy();
  });
  it("runs a four-way battle through ordinary authoritative commands", () => {
    const game = stoneAgeDemo();
    engageDemoArmies(game);
    expect(game.squads.every((s) => s.order.type === "attack")).toBe(true);
    for (let tick = 0; tick < 400; tick++) game.step();
    expect(game.squads.reduce((sum, s) => sum + s.troops, 0)).toBeLessThan(
      400000,
    );
    expect(game.squads.length).toBeLessThanOrEqual(400);
    expect(
      game.snapshot().players.filter((p) => DEMO_FACTIONS.includes(p.id as 1))
        .length,
    ).toBe(4);
  }, 30000);
});
