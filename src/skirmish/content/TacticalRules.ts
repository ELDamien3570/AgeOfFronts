import { secondsToTicks } from '../Protocol';
import { FORMATION_MOVEMENT } from "../FormationMovementProfile";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
/** Calibration is domain data; no presentation state is consulted. */
export const MOTION = Object.freeze({
  turnPerTick: {
    mass: 16400/TICKS_PER_SECOND,
    "modern-loose": 32800/TICKS_PER_SECOND,
    wedge: 8200/TICKS_PER_SECOND,
    column: 8200/TICKS_PER_SECOND,
    line: 5460/TICKS_PER_SECOND,
    "shield-wall": 4100/TICKS_PER_SECOND,
    square: 8200/TICKS_PER_SECOND,
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
  dwellTicks: secondsToTicks(3),
  retryTicks: secondsToTicks(1),
  settleTicks: secondsToTicks(0.5),
  blockedTicks: secondsToTicks(1),
  decisionsPerTick: 16,
  transitionSpeedBp: 4000,
  // Dense-load D5 qualification failed for deployment/frontage movement.
  movingDeploy: false,
});

// mountedWidthRatioMax is a compile-time content gate only (scripts/FormationDoctrineSchema.ts).
// The current mounted recipes (e.g. bronze cavalry 8/12 -> 16/20 in the HEAD retune) put the
// widest authored line at 2.034x its era's widest infantry line (napoleonic-cavalry),
// so 1.35 rejected 20 of 24 variants. 2.05 admits the authored set and still rejects
// spacing exploits such as a 1024-unit cavalry spacing.
export const FRONTAGE = Object.freeze({quantum:16, candidatesPerDecision:6, mountedWidthRatioMax:2.05});
export const LINES = Object.freeze({gap:128,maxGap:768,rowGap:256,maxRows:16,
  bandGap:256,wingGap:384,reserveDepth:512,maxFrontTiles:40,gapCheckTicks:secondsToTicks(2),
  gapStrength:.25,relayoutTiles:1.5,retargetTicks:secondsToTicks(1.5),facingDeadband:Math.PI/9,facingRefreshTicks:secondsToTicks(3),rearWithdrawalTicks:secondsToTicks(1)});
export const ENGAGEMENT = Object.freeze({reservePercent:20,joinTiles:14,idleTicks:secondsToTicks(10),replanLossPct:.1,
  refreshTicks:secondsToTicks(3),quantum:12,maxPerTarget:2,maxArmies:12,maxLooseSquads:32,withdrawBelow:.55,
  advanceAbove:1.15,minPostureTicks:secondsToTicks(5),frontLeash:3,rangedLeash:1,pursuitSlack:2,wingCandidates:12,shapeCooldownTicks:secondsToTicks(10)});
export const BUDGETS = Object.freeze({engagementDetect:32,engagementPlan:48,armyMissions:24,missionQuantum:8,featureRows:16,positionScore:12,trenchAdmission:8,
  // R2-P18: stance evaluations per tick. 8 diluted large skirmish armies (a 32-squad
  // army re-evaluated each member every 4 ticks); 32 keeps every member under 0.5 s.
  skirmish:32});
export const TRENCH=Object.freeze({occupationRevision:2,segmentTiles:4,slotsPerTile:6,maxSegmentsPerSquad:4,alliedAccess:false,reductionBp:2000});
export const SKIRMISH=Object.freeze({minRemainingTicks:secondsToTicks(1),dangerTiles:5,cavalryDangerTiles:9,cooldownTicks:secondsToTicks(4),leashTiles:4,stepTiles:2,maxPerMinute:4,
  /** Every stance state is visited at least this often (I11, R2-P18). */
  visitTicks:secondsToTicks(1)});
export const ELEVATION=Object.freeze({minDeltaDm:60,saturateDm:400,maxRangeBp:1000,maxDamageBp:1000});
export const POSITIONS=Object.freeze({cell:8,ringTiles:10,minProminenceDm:80,maxObjectiveTiles:24,
  maxCandidates:6,minCommitTicks:secondsToTicks(30),reevaluateTicks:secondsToTicks(5),
  // T-d (owner default): an offensive army takes a hill only for this estimated gain (was 1.1).
  offensiveHillGain:1.03,
  weights:{prominence:2,coverage:100,facing:50,objectiveDistance:12,routeLength:4,territory:100}});
/** Phase 7 calibration values, in basis points unless otherwise stated. */
export const FACING={frontCos:.5,columnCos:.9,participantCos:.25,fullRanksCos:.5,
  exposure:{front:10000,flank:12500,rear:15000}} as const;
export const SHAPES={shieldRanged:6500,shieldMelee:8500,shieldSpeed:6000,
  squareCharge:4000,squareMounted:7500,squareRanged:12500,squareSpeed:3500,
  looseRanged:8000,nonLineFire:7500,minimum:2500,maximum:20000} as const;
export const TACTICAL_CHARGE={maxTargets:3,budgetFactor:1.5,wedgeFrontage:1.5,recoveryTicks:secondsToTicks(0.5)} as const;
/** AI battle policy (Next #5 tactics). Owner-tunable; see the commit messages for defaults. */
export const AI_BATTLE=Object.freeze({
  // T-b: an engaged army recovers only after this many commitment periods without
  // contact... or after commitmentCapFactor x commitmentTicks once nothing is fighting.
  commitmentCapFactor:3,
  // T-b: an engaged line that has had no contact for this long closes on the nearest enemy.
  standoffTicks:secondsToTicks(6),
  standoffSearchTiles:24,
  // T-b: an army is engaged while at least this share of its members fight.
  engagedShare:.25,
  // T-b: the re-deployed line stops this far short of the enemy centroid.
  pressStopTiles:2,
  // T-b: a routed target army within this many tiles is pursued.
  pursuitTiles:48,
  // I4: back-off before re-sending an objective move after a rejected route.
  objectiveRetryTicks:secondsToTicks(10),
  // I3: walls within this many tiles of a refused objective are breach targets.
  breachObjectiveTiles:16,
  breachCandidatesPerThink:4,
  // T-a: an unscreened enemy melee body this close makes an AI ranged member step back.
  evadeTriggerTiles:2,
  evadeStepTiles:3,
  // T-a: an enemy melee attacker within this formation gap is answered first.
  answerContactGap:FIXED/2,
  // T-c: an idle AI wing rider engages enemies within this many tiles beyond its weapon reach.
  wingGuardTiles:6,
  // T-b: extra leash (tiles) for AI frontline slots pressing a withdrawing army.
  advanceLeashTiles:4,
  // T-b: a depleted AI army with at least this local advantage keeps fighting.
  pressOnAdvantage:1.0,
});
