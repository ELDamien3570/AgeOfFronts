import {CarrierAircraftPresentation} from '../../src/skirmish/client/CarrierAircraftPresentation';
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { AircraftGroundPresentation } from "../../src/skirmish/client/AircraftGroundPresentation";
import { AircraftPresentation } from "../../src/skirmish/client/AircraftPresentation";
import { Renderer } from "../../src/skirmish/client/Renderer";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { airfieldAircraftCount } from "../../src/skirmish/domain/AirfieldCapacity";
import type { Aircraft } from "../../src/skirmish/domain/Definitions";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";

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
  e.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
  game.players[0].gold = 1000000;
  const field = (x: number, playerId = 1) => {
    const b = game.addBuilding({
      id: game.allocateId(),
      playerId,
      type: "airstrip",
      age: "EarlyModern",
      tile: 20 * 100 + x,
      health: 5000,
      maxHealth: 5000,
      remainingTicks: 0,
    });
    game.owners[b.tile] = playerId;
    return b;
  };
  const source = field(15),
    destination = field(40);
  const plane = (base = source, kind: Aircraft["definitionId"] = "bomber") => {
    const a: Aircraft = {
      id: game.allocateId(),
      playerId: 1,
      definitionId: kind,
      age: "EarlyModern",
      airfieldId: base.id,
      ...e.battle.position(base),
      health: 1000,
      state: "ready",
      target: null,
      reloadTick: 0,
      fuelTicks: 2400,
    };
    e.aircraft.push(a);
    return a;
  };
  const transfer = (planes: Aircraft[], b = destination) =>
    game.applyCommand({
      type: "transfer-aircraft",
      playerId: 1,
      aircraftIds: planes.map((a) => a.id),
      buildingId: b.id,
    });
  const land = (a: Aircraft) => {
    for (let i = 0; i < 100 && a.health > 0 && a.state !== "ready"; i++)
      game.step();
  };
  return { game, e, field, source, destination, plane, transfer, land };
}

