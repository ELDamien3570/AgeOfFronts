// Structural delta between two checkpoints of the same match.
//
// A host commit used to carry the whole checkpoint every four ticks, although
// most of it is unchanged. Both sides already hold the last committed state, so
// the host sends only what differs and the server rebuilds the next state from
// its own copy. `applyDelta(base, diffState(base, next))` reproduces `next`
// exactly, including object key order, so continuing from either copy is the
// same match. Neither function mutates its inputs; unchanged subtrees of the
// result are shared with `base` and must be treated as read-only.
//
// Node kinds (the marker key "~" never occurs in checkpoints):
//   { "~": "v", v }                        replace with a full value
//   { "~": "o", set, del, keys? }          plain-object patch
//   { "~": "m", set, del, keys? }          Map patch
//   { "~": "i", ids, set }                 array of objects with unique numeric ids
//   { "~": "t", at, values }               sparse typed-array patch
// `set` is a list of [key, node]; `keys` gives the full key order when it changed.

type Typed =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;
type Node =
  | { "~": "v"; v: unknown }
  | { "~": "o"; set: [string, Node][]; del: string[]; keys?: string[] }
  | { "~": "m"; set: [unknown, Node][]; del: unknown[]; keys?: unknown[] }
  | { "~": "i"; ids: number[]; set: [number, Node][] }
  | { "~": "t"; at: Uint32Array; values: Typed };

export type StateDelta = Node | null;

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const isTyped = (value: unknown): value is Typed =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (isTyped(a) || isTyped(b)) {
    if (
      !isTyped(a) ||
      !isTyped(b) ||
      a.constructor !== b.constructor ||
      a.length !== b.length
    )
      return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size)
      return false;
    const ak = [...a.keys()],
      bk = [...b.keys()];
    if (!sameKeys(ak, bk)) return false;
    for (const key of ak) if (!equal(a.get(key), b.get(key))) return false;
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size)
      return false;
    return sameKeys([...a], [...b]);
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  if (!sameKeys(ak, bk)) return false;
  for (const key of ak) if (!equal(a[key], b[key])) return false;
  return true;
}

function idArray(value: unknown): value is { id: number }[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<number>();
  for (const item of value) {
    if (!isPlain(item) || typeof item.id !== "number" || seen.has(item.id))
      return false;
    seen.add(item.id);
  }
  return true;
}

const full = (v: unknown): Node => ({ "~": "v", v });

function diff(base: unknown, next: unknown): Node | null {
  if (equal(base, next)) return null;
  if (isTyped(base) && isTyped(next)) {
    if (base.constructor !== next.constructor || base.length !== next.length)
      return full(next);
    const at: number[] = [];
    for (let i = 0; i < next.length; i++)
      if (!Object.is(base[i], next[i])) {
        at.push(i);
        // A dense change is cheaper as the whole array.
        if (at.length * (4 + next.BYTES_PER_ELEMENT) > next.byteLength / 2)
          return full(next);
      }
    const values = new (next.constructor as new (n: number) => Typed)(
      at.length,
    );
    at.forEach((index, i) => (values[i] = next[index]));
    return { "~": "t", at: Uint32Array.from(at), values };
  }
  if (idArray(base) && idArray(next)) {
    const before = new Map(base.map((item) => [item.id, item]));
    const set: [number, Node][] = [];
    for (const item of next) {
      const node = diff(before.get(item.id), item);
      if (node) set.push([item.id, before.has(item.id) ? node : full(item)]);
    }
    return { "~": "i", ids: next.map((item) => item.id), set };
  }
  if (base instanceof Map && next instanceof Map) {
    const set: [unknown, Node][] = [],
      del: unknown[] = [];
    for (const [key, value] of next) {
      if (!base.has(key)) set.push([key, full(value)]);
      else {
        const node = diff(base.get(key), value);
        if (node) set.push([key, node]);
      }
    }
    for (const key of base.keys()) if (!next.has(key)) del.push(key);
    const keys = [...next.keys()];
    const kept = [...base.keys()].filter((key) => next.has(key));
    const appended = keys.filter((key) => !base.has(key));
    return {
      "~": "m",
      set,
      del,
      ...(sameKeys(keys, [...kept, ...appended]) ? {} : { keys }),
    };
  }
  if (isPlain(base) && isPlain(next)) {
    const set: [string, Node][] = [],
      del: string[] = [];
    for (const key of Object.keys(next)) {
      if (!(key in base)) set.push([key, full(next[key])]);
      else {
        const node = diff(base[key], next[key]);
        if (node) set.push([key, node]);
      }
    }
    for (const key of Object.keys(base)) if (!(key in next)) del.push(key);
    const keys = Object.keys(next);
    const kept = Object.keys(base).filter((key) => key in next);
    const appended = keys.filter((key) => !(key in base));
    return {
      "~": "o",
      set,
      del,
      ...(sameKeys(keys, [...kept, ...appended]) ? {} : { keys }),
    };
  }
  return full(next);
}

