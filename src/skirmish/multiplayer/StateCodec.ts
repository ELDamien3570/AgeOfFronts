export interface EncodedState {
  hash: string;
  payload: string;
}
type WireValue =
  | null
  | boolean
  | number
  | string
  | WireValue[]
  | { [key: string]: WireValue };
const enc = new TextEncoder(),
  dec = new TextDecoder();
const types = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
};
// Map-sized byte and word arrays (ownership, claims, progress, cleared forest)
// are mostly long constant runs. Run-length coding them before compression cuts
// the data gzip and SHA-256 must touch by an order of magnitude on large maps.
const RLE_MINIMUM = 4096;
function runLength(values: Uint8Array | Uint16Array): Uint32Array | undefined {
  if (values.length < RLE_MINIMUM) return undefined;
  const runs: number[] = [];
  let value = values[0],
    start = 0;
  for (let at = 1; at <= values.length; at++)
    if (at === values.length || values[at] !== value) {
      runs.push(value, at - start);
      if (at < values.length) {
        value = values[at];
        start = at;
      }
      // Abandon early when coding is not shrinking the data.
      if (runs.length * 4 >= values.byteLength / 2) return undefined;
    }
  return runs.length * 4 < values.byteLength / 2
    ? Uint32Array.from(runs)
    : undefined;
}
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192)
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}
const base64Digits = new Int16Array(128).fill(-1);
for (const [index, digit] of [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
].entries())
  base64Digits[digit.charCodeAt(0)] = index;
function unbase64(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4) throw new Error("Invalid checkpoint base64");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((text.length / 4) * 3 - padding);
  const digit = (at: number) => base64Digits[text.charCodeAt(at)] ?? -1;
  let cursor = 0;
  for (let at = 0; at < text.length; at += 4) {
    const a = digit(at),
      b = digit(at + 1),
      padC = text.charCodeAt(at + 2) === 61,
      padD = text.charCodeAt(at + 3) === 61;
    const c = padC ? 0 : digit(at + 2),
      d = padD ? 0 : digit(at + 3);
    if (
      a < 0 ||
      b < 0 ||
      c < 0 ||
      d < 0 ||
      (padC && !padD) ||
      ((padC || padD) && at + 4 !== text.length) ||
      (padC && (b & 15) !== 0) ||
      (padD && !padC && (c & 3) !== 0)
    )
      throw new Error("Invalid checkpoint base64");
    output[cursor++] = (a << 2) | (b >> 4);
    if (cursor < output.length) output[cursor++] = ((b & 15) << 4) | (c >> 2);
    if (cursor < output.length) output[cursor++] = ((c & 3) << 6) | d;
  }
  return output;
}
function pack(value: unknown, buffers: Uint8Array[]): WireValue {
  if (value === undefined) return { $: "undefined" };
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite checkpoint value");
    // JSON writes -0 as 0; keep it so restored state is bit-identical.
    if (Object.is(value, -0)) return { $: "-0" };
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => pack(item, buffers));
  if (value instanceof Map)
    return {
      $: "map",
      entries: [...value].map(([key, item]) => [
        pack(key, buffers),
        pack(item, buffers),
      ]),
    };
  if (value instanceof Set)
    return { $: "set", entries: [...value].map((item) => pack(item, buffers)) };
  if (value instanceof Uint8Array || value instanceof Uint16Array) {
    const runs = runLength(value);
    if (runs) {
      const index = buffers.length;
      buffers.push(new Uint8Array(runs.buffer));
      return {
        $: value instanceof Uint8Array ? "u8r" : "u16r",
        index,
        length: value.length,
      };
    }
  }
  for (const [name, type] of Object.entries(types))
    if (value instanceof type) {
      const index = buffers.length;
      buffers.push(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      return { $: name, index };
    }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Checkpoint contains an unsupported object");
  const result: Record<string, WireValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["$", "__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid checkpoint key");
    result[key] = pack(item, buffers);
  }
  return result;
}
export interface StateDecodeStats {
  wireBytes: number;
  arrayBytes: number;
  arrays: number;
  metadataBytes: number;
  metadataTokens: number;
}
export interface StateDecodeLimits {
  /** Aggregate output allocation, including repeated references to one buffer. */
  maxArrayBytes?: number;
  /** Checked on UTF-8 bytes before constructing a string or JSON object tree. */
  maxMetadataBytes?: number;
  /** JSON values, containers and property names; limits parser and unpack work. */
  maxMetadataTokens?: number;
  onDecoded?: (stats: StateDecodeStats) => void;
}
interface DecodeAllocation {
  bytes: number;
  arrays: number;
  limit: number;
}
/** A preflight, not a second JSON parser: JSON.parse still validates syntax.
 * Strings and escapes are skipped as a unit, so brackets inside text cannot
 * hide or inflate nesting. No metadata-sized arrays/strings are allocated. */
