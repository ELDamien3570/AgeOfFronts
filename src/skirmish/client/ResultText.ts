import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";

type Key = keyof typeof english.skirmish_result;

function resultString(key: Key, params: Record<string, string> = {}): string {
  const fullKey = `skirmish_result.${key}`;
  const translated = translateText(fullKey, params);
  if (translated !== fullKey) return translated;
  return english.skirmish_result[key].replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => params[name] ?? placeholder,
  );
}

/** Title and description for the end-of-match screen, written from the
 * local player's point of view. `winner` is a player id, 0 for a draw, or
 * -1 for an allied victory shared by `allies`. */
export function resultText(
  winner: number,
  localPlayerId: number,
  players: readonly { id: number; name: string }[],
  allies: readonly number[] = [],
): { title: string; description: string } {
  const name = (id: number) =>
    players.find((p) => p.id === id)?.name ?? resultString("unknown_winner");
  if (winner === -1) {
    const title = resultString("allied_victory_title", {
      names: allies.map(name).join(", "),
    });
    return {
      title,
      description: resultString(
        allies.includes(localPlayerId)
          ? "allied_victory_description"
          : "allied_defeat_description",
      ),
    };
  }
  if (winner === localPlayerId)
    return {
      title: resultString("victory_title"),
      description: resultString("victory_description"),
    };
  if (winner === 0)
    return {
      title: resultString("draw_title"),
      description: resultString("draw_description"),
    };
  const params = { name: name(winner) };
  return {
    title: resultString("defeat_title", params),
    description: resultString("defeat_description", params),
  };
}
