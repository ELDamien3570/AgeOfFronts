/** Authoring output, never raw image color interpreted by a view or worker. */
export interface EnvironmentData {
  readonly moisture: Uint8Array;
  readonly vegetation: Uint8Array;
  readonly aridity: Uint8Array;
  /** Optional authored biome IDs, indexed by ENVIRONMENT_FAMILIES. */
  readonly families?: Uint8Array;
}

export const ENVIRONMENT_ENCODING = "u8-moisture-vegetation-aridity";

export function decodeEnvironmentData(
  bytes: Uint8Array,
  size: number,
): EnvironmentData {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !(bytes instanceof Uint8Array) ||
    bytes.length !== size * 3
  )
    throw new Error("Invalid baked environment field");
  const moisture = new Uint8Array(size),
    vegetation = new Uint8Array(size),
    aridity = new Uint8Array(size);
  for (let tile = 0; tile < size; tile++) {
    moisture[tile] = bytes[tile * 3];
    vegetation[tile] = bytes[tile * 3 + 1];
    aridity[tile] = bytes[tile * 3 + 2];
  }
  return { moisture, vegetation, aridity };
}
