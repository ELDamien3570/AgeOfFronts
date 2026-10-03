import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Ship, Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const cells = new Uint8Array(128 * 96).fill(133);
  const world = new Skirmish(new GameMapImpl(128, 96, cells, cells.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
  });
  const template = { ...world.squads[0] };
  for (const squad of world.squads) world.removeSquad(squad.id);
  for (const ship of world.ships) world.removeShip(ship.id);
  return { world, template };
}
function vessel(id: number, playerId = 1): Ship {
  return {
    id,
    playerId,
    kind: "transport",
    x: 20 * 256,
    y: 20 * 256,
    health: 1000,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
  };
}

describe("authoritative unit membership and cargo lifecycle", () => {
  it("owns external records and updates same-length replacements without stale IDs or cargo", () => {
    const { world, template } = fixture();
    const input = {
      ...template,
      id: world.allocateId(),
      playerId: 1,
      embarkedOn: null,
      path: [1, 2],
    };
    const squad = world.addSquad(input),
      ship = world.addShip(vessel(world.allocateId()));
    input.playerId = 2;
    input.path.push(3);
    expect(squad.playerId).toBe(1);
    expect(squad.path).toEqual([1, 2]);
    expect(Object.isFrozen(world.squads)).toBe(true);
    expect(Object.isFrozen(world.ships)).toBe(true);
    world.updateSquad(squad.id, {
      embarkedOn: ship.id,
      playerId: 2,
      kind: "archer",
    });
    expect(world.squad(squad.id)).toBe(squad);
    expect(world.squadFacts().byOwner(1)).toEqual([]);
    expect(world.squadFacts().byKind(2, "archer")).toEqual([squad]);
    expect(world.squadFacts().cargo(ship.id)).toEqual([squad]);
    world.removeSquad(squad.id);
    const replacement = world.addSquad({
      ...template,
      id: world.allocateId(),
      playerId: 1,
    });
    expect(world.squads).toEqual([replacement]);
    expect(world.squad(squad.id)).toBeUndefined();
    expect(world.squadFacts().cargo(ship.id)).toEqual([]);
    world.removeShip(ship.id);
    expect(world.shipFacts().byOwner(1)).toEqual([]);
    expect(world.shipFacts().diagnostics.indexedRows).toBe(0);
    expect(world.updateSquad(squad.id, { troops: 1 })).toBeUndefined();
    expect(world.removeSquad(squad.id)).toBe(false);
  });

  it("matches independent canonical scans after capture, refit, casualties, embark, landing and removal", () => {
    const { world, template } = fixture();
    const squads: Squad[] = [],
      ships: Ship[] = [];
    let seed = 47;
    const pick = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let step = 0; step < 400; step++) {
      const shipTurn = pick(2) === 0,
        rows = shipTurn ? ships : squads;
      const op = pick(5);
      if (!rows.length || (op === 0 && rows.length < 32)) {
        const id = world.allocateId();
        if (shipTurn) {
          const ship = vessel(id, pick(3));
          world.addShip(ship);
          ships.push({ ...ship });
        } else {
          const squad = {
            ...template,
            id,
            playerId: pick(3),
            embarkedOn: null,
          };
          world.addSquad(squad);
          squads.push({ ...squad });
        }
      } else {
        const at = pick(rows.length),
          row = rows[at];
        if (op === 1) {
          if (shipTurn) world.removeShip(row.id);
          else world.removeSquad(row.id);
          rows.splice(at, 1);
        } else if (shipTurn) {
          const changes =
            op === 2
              ? { playerId: pick(3) }
              : op === 3
                ? { health: pick(2) * 1000 }
                : {
                    kind: pick(2)
                      ? ("warship" as const)
                      : ("transport" as const),
                    definitionId: "test-" + pick(3),
                  };
          world.updateShip(row.id, changes);
          Object.assign(row, changes);
        } else {
          const changes =
            op === 2
              ? {
                  playerId: pick(3),
                  kind: (["infantry", "archer", "cavalry"] as const)[pick(3)],
                }
              : op === 3
                ? { troops: pick(2) * 1000, definitionId: "test-" + pick(3) }
                : { embarkedOn: pick(3) ? 10000 + pick(4) : null };
          world.updateSquad(row.id, changes);
          Object.assign(row, changes);
        }
      }
      expect(
        world.squads.map((s) => ({
          id: s.id,
          owner: s.playerId,
          kind: s.kind,
          alive: s.troops > 0,
          cargo: s.embarkedOn,
        })),
      ).toEqual(
        squads.map((s) => ({
          id: s.id,
          owner: s.playerId,
          kind: s.kind,
          alive: s.troops > 0,
          cargo: s.embarkedOn,
        })),
      );
      for (let owner = 0; owner < 3; owner++) {
        expect(world.squadFacts().byOwner(owner)).toEqual(
          squads.filter((s) => s.playerId === owner),
        );
        expect(world.squadFacts().aliveByOwner(owner)).toEqual(
          squads.filter((s) => s.playerId === owner && s.troops > 0),
        );
        expect(world.shipFacts().byOwner(owner)).toEqual(
          ships.filter((s) => s.playerId === owner),
        );
        expect(world.shipFacts().aliveByOwner(owner)).toEqual(
          ships.filter((s) => s.playerId === owner && s.health > 0),
        );
        for (const kind of ["infantry", "archer", "cavalry"] as const)
          expect(world.squadFacts().byKind(owner, kind)).toEqual(
            squads.filter((s) => s.playerId === owner && s.kind === kind),
          );
        for (const kind of ["transport", "warship"] as const)
          expect(world.shipFacts().byKind(owner, kind)).toEqual(
            ships.filter((s) => s.playerId === owner && s.kind === kind),
          );
        for (const definition of [undefined, "test-0", "test-1", "test-2"])
          expect(world.squadFacts().byDefinition(owner, definition)).toEqual(
            squads.filter(
              (s) => s.playerId === owner && s.definitionId === definition,
            ),
          );
      }
      for (let carrier = 10000; carrier < 10004; carrier++)
        expect(world.squadFacts().cargo(carrier)).toEqual(
          squads.filter((s) => s.embarkedOn === carrier),
        );
      world.verifyUnitIndexes();
      expect(world.squadFacts().diagnostics.indexedRows).toBe(squads.length);
      expect(world.shipFacts().diagnostics.indexedRows).toBe(ships.length);
    }
    for (const squad of world.squads) world.removeSquad(squad.id);
    for (const ship of world.ships) world.removeShip(ship.id);
    expect(world.squadFacts().diagnostics.groups).toBe(0);
    expect(world.shipFacts().diagnostics.groups).toBe(0);
  });

  it("keeps movement updates independent of membership and cargo revisions", () => {
    const { world, template } = fixture(),
      squad = world.addSquad({ ...template, id: world.allocateId() });
    const facts = world.squadFacts(),
      membership = facts.membershipRevision,
      cargo = facts.cargoRevision;
    const route = [1, 2, 3];
    world.updateSquad(squad.id, { path: route });
    route.push(4);
    const installed = squad.path;
    world.updateSquad(squad.id, { x: squad.x + 1, nextPathIndex: 1 });
    expect(squad.path).toBe(installed);
    expect(squad.path).toEqual([1, 2, 3]);
    expect(facts.membershipRevision).toBe(membership);
    expect(facts.cargoRevision).toBe(cargo);
    world.updateSquad(squad.id, { embarkedOn: 10000 });
    expect(facts.cargoRevision).toBeGreaterThan(cargo);
    expect(facts.membershipRevision).toBe(membership);
    const dynamic = facts.dynamicRevision;
    world.updateSquad(squad.id, { x: squad.x });
    expect(facts.dynamicRevision).toBe(dynamic);
  });

  it("rebuilds only on restore, preserves canonical order and continues identically", () => {
    const { world, template } = fixture();
    world.addSquad({
      ...template,
      id: world.allocateId(),
      playerId: 1,
      x: 20 * 256,
      y: 20 * 256,
    });
    world.addSquad({
      ...template,
      id: world.allocateId(),
      playerId: 2,
      x: 90 * 256,
      y: 75 * 256,
    });
    const saved = world.checkpoint();
    const cells = new Uint8Array(128 * 96).fill(133);
    const restored = new Skirmish(
      new GameMapImpl(128, 96, cells, cells.length),
      saved.options,
    );
    restored.restore(saved);
    restored.compareUnitIndexes = true;
    const scanned =
      world.squadFacts().diagnostics.scannedRows +
      world.shipFacts().diagnostics.scannedRows;
    for (let step = 0; step < 12; step++) {
      for (let q = 0; q < 20; q++) {
        world.squadFacts().byOwner(1);
        world.shipFacts().byOwner(2);
      }
      world.step();
      restored.step();
      expect(restored.checkpoint()).toEqual(world.checkpoint());
    }
    expect(
      world.squadFacts().diagnostics.scannedRows +
        world.shipFacts().diagnostics.scannedRows,
    ).toBe(scanned);
    expect(world.checkpoint()).not.toHaveProperty("compareUnitIndexes");
    world.verifyUnitIndexes();
    restored.verifyUnitIndexes();
  });
});
