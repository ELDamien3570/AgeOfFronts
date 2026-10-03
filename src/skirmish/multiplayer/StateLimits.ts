/** Shared structural transport envelopes, not a V8 heap or capacity claim.
 * Producers and their intended consumers must use the same profile. */
export const STATE_LIMITS = Object.freeze({
  maxWireBytes: 64_000_000,
  maxPayloadChars: 32_000_000,
  maxArrayBytes: 256_000_000,
  maxMetadataBytes: 64_000_000,
  maxMetadataTokens: 4_000_000,
  maxArrays: 100_000,
});
export type StateEnvelope = { -readonly [K in keyof typeof STATE_LIMITS]: number };
export const MAX_RLE_ELEMENTS = 64_000_000;
export const SNAPSHOT_QUEUE_LIMITS = Object.freeze({ states: 8, bytes: 16 * 1024 * 1024 });
export const SNAPSHOT_STATE_LIMITS: Readonly<StateEnvelope> = Object.freeze({
  ...STATE_LIMITS, maxArrayBytes: 64_000_000,
  // Incoming JS strings are accounted as two bytes per character by the client.
  maxPayloadChars: SNAPSHOT_QUEUE_LIMITS.bytes / 2,
});

export function stateEnvelope(limits: Partial<StateEnvelope>): StateEnvelope {
  const result = { ...STATE_LIMITS } as StateEnvelope;
  for (const name of Object.keys(STATE_LIMITS) as (keyof StateEnvelope)[]) {
    const override = limits[name];
    let value: number = STATE_LIMITS[name];
    if (override !== undefined) value = override;
    if (!Number.isSafeInteger(value) || value < 0 || value > STATE_LIMITS[name])
      throw new Error("Invalid decoded memory budget");
    result[name] = value;
  }
  return result;
}
