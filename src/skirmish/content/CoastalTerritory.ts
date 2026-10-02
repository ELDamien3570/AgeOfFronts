import type { GameMap } from "../../core/game/GameMap";

export const COASTAL_TERRITORY_RULES = Object.freeze({
  referenceSize: 500,
  oilTiles: 6,
  claimTiles: 8,
  boatRadius: 3,
  layerSeconds: 20,
  boatMultiplier: 2,
});
export function coastalRanges(map: Pick<GameMap, "width" | "height">) {
  const scale =
    Math.max(map.width(), map.height()) / COASTAL_TERRITORY_RULES.referenceSize;
  const claimTiles = Math.max(
    2,
    Math.round(COASTAL_TERRITORY_RULES.claimTiles * scale),
  );
  return {
    claimTiles,
    oilTiles: Math.max(
      1,
      Math.min(
        claimTiles - 1,
        Math.round(COASTAL_TERRITORY_RULES.oilTiles * scale),
      ),
    ),
    boatRadius: Math.max(
      1,
      Math.round(COASTAL_TERRITORY_RULES.boatRadius * scale),
    ),
  };
}
