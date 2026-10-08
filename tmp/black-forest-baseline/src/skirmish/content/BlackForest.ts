/** Editable theme recipe. Layout and appearance share no camera or match state. */
export const BLACK_FOREST_THEME = Object.freeze({
  id: "black-forest",
  revision: 1,
  name: "Black Forest",
  clearingSpacing: 82,
  clearingRadiusRatio: 0.28,
  minimumClearingRadius: 19,
  passageHalfWidth: 4,
  extraConnectionRatio: 0.3,
  boundaryWidth: 5,
  woodlandFamily: "boreal-conifer" as const,
  clearingFamily: "grassland-steppe" as const,
  minimumForestCover: 215,
  maximumForestCover: 255,
  forestEdgeWidth: 6,
  pondsPerClearing: 0.2,
});
