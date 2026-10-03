// Authored map-generation inputs, independent of country borders, art and match
// state. These broad climate regions can be replaced by aligned biome datasets.
export interface ClimateRegion {
  latitude: number;
  longitude: number;
  latitudeRadius: number;
  longitudeRadius: number;
  minimumMoisture: number;
  maximumMoisture?: number;
  woodlandBias: number;
}

/** Validate authored climate inputs before they enter the shared environment. */
export function decodeClimateRegions(value: unknown): readonly ClimateRegion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid map climate regions");
  return value.map((region) => {
    if (
      !region ||
      typeof region !== "object" ||
      ![
        region.latitude,
        region.longitude,
        region.latitudeRadius,
        region.longitudeRadius,
        region.minimumMoisture,
        region.woodlandBias,
      ].every(Number.isFinite) ||
      Math.abs(region.latitude) > 90 ||
      Math.abs(region.longitude) > 180 ||
      region.latitudeRadius <= 0 ||
      region.longitudeRadius <= 0 ||
      region.minimumMoisture < 0 ||
      region.minimumMoisture > 1 ||
      region.woodlandBias < 0 ||
      region.woodlandBias > 1 ||
      (region.maximumMoisture !== undefined &&
        (!Number.isFinite(region.maximumMoisture) ||
          region.maximumMoisture < region.minimumMoisture ||
          region.maximumMoisture > 1))
    )
      throw new Error("Invalid map climate region");
    return Object.freeze({ ...region });
  });
}

export function climateInfluence(
  region: Pick<
    ClimateRegion,
    "latitude" | "longitude" | "latitudeRadius" | "longitudeRadius"
  >,
  latitude: number,
  longitude: number,
): number {
  const distance = Math.hypot(
    (latitude - region.latitude) / region.latitudeRadius,
    (longitude - region.longitude) / region.longitudeRadius,
  );
  const t = Math.max(0, Math.min(1, (distance - 0.55) / 0.45));
  return 1 - t * t * (3 - 2 * t);
}
