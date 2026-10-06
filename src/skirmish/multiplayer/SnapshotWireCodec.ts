import { z } from "zod";
import type { ServerMessage } from "./Protocol";
import { SNAPSHOT_STATE_LIMITS } from "./StateLimits";
import type { EncodedState } from "./StateCodec";

type StateMessage = Extract<ServerMessage, { type: "match-state" }>;
const MAGIC = 0x414f5301, MAX_METADATA = 16_384;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const metadataSchema = z.object({
  type: z.literal("match-state"), matchId: z.string().min(1).max(128),
  packet: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/u), payload: z.literal("") }).strict(),
  tick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), paused: z.boolean(),
  publicationSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  flowEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  rebase: z.boolean().optional(), syncId: z.string().max(128).optional(),
  disconnectedPlayerIds: z.array(z.number().int().min(0).max(254)).max(255), executor: z.literal("server"),
}).strict();

/** Versioned live frame. Compression, hashing and decode budgets are unchanged. */
export function encodeSnapshotFrame(message: StateMessage): Uint8Array<ArrayBuffer> {
  const compressed = message.packet.binary;
  if (!compressed) throw new Error("Snapshot has no binary payload");
  const metadata = encoder.encode(JSON.stringify({ ...message, packet: { hash: message.packet.hash, payload: "" } }));
  if (metadata.byteLength > MAX_METADATA || 4 * Math.ceil(compressed.byteLength / 3) > SNAPSHOT_STATE_LIMITS.maxPayloadChars)
    throw new Error("Snapshot frame exceeds the byte budget");
  const bytes = new Uint8Array(8 + metadata.byteLength + compressed.byteLength), header = new DataView(bytes.buffer);
  header.setUint32(0, MAGIC); header.setUint32(4, metadata.byteLength, true);
  bytes.set(metadata, 8); bytes.set(compressed, 8 + metadata.byteLength);
  return bytes;
}
export function decodeSnapshotFrame(buffer: ArrayBuffer): StateMessage {
  if (buffer.byteLength < 8 || buffer.byteLength > 8 + MAX_METADATA + SNAPSHOT_STATE_LIMITS.maxPayloadChars * 3 / 4)
    throw new Error("Invalid snapshot frame size");
  const header = new DataView(buffer), size = header.getUint32(4, true);
  if (header.getUint32(0) !== MAGIC || size > MAX_METADATA || size > buffer.byteLength - 8)
    throw new Error("Unsupported snapshot frame");
  const metadata = metadataSchema.parse(JSON.parse(decoder.decode(new Uint8Array(buffer, 8, size))));
  return { ...metadata, packet: { ...metadata.packet, binary: new Uint8Array(buffer, 8 + size) } };
}
const legacy = new WeakMap<EncodedState, EncodedState>();
/** Cache the compatibility conversion once per publication, not per spectator. */
export function textSnapshotPacket(packet: EncodedState): EncodedState {
  if (!packet.binary) return packet;
  const previous = legacy.get(packet); if (previous) return previous;
  let text = "";
  for (let at = 0; at < packet.binary.length; at += 8192) text += String.fromCharCode(...packet.binary.subarray(at, at + 8192));
  const converted = { hash: packet.hash, payload: btoa(text) };
  legacy.set(packet, converted); return converted;
}
