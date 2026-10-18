/** A paid navy protects actual same-sea infrastructure and observed cargo.
 * Doctrine changes investment intensity, never diplomacy or combat authority. */
export function navalHullDemand(input: {
  ports: number;
  coastSectors: number;
  protectedCargoValue: number;
  hullGold: number;
  raidOpportunity: boolean;
  raidHulls?: number;
  navalWeight: number;
  cap: number;
}): number {
  const exposure = Math.max(
    input.ports / 2,
    input.coastSectors / 2,
    input.protectedCargoValue / Math.max(1, input.hullGold),
  );
  const weighted = Math.ceil(
    (exposure * Math.max(75, Math.min(175, input.navalWeight))) / 100,
  );
  return Math.min(
    input.cap,
    Math.max(
      1,
      weighted +
        (input.raidOpportunity
          ? Math.max(1, Math.min(3, input.raidHulls ?? 1))
          : 0),
      input.raidOpportunity
        ? 1 + Math.max(1, Math.min(3, input.raidHulls ?? 1))
        : 0,
    ),
  );
}
