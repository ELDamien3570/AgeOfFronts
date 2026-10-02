import {
  factionCountRange,
  factionDefaults,
  MAX_HUMAN_PLAYERS,
} from "../FactionRules";
import { createEmpireProfile, type EmpireProfile } from "./EmpireProfile";
import { AGES, type Age } from "../domain/Definitions";
import {
  FRIENDS_MATCH_RULES,
  isLobbyMapId,
  MAP_CAMP_LIMITS,
  type LobbyMapId,
} from "./LobbyRules";

export const CUSTOM_LOBBY_LIMIT = 3;
export const MAX_LOBBY_TITLE_LENGTH = 40;
export const RESOURCE_MULTIPLIERS = [1, 2, 3, 5] as const;
export type ResourceMultiplier = (typeof RESOURCE_MULTIPLIERS)[number];

export interface LobbySettings {
  readonly mapId: LobbyMapId;
  readonly mode: "free-for-all";
  /** Human seats. */
  readonly slots: number;
  readonly minimumHumans: number;
  readonly countdownSeconds: number;
  readonly worldSize: 250 | 500 | 1000;
  /** Regular AI opponents, added to the humans. Base by map size; 0–14. */
  readonly aiCount: number;
  /** Minor tribes. Base by map size; 0–30. */
  readonly tribeCount: number;
  readonly technologySpeed: 1 | 2 | 3;
  readonly startingAge?: Age;
  readonly resourceDensity: ResourceMultiplier;
  readonly resourceOutput: ResourceMultiplier;
  readonly alliances: boolean;
  readonly victory: "solo" | "allied";
  /** Explicit opt-in to newcomers taking an unclaimed regular AI. */
  readonly publicAiTakeover?: boolean;
}

export function defaultLobbySettings(
  mapId: LobbyMapId,
  worldSize: LobbySettings["worldSize"] = 500,
): LobbySettings {
  return Object.freeze({
    ...FRIENDS_MATCH_RULES,
    mapId,
    worldSize,
    ...factionDefaults(worldSize),
    technologySpeed: 1,
    startingAge: "StoneAge",
    resourceDensity: 1,
    resourceOutput: 1,
    alliances: false,
    victory: "solo",
    publicAiTakeover: true,
  });
}

export function validateLobbySettings(settings: LobbySettings): LobbySettings {
  if (!isLobbyMapId(settings.mapId) || settings.mode !== "free-for-all")
    throw new Error("Choose a supported map and match mode.");
  if (
    !Number.isInteger(settings.slots) ||
    settings.slots < 2 ||
    settings.slots > MAX_HUMAN_PLAYERS
  )
    throw new Error(`Choose between 2 and ${MAX_HUMAN_PLAYERS} human seats.`);
  if (
    !Number.isInteger(settings.minimumHumans) ||
    settings.minimumHumans < 1 ||
    settings.minimumHumans > settings.slots
  )
    throw new Error(
      "Minimum humans must be between 1 and the number of human seats.",
    );
  if (
    !Number.isInteger(settings.countdownSeconds) ||
    settings.countdownSeconds < 15 ||
    settings.countdownSeconds > 300
  )
    throw new Error("The start timer must be between 15 and 300 seconds.");
  if (
    ![250, 500, 1000].includes(settings.worldSize) ||
    ![1, 2, 3].includes(settings.technologySpeed)
  )
    throw new Error("Choose a supported world size and technology speed.");
  for (const [kind, label] of [
    ["aiCount", "AI opponents"],
    ["tribeCount", "tribes"],
  ] as const) {
    const { min, max } = factionCountRange(settings.worldSize, kind);
    if (
      !Number.isInteger(settings[kind]) ||
      settings[kind] < min ||
      settings[kind] > max
    )
      throw new Error(
        `Choose between ${min} and ${max} ${label} for this map size.`,
      );
  }
  if (
    !RESOURCE_MULTIPLIERS.includes(settings.resourceDensity) ||
    !RESOURCE_MULTIPLIERS.includes(settings.resourceOutput)
  )
    throw new Error(
      "Resource density and deposit output must be 1×, 2×, 3× or 5×.",
    );
  const limit = MAP_CAMP_LIMITS[settings.mapId]?.[settings.worldSize];
  if (
    limit &&
    limit.regularCost * (settings.slots + settings.aiCount) +
      limit.tribeCost * settings.tribeCount >
      limit.budget
  )
    throw new Error(
      `This map is too small at ${settings.worldSize} cells for ${settings.slots} human seats, ${settings.aiCount} AI and ${settings.tribeCount} tribes. Choose fewer seats, AI or tribes, or a larger map size.`,
    );
  if (typeof settings.alliances !== "boolean")
    throw new Error("Choose the alliance rules.");
  if (
    !["solo", "allied"].includes(settings.victory) ||
    (settings.victory === "allied" && !settings.alliances)
  )
    throw new Error("Allied conquest requires alliances to be allowed.");
  if (
    settings.startingAge !== undefined &&
    !AGES.includes(settings.startingAge)
  )
    throw new Error("Choose a supported starting age.");
  if (settings.publicAiTakeover !== undefined && typeof settings.publicAiTakeover !== "boolean")
    throw new Error("Choose whether public AI takeover is allowed.");
  return Object.freeze({ ...settings, publicAiTakeover: settings.publicAiTakeover ?? true });
}

