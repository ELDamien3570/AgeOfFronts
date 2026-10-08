import { generateBlackForest } from "./BlackForestMap";
import { isProceduralMap, type ProceduralMapId } from "./content/Maps";
import { generateMigration } from "./MigrationMap";
import type { LoadedMap } from "./Protocol";
export { isProceduralMap } from "./content/Maps";
const generators = {
  "black-forest": generateBlackForest,
  migration: generateMigration,
} satisfies Record<ProceduralMapId, (size: number, seed: number) => LoadedMap>;
export function generateProceduralMap(id: string, size: number, seed: number) {
  return isProceduralMap(id) ? generators[id](size, seed) : undefined;
}
