import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { AmphibiousPaths } from "../../src/skirmish/Pathfinding";
import { EMBARK_COST } from "../../src/skirmish/PathTopology";
import { VESSEL } from "../../src/skirmish/content/Units";
import { ARMY_TECHNOLOGY } from "../../src/skirmish/content/Armies";
import { retainSquads } from "./UnitFixtures";
import type { Ship } from "../../src/skirmish/Protocol";
import { DamageLedger } from "../../src/skirmish/Conquest";

/** 100x70 land with a water channel across columns 40..49 (rows 0..69). */
function channelMap(channel = (x: number, _y: number) => x >= 40 && x < 50) {
  const width = 100, height = 70, data = new Uint8Array(width * height).fill(133);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (channel(x, y)) data[y * width + x] = 0;
  return new GameMapImpl(width, height, data, data.length);
}
function fixture(options: { deferredPlanning?: boolean } = {}) {
  const map = channelMap();
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: options.deferredPlanning ?? true });
  const template = match.squads.find(s => s.playerId === 1)!;
  const [squad] = retainSquads(match, [...match.squads.filter(s => s.playerId !== 1), {
    ...template, id: match.allocateId(), x: 20.5 * FIXED, y: 35.5 * FIXED, order: { type: "hold" as const }, path: [], queuedOrders: [],
  }]).filter(s => s.playerId === 1);
  return { map, match, squad };
}

describe("amphibious paths", () => {
  it("cross water as one graph, charging embarkation only at the shoreline", () => {
    const map = channelMap(), paths = new AmphibiousPaths(map, false);
    const start = map.ref(30, 35), goal = map.ref(60, 35);
    expect(paths.connected(start, goal)).toBe(true);
    const route = paths.find(start, goal)!;
    expect(route[route.length - 1]).toBe(goal);
    const transitions = [start, ...route].filter((tile, i, all) => i && map.isLand(tile) !== map.isLand(all[i - 1]));
    expect(transitions).toHaveLength(2);
    // Every land/water change is a cardinal step: no diagonal cuts a coastline.
    for (let i = 1; i < route.length; i++)
      if (map.isLand(route[i]) !== map.isLand(route[i - 1]))
        expect(map.x(route[i]) === map.x(route[i - 1]) || map.y(route[i]) === map.y(route[i - 1])).toBe(true);
    expect(EMBARK_COST).toBeGreaterThan(0);
  });
});

describe("amphibious squads", () => {
  it("cross a channel as their faction's transport and land as soldiers", () => {
    const { map, match, squad } = fixture();
    expect(match.amphibious(1)).toBe(true);
    const vessel = match.transportVessel(1)!;
    expect(vessel.kind).toBe("transport");
    const troops = squad.troops;
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(70, 35) } })).toBeNull();
    let embarked = -1, landed = -1;
    for (let tick = 0; tick < 1500 && landed < 0; tick++) {
      match.step();
      const live = match.squad(squad.id)!;
      if (live.afloat && embarked < 0) {
        embarked = tick;
        expect(live.afloat).toEqual({ hull: vessel.health, maxHull: vessel.health, vesselId: vessel.id });
        expect(map.isLand(map.ref(Math.floor(live.x / FIXED), Math.floor(live.y / FIXED)))).toBe(false);
      }
      if (embarked >= 0 && !live.afloat && live.x > 50 * FIXED) landed = tick;
    }
    expect(embarked).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(embarked);
    const live = match.squad(squad.id)!;
    expect(live.troops).toBe(troops);
    for (let tick = 0; tick < 600 && live.order.type !== "hold"; tick++) match.step();
    expect(Math.abs(live.x - 70.5 * FIXED)).toBeLessThan(2 * FIXED);
  });

  it("moves on water at the transport's speed", () => {
    const { match, squad } = fixture();
    match.updateSquad(squad.id, { x: 44.5 * FIXED, y: 35.5 * FIXED });
    match.step();
    const live = match.squad(squad.id)!;
    expect(live.afloat).toBeTruthy();
    expect(match.ordinarySpeed(live)).toBe(match.transportVessel(1)!.speed);
  });

  it("orders a squad onto open water, where it stays afloat", () => {
    const { map, match, squad } = fixture();
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(45, 20) } })).toBeNull();
    for (let tick = 0; tick < 1000 && (tick < 5 || match.squad(squad.id)!.order.type !== "hold"); tick++) match.step();
    const live = match.squad(squad.id)!;
    expect(live.afloat?.hull).toBe(match.transportVessel(1)!.health);
    expect(Math.hypot(live.x - 45.5 * FIXED, live.y - 20.5 * FIXED)).toBeLessThan(2 * FIXED);
  });

  it("keeps factions without transport technology on their landmass", () => {
    const { map, match, squad } = fixture();
    const progression = match.expansion!.progression.states[1];
    progression.completed = progression.completed.filter(id => !VESSEL.has(`stoneage-transport`) || id !== VESSEL.get("stoneage-transport")!.technologyId);
    expect(match.amphibious(1)).toBe(false);
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(70, 35) } }))
      .toMatch(/Cargo Canoes/);
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(45, 35) } }))
      .toMatch(/Cargo Canoes/);
  });

  it("stays deterministic through checkpoint and restore mid-crossing", () => {
    const { map, match, squad } = fixture();
    match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(70, 35) } });
    for (let tick = 0; tick < 1500 && !match.squad(squad.id)!.afloat; tick++) match.step();
    expect(match.squad(squad.id)!.afloat).toBeTruthy();
    const clone = new Skirmish(map, match.options);
    clone.restore(match.checkpoint());
    for (let tick = 0; tick < 200; tick++) { match.step(); clone.step(); }
    expect(clone.checkpoint()).toEqual(match.checkpoint());
  });

});

