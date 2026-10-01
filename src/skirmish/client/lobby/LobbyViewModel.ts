import {
  createEmpireProfile,
  DEFAULT_EMPIRE_PROFILE,
  type EmpireProfile,
} from "../../lobby/EmpireProfile";
import {
  defaultLobbySettings,
  LobbyDirectory,
  type CustomLobby,
  type LobbySettings,
} from "../../lobby/LobbyDirectory";
import { isLobbyMapId, type LobbyMapId } from "../../lobby/LobbyRules";
import { EMPIRE_FLAGS, empireFlag } from "./FlagCatalog";
import type { LobbyPreviewStore } from "./LobbyPreviewStore";
import { LOBBY_MAPS } from "./MapCatalog";

export type LobbyPreviewPhase = "waiting" | "countdown" | "complete";
export interface PreviewSeat {
  number: string;
  kind: "you" | "sample" | "open" | "ai";
  name: string;
  detail: string;
}

/** Local UI demonstration only; never represents an online room or session. */
export class LobbyViewModel {
  readonly maps = LOBBY_MAPS;
  readonly directory = new LobbyDirectory();
  profile: EmpireProfile = DEFAULT_EMPIRE_PROFILE;
  draftEmpireName = this.profile.name;
  message = "";
  dialog: "create" | "flags" | null = null;
  flagSearch = "";
  flagLimit = 48;
  private settings: LobbySettings = defaultLobbySettings("heightmap-test1");
  private customRoomId: string | undefined;
  private mapId: LobbyMapId = "heightmap-test1";
  private inLobby = false;
  private humans = 1;
  private deadline: number | undefined;
  private remaining: number = this.rules.countdownSeconds;
  private currentPhase: LobbyPreviewPhase = "waiting";
  private featuredOffset = 0;
  private rotationDeadline: number;
  private rotationRemaining = 60;

  constructor(
    private store?: LobbyPreviewStore,
    now = 0,
  ) {
    this.rotationDeadline = now + 60_000;
    this.restore(store?.read());
    this.draftEmpireName = this.profile.name;
  }

  get featuredMaps() {
    return Array.from(
      { length: Math.min(3, this.maps.length) },
      (_, index) => this.maps[(this.featuredOffset + index) % this.maps.length],
    );
  }

  get rotationSeconds(): number {
    return this.rotationRemaining;
  }

  /** Rotate presentation only; room identity, roster, rules and queue are unchanged. */
  tickDirectory(now: number): boolean {
    if (this.page !== "home") return false;
    let changed = false;
    if (now >= this.rotationDeadline) {
      const steps = Math.floor((now - this.rotationDeadline) / 60_000) + 1;
      this.featuredOffset =
        (this.featuredOffset + steps * 3) % this.maps.length;
      this.rotationDeadline += steps * 60_000;
      changed = true;
    }
    const remaining = Math.max(
      0,
      Math.ceil((this.rotationDeadline - now) / 1_000),
    );
    if (remaining !== this.rotationRemaining) changed = true;
    this.rotationRemaining = remaining;
    return changed;
  }

  get rules(): LobbySettings {
    return this.settings;
  }
  get roomTitle(): string {
    return (
      this.directory.find(this.customRoomId ?? "")?.title ??
      `${this.selectedMap.name} lobby`
    );
  }
  get selectedFlag() {
    return empireFlag(this.profile.flagCode);
  }
  get queuePosition(): number | undefined {
    const index = this.directory.queue.findIndex(
      (room) => room.id === this.customRoomId,
    );
    return index < 0 ? undefined : index + 1;
  }
  get flagMatches() {
    const search = this.flagSearch.trim().toLocaleLowerCase();
    return EMPIRE_FLAGS.filter((flag) =>
      flag.name.toLocaleLowerCase().includes(search),
    );
  }
  get visibleFlags() {
    return this.flagMatches.slice(0, this.flagLimit);
  }

