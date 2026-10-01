import { describe, expect, it } from "vitest";
import { CommitVerifier } from "../../src/skirmish/multiplayer/application/CommitVerifier";
import {
  HostedRuntime,
  type HostBatch,
} from "../../src/skirmish/multiplayer/application/HostedRuntime";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

const makeRuntime = () =>
  new HostedRuntime(
    { width: 160, height: 100, terrain: new Uint8Array(16000).fill(133) },
    {
      seed: 987,
      aiCount: 2,
      humanNames: ["First", "Second"],
      ruleset: "ages-v1",
      tribes: false,
    },
  );
const batch = (previousTick: number): HostBatch => ({
  previousTick,
  commands: [],
  disconnectedPlayerIds: [],
});

describe("host commit validation", () => {
  it("rejects direct gold and reserve edits without damaging the next valid commit", async () => {
    const host = makeRuntime(),
      verifier = new CommitVerifier(makeRuntime());
    const proposal = await host.run(batch(0));
    const state = await decodeState<ReturnType<typeof host.match.checkpoint>>(
      proposal.checkpoint,
    );
    state.players[0].gold += 1000;
    state.players[1].reserves += 1000;
    await expect(
      verifier.verify(batch(0), {
        ...proposal,
        checkpoint: await encodeState(state),
      }),
    ).rejects.toThrow("Unaccounted");
    const verified = await verifier.verify(batch(0), proposal);
    expect(verified.tick).toBe(4);
    await verifier.accept(verified);
    expect(await verifier.initial()).toEqual({
      ...verified,
      rejectedCommands: [],
    });
  });
  it("only advances presentation deltas after acceptance and supplies a full baseline", async () => {
    const host = makeRuntime(),
      verifier = new CommitVerifier(makeRuntime());
    const proposed = await host.run(batch(0));
    const prepared = await verifier.verify(batch(0), proposed);
    const before = await decodeState<SnapshotPacket>(await verifier.baseline());
    expect(before.tick).toBe(0);
    const accepted = await decodeState<SnapshotPacket>(
      await verifier.accept(prepared),
    );
    expect(accepted.tick).toBe(4);
    expect(accepted.reset).toBe(true);
    const next = await verifier.verify(batch(4), await host.run(batch(4)));
    const delta = await decodeState<SnapshotPacket>(
      await verifier.accept(next),
    );
    expect(delta.tick).toBe(8);
    expect(delta.reset).toBe(false);
    expect(
      (await decodeState<SnapshotPacket>(await verifier.baseline())).reset,
    ).toBe(true);
  });
  it("continues on the server from the same accepted checkpoint after host loss", async () => {
    const host = makeRuntime(),
      verifier = new CommitVerifier(makeRuntime());
    const first = await verifier.verify(batch(0), await host.run(batch(0)));
    await verifier.accept(first);
    const secondBatch = { ...batch(4), disconnectedPlayerIds: [1] };
    const fallback = await verifier.fallback(secondBatch);
    const original = await host.run(secondBatch);
    expect(fallback.checkpoint).toEqual(original.checkpoint);
    await verifier.accept(await verifier.verify(secondBatch, fallback));
    expect((await verifier.initial()).tick).toBe(8);
  });
});
