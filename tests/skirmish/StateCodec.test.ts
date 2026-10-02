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
  it("accepts canonical base64 with every padding length and rejects noncanonical or interior padding", async () => {
    for (let i = 0; i < 24; i++) {
      const value = { text: "x".repeat(i), array: new Uint32Array([i]) };
      expect(await decodeState(await encodeState(value))).toEqual(value);
    }
    for (const payload of [
      "=AAA",
      "AAA=AAAA",
      "AAAA AA=",
      "AB==",
      "AAB=",
      "AA",
      "~~~~",
    ]) {
      await expect(
        decodeState({ hash: "a".repeat(64), payload }),
      ).rejects.toThrow("base64");
    }
  });
  it("preflights metadata bytes and parser tokens before allocating its JSON and decoded object trees", async () => {
    const state = {
      text: 'brackets [{{ and escaped quote " and backslash \\',
      values: Array.from({ length: 500 }, (_, i) => ({ i })),
    };
    const encoded = await encodeState(state);
    await expect(
      decodeState(encoded, { maxMetadataBytes: 20 }),
    ).rejects.toThrow("byte budget");
    await expect(
      decodeState(encoded, { maxMetadataTokens: 100 }),
    ).rejects.toThrow("token budget");
    let stats:
      | Parameters<
          NonNullable<
            import("../../src/skirmish/multiplayer/StateCodec").StateDecodeLimits["onDecoded"]
          >
        >[0]
      | undefined;
    expect(
      await decodeState(encoded, {
        onDecoded: (value) => {
          stats = value;
        },
      }),
    ).toEqual(state);
    expect(stats!.metadataTokens).toBeGreaterThan(1500);
    expect(stats!.metadataBytes).toBeGreaterThan(20);
  });
  it("rejects excessive nesting before JSON.parse and supports the extra wire indirection of legal nested maps", async () => {
    let value: unknown = 1;
    for (let i = 0; i < 32; i++) value = new Map([[i, value]]);
    expect(await decodeState(await encodeState(value))).toEqual(value);
    const text = Buffer.from(
      '{"lengths":[],"value":' + "[".repeat(198) + "0" + "]".repeat(198) + "}",
    );
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0x414f4601);
    header.writeUInt32LE(text.length, 4);
    const bytes = Buffer.concat([header, text]);
    await expect(
      decodeState({
        hash: createHash("sha256").update(bytes).digest("hex"),
        payload: gzipSync(bytes).toString("base64"),
      }),
    ).rejects.toThrow("nesting");
    await expect(
      decodeState(await encodeState(null), { maxMetadataTokens: -1 }),
    ).rejects.toThrow("memory budget");
  });
  it("bounds aggregate decoded RLE allocation independently of compressed bytes", async () => {
    const encoded = await encodeState({
      a: new Uint16Array(50_000).fill(3),
      b: new Uint16Array(50_000).fill(4),
    });
    expect(encoded.payload.length).toBeLessThan(1000);
    await expect(
      decodeState(encoded, { maxArrayBytes: 199_999 }),
    ).rejects.toThrow("memory budget");
    const observed: {
      wireBytes: number;
      arrayBytes: number;
      arrays: number;
    }[] = [];
    const result = await decodeState<{ a: Uint16Array; b: Uint16Array }>(
      encoded,
      { maxArrayBytes: 200_000, onDecoded: (stats) => observed.push(stats) },
    );
    expect(result.a).toHaveLength(50_000);
    expect(result.b).toHaveLength(50_000);
    expect(observed[0].arrayBytes).toBe(200_000);
    expect(observed[0].arrays).toBe(2);
    expect(observed[0].wireBytes).toBeLessThan(1000);
  });
  it("charges repeated buffer references and plain typed-array copies too", async () => {
    const encoded = await encodeState({
      a: new Uint32Array([1, 2]),
      b: new Uint32Array([3, 4]),
    });
    const raw = gunzipSync(Buffer.from(encoded.payload, "base64")),
      length = raw.readUInt32LE(4);
    const metadata = JSON.parse(raw.subarray(8, 8 + length).toString("utf8"));
    metadata.value.b.index = metadata.value.a.index;
    const text = Buffer.from(JSON.stringify(metadata)),
      header = Buffer.from(raw.subarray(0, 8));
    header.writeUInt32LE(text.length, 4);
    const forged = Buffer.concat([header, text, raw.subarray(8 + length)]),
      state = {
        hash: createHash("sha256").update(forged).digest("hex"),
        payload: gzipSync(forged).toString("base64"),
      };
    await expect(decodeState(state, { maxArrayBytes: 8 })).rejects.toThrow(
      "memory budget",
    );
    expect(await decodeState(state, { maxArrayBytes: 16 })).toEqual({
      a: new Uint32Array([1, 2]),
      b: new Uint32Array([1, 2]),
    });
  });
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
