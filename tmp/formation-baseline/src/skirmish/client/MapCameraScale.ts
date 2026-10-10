/** Shared CSS-pixel camera calibration for the game and renderer review scenes. */
export const MAX_MAP_SCALE = 96;
export function mapFitScale(
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
  hudBottomInset = 0,
): number {
  const usableHeight = Math.max(100, height - hudBottomInset);
  return Math.min((width - 52) / mapWidth, (usableHeight - 52) / mapHeight);
}
export function mapStartingScale(
  width: number,
  height: number,
  fitScale: number,
  hudBottomInset = 0,
): number {
  const usableHeight = Math.max(100, height - hudBottomInset);
  return Math.max(
    fitScale,
    Math.min(MAX_MAP_SCALE, Math.min(width, usableHeight) / 48),
  );
}
export function clampMapScale(scale: number, fitScale: number): number {
  return Math.max(fitScale, Math.min(MAX_MAP_SCALE, scale));
}
