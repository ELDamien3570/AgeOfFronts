import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import {
  ATOMIC_ATTACK,
  BOMBER_ATTACK,
  STRATEGIC_PAYLOADS,
} from "../../src/skirmish/content/ModernWeapons";

const PAYLOADS = ["bomb", "atomic", "icbm", "hydrogen", "warhead"] as const;
type Payload = (typeof PAYLOADS)[number];
const TARGET = { x: 60.5 * FIXED, y: 40.5 * FIXED };

function profile(payload: Payload) {
  if (payload === "bomb") return BOMBER_ATTACK;
  if (payload === "atomic") return ATOMIC_ATTACK;
  const definition = STRATEGIC_PAYLOADS[payload === "warhead" ? "mirv" : payload];
  return {
    ...BOMBER_ATTACK,
    damage: definition.damage,
    projectile: {
      ...BOMBER_ATTACK.projectile!,
      blastRadius: definition.blastRadius,
    },
  };
}

function fixture(aiCount = 2) {
  const data = new Uint8Array(120 * 80).fill(133);
  for (let y = 60; y < 65; y++) data.fill(0, y * 120, (y + 1) * 120);
  const game = new Skirmish(new GameMapImpl(120, 80, data, data.length), {
    seed: 42,
    aiCount,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    diplomacyRules: "raids-v1",
  });
  for (const building of [...game.buildings]) game.removeBuilding(building.id);
  const add = (owner: number, type: "city" | "factory" | "port", x: number, y: number) => {
    const building = game.addBuilding({
      id: game.allocateId(), playerId: owner, type, tile: game.map.ref(x, y),
      remainingTicks: 0, age: "StoneAge", health: 100, maxHealth: 100,
    });
    game.owners[building.tile] = owner;
    return building;
  };
  return { game, add };
}

function warmTrade(game: Skirmish) {
  game.restore(game.checkpoint());
  game.tick = secondsToTicks(1);
  game.expansion!.trade.step();
}

function fire(game: Skirmish, payload: Payload, attacker = 1) {
  const attack = profile(payload);
  // Insert the projectile at its target to exercise real impact and end-of-tick
  // defeat processing without spending the test on aircraft/missile travel.
  expect(game.expansion!.battle.fire(
    { id: 999999, playerId: attacker, ...TARGET, domain: "aircraft" },
    TARGET, attack, attack.damage,
    payload === "atomic" ? "bomb" : payload === "hydrogen" ? "icbm" : payload,
    1, 0, payload,
  )).toBeTruthy();
}

function publisher() {
  // Match the local browser worker, including borrowed trader encoding.
  const encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true });
  const decoder = new SnapshotDecoder();
  return (game: Skirmish) => decoder.decode(encoder.encode(
    game.replicationSource(true), game.tileChanges, game.replicationFacts(),
  ));
}