function warship(match: Skirmish, x: number, y: number, playerId = 2): Ship {
  return match.addShip({
    id: match.allocateId(), playerId, kind: "warship", definitionId: "stoneage-warship",
    x: (x + 0.5) * FIXED, y: (y + 0.5) * FIXED, health: 1000, destination: null, waypoints: [],
    path: [], nextPathIndex: 0, fighting: false
  });
}
describe("afloat combat", () => {
  it("absorbs hits on the hull, leaving the soldiers aboard untouched until it fails", () => {
    const { match, squad } = fixture();
    match.updateSquad(squad.id, { x: 44.5 * FIXED, y: 35.5 * FIXED });
    match.step();
    const afloat = match.squad(squad.id)!.afloat!, troops = squad.troops;
    const hit = new DamageLedger();
    hit.add(squad.id, 2, afloat.hull - 1);
    match.resolveLandDamage(hit);
    expect(match.squad(squad.id)!.afloat!.hull).toBe(1);
    expect(match.squad(squad.id)!.troops).toBe(troops);
    const losses = match.player(1)!.losses, kills = match.player(2)!.kills ?? 0;
    const sink = new DamageLedger();
    sink.add(squad.id, 2, 5);
    match.resolveLandDamage(sink);
    expect(match.squad(squad.id)).toBeUndefined();
    expect(match.player(1)!.losses - losses).toBe(troops);
    expect((match.player(2)!.kills ?? 0) - kills).toBe(troops);
  });

  it("is sunk by warship fire with every soldier aboard", () => {
    const { match, squad } = fixture();
    match.updateSquad(squad.id, { x: 44.5 * FIXED, y: 35.5 * FIXED });
    match.step();
    expect(match.squad(squad.id)!.afloat).toBeTruthy();
    const troops = squad.troops, losses = match.player(1)!.losses;
    warship(match, 46, 35);
    for (let tick = 0; tick < 2000 && match.squad(squad.id); tick++) {
      match.step();
      const live = match.squad(squad.id);
      if (live) expect(live.troops).toBe(troops);
    }
    expect(match.squad(squad.id)).toBeUndefined();
    expect(match.player(1)!.losses - losses).toBe(troops);
  });

  it("neither attacks from the water nor can be struck by soldiers ashore", () => {
    const { match, squad } = fixture();
    match.updateSquad(squad.id, { x: 40.5 * FIXED, y: 35.5 * FIXED });
    const enemy = match.squads.find(s => s.playerId === 2)!;
    match.updateSquad(enemy.id, { x: 39.5 * FIXED, y: 35.5 * FIXED, order: { type: "hold" }, path: [] });
    const troops = { own: squad.troops, enemy: enemy.troops };
    for (let tick = 0; tick < 200; tick++) {
      match.updateSquad(squad.id, { x: 40.5 * FIXED, y: 35.5 * FIXED, order: { type: "hold" }, path: [] });
      match.updateSquad(enemy.id, { x: 39.5 * FIXED, y: 35.5 * FIXED, order: { type: "hold" }, path: [] });
      match.step();
    }
    const own = match.squad(squad.id)!, foe = match.squad(enemy.id)!;
    expect(own.afloat?.hull).toBe(own.afloat?.maxHull);
    expect(own.troops).toBe(troops.own);
    expect(foe.troops).toBe(troops.enemy);
  });

  it("presses no territorial claim while afloat", () => {
    const { map, match, squad } = fixture();
    match.updateSquad(squad.id, { x: 41.5 * FIXED, y: 20.5 * FIXED });
    const before = match.owners.slice();
    for (let tick = 0; tick < 300; tick++) {
      match.updateSquad(squad.id, { x: 41.5 * FIXED, y: 20.5 * FIXED, order: { type: "hold" }, path: [] });
      match.step();
    }
    for (let y = 15; y <= 25; y++) for (let x = 36; x <= 46; x++)
      expect(match.owners[map.ref(x, y)]).toBe(before[map.ref(x, y)]);
  });
});

