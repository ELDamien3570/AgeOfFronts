import type { Building } from "../Protocol";

/** Stone is discretionary siege stock, never an opening economic prerequisite. */
export function extractionPriority(resource: string): number {
  return resource === "stone" ? 2 : resource === "horses" ? 1 : 0;
}
export function stoneExtractionAllowed(
  buildings: readonly Building[],
): boolean {
  return buildings.some(
    (b) =>
      b.type === "siege-workshop" && !b.remainingTicks && (b.health ?? 1) > 0,
  );
}
