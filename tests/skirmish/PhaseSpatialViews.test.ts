import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(96 * 64).fill(133);
  return new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    runAi: false,
    deferredPlanning: true,
  });
}
describe("phase spatial ownership", () => {
  it('shares all-ships and alive-warship grids only while inclusion is identical', () => {
    const game=fixture();
    const ship=game.addShip({id:game.allocateId(),playerId:1,kind:'warship',x:8*FIXED,y:8*FIXED,
      health:100,path:[],nextPathIndex:0,destination:null,waypoints:[],nextAttackTick:0,fighting:false});
    const first=game.spatialFacts('combat');
    expect(first.warshipsAlive).toBe(first.ships);
    const before=game.spatialDiagnostics!.rebuilds;
    game.updateShip(ship.id,{health:0});
    expect(()=>first.ships).toThrow('expired');
    const dead=game.spatialFacts('trade');
    expect(dead.warshipsAlive).not.toBe(dead.ships);
    const all:typeof game.ships[number][]=[],alive:typeof all=[];
    dead.ships.query(ship.x,ship.y,FIXED,all);dead.warshipsAlive.query(ship.x,ship.y,FIXED,alive);
    expect(all).toContain(ship);expect(alive).not.toContain(ship);
    expect(game.spatialDiagnostics!.rebuilds).toBeGreaterThan(before);
    game.updateShip(ship.id,{health:100});
    expect(game.spatialFacts('projectiles').warshipsAlive).toBe(game.spatialFacts('combat').ships);
    game.restore(game.checkpoint());
    expect(game.spatialFacts('trade').warshipsAlive).toBe(game.spatialFacts('combat').ships);
  });
  it("shares identical inclusion while keeping casualties and boarding visible", () => {
    const game = fixture(), squad = game.squads[0];
    const first = game.spatialFacts("combat");
    expect(first.groundAlive).toBe(first.ground);
    expect(game.spatialDiagnostics!.rebuilds).toBe(1);
    game.updateSquad(squad.id, { troops: 0 });
    const damaged = game.spatialFacts("trade");
    expect(damaged.groundAlive).not.toBe(damaged.ground);
    game.updateSquad(squad.id, { embarkedOn: game.squads[1].id });
    const boarded = game.spatialFacts("projectiles");
    expect(boarded.groundAlive).toBe(boarded.ground);
    game.updateSquad(squad.id, { embarkedOn: null });
    const landed = game.spatialFacts("combat");
    expect(landed.groundAlive).not.toBe(landed.ground);
  });
  it("reuses geometry despite cosmetic/combat writes and invalidates position, membership and restore", () => {
    const game = fixture(),
      squad = game.squads[0],
      first = game.spatialFacts("combat");
    const original = first.ground;
    game.updateSquad(squad.id, { xp: 20, fighting: true });
    expect(game.spatialFacts("projectiles").ground).toBe(original);
    expect(game.spatialDiagnostics?.rebuilds).toBe(1);
    game.updateSquad(squad.id, { x: squad.x + FIXED });
    expect(() => first.ground).toThrow("expired");
    expect(game.spatialFacts("combat").ground).toBeDefined();
    expect(game.spatialDiagnostics?.rebuilds).toBe(2);
    game.updateSquad(squad.id, { troops: 0 });
    const all: (typeof game.squads)[number][] = [],
      alive: (typeof game.squads)[number][] = [];
    game.spatialFacts("combat").ground.query(squad.x, squad.y, FIXED, all);
    game
      .spatialFacts("trade")
      .groundAlive.query(squad.x, squad.y, FIXED, alive);
    expect(all).toContain(squad);
    expect(alive).not.toContain(squad);
    const before = game.spatialDiagnostics!.rebuilds;
    // Restore only admitted live formations after testing the dead-row filter.
    game.removeSquad(squad.id);
    game.restore(game.checkpoint());
    expect(game.spatialFacts("combat").ground).toBeDefined();
    expect(game.spatialDiagnostics!.rebuilds).toBe(before + 1);
  });
  it("matches independent battle/trade rebuilds over combat and restored continuation", () => {
    const shared = fixture(),
      reference = fixture();
    Object.defineProperty(reference, "spatialFacts", { value: undefined });
    for (const game of [shared, reference])
      for (const squad of game.squads) {
        game.updateSquad(squad.id, {
          x: (45 + squad.playerId * 2) * FIXED,
          y: (27 + (squad.id % 3)) * FIXED,
        });
      }
    for (let tick = 0; tick < 100; tick++) {
      shared.step();
      reference.step();
      if (tick % 20 === 0)
        expect(shared.checkpoint()).toEqual(reference.checkpoint());
      if (tick === 50) {
        shared.restore(shared.checkpoint());
        reference.restore(reference.checkpoint());
      }
    }
    expect(shared.spatialDiagnostics!.hits).toBeGreaterThan(0);
  });
});
