import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
import {
  Skirmish,
  WARSHIP_COMBAT_COOLDOWN,
  WARSHIP_PATROL_RADIUS,
} from "../../src/skirmish/Simulation";

function createMatch() {
  const width = 64;
  const height = 64;
  // Land is 133, Water is 0. Left half (x < 20) is land, right half is water.
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = x < 20 ? 133 : 0;
    }
  }

  const match = new Skirmish(
    new GameMapImpl(width, height, data, data.filter((t) => t & 128).length),
    { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
  );

  // Claim territory for player 1 on the coast
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 20; x++) {
      match.owners[match.map.ref(x, y)] = 1;
    }
  }

  return { match, width, height };
}

function spawnWarship(
  match: Skirmish,
  xTile: number,
  yTile: number,
  playerId = 1,
): Ship {
  const ship: Ship = {
    id: match.nextId++,
    playerId,
    kind: "warship",
    x: xTile * FIXED + FIXED / 2,
    y: yTile * FIXED + FIXED / 2,
    health: 1000,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
    patrolTile: match.map.ref(xTile, yTile),
    repairState: "patrolling",
    patrolDwellTicks: 100,
  };
  match.ships.push(ship);
  return ship;
}

function addPort(match: Skirmish, xTile: number, yTile: number, playerId = 1) {
  const tile = match.map.ref(xTile, yTile);
  const port = {
    id: match.nextId++,
    playerId,
    type: "port" as const,
    tile,
    remainingTicks: 0,
    health: 1000,
    maxHealth: 1000,
  };
  match.buildings.push(port);
  match.buildingIndex.add(port);
  return port;
}

