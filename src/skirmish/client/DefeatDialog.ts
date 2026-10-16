import english from "../../../resources/lang/en.json";
import { translateText } from "../../client/Utils";
import type { Snapshot } from "../Protocol";

type Key = keyof typeof english.skirmish_defeat;

export function defeatText(key: Key): string {
  const fullKey = `skirmish_defeat.${key}`, translated = translateText(fullKey);
  return translated !== fullKey ? translated : english.skirmish_defeat[key];
}

/** 13 R3 minimum: the local empire has fallen while the match continues. */
export function localDefeated(snapshot: Pick<Snapshot, "winner" | "players" | "localPlayerId">, localPlayerId: number): boolean {
  return snapshot.winner === null && snapshot.players.some(p => p.id === localPlayerId && p.eliminated);
}

/** Show the defeat dialog once: Observe dismisses it (camera, rival list and
 * events stay live), Leave returns to the lobby. */
export function showDefeatDialog(leave: () => void): void {
  if (document.getElementById("defeat")) return;
  const overlay = document.createElement("div");
  overlay.id = "defeat";
  overlay.className = "result";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-labelledby", "defeat-title");
  const panel = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = defeatText("eyebrow");
  const title = document.createElement("h2");
  title.id = "defeat-title";
  title.textContent = defeatText("title");
  const description = document.createElement("p");
  description.textContent = defeatText("description");
  const observe = document.createElement("button");
  observe.type = "button";
  observe.textContent = defeatText("observe");
  observe.addEventListener("click", () => { overlay.hidden = true; });
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "primary";
  exit.textContent = defeatText("leave");
  exit.addEventListener("click", leave);
  panel.append(eyebrow, title, description, observe, exit);
  overlay.append(panel);
  document.body.append(overlay);
}
