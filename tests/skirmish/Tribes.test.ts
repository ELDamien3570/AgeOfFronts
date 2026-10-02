import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { squadCap, tribeCountFor } from "../../src/skirmish/FactionRules";
import { HomeTerritory } from "../../src/skirmish/HomeTerritory";
import type { MatchOptions } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  assignFactionColors,
  COLORS,
} from "../../src/skirmish/client/FactionColors";

function match(
  aiCount = 1,
  runAi = true,
  tribes = true,
  width = 240,
  humanNames?: string[],
  ruleset?: MatchOptions["ruleset"],
) {
  const terrain = new Uint8Array(width * 160).fill(133);
  return new Skirmish(new GameMapImpl(width, 160, terrain, terrain.length), {
    seed: 42,
    aiCount,
    runAi,
    tribes,
    humanNames,
    ruleset,
  });
}

describe("minor tribes", () => {
  it("adds map-sized tribes without moving regular camps or stealing starting land", () => {
    const baseline = match(3, false, false),
      game = match(3, false),
      tribes = game.players.filter((p) => p.kind === "tribe");
    expect(tribes).toHaveLength(20);
    expect(
      match(1, false).players.filter((p) => p.kind === "tribe"),
    ).toHaveLength(20);
    expect(
      [250, 500, 1000].map((width) => tribeCountFor(width, width / 2)),
    ).toEqual([20, 25, 30]);
    expect(
      game.players.filter((p) => p.kind === "regular").map((p) => p.base),
    ).toEqual(baseline.players.map((p) => p.base));
    for (const player of baseline.players)
      for (let tile = 0; tile < baseline.owners.length; tile++)
        if (baseline.owners[tile] === player.id)
          expect(game.owners[tile]).toBe(player.id);
    for (const tribe of tribes) {
      expect(game.squads.filter((s) => s.playerId === tribe.id)).toHaveLength(
        4,
      );
      expect(game.owners[tribe.base]).toBe(tribe.id);
      expect(squadCap(tribe)).toBe(10);
      expect(tribe.reserves).toBe(1500);
      expect(tribe.gold).toBe(150);
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

  it("supports twenty regular factions plus thirty tribes and supplies every owner a color", () => {
    // Six humans and the 14-AI cap, on a large map (30 tribes).
    const game = match(14, false, true, 1000, [
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    assignFactionColors(game.players);
    expect(game.players).toHaveLength(50);
    expect(game.squads).toHaveLength(200);
    expect(new Set(game.players.map((p) => COLORS[p.id])).size).toBe(50);
    expect(game.players.every((p) => /^#[0-9a-f]{6}$/.test(COLORS[p.id]))).toBe(
      true,
    );
  });

  it("starts with four, enforces the ten-squad cap including cargo, and rebuilds a casualty", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!,
      camp = game.buildings.find((b) => b.playerId === tribe.id)!;
    expect(tribe.reserves).toBe(1500);
    expect(tribe.gold).toBe(150);
    tribe.reserves = 10000;
    tribe.gold = 1000;
    const own = game.squads.filter((s) => s.playerId === tribe.id);
    expect(own).toHaveLength(4);
    for (let i = 0; i < 6; i++)
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
        .every((b) => b.type === "barracks" || b.type === "city"),
    ).toBe(true);
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "stables",
        tile: tribe.base,
      }),
    ).toContain("Tribes can only build 1 city and 1 extra barracks");
  });

  it("starts with 1500 reserves and 150 gold, limiting immediate recruitment to 1 squad", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!,
      camp = game.buildings.find((b) => b.playerId === tribe.id)!;
    expect(tribe.reserves).toBe(1500);
    expect(tribe.gold).toBe(150);
    expect(game.squads.filter((s) => s.playerId === tribe.id)).toHaveLength(4);
    expect(
      game.applyCommand({
        type: "recruit",
        playerId: tribe.id,
        buildingId: camp.id,
      }),
    ).toBeNull();
    expect(tribe.reserves).toBe(500);
    expect(tribe.gold).toBe(150);
    expect(
      game.applyCommand({
        type: "recruit",
        playerId: tribe.id,
        buildingId: camp.id,
      }),
    ).toContain("reserve troops");

    const ageGame = match(1, false, true, 240, undefined, "ages-v1");
    const ageTribe = ageGame.players.find((p) => p.kind === "tribe")!;
    const ageCamp = ageGame.buildings.find((b) => b.playerId === ageTribe.id)!;
    expect(ageTribe.reserves).toBe(1500);
    expect(ageTribe.gold).toBe(150);
    expect(
      ageGame.applyCommand({
        type: "recruit",
        playerId: ageTribe.id,
        buildingId: ageCamp.id,
      }),
    ).toBeNull();
    expect(ageTribe.reserves).toBe(500);
    expect(ageTribe.gold).toBe(50);
    expect(
      ageGame.applyCommand({
        type: "recruit",
        playerId: ageTribe.id,
        buildingId: ageCamp.id,
      }),
    ).toContain("Not enough gold");
  });

  it("allows tribes to build 1 city and 1 extra barracks and rejects additional or invalid buildings", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!;
    tribe.gold = 3000;
    const owned = Array.from(game.owners).flatMap((owner, tile) =>
      owner === tribe.id && game.map.euclideanDistSquared(tile, tribe.base) >= 9 ? [tile] : []
    );
    expect(owned.length).toBeGreaterThan(0);
    const cityTile = owned[0];
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "city",
        tile: cityTile,
      }),
    ).toBeNull();
    const nextTile = owned.find(
      (t) => game.map.euclideanDistSquared(t, cityTile) >= 9 && game.map.euclideanDistSquared(t, tribe.base) >= 9
    )!;
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "city",
        tile: nextTile,
      }),
    ).toContain("only build 1 city");
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "barracks",
        tile: nextTile,
      }),
    ).toBeNull();
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "barracks",
        tile: owned[owned.length - 1],
      }),
    ).toContain("only build 1 extra barracks");
    expect(
      game.applyCommand({
        type: "build",
        playerId: tribe.id,
        buildingType: "stables",
        tile: nextTile,
      }),
    ).toContain("Tribes can only build 1 city and 1 extra barracks");
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
