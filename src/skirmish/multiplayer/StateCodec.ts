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
function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
function pack(value: unknown, buffers: Uint8Array[]): WireValue {
  if (value === undefined) return { $: "undefined" };
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite checkpoint value");
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
function unpack(value: WireValue, buffers: Uint8Array[], depth = 0): unknown {
  if (depth > 64) throw new Error("Checkpoint nesting exceeds the limit");
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => unpack(item, buffers, depth + 1));
  if (value.$ === "undefined") return undefined;
  if (value.$ === "map") {
    if (!Array.isArray(value.entries))
      throw new Error("Invalid checkpoint map");
    return new Map(
      value.entries.map((item) => {
        if (!Array.isArray(item) || item.length !== 2)
          throw new Error("Invalid map entry");
        return [
          unpack(item[0], buffers, depth + 1),
          unpack(item[1], buffers, depth + 1),
        ];
      }),
    );
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
    const runs = new Uint32Array(bytes.slice().buffer),
      output =
        value.$ === "u8r" ? new Uint8Array(length) : new Uint16Array(length);
    const limit = value.$ === "u8r" ? 0xff : 0xffff;
    let at = 0;
    for (let run = 0; run < runs.length; run += 2) {
      const symbol = runs[run],
        count = runs[run + 1];
      if (symbol > limit || at + count > length)
        throw new Error("Invalid checkpoint array");
      if (symbol) output.fill(symbol, at, at + count);
      at += count;
    }
    if (at !== length) throw new Error("Invalid checkpoint array");
    return output;
  }
  if (value.$ === "set") {
    if (!Array.isArray(value.entries))
      throw new Error("Invalid checkpoint set");
    return new Set(
      value.entries.map((item) => unpack(item, buffers, depth + 1)),
    );
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
    return new type(bytes.slice().buffer);
  }
  if (value.$ !== undefined) throw new Error("Unknown checkpoint value type");
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid checkpoint key");
    result[key] = unpack(item, buffers, depth + 1);
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
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  return { hash: await digest(bytes), payload: base64(compressed) };
}
export async function decodeState<T>(state: EncodedState): Promise<T> {
  if (!/^[a-f0-9]{64}$/u.test(state.hash) || state.payload.length > 32_000_000)
    throw new Error("Invalid encoded checkpoint");
  const compressed = unbase64(state.payload);
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
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
  const metadata = JSON.parse(
    dec.decode(bytes.subarray(8, 8 + metadataLength)),
  );
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
  return unpack(metadata.value, buffers) as T;
}
