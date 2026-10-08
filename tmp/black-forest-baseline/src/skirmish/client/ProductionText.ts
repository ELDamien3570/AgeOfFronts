import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";

/** The standalone skirmish page has no language selector yet. */
export function productionText(
  key: keyof typeof english.skirmish_production,
  params: Record<string, string | number> = {},
): string {
  const fullKey = `skirmish_production.${key}`;
  const translated = translateText(fullKey, params);
  if (translated !== fullKey) return translated;
  return english.skirmish_production[key].replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => String(params[name] ?? placeholder),
  );
}