function westBankSquads(match: Skirmish, count: number) {
  const template = match.squads.find(s => s.playerId === 1)!;
  return retainSquads(match, [...match.squads.filter(s => s.playerId !== 1), ...Array.from({ length: count }, (_, i) => ({
    ...template, id: match.allocateId(), x: Math.round((14.5 + (i % 6) * 1.5) * FIXED), y: Math.round((26.5 + Math.floor(i / 6) * 1.5) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  }))]).filter(s => s.playerId === 1);
}

describe("amphibious orders", () => {
  it("issues each embarkation the best researched transport's hull", () => {
    const { match, squad } = fixture();
    const bronze = VESSEL.get("bronzeage-transport")!;
    match.expansion!.progression.states[1].completed.push(bronze.technologyId);
    const vessel = match.transportVessel(1)!;
    expect(vessel.id).toBe("bronzeage-transport");
    expect(vessel.health).toBeGreaterThanOrEqual(bronze.health);
    match.updateSquad(squad.id, { x: 44.5 * FIXED, y: 35.5 * FIXED });
    match.step();
    expect(match.squad(squad.id)!.afloat).toEqual({ hull: vessel.health, maxHull: vessel.health, vesselId: "bronzeage-transport" });
  });

  it("keeps a Shift-queued leg on the far bank through the crossing", () => {
    const { map, match, squad } = fixture();
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(60, 35) } })).toBeNull();
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(70, 50) }, append: true })).toBeNull();
    let crossed = false;
    for (let tick = 0; tick < 2500; tick++) {
      match.step();
      const live = match.squad(squad.id)!;
      if (live.afloat) crossed = true;
      if (crossed && tick > 10 && live.order.type === "hold") break;
    }
    const live = match.squad(squad.id)!;
    expect(crossed).toBe(true);
    expect(live.afloat ?? null).toBeNull();
    expect(Math.hypot(live.x - 70.5 * FIXED, live.y - 50.5 * FIXED)).toBeLessThan(3 * FIXED);
  });

  it("carries a thirty-squad selection across the water without rejection", () => {
    const { map, match } = fixture();
    const squads = westBankSquads(match, 30);
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: squads.map(s => s.id), order: { type: "move", tile: map.ref(70, 35) } })).toBeNull();
    for (let tick = 0; tick < 3000 && squads.some(s => match.squad(s.id)!.x < 55 * FIXED); tick++) match.step();
    expect(match.movementAdmission.events.some(e => e.playerId === 1 && e.status === "rejected")).toBe(false);
    for (const s of squads) {
      const live = match.squad(s.id)!;
      expect(live.x).toBeGreaterThan(55 * FIXED);
      expect(live.afloat ?? null).toBeNull();
    }
  });

  it("marches an army across the water as one formation", () => {
    const { map, match } = fixture();
    const squads = westBankSquads(match, 4);
    match.expansion!.progression.states[1].completed.push(ARMY_TECHNOLOGY);
    expect(match.applyCommand({ type: "create-army", playerId: 1, squadIds: squads.map(s => s.id) })).toBeNull();
    const army = match.expansion!.armies.armyOf(squads[0].id)!;
    expect(match.applyCommand({ type: "army-order", playerId: 1, armyId: army.id, order: { type: "move", tile: map.ref(70, 35) } })).toBeNull();
    let afloat = false;
    for (let tick = 0; tick < 3000 && squads.some(s => match.squad(s.id)!.x < 60 * FIXED); tick++) {
      match.step();
      afloat ||= squads.some(s => !!match.squad(s.id)!.afloat);
    }
    expect(afloat).toBe(true);
    for (const s of squads) expect(match.squad(s.id)!.x).toBeGreaterThanOrEqual(60 * FIXED);
  });

  it("lands soldiers who capture the far bank with every troop accounted for", () => {
    const { map, match, squad } = fixture();
    const landing = map.ref(60, 35), troops = squad.troops;
    match.owners[landing] = 0;
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: landing } })).toBeNull();
    for (let tick = 0; tick < 2000 && match.owners[landing] !== 1; tick++) match.step();
    const live = match.squad(squad.id)!;
    expect(match.owners[landing]).toBe(1);
    expect(live.afloat ?? null).toBeNull();
    expect(live.troops).toBe(troops);
  });
});