  saveProfile(
    name: string,
    flagCode: string | null = this.profile.flagCode,
  ): boolean {
    try {
      if (flagCode !== null && !empireFlag(flagCode))
        throw new Error("Choose a flag from the local catalog.");
      this.profile = createEmpireProfile(name, flagCode);
      this.draftEmpireName = this.profile.name;
      this.persist("Empire customization saved in this browser.");
      return true;
    } catch (error) {
      this.message = (error as Error).message;
      return false;
    }
  }

  createRoom(
    id: string,
    title: string,
    settings: LobbySettings,
    willingToWait: boolean,
  ): boolean {
    try {
      const result = this.directory.create(
        { id, title, owner: this.profile, settings },
        willingToWait,
      );
      this.dialog = null;
      this.persist(
        result === "visible"
          ? "Your lobby is now in the custom lobby holder."
          : `Your lobby joined the waiting queue at position ${this.directory.queue.length}.`,
      );
      return true;
    } catch (error) {
      this.message = (error as Error).message;
      return false;
    }
  }

  removeRoom(id: string): void {
    if (this.directory.remove(id))
      this.persist(
        "Lobby removed. The first waiting lobby fills any released custom space.",
      );
  }

  showCustomRoom(id: string, now: number): boolean {
    const room = this.directory.find(id);
    if (!room) return false;
    this.settings = room.settings;
    this.mapId = room.settings.mapId;
    this.customRoomId = id;
    this.inLobby = true;
    this.resetPreview(now);
    return true;
  }

  private persist(success: string): void {
    const saved = this.store?.write({
      version: 1,
      profile: this.profile,
      visible: this.directory.visible,
      queue: this.directory.queue,
    });
    this.message =
      saved === false
        ? "Updated for this visit. Browser storage is unavailable; changes will be lost on reload."
        : success;
  }

  private restore(data: unknown): void {
    if (
      !data ||
      typeof data !== "object" ||
      (data as { version?: unknown }).version !== 1
    )
      return;
    const saved = data as {
      profile?: EmpireProfile;
      visible?: CustomLobby[];
      queue?: CustomLobby[];
    };
    const validProfile = (profile: EmpireProfile) => {
      if (profile.flagCode !== null && !empireFlag(profile.flagCode))
        throw new Error("Unknown saved flag");
      return createEmpireProfile(profile.name, profile.flagCode);
    };
    try {
      if (saved.profile) this.profile = validProfile(saved.profile);
    } catch {
      /* Ignore invalid saved identity. */
    }
    const rooms = [
      ...(Array.isArray(saved.visible) ? saved.visible : []),
      ...(Array.isArray(saved.queue) ? saved.queue : []),
    ];
    let retiredRooms = 0;
    for (const room of rooms) {
      try {
        if (room?.settings && !isLobbyMapId(room.settings.mapId)) {
          retiredRooms++;
          continue;
        }
        this.directory.create(
          {
            ...room,
            owner: validProfile(room.owner),
            settings: {
              ...room.settings,
              // Earlier version-1 previews predate resource controls. Only an
              // absent value gets the original 1× rule; invalid values fail validation.
              resourceDensity:
                room.settings.resourceDensity === undefined
                  ? 1
                  : room.settings.resourceDensity,
              resourceOutput:
                room.settings.resourceOutput === undefined
                  ? 1
                  : room.settings.resourceOutput,
            },
          },
          true,
        );
      } catch {
        /* Ignore invalid/duplicate persisted rooms without breaking the page. */
      }
    }
    if (retiredRooms)
      this.message = `${retiredRooms} saved room${retiredRooms === 1 ? " uses a retired map and was" : "s use retired maps and were"} omitted. Your empire and supported rooms remain saved.`;
  }

  get page(): "home" | "lobby" {
    return this.inLobby ? "lobby" : "home";
  }

  get selectedMap() {
    return this.maps.find((map) => map.id === this.mapId)!;
  }

  get phase(): LobbyPreviewPhase {
    return this.currentPhase;
  }

  get humanCount(): number {
    return this.humans;
  }

  get aiCount(): number {
    return this.rules.fillVacanciesWithAi ? this.rules.slots - this.humans : 0;
  }

