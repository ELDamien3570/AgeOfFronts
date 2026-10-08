import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import type { Snapshot, SnapshotPacket } from "../../src/skirmish/Protocol";
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

function fixture() {
  const terrain = new Uint8Array(64 * 48).fill(133);
  return new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1",
  });
}
describe("transferable snapshot details", () => {
  it("preserves precision, absent/null/false values and every combat/movement/refit field", async () => {
    const game = fixture(),
      original = game.squads[0];
    const squads = [
      {
        ...original,
        xp: 1.125,
        deploymentTicks: 20,
        nextAttackTick: 60,
        lastAttackTick: 15,
        planningPaused: false,
        movementStatus: {
          reason: "crowd" as const,
          since: 9,
          blockerIds: [77, 88],
        },
        refit: {
          targetId: "next-definition",
          remainingTicks: 3,
          totalTicks: 12,
        },
        charge: {
          phase: "committed" as const,
          x: -0,
          y: 500.25,
          startTick: 3,
          committedTick: 4,
          targetId: 77,
        },
        chargeReadyTick: 90,
        structureTarget: { barrierId: 100 },
        afloat: { hull: 37.5, maxHull: 120, vesselId: "stoneage-transport" },
      },
      {
        ...original,
        id: original.id + 10_000,
        refit: null,
        charge: null,
        structureTarget: null,
        planningPaused: undefined,
        afloat: null,
      },
      {
        ...original,
        id: original.id + 20_000,
        afloat: undefined,
      },
    ];
    const buildings = [
      {
        id: 5001,
        playerId: 1,
        tile: 42,
        type: "city" as const,
        remainingTicks: 0,
        buildTicks: 5,
        age: "Modern" as const,
        health: 123.75,
        maxHealth: 500,
        nextAttackTick: 9,
        launchReadyTick: 100,
      },
    ];
    const ships: Snapshot["ships"] = [
      {
        id: 5000,
        playerId: 1,
        kind: "warship",
        x: 2.5,
        y: -0,
        health: 450.125,
        destination: null,
        waypoints: [22, 33],
        fighting: false,
        definitionId: "next-definition",
        xp: 1.5,
        planningPaused: false,
        refit: null,
        attackTargetId: null,
        lastPlanTick: 4,
        nextAttackTick: 8,
        patrolTile: undefined,
        repairPortId: null,
        repairState: "waiting-for-dock",
      },
    ];
    const volleys = [
      {
        id: 999,
        tick: 17,
        squadId: original.id,
        playerId: 1,
        definitionId: "next-definition",
        fromX: -0,
        fromY: 4.5,
        toX: 123,
        toY: 555,
      },
    ];
    const packed = packSnapshotDetails(squads, buildings, ships, volleys);
    validateSnapshotDetails(packed);
    expect(
      packed.strings.filter((value) => value === "next-definition"),
    ).toHaveLength(1);
    const decoded = unpackSnapshotDetails(packed);
    for (let at = 0; at < squads.length; at++)
      for (const key of [
        "xp",
        "deploymentTicks",
        "lastAttackTick",
        "nextAttackTick",
        "planningPaused",
        "movementStatus",
        "refit",
        "charge",
        "chargeReadyTick",
        "structureTarget",
        "afloat",
      ] as const)
        expect(decoded.squadDetails![at][key]).toEqual(squads[at][key]);
    expect(decoded.ships).toEqual(ships);
    expect(decoded.volleys).toEqual(volleys);
    expect(decoded.buildingDetails![0]).toMatchObject({
      id: buildings[0].id,
      health: 123.75,
      launchReadyTick: 100,
    });
    expect(Object.is(decoded.squadDetails![0].charge!.x, -0)).toBe(true);
    const wire = await encodeState(packed);
    expect(
      unpackSnapshotDetails((await decodeState(wire)) as typeof packed),
    ).toEqual(decoded);
  });
  it("transfers owned buffers without detaching simulation roads or breaking later deltas", () => {
    const game = fixture(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const packet = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    const before = game.checkpoint();
    const received = structuredClone(packet, {
      transfer: snapshotTransfers(packet),
    });
    expect(packet.details!.squads!.byteLength).toBe(0);
    expect(decoder.decode(received).squads).toHaveLength(game.squads.length);
    expect(game.checkpoint()).toEqual(before);
    game.updateSquad(game.squads[0].id, { x: game.squads[0].x + 1 });
    const delta = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    expect(
      decoder.decode(
        structuredClone(delta, { transfer: snapshotTransfers(delta) }),
      ).squads[0].x,
    ).toBe(game.squads[0].x);
  });
  it("rejects corrupt strides, ranges, enums and strings before canonical state changes", () => {
    const game = fixture(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const baseline = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    decoder.decode(baseline);
    for (const corrupt of [
      (p: SnapshotPacket) => {
        p.details!.squads = p.details!.squads!.slice(1);
      },
      (p: SnapshotPacket) => {
        p.details!.squads![9] = -1;
      },
      (p: SnapshotPacket) => {
        p.details!.squads![7] = 99;
      },
      (p: SnapshotPacket) => {
        p.details!.squads![1] = 999_999;
      },
    ]) {
      const packet = structuredClone(baseline);
      corrupt(packet);
      expect(() => decoder.decode(packet)).toThrow(/packed snapshot/);
      expect(decoder.decode(baseline).squads[0].x).toBe(game.squads[0].x);
    }
  });
  it("continues to read legacy entity object packets", () => {
    const game = fixture(),
      packet = new SnapshotEncoder().encode(game.replicationSource());
    const records = unpackSnapshotDetails(packet.details!);
    const legacy = { ...packet, ...records, details: undefined };
    expect(new SnapshotDecoder().decode(legacy)).toEqual(
      new SnapshotDecoder().decode(packet),
    );
  });
});
