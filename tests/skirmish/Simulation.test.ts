import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import {
  CAPTURE_TICKS,
  FIXED,
  SQUAD_TROOPS,
} from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { terrainSpeed } from "../../src/skirmish/Terrain";

function create(terrain = 133, ai = false, seed = 42): Skirmish {
  const data = new Uint8Array(64 * 40).fill(terrain);
  return new Skirmish(new GameMapImpl(64, 40, data, data.length), {
    seed,
    aiCount: 1,
    runAi: ai,
  });
}
function place(squad: Skirmish["squads"][number], x: number, y: number): void {
  squad.x = x * FIXED + FIXED / 2;
  squad.y = y * FIXED + FIXED / 2;
  squad.order = { type: "hold" };
  squad.path = [];
  squad.nextPathIndex = 0;
}
function step(match: Skirmish, count: number): void {
  for (let i = 0; i < count; i++) match.step();
}
function isolate(match: Skirmish): void {
  const a = match.squads.find((s) => s.playerId === 1)!;
  const b = match.squads.find((s) => s.playerId === 2)!;
  match.squads.splice(0, match.squads.length, a, b);
  place(a, 28, 20);
  place(b, 55, 10);
}

describe("land squad skirmish", () => {
  it("recruitment transfers exactly 1,000 troops from reserves", () => {
    const match = create(),
      player = match.players[0];
    const before = player.reserves;
    expect(
      match.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: match.buildings[0].id,
      }),
    ).toBeNull();
    expect(player.reserves).toBe(before - SQUAD_TROOPS);
    expect(match.squads.filter((s) => s.playerId === 1)).toHaveLength(5);
    expect(match.squads[match.squads.length - 1].troops).toBe(SQUAD_TROOPS);
  });

  it("rejects unauthorized and unreachable orders without partially moving a selection", () => {
    const match = create(),
      own = match.squads[0],
      enemy = match.squads.find((s) => s.playerId === 2)!;
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own.id, enemy.id],
        order: { type: "move", tile: 100 },
      }),
    ).toMatch(/own squads/);
    expect(own.order.type).toBe("hold");
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own.id],
        order: { type: "move", tile: -1 },
      }),
    ).toMatch(/passable/);
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [own.id],
        order: { type: "attack", targetId: own.id },
      }),
    ).toMatch(/enemy/);
  });

  it("captures only after sustained occupation and never deducts passive casualties", () => {
    const match = create();
    isolate(match);
    const squad = match.squads[0],
      tile = match.tileOf(squad);
    match.owners[tile] = 2;
    const troops = squad.troops;
    step(match, CAPTURE_TICKS - 1);
    expect(match.owners[tile]).toBe(2);
    expect(squad.troops).toBe(troops);
    match.step();
    expect(match.owners[tile]).toBe(1);
    expect(squad.troops).toBe(troops);
    expect(match.players[1].losses).toBe(0);
  });

  it("resets incomplete capture when a squad leaves, and contests capture under enemy occupation", () => {
    const match = create();
    isolate(match);
    const tile = match.tileOf(match.squads[0]);
    match.owners[tile] = 0;
    step(match, 12);
    expect(match.progress[tile]).toBe(12);
    place(match.squads[0], 10, 30);
    match.step();
    expect(match.progress[tile]).toBe(0);
    place(match.squads[0], 28, 20);
    place(match.squads[1], 32, 20);
    const contested = match.map.ref(30, 20);
    match.owners[contested] = 0;
    step(match, CAPTURE_TICKS + 5);
    expect(match.owners[contested]).toBe(0);
    expect(match.progress[contested]).toBe(0);
  });

  it("uses terrain and active defensive zones for speed, without damage", () => {
    const plains = create(133),
      hills = create(143),
      mountains = create(153);
    for (const match of [plains, hills, mountains]) {
      isolate(match);
      const squad = match.squads[0];
      place(squad, 20, 20);
      expect(
        match.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [squad.id],
          order: { type: "move", tile: match.map.ref(45, 20) },
        }),
      ).toBeNull();
      step(match, 40);
      expect(squad.troops).toBe(1_000);
    }
    expect(plains.squads[0].x).toBeGreaterThan(hills.squads[0].x);
    expect(hills.squads[0].x).toBeGreaterThan(mountains.squads[0].x);
    const squad = plains.squads[0],
      tile = plains.tileOf(squad);
    plains.owners[tile] = 2;
    plains.defenseZones.push({
      tile,
      playerId: 2,
      radius: 5,
      speedPercent: 50,
    });
    expect(plains.movementSpeed(squad)).toBe(
      terrainSpeed(plains.map, tile) / 2,
    );
    plains.step();
    expect(squad.troops).toBe(1_000);
  });

  it("routes around water and avoids disconnected islands", () => {
    const width = 12,
      height = 12,
      data = new Uint8Array(width * height).fill(133);
    for (let y = 0; y < 11; y++) data[y * width + 5] = 0;
    const map = new GameMapImpl(width, height, data, 133),
      paths = new LandPaths(map);
    const path = paths.find(map.ref(2, 2), map.ref(9, 2));
    expect(path).not.toBeNull();
    expect(path!.every((tile) => map.isLand(tile))).toBe(true);
    expect(path!.some((tile) => map.y(tile) === 11)).toBe(true);
    data[11 * width + 5] = 0;
    expect(
      new LandPaths(new GameMapImpl(width, height, data, 132)).find(
        map.ref(2, 2),
        map.ref(9, 2),
      ),
    ).toBeNull();
  });

  it("fights automatically and applies equal melee hits simultaneously", () => {
    const match = create();
    isolate(match);
    place(match.squads[0], 28, 20);
    place(match.squads[1], 29, 20);
    match.squads[0].troops = 1;
    match.squads[1].troops = 1;
    match.step();
    expect(match.squads).toHaveLength(0);
    expect(match.players.map((p) => p.losses)).toEqual([1, 1]);
    expect(match.combatTicks).toBe(1);
  });

  it("explicit attacks pursue a moving enemy and hold when the target disappears", () => {
    const match = create();
    isolate(match);
    const squad = match.squads[0],
      target = match.squads[1];
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [squad.id],
        order: { type: "attack", targetId: target.id },
      }),
    ).toBeNull();
    const start = squad.x;
    step(match, 20);
    expect(squad.x).toBeGreaterThan(start);
    match.squads.splice(match.squads.indexOf(target), 1);
    match.step();
    expect(squad.order.type).toBe("hold");
  });

  it("survives camp loss while squads remain, blocks recruitment from lost buildings, and ends after the final squad falls", () => {
    const match = create();
    const player = match.players[0];
    match.owners[player.base] = 2;
    match.updateBuilding((match.buildings[0]).id, { playerId: 2 });
    expect(
      match.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: match.buildings[0].id,
      }),
    ).toMatch(/friendly/);
    match.step();
    expect(player.eliminated).toBe(false);
    for (let i = match.squads.length - 1; i >= 0; i--)
      if (match.squads[i].playerId === 1) match.squads.splice(i, 1);
    match.owners[player.base] = 2;
    match.step();
    expect(player.eliminated).toBe(true);
    expect(match.winner).toBe(2);
  });

  it("preserves troop accounting and deterministic results through an AI battle", () => {
    const a = create(133, true, 12),
      b = create(133, true, 12);
    for (let i = 0; i < 1_000; i++) {
      if (i === 10) {
        for (const match of [a, b])
          match.applyCommand({
            type: "order",
            playerId: 1,
            squadIds: match.squads
              .filter((s) => s.playerId === 1)
              .map((s) => s.id),
            order: { type: "move", tile: match.players[1].base },
          });
      }
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.combatTicks).toBeGreaterThan(0);
    expect(a.players[1].land).not.toBe(113);
    const accounted =
      a.players.reduce((sum, p) => sum + p.reserves + p.losses, 0) +
      a.squads.reduce((sum, s) => sum + s.troops, 0);
    expect(accounted).toBe(24_000 + a.producedTroops);
  });

  it.each(["world", "fourislands", "thebox"])(
    "runs a seeded real-map AI match on %s",
    (id) => {
      const manifest = JSON.parse(
        fs.readFileSync(`resources/maps/${id}/manifest.json`, "utf8"),
      );
      const data = fs.readFileSync(`resources/maps/${id}/map16x.bin`);
      const stride = Math.ceil(
        Math.max(manifest.map16x.width, manifest.map16x.height) / 256,
      );
      const width = Math.ceil(manifest.map16x.width / stride),
        height = Math.ceil(manifest.map16x.height / stride);
      const terrain = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          terrain[y * width + x] =
            data[
              Math.min(
                manifest.map16x.height - 1,
                y * stride + Math.floor(stride / 2),
              ) *
                manifest.map16x.width +
                Math.min(
                  manifest.map16x.width - 1,
                  x * stride + Math.floor(stride / 2),
                )
            ];
      const match = new Skirmish(new GameMapImpl(width, height, terrain, 0), {
        seed: 42,
        aiCount: 3,
      });
      step(match, 2000);
      expect(match.squads.length).toBeGreaterThan(4);
      expect(
        match.squads.every((s) =>
          s.embarkedOn === null
            ? match.paths.walkable(match.tileOf(s))
            : match.waterPaths.walkable(match.tileOf(s)),
        ),
      ).toBe(true);
      expect(match.players.every((p) => p.reserves >= 0)).toBe(true);
      expect(match.players.every((p) => p.gold >= 0)).toBe(true);
      expect(match.buildings.length).toBeGreaterThan(4);
      expect(
        match.ships.every(
          (s) => match.waterPaths.walkable(match.tileOf(s)) && s.health > 0,
        ),
      ).toBe(true);
      expect(
        match.squads.every(
          (s) =>
            s.embarkedOn === null ||
            match.ships.some(
              (b) => b.id === s.embarkedOn && b.playerId === s.playerId,
            ),
        ),
      ).toBe(true);
      const accounted =
        match.players.reduce((sum, p) => sum + p.reserves + p.losses, 0) +
        match.squads.reduce((sum, s) => sum + s.troops, 0);
      expect(accounted).toBe(48_000 + match.producedTroops);
    },
  );
});