describe("explosion ownership and publication lifecycle", () => {
  for (const payload of PAYLOADS) {
    it.each(["raid", "war", "self"] as const)(`${payload} publishes and continues after faction defeat (%s)`, mode => {
      const { game, add } = fixture();
      for (const squad of game.squads) game.updateSquad(squad.id, {
        ...(squad.playerId === 2 ? TARGET : { x: (10.5 + squad.playerId * 5) * FIXED, y: 70.5 * FIXED }),
        order: { type: "hold" },
      });
      add(1, "city", 15, 70); add(3, "city", 25, 70); add(2, "city", 60, 40);
      const factory = add(2, "factory", 85, 15), port = add(2, "port", 85, 59);
      warmTrade(game);
      if (mode === "war") game.expansion!.diplomacy.establishWar(1, 2, game.tick);
      else if (mode === "raid") game.expansion!.diplomacy.recordTheft(1, 2, game.tick);
      expect(game.expansion!.trade.siteSnapshot().filter(site => site.playerId === 2)).toHaveLength(3);
      fire(game, payload, mode === "self" ? 2 : 1);
      for (let i = 0; i < 20 && !game.player(2)!.eliminated; i++) game.step();
      expect(game.player(2)!.eliminated).toBe(true);
      const owner = mode === "war" ? 1 : 0;
      for (const source of [factory, port]) expect(game.building(source.id)!.playerId).toBe(owner);
      const publish = publisher();
      for (let i = 0; i < secondsToTicks(5); i++) {
        const before = game.expansion!.trade.checkpoint();
        const snapshot = publish(game);
        expect(snapshot.expansion!.tradeSites!.some(site => site.playerId === 0 || site.playerId === 2)).toBe(false);
        expect(game.expansion!.trade.checkpoint()).toEqual(before);
        game.step();
      }
    });
  }

  it.each(PAYLOADS)("publishes 14 simultaneous defeats from %s and restores the result", payload => {
    const { game, add } = fixture(14);
    for (const squad of game.squads) game.updateSquad(squad.id, {
      ...(squad.playerId === 1 ? { x: 5.5 * FIXED, y: 5.5 * FIXED } : TARGET),
      order: { type: "hold" },
    });
    for (const player of game.players) {
      add(player.id, "city", player.id === 1 ? 5 : 60, player.id === 1 ? 5 : 40);
      add(player.id, "factory", player.id + 5, 70);
    }
    warmTrade(game);
    fire(game, payload);
    for (let i = 0; i < 20 && game.players.some(player => player.id !== 1 && !player.eliminated); i++) game.step();
    expect(game.players.filter(player => player.eliminated)).toHaveLength(14);
    expect(game.buildings.some(building => building.playerId !== 0 && building.playerId !== 1)).toBe(false);
    const snapshot = publisher()(game);
    const cold = new Skirmish(game.map, game.options);
    cold.restore(game.checkpoint());
    expect(publisher()(cold).expansion!.tradeSites).toEqual(snapshot.expansion!.tradeSites);
  });

  for (const payload of ["atomic", "icbm", "hydrogen", "warhead"] as const) {
    it.each(["raid", "war"] as const)(`${payload} resolves surviving fallout-edge buildings on defeat (%s)`, mode => {
      const { game, add } = fixture();
      for (const squad of game.squads) game.updateSquad(squad.id, {
        ...(squad.playerId === 2 ? TARGET : { x: (10.5 + squad.playerId * 5) * FIXED, y: 70.5 * FIXED }),
        order: { type: "hold" },
      });
      add(1, "city", 15, 70); add(3, "city", 25, 70); add(2, "city", 60, 40);
      const radius = profile(payload).projectile!.blastRadius / FIXED;
      const edge = add(2, "factory", 60 + Math.ceil(radius * .9), 40);
      game.updateBuilding(edge.id, { health: 1200, maxHealth: 1200 });
      warmTrade(game);
      if (mode === "war") game.expansion!.diplomacy.establishWar(1, 2, game.tick);
      else game.expansion!.diplomacy.recordTheft(1, 2, game.tick);
      fire(game, payload);
      for (let i = 0; i < 20 && !game.player(2)!.eliminated; i++) game.step();
      expect(game.player(2)!.eliminated).toBe(true);
      expect(game.owners[edge.tile]).toBe(0);
      expect(game.wasteland.has(edge.tile)).toBe(true);
      expect(game.building(edge.id)).toMatchObject({ playerId: mode === "war" ? 1 : 0 });
      const health = game.building(edge.id)!.health!;
      expect(health).toBeGreaterThan(0);
      expect(health).toBeLessThan(1200);
      expect(game.buildings.some(building => building.playerId === 2)).toBe(false);
      const snapshot = publisher()(game);
      const cold = new Skirmish(game.map, game.options);
      cold.restore(game.checkpoint());
      expect(cold.building(edge.id)).toEqual(game.building(edge.id));
      expect(publisher()(cold).expansion!.fallout).toEqual(snapshot.expansion!.fallout);
    });
  }
});
