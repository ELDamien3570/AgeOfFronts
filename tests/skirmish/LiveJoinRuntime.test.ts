import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Age } from "../../src/skirmish/domain/Definitions";
import type { MatchRouteTask } from "../../src/skirmish/domain/RouteTask";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type {
  JoinBarrier,
  MatchAdvance,
  SeatStatus,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function match(startingAge: Age = "StoneAge") {
  const terrain = new Uint8Array(16000).fill(133);
  return new Skirmish(new GameMapImpl(160, 100, terrain, terrain.length), {
    seed: 77,
    aiCount: 2,
    humanNames: ["First", "Second"],
    ruleset: "ages-v1",
    tribes: true,
    tribeCount: 1,
    startingAge,
  });
}
describe("atomic live-join runtime", () => {
  it("advances the shared comparison cursor at S so ownership/claims/production changes back cannot be omitted", () => {
    const m = match(),
      encoder = new SnapshotEncoder(true),
      old = new SnapshotDecoder(),
      fresh = new SnapshotDecoder();
    m.owners[25] = 1;
    m.claims[25] = 1;
    m.progress[25] = 1;
    old.decode(encoder.encode(m.snapshot()));
    m.owners[25] = 2;
    m.claims[25] = 2;
    m.progress[25] = 2;
    const aligned = encoder.encodeJoinBarrier(m.snapshot());
    expect(old.decode(aligned.shared).owners[25]).toBe(2);
    expect(fresh.decode(aligned.baseline).owners[25]).toBe(2);
    m.owners[25] = 1;
    m.claims[25] = 1;
    m.progress[25] = 1;
    const packet = encoder.encode(m.snapshot());
    expect([...packet.tiles]).toContain(25);
    const a = old.decode(packet),
      b = fresh.decode(packet);
    expect(a.owners).toEqual(b.owners);
    expect(a.claims).toEqual(b.claims);
    expect(a.progress).toEqual(b.progress);
    expect(a.expansion).toEqual(b.expansion);
  });
  it("preserves every domain field while fencing stale AI proposals across human and AI control changes", () => {
    const m = match("BronzeAge"),
      p = m.players[2],
      before = m.checkpoint();
    expect(m.snapshot().expansion!.progression[p.id].age).toBe("BronzeAge");
    const target = m.squads.find((s) => s.playerId === p.id)!;
    const invoke = (
      m as unknown as { executeRouteTask(task: MatchRouteTask): void }
    ).executeRouteTask.bind(m);
    const spy = vi.spyOn(m, "applyCommand");
    const proposal: MatchRouteTask = {
      kind: "ai-move",
      playerId: p.id,
      squadIds: [target.id],
      tile: 8000,
      generation: 0,
    };
    m.setAiController(p.id, false);
    invoke(proposal);
    expect(spy).not.toHaveBeenCalled();
    const after = m.checkpoint();
    expect({
      ...after,
      players: before.players,
      controlGenerations: before.controlGenerations,
    }).toEqual(before);
    expect(
      after.players.map((player) => ({
        ...player,
        ai: before.players.find((p) => p.id === player.id)!.ai,
      })),
    ).toEqual(before.players);
    m.setAiController(p.id, true);
    invoke(proposal);
    expect(spy).not.toHaveBeenCalled();
    invoke({ ...proposal, generation: 2 });
    expect(spy).toHaveBeenCalledOnce();
  });
  it("real worker sends aligned same-tick baseline with research, economy, units and production unchanged", async () => {
    const worker = new ReservedMatchWorker();
    try {
      const initial = await worker.request<MatchAdvance>({
        type: "initialize",
        settings: defaultLobbySettings("africa"),
        map: {
          width: 160,
          height: 100,
          terrain: new Uint8Array(16000).fill(133),
        },
        options: {
          seed: 77,
          aiCount: 2,
          humanNames: ["First", "Second"],
          ruleset: "ages-v1",
          tribes: true,
          tribeCount: 1,
        },
      });
      const before = await worker.request<MatchAdvance>({
        type: "advance",
        ticks: 1,
        commands: [
          {
            id: "research",
            command: {
              type: "research",
              playerId: 1,
              technologyId: "stoneage-shorecraft",
            },
          },
        ],
        disconnectedPlayerIds: [],
        publish: true,
      });
      const decoder = new SnapshotDecoder();
      decoder.decode(await decodeState<SnapshotPacket>(initial.packet!));
      const beforeDecoded = decoder.decode(
        await decodeState<SnapshotPacket>(before.packet!),
      );
      await worker.request<SeatStatus>({
        type: "set-controller",
        playerId: 1,
        ai: true,
      });
      const joined = await worker.request<JoinBarrier>({
        type: "join-barrier",
        playerId: 1,
      });
      const baseline = await decodeState<SnapshotPacket>(joined.baseline),
        shared = await decodeState<SnapshotPacket>(joined.packet);
      expect(joined.tick).toBe(before.tick);
      expect(baseline.reset).toBe(true);
      expect(shared.reset).toBe(false);
      const full = new SnapshotDecoder().decode(baseline);
      expect(full.players).toEqual(beforeDecoded.players);
      expect(full.expansion).toEqual(beforeDecoded.expansion);
      expect(full.squads).toEqual(beforeDecoded.squads);
      expect(full.buildings).toEqual(beforeDecoded.buildings);
      expect(baseline.expansion!.productionPriorities).toEqual(
        beforeDecoded.expansion!.productionPriorities,
      );
      expect(
        Object.values(baseline.expansion!.progression[1].research).some(
          (job) => job?.technologyId === "stoneage-shorecraft",
        ),
      ).toBe(true);
      const status = await worker.request<SeatStatus>({ type: "seat-status" });
      const tribe = status.seats.find((s) => s.kind === "tribe")!;
      await expect(
        worker.request({ type: "join-barrier", playerId: tribe.playerId }),
      ).rejects.toThrow(/no longer available/);
      await expect(
        worker.request({ type: "join-barrier", playerId: 200 }),
      ).rejects.toThrow(/no longer available/);
    } finally {
      await worker.close();
    }
  });
});
