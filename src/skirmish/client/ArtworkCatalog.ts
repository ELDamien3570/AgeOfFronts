import manifest from "../../../Art/Runtime/Ages/manifest.json";
import type { BuildingType } from "../Protocol";
import { AGES, type Age } from "../domain/Definitions";

export interface ArtworkClip {
  file: string;
  frames: number;
  columns: number;
  fps: number;
  loop: boolean;
}
export interface ArtworkAsset {
  file?: string;
  poster?: string;
  facing?: string;
  clips?: Record<string, ArtworkClip>;
}
export const ARTWORK_CATALOG: Readonly<Record<string, ArtworkAsset>> = {
  ...manifest,
  // Approved substitutions for missing Stone Age workshop, trader and ram art.
  // Entity ages, research unlocks, and construction remain domain-owned.
  "building-stoneage-siege-workshop":
    manifest["building-bronzeage-siege-workshop"],
  "stoneage-trader": manifest["bronzeage-trader"],
  "stoneage-siege": manifest["bronzeage-siege"],
};

// Resolve authored tiers and the explicit workshop substitution above. Later
// towers retain the latest authored wall-kit tier; presentation only.
export function buildingArtworkId(
  type: BuildingType,
  age: Age,
): string | undefined {
  return AGES.slice(0, AGES.indexOf(age) + 1)
    .reverse()
    .map((a) => `building-${a.toLowerCase()}-${type}`)
    .find((id) => id in ARTWORK_CATALOG);
}

// A locked command may preview its first available art. That never grants
// construction eligibility or changes the age of a building in the world.
export function buildingPreviewArtworkId(
  type: BuildingType,
  age: Age,
): string | undefined {
  return (
    buildingArtworkId(type, age) ??
    AGES.map((a) => `building-${a.toLowerCase()}-${type}`).find(
      (id) => id in ARTWORK_CATALOG,
    )
  );
}
