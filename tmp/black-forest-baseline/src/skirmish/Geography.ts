// Export footprint in normalized Web Mercator coordinates. This describes the
// source map, not a biome claim or a rule that affects the simulation.
export interface MapGeography {
  projection: "web-mercator";
  west: number;
  east: number;
  north: number;
  south: number;
}

export function latitudeAt(geography: MapGeography, fractionY: number): number {
  const y = geography.north + (geography.south - geography.north) * fractionY;
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

export function heightmapGeography(source?: {
  url: string;
  width: number;
  height: number;
}): MapGeography | undefined {
  if (!source) return undefined;
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return undefined;
  }
  if (url.hostname !== "manticorp.github.io") return undefined;
  const parts = url.hash.slice(1).split("/");
  const read = (key: string) => Number(parts[parts.indexOf(key) + 1]);
  const latitude = read("latitude"),
    longitude = read("longitude"),
    zoom = read("outputzoom");
  if (
    !["latitude", "longitude", "outputzoom"].every((key) =>
      parts.includes(key),
    ) ||
    ![latitude, longitude, zoom, source.width, source.height].every(
      Number.isFinite,
    ) ||
    Math.abs(latitude) > 85.05112878 ||
    Math.abs(longitude) > 180 ||
    zoom < 0 ||
    zoom > 22 ||
    source.width <= 0 ||
    source.height <= 0
  )
    return undefined;
  // The generator stitches 256-pixel tiles around exactPos at outputzoom:
  // https://github.com/manticorp/unrealheightmap/blob/main/src/processor.ts
  const worldPixels = 256 * 2 ** zoom,
    centerX = (longitude + 180) / 360,
    radians = (latitude * Math.PI) / 180,
    centerY = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  return {
    projection: "web-mercator",
    west: centerX - source.width / worldPixels / 2,
    east: centerX + source.width / worldPixels / 2,
    north: centerY - source.height / worldPixels / 2,
    south: centerY + source.height / worldPixels / 2,
  };
}
