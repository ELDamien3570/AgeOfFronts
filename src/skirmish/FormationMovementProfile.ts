/** Shared locomotion capacity, in tiles/seconds and radians. No artwork or member state. */
export const FORMATION_MOVEMENT = {
  foot: {
    squadAcceleration: 2,
    squadBraking: 3.2,
    squadTurnRate: (40 * Math.PI) / 180,
    reformTurnRate: (360 * Math.PI) / 180,
    reformPivotSpeed: 540,
    reformPivotAcceleration: 3240,
    followerAcceleration: 5,
    followerBraking: 14,
    stepAcceleration: 1.6,
    stepBraking: 3.2,
    stepSpeed: 1.25,
    pivotSpeed: 240,
    pivotVariation: 30,
    pivotAcceleration: 960,
  },
  mounted: {
    squadAcceleration: 3.2,
    squadBraking: 4.8,
    squadTurnRate: (30 * Math.PI) / 180,
    reformTurnRate: (240 * Math.PI) / 180,
    reformPivotSpeed: 360,
    reformPivotAcceleration: 2160,
    followerAcceleration: 8,
    followerBraking: 20,
    stepAcceleration: 2.4,
    stepBraking: 4.8,
    stepSpeed: 2,
    pivotSpeed: 180,
    pivotVariation: 20,
    pivotAcceleration: 720,
  },
} as const;
export const formationMovementProfile = (mounted: boolean) =>
  mounted ? FORMATION_MOVEMENT.mounted : FORMATION_MOVEMENT.foot;