  get countdown(): string {
    return `${Math.floor(this.remaining / 60)}:${String(this.remaining % 60).padStart(2, "0")}`;
  }

  get canAddSample(): boolean {
    return (
      this.inLobby &&
      this.phase !== "complete" &&
      this.humans < this.rules.slots
    );
  }

  get canRemoveSample(): boolean {
    return this.inLobby && this.phase !== "complete" && this.humans > 1;
  }

  get status(): string {
    if (this.phase === "complete") return "Roster preview ready";
    if (this.phase === "countdown") return "Preview countdown running";
    return this.rules.minimumHumans === 2
      ? "Waiting for a second player"
      : `Waiting for ${this.rules.minimumHumans} humans`;
  }

  get statusDetail(): string {
    if (this.phase === "complete")
      return `${this.humans} human seats + ${this.aiCount} AI seats. No online match has started.`;
    if (this.phase === "countdown")
      return `This sample timer ends at ${this.rules.countdownSeconds} seconds, or when all ${this.rules.slots} human seats are filled.`;
    return `Add sample players to reach ${this.rules.minimumHumans} humans. These seats are only a preview.`;
  }

  get skirmishHref(): string {
    return `/skirmish/index.html?map=${this.mapId}`;
  }

  get seats(): PreviewSeat[] {
    return Array.from({ length: this.rules.slots }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      if (index === 0)
        return {
          number,
          kind: "you",
          name: this.profile.name,
          detail: "You · preview seat",
        };
      if (index < this.humans)
        return {
          number,
          kind: "sample",
          name: `Sample player ${number}`,
          detail: "Simulated human",
        };
      if (this.phase === "complete" && this.rules.fillVacanciesWithAi)
        return {
          number,
          kind: "ai",
          name: "AI opponent",
          detail: "Vacancy filled",
        };
      return {
        number,
        kind: "open",
        name: "Open seat",
        detail: this.rules.fillVacanciesWithAi
          ? "AI fills on start"
          : "Stays vacant",
      };
    });
  }

  showHome(): void {
    this.inLobby = false;
    this.customRoomId = undefined;
    this.settings = defaultLobbySettings("heightmap-test1");
    this.resetPreview();
  }

  showLobby(mapId: unknown): boolean {
    if (!isLobbyMapId(mapId)) return false;
    this.mapId = mapId;
    this.settings = defaultLobbySettings(mapId);
    this.customRoomId = undefined;
    this.inLobby = true;
    this.resetPreview();
    return true;
  }

  resetPreview(now = 0): void {
    this.humans = 1;
    this.deadline = undefined;
    this.remaining = this.rules.countdownSeconds;
    this.currentPhase = "waiting";
    if (this.inLobby && this.rules.minimumHumans === 1) {
      this.deadline = now + this.rules.countdownSeconds * 1_000;
      this.currentPhase = "countdown";
    }
  }

  addSample(now: number): boolean {
    if (!this.canAddSample) return false;
    this.humans++;
    if (this.humans === this.rules.slots) this.complete();
    else if (this.humans === this.rules.minimumHumans) {
      this.deadline = now + this.rules.countdownSeconds * 1_000;
      this.currentPhase = "countdown";
    }
    return true;
  }

  removeSample(): boolean {
    if (!this.canRemoveSample) return false;
    this.humans--;
    if (this.humans < this.rules.minimumHumans) {
      this.deadline = undefined;
      this.remaining = this.rules.countdownSeconds;
      this.currentPhase = "waiting";
    }
    return true;
  }

  /** Project elapsed wall time for the demo; this does not advance a game. */
  tick(now: number): boolean {
    if (this.deadline === undefined || this.phase !== "countdown") return false;
    const remaining = Math.min(
      this.rules.countdownSeconds,
      Math.max(0, Math.ceil((this.deadline - now) / 1_000)),
    );
    if (remaining === this.remaining) return false;
    this.remaining = remaining;
    if (remaining === 0) this.complete();
    return true;
  }

  private complete(): void {
    this.currentPhase = "complete";
    this.remaining = 0;
    this.deadline = undefined;
  }
}