function metadataTokens(bytes: Uint8Array, limit: number): number {
  let tokens = 0,
    depth = 0,
    quoted = false,
    primitive = false;
  const charge = () => {
    if (++tokens > limit)
      throw new Error("Checkpoint metadata exceeds the token budget");
  };
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at];
    if (quoted) {
      if (byte === 92) at++;
      else if (byte === 34) quoted = false;
      continue;
    }
    if (byte === 34) {
      charge();
      quoted = true;
      primitive = false;
    } else if (byte === 91 || byte === 123) {
      charge();
      if (++depth > 197)
        throw new Error("Checkpoint nesting exceeds the limit");
      primitive = false;
    } else if (byte === 93 || byte === 125) {
      if (--depth < 0) throw new Error("Invalid checkpoint metadata");
      primitive = false;
    } else if (
      byte === 44 ||
      byte === 58 ||
      byte === 32 ||
      byte === 9 ||
      byte === 10 ||
      byte === 13
    )
      primitive = false;
    else if (!primitive) {
      charge();
      primitive = true;
    }
  }
  if (quoted || depth !== 0) throw new Error("Invalid checkpoint metadata");
  return tokens;
}
function allocate(budget: DecodeAllocation, bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > budget.limit - budget.bytes
  )
    throw new Error("Decoded arrays exceed the memory budget");
  budget.bytes += bytes;
  budget.arrays++;
}
function unpack(
  value: WireValue,
  buffers: Uint8Array[],
  budget: DecodeAllocation,
  depth = 0,
): unknown {
  if (depth > 64) throw new Error("Checkpoint nesting exceeds the limit");
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => unpack(item, buffers, budget, depth + 1));
  if (value.$ === "undefined") return undefined;
  if (value.$ === "-0") return -0;
  if (value.$ === "map") {
    if (!Array.isArray(value.entries))
      throw new Error("Invalid checkpoint map");
    const output = new Map<unknown, unknown>();
    for (const item of value.entries) {
      if (!Array.isArray(item) || item.length !== 2)
        throw new Error("Invalid map entry");
      output.set(
        unpack(item[0], buffers, budget, depth + 1),
        unpack(item[1], buffers, budget, depth + 1),
      );
    }
    return output;
  }
  if (value.$ === "u8r" || value.$ === "u16r") {
    const { index, length } = value;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= buffers.length ||
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 64_000_000
    )
      throw new Error("Invalid checkpoint array");
    const bytes = buffers[index];
    if (bytes.byteLength % 8) throw new Error("Invalid checkpoint array size");
    // Metadata need not end at an aligned offset. Read the little-endian run
    // words directly, without an additional wire-sized alignment allocation.
    const runs = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const limit = value.$ === "u8r" ? 0xff : 0xffff;
    let at = 0;
    for (let run = 0; run < bytes.byteLength; run += 8) {
      const symbol = runs.getUint32(run, true),
        count = runs.getUint32(run + 4, true);
      if (symbol > limit || at + count > length)
        throw new Error("Invalid checkpoint array");
      at += count;
    }
    if (at !== length) throw new Error("Invalid checkpoint array");
    allocate(budget, length * (value.$ === "u8r" ? 1 : 2));
    const output =
      value.$ === "u8r" ? new Uint8Array(length) : new Uint16Array(length);
    at = 0;
    for (let run = 0; run < bytes.byteLength; run += 8) {
      const symbol = runs.getUint32(run, true),
        count = runs.getUint32(run + 4, true);
      if (symbol) output.fill(symbol, at, at + count);
      at += count;
    }
    return output;
  }
  if (value.$ === "set") {
    if (!Array.isArray(value.entries))
      throw new Error("Invalid checkpoint set");
    const output = new Set<unknown>();
    for (const item of value.entries)
      output.add(unpack(item, buffers, budget, depth + 1));
    return output;
  }
  if (
    typeof value.$ === "string" &&
    Object.prototype.hasOwnProperty.call(types, value.$)
  ) {
    if (
      typeof value.index !== "number" ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= buffers.length
    )
      throw new Error("Invalid checkpoint array");
    const bytes = buffers[value.index],
      type = types[value.$ as keyof typeof types];
    if (bytes.byteLength % type.BYTES_PER_ELEMENT)
      throw new Error("Invalid checkpoint array size");
    allocate(budget, bytes.byteLength);
    return new type(bytes.slice().buffer);
  }
  if (value.$ !== undefined) throw new Error("Unknown checkpoint value type");
  const result: Record<string, unknown> = {};
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid checkpoint key");
    result[key] = unpack(value[key], buffers, budget, depth + 1);
  }
  return result;
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function encodeState(value: unknown): Promise<EncodedState> {
  const buffers: Uint8Array[] = [];
  const valueTree = pack(value, buffers);
  const metadata = enc.encode(
    JSON.stringify({
      value: valueTree,
      lengths: buffers.map((buffer) => buffer.byteLength),
    }),
  );
  const bytes = new Uint8Array(
    8 +
      metadata.length +
      buffers.reduce((total, buffer) => total + buffer.length, 0),
  );
  if (bytes.length > 64_000_000)
    throw new Error("Checkpoint exceeds the size limit");
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x414f4601, false);
  header.setUint32(4, metadata.length, true);
  bytes.set(metadata, 8);
  let at = 8 + metadata.length;
  for (const buffer of buffers) {
    bytes.set(buffer, at);
    at += buffer.length;
  }
  const compressed = new Uint8Array(
    await new Response(
      new Response(bytes).body!.pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  return { hash: await digest(bytes), payload: base64(compressed) };
}
export async function decodeState<T>(
  state: EncodedState,
  limits: StateDecodeLimits = {},
): Promise<T> {
  for (const limit of [
    limits.maxArrayBytes,
    limits.maxMetadataBytes,
    limits.maxMetadataTokens,
  ])
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
      throw new Error("Invalid decoded memory budget");
  if (!/^[a-f0-9]{64}$/u.test(state.hash) || state.payload.length > 32_000_000)
    throw new Error("Invalid encoded checkpoint");
  const compressed = unbase64(state.payload);
  const reader = new Response(compressed)
    .body!.pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 64_000_000) {
      await reader.cancel();
      throw new Error("Checkpoint exceeds the size limit");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  chunks.length = 0;
  if ((await digest(bytes)) !== state.hash)
    throw new Error("Checkpoint hash mismatch");
  if (bytes.length < 8) throw new Error("Invalid checkpoint header");
  const header = new DataView(bytes.buffer);
  const metadataLength = header.getUint32(4, true);
  if (
    header.getUint32(0, false) !== 0x414f4601 ||
    metadataLength > bytes.length - 8
  )
    throw new Error("Unsupported checkpoint format");
  if (metadataLength > (limits.maxMetadataBytes ?? 64_000_000))
    throw new Error("Checkpoint metadata exceeds the byte budget");
  const metadataBytes = bytes.subarray(8, 8 + metadataLength);
  const tokens = metadataTokens(
    metadataBytes,
    limits.maxMetadataTokens ?? 4_000_000,
  );
  const metadata = JSON.parse(dec.decode(metadataBytes));
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !("value" in metadata)
  )
    throw new Error("Invalid checkpoint metadata");
  if (!Array.isArray(metadata.lengths) || metadata.lengths.length > 100_000)
    throw new Error("Invalid checkpoint buffers");
  const buffers: Uint8Array[] = [];
  let offset = 8 + metadataLength;
  for (const length of metadata.lengths) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > bytes.length - offset
    )
      throw new Error("Invalid checkpoint buffer length");
    buffers.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.length)
    throw new Error("Unexpected checkpoint trailing data");
  const budget = {
    bytes: 0,
    arrays: 0,
    limit: limits.maxArrayBytes ?? 256_000_000,
  };
  const result = unpack(metadata.value, buffers, budget) as T;
  limits.onDecoded?.({
    wireBytes: bytes.byteLength,
    arrayBytes: budget.bytes,
    arrays: budget.arrays,
    metadataBytes: metadataLength,
    metadataTokens: tokens,
  });
  return result;
}
