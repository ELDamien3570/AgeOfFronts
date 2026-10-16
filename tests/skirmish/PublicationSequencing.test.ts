import { describe, expect, it, vi } from "vitest";
import { PublicationSequencer } from "../../src/skirmish/multiplayer/application/PublicationSequencer";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { JoinBarrier, MatchAdvance } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

const make = () => {
  const order: string[] = [];
  const sequencer = new PublicationSequencer<string, string>(p => order.push(`pub:${p}`), r => order.push(`res:${r}`));
  return { order, sequencer };
};

describe("N6b publication sequencing (P14)", () => {
  it("holds a result that overtakes the publications issued before it", () => {
    const { order, sequencer } = make();
    sequencer.result(2, "barrier");
    expect(order).toEqual([]);
    sequencer.publication(1, "a");
    expect(order).toEqual(["pub:a"]);
    sequencer.publication(2, "b");
    expect(order).toEqual(["pub:a", "pub:b", "res:barrier"]);
  });

  it("delivers publications in sequence order and results in arrival order", () => {
    const { order, sequencer } = make();
    sequencer.publication(2, "b");
    expect(order).toEqual([]);
    // A result issued before any publication is not held back by later ones.
    sequencer.result(0, "early-advance");
    expect(order).toEqual(["res:early-advance"]);
    sequencer.publication(1, "a");
    expect(order).toEqual(["res:early-advance", "pub:a", "pub:b"]);
  });

  it("releases a ready result immediately but never ahead of an older held result", () => {
    const { order, sequencer } = make();
    sequencer.result(1, "first");
    sequencer.result(0, "second");
    expect(order).toEqual([]);
    sequencer.publication(1, "a");
    expect(order).toEqual(["pub:a", "res:first", "res:second"]);
    sequencer.result(1, "third");
    expect(order).toEqual(["pub:a", "res:first", "res:second", "res:third"]);
  });

  it("delivers nothing after a fault stops it and rejects replayed sequences", () => {
    const { order, sequencer } = make();
    sequencer.publication(1, "a");
    expect(() => sequencer.publication(1, "again")).toThrow(/out of order/);
    sequencer.result(3, "held");
    sequencer.stop();
    sequencer.publication(2, "b");
    sequencer.publication(3, "c");
    expect(order).toEqual(["pub:a"]);
    expect(sequencer.heldResults).toBe(0);
  });

  it("streams publications from the encoder thread directly and orders join barriers after them", async () => {
    const worker = new ReservedMatchWorker(), publications: { tick: number }[] = [], events: string[] = [];
    const unsubscribe = worker.onPublication(p => { publications.push(p); events.push(`pub:${p.tick}`); });
    try {
      const initial = await worker.request<MatchAdvance>({ type: "initialize", streamPublications: true,
        settings: defaultLobbySettings("africa"), map: { width: 160, height: 100, terrain: new Uint8Array(16000).fill(133) },
        options: { seed: 77, aiCount: 0, humanNames: ["A", "B"], ruleset: "ages-v1" as const, tribes: false } });
      const decoder = new SnapshotDecoder();
      decoder.decode(await decodeState<SnapshotPacket>(initial.packet!));
      for (let i = 0; i < 4; i++) await worker.request<MatchAdvance>({ type: "advance", ticks: 1, commands: [], disconnectedPlayerIds: [], publish: true });
      const barrier = worker.request<JoinBarrier>({ type: "join-barrier", playerId: 1 }).then(b => { events.push("barrier"); return b; });
      const joined = await barrier;
      expect(events).toEqual(["pub:1", "pub:2", "pub:3", "pub:4", "barrier"]);
      // The delta chain stays coherent: every publication then the barrier's shared packet decode in order.
      const packets = publications as unknown as { packet: Parameters<typeof decodeState>[0] }[];
      for (const p of packets) decoder.decode(await decodeState<SnapshotPacket>(p.packet));
      expect(decoder.decode(await decodeState<SnapshotPacket>(joined.packet)).tick).toBe(4);
      await vi.waitFor(() => expect(publications).toHaveLength(4));
    } finally { unsubscribe(); await worker.close(); }
  });
});