function fail(): never {
  throw new Error("Invalid state delta");
}

function apply(base: unknown, node: Node): unknown {
  if (!isPlain(node)) fail();
  switch (node["~"]) {
    case "v":
      return node.v;
    case "t": {
      if (
        !isTyped(base) ||
        !(node.at instanceof Uint32Array) ||
        !isTyped(node.values)
      )
        fail();
      if (
        node.values.constructor !== base.constructor ||
        node.at.length !== node.values.length
      )
        fail();
      const result = base.slice() as Typed;
      for (let i = 0; i < node.at.length; i++) {
        if (node.at[i] >= result.length) fail();
        result[node.at[i]] = node.values[i];
      }
      return result;
    }
    case "i": {
      if (
        !Array.isArray(base) ||
        !Array.isArray(node.ids) ||
        !Array.isArray(node.set)
      )
        fail();
      const before = new Map<number, unknown>();
      for (const item of base)
        if (isPlain(item) && typeof item.id === "number")
          before.set(item.id, item);
      const changed = new Map(node.set);
      return node.ids.map((id) => {
        const patch = changed.get(id);
        if (patch) return apply(before.get(id), patch);
        if (!before.has(id)) fail();
        return before.get(id);
      });
    }
    case "m": {
      if (
        !(base instanceof Map) ||
        !Array.isArray(node.set) ||
        !Array.isArray(node.del)
      )
        fail();
      const result = new Map(base);
      for (const key of node.del) result.delete(key);
      for (const [key, patch] of node.set)
        result.set(key, apply(base.get(key), patch));
      if (!node.keys) return result;
      if (!Array.isArray(node.keys) || node.keys.length !== result.size) fail();
      return new Map(
        node.keys.map((key) => {
          if (!result.has(key)) fail();
          return [key, result.get(key)];
        }),
      );
    }
    case "o": {
      if (
        !isPlain(base) ||
        !Array.isArray(node.set) ||
        !Array.isArray(node.del)
      )
        fail();
      const result: Record<string, unknown> = { ...base };
      for (const key of node.del) delete result[key];
      for (const [key, patch] of node.set) {
        if (["__proto__", "constructor", "prototype"].includes(key)) fail();
        result[key] = apply(base[key], patch);
      }
      if (!node.keys) return result;
      if (
        !Array.isArray(node.keys) ||
        node.keys.length !== Object.keys(result).length
      )
        fail();
      const ordered: Record<string, unknown> = {};
      for (const key of node.keys) {
        if (!Object.prototype.hasOwnProperty.call(result, key)) fail();
        ordered[key] = result[key];
      }
      return ordered;
    }
    default:
      return fail();
  }
}

/** Describes how to turn `base` into `next`; null when they are equal. */
export function diffState(base: unknown, next: unknown): StateDelta {
  return diff(base, next);
}

/** Rebuilds the next state from `base` and a delta made against an equal base. */
export function applyDelta<T>(base: T, delta: StateDelta): T {
  return (delta === null ? base : apply(base, delta)) as T;
}