/**
 * Brings settings saved before AI and tribe counts existed up to date. Only an
 * absent count gets the map size's base; any other invalid value still fails
 * validation. The retired "AI fills vacancies" flag is dropped.
 */
export function migrateLobbySettings(saved: LobbySettings): LobbySettings {
  const settings: Record<string, unknown> = { ...saved };
  delete settings.fillVacanciesWithAi;
  if ([250, 500, 1000].includes(saved.worldSize)) {
    const defaults = factionDefaults(saved.worldSize);
    if (settings.aiCount === undefined) settings.aiCount = defaults.aiCount;
    if (settings.tribeCount === undefined)
      settings.tribeCount = defaults.tribeCount;
  }
  if (settings.startingAge === undefined) settings.startingAge = "StoneAge";
  if (settings.publicAiTakeover === undefined) settings.publicAiTakeover = true;
  return settings as unknown as LobbySettings;
}
export interface CustomLobby {
  readonly id: string;
  readonly title: string;
  readonly owner: EmpireProfile;
  readonly settings: LobbySettings;
}

/** Directory invariants, independent of presentation, persistence or transport. */
export class LobbyDirectory {
  private listed: CustomLobby[] = [];
  private waiting: CustomLobby[] = [];

  get visible(): readonly CustomLobby[] {
    return [...this.listed];
  }
  get queue(): readonly CustomLobby[] {
    return [...this.waiting];
  }
  get full(): boolean {
    return this.listed.length === CUSTOM_LOBBY_LIMIT;
  }

  create(room: CustomLobby, willingToWait: boolean): "visible" | "queued" {
    const title = room.title.trim().normalize("NFC");
    if (
      !title ||
      Array.from(title).length > MAX_LOBBY_TITLE_LENGTH ||
      // eslint-disable-next-line no-control-regex -- rejects control characters on purpose
      /[\u0000-\u001f\u007f]/u.test(title)
    )
      throw new Error(
        `Use a lobby name of 1–${MAX_LOBBY_TITLE_LENGTH} characters.`,
      );
    if (!/^[a-zA-Z0-9-]{1,80}$/u.test(room.id) || this.find(room.id))
      throw new Error(
        "This lobby already exists or has an invalid identifier.",
      );
    const entry = Object.freeze({
      ...room,
      title,
      owner: createEmpireProfile(room.owner.name, room.owner.flagCode),
      settings: validateLobbySettings(room.settings),
    });
    if (!this.full) {
      this.listed.push(entry);
      return "visible";
    }
    if (!willingToWait)
      throw new Error(
        "All three custom spaces are occupied. Opt into the waiting queue to create this lobby.",
      );
    this.waiting.push(entry);
    return "queued";
  }

  find(id: string): CustomLobby | undefined {
    return [...this.listed, ...this.waiting].find((room) => room.id === id);
  }

  /** Close a listed room or cancel its queue entry; promote the earliest waiter. */
  remove(id: string): boolean {
    const listedIndex = this.listed.findIndex((room) => room.id === id);
    if (listedIndex >= 0) {
      this.listed.splice(listedIndex, 1);
      const promoted = this.waiting.shift();
      if (promoted) this.listed.push(promoted);
      return true;
    }
    const queuedIndex = this.waiting.findIndex((room) => room.id === id);
    if (queuedIndex < 0) return false;
    this.waiting.splice(queuedIndex, 1);
    return true;
  }
}
