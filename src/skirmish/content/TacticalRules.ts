import { FORMATION_MOVEMENT } from "../FormationMovementProfile";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
/** Calibration is domain data; no presentation state is consulted. */
export const MOTION = Object.freeze({
  turnPerTick: {
    mass: 820,
    "modern-loose": 1640,
    wedge: 410,
    column: 410,
    line: 273,
    "shield-wall": 205,
    square: 410,
  },
  strafeFloor: 0.35,
  arrivalDeadband: FIXED / 4,
  fallbackCone: Math.PI / 2,
  turnRate: FORMATION_MOVEMENT.foot.squadTurnRate / TICKS_PER_SECOND,
  prepareTicks: 4 * TICKS_PER_SECOND,
  pivotThreshold: Math.PI / 9,
  launchAlignment: Math.PI / 15,
  chargeAlignment: Math.PI / 15,
  steeringCone: Math.PI / 7,
});
export const CONTACT = Object.freeze({ enter: 4, release: FIXED / 8 });
export const TERRAIN = Object.freeze({
  softDeploy: FIXED * 0.5,
  softHold: FIXED * 0.75,
});
export const COLUMN = Object.freeze({
  routeTiles: 32,
  longTravelTroops: 24,
  windingRatio: 1.5,
  probeCount: 3,
  dwellTicks: 60,
  retryTicks: 20,
  settleTicks: 10,
  blockedTicks: 20,
  decisionsPerTick: 16,
  transitionSpeedBp: 4000,
  // Dense-load D5 qualification failed for deployment/frontage movement.
  movingDeploy: false,
});

export const FRONTAGE = Object.freeze({quantum:16, candidatesPerDecision:6, mountedWidthRatioMax:1.35});
export const LINES = Object.freeze({gap:192,maxGap:768,rowGap:256,maxRows:16});
