import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { VESSEL, VESSELS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  NAVAL_DAMAGE_FLOOR_PERMILLE,
  navalStrengthPermille,
} from "../../src/skirmish/domain/NavalCombat";

// Naval contract (roadmap Next #6, V1-V3). Open sea from x=10 to x=189 with
// land columns on both sides; squads are removed so only ships act.
const W = 200, H = 100;
function openSea(options: { deferred?: boolean; raids?: boolean } = {}) {
  const data = new Uint8Array(W * H).fill(133);
  for (let y = 0; y < H; y++) for (let x = 10; x < W - 10; x++) data[y * W + x] = 0;
  const game = new Skirmish(
    new GameMapImpl(W, H, data, data.filter((t) => t & 128).length),
    {
      seed: 7, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
      deferredPlanning: options.deferred ?? false,
      ...(options.raids ? { diplomacyRules: "raids-v1" as const } : {}),
    },
  );
  for (const s of [...game.squads]) game.removeSquad(s.id);
  return game;
}
function warship(game: Skirmish, playerId: number, definitionId: string, x: number, y: number, health?: number): Ship {
  const vessel = VESSEL.get(definitionId)!;
  return game.addShip({
    id: game.allocateId(), playerId, kind: vessel.kind === "carrier" ? "carrier" : "warship", definitionId,
    x: x * FIXED + FIXED / 2, y: y * FIXED + FIXED / 2, health: health ?? vessel.health,
    destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false,
    patrolTile: game.map.ref(x, y), repairState: "patrolling", patrolDwellTicks: secondsToTicks(5), nextAttackTick: 0,
  });
}
const alive = (game: Skirmish, playerId: number) => game.ships.filter((s) => s.playerId === playerId);

