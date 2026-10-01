import type { RuntimeMap } from "./HostedRuntime";
/** Identity covers immutable world inputs, including biome-derived resource placement. */
export async function mapIdentity(map: RuntimeMap): Promise<string> {
  const parts: Uint8Array[] = [
    new TextEncoder().encode(
      JSON.stringify({
        width: map.width,
        height: map.height,
        elevation: map.elevation
          ? {
              minimum: map.elevation.minimum,
              maximum: map.elevation.maximum,
              seaLevel: map.elevation.seaLevel,
            }
          : null,
        forest: !!map.forest,
        resourceTerrain: !!map.resourceTerrain,
      }),
    ),
  ];
  parts.push(map.terrain);
  if (map.elevation)
    parts.push(
      new Uint8Array(
        map.elevation.values.buffer,
        map.elevation.values.byteOffset,
        map.elevation.values.byteLength,
      ),
    );
  if (map.forest) parts.push(map.forest.cover);
  if (map.resourceTerrain) parts.push(map.resourceTerrain.desert);
  const bytes = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
