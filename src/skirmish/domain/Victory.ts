import type { MatchEndReason, Player } from "../Protocol";

/** 13 R2.3 score weights (OD5: the army-gold term is dropped). Integer only. */
export const VICTORY_SCORE = Object.freeze({
  /** One point per this many owned land tiles. */
  landPerPoint: 20,
  completedCity: 300,
  /** Per age index (Stone Age = 0). */
  age: 1500,
  completedTechnology: 25,
  /** One point per this many enemy troops killed. */
  killsPerPoint: 4,
});

export interface VictoryCandidate {
  readonly id: number;
  readonly kind: Player["kind"];
  readonly eliminated: boolean;
  readonly land: number;
  /** Completed (built, standing) cities. */
  readonly cities: number;
  readonly ageIndex: number;
  readonly technologies: number;
  /** Absent in snapshots older than the kill counter. */
  readonly kills?: number;
}

export interface VictoryOutcome {
  readonly winner: number;
  readonly reason: MatchEndReason;
}

export function victoryScore(c: VictoryCandidate): number {
  const s = VICTORY_SCORE;
  return Math.floor(c.land / s.landPerPoint) + s.completedCity * c.cities + s.age * c.ageIndex +
    s.completedTechnology * c.technologies + Math.floor((c.kills ?? 0) / s.killsPerPoint);
}

/**
 * The end of a solo match, or null while it continues (13 R2.1, R2.6).
 *
 * - Tribes never win by conquest and never block one: the last living regular
 *   faction wins even while tribes survive.
 * - With no regular faction left, several living tribes keep playing (OD3); a
 *   lone surviving faction of any kind still wins, as before.
 * - No living faction at all is a draw (winner 0).
 * - At `limitTick` the living regular faction with the highest score wins,
 *   ties to the lower id; with no regular faction alive it is a draw.
 */
export function victoryOutcome(
  players: readonly VictoryCandidate[],
  tick: number,
  limitTick?: number,
): VictoryOutcome | null {
  const alive = players.filter(p => !p.eliminated);
  if (!alive.length) return { winner: 0, reason: "extinction" };
  const eligible = alive.filter(p => p.kind === "regular");
  if (eligible.length === 1) return { winner: eligible[0].id, reason: "conquest" };
  if (!eligible.length && alive.length === 1) return { winner: alive[0].id, reason: "conquest" };
  if (limitTick === undefined || tick < limitTick) return null;
  let best: VictoryCandidate | undefined, bestScore = -1;
  for (const p of eligible) {
    const score = victoryScore(p);
    if (score > bestScore || score === bestScore && best && p.id < best.id) { best = p; bestScore = score; }
  }
  return { winner: best?.id ?? 0, reason: "time-limit" };
}
