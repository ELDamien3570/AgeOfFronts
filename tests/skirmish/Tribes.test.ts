import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { squadCap, tribeCountFor } from "../../src/skirmish/FactionRules";
import { HomeTerritory } from "../../src/skirmish/HomeTerritory";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { COLORS } from "../../src/skirmish/client/FactionColors";

function match(aiCount = 1, runAi = true, tribes = true, width = 240) {
  const terrain = new Uint8Array(width * 160).fill(133);
  return new Skirmish(new GameMapImpl(width, 160, terrain, terrain.length), {
    seed: 42,
    aiCount,
    runAi,
    tribes,
  });
}

describe("minor tribes", () => {
  it("adds map-sized tribes without moving regular camps or stealing starting land", () => {
    const baseline = match(3, false, false),
      game = match(3, false),
      tribes = game.players.filter((p) => p.kind === "tribe");
    expect(tribes).toHaveLength(10);
    expect(
      match(1, false).players.filter((p) => p.kind === "tribe"),
    ).toHaveLength(10);
    expect(
      [250, 500, 1000].map((width) => tribeCountFor(width, width / 2)),
    ).toEqual([10, 20, 40]);
    expect(
      game.players.filter((p) => p.kind === "regular").map((p) => p.base),
    ).toEqual(baseline.players.map((p) => p.base));
    for (const player of baseline.players)
      for (let tile = 0; tile < baseline.owners.length; tile++)
        if (baseline.owners[tile] === player.id)
          expect(game.owners[tile]).toBe(player.id);
    for (const tribe of tribes) {
      expect(game.squads.filter((s) => s.playerId === tribe.id)).toHaveLength(
        5,
      );
      expect(game.owners[tribe.base]).toBe(tribe.id);
      expect(squadCap(tribe)).toBe(10);
    }
    expect(squadCap(game.players[0])).toBe(200);
    expect(new Set(game.players.map((p) => p.id)).size).toBe(
      game.players.length,
    );
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(game.snapshot()),
    );
    expect(decoded.players).toEqual(game.players);
  });

  it("supports twenty regular factions plus forty tribes and supplies every owner a color", () => {
    const game = match(19, false, true, 1000);
    expect(game.players).toHaveLength(60);
    expect(game.squads).toHaveLength(280);
    expect(new Set(game.players.map((p) => COLORS[p.id])).size).toBe(60);
    expect(game.players.every((p) => /^#[0-9a-f]{6}$/.test(COLORS[p.id]))).toBe(
      true,
    );
  });

  it("starts with five, enforces the ten-squad cap including cargo, and rebuilds a casualty", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!,
      camp = game.buildings.find((b) => b.playerId === tribe.id)!;
    const own = game.squads.filter((s) => s.playerId === tribe.id);
    for (let i = 0; i < 5; i++)
      expect(
        game.applyCommand({
          type: "recruit",
          playerId: tribe.id,
          buildingId: camp.id,
        }),
      ).toBeNull();
    own[0].embarkedOn = 999;
    expect(
      game.applyCommand({
        type: "recruit",
        playerId: tribe.id,
        buildingId: camp.id,
      }),
    ).toContain("10-squad limit");
    own[0].embarkedOn = null;
    game.squads.splice(game.squads.indexOf(own[0]), 1);
    tribe.losses += own[0].troops;
    for (let tick = 0; tick < 180; tick++) game.step();
    expect(game.squads.filter((s) => s.playerId === tribe.id)).toHaveLength(10);
    expect(
      game.buildings
        .filter((b) => b.playerId === tribe.id)
        .every((b) => b.type === "barracks"),
    ).toBe(true);
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "city",
        tile: tribe.base,
      }),
    ).toContain("Tribes defend");
  });

  it("keeps extending its home frontier beyond the former local limit", () => {
    const game = match(),
      tribes = game.players.filter((p) => p.kind === "tribe");
    for (let tick = 0; tick < 1200; tick++) game.step();
    expect(
      tribes.some((tribe) =>
        Array.from(game.owners).some(
          (owner, tile) =>
            owner === tribe.id &&
            game.map.euclideanDistSquared(tribe.base, tile) > 14 ** 2,
        ),
      ),
    ).toBe(true);
    for (const tribe of tribes)
      expect(
        game.squads.filter((s) => s.playerId === tribe.id).length,
      ).toBeLessThanOrEqual(10);
  });
});

describe("home consolidation", () => {
  it("repairs a nearby pocket before expanding and ignores disconnected outposts", () => {
    const terrain = new Uint8Array(80 * 50).fill(133),
      map = new GameMapImpl(80, 50, terrain, terrain.length),
      owners = new Uint8Array(terrain.length),
      base = map.ref(20, 20);
    for (let y = 14; y <= 26; y++)
      for (let x = 14; x <= 26; x++) owners[map.ref(x, y)] = 2;
    owners[map.ref(19, 20)] = 3;
    owners[map.ref(60, 35)] = 2;
    const home = new HomeTerritory(map),
      frontier = home.frontier(2, base, owners, 1),
      reserved = new Set<number>();
    expect(home.goal(2, base, base, owners, frontier, reserved)).toBe(
      map.ref(19, 20),
    );
    expect(
      frontier.every((tile) => map.euclideanDistSquared(base, tile) < 15 ** 2),
    ).toBe(true);
    expect(home.goal(2, base, base, owners, frontier, reserved)).not.toBe(
      map.ref(19, 20),
    );
    owners[map.ref(19, 20)] = 2;
    expect(home.frontier(2, base, owners, 61)).not.toContain(map.ref(19, 20));
  });

  it("grows regular AI land around its starting camp before launching distant raids", () => {
    const game = match(1, true, false),
      ai = game.players[1],
      initial = ai.land;
    for (let tick = 0; tick < 600; tick++) game.step();
    expect(ai.land).toBeGreaterThan(initial * 2);
    const owned = Array.from(game.owners).flatMap((owner, tile) =>
      owner === ai.id ? [tile] : [],
    );
    expect(
      owned.filter(
        (tile) => game.map.euclideanDistSquared(ai.base, tile) <= 22 ** 2,
      ).length / owned.length,
    ).toBeGreaterThan(0.9);
    expect(
      game.squads
        .filter((s) => s.playerId === ai.id)
        .every(
          (s) =>
            game.map.euclideanDistSquared(ai.base, game.tileOf(s)) < 30 ** 2,
        ),
    ).toBe(true);
  });
});
