import { UNITS } from "../content/Units";
import manifest from "../../../Art/Runtime/Ages/manifest.json";
import russianManifest from "../../../Art/Runtime/Russians/manifest.json";
import type { BuildingType } from "../Protocol";
import { AGES, type Age } from "../domain/Definitions";

export interface ArtworkClip {
  file: string;
  frames: number;
  columns: number;
  fps: number;
  loop: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  groundBounds?: { x: number; y: number; width: number; height: number };
}
export interface ArtworkAsset {
  runtimeRoot?: "Ages" | "Russians";
  groundBounds?: { x: number; y: number; width: number; height: number };
  file?: string;
  poster?: string;
  facing?: string;
  clips?: Record<string, ArtworkClip>;
}
const legacyRuntime: Record<string, ArtworkAsset> = {...manifest};
for (const suffix of ["infantry", "archer", "cavalry", "siege", "field-support"] as const) {
  legacyRuntime[`napoleonic-${suffix}`] = manifest[`earlymodern-${suffix}`];
  legacyRuntime[`earlymodern-${suffix}`] = manifest[`modern-${suffix}`];
}
// Individual cohort actors and explicit icon fallbacks supersede baked atlases.
for (const unit of UNITS) if (unit.troopClass) delete legacyRuntime[unit.id];
const russianRuntime: Record<string, ArtworkAsset> = { ...russianManifest };
for(const age of ["earlymodern","modern"]) {
 const original=`building-${age}-anti-aircraft`,bound=`building-${age}-anti-air-emplacement`;
 russianRuntime[bound]=russianRuntime[original];
 for(const facing of ["n","e","s","w"])russianRuntime[`${bound}-firing-${facing}`]=russianRuntime[`${original}-firing-${facing}`];
}
export const ARTWORK_CATALOG: Readonly<Record<string, ArtworkAsset>> = {
  ...legacyRuntime,
  ...russianRuntime,
  // Keep the original terrain-kit trenches alongside the newer Russian nests.
  "building-earlymodern-trench": { ...manifest["building-modern-trench"], runtimeRoot: "Ages" },
  "building-modern-trench": { ...manifest["building-modern-trench"], runtimeRoot: "Ages" },
  "building-earlymodern-nuclear-facility":russianRuntime["building-earlymodern-nuclear-weapons-facility"],
  // The approved ram substitution remains until an authored Russian ram is ready.
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

export function aircraftArtworkId(kind: "fighter" | "bomber" | "drone", age: Age): string {
  if (kind === "drone") return "drone";
  return `${age === "Modern" ? "modern" : "earlymodern"}-${kind}`;
}
