import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";
import { NATION_ADVANCE_TREES_MESSAGE } from "../domain/Progression";

function progressionText(key: keyof typeof english.skirmish_progression): string {
  const fullKey = `skirmish_progression.${key}`;
  const translated = translateText(fullKey);
  return translated !== fullKey ? translated : english.skirmish_progression[key];
}

/** Age-advance status line. Fixed domain rejections with a translation are
 * translated; other domain text is shown as sent (as ServerText does). */
export function advanceStatusText(reason: string | null): string {
  if (reason === null) return progressionText("advance_ready");
  if (reason === NATION_ADVANCE_TREES_MESSAGE) return progressionText("advance_needs_warfare");
  return reason;
}
