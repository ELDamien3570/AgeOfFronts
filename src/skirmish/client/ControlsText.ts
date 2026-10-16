import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";

/** The standalone skirmish page has no language selector yet. */
export function controlsText(key: keyof typeof english.skirmish_controls): string {
  const fullKey = `skirmish_controls.${key}`;
  const translated = translateText(fullKey);
  return translated !== fullKey ? translated : english.skirmish_controls[key];
}
