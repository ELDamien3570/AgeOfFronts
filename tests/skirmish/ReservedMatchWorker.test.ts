import { describe, expect, it, vi } from "vitest";
import { RUNTIME_PHASES } from "../../src/skirmish/RuntimeDiagnostics";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { MatchAdvance } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import type { EncodedState } from "../../src/skirmish/multiplayer/StateCodec";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";

const initialize = {
  type: "initialize" as const,
  settings: defaultLobbySettings("africa"),
  map: { width: 160, height: 100, terrain: new Uint8Array(16000).fill(133) },
  options: {
    seed: 77,
    aiCount: 0,
    humanNames: ["A", "B"],
    ruleset: "ages-v1" as const,
    tribes: false,
  },
};
const advance = (ticks: number, publish = true) => ({
  type: "advance" as const,
  ticks,
  commands: [],
  disconnectedPlayerIds: [],
  publish,
});

describe("reserved authoritative worker", () => {
  it("publishes committed human movement before the background snapshot deadline", async () => {
    const worker = new ReservedMatchWorker(), publications: {tick:number;packet:EncodedState}[] = [];
    const unsubscribe=worker.onPublication(publication=>publications.push(publication));
    try {
      const initial=await worker.request<MatchAdvance>({...initialize,streamPublications:true,
        options:{...initialize.options,deferredPlanning:true}});
      const decoder=new SnapshotDecoder(),state=decoder.decode(await decodeState<SnapshotPacket>(initial.packet!));
      const squad=state.squads.find(s=>s.playerId===1)!;
      let update=await worker.request<MatchAdvance>({...advance(1,false),commands:[{id:"prompt-move",
        command:{type:"order",playerId:1,squadIds:[squad.id],order:{type:"move",tile:80*160+120}}}]});
      if(!update.commandOutcomes?.some(o=>o.id==="prompt-move"&&o.status==="executed")) {
        expect(update.commandOutcomes).toContainEqual(expect.objectContaining({id:"prompt-move",status:"deferred"}));
        expect(publications).toHaveLength(0);
      }
      for(let at=0;at<100&&!update.commandOutcomes?.some(o=>o.id==="prompt-move"&&o.status==="executed");at++)
        update=await worker.request<MatchAdvance>(advance(1,false));
      expect(update.commandOutcomes).toContainEqual(expect.objectContaining({id:"prompt-move",status:"executed"}));
      await vi.waitFor(()=>expect(publications).toHaveLength(1));
      const visible=decoder.decode(await decodeState<SnapshotPacket>(publications[0].packet));
      expect(visible.tick).toBe(update.tick);
      expect(visible.squads.find(s=>s.id===squad.id)!.order.type).toBe("move");
      expect(visible.squads.find(s=>s.id===squad.id)!.x===squad.x&&visible.squads.find(s=>s.id===squad.id)!.y===squad.y).toBe(false);
      await worker.request(advance(1,false));
      await worker.request({type:"baseline"});
      expect(publications).toHaveLength(1);
    } finally {unsubscribe();await worker.close();}
  },20_000);

  it("reuses exact baselines and invalidates same-tick controller changes", async () => {
    const worker = new ReservedMatchWorker();
    try {
      await worker.request<MatchAdvance>(initialize);
      const first = await worker.request<EncodedState>({type: "baseline"});
      const second = await worker.request<EncodedState>({type: "baseline"});
      expect(second).toEqual(first);
      await worker.request({type: "set-controller", playerId: 1, ai: true});
      const changed = await worker.request<EncodedState>({type: "baseline"});
      expect(changed.hash).not.toBe(first.hash);
      const state = new SnapshotDecoder().decode(await decodeState<SnapshotPacket>(changed));
      expect(state.tick).toBe(0); expect(state.players[0].ai).toBe(true);
      const update = await worker.request<MatchAdvance>(advance(1));
      expect(update.diagnostics?.replication?.baselineCache).toEqual({hits: 1, misses: 2, retainedBytes: 0});
    } finally { await worker.close(); }
  }, 20_000);

  it("streams ordered coherent publications outside advance results and drains before join barriers", async () => {
    const worker = new ReservedMatchWorker(), publications: { tick: number; packet: EncodedState }[] = [];
    const unsubscribe = worker.onPublication(publication => publications.push(publication));
    try {
      const initial = await worker.request<MatchAdvance>({ ...initialize, streamPublications: true });
      const decoder = new SnapshotDecoder(); decoder.decode(await decodeState<SnapshotPacket>(initial.packet!));
      const first = await worker.request<MatchAdvance>({ ...advance(1), commands: [{ id: "coherent-research",
        command: { type: "research", playerId: 1, technologyId: "stoneage-shorecraft" } }] });
      expect(first.tick).toBe(1); expect(first.packet).toBeUndefined();
      const second = await worker.request<MatchAdvance>(advance(1, false)); expect(second.tick).toBe(2);
      const joined = await worker.request<import("../../src/skirmish/multiplayer/application/MatchExecutor").JoinBarrier>({ type: "join-barrier", playerId: 1 });
      expect(publications.map(p => p.tick)).toEqual([1]);
      const packet = await decodeState<SnapshotPacket>(publications[0].packet);
      expect(packet.tick).toBe(1);
      expect(packet.expansion!.progression![1].research.naval!.remainingTicks).toBe(359);
      decoder.decode(packet);
      const shared = decoder.decode(await decodeState<SnapshotPacket>(joined.packet));
      const baseline = new SnapshotDecoder().decode(await decodeState<SnapshotPacket>(joined.baseline));
      expect(shared.owners).toEqual(baseline.owners); expect(shared.squads).toEqual(baseline.squads);
      expect(shared.tick).toBe(2);
      expect(baseline.expansion!.progression![1].research.naval!.remainingTicks).toBe(358);
      await worker.request<MatchAdvance>(advance(3));
      await vi.waitFor(() => expect(publications.map(p => p.tick)).toEqual([1, 5]));
      expect((await decodeState<SnapshotPacket>(publications[1].packet)).tick).toBe(5);
    } finally { unsubscribe(); await worker.close(); }
  }, 20_000);
  it("correlates deferred execution and supersession, rejects oversized batches before advancing, and deduplicates completed commands", async () => {
    const worker = new ReservedMatchWorker();
    try {
      const initial = await worker.request<MatchAdvance>({
        ...initialize,
        options: { ...initialize.options, deferredPlanning: true },
      });
      const state = new SnapshotDecoder().decode(
        await decodeState<SnapshotPacket>(initial.packet!),
      );
      const ids = state.squads.filter((s) => s.playerId === 1).map((s) => s.id);
      const command = {
        type: "order" as const,
        playerId: 1,
        squadIds: ids,
        order: { type: "move" as const, tile: 80 * 160 + 120 },
      };
      await expect(
        worker.request({
          ...advance(1, false),
          commands: Array.from({ length: 101 }, (_, i) => ({
            id: `overflow-${i}`,
            command,
          })),
        }),
      ).rejects.toThrow("batch exceeds");
      let update = await worker.request<MatchAdvance>({
        ...advance(1, false),
        commands: [{ id: "original", command }],
      });
      expect(update.tick).toBe(1);
      expect(update.commandOutcomes).toContainEqual(
        expect.objectContaining({ id: "original", status: "deferred" }),
      );
      update = await worker.request<MatchAdvance>({
        ...advance(1, false),
        commands: [
          {
            id: "replacement",
            command: {
              ...command,
              order: { type: "move", tile: 65 * 160 + 115 },
            },
          },
        ],
      });
      expect(update.commandOutcomes).toContainEqual(
        expect.objectContaining({ id: "original", status: "superseded" }),
      );
      let executed = update.commandOutcomes?.find(
        (o) => o.id === "replacement" && o.status === "executed",
      );
      for (let i = 0; i < 100 && !executed; i++) {
        update = await worker.request<MatchAdvance>(advance(4, false));
        executed = update.commandOutcomes?.find(
          (o) => o.id === "replacement" && o.status === "executed",
        );
      }
      expect(executed).toBeDefined();
      update = await worker.request<MatchAdvance>({
        ...advance(1, false),
        commands: [{ id: "replacement", command }],
      });
      expect(update.commandOutcomes).toContainEqual(executed);
      expect(update.rejectedCommands).toEqual([]);
    } finally {
      await worker.close();
    }
  }, 20_000);
  it("runs directly, emits an initial baseline and independently scheduled presentation deltas", async () => {
    const worker = new ReservedMatchWorker();
    try {
      const initial = await worker.request<MatchAdvance>(initialize);
      expect(initial.tick).toBe(0);
      expect(await decodeState<SnapshotPacket>(initial.packet!)).toMatchObject({
        tick: 0,
        reset: true,
      });
      const quiet = await worker.request<MatchAdvance>(advance(1, false));
      expect(quiet.tick).toBe(1);
      expect(quiet.packet).toBeUndefined();
      const update = await worker.request<MatchAdvance>(advance(3));
      expect(await decodeState<SnapshotPacket>(update.packet!)).toMatchObject({
        tick: 4,
        reset: false,
      });
      expect(update.diagnostics).toMatchObject({ tick: 4, ticksAdvanced: 3, commands: 0 });
      expect(update.diagnostics!.timings.tick!.samples).toBe(4);
      expect(update.diagnostics!.memory.heapUsed).toBeGreaterThan(0);
      expect(update.diagnostics!.payloadBytes).toBe(update.packet!.binary!.byteLength);
      expect(update.packet!.payload).toBe("");
      expect(update.diagnostics!.retainedBytes).toBeLessThanOrEqual(RUNTIME_PHASES.length * 256 * 8);
      expect(update.diagnostics!.correlation).toMatchObject({ tick: 4, captureSequence: 2, runtime: process.version });
      for (const phase of ["pack", "json", "compression", "hash", "transfer"] as const)
        expect(update.diagnostics!.replication!.encoderTimings![phase]?.samples).toBeGreaterThan(0);
      expect(update.diagnostics!.replication!.encoderTimings!.base64).toBeUndefined();
      expect(update.diagnostics!.paths!.land.routeBytes).toBeGreaterThanOrEqual(0);
      expect(Object.keys(update).sort()).toEqual([
        "diagnostics",
        "packet",
        "rejectedCommands",
        "seats",
        "tick",
        "winner",
      ]);
      const baseline = await worker.request<EncodedState>({ type: "baseline" });
      expect(await decodeState<SnapshotPacket>(baseline)).toMatchObject({
        tick: 4,
        reset: true,
      });
      await expect(worker.request(advance(5))).rejects.toThrow(
        "Invalid match advance",
      );
      const next = await worker.request<MatchAdvance>(advance(1));
      expect(next.tick).toBe(5);
      expect(await decodeState<SnapshotPacket>(next.packet!)).toMatchObject({
        tick: 5,
        reset: false,
      });
    } finally {
      await worker.close();
    }
    await expect(worker.request({ type: "baseline" })).rejects.toThrow(
      "stopped",
    );
    expect(worker.lifecycle).toMatchObject({ state: "stopped", cause: "closed" });
  }, 20_000);

  it("applies player commands once, preserves domain ownership and converts departures to AI", async () => {
    const worker = new ReservedMatchWorker();
    try {
      await worker.request<MatchAdvance>(initialize);
      const update = await worker.request<MatchAdvance>({
        ...advance(1),
        commands: [
          {
            id: "research",
            command: {
              type: "research",
              playerId: 2,
              technologyId: "stoneage-shorecraft",
            },
          },
        ],
      });
      const packet = await decodeState<SnapshotPacket>(update.packet!);
      expect(
        Object.values(packet.expansion!.progression![2].research).some(
          (job) => job?.technologyId === "stoneage-shorecraft",
        ),
      ).toBe(true);
      expect(
        Object.values(packet.expansion!.progression![1].research).some(
          (job) => job?.technologyId === "stoneage-shorecraft",
        ),
      ).toBe(false);
      const after = await worker.request<MatchAdvance>({
        ...advance(1),
        disconnectedPlayerIds: [1],
        commands: [
          { id: "departed", command: { type: "advance-age", playerId: 1 } },
        ],
      });
      expect(after.tick).toBe(2);
      expect(after.rejectedCommands).toEqual([
        {
          id: "departed",
          playerId: 1,
          message: "You are not active in this match",
        },
      ]);
      const state = await decodeState<SnapshotPacket>(after.packet!);
      expect(state.players[0].ai).toBe(true);
      expect(state.players[1].ai).toBe(false);
    } finally {
      await worker.close();
    }
  }, 20_000);
});
