import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { encodeState } from "../../src/skirmish/multiplayer/StateCodec";

afterEach(() => vi.unstubAllGlobals());
async function worker() {
  vi.resetModules();
  const surface = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: vi.fn(),
  };
  vi.stubGlobal("self", surface);
  await import("../../src/skirmish/client/multiplayerStateWorker");
  return surface;
}
function fixture() {
  const terrain = new Uint8Array(3072).fill(133);
  const match = new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
  });
  return {
    match,
    encoder: new SnapshotEncoder(true),
    expectedMap: { width: 64, height: 48 },
  };
}
describe("real network state decode worker", () => {
  it("decodes queued updates in order, publishes isolated complete views and exposes structural allocation stats", async () => {
    const surface = await worker(),
      { match, encoder, expectedMap } = fixture();
    const baseline = encoder.encode(match.snapshot()),
      tile = match.map.ref(30, 20);
    const oldOwner = match.owners[tile];
    const changed = structuredClone(match.snapshot());
    changed.owners[tile] = 1;
    changed.tick = 1;
    const delta = encoder.encode(changed);
    surface.onmessage!({
      data: { ...(await encodeState(baseline)), expectedMap },
    });
    surface.onmessage!({
      data: { ...(await encodeState(delta)), expectedMap },
    });
    await vi.waitFor(() =>
      expect(surface.postMessage).toHaveBeenCalledTimes(2),
    );
    const first = surface.postMessage.mock.calls[0][0],
      second = surface.postMessage.mock.calls[1][0];
    expect(first.snapshot.owners[tile]).toBe(oldOwner);
    expect(second.snapshot.owners[tile]).toBe(1);
    expect([first.canonicalSequence, second.canonicalSequence]).toEqual([1, 2]);
    expect(second.decodeStats.wireBytes).toBeGreaterThan(0);
    expect(second.decodeStats.arrayBytes).toBeGreaterThan(0);
    expect(second.decodeStats.metadataTokens).toBeGreaterThan(0);
    expect(surface.postMessage.mock.calls[1][1].transfer).toHaveLength(3);
  });
  it("rejects a first baseline with different dimensions and fences later loaded-map changes", async () => {
    const surface = await worker(),
      { match, encoder, expectedMap } = fixture();
    const baseline = encoder.encode(match.snapshot());
    surface.onmessage!({
      data: {
        ...(await encodeState({ ...baseline, width: 48, height: 64 })),
        expectedMap,
      },
    });
    await vi.waitFor(() =>
      expect(surface.postMessage).toHaveBeenCalledTimes(1),
    );
    expect(surface.postMessage.mock.calls[0][0].error).toContain("loaded map");
    const encoded = await encodeState(baseline);
    surface.onmessage!({ data: { ...encoded, expectedMap } });
    await vi.waitFor(() =>
      expect(surface.postMessage).toHaveBeenCalledTimes(2),
    );
    expect(surface.postMessage.mock.calls[1][0].canonicalSequence).toBe(1);
    surface.onmessage!({
      data: { ...encoded, expectedMap: { width: 48, height: 64 } },
    });
    await vi.waitFor(() =>
      expect(surface.postMessage).toHaveBeenCalledTimes(3),
    );
    expect(surface.postMessage.mock.calls[2][0].error).toContain(
      "dimensions changed",
    );
  });
  it("rejects a tiny compressed RLE packet before its 128 MB expansion", async () => {
    const surface = await worker(),
      encoded = await encodeState({ huge: new Uint16Array(5000) });
    const raw = gunzipSync(Buffer.from(encoded.payload, "base64")),
      metadataLength = raw.readUInt32LE(4);
    const metadata = JSON.parse(
      raw.subarray(8, 8 + metadataLength).toString("utf8"),
    );
    metadata.value.huge.length = 64_000_000;
    const text = Buffer.from(JSON.stringify(metadata)),
      header = Buffer.from(raw.subarray(0, 8)),
      runs = Buffer.from(raw.subarray(8 + metadataLength));
    header.writeUInt32LE(text.length, 4);
    runs.writeUInt32LE(64_000_000, 4);
    const bytes = Buffer.concat([header, text, runs]),
      payload = gzipSync(bytes).toString("base64");
    expect(payload.length).toBeLessThan(1000);
    surface.onmessage!({
      data: {
        hash: createHash("sha256").update(bytes).digest("hex"),
        payload,
        expectedMap: { width: 64, height: 48 },
      },
    });
    await vi.waitFor(() =>
      expect(surface.postMessage).toHaveBeenCalledTimes(1),
    );
    expect(surface.postMessage.mock.calls[0][0].error).toContain(
      "memory budget",
    );
  });
});