describe("naval balance contract", () => {
  it("naval strength keeps full-health damage and floors a 1-HP hull at the floor", () => {
    for (const vessel of VESSELS) {
      expect(navalStrengthPermille(vessel.health, vessel.health)).toBe(1000);
      expect(navalStrengthPermille(1, vessel.health)).toBeGreaterThanOrEqual(NAVAL_DAMAGE_FLOOR_PERMILLE);
      expect(navalStrengthPermille(0, vessel.health)).toBe(NAVAL_DAMAGE_FLOOR_PERMILLE);
    }
    expect(navalStrengthPermille(500, 1000)).toBe(NAVAL_DAMAGE_FLOOR_PERMILLE + (1000 - NAVAL_DAMAGE_FLOOR_PERMILLE) / 2);
  });

  it("same-age 1v1 warships sink in 15-30 s in every age", () => {
    const results: string[] = [];
    for (const age of AGES) {
      const id = `${age.toLowerCase()}-warship`, game = openSea();
      warship(game, 1, id, 92, 50);
      warship(game, 2, id, 108, 50);
      let tick = 0;
      for (; tick < secondsToTicks(60); tick++) {
        game.step();
        if (!alive(game, 1).length || !alive(game, 2).length) break;
      }
      const seconds = (tick + 1) / secondsToTicks(1);
      results.push(`${age}:${seconds}:${alive(game, 1).length}/${alive(game, 2).length}`);
      expect(alive(game, 1).length && alive(game, 2).length, `${age} unresolved after 60 s`).toBe(0);
      expect(seconds, results.join(" ")).toBeGreaterThanOrEqual(15);
      expect(seconds, results.join(" ")).toBeLessThanOrEqual(30);
    }
  }, 60_000);

  it("a 1-HP ship of every armed vessel deals at least 1 damage", () => {
    const armed = VESSELS.filter((v) => v.kind !== "carrier" && v.attack?.targets.includes("ship"));
    expect(armed.length).toBeGreaterThanOrEqual(10);
    // The aircraft carrier has no gun of its own; it is skipped explicitly.
    expect(VESSELS.find((v) => v.kind === "carrier")?.attack).toBeUndefined();
    for (const vessel of armed) {
      const game = openSea();
      warship(game, 1, vessel.id, 95, 50, 1);
      const defender = warship(game, 2, vessel.id, 98, 50);
      game.updateShip(defender.id, { nextAttackTick: 1e9 });
      const start = defender.health;
      for (let t = 0; t < secondsToTicks(10) && defender.health === start; t++) game.step();
      expect(defender.health, vessel.id).toBeLessThan(start);
    }
  }, 30_000);

  for (const deferred of [false, true])
    it(`interrupted recovery reaches full health within 90 s (deferred ${deferred})`, () => {
      const game = openSea({ deferred });
      for (let y = 40; y < 60; y++) for (let x = 0; x < 10; x++) game.owners[game.map.ref(x, y)] = 1;
      game.addBuilding({ id: game.allocateId(), type: "port", tile: game.map.ref(8, 50), playerId: 1,
        remainingTicks: 0, age: "StoneAge", health: 1200, maxHealth: 1200 });
      const ship = warship(game, 1, "stoneage-warship", 60, 50, 400);
      game.updateShip(ship.id, { lastCombatTick: -100 });
      for (let t = 0; t < 40 && ship.repairState !== "returning-to-dock"; t++) game.step();
      expect(ship.repairState).toBe("returning-to-dock");
      const enemy = warship(game, 2, "stoneage-warship", 66, 56);
      game.updateShip(enemy.id, { nextAttackTick: 1e9 });
      expect(game.applyCommand({ type: "naval-attack", playerId: 1, shipIds: [ship.id], targetId: enemy.id })).toBeNull();
      for (let t = 0; t < secondsToTicks(3); t++) game.step();
      game.removeShip(enemy.id);
      const max = game.shipMaxHealth(ship);
      let tick = 0;
      for (; tick < secondsToTicks(90) && ship.health < max; tick++) game.step();
      expect(ship.health).toBe(max);
      // The claim is released once repaired, so the port serves the next ship.
      for (let t = 0; t < secondsToTicks(2); t++) game.step();
      expect(ship.repairPortId ?? null).toBeNull();
    }, 30_000);

  it("an idle warship declares no entry war", () => {
    const game = openSea({ raids: true }), d = game.expansion!.diplomacy;
    expect(game.players.find((p) => p.id === 2)?.ai).toBe(true);
    for (let y = 0; y < H; y++) for (let x = 100; x < 104; x++) game.owners[game.map.ref(x, y)] = 2;
    warship(game, 1, "stoneage-warship", 99, 50);
    for (let t = 0; t < secondsToTicks(20); t++) game.step();
    expect(d.declaredWar(1, 2)).toBe(false);
    expect(d.state.wars ?? []).toEqual([]);
    expect(d.state.embargoes ?? []).toEqual([]);
  });

  it("a warship sailing across foreign coastal water declares no entry war", () => {
    const game = openSea({ raids: true }), d = game.expansion!.diplomacy;
    for (let y = 0; y < H; y++) for (let x = 98; x < 102; x++) game.owners[game.map.ref(x, y)] = 2;
    const ship = warship(game, 1, "stoneage-warship", 80, 50);
    expect(game.applyCommand({ type: "sail", playerId: 1, shipIds: [ship.id], tile: game.map.ref(120, 50) })).toBeNull();
    for (let t = 0; t < secondsToTicks(20); t++) game.step();
    expect(ship.x / FIXED).toBeGreaterThan(102);
    expect(d.declaredWar(1, 2)).toBe(false);
    expect(d.state.wars ?? []).toEqual([]);
  });

  it("a carrier crossing foreign coastal water keeps the entry rule (ENTRY_WAR_SHIP_KINDS)", () => {
    const game = openSea({ raids: true }), d = game.expansion!.diplomacy;
    for (let y = 0; y < H; y++) for (let x = 98; x < 102; x++) game.owners[game.map.ref(x, y)] = 2;
    const carrier = warship(game, 1, "earlymodern-carrier", 80, 50);
    expect(game.applyCommand({ type: "sail", playerId: 1, shipIds: [carrier.id], tile: game.map.ref(120, 50) })).toBeNull();
    for (let t = 0; t < secondsToTicks(20) && !d.declaredWar(1, 2); t++) game.step();
    expect(d.state.wars?.[0]).toMatchObject({ initiator: 1, cause: "entry" });
  });
});
