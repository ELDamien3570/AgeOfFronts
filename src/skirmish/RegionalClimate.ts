// Authored map-generation inputs, independent of country borders, art and match
// state. These broad climate regions can be replaced by aligned biome datasets.
export interface ClimateRegion {
  latitude: number;
  longitude: number;
  latitudeRadius: number;
  longitudeRadius: number;
  minimumMoisture: number;
  woodlandBias: number;
}

export function climateInfluence(
  region: ClimateRegion,
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
