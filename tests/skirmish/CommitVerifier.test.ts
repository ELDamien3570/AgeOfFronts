import { describe, expect, it } from "vitest";
import { CommitVerifier } from "../../src/skirmish/multiplayer/application/CommitVerifier";
import {
  chainStateId,
  HostedRuntime,
  type HostBatch,
} from "../../src/skirmish/multiplayer/application/HostedRuntime";
import { diffState } from "../../src/skirmish/multiplayer/StateDelta";
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
    const base = host.match.checkpoint();
    const proposal = await host.run(batch(0));
    // A dishonest host edits economy values inside an otherwise valid delta.
    const state = host.match.checkpoint();
    state.players[0].gold += 1000;
    state.players[1].reserves += 1000;
    const delta = await encodeState(diffState(base, state));
    await expect(
      verifier.verify(batch(0), {
        ...proposal,
        delta,
        stateId: await chainStateId(proposal.baseId, delta.hash),
      }),
    ).rejects.toThrow("Unaccounted");
    // A delta whose claimed id does not follow from its contents is refused.
    await expect(
      verifier.verify(batch(0), { ...proposal, stateId: "0".repeat(64) }),
    ).rejects.toThrow("Invalid commit id");
    // A delta made against some other state is refused.
    await expect(
      verifier.verify(batch(0), { ...proposal, baseId: "1".repeat(64) }),
    ).rejects.toThrow("extend");
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
    expect(fallback.delta).toEqual(original.delta);
    expect(fallback.stateId).toEqual(original.stateId);
    await verifier.accept(await verifier.verify(secondBatch, fallback));
    expect((await verifier.initial()).tick).toBe(8);
  });
});
