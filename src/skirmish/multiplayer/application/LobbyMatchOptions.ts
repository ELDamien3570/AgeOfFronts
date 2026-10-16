import { FORMATION_MOVEMENT } from "../../content/FormationMovement";
import { DEFAULT_AI_POLICIES } from "../../content/AiPolicies";
import type { MatchOptions } from "../../Protocol";
import type { LobbySettings } from "../../lobby/LobbyDirectory";

export interface LobbyHuman {
  readonly name: string;
  readonly colorIndex?: number | null;
}

/** The simulation options an online lobby match runs with. The playtest probe
 * (scripts/playtestProbe.ts) builds its match from this same mapping, so it
 * measures the rules a lobby actually ships (13 pitfall 20). */
export function lobbyMatchOptions(
  settings: LobbySettings,
  humans: readonly LobbyHuman[],
  seed: number,
): MatchOptions {
  return {
    ...DEFAULT_AI_POLICIES,
    diplomacyRules: "raids-v1" as const,
    armyTravel: "corridors-v1" as const,
    ...FORMATION_MOVEMENT,
    seed,
    humanNames: humans.map((human) => human.name),
    ...(humans.some(human => typeof human.colorIndex === "number")
      ? { humanColors: humans.map(human => human.colorIndex ?? null) } : {}),
    aiCount: settings.aiCount,
    tribes: settings.tribeCount > 0,
    tribeCount: settings.tribeCount,
    ruleset: "ages-v1" as const,
    victoryMode: settings.victory,
    technologySpeed: settings.technologySpeed,
    startingAge: settings.startingAge,
    resourceDensity: settings.resourceDensity,
    resourceOutput: settings.resourceOutput,
    infiniteGoldForPlayers: settings.infiniteGoldForPlayers,
    alliances: settings.alliances,
    // Playtest rules (13 R1, R2, R4). A lobby saved before these settings
    // existed omits them and keeps the historical rules.
    ...(settings.timeLimitMinutes === undefined ? {} : { timeLimitMinutes: settings.timeLimitMinutes }),
    ...(settings.startProtectionMinutes === undefined ? {} : { startProtectionMinutes: settings.startProtectionMinutes }),
    ...(settings.aiDifficulty === undefined ? {} : { aiDifficulty: settings.aiDifficulty }),
    // Online matches use the playtest tribe opening (13 R1.2, OD10). Direct
    // construction (tests, saved replays) keeps the historical tribe numbers.
    tribeOpening: LOBBY_TRIBE_OPENING,
  };
}

/** 13 OD10: the lobby's tribe opening; remove to restore historical tribes. */
export const LOBBY_TRIBE_OPENING = "playtest-v1" as const;
