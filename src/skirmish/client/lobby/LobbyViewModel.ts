import { FACTION_PALETTE } from "../../lobby/FactionPalette";
import {
  createEmpireProfile,
  DEFAULT_EMPIRE_PROFILE,
  type EmpireProfile,
} from "../../lobby/EmpireProfile";
import {
  defaultLobbySettings,
  LobbyDirectory,
  migrateLobbySettings,
  type CustomLobby,
  type LobbySettings,
} from "../../lobby/LobbyDirectory";
import { isLobbyMapId, LOBBY_MAP_IDS, type LobbyMapId } from "../../lobby/LobbyRules";
import type {
  CoordinatorState,
  MapVote,
  OnlineRoom,
} from "../../multiplayer/domain/RoomCoordinator";
import type { LiveMatchSummary } from "../../multiplayer/Protocol";
import { EMPIRE_FLAGS, empireFlag } from "./FlagCatalog";
import type { LobbyPreviewStore } from "./LobbyPreviewStore";
import { LOBBY_MAPS } from "./MapCatalog";

export type LobbyPreviewPhase = "waiting" | "countdown" | "complete";
export interface PreviewSeat {
  number: string;
  kind: "you" | "sample" | "open" | "ai";
  name: string;
  detail: string;
  colorIndex?: number | null;
}

