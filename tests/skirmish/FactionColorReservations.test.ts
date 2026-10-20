import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { createEmpireProfile } from "../../src/skirmish/lobby/EmpireProfile";
import { RoomCoordinator } from "../../src/skirmish/multiplayer/domain/RoomCoordinator";
import { LOBBY_MAP_IDS } from "../../src/skirmish/lobby/LobbyRules";
import { clientMessageSchema } from "../../src/skirmish/multiplayer/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

describe("faction color choices", () => {
  it("lets several players join and play with the same color", () => {
    const rooms = new RoomCoordinator(0, 1),
      id = `default-${LOBBY_MAP_IDS[0]}`;
    const a = createEmpireProfile("A", null, 1),
      b = createEmpireProfile("B", null, 2);
    rooms.join(id, "a", a, 0);
    rooms.join(id, "b", b, 0);
    // A third player with A's color joins; B switches to it as well.
    rooms.join(id, "c", createEmpireProfile("C", null, 1), 1);
    rooms.updateProfile("b", { ...b, colorIndex: 1 });
    const members = rooms.snapshot().rooms.find((r) => r.id === id)!.members;
    expect(members.map((m) => m.profile.colorIndex)).toEqual([1, 1, 1]);
    const restored = new RoomCoordinator(2, 1, rooms.snapshot());
    for (const guest of ["a", "b", "c"]) restored.voteToStart(id, guest);
    expect(restored.advance(3)[0].members.map((m) => m.profile.colorIndex)).toEqual([1, 1, 1]);
  });
  it("accepts legacy profiles and Automatic but rejects invalid palette indices at both boundaries", () => {
    expect(createEmpireProfile("Old", null)).toEqual({
      name: "Old",
      flagCode: null,
    });
    expect(createEmpireProfile("Auto", null, null).colorIndex).toBeNull();
    for (const colorIndex of [-1, 20, 1.5, "red"])
      expect(() =>
        createEmpireProfile("Bad", null, colorIndex as number),
      ).toThrow(/palette/);
    expect(
      clientMessageSchema.safeParse({
        type: "profile",
        requestId: "test",
        profile: { name: "A", flagCode: null, colorIndex: 19 },
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "profile",
        requestId: "test",
        profile: { name: "A", flagCode: null, colorIndex: 20 },
      }).success,
    ).toBe(false);
  });
  it("carries reserved colors through simulation snapshots, compact packets and checkpoint restore", () => {
    const data = new Uint8Array(64 * 40).fill(133);
    const options = {
      seed: 42,
      aiCount: 1,
      humanNames: ["A", "B"],
      humanColors: [4, null],
      runAi: false,
    };
    const match = new Skirmish(
      new GameMapImpl(64, 40, data, data.length),
      options,
    );
    expect(match.players[0].colorIndex).toBe(4);
    expect(match.players[0].colorKind).toBe("regular");
    expect(match.players[1].colorIndex).toBeUndefined();
    const packet = new SnapshotEncoder().encode(match.snapshot());
    expect(new SnapshotDecoder().decode(packet).players[0].colorIndex).toBe(4);
    const restored = new Skirmish(
      new GameMapImpl(64, 40, data, data.length),
      options,
    );
    restored.restore(match.checkpoint());
    expect(restored.players[0].colorIndex).toBe(4);
    // Two humans may share a color; an invalid palette index still fails.
    const shared = new Skirmish(new GameMapImpl(64, 40, data, data.length), {
      ...options,
      humanColors: [4, 4],
    });
    expect(shared.players.slice(0, 2).map((p) => p.colorIndex)).toEqual([4, 4]);
    expect(
      () =>
        new Skirmish(new GameMapImpl(64, 40, data, data.length), {
          ...options,
          humanColors: [4, 99],
        }),
    ).toThrow(/palette/);
  });
});
