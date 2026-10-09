import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  hotkeyAction,
  sortieCommand,
} from "../../src/skirmish/client/Controls";
import {
  flightPercent,
  flightReachable,
  flightTicks,
} from "../../src/skirmish/content/FlightOperations";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import type { Aircraft } from "../../src/skirmish/domain/Definitions";
function fixture() {
  const data = new Uint8Array(100 * 80).fill(133);
  const game = new Skirmish(new GameMapImpl(100, 80, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const e = game.expansion!;
  for (const player of game.players) {
    e.progression.states[player.id].age = "EarlyModern";
    e.progression.states[player.id].completed = TECHNOLOGIES.map((t) => t.id);
    player.gold = 1000000;
  }
  const planes = (kind: Aircraft["definitionId"], playerId = 1) => {
    const field = game.addBuilding({
      id: game.allocateId(),
      playerId,
      type: kind === "drone" ? "drone-facility" : "airstrip",
      age: "EarlyModern",
      tile: game.players[playerId - 1].base,
      health: 5000,
      maxHealth: 5000,
      remainingTicks: 0,
    });
    const a: Aircraft = {
      id: game.allocateId(),
      playerId,
      definitionId: kind,
      age: "EarlyModern",
      airfieldId: field.id,
      ...e.battle.position(field),
      health: 1000,
      state: "ready",
      target: null,
      reloadTick: 0,
      fuelTicks: flightTicks(kind, "EarlyModern"),
    };
    e.aircraft.push(a);
    return a;
  };
  return { game, e, planes };
}
describe("flight-time air operations", () => {
  it("uses fixed time by class/age and slower drones, with shared boundary quotes", () => {
    expect(flightTicks("fighter", "EarlyModern")).toBe(3600);
    expect(flightTicks("bomber", "EarlyModern")).toBe(2400);
    expect(flightTicks("fighter", "Modern")).toBe(4800);
    expect(flightTicks("bomber", "Modern")).toBe(3600);
    const a = { x: 0, y: 0, fuelTicks: 10, definitionId: "drone" as const };
    expect(flightReachable(a, 900, 0)).toBe(true);
    expect(flightReachable(a, 901, 0)).toBe(false);
    expect(flightPercent(a, 900, 0)).toBe(100);
  });
  it("rejects fighter bombing and unreachable dispatches without changing state", () => {
    const { game, planes } = fixture(),
      a = planes("fighter");
    a.fuelTicks = 1;
    expect(
      game.applyCommand({
        type: "sortie",
        playerId: 1,
        aircraftIds: [a.id],
        x: a.x,
        y: a.y,
      }),
    ).not.toBeNull();
    expect(
      game.applyCommand({
        type: "sortie",
        mission: "patrol",
        playerId: 1,
        aircraftIds: [a.id],
        x: a.x + 181,
        y: a.y,
      }),
    ).not.toBeNull();
    expect(a.state).toBe("ready");
    expect(a.fuelTicks).toBe(1);
  });
  it("patrols until its time expires, returns without fuel loss and refills at home", () => {
    const { game, e, planes } = fixture(),
      a = planes("fighter");
    const home = { x: a.x, y: a.y };
    expect(
      game.applyCommand({
        type: "sortie",
        mission: "patrol",
        playerId: 1,
        aircraftIds: [a.id],
        x: a.x + 170,
        y: a.y,
      }),
    ).toBeNull();
    game.tick++;
    e.afterMovement();
    expect(a.state).toBe("patrolling");
    a.fuelTicks = 0;
    a.x = home.x + 3 * FIXED;
    game.tick++;
    e.afterMovement();
    expect(a.state).toBe("returning");
    expect(a.health).toBe(1000);
    expect(a.fuelTicks).toBe(0);
    for (let i = 0; i < 8; i++) {
      game.tick++;
      e.afterMovement();
    }
    expect(a.state).toBe("ready");
    expect(a.fuelTicks).toBe(flightTicks("fighter", "Modern"));
  });
  it("keeps patrol orbits within the map at a boundary target", () => {
    const {game,e,planes} = fixture(), a = planes("fighter");
    a.state = "patrolling"; a.target = {x:1,y:1}; a.x=1;a.y=1;
    for(let i=0;i<200;i++) {
      game.tick++;e.afterMovement();
      expect(a.x).toBeGreaterThanOrEqual(1);expect(a.y).toBeGreaterThanOrEqual(1);
      expect(a.x).toBeLessThan(game.map.width()*FIXED);expect(a.y).toBeLessThan(game.map.height()*FIXED);
    }
  });
  it("requires atomic research/stock and consumes one bomb for each selected bomber atomically", () => {
    const { game, e, planes } = fixture(),
      a = planes("bomber"),
      b = planes("bomber");
    e.supply.inventories[1]["payload:atomic"] = 1;
    expect(
      game.applyCommand({
        type: "sortie",
        mission: "atomic",
        playerId: 1,
        aircraftIds: [a.id, b.id],
        x: a.x,
        y: a.y,
      }),
    ).not.toBeNull();
    expect(e.supply.inventories[1]["payload:atomic"]).toBe(1);
    expect(a.state).toBe("ready");
    expect(
      game.applyCommand({
        type: "sortie",
        mission: "atomic",
        playerId: 1,
        aircraftIds: [a.id],
        x: a.x,
        y: a.y,
      }),
    ).toBeNull();
    expect(e.supply.inventories[1]["payload:atomic"]).toBe(0);
    game.tick++;
    e.afterMovement();
    expect(a.state).toBe("returning");
    expect(
      e.battle.projectiles.find((p) => p.definitionId === "atomic")
        ?.blastRadius,
    ).toBe(16 * FIXED);
  });
  it("keeps drones immune to fighter and naval defence and consumes them on impact", () => {
    const { game, e, planes } = fixture(),
      drone = planes("drone"),
      fighter = planes("fighter", 2);
    fighter.state = "patrolling";
    fighter.target = { x: drone.x, y: drone.y };
    fighter.x = drone.x;
    fighter.y = drone.y;
    expect(
      game.applyCommand({
        type: "sortie",
        mission: "drone",
        playerId: 1,
        aircraftIds: [drone.id],
        x: drone.x + 2 * FIXED,
        y: drone.y,
      }),
    ).toBeNull();
    const ship = game.addShip({
      id: game.allocateId(),
      playerId: 2,
      kind: "warship",
      x: drone.x,
      y: drone.y,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
    });
    game.tick++;
    e.afterMovement();
    expect(drone.health).toBe(1000);
    expect(ship.airDefenseTick).toBeUndefined();
    for (let i = 0; i < 6; i++) {
      game.tick++;
      e.afterMovement();
    }
    expect(e.aircraft.some((a) => a.id === drone.id)).toBe(false);
    expect(
      e.battle.projectiles.some(
        (p) => p.sourceId === drone.id && p.damage === 10000,
      ),
    ).toBe(true);
  });
  it("fires naval rockets at hostile flying bombers and persists mission/AA state through snapshots", () => {
    const { game, e, planes } = fixture(),
      a = planes("bomber", 2);
    a.state = "outbound";
    a.target = { x: a.x + 20 * FIXED, y: a.y };
    const ship = game.addShip({
      id: game.allocateId(),
      playerId: 1,
      kind: "warship",
      x: a.x,
      y: a.y,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
    });
    game.tick++;
    e.afterMovement();
    expect(game.ship(ship.id)?.airDefenseTick).toBe(game.tick + 40);
    expect(e.battle.projectiles.some((p) => p.targetAircraftId === a.id)).toBe(
      true,
    );
    for (let i = 0; i < 10; i++) {
      game.tick++;
      e.afterMovement();
    }
    expect(a.health).toBe(800);
    const restored = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(game.snapshot()),
    );
    expect(restored.ships.find((s) => s.id === ship.id)?.airDefenseTick).toBe(
      game.ship(ship.id)?.airDefenseTick,
    );
    expect(
      restored.expansion?.aircraft.find((s) => s.id === a.id)?.fuelTicks,
    ).toBe(a.fuelTicks);
  });
  it("binds I/O/U independently and never includes selected fighters in a bombing command", () => {
    const { game, planes } = fixture(),
      fighter = planes("fighter"),
      bomber = planes("bomber");
    const snap = game.snapshot(),
      selected = new Set([fighter.id, bomber.id]);
    expect(
      sortieCommand(snap, 1, bomber.x, bomber.y, false, selected)?.aircraftIds,
    ).toEqual([bomber.id]);
    for (const [code, type] of [
      ["KeyI", "dispatch"],
      ["KeyO", "atomic-run"],
      ["KeyU", "drone-strike"],
    ])
      expect(
        hotkeyAction({
          code,
          repeat: false,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        })?.type,
      ).toBe(type);
  });
});
