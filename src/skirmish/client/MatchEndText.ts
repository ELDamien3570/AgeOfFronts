import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";
import { serverText } from "./ServerText";

/** Player-facing text for a match the server ended. A known ending reason is
 * shown through translateText; other endings show the server's
 * message, translated when it is a fixed coordinator string. */
export function matchEndText(message: { message: string; reason?: "simulation-fault" }): string {
  if (message.reason === "simulation-fault") {
    const key = "skirmish_match.simulation_fault", translated = translateText(key);
    return translated !== key ? translated : english.skirmish_match.simulation_fault;
  }
  return `${serverText(message.message)}. Return to the lobby to play again.`;
}
