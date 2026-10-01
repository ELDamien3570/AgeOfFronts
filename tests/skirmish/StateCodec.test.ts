import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import { Skirmish } from "../../src/skirmish/Simulation";
describe("portable recovery transport", () => {
  it("preserves maps, sets, typed arrays and optional fields", async () => {
    const state = {
      map: new Map([[1, new Set([2, 3])]]),
      bytes: new Uint8Array([1, 2, 255]),
      signed: new Int32Array([-1, 300]),
      clearing: new Uint16Array([4, 600]),
      optional: undefined,
    };
    expect(await decodeState(await encodeState(state))).toEqual(state);
  });
  it("run-length codes large constant-run arrays and round-trips them exactly", async () => {
    const owners = new Uint8Array(250_000);
    owners.fill(3, 1_000, 90_000);
    owners.fill(7, 90_000, 90_050);
    const cleared = new Uint16Array(250_000);
    cleared.fill(65_535, 10, 20);
    cleared[249_999] = 9;
    const noisy = new Uint8Array(10_000).map((_, i) => (i * 37) % 251);
    const state = { owners, cleared, noisy, small: new Uint8Array([1, 1, 1]) };
    const encoded = await encodeState(state);
    // A raw 750 KB of arrays must shrink to a small fraction of that on the wire.
    expect(encoded.payload.length).toBeLessThan(40_000);
    expect(await decodeState(encoded)).toEqual(state);
  });
  it("rejects run-length arrays whose runs do not add up to the declared length", async () => {
    const encoded = await encodeState({
      owners: new Uint8Array(50_000).fill(1),
    });
    const raw = gunzipSync(Buffer.from(encoded.payload, "base64"));
    const metadataLength = raw.readUInt32LE(4);
    const metadata = raw.subarray(8, 8 + metadataLength).toString("utf8");
    expect(metadata).toContain('"length":50000');
    const forgedMetadata = Buffer.from(
      metadata.replace('"length":50000', '"length":60000'),
    );
    const header = Buffer.from(raw.subarray(0, 8));
    header.writeUInt32LE(forgedMetadata.length, 4);
    const forged = Buffer.concat([
      header,
      forgedMetadata,
      raw.subarray(8 + metadataLength),
    ]);
    const tampered = {
      hash: createHash("sha256").update(forged).digest("hex"),
      payload: gzipSync(forged).toString("base64"),
    };
    await expect(decodeState(tampered)).rejects.toThrow(
      "Invalid checkpoint array",
    );
  });
  it("keeps negative zero", async () => {
    const decoded = await decodeState<{ a: number; b: number[] }>(
      await encodeState({ a: -0, b: [0, -0] }),
    );
    expect(Object.is(decoded.a, -0)).toBe(true);
    expect(Object.is(decoded.b[0], 0)).toBe(true);
    expect(Object.is(decoded.b[1], -0)).toBe(true);
  });
  it("rejects tampered checkpoint contents", async () => {
    const encoded = await encodeState({ tick: 10 });
    encoded.hash = "0".repeat(64);
    await expect(decodeState(encoded)).rejects.toThrow("hash mismatch");
  });
  it("restores a forest-aware match after encoding and continues identically", async () => {
    const terrain = new Uint8Array(100 * 64).fill(133);
    const forest = { cover: new Uint8Array(terrain.length).fill(200) };
    const map = () => createSkirmishMap(100, 64, terrain, undefined, forest);
    const options = { seed: 55, aiCount: 3, ruleset: "ages-v1" as const };
    const first = new Skirmish(map(), options);
    for (let i = 0; i < 85; i++) first.step();
    const saved = await decodeState<ReturnType<Skirmish["checkpoint"]>>(
      await encodeState(first.checkpoint()),
    );
    const second = new Skirmish(map(), options);
    second.restore(saved);
    expect(second.checkpoint()).toEqual(first.checkpoint());
    for (let i = 0; i < 80; i++) {
      first.step();
      second.step();
    }
    expect(second.checkpoint()).toEqual(first.checkpoint());
  }, 15_000);
});
