import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ConquestCredit, DamageLedger } from "../../src/skirmish/Conquest";
import { FIXED, type Ship, type Squad } from "../../src/skirmish/Protocol";
import { SHIP_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fixture() {
  const terrain = new Uint8Array(160 * 100).fill(133);
  terrain.fill(0, 0, 160 * 8);
  return new Skirmish(new GameMapImpl(160, 100, terrain, terrain.length), {
    seed: 42,
    aiCount: 2,
    runAi: false,
  });
}
function place(world: Skirmish, unit: Pick<Squad, "id" | "x" | "y">, x: number, y: number) {
  const changes = { x: (x + 0.5) * FIXED, y: (y + 0.5) * FIXED };
  if (world.squad(unit.id)) world.updateSquad(unit.id, changes);
  else world.updateShip(unit.id, changes);
}
function removeDefenders(game: Skirmish, keep?: Squad) {
  for (let i = game.squads.length - 1; i >= 0; i--)
    if (game.squads[i].playerId === 2 && game.squads[i] !== keep)
      for (const record of game.squads.slice(i, (i) + (1))) game.removeSquad(record.id);
}
function occupy(game: Skirmish, tile: number, playerId = 1) {
  const attacker = game.squads.find(
    (s) => s.playerId === playerId && s.embarkedOn === null,
  )!;
  place(game, attacker, game.map.x(tile), game.map.y(tile));
  game.updateSquad(attacker.id, { order: { type: "hold" } });
  game.updateSquad(attacker.id, { path: [] });
  for (let tick = 0; tick < 32; tick++) game.step();
  expect(game.owners[tile]).toBe(playerId);
}
function emptyShip(
  id: number,
  playerId: number,
  kind: Ship["kind"],
  health: number,
): Ship {
  return {
    id,
    playerId,
    kind,
    health,
    x: 0,
    y: 0,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
  };
}

describe("complete conquest", () => {
  it("requires every completed building, then transfers all remnants and snapshot deltas to the final captor", () => {
    const game = fixture(),
      enemy = game.players[1],
      base = enemy.base,
      city = game.map.ref(game.map.x(base) - 5, game.map.y(base));
    expect(
      game.applyCommand({
        type: "build",
        playerId: 2,
        buildingType: "city",
        tile: city,
      }),
    ).toBeNull();
    expect(
      game.applyCommand({
        type: "build",
        playerId: 2,
        buildingType: "city",
        tile: city,
      }),
    ).toBeNull();
    for(const b of game.buildingsAt(city))game.updateBuilding(b.id,{remainingTicks:0});
    removeDefenders(game);
    occupy(game, base);
    expect(enemy.eliminated).toBe(false);
    expect(game.buildings.filter((b) => b.playerId === 2)).toHaveLength(2);
    const old = game.owners.slice(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.snapshot()));
    occupy(game, city);
    expect(enemy.eliminated).toBe(true);
    expect(enemy.land).toBe(0);
    expect(game.owners.includes(2)).toBe(false);
    for (let tile = 0; tile < old.length; tile++)
      if (old[tile] === 2) expect(game.owners[tile]).toBe(1);
    const decoded = decoder.decode(encoder.encode(game.snapshot()));
    expect(decoded.owners).toEqual(game.owners);
    expect(
      game.buildings
        .filter((b) => b.tile === city)
        .every((b) => b.playerId === 1),
    ).toBe(true);
  });

  it("keeps a buildingless faction alive, and awards remnants to the final squad's killer", () => {
    const game = fixture(),
      enemy = game.players[1],
      survivor = game.squads.find((s) => s.playerId === 2)!;
    removeDefenders(game, survivor);
    place(game, survivor, 75, 45);
    occupy(game, enemy.base);
    expect(game.buildings.some((b) => b.playerId === 2)).toBe(false);
    expect(enemy.eliminated).toBe(false);
    const old = game.owners.slice(),
      killer = game.squads.find((s) => s.playerId === 3)!;
    game.updateSquad(survivor.id, { troops: 1 });
    place(game, killer, 74, 45);
    game.step();
    expect(enemy.eliminated).toBe(true);
    for (let tile = 0; tile < old.length; tile++)
      if (old[tile] === 2) expect(game.owners[tile]).toBe(3);
    expect(game.owners.includes(2)).toBe(false);
  });

  it("counts embarked survivors and credits the warship that sinks their transport", () => {
    const game = fixture(),
      enemy = game.players[1],
      cargo = game.squads.find((s) => s.playerId === 2)!;
    removeDefenders(game, cargo);
    const transport = game.addShip(emptyShip(10001, 2, "transport", 1)),
      warship = game.addShip(emptyShip(10002, 3, "warship", SHIP_RULES.warship.health));
    place(game, transport, 75, 4);
    game.updateSquad(cargo.id, { embarkedOn: transport.id });
    place(game, cargo, 75, 4);

    occupy(game, enemy.base);
    expect(enemy.eliminated).toBe(false);
    const old = game.owners.slice();
    place(game, warship, 76, 4);

    game.step();
    expect(enemy.eliminated).toBe(true);
    expect(game.squads.some((s) => s.playerId === 2)).toBe(false);
    for (let tile = 0; tile < old.length; tile++)
      if (old[tile] === 2) expect(game.owners[tile]).toBe(3);
  });

  it("resolves simultaneous damage independently of attacker order and follows defeat chains safely", () => {
    const credit = new ConquestCredit(),
      damage = new DamageLedger();
    damage.add(9, 3, 4);
    damage.add(9, 1, 3);
    damage.add(9, 1, 3);
    credit.losses([{ id: 9, playerId: 2 }], damage);
    expect(credit.beneficiary(2, new Set([2]))).toBe(1);
    credit.capture(1, 3);
    expect(credit.beneficiary(2, new Set([1, 2]))).toBe(3);
    credit.capture(3, 2);
    expect(credit.beneficiary(2, new Set([1, 2, 3]))).toBe(0);
  });
});