describe("airfield transfers", () => {
  it("flies selected mixed planes without bombing, preserves health, and becomes ready at the new field", () => {
    const f = fixture(),
      a = f.plane(),
      b = f.plane(f.source, "fighter");
    a.health = 700;
    const gold = f.game.players[0].gold;
    expect(f.transfer([a, b])).toBeNull();
    expect(a.state).toBe("transferring");
    expect(a.airfieldId).toBe(f.source.id);
    expect(airfieldAircraftCount(f.e.aircraft, f.source.id)).toBe(0);
    f.game.step();
    expect(a.x).toBeGreaterThan(f.e.battle.position(f.source).x);
    f.land(a);
    f.land(b);
    expect(a.state).toBe("ready");
    expect(a.airfieldId).toBe(f.destination.id);
    expect(a.transfer).toBeUndefined();
    expect(a.health).toBe(700);
    expect(f.game.players[0].gold).toBeGreaterThanOrEqual(gold);
    expect(f.destination.health).toBe(5000);
    expect(f.game.snapshot().expansion!.projectiles).toHaveLength(0);
  });

  it("reserves incoming capacity against both another transfer and recruitment", () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) f.plane(f.destination);
    const a = f.plane(),
      b = f.plane();
    expect(f.transfer([a])).toBeNull();
    expect(f.transfer([b])).toMatch(/parking/);
    expect(
      f.game.applyCommand({
        type: "recruit-aircraft",
        playerId: 1,
        buildingId: f.destination.id,
        definitionId: "bomber",
      }),
    ).toMatch(/capacity/);
    expect(b.state).toBe("ready");
  });

  it("rejects the whole selection when one plane cannot transfer, and validates network shape", () => {
    const f = fixture(),
      a = f.plane(),
      drone = f.plane(f.source, "drone");
    expect(f.transfer([a, drone])).not.toBeNull();
    expect(a.state).toBe("ready");
    expect(f.transfer([a], f.source)).not.toBeNull();
    a.fuelTicks = 1;
    expect(f.transfer([a])).not.toBeNull();
    expect(
      commandSchema.safeParse({
        type: "transfer-aircraft",
        playerId: 1,
        aircraftIds: [a.id],
        buildingId: f.destination.id,
      }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({
        type: "transfer-aircraft",
        playerId: 1,
        aircraftIds: [],
        buildingId: f.destination.id,
      }).success,
    ).toBe(false);
  });

  it("survives destruction of the source while the reserved destination survives", () => {
    const f = fixture(),
      a = f.plane();
    expect(f.transfer([a])).toBeNull();
    f.game.removeBuilding(f.source.id);
    f.land(a);
    expect(a.health).toBe(1000);
    expect(a.airfieldId).toBe(f.destination.id);
    expect(a.state).toBe("ready");
  });

  it("allows enemy fighters to intercept aircraft in transit", () => {
    const f = fixture(),
      a = f.plane(),
      enemyBase = f.field(70, 2),
      enemy = f.plane(enemyBase, "fighter");
    enemy.playerId = 2;
    enemy.state = "patrolling";
    enemy.x = a.x;
    enemy.y = a.y;
    enemy.target = { x: a.x, y: a.y };
    expect(f.transfer([a])).toBeNull();
    f.game.tick++;
    f.e.afterMovement();
    expect(a.health).toBe(800);
  });

  it("counts queued production and rejects foreign, unfinished, and dead fields", () => {
    const f = fixture(),
      a = f.plane();
    for (let i = 0; i < 5; i++) f.plane(f.destination);
    expect(
      f.game.applyCommand({
        type: "recruit-aircraft",
        playerId: 1,
        buildingId: f.destination.id,
        definitionId: "bomber",
      }),
    ).toBeNull();
    expect(f.transfer([a])).toMatch(/parking/);
    const foreign = f.field(60, 2);
    expect(f.transfer([a], foreign)).not.toBeNull();
    f.game.updateBuilding(f.destination.id, { remainingTicks: 1 });
    expect(f.transfer([a])).not.toBeNull();
    f.game.updateBuilding(f.destination.id, { remainingTicks: 0, health: 0 });
    expect(f.transfer([a])).not.toBeNull();
  });

  it("diverts to the nearest available owned airfield after destination capture, including at zero fuel", () => {
    const f = fixture(),
      a = f.plane(),
      alternate = f.field(30);
    expect(f.transfer([a])).toBeNull();
    for (let i = 0; i < 12; i++) f.game.step();
    f.game.updateBuilding(f.destination.id, { playerId: 2 });
    f.game.owners[f.destination.tile] = 2;
    a.fuelTicks = 0;
    f.game.step();
    expect(a.transfer?.destinationId).toBe(alternate.id);
    f.land(a);
    expect(a.state).toBe("ready");
    expect(a.airfieldId).toBe(alternate.id);
  });

  it("loses diverted aircraft when every surviving field is full", () => {
    const f = fixture(),
      a = f.plane();
    expect(f.transfer([a])).toBeNull();
    for (let i = 0; i < 6; i++) f.plane(f.source);
    f.game.removeBuilding(f.destination.id);
    f.game.step();
    expect(a.health).toBe(0);
  });

  it("loses the aircraft when every airfield is destroyed during the transfer", () => {
    const f = fixture(),
      a = f.plane();
    expect(f.transfer([a])).toBeNull();
    f.game.removeBuilding(f.source.id);
    f.game.removeBuilding(f.destination.id);
    f.game.step();
    expect(a.health).toBe(0);
  });

  it("reserves the last diversion berth for only one incoming plane", () => {
    const f = fixture(),
      a = f.plane(),
      b = f.plane(),
      alternate = f.field(30);
    expect(f.transfer([a, b])).toBeNull();
    for (let i = 0; i < 6; i++) f.plane(f.source);
    for (let i = 0; i < 5; i++) f.plane(alternate);
    f.game.removeBuilding(f.destination.id);
    f.game.step();
    expect(a.transfer?.destinationId).toBe(alternate.id);
    expect(a.health).toBe(1000);
    expect(b.health).toBe(0);
    expect(airfieldAircraftCount(f.e.aircraft, alternate.id)).toBe(6);
  });

  it("preserves an in-flight destination and reservation through packets and checkpoint continuation", () => {
    const f = fixture(),
      a = f.plane();
    f.transfer([a]);
    f.game.step();
    const packet = new SnapshotEncoder().encode(f.game.snapshot());
    const restoredSnapshot = new SnapshotDecoder().decode(
      structuredClone(packet),
    );
    expect(
      restoredSnapshot.expansion!.aircraft.find((p) => p.id === a.id)?.transfer,
    ).toEqual(a.transfer);
    const restored = fixture();
    restored.game.restore(f.game.checkpoint());
    for (let i = 0; i < 50; i++) {
      f.game.step();
      restored.game.step();
    }
    expect(restored.game.expansion!.aircraft).toEqual(f.e.aircraft);
  });
});

