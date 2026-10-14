/** Cosmetic sizes only. Never use these values for collision or combat. */
export const SOLDIER_PROJECTILE_SCALE = {
  flight: 0.45,
  ground: 0.45,
  embedded: 0.7,
} as const;
export type ProjectilePresentationState = keyof typeof SOLDIER_PROJECTILE_SCALE;
export function projectilePresentationScale(
  kind: string,
  state: ProjectilePresentationState,
): number {
  return ["arrow", "bow", "javelin", "bolt"].includes(kind)
    ? SOLDIER_PROJECTILE_SCALE[state]
    : 1;
}
