import { HEIGHTMAP_MAPS, type HeightmapId } from "../content/Maps";

/** Agreed friends-match rules. The coordinator will enforce these when online. */
export const FRIENDS_MATCH_RULES = Object.freeze({
  mode: "free-for-all" as const,
  /** Human seats. AI opponents and tribes are separate counts. */
  slots: 20,
  minimumHumans: 2,
  countdownSeconds: 60,
});

export const LOBBY_MAP_IDS = HEIGHTMAP_MAPS.map((map) => map.id);
export type LobbyMapId = HeightmapId;

export function isLobbyMapId(value: unknown): value is LobbyMapId {
  return LOBBY_MAP_IDS.some((id) => id === value);
}
