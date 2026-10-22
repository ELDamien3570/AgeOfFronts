import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { deserialize, serialize } from "node:v8";
import { convertSeaTradeFixture } from "../../scripts/convertSeaTradeFixture";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { portWaterTiles } from "../../src/skirmish/PortWaterAccess";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";

describe("explicit sea fixture conversion", () => {
  it("preserves an interpolating paid ship, then ends legacy behavior at its next load", async () => {
    const seed = 42, settings = { ...defaultLobbySettings("migration", 250), aiCount: 1, tribeCount: 0 };
    const loaded = await loadServerMap(settings, undefined, seed), m = loaded.map;
    const map = () => createSkirmishMap(m.width, m.height, m.terrain.slice(), structuredClone(m.elevation), structuredClone(m.forest), structuredClone(m.resourceTerrain));
    const options = { seed, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const, deferredPlanning: true };
    const game = new Skirmish(map(), options);
    for (const building of [...game.buildings]) game.removeBuilding(building.id);
    for (const squad of [...game.squads]) game.removeSquad(squad.id);
    let sourceTile = -1, receiverTile = -1, path: number[] = [];
    for (let tile = 0; tile < m.width * m.height && !path.length; tile++) {
      if (game.map.isWater(tile) || game.map.isImpassable(tile)) continue;
      const start = portWaterTiles(game.map, tile)[0]; if (start === undefined) continue;
      for (let dx = 3; dx < 16 && !path.length; dx++) {
        const x = game.map.x(tile) + dx, y = game.map.y(tile);
        if (!game.map.isValidCoord(x, y)) continue;
        const goalPort = game.map.ref(x, y); if (game.map.isWater(goalPort) || game.map.isImpassable(goalPort)) continue;
        const goal = portWaterTiles(game.map, goalPort).find(next => game.waterPaths.connected(start, next));
        if (goal === undefined || goal === start) continue;
        const route = game.waterPaths.find(start, goal, undefined, 4096);
        if (route && route.length > 2) { path = route; sourceTile = tile; receiverTile = goalPort; }
      }
    }
    expect(path.length).toBeGreaterThan(2);
    const add = (type: "port" | "city", tile: number, playerId: number) => game.addBuilding({ id: game.allocateId(), type, tile, playerId, remainingTicks: 0, age: "StoneAge" });
    const source = add("port", sourceTile, 1), receiver = add("port", receiverTile, 2);
    add("city", sourceTile, 1); add("city", receiverTile, 2);
    game.owners.fill(1); game.owners[receiverTile] = 2;
    const e = game.expansion!; e.progression.states[1].completed.push("rus-stoneage-port-sea-trade"); e.supply.goods.set(source.id, 100);
    const actor: TradeActor = { id: game.allocateId(), playerId: 1, factoryId: source.id, originPortId: source.id,
      definitionId: "stoneage-trade", naval: true,
      x: (game.map.x(path[0]) + game.map.x(path[1]) + 1) * FIXED / 2,
      y: (game.map.y(path[0]) + game.map.y(path[1]) + 1) * FIXED / 2,
      cargo: 17, loaded: 20, delivered: 3, lost: 0, returned: 0, valuePerGood: 20,
      originTile: sourceTile, capacity: 20, shipmentId: 1, stops: [receiver.id], visited: [], quoteAllies: [],
      tripStartedTick: 0, tripGold: 180, destination: receiver.id, state: "outbound", path, nextPathIndex: 1, waitTicks: 0 };
    e.trade.actors.push(actor); e.trade.deliveredGold[1] = 180; game.players[0].gold += 180;
    const checkpoint = game.checkpoint(); checkpoint.expansion!.trade.nextShipment = 2;
    const folder = mkdtempSync(join(tmpdir(), "sea-trade-conversion-"));
    try {
      mkdirSync(folder, { recursive: true }); const input = join(folder, "old.v8"), output = join(folder, "new.v8");
      writeFileSync(input, serialize({ seed, settings, options, checkpoint }));
      const manifest = await convertSeaTradeFixture(input, output, "ea9514b1");
      expect(manifest.convertedLegs).toBe(1); expect(manifest.legacyVoyages).toBe(1);
      const converted = deserialize(readFileSync(output)); const next = new Skirmish(map(), converted.options); next.restore(converted.checkpoint);
      const ship = next.expansion!.trade.actors.find(a => a.id === actor.id)!;
      expect(ship).toMatchObject({ x: actor.x, y: actor.y, cargo: 17, delivered: 3, shipmentId: 1 });
      expect(next.expansion!.supply.goods.get(source.id)).toBe(100);
      expect(next.expansion!.trade.seaTrade!.voyages.get(ship.id)!.legacyVoyage).toBe(true);
      for (let i = 0; i < 1000 && ship.shipmentId === 1; i++) next.step();
      expect(ship.shipmentId).toBeGreaterThan(1);
      expect(next.expansion!.trade.seaTrade!.voyages.get(ship.id)!.legacyVoyage).toBe(false);
      await expect(convertSeaTradeFixture(input, input, "ea9514b1")).rejects.toThrow("already exists");
      await expect(convertSeaTradeFixture(input, output, "ea9514b1")).rejects.toThrow("already exists");
    } finally {
      if (resolve(folder).startsWith(resolve(tmpdir()) + sep + "sea-trade-conversion-")) rmSync(folder, { recursive: true, force: true });
    }
  }, 30000);
});
