/**
 * Binary frames between the coordinator and a hosting browser. The hosted
 * match runtime exchanges the same messages a server worker thread posts
 * (requests, results, publications, fatal notices); structured clone is not
 * available over a socket, so each frame carries a JSON header in which every
 * Uint8Array is replaced by a reference to a length-prefixed binary section:
 *
 *   u32 header bytes | header JSON | (u32 length | bytes)*
 *
 * All integers are little-endian.
 */

/** Largest frame a host may send: a full recovery baseline of a 1000-cell world. */
export const MAX_HOST_FRAME_BYTES = 64 * 1024 * 1024;
const BINARY_KEY = "$hostBinary";
const enc = new TextEncoder(),
  dec = new TextDecoder();

/** Encode a message whose Uint8Array values travel as raw bytes. */
export function encodeHostFrame(message: unknown): Uint8Array<ArrayBuffer> {
  const sections: Uint8Array[] = [];
  const header = enc.encode(
    JSON.stringify(message, (_key, value: unknown) => {
      if (value instanceof Uint8Array) {
        sections.push(value);
        return { [BINARY_KEY]: sections.length - 1 };
      }
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
        throw new Error("Host frames carry only Uint8Array binary values");
      return value;
    }),
  );
  const size = 4 + header.byteLength + sections.reduce((sum, section) => sum + 4 + section.byteLength, 0);
  const frame = new Uint8Array(size);
  const view = new DataView(frame.buffer);
  view.setUint32(0, header.byteLength, true);
  frame.set(header, 4);
  let at = 4 + header.byteLength;
  for (const section of sections) {
    view.setUint32(at, section.byteLength, true);
    frame.set(section, at + 4);
    at += 4 + section.byteLength;
  }
  return frame;
}

/** Decode a frame; binary sections are copied into their own buffers. */
export function decodeHostFrame(data: ArrayBuffer | ArrayBufferView): unknown {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_HOST_FRAME_BYTES) throw new Error("Invalid host frame size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(0, true);
  if (4 + headerBytes > bytes.byteLength) throw new Error("Invalid host frame header");
  const sections: Uint8Array<ArrayBuffer>[] = [];
  let at = 4 + headerBytes;
  while (at < bytes.byteLength) {
    if (at + 4 > bytes.byteLength) throw new Error("Invalid host frame section");
    const length = view.getUint32(at, true);
    if (at + 4 + length > bytes.byteLength) throw new Error("Invalid host frame section");
    sections.push(bytes.slice(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return JSON.parse(dec.decode(bytes.subarray(4, 4 + headerBytes)), (_key, value: unknown) => {
    if (value && typeof value === "object" && BINARY_KEY in value) {
      const index = (value as Record<string, unknown>)[BINARY_KEY];
      if (typeof index !== "number" || !sections[index]) throw new Error("Invalid host frame reference");
      return sections[index];
    }
    return value;
  });
}
