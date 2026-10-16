import { secondsToTicks, type AiDifficulty } from "../Protocol";

export interface AiDifficultyRules {
  /** Regular AI may not start a raid or campaign before this tick; the
   * personality's own raidAfterTicks applies when it is later. */
  readonly raidFloorTicks: number;
  /** Most concurrent AI campaigns (preparing or at war) against one human seat. */
  readonly humanCampaignCap: number;
  /** Added to the combat advantage an AI requires before a war. */
  readonly requiredAdvantageAdd: number;
  /** Minimum advantage to leave peaceful expansion for a war on a human seat;
   * 0 keeps the personality's own veto. */
  readonly expandingVetoVsHuman: number;
}

/** 13 R4 minimum table. "hard" is today's AI exactly and is the default when a
 * match records no difficulty. Income, think interval and tribe-cap rows of the
 * notes' table are deferred (not minimum). */
export const AI_DIFFICULTY: Readonly<Record<AiDifficulty, AiDifficultyRules>> = Object.freeze({
  relaxed: { raidFloorTicks: secondsToTicks(8 * 60), humanCampaignCap: 1, requiredAdvantageAdd: .5, expandingVetoVsHuman: 3 },
  standard: { raidFloorTicks: secondsToTicks(4 * 60), humanCampaignCap: 2, requiredAdvantageAdd: .2, expandingVetoVsHuman: 2.5 },
  hard: { raidFloorTicks: 0, humanCampaignCap: Number.POSITIVE_INFINITY, requiredAdvantageAdd: 0, expandingVetoVsHuman: 0 },
});

/** The tick from which a regular AI with this personality may raid. */
export const aiRaidAfterTicks = (personalityTicks: number, rules: AiDifficultyRules): number =>
  Math.max(personalityTicks, rules.raidFloorTicks);