describe("Warship patrol and dock repair logic", () => {
  it("assigns patrol station on sail and drifts within small patrol radius", () => {
    const { match } = createMatch();
    const ship = spawnWarship(match, 25, 25);
    const targetTile = match.map.ref(35, 25);

    // Command ship to sail
    const res = match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: targetTile,
    });
    expect(res).toBeNull();
    expect(ship.patrolTile).toBe(targetTile);
    expect(ship.repairState).toBe("patrolling");

    // Advance until ship reaches destination
    for (let i = 0; i < 200 && ship.destination !== null; i++) {
      match.step();
    }
    expect(ship.destination).toBeNull();
    expect(match.tileOf(ship)).toBe(targetTile);

    // Force dwell timer to expire
    ship.patrolDwellTicks = 0;
    match.step();

    // Ship should have picked a wander tile within small patrol radius (<= 2 cells)
    expect(ship.destination).not.toBeNull();
    const destX = match.map.x(ship.destination!);
    const destY = match.map.y(ship.destination!);
    const origX = match.map.x(targetTile);
    const origY = match.map.y(targetTile);
    expect(Math.abs(destX - origX)).toBeLessThanOrEqual(WARSHIP_PATROL_RADIUS);
    expect(Math.abs(destY - origY)).toBeLessThanOrEqual(WARSHIP_PATROL_RADIUS);
  });

  it("retreats to nearest friendly port when damaged and out of combat", () => {
    const { match } = createMatch();
    // Port at coast tile (19, 25) bordering water at (20, 25)
    const port = addPort(match, 19, 25);
    const ship = spawnWarship(match, 30, 25);
    ship.patrolTile = match.map.ref(30, 25);

    // Deal damage
    ship.health = 500;
    ship.lastCombatTick = match.tick;
    ship.fighting = true;

    // While in active combat, ship must not retreat
    match.step();
    expect(ship.repairState).toBe("patrolling");

    // Combat ends
    ship.fighting = false;

    // Advance past combat cooldown (WARSHIP_COMBAT_COOLDOWN)
    for (let i = 0; i < WARSHIP_COMBAT_COOLDOWN + 15; i++) {
      match.step();
    }

    // Ship should have claimed the port and be returning to dock
    expect(ship.repairState).toBe("returning-to-dock");
    expect(ship.repairPortId).toBe(port.id);

    // Advance until ship reaches the dock
    for (let i = 0; i < 300 && ship.repairState === "returning-to-dock"; i++) {
      match.step();
    }
    expect(ship.repairState).toBe("repairing");
  });

  it("enforces 1 ship per port in the stack and repairs docked ships", () => {
    const { match } = createMatch();
    // Single port at (19, 25)
    const port1 = addPort(match, 19, 25);

    const ship1 = spawnWarship(match, 25, 25);
    const ship2 = spawnWarship(match, 26, 25);

    // Damage both ships
    ship1.health = 400;
    ship1.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;
    ship2.health = 300;
    ship2.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;

    // Step simulation so ships evaluate dock capacity
    for (let i = 0; i < 15; i++) {
      match.step();
    }

    // Ship 1 should claim the 1 port slot; Ship 2 cannot claim it (capacity is 1)
    const dockingShip = [ship1, ship2].find((s) => s.repairState === "returning-to-dock");
    const waitingShip = [ship1, ship2].find((s) => s.repairState === "waiting-for-dock");
    expect(dockingShip).toBeDefined();
    expect(waitingShip).toBeDefined();
    expect(dockingShip!.repairPortId).toBe(port1.id);
    expect(waitingShip!.repairPortId).toBeFalsy();

    // Advance until docking ship arrives and heals
    for (let i = 0; i < 400 && dockingShip!.repairState !== "repairing"; i++) {
      match.step();
    }
    expect(dockingShip!.repairState).toBe("repairing");

    // Heal to full health
    for (let i = 0; i < 400 && dockingShip!.health < 1000; i++) {
      match.step();
    }
    expect(dockingShip!.health).toBe(1000);

    // On full health, docking ship vacates and returns to patrol
    for (let i = 0; i < 20 && dockingShip!.repairPortId !== null; i++) {
      match.step();
    }
    expect(dockingShip!.repairPortId).toBeNull();
    expect(dockingShip!.repairState).toBe("returning-to-patrol");

    // Now port is free! Waiting ship should claim it and head in to dock
    for (let i = 0; i < 30 && waitingShip!.repairState !== "returning-to-dock"; i++) {
      match.step();
    }
    expect(waitingShip!.repairPortId).toBe(port1.id);
    expect(waitingShip!.repairState).toBe("returning-to-dock");
  });

  it("allows 2 ships to dock concurrently when 2 ports are stacked on the same tile", () => {
    const { match } = createMatch();
    // 2 ports stacked on the same tile (19, 25)
    const port1 = addPort(match, 19, 25);
    const port2 = addPort(match, 19, 25);

    const ship1 = spawnWarship(match, 25, 25);
    const ship2 = spawnWarship(match, 26, 25);

    ship1.health = 500;
    ship1.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;
    ship2.health = 600;
    ship2.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;

    for (let i = 0; i < 15; i++) {
      match.step();
    }

    // Both ships should successfully claim distinct ports from the stack!
    expect(ship1.repairState).toBe("returning-to-dock");
    expect(ship2.repairState).toBe("returning-to-dock");
    expect(ship1.repairPortId).not.toBe(ship2.repairPortId);
    expect([port1.id, port2.id]).toContain(ship1.repairPortId);
    expect([port1.id, port2.id]).toContain(ship2.repairPortId);

    // Both ships sail to dock and heal
    for (let i = 0; i < 400 && (ship1.repairState !== "repairing" || ship2.repairState !== "repairing"); i++) {
      match.step();
    }
    expect(ship1.repairState).toBe("repairing");
    expect(ship2.repairState).toBe("repairing");

    const hp1Before = ship1.health;
    const hp2Before = ship2.health;
    // Step 20 ticks (1 second)
    for (let i = 0; i < 20; i++) {
      match.step();
    }
    expect(ship1.health).toBeGreaterThan(hp1Before);
    expect(ship2.health).toBeGreaterThan(hp2Before);
  });

  it("returns to previous patrol location after healing and resumes patrol", () => {
    const { match } = createMatch();
    addPort(match, 19, 25);
    const patrolStation = match.map.ref(35, 30);
    const ship = spawnWarship(match, 35, 30);
    ship.patrolTile = patrolStation;

    // Damage ship
    ship.health = 500;
    ship.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;

    // Step until docked and repaired
    for (let i = 0; i < 500 && ship.health < 1000; i++) {
      match.step();
    }
    expect(ship.health).toBe(1000);

    // Ship should transition to returning-to-patrol targeting patrolStation
    for (let i = 0; i < 20 && ship.repairState !== "returning-to-patrol"; i++) {
      match.step();
    }
    expect(ship.repairState).toBe("returning-to-patrol");
    expect(ship.destination).toBe(patrolStation);

    // Advance until ship reaches patrolStation
    for (let i = 0; i < 300 && ship.repairState === "returning-to-patrol"; i++) {
      match.step();
    }
    expect(ship.repairState).toBe("patrolling");
    expect(match.tileOf(ship)).toBe(patrolStation);
  });

  it("player manual sail and stop-ships commands override dock repair", () => {
    const { match } = createMatch();
    addPort(match, 19, 25);
    const ship = spawnWarship(match, 35, 25);
    ship.health = 500;
    ship.lastCombatTick = -WARSHIP_COMBAT_COOLDOWN;

    for (let i = 0; i < 15; i++) {
      match.step();
    }
    expect(ship.repairState).toBe("returning-to-dock");

    // Player manually commands ship to sail to a different tile
    const newTarget = match.map.ref(45, 45);
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: newTarget,
    });

    expect(ship.repairState).toBe("patrolling");
    expect(ship.patrolTile).toBe(newTarget);
    expect(ship.repairPortId).toBeNull();
    expect(ship.destination).toBe(newTarget);

    // Player stops the ship
    match.applyCommand({
      type: "stop-ships",
      playerId: 1,
      shipIds: [ship.id],
    });

    expect(ship.repairState).toBe("idle");
    expect(ship.patrolTile).toBeNull();
    expect(ship.destination).toBeNull();
  });
});
