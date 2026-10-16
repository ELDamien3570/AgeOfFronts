import { AI_DIFFICULTIES, secondsToTicks, type AiDifficulty, type MatchOptions } from "../Protocol";

/** Playtest rule options (13 R1, R2, R4). Every field is optional; absence is
 * the historical behaviour, so saved matches and fixtures replay unchanged. */
type PlaytestOptions = Pick<MatchOptions,
  "humanNames" | "timeLimitMinutes" | "startProtectionMinutes" | "aiDifficulty" | "tribeOpening">;

export const MAX_TIME_LIMIT_MINUTES = 600;
export const MAX_START_PROTECTION_MINUTES = 60;

export function validatePlaytestOptions(options: PlaytestOptions): void {
  const minutes = (value: number | undefined, minimum: number, maximum: number) =>
    value === undefined || Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  if (!minutes(options.timeLimitMinutes, 1, MAX_TIME_LIMIT_MINUTES)) throw new Error("Invalid match time limit");
  if (!minutes(options.startProtectionMinutes, 0, MAX_START_PROTECTION_MINUTES)) throw new Error("Invalid start protection");
  if (options.aiDifficulty !== undefined && !AI_DIFFICULTIES.includes(options.aiDifficulty)) throw new Error("Invalid AI difficulty");
  if (options.tribeOpening !== undefined && options.tribeOpening !== "playtest-v1") throw new Error("Invalid tribe opening");
}

/** Seat identity, not controller: an AI-driven human seat is still a human
 * seat (13 OD1). The same rule assigns `Player.ai` at deployment. */
export function isHumanSeat(options: Pick<MatchOptions, "humanNames">, playerId: number): boolean {
  return playerId >= 1 && playerId <= (options.humanNames?.length ?? 1);
}

/** The tick at which the time limit ends the match, or undefined for none. */
export function timeLimitTick(options: Pick<MatchOptions, "timeLimitMinutes">): number | undefined {
  return options.timeLimitMinutes === undefined ? undefined : secondsToTicks(options.timeLimitMinutes * 60);
}

/** The first tick a human seat is no longer start-protected (0 = none). */
export function startProtectionUntil(options: Pick<MatchOptions, "startProtectionMinutes">): number {
  return secondsToTicks((options.startProtectionMinutes ?? 0) * 60);
}

/** Absent difficulty is today's AI, which the table calls "hard". */
export function aiDifficultyOf(options: Pick<MatchOptions, "aiDifficulty"> | undefined): AiDifficulty {
  return options?.aiDifficulty ?? "hard";
}