/** Projects either the local preview or the server-owned room directory. */
export class LobbyViewModel {
  readonly maps = LOBBY_MAPS;
  private readonly previewDirectory = new LobbyDirectory();
  private readonly disconnectedDirectory = new LobbyDirectory();
  online = false;
  connected = false;
  guestId?: string;
  activeMatches: LiveMatchSummary[] = [];
  private onlineState?: CoordinatorState;
  private serverOffset = 0;
  get joinedOnlineRoom(): OnlineRoom | undefined {
    return this.onlineState?.rooms.find((room) =>
      room.members.some(
        (member) => member.guestId === this.guestId && member.connected,
      ),
    );
  }
  get directory() {
    if (!this.onlineState)
      return this.online ? this.disconnectedDirectory : this.previewDirectory;
    const visible = this.onlineState.rooms
      .filter((room) => room.kind === "custom")
      .map((room) => ({
        id: room.id,
        title: room.title,
        settings: room.settings,
        owner:
          room.members.find((member) => member.guestId === room.ownerId)
            ?.profile ?? DEFAULT_EMPIRE_PROFILE,
      }));
    return {
      visible,
      find: (id: string) => visible.find((room) => room.id === id),
      create: this.previewDirectory.create.bind(this.previewDirectory),
      remove: this.previewDirectory.remove.bind(this.previewDirectory),
    };
  }
  /** The single public lobby; a local preview has none. */
  get publicLobby(): OnlineRoom | undefined {
    return this.onlineState?.rooms.find((room) => room.kind === "default");
  }
  get publicMapId(): LobbyMapId {
    return this.publicLobby?.settings.mapId ?? LOBBY_MAP_IDS[0];
  }
  /** Open while a public match holds the server: the next public battlefield. */
  get mapVote(): MapVote | undefined {
    return this.onlineState?.mapVote;
  }
  get myMapVote(): LobbyMapId | undefined {
    return this.guestId === undefined ? undefined : this.mapVote?.votes[this.guestId];
  }
  mapVotes(mapId: LobbyMapId): number {
    return Object.values(this.mapVote?.votes ?? {}).filter((vote) => vote === mapId).length;
  }
  /** Running public matches, joinable as an unclaimed AI nation. */
  get publicMatches(): LiveMatchSummary[] {
    return this.activeMatches.filter((match) => !match.hosted);
  }
  /** Started custom matches this guest plays in (only they can see them). */
  get hostedMatches(): LiveMatchSummary[] {
    return this.activeMatches.filter((match) => match.hosted);
  }
  /** Time until the public lobby starts, once enough humans have joined. */
  get publicCountdown(): string | undefined {
    const deadline = this.publicLobby?.deadline;
    if (deadline === undefined) return undefined;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now() - this.serverOffset) / 1000));
    return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  }
  applyOnlineState(
    state: CoordinatorState,
    guestId: string,
    serverNow: number,
    activeMatches: LiveMatchSummary[] = [],
  ): void {
    this.activeMatches = activeMatches;
    this.onlineState = state;
    this.guestId = guestId;
    this.serverOffset = serverNow - Date.now();
  }
  get onlineRoom(): OnlineRoom | undefined {
    return this.onlineState?.rooms.find(
      (room) => room.id === (this.customRoomId ?? `default-${this.mapId}`),
    );
  }
  canCloseRoom(id: string): boolean {
    return (
      !this.online ||
      this.onlineState?.rooms.find((room) => room.id === id)?.ownerId ===
        this.guestId
    );
  }
  directoryHumanCount(roomId: string): number | undefined {
    if (!this.online) return 0;
    if (!this.onlineState) return undefined;
    return (
      this.onlineState.rooms
        .find((room) => room.id === roomId)
        ?.members.filter((member) => member.connected).length ?? 0
    );
  }
  get startVotes(): number {
    return (
      this.onlineRoom?.members.filter(
        (member) => member.connected && member.votedToStart,
      ).length ?? 0
    );
  }
  get hasVotedToStart(): boolean {
    return (
      this.onlineRoom?.members.some(
        (member) =>
          member.guestId === this.guestId &&
          member.connected &&
          member.votedToStart,
      ) ?? false
    );
  }
  get canVoteToStart(): boolean {
    return (
      this.connected &&
      !this.hasVotedToStart &&
      (this.onlineRoom?.members.some(
        (member) => member.guestId === this.guestId && member.connected,
      ) ??
        false)
    );
  }
  profile: EmpireProfile = DEFAULT_EMPIRE_PROFILE;
  draftEmpireName = this.profile.name;
  message = "";
  colorError = "";
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
  private shownPublicCountdown: string | undefined;

  constructor(private store?: LobbyPreviewStore) {
    this.restore(store?.read());
    this.draftEmpireName = this.profile.name;
  }

  /** True when the home page's public countdown text changed. */
  tickDirectory(): boolean {
    if (this.page !== "home") return false;
    const countdown = this.publicCountdown;
    if (countdown === this.shownPublicCountdown) return false;
    this.shownPublicCountdown = countdown;
    return true;
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
  /** The open lobby is a custom room: its owner's browser hosts the match. */
  get customRoom(): boolean {
    return this.customRoomId !== undefined;
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

  get colorChoices() {
    return FACTION_PALETTE.map((entry, index) => ({ ...entry, index,
      // Shown for information only: several players may share a color.
      inUse: this.onlineRoom?.members.some(member => member.guestId !== this.guestId && member.profile.colorIndex === index) ?? false,
    }));
  }
  get selectedColorIndex(): number | null {
    const member = this.onlineRoom?.members.find(member => member.guestId === this.guestId);
    return member ? member.profile.colorIndex ?? null : this.profile.colorIndex ?? null;
  }

  chooseColor(index: number | null): boolean {
    // Changing a cosmetic preference must not submit or erase a name draft.
    this.colorError = "";
    const draft = this.draftEmpireName;
    const saved = this.saveProfile(this.profile.name, this.profile.flagCode, index);
    this.draftEmpireName = draft;
    if (!saved) this.colorError = this.message;
    return saved;
  }

  saveProfile(
    name: string,
    flagCode: string | null = this.profile.flagCode,
    colorIndex: number | null | undefined = this.profile.colorIndex,
  ): boolean {
    try {
      if (flagCode !== null && !empireFlag(flagCode))
        throw new Error("Choose a flag from the local catalog.");
      this.profile = createEmpireProfile(name, flagCode, colorIndex);
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
  ): boolean {
    try {
      this.directory.create({ id, title, owner: this.profile, settings });
      this.dialog = null;
      this.persist("Your lobby is now listed under custom lobbies.");
      return true;
    } catch (error) {
      this.message = (error as Error).message;
      return false;
    }
  }

  removeRoom(id: string): void {
    if (this.directory.remove(id))
      this.persist("Lobby removed.");
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
      visible: this.previewDirectory.visible,
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
      return createEmpireProfile(profile.name, profile.flagCode, profile.colorIndex);
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
            settings: migrateLobbySettings({
              ...room.settings,
              // Earlier version-1 previews predate resource controls. Only an
              // absent value gets the original 1× rule; invalid values fail validation.
              // `??` would also turn null into 1; null must fail validation.
              resourceDensity:
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                room.settings.resourceDensity === undefined
                  ? 1
                  : room.settings.resourceDensity,
              resourceOutput:
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                room.settings.resourceOutput === undefined
                  ? 1
                  : room.settings.resourceOutput,
              startingAge:
                // Preserve invalid null values for validation, as above.
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                room.settings.startingAge === undefined
                  ? "StoneAge"
                  : room.settings.startingAge,
            }),
          },
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
    if (this.online)
      return this.onlineRoom?.deadline === undefined ? "waiting" : "countdown";
    return this.currentPhase;
  }

  get humanCount(): number {
    if (this.online)
      return (
        this.onlineRoom?.members.filter((member) => member.connected).length ??
        0
      );
    return this.humans;
  }

  get aiCount(): number {
    return this.rules.aiCount;
  }

  get countdown(): string {
    if (this.online) {
      const deadline = this.onlineRoom?.deadline;
      const remaining =
        deadline === undefined
          ? this.rules.countdownSeconds
          : Math.max(
              0,
              Math.ceil((deadline - Date.now() - this.serverOffset) / 1000),
            );
      return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    }
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
    if (this.online) {
      if (!this.connected) return "Reconnecting to the lobby server";
      if (this.onlineRoom?.capacityWaiting) return "Waiting for match capacity";
      if (this.phase === "countdown") return "Match countdown";
      if (this.hasVotedToStart && this.startVotes === this.humanCount)
        return "Starting match…";
      if (this.startVotes > 0)
        return `${this.startVotes}/${this.humanCount} voted · Waiting for ${this.rules.minimumHumans} humans`;
      return `Waiting for ${this.rules.minimumHumans} humans`;
    }
    if (this.phase === "complete") return "Roster preview ready";
    if (this.phase === "countdown") return "Preview countdown running";
    return this.rules.minimumHumans === 2
      ? "Waiting for a second player"
      : `Waiting for ${this.rules.minimumHumans} humans`;
  }

  get statusDetail(): string {
    if (this.online)
      return this.onlineRoom?.capacityWaiting
        ? "Another public match is running on the server. This lobby starts when it ends."
        : this.customRoom
          ? "When the match starts, the lobby owner's browser runs it for everyone, so the owner must keep the match tab open. Disconnected guests have 60 seconds to reconnect."
          : "The server owns the roster and timer. Disconnected guests have 60 seconds to reconnect.";
    if (this.phase === "complete")
      return `${this.humans} humans + ${this.aiCount} AI opponents + ${this.rules.tribeCount} tribes. No online match has started.`;
    if (this.phase === "countdown")
      return `This sample timer ends at ${this.rules.countdownSeconds} seconds, or when all ${this.rules.slots} human seats are filled.`;
    return `Add sample players to reach ${this.rules.minimumHumans} humans. These seats are only a preview.`;
  }

  get skirmishHref(): string {
    return `/skirmish/index.html?map=${this.mapId}${typeof this.profile.colorIndex === "number" ? `&color=${this.profile.colorIndex}` : ""}`;
  }

  get seats(): PreviewSeat[] {
    if (this.online)
      return Array.from({ length: this.rules.slots }, (_, index) => {
        const member = this.onlineRoom?.members[index];
        return {
          number: String(index + 1).padStart(2, "0"),
          kind: member
            ? member.guestId === this.guestId
              ? "you"
              : "sample"
            : "open",
          name: member?.profile.name ?? "Open seat",
          colorIndex: member?.profile.colorIndex,
          detail: member
            ? member.connected
              ? member.guestId === this.guestId
                ? "You"
                : "Connected"
              : "zzz · reconnecting"
            : "Open human seat",
        };
      });
    // A finished preview lists the AI opponents after the human seats.
    const aiSeats = this.phase === "complete" ? this.rules.aiCount : 0;
    return Array.from({ length: this.rules.slots + aiSeats }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      if (index >= this.rules.slots)
        return {
          number,
          kind: "ai",
          name: "AI opponent",
          detail: "Joins on start",
        };
      if (index === 0)
        return {
          number,
          kind: "you",
          name: this.profile.name,
          colorIndex: this.profile.colorIndex,
          detail: "You · preview seat",
        };
      if (index < this.humans)
        return {
          number,
          kind: "sample",
          name: `Sample player ${number}`,
          detail: "Simulated human",
        };
      return {
        number,
        kind: "open",
        name: "Open seat",
        detail: "Open human seat",
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
    if (this.online) return this.page === "lobby";
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
