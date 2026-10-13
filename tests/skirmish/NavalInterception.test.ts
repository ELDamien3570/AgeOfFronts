import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { UNIT, VESSELS } from "../../src/skirmish/content/Units";
import { damageAmount, SHIP_DEFENCE } from "../../src/skirmish/domain/Combat";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import {
  createManpower,
  remainingHealth,
} from "../../src/skirmish/domain/Manpower";
import {
  incomingNavalDamage,
  navalAim,
} from "../../src/skirmish/domain/NavalCombat";
import { transportHandoff } from "../../src/skirmish/domain/TransportHandoff";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import { FIXED, type Ship, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
  snapshotTransfers,
} from "../../src/skirmish/SnapshotCodec";
import {
  packSnapshotDetails,
  unpackSnapshotDetails,
  validateSnapshotDetails,
} from "../../src/skirmish/SnapshotDetails";

interface Harness {
  fightShips(): void;
  movementLand(): Squad[];
  autonomousNavalPursuit(ship: Ship): boolean;
  moveShip(ship: Ship): void;
}
function fixture(age: Age = "StoneAge", defenders = 1, targets = 3) {
  const data = new Uint8Array(120 * 80).fill(133);
  for (let y = 0; y < 80; y++)
    for (let x = 30; x < 90; x++) data[y * 120 + x] = 0;
  const game = new Skirmish(new GameMapImpl(120, 80, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const template = { ...game.squads.find((s) => s.playerId === 2)! };
  const friendly = { ...game.squads.find((s) => s.playerId === 1)! };
  for (const s of [...game.squads]) game.removeSquad(s.id);
  game.addSquad({
    ...friendly,
    x: 15.5 * FIXED,
    y: 10.5 * FIXED,
    order: { type: "hold" },
    path: [],
    nextPathIndex: 0,
  });
  const vessel = VESSELS.find((v) => v.kind === "warship" && v.age === age)!;
  const transport = VESSELS.find(
    (v) => v.kind === "transport" && v.age === age,
  )!;
  const unit = UNIT.get("stoneage-infantry")!;
  const cargo = Array.from({ length: targets }, (_, i) =>
    game.addSquad({
      ...template,
      id: game.allocateId(),
      x: (53.5 + i * 3) * FIXED,
      y: 40.5 * FIXED,
      troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit),
      order: { type: "hold" },
      path: [],
      nextPathIndex: 0,
      afloat: {
        hull: transport.health,
        maxHull: transport.health,
        vesselId: transport.id,
      },
    }),
  );
  const ships = Array.from({ length: defenders }, () =>
    game.addShip({
      id: game.allocateId(),
      kind: "warship",
      definitionId: vessel.id,
      playerId: 1,
      x: 50.5 * FIXED,
      y: 40.5 * FIXED,
      health: vessel.health,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
    }),
  );
  const harness = game as unknown as Harness;
  const fire = () => {
    harness.movementLand();
    harness.fightShips();
  };
  return { game, cargo, ships, vessel, transport, harness, fire };
}
function hit(game: Skirmish, target: Squad, amount: number) {
  const damage = new DamageLedger();
  damage.add(target.id, 1, amount);
  game.resolveLandDamage(damage);
}

describe("naval interception", () => {
  it("allocates enough instant fire to sink each target without fleet-wide overkill", () => {
    const f = fixture("StoneAge", 6, 2);
    f.fire();
    expect(f.cargo.map((s) => f.game.squad(s.id))).toEqual([
      undefined,
      undefined,
    ]);
    expect(f.ships.filter((s) => s.nextAttackTick !== undefined)).toHaveLength(
      4,
    );
  });
  it("reserves incoming shells and reconstructs commitments after encoded restoration", async () => {
    const f = fixture("Modern", 6, 2);
    f.fire();
    const ids = f.game.expansion!.battle.projectiles.map(
      (p) => p.navalTargetId,
    );
    expect(ids.filter((id) => id === f.cargo[0].id)).toHaveLength(3);
    expect(ids.filter((id) => id === f.cargo[1].id)).toHaveLength(3);
    const saved = await decodeState<ReturnType<Skirmish["checkpoint"]>>(
      await encodeState(f.game.checkpoint()),
    );
    const cold = new Skirmish(f.game.map, f.game.options);
    cold.restore(saved);
    for (const g of [f.game, cold]) {
      for (const s of g.ships) g.updateShip(s.id, { nextAttackTick: 0 });
      (g as unknown as Harness).movementLand();
      (g as unknown as Harness).fightShips();
      expect(g.expansion!.battle.projectiles).toHaveLength(6);
    }
    expect(cold.checkpoint()).toEqual(f.game.checkpoint());
    for (let tick = 0; tick < 80; tick++) {
      f.game.step();
      cold.step();
    }
    expect(cold.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("releases commitments for misses, impacts, expiry and landed targets", () => {
    const f = fixture("Modern", 3, 1);
    f.fire();
    const battle = f.game.expansion!.battle;
    const reserved = () =>
      incomingNavalDamage(
        battle.projectiles,
        f.game.tick,
        (id) => f.game.squad(id),
        (s) => f.game.navalVelocity(s),
        (a, b) => a !== b,
      );
    expect(reserved().get(f.cargo[0].id)).toBe(f.transport.health);
    f.game.updateSquad(f.cargo[0].id, { y: 50.5 * FIXED });
    expect(reserved().size).toBe(0);
    f.game.updateSquad(f.cargo[0].id, { y: 40.5 * FIXED });
    battle.projectiles[0].impacted = true;
    battle.projectiles[1].impactTick = f.game.tick - 1;
    expect(reserved().get(f.cargo[0].id)).toBe(
      damageAmount(f.vessel.attack!, SHIP_DEFENCE),
    );
    f.game.updateSquad(f.cargo[0].id, { afloat: null });
    expect(reserved().size).toBe(0);
  });
  it("respects both priorities and explicit attacks, and rejects foreign ship selection atomically", () => {
    for (const priority of ["transports", "warships"] as const) {
      const f = fixture("StoneAge", 1, 1);
      const enemy = f.game.addShip({
        ...f.ships[0],
        id: f.game.allocateId(),
        playerId: 2,
        x: 51.5 * FIXED,
        nextAttackTick: 1000,
      });
      expect(
        f.game.applyCommand({
          type: "naval-priority",
          playerId: 1,
          shipIds: [f.ships[0].id],
          priority,
        }),
      ).toBeNull();
      f.fire();
      expect(enemy.health < f.vessel.health).toBe(priority === "warships");
      expect(f.cargo[0].afloat!.hull < f.transport.health).toBe(
        priority === "transports",
      );
      expect(
        f.game.applyCommand({
          type: "naval-priority",
          playerId: 1,
          shipIds: [f.ships[0].id, enemy.id],
          priority: "warships",
        }),
      ).not.toBeNull();
      expect(f.ships[0].navalPriority).toBe(priority);
      f.game.updateShip(f.ships[0].id, { nextAttackTick: 0 });
      expect(
        f.game.applyCommand({
          type: "naval-attack",
          playerId: 1,
          shipIds: [f.ships[0].id],
          targetId: enemy.id,
        }),
      ).toBeNull();
      const before = enemy.health;
      f.fire();
      expect(enemy.health).toBeLessThan(before);
    }
    expect(
      commandSchema.safeParse({
        type: "naval-priority",
        playerId: 1,
        shipIds: [1],
        priority: "invalid",
      }).success,
    ).toBe(false);
  });
  it("acquires afloat squads for bounded pursuit and leaves manual voyages alone", () => {
    const f = fixture("StoneAge", 1, 1),
      s = f.ships[0];
    f.game.updateSquad(f.cargo[0].id, {
      x: 62.5 * FIXED,
      order: { type: "move", tile: f.game.map.ref(80, 40) },
      path: Array.from({ length: 19 }, (_, n) => f.game.map.ref(62 + n, 40)),
      nextPathIndex: 1,
    });
    f.game.tick = (10 - (s.id % 10)) % 10;
    f.harness.movementLand();
    expect(f.harness.autonomousNavalPursuit(s)).toBe(true);
    expect(s.navalTargetKind).toBe("transport");
    expect(s.navalTargetId).toBe(f.cargo[0].id);
    expect(s.destination).not.toBeNull();
    f.game.updateShip(s.id, {
      destination: f.game.map.ref(40, 40),
      autonomousVoyage: false,
    });
    expect(f.harness.autonomousNavalPursuit(s)).toBe(false);
    expect(s.destination).toBe(f.game.map.ref(40, 40));
  });
  it("leads a moving naval target and preserves physical misses after a turn", () => {
    for (const turn of [false, true]) {
      const f = fixture("Modern", 1, 1),
        s = f.cargo[0];
      f.game.updateSquad(s.id, {
        x: 60.5 * FIXED,
        order: { type: "move", tile: f.game.map.ref(60, 65) },
        path: [f.game.map.ref(60, 65)],
        nextPathIndex: 0,
      });
      f.fire();
      const p = f.game.expansion!.battle.projectiles[0];
      expect(p.toY).toBeGreaterThan(s.y);
      const initialY = s.y;
      for (let tick = 1; tick <= p.impactTick; tick++) {
        f.game.tick = tick;
        f.game.updateSquad(s.id, {
          y: initialY + (turn ? -1 : 1) * tick * f.transport.speed,
        });
        f.game.expansion!.battle.advanceProjectiles();
      }
      expect(s.afloat!.hull < f.transport.health).toBe(!turn);
      if (!turn)
        expect(f.transport.health - s.afloat!.hull).toBe(
          damageAmount(f.vessel.attack!, SHIP_DEFENCE),
        );
    }
    expect(
      navalAim({ x: 0, y: 0 }, { x: FIXED, y: 0 }, { x: 0, y: 0 }, FIXED),
    ).toEqual({ x: FIXED, y: 0 });
  });
  it("causes proportional passenger damage independent of hit partition and preserves it across crossings", () => {
    const a = fixture("Modern", 0, 1),
      b = fixture("Modern", 0, 1);
    for (const f of [a, b])
      f.game.updateSquad(f.cargo[0].id, {
        afloat: { hull: 1000, maxHull: 1000, vesselId: f.transport.id },
      });
    const baseline = remainingHealth(a.cargo[0]);
    hit(a.game, a.cargo[0], 400);
    for (let n = 0; n < 400; n++) hit(b.game, b.cargo[0], 1);
    expect(remainingHealth(a.cargo[0])).toBe(baseline * 0.8);
    expect(remainingHealth(b.cargo[0])).toBe(remainingHealth(a.cargo[0]));
    expect(b.cargo[0].troops).toBe(a.cargo[0].troops);
    expect(b.cargo[0].manpower!.wounds).toBe(a.cargo[0].manpower!.wounds);
    const s = a.cargo[0],
      before = remainingHealth(s);
    a.game.updateSquad(
      s.id,
      transportHandoff(
        s,
        { x: 95 * FIXED, y: s.y },
        false,
        undefined,
        () => true,
      )!.changes!,
    );
    expect(remainingHealth(s)).toBe(before);
    expect(s.afloat).toBeNull();
    a.game.updateSquad(
      s.id,
      transportHandoff(
        s,
        { x: 85 * FIXED, y: s.y },
        true,
        a.transport,
        () => true,
      )!.changes!,
    );
    expect(s.afloat!.hull).toBe(a.transport.health);
    expect(s.afloat!.passengerHealth).toBe(before);
  });
  it("damages transported vehicle health and accounts sinking casualties once", () => {
    const f = fixture("Modern", 0, 1),
      s = f.cargo[0];
    const vehicle = [...UNIT.values()].find(
      (u) => u.formationRecipe?.model === "hull",
    )!;
    f.game.updateSquad(s.id, {
      definitionId: vehicle.id,
      troops: 1,
      manpower: createManpower(vehicle),
      afloat: { hull: 1000, maxHull: 1000, vesselId: f.transport.id },
    });
    const before = remainingHealth(s);
    hit(f.game, s, 400);
    expect(s.troops).toBe(1);
    expect(remainingHealth(s)).toBe(before * 0.8);
    const losses = f.game.players[1].losses;
    hit(f.game, s, 600);
    expect(f.game.squad(s.id)).toBeUndefined();
    expect(f.game.players[1].losses - losses).toBe(
      vehicle.formationRecipe!.reserveCost,
    );
    hit(f.game, s, 600);
    expect(f.game.players[1].losses - losses).toBe(
      vehicle.formationRecipe!.reserveCost,
    );
  });
  it("preserves priority and passenger accounting through packed and encoded snapshots", async () => {
    const f = fixture("Modern", 1, 1);
    hit(f.game, f.cargo[0], 100);
    f.game.updateShip(f.ships[0].id, { navalPriority: "warships" });
    const snapshot = f.game.snapshot();
    const packed = packSnapshotDetails(
      snapshot.squads,
      snapshot.buildings,
      snapshot.ships,
      [],
    );
    validateSnapshotDetails(packed);
    const unpacked = unpackSnapshotDetails(packed);
    expect(unpacked.ships[0].navalPriority).toBe("warships");
    expect(
      unpacked.squadDetails!.find((s) => s.id === f.cargo[0].id)!.afloat,
    ).toEqual(f.cargo[0].afloat);
    const decoded = await decodeState<typeof packed>(await encodeState(packed));
    expect(
      unpackSnapshotDetails(decoded).squadDetails!.find(
        (s) => s.id === f.cargo[0].id,
      )!.afloat,
    ).toEqual(f.cargo[0].afloat);
    expect(() =>
      validateSnapshotDetails({
        ...packed,
        shipNavalPriority: new Float64Array([f.ships[0].id, 2]),
      }),
    ).toThrow();
    expect(() =>
      validateSnapshotDetails({
        ...packed,
        squadTransportDamage: new Float64Array([f.cargo[0].id, NaN, 0]),
      }),
    ).toThrow();
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const packet = encoder.encode(snapshot);
    const wire = structuredClone(packet, {
      transfer: snapshotTransfers(packet),
    });
    const restored = decoder.decode(wire);
    expect(restored.ships[0].navalPriority).toBe("warships");
    expect(restored.squads.find((s) => s.id === f.cargo[0].id)!.afloat).toEqual(
      f.cargo[0].afloat,
    );
    const checkpoint = f.game.checkpoint();
    const cold = new Skirmish(f.game.map, f.game.options);
    cold.restore(checkpoint);
    hit(f.game, f.cargo[0], 1);
    hit(cold, cold.squad(f.cargo[0].id)!, 1);
    expect(cold.checkpoint()).toEqual(f.game.checkpoint());
    const corrupt = f.game.checkpoint();
    corrupt.squads = corrupt.squads.map((s) =>
      s.id === f.cargo[0].id
        ? { ...s, afloat: { ...s.afloat!, passengerHullDamage: -1 } }
        : s,
    );
    expect(() => cold.restore(corrupt)).toThrow(
      "Invalid transport passenger damage",
    );
  });
  it.each(AGES)(
    "increasing defenders stops more moving transports in %s",
    (age) => {
      const crossing = (count: number) => {
        const f = fixture(age, count, 3),
          initialY = 25.5 * FIXED;
        f.cargo.forEach((s, i) =>
          f.game.updateSquad(s.id, {
            x: (49.5 + i) * FIXED,
            y: initialY,
            order: { type: "move", tile: f.game.map.ref(49 + i, 65) },
            path: [f.game.map.ref(49 + i, 65)],
            nextPathIndex: 0,
          }),
        );
        for (
          let tick = 0;
          tick < Math.ceil((30 * FIXED) / f.transport.speed);
          tick++
        ) {
          f.game.tick = tick;
          for (const s of f.cargo)
            if (f.game.squad(s.id))
              f.game.updateSquad(s.id, {
                y: initialY + tick * f.transport.speed,
              });
          f.fire();
          f.game.expansion!.battle.advanceProjectiles();
        }
        return f.cargo.filter((s) => f.game.squad(s.id)).length;
      };
      expect(crossing(6)).toBe(0);
      expect(crossing(1)).toBeGreaterThan(crossing(6));
    },
  );
  it.each(["StoneAge", "Modern"] as const)(
    "intercepts moving squads through the complete simulation loop in %s",
    (age) => {
      const f = fixture(age, 6, 3);
      f.cargo.forEach((s, i) => {
        f.game.updateSquad(s.id, {
          x: (48.5 + i * 2) * FIXED,
          y: 25.5 * FIXED,
        });
        expect(
          f.game.applyCommand({
            type: "order",
            playerId: 2,
            squadIds: [s.id],
            order: { type: "move", tile: f.game.map.ref(48 + i * 2, 65) },
          }),
        ).toBeNull();
      });
      for (
        let tick = 0;
        tick < 400 && f.cargo.some((s) => f.game.squad(s.id));
        tick++
      )
        f.game.step();
      expect(f.cargo.filter((s) => f.game.squad(s.id))).toHaveLength(0);
      expect(f.game.players[1].losses).toBeGreaterThan(0);
    },
  );
});
