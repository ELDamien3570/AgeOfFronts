import { describe, expect, it } from "vitest";
import english from "../../resources/lang/en.json";
import {
  defaultLobbySettings,
  INVALID_PLAYTEST_RULES,
  validateLobbySettings,
  type LobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";
import { clientMessageSchema } from "../../src/skirmish/multiplayer/Protocol";
import { lobbyMatchOptions } from "../../src/skirmish/multiplayer/application/LobbyMatchOptions";
import { playtestRuleFields, playtestRuleRows } from "../../src/skirmish/client/lobby/PlaytestRulesText";
import { serverText } from "../../src/skirmish/client/ServerText";
import { NO_LIVING_HUMAN_MESSAGE } from "../../src/skirmish/multiplayer/application/TerminalMessages";

const base = defaultLobbySettings("africa");
const create = (settings: object) => clientMessageSchema.safeParse({
  type: "create", requestId: "r1", title: "t", settings, willingToWait: false,
});

describe("playtest lobby rules (13 A1)", () => {
  it("defaults new lobbies to no start protection, 90 min limit and standard AI", () => {
    expect(base).toMatchObject({ startProtectionMinutes: 0, timeLimitMinutes: 90, aiDifficulty: "standard" });
    expect(validateLobbySettings(base)).toMatchObject({ startProtectionMinutes: 0 });
  });

  it("accepts only the offered choices, and lobbies saved without them", () => {
    for (const bad of [{ startProtectionMinutes: 7 }, { timeLimitMinutes: 0 }, { aiDifficulty: "brutal" }])
      expect(() => validateLobbySettings({ ...base, ...bad } as LobbySettings)).toThrow(INVALID_PLAYTEST_RULES);
    const { startProtectionMinutes: _p, timeLimitMinutes: _t, aiDifficulty: _a, ...legacy } = base;
    expect(() => validateLobbySettings(legacy as LobbySettings)).not.toThrow();
    expect(create(legacy).success).toBe(true);
    expect(create(base).success).toBe(true);
    expect(create({ ...base, timeLimitMinutes: 45 }).success).toBe(false);
  });

  it("maps the lobby rules into the match options, and omits them for legacy lobbies", () => {
    const options = lobbyMatchOptions(base, [{ name: "A" }, { name: "B" }], 7);
    expect(options).toMatchObject({ seed: 7, humanNames: ["A", "B"], startProtectionMinutes: 0, timeLimitMinutes: 90,
      aiDifficulty: "standard", tribeOpening: "playtest-v1", diplomacyRules: "raids-v1" });
    const { startProtectionMinutes: _p, timeLimitMinutes: _t, aiDifficulty: _a, ...legacy } = base;
    const old = lobbyMatchOptions(legacy as LobbySettings, [{ name: "A" }], 7);
    expect("timeLimitMinutes" in old || "startProtectionMinutes" in old || "aiDifficulty" in old).toBe(false);
  });

  it("renders translated selects and preview rows", () => {
    const fields = playtestRuleFields();
    expect(fields).toContain('name="startProtectionMinutes"');
    expect(fields).toContain('<option value="8">8 min</option>');
    expect(fields).toContain('<option value="0" selected>None</option>');
    expect(fields).toContain('<option value="standard" selected>Standard</option>');
    expect(playtestRuleRows(base)).toContain("<dt>Time limit</dt><dd>90 min</dd>");
    for (const key of ["start_protection", "time_limit", "ai_difficulty", "minutes", "protection_none", "difficulty_relaxed",
      "difficulty_standard", "difficulty_hard", "hint"]) expect(english.skirmish_lobby_rules).toHaveProperty(key);
  });

  it("translates the fixed humanless and invalid-rules server strings", () => {
    expect(serverText(NO_LIVING_HUMAN_MESSAGE)).toBe(english.skirmish_server.no_living_human);
    expect(serverText(INVALID_PLAYTEST_RULES)).toBe(english.skirmish_server.playtest_rules_invalid);
  });
});
