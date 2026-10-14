/** Temporary size experiment. Set to 1 to restore the normal soldier/body scale.
 * Shared by authoritative formation geometry and cosmetic soldier artwork.
 */
export const SOLDIER_SCALE: number = 0.5;
/** Approved cavalry body/art multiplier relative to the shared soldier scale. */
export const CAVALRY_SCALE: number = 0.9;
/** Approved pitch multiplier relative to the previous cavalry geometry. */
export const CAVALRY_PITCH: number = 0.7;
/** Deployed cavalry pitch experiment; member body/art size stays unchanged. */
export const CAVALRY_SPACING: number = 0.8 * CAVALRY_PITCH;
