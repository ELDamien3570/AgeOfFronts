import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";
import {
  MATCH_INITIALIZATION_FAILED_MESSAGE,
  MATCH_STOPPED_MESSAGE,
  NO_LIVING_HUMAN_MESSAGE,
  SPAWN_SELECTION_BUSY_MESSAGE,
} from "../multiplayer/application/TerminalMessages";
import { INVALID_PLAYTEST_RULES } from "../lobby/LobbyDirectory";
import type { ServerMessage } from "../multiplayer/Protocol";
import { COMMAND_VALIDATION_FAILURE } from "../CommandApplications";
import { MIXED_ARMY_SELECTION_MESSAGE } from "../domain/CommandPolicy";
import { VESSEL_REFIT_PORT_MESSAGE } from "../domain/RefitQuote";

type ServerTextKey = keyof typeof english.skirmish_server;

/** Fixed coordinator strings with a translation. Other server text is shown as sent. */
const KEYS: ReadonlyMap<string, ServerTextKey> = new Map<string, ServerTextKey>([
  [MATCH_STOPPED_MESSAGE, "match_stopped"],
  [MATCH_INITIALIZATION_FAILED_MESSAGE, "match_initialization_failed"],
  [
    "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.",
    "setup_not_enough_room",
  ],
  ["No viable land for starting camps", "setup_no_viable_land"],
  [COMMAND_VALIDATION_FAILURE, "command_validation_failure"],
  [MIXED_ARMY_SELECTION_MESSAGE, "mixed_army_selection"],
  [NO_LIVING_HUMAN_MESSAGE, "no_living_human"],
  [INVALID_PLAYTEST_RULES, "playtest_rules_invalid"],
  [SPAWN_SELECTION_BUSY_MESSAGE, "spawn_busy"],
  [VESSEL_REFIT_PORT_MESSAGE, "vessel_refit_port"],
]);

/** Text the lobby shows for an unsolicited (requestId-less) coordinator error,
 * e.g. a reserved match that could not start. Replies to requests are handled
 * by their own promise and yield undefined here. */
export function unsolicitedErrorText(message: ServerMessage): string | undefined {
  return message.type === "error" && message.requestId === undefined
    ? serverText(message.message)
    : undefined;
}

/** Translate a fixed coordinator message for display; unknown text passes through. */
export function serverText(message: string): string {
  const key = KEYS.get(message);
  if (!key) return message;
  const fullKey = `skirmish_server.${key}`;
  const translated = translateText(fullKey);
  return translated !== fullKey ? translated : english.skirmish_server[key];
}

/** Lobby status after the coordinator closed the socket for flooding. */
export function rateLimitedText(): string {
  const fullKey = "skirmish_server.rate_limited";
  const translated = translateText(fullKey);
  return translated !== fullKey ? translated : english.skirmish_server.rate_limited;
}
