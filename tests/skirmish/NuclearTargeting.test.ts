import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { ATOMIC_ATTACK, STRATEGIC_PAYLOADS } from "../../src/skirmish/content/ModernWeapons";
import type { Aircraft, TradeActor } from "../../src/skirmish/domain/Definitions";

const TARGET = { x: 80.5 * FIXED, y: 40.5 * FIXED };
const PAYLOADS = ["atomic", "icbm", "hydrogen", "mirv"] as const;
type Payload = typeof PAYLOADS[number];
function trader(game: Skirmish, x: number, y: number, naval = false): TradeActor {
  return { id: game.allocateId(), playerId: 3, factoryId: 0, definitionId: "caravan", naval, x, y,
    cargo: 0, loaded: 0, delivered: 0, lost: 0, returned: 0, valuePerGood: 1, originTile: 0,
    capacity: 100, shipmentId: game.allocateId(), stops: [], visited: [], destination: null,
    state: "waiting", path: [], nextPathIndex: 0, waitTicks: 0, quoteAllies: [] };
}
function fixture(payload: Payload) {
  const terrain = new Uint8Array(160 * 96).fill(133);
  const game = new Skirmish(new GameMapImpl(160, 96, terrain, terrain.length), {
    seed: 47, aiCount: 2, tribes: false, runAi: false, ruleset: "ages-v1", diplomacyRules: "raids-v1", startingAge: "Modern",
  });
  const e = game.expansion!;
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  for (const s of game.squads) game.updateSquad(s.id, { x: 15 * FIXED, y: 80 * FIXED });
  game.owners.fill(0);
  e.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
  game.player(1)!.gold = 1e6;
  const building = (type: BuildingType, owner: number, x: number, y = 40) => game.addBuilding({
    id: game.allocateId(), playerId: owner, type, tile: game.map.ref(x, y), age: "Modern", remainingTicks: 0, health: 6000, maxHealth: 6000,
  });
  const target = building("factory", 2, 80);
  const launcher = building(payload === "atomic" ? "airstrip" : payload === "mirv" ? "mirv-launcher" : "missile-silo", 1, 10);
  game.owners[launcher.tile] = 1;
  e.supply.inventories[1][`payload:${payload}`] = 1;
  const aircraft: Aircraft = {
    id: game.allocateId(), playerId: 1, definitionId: "bomber", age: "EarlyModern", airfieldId: launcher.id,
    ...e.battle.position(launcher), health: 1000, state: "ready", target: null, reloadTick: 0, fuelTicks: 10000,
  };
  if (payload === "atomic") e.aircraft.push(aircraft);
  const launch = (explicit = false, mission: "atomic" | "bombing" = "atomic") => game.applyCommand(payload === "atomic" ? {
    type: "sortie", playerId: 1, aircraftIds: [aircraft.id], mission, ...TARGET,
  } : {
    type: "launch", playerId: 1, launcherId: launcher.id, payload, ...TARGET, ...(explicit ? { buildingId: target.id } : {}),
  });
  const radius = payload === "atomic" ? ATOMIC_ATTACK.projectile!.blastRadius : STRATEGIC_PAYLOADS[payload].blastRadius;
  const ally = () => e.diplomacy.state.alliances.push({ id: 1000, a: 1, b: 3, expiresTick: 1e7, renewal: [] });
  return { game, e, target, launcher, aircraft, launch, building, radius, ally };
}

describe("nuclear target authorization", () => {
  for (const payload of PAYLOADS) {
    it(`${payload} accepts non-allied collateral without war, including protected factions`, () => {
      const f = fixture(payload);
      f.game.owners[f.target.tile] = 2;
      f.e.diplomacy.state.peaceProtection = [{ a: 1, b: 2, untilTick: 1e7 }];
      expect(f.e.diplomacy.declaredWar(1, 2)).toBe(false);
      expect(f.launch(true)).toBeNull();
      expect(f.e.supply.inventories[1][`payload:${payload}`]).toBe(0);
    });

    for (const victim of ["land", "building", "squad", "ship", "wall", "caravan", "trade ship"] as const) {
      it(`${payload} rejects allied ${victim} at the inclusive blast edge without spending or ordering`, () => {
        const f = fixture(payload);
        f.ally();
        const edge = { x: TARGET.x + f.radius, y: TARGET.y };
        const tile = f.game.map.ref(edge.x / FIXED - 0.5, 40);
        if (victim === "land") f.game.owners[tile] = 3;
        if (victim === "building") f.building("factory", 3, edge.x / FIXED - 0.5);
        if (victim === "squad") {
          const squad = f.game.squads.find(s => s.playerId === 3)!;
          f.game.updateSquad(squad.id, edge);
        }
        if (victim === "ship") f.game.addShip({ id: f.game.allocateId(), playerId: 3, kind: "carrier", definitionId: "earlymodern-carrier", ...edge,
          health: 6500, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false });
        if (victim === "wall") f.e.fortifications.addBarrier({ id: f.game.allocateId(), playerId: 3, age: "Modern", a: tile, b: tile, tiles: [tile], health: 100, maxHealth: 100, remainingTicks: 0 });
        if (victim === "caravan" || victim === "trade ship") f.e.trade.actors.push(trader(f.game, edge.x, edge.y, victim === "trade ship"));
        const gold = f.game.player(1)!.gold;
        expect(f.launch()).toBe("Nuclear blast would hit an allied faction");
        expect(f.game.player(1)!.gold).toBe(gold);
        expect(f.e.supply.inventories[1][`payload:${payload}`]).toBe(1);
        expect(f.launcher.launchReadyTick).toBeUndefined();
        expect(f.aircraft.state).toBe("ready");
        expect(f.e.battle.projectiles).toHaveLength(0);
      });
    }
    it(`${payload} allows an ally immediately outside the blast`, () => {
      const f = fixture(payload); f.ally();
      const squad = f.game.squads.find(s => s.playerId === 3)!;
      f.game.updateSquad(squad.id, { x: TARGET.x + f.radius + 1, y: TARGET.y });
      expect(f.launch()).toBeNull();
    });
  }
  it("keeps conventional bomber attack permissions", () => {
    const f = fixture("atomic");
    expect(f.launch(false, "bombing")).toBe("Choose a hostile building or unit");
    expect(f.aircraft.state).toBe("ready");
  });
  it("ignores already destroyed allied couriers before lifecycle retirement removes their rows", () => {
    const f = fixture("icbm"); f.ally();
    f.e.trade.actors.push(trader(f.game, TARGET.x, TARGET.y));
    expect(f.launch()).toBe("Nuclear blast would hit an allied faction");
    f.e.trade.destroyInBlast(2, TARGET.x, TARGET.y, FIXED);
    expect(f.e.trade.actors).toHaveLength(1);
    expect(f.launch()).toBeNull();
  });
  it("does not retarget MIRV warheads onto hostile buildings whose blast would hit allied land", () => {
    const f = fixture("mirv"); f.ally();
    f.e.diplomacy.establishWar(1, 2, f.game.tick);
    const unsafe = f.building("factory", 2, 110);
    f.game.owners[f.game.map.ref(111, 40)] = 3;
    expect(f.launch()).toBeNull();
    f.game.tick = f.e.battle.projectiles[0].impactTick / 2;
    f.e.battle.advanceProjectiles();
    const heads = f.e.battle.projectiles.filter(p => p.kind === "warhead");
    expect(heads).toHaveLength(8);
    expect(heads.every(p => p.toX === TARGET.x && p.toY === TARGET.y)).toBe(true);
    expect(heads.some(p => p.toX === f.e.battle.position(unsafe).x)).toBe(false);
  });
});
