import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";

/** Player-facing text for a match the server ended. A known ending reason is
 * shown through translateText; other endings keep the server's message. */
export function matchEndText(message: { message: string; reason?: "simulation-fault" }): string {
  if (message.reason === "simulation-fault") {
    const key = "skirmish_match.simulation_fault", translated = translateText(key);
    return translated !== key ? translated : english.skirmish_match.simulation_fault;
  }
  return `${message.message}. Return to the lobby to play again.`;
}