describe("airfield ground presentation", () => {
  it("shows six separate zoom-scaled berths without modifying simulation state, keeps slots stable, and resets", () => {
    const f = fixture();
    const planes = Array.from({ length: 6 }, () => f.plane());
    const ground = new AircraftGroundPresentation(),
      flight = new AircraftPresentation();
    const snapshot = f.game.snapshot(),
      before = structuredClone(snapshot.expansion!.aircraft);
    ground.update(snapshot);
    flight.update(snapshot);
    const poses = planes.map((a) =>
      ground.pose(a.id, flight.pose(a.id)!, 100, 1),
    );
    expect(new Set(poses.map((p) => `${p.x},${p.y}`)).size).toBe(6);
    expect(poses.every((p) => p.size === 30 && p.elevation === 0)).toBe(true);
    expect(snapshot.expansion!.aircraft).toEqual(before);
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      snapshot,
      aircraftPresentation: flight,
      carrierAircraft:new CarrierAircraftPresentation(),aircraftGround: ground,
      aircraftBlend: 1,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
    }) as Renderer;
    for (const a of planes) {
      const p = renderer.aircraftScreenPoint(a.id)!;
      expect(renderer.aircraftAt(p.x, p.y)).toBe(a.id);
    }
    snapshot.expansion!.aircraft.splice(0, 1);
    ground.update(snapshot);
    expect(
      ground.pose(planes[1].id, flight.pose(planes[1].id)!, 100, 1),
    ).toEqual(poses[1]);
    expect(
      ground.pose(planes[1].id, flight.pose(planes[1].id)!, 50, 1).size,
    ).toBe(15);
    ground.reset();
    expect(
      ground.pose(planes[1].id, flight.pose(planes[1].id)!, 100, 1).x,
    ).toBe(planes[1].x);
  });

  it("animates departure and arrives at the destination berth on a real transfer", () => {
    const f = fixture(),
      a = f.plane(),
      ground = new AircraftGroundPresentation(),
      flight = new AircraftPresentation();
    const update = () => {
      const snapshot = f.game.snapshot();
      ground.update(snapshot);
      flight.update(snapshot);
    };
    update();
    const parked = ground.pose(a.id, flight.pose(a.id)!, 100, 1);
    f.transfer([a]);
    update();
    const taxi = ground.pose(a.id, flight.pose(a.id)!, 100, 1);
    expect(taxi.x).toBe(parked.x);
    expect(taxi.elevation).toBe(0);
    for (let i = 0; i < 9; i++) {
      f.game.step();
      update();
    }
    const airborne = ground.pose(a.id, flight.pose(a.id)!, 100, 1);
    expect(airborne.elevation).toBeGreaterThan(0);
    f.land(a);
    update();
    for (let i = 0; i < 10; i++) {
      f.game.step();
      update();
    }
    const landed = ground.pose(a.id, flight.pose(a.id)!, 100, 1);
    expect(landed.x).toBeCloseTo(a.x - 0.06 * FIXED);
    expect(landed.elevation).toBe(0);
  });
});
