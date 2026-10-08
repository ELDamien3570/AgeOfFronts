/** Map content identity is stable across display-name changes and saved rooms. */
export const HEIGHTMAP_MAPS = [
  {
    id: "heightmap-test1",
    name: "Mediterranean",
    assetRoot: "heightmap-test1",
    sourceWidth: 8192,
    sourceHeight: 4096,
  },
  {
    id: "africa",
    name: "Africa",
    assetRoot: "africa",
    sourceWidth: 4096,
    sourceHeight: 4096,
  },
  {
    id: "amazon-river",
    name: "Amazon River",
    assetRoot: "amazon-river",
    sourceWidth: 8192,
    sourceHeight: 2048,
  },
  {
    id: "old-world",
    name: "Old World",
    assetRoot: "old-world",
    sourceWidth: 4096,
    sourceHeight: 3072,
  },
  {
    id: "new-world",
    name: "New World",
    assetRoot: "new-world",
    sourceWidth: 6144,
    sourceHeight: 8192,
  },
  {
    id: "valles-kairulia",
    name: "Valles Kairulia",
    assetRoot: "valles-kairulia",
    sourceWidth: 4096,
    sourceHeight: 4096,
  },
  {
    id: "down-unda",
    name: "Down Unda",
    assetRoot: "down-unda",
    sourceWidth: 4096,
    sourceHeight: 4096,
  },
  {
    id: "middle-east",
    name: "Middle East",
    assetRoot: "middle-east",
    sourceWidth: 4096,
    sourceHeight: 4096,
  },
] as const;

export type HeightmapId = (typeof HEIGHTMAP_MAPS)[number]["id"];

/** A selected size bounds the longest edge; source proportions remain intact. */
export function heightmapDimensions(
  size: number,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (
    ![250, 500, 1000].includes(size) ||
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    throw new Error("Invalid heightmap dimensions");
  const longest = Math.max(sourceWidth, sourceHeight);
  return {
    width: Math.max(1, Math.round((size * sourceWidth) / longest)),
    height: Math.max(1, Math.round((size * sourceHeight) / longest)),
  };
}
