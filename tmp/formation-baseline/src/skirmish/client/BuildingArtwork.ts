import type { BuildingType } from "../Protocol";

const files = import.meta.glob<string>(
  "../../../Art/Building Icons/_prepared/StoneAge/*.png",
  { eager: true, query: "?url", import: "default" },
);

// Optional artwork stays in the view. Missing images retain the building glyph.
export const STONE_AGE_BUILDINGS: Partial<Record<BuildingType, string>> = {};
for (const kind of [
  "city",
  "factory",
  "port",
  "barracks",
  "archery",
  "stables",
] as const) {
  const url =
    files[`../../../Art/Building Icons/_prepared/StoneAge/${kind}.png`];
  if (url) STONE_AGE_BUILDINGS[kind] = url;
}

export class BuildingArtwork {
  private readonly images = new Map<BuildingType, HTMLImageElement>();

  constructor() {
    for (const [kind, url] of Object.entries(STONE_AGE_BUILDINGS)) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => this.images.set(kind as BuildingType, image);
      image.src = url;
    }
  }

  get(kind: BuildingType): HTMLImageElement | undefined {
    return this.images.get(kind);
  }
}
