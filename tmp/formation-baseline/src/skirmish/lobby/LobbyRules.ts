import { PLAYABLE_MAPS, type PlayableMapId } from "../content/Maps";

/** Agreed friends-match rules. The coordinator will enforce these when online. */
export const FRIENDS_MATCH_RULES = Object.freeze({
  mode: "free-for-all" as const,
  /** Human seats. AI opponents and tribes are separate counts. */
  slots: 20,
  minimumHumans: 2,
  countdownSeconds: 60,
});

/**
 * Maps too small to place every allowed faction. A lobby is valid when
 * `regularCost * (human seats + AI) + tribeCost * tribes <= budget`; full human
 * seats are assumed, since the roster is only known at start. Measured on
 * Amazon River at 250 (250 x 63) over 12 seeds: 26 regular camps fit with 30
 * tribes, 30 with 26 and 34 with 19 (about 1.75 tribe camps per regular camp).
 * The budget sits slightly below those results to leave margin for other seeds.
 */
export const MAP_CAMP_LIMITS: Partial<
  Record<
    PlayableMapId,
    Partial<
      Record<
        250 | 500 | 1000,
        { regularCost: number; tribeCost: number; budget: number }
      >
    >
  >
> = {
  "amazon-river": { 250: { regularCost: 7, tribeCost: 4, budget: 306 } },
  // Migration 250: conservatively below mixed-roster packing measured over 12 seeds.
  migration: { 250: { regularCost: 7, tribeCost: 4, budget: 250 } },
};

export const LOBBY_MAP_IDS = PLAYABLE_MAPS.map((map) => map.id);
export type LobbyMapId = PlayableMapId;

export function isLobbyMapId(value: unknown): value is LobbyMapId {
  return LOBBY_MAP_IDS.some((id) => id === value);
}
