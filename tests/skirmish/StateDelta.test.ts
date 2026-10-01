import { describe, expect, it } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import {
  applyDelta,
  diffState,
  type StateDelta,
} from "../../src/skirmish/multiplayer/StateDelta";
import { Skirmish } from "../../src/skirmish/Simulation";

// Deep equality that also requires identical key order everywhere, because a
// rebuilt state must be indistinguishable from the original when iterated.
function sameShape(a: unknown, b: unknown, path = "$"): void {
  if (a instanceof Map) {
    expect(b, path).toBeInstanceOf(Map);
    expect([...(b as Map<unknown, unknown>).keys()], path).toEqual([
      ...a.keys(),
    ]);
    for (const [key, value] of a)
      sameShape(
        value,
        (b as Map<unknown, unknown>).get(key),
        `${path}.${String(key)}`,
      );
    return;
  }
  if (a instanceof Set) {
    expect([...(b as Set<unknown>)], path).toEqual([...a]);
    return;
  }
  if (ArrayBuffer.isView(a)) {
    expect((b as object).constructor, path).toBe(a.constructor);
    expect(b, path).toEqual(a);
    return;
  }
  if (Array.isArray(a)) {
    expect(Array.isArray(b), path).toBe(true);
    expect((b as unknown[]).length, path).toBe(a.length);
    a.forEach((item, i) =>
      sameShape(item, (b as unknown[])[i], `${path}[${i}]`),
    );
    return;
  }
  if (typeof a === "object" && a !== null) {
    expect(Object.keys(b as object), path).toEqual(Object.keys(a));
    for (const key of Object.keys(a))
      sameShape(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    return;
  }
  expect(Object.is(a, b), `${path}: ${String(a)} vs ${String(b)}`).toBe(true);
}

const roundTrip = async (base: unknown, next: unknown) =>
  applyDelta(
    base,
    await decodeState<StateDelta>(await encodeState(diffState(base, next))),
  );

describe("state delta", () => {
  it("is null for equal states and reproduces every kind of change", async () => {
    const base = {
      a: 1,
      nested: { x: [1, 2, 3], y: "s", gone: true },
      tiles: new Uint8Array(10_000).fill(2),
      words: new Uint16Array([1, 2, 3]),
      map: new Map<unknown, unknown>([
        [1, { v: 1 }],
        ["k", [1]],
        [3, null],
      ]),
      set: new Set([1, 2]),
      units: [
        { id: 5, x: 1, path: [1, 2] },
        { id: 2, x: 7, path: [] },
        { id: 9, x: 0, path: [3] },
      ],
      optional: undefined as number | undefined,
    };
    expect(diffState(base, structuredClone(base))).toBeNull();
    const next = structuredClone(base) as typeof base & { added?: string };
    next.a = 2;
    delete (next.nested as { gone?: boolean }).gone;
    next.nested.x.push(4);
    next.tiles[17] = 9;
    next.tiles[9_999] = 1;
    next.words = new Uint16Array([1, 2, 3, 4]);
    next.map.delete("k");
    next.map.set(1, { v: 2 });
    next.map.set("new", 4);
    next.set.add(3);
    next.units = [
      { id: 9, x: 5, path: [3] },
      { id: 5, x: 1, path: [1, 2] },
      { id: 7, x: 3, path: [] },
    ];
    next.optional = 4;
    next.added = "yes";
    sameShape(next, await roundTrip(base, next));
  });

  it("follows reordered keys in objects and maps", async () => {
    const base = {
      o: { a: 1, b: 2, c: 3 },
      m: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    };
    const next = {
      o: { c: 3, a: 1, b: 2 },
      m: new Map([
        ["b", 2],
        ["a", 1],
      ]),
    };
    sameShape(next, await roundTrip(base, next));
  });

  it("sends sparse typed-array changes, not whole arrays", async () => {
    const base = { owners: new Uint8Array(250_000) };
    const next = { owners: base.owners.slice() };
    for (let i = 0; i < 300; i++) next.owners[i * 800] = 4;
    const encoded = await encodeState(diffState(base, next));
    expect(encoded.payload.length).toBeLessThan(4_000);
    sameShape(next, await roundTrip(base, next));
  });

  it("never mutates the base and shares unchanged subtrees", () => {
    const base = {
      keep: { deep: [1, 2] },
      change: { v: 1 },
      tiles: new Uint8Array(8),
    };
    const frozen = structuredClone(base);
    const next = {
      keep: { deep: [1, 2] },
      change: { v: 2 },
      tiles: new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]),
    };
    const result = applyDelta(base, diffState(base, next));
    sameShape(frozen, base);
    expect(result.keep).toBe(base.keep);
    expect(result.tiles).not.toBe(base.tiles);
  });

  it("rejects deltas that do not fit the base", () => {
    const base = { units: [{ id: 1 }], tiles: new Uint8Array(4) };
    expect(() =>
      applyDelta(base, {
        "~": "i",
        ids: [1, 2],
        set: [],
      } as unknown as StateDelta),
    ).toThrow("Invalid state delta");
    expect(() =>
      applyDelta(base, {
        "~": "o",
        set: [
          [
            "tiles",
            { "~": "t", at: new Uint32Array([9]), values: new Uint8Array([1]) },
          ],
        ],
        del: [],
      } as unknown as StateDelta),
    ).toThrow("Invalid state delta");
    expect(() =>
      applyDelta(base, {
        "~": "o",
        set: [["__proto__", { "~": "v", v: 1 }]],
        del: [],
      } as unknown as StateDelta),
    ).toThrow("Invalid state delta");
    expect(() =>
      applyDelta(base, { "~": "x" } as unknown as StateDelta),
    ).toThrow("Invalid state delta");
  });

  it("rebuilds a running match exactly across many commits and continues identically", async () => {
    const width = 160,
      height = 100;
    const cover = new Uint8Array(width * height).map((_, i) =>
      (i * 7919) % 13 < 5 ? 255 : 0,
    );
    const map = () =>
      createSkirmishMap(
        width,
        height,
        new Uint8Array(width * height).fill(133),
        undefined,
        {
          cover: cover.slice(),
        },
      );
    const options = {
      seed: 1234,
      aiCount: 5,
      tribes: false,
      ruleset: "ages-v1" as const,
    };
    const host = new Skirmish(map(), options);
    let committed = host.checkpoint();
    let largest = 0;
    for (let commit = 0; commit < 150; commit++) {
      for (let tick = 0; tick < 4; tick++) host.step();
      const next = host.checkpoint();
      const encoded = await encodeState(diffState(committed, next));
      largest = Math.max(largest, encoded.payload.length);
      committed = applyDelta(committed, await decodeState<StateDelta>(encoded));
      if (commit % 25 === 0 || commit === 149) sameShape(next, committed);
    }
    const full = (await encodeState(host.checkpoint())).payload.length;
    expect(largest).toBeLessThan(full);
    // A server that only ever saw deltas continues the match identically.
    const follower = new Skirmish(map(), options);
    follower.restore(committed);
    for (let tick = 0; tick < 200; tick++) {
      host.step();
      follower.step();
    }
    expect(follower.checkpoint()).toEqual(host.checkpoint());
  }, 60_000);
});
