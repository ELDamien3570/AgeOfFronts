import { createEmpireProfile, type EmpireProfile } from "./EmpireProfile";
import {
  FRIENDS_MATCH_RULES,
  isLobbyMapId,
  type LobbyMapId,
} from "./LobbyRules";

export const CUSTOM_LOBBY_LIMIT = 3;
export const MAX_LOBBY_TITLE_LENGTH = 40;
export const RESOURCE_MULTIPLIERS = [1, 2, 3, 5] as const;
export type ResourceMultiplier = (typeof RESOURCE_MULTIPLIERS)[number];

export interface LobbySettings {
  readonly mapId: LobbyMapId;
  readonly mode: "free-for-all";
  readonly slots: number;
  readonly minimumHumans: number;
  readonly countdownSeconds: number;
  readonly fillVacanciesWithAi: boolean;
  readonly worldSize: 250 | 500 | 1000;
  readonly technologySpeed: 1 | 2 | 3;
  readonly resourceDensity: ResourceMultiplier;
  readonly resourceOutput: ResourceMultiplier;
  readonly alliances: boolean;
  readonly victory: "solo" | "allied";
}

export function defaultLobbySettings(mapId: LobbyMapId): LobbySettings {
  return Object.freeze({
    ...FRIENDS_MATCH_RULES,
    mapId,
    worldSize: 500,
    technologySpeed: 1,
    resourceDensity: 1,
    resourceOutput: 1,
    alliances: false,
    victory: "solo",
  });
}

export function validateLobbySettings(settings: LobbySettings): LobbySettings {
  if (!isLobbyMapId(settings.mapId) || settings.mode !== "free-for-all")
    throw new Error("Choose a supported map and match mode.");
  if (
    !Number.isInteger(settings.slots) ||
    settings.slots < 2 ||
    settings.slots > 20
  )
    throw new Error("Choose between 2 and 20 total faction slots.");
  if (
    !Number.isInteger(settings.minimumHumans) ||
    settings.minimumHumans < 1 ||
    settings.minimumHumans > settings.slots
  )
    throw new Error(
      "Minimum humans must be between 1 and the number of faction slots.",
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
  if (
    !RESOURCE_MULTIPLIERS.includes(settings.resourceDensity) ||
    !RESOURCE_MULTIPLIERS.includes(settings.resourceOutput)
  )
    throw new Error(
      "Resource density and deposit output must be 1×, 2×, 3× or 5×.",
    );
  if (
    typeof settings.fillVacanciesWithAi !== "boolean" ||
    typeof settings.alliances !== "boolean"
  )
    throw new Error("Choose the AI and alliance rules.");
  if (
    !["solo", "allied"].includes(settings.victory) ||
    (settings.victory === "allied" && !settings.alliances)
  )
    throw new Error("Allied conquest requires alliances to be allowed.");
  return Object.freeze({ ...settings });
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
