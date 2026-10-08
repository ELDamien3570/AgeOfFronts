import manifest from "../../../Art/Terrain/Earth/manifest.json";
import type { TerrainFamily } from "./EarthTerrainCatalog";

// Explicit selected paths keep superseded generations out of the game bundle.
const urls = import.meta.glob<string>(
  [
    "../../../Art/Terrain/Earth/temperate-woodland/starter-atlas-v2.png",
    "../../../Art/Terrain/Earth/boreal-conifer/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/tropical-moist/starter-atlas-v2.png",
    "../../../Art/Terrain/Earth/mediterranean-scrub/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/grassland-steppe/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/savanna-dry-woodland/starter-atlas-v2.png",
    "../../../Art/Terrain/Earth/desert-xeric/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/wetland-riparian/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/alpine/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/tundra/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/coastal/starter-atlas-v1.png",
    "../../../Art/Terrain/Earth/polar-ice/starter-atlas-v1.png",
  ],
  { eager: true, query: "?url", import: "default" },
);

export class TerrainArtwork {
  private readonly images = new Map<TerrainFamily, HTMLImageElement>();
  constructor(families: ReadonlySet<TerrainFamily>, changed: () => void) {
    for (const atlas of manifest.atlases) {
      const family = atlas.id as TerrainFamily;
      if (!families.has(family)) continue;
      const url = urls[`../../../Art/Terrain/Earth/${atlas.file}`];
      if (!url)
        throw new Error(`Selected terrain atlas is not bundled: ${atlas.file}`);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        this.images.set(family, image);
        changed();
      };
      image.src = url;
    }
  }
  get(family: TerrainFamily): HTMLImageElement | undefined {
    return this.images.get(family);
  }
}
