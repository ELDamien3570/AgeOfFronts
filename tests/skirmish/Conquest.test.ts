import { claimBuildingFootprint } from "./BuildingFixtures";
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

function fixture(ruleset?: "ages-v1") {
  const terrain = new Uint8Array(160 * 100).fill(133);
  terrain.fill(0, 0, 160 * 8);
  const game = new Skirmish(new GameMapImpl(160, 100, terrain, terrain.length), {
    seed: 42,
    aiCount: 2,
    runAi: false,
    ruleset,
  });
  // Each case supplies the exact surviving buildings for its conquest scenario.
  if (ruleset) for (const b of game.buildings.slice()) game.removeBuilding(b.id);
  return game;
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
  it("deletes only an owned warship without changing territory or refunding gold", () => {
    const game = fixture("ages-v1");
    const own = game.addShip(emptyShip(game.allocateId(), 1, "warship", 1000));
    const enemy = game.addShip(emptyShip(game.allocateId(), 2, "warship", 1000));
    const transport = game.addShip(emptyShip(game.allocateId(), 1, "transport", 1000));
    const gold = game.player(1)!.gold, owners = game.owners.slice();
    expect(game.applyCommand({type:"delete-ship", playerId:1, shipId:enemy.id})).not.toBeNull();
    expect(game.applyCommand({type:"delete-ship", playerId:1, shipId:transport.id})).not.toBeNull();
    expect(game.applyCommand({type:"delete-ship", playerId:1, shipId:own.id})).toBeNull();
    expect(game.ship(own.id)).toBeUndefined();
    expect(game.ship(enemy.id)).toBeDefined();
    expect(game.ship(transport.id)).toBeDefined();
    expect(game.player(1)!.gold).toBe(gold);
    expect(game.owners).toEqual(owners);
  });
  it.each(["transport", "warship"] as const)(
    "conquers an AI's last city despite a surviving %s, including after restore",
    (kind) => {
      const original = fixture("ages-v1"), enemyId = 2;
      removeDefenders(original);
      original.addBuilding({id: original.allocateId(), playerId: enemyId, type: "city",
        tile: original.player(enemyId)!.base, remainingTicks: 0, health: 1000});
      const ship = original.addShip(emptyShip(original.allocateId(), enemyId, kind, SHIP_RULES[kind].health));
      place(original, ship, 20, 2);
      const game = fixture("ages-v1");
      game.restore(original.checkpoint());
      const enemy = game.player(enemyId)!;
      const old = game.owners.slice(), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
      decoder.decode(encoder.encode(game.snapshot()));

      occupy(game, enemy.base);

      expect(enemy.eliminated).toBe(true);
      expect(game.ship(ship.id)).toBeUndefined();
      expect(game.ships.some(s => s.playerId === enemyId)).toBe(false);
      expect(enemy.land).toBe(0);
      for (let tile = 0; tile < old.length; tile++)
        if (old[tile] === enemyId) expect(game.owners[tile]).toBe(1);
      expect(game.expansion!.events).toContainEqual(expect.objectContaining({kind: "conquest", actorId: 1, otherId: enemyId}));
      const replicated = decoder.decode(encoder.encode(game.snapshot()));
      expect(replicated.owners).toEqual(game.owners);
      expect(replicated.players.find(p => p.id === enemyId)!.eliminated).toBe(true);
      expect(replicated.ships.some(s => s.id === ship.id)).toBe(false);
    },
  );

  it("eliminates a human fleet after the last city is captured with no ground squads", () => {
    const game = fixture("ages-v1"), enemy = game.players[1];
    enemy.ai = false;
    removeDefenders(game);
    game.addBuilding({id:game.allocateId(),playerId:enemy.id,type:"city",tile:enemy.base,
      remainingTicks:0,health:1200});
    const ship = game.addShip(emptyShip(game.allocateId(), enemy.id, "warship", SHIP_RULES.warship.health));
    place(game, ship, 20, 2);
    occupy(game, enemy.base);
    expect(game.buildings.some(b => b.playerId === enemy.id)).toBe(false);
    expect(enemy.eliminated).toBe(true);
    expect(game.ship(ship.id)).toBeUndefined();
  });

  it("removes surviving AI aircraft when its final city is conquered", () => {
    const game = fixture("ages-v1"), enemy = game.players[1];
    removeDefenders(game);
    game.addBuilding({id:game.allocateId(),playerId:enemy.id,type:"city",tile:enemy.base,
      remainingTicks:0,health:1200});
    const airstrip = game.addBuilding({id: game.allocateId(), playerId: enemy.id, type: "airstrip",
      tile: enemy.base, age: "Modern", remainingTicks: 0, health: 2000});
    game.expansion!.aircraft.push({id: game.allocateId(), playerId: enemy.id,
      definitionId: "fighter", airfieldId: airstrip.id, x: game.map.x(enemy.base) * FIXED,
      y: game.map.y(enemy.base) * FIXED, health: 1000, target: null,
      state: "ready", reloadTick: 0, fuelTicks: 1000});
    occupy(game, enemy.base);
    expect(enemy.eliminated).toBe(true);
    expect(game.expansion!.aircraft.some(a => a.playerId === enemy.id)).toBe(false);
  });

  it.each(["regular", "tribe"] as const)("settles conquest and victory after the last %s AI squads die, despite its warship", (kind) => {
    const game = fixture("ages-v1"), enemy = game.players[1];
    enemy.kind = kind;
    const ship = game.addShip(emptyShip(game.allocateId(), enemy.id, "warship", SHIP_RULES.warship.health));
    place(game, ship, 20, 2);
    const victims = game.squads.filter(s => s.playerId !== 1), damage = new DamageLedger();
    for (const squad of victims) damage.add(squad.id, 1, squad.troops);
    game.resolveLandDamage(damage);
    game.step();
    expect(enemy.eliminated).toBe(true);
    expect(game.ship(ship.id)).toBeUndefined();
    expect(game.owners.includes(enemy.id)).toBe(false);
    expect(game.winner).toBe(1);
    expect(game.expansion!.winners).toEqual([1]);
  });

  it("requires every completed building, then transfers all remnants and snapshot deltas to the final captor", () => {
    const game = fixture(),
      enemy = game.players[1],
      base = enemy.base,
      city = game.map.ref(game.map.x(base) - 6, game.map.y(base));
    claimBuildingFootprint(game,city,"city",2);
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

  it.each([undefined, "ages-v1"] as const)("counts embarked survivors and credits their transport's killer (%s)", (ruleset) => {
    const game = fixture(ruleset),
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
