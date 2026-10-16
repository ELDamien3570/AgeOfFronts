import english from "../../../../resources/lang/en.json";
import { translateText } from "../../../client/Utils";
import { AI_DIFFICULTIES, type AiDifficulty } from "../../Protocol";
import {
  PLAYTEST_LOBBY_DEFAULTS,
  START_PROTECTION_CHOICES,
  TIME_LIMIT_CHOICES,
  type LobbySettings,
} from "../../lobby/LobbyDirectory";

type Key = keyof typeof english.skirmish_lobby_rules;

/** Lobby text for the playtest rules (13 R1, R2, R4), through translateText
 * with the English entry as the fallback when no language is loaded. */
export function playtestRuleText(key: Key, params: Record<string, string | number> = {}): string {
  const fullKey = `skirmish_lobby_rules.${key}`, translated = translateText(fullKey, params);
  if (translated !== fullKey) return translated;
  return english.skirmish_lobby_rules[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

const minutes = (value: number) => playtestRuleText("minutes", { minutes: value });
const protection = (value: number) => (value ? minutes(value) : playtestRuleText("protection_none"));
const difficulty = (value: AiDifficulty) => playtestRuleText(`difficulty_${value}`);
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const options = <T extends string | number>(values: readonly T[], selected: T, label: (value: T) => string) =>
  values.map(value => `<option value="${value}"${value === selected ? " selected" : ""}>${escape(label(value))}</option>`).join("");

/** Three selects for the create-lobby dialog. */
export function playtestRuleFields(): string {
  const d = PLAYTEST_LOBBY_DEFAULTS;
  return `<div class="settings-row three"><label>${escape(playtestRuleText("start_protection"))}<select name="startProtectionMinutes">${options(START_PROTECTION_CHOICES, d.startProtectionMinutes, protection)}</select></label><label>${escape(playtestRuleText("time_limit"))}<select name="timeLimitMinutes">${options(TIME_LIMIT_CHOICES, d.timeLimitMinutes, minutes)}</select></label><label>${escape(playtestRuleText("ai_difficulty"))}<select name="aiDifficulty">${options(AI_DIFFICULTIES, d.aiDifficulty, difficulty)}</select></label></div><p class="settings-hint">${escape(playtestRuleText("hint"))}</p>`;
}

/** Match-rules preview rows; a lobby saved before these rules shows none. */
export function playtestRuleRows(r: LobbySettings): string {
  const row = (term: string, value: string) => `<div><dt>${escape(term)}</dt><dd>${escape(value)}</dd></div>`;
  return (r.startProtectionMinutes === undefined ? "" : row(playtestRuleText("start_protection"), protection(r.startProtectionMinutes))) +
    (r.timeLimitMinutes === undefined ? "" : row(playtestRuleText("time_limit"), minutes(r.timeLimitMinutes))) +
    (r.aiDifficulty === undefined ? "" : row(playtestRuleText("ai_difficulty"), difficulty(r.aiDifficulty)));
}
