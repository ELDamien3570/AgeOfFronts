import {
  createEmpireProfile,
  type EmpireProfile,
} from "../../lobby/EmpireProfile";
import {
  defaultLobbySettings,
  validateLobbySettings,
  type LobbySettings,
} from "../../lobby/LobbyDirectory";
import { LOBBY_MAP_IDS } from "../../lobby/LobbyRules";

export const RECONNECT_GRACE_MS = 60_000;
export interface RoomMember {
  guestId: string;
  profile: EmpireProfile;
  joinedAt: number;
  connected: boolean;
  disconnectedAt?: number;
  votedToStart?: boolean;
}
export interface OnlineRoom {
  id: string;
  title: string;
  kind: "default" | "custom";
  ownerId?: string;
  ownerMissingSince?: number;
  settings: LobbySettings;
  members: RoomMember[];
  listing: "visible" | "queued";
  deadline?: number;
  capacityWaiting: boolean;
  createdAt: number;
}
export interface MatchReservation {
  id: string;
  roomId: string;
  settings: LobbySettings;
  members: RoomMember[];
  createdAt: number;
}
export interface CoordinatorState {
  version: 1;
  rooms: OnlineRoom[];
  reservations: MatchReservation[];
  nextSequence: number;
}

/** Room lifecycle aggregate. Wall time and capacity are supplied by application ports. */
export class RoomCoordinator {
  private state: CoordinatorState;

  constructor(
    now: number,
    private readonly matchCapacity: number,
    restored?: CoordinatorState,
  ) {
    if (!Number.isInteger(matchCapacity) || matchCapacity < 0)
      throw new Error("Match capacity must be a measured nonnegative integer.");
    this.state = restored
      ? structuredClone(restored)
      : { version: 1, rooms: [], reservations: [], nextSequence: 1 };
    if (this.state.version !== 1)
      throw new Error("Unsupported coordinator state.");
    for (const mapId of LOBBY_MAP_IDS) {
      if (!this.state.rooms.some((room) => room.id === `default-${mapId}`)) {
        this.state.rooms.push({
          id: `default-${mapId}`,
          title: `${mapId} lobby`,
          kind: "default",
          settings: defaultLobbySettings(mapId),
          members: [],
          listing: "visible",
          createdAt: now,
          capacityWaiting: false,
        });
      }
    }
  }

  snapshot(): CoordinatorState {
    return structuredClone(this.state);
  }

  create(
    guestId: string,
    profile: EmpireProfile,
    title: string,
    settings: LobbySettings,
    willingToWait: boolean,
    now: number,
  ): OnlineRoom {
    if (
      this.state.rooms.some(
        (room) => room.kind === "custom" && room.ownerId === guestId,
      )
    )
      throw new Error("You already own a custom lobby.");
    title = title.trim().normalize("NFC");
    if (
      !title ||
      Array.from(title).length > 40 ||
      // eslint-disable-next-line no-control-regex -- rejects control characters on purpose
      /[\u0000-\u001f\u007f]/u.test(title)
    )
      throw new Error("Use a lobby name of 1–40 characters.");
    const listing = this.customListed() < 3 ? "visible" : "queued";
    if (listing === "queued" && !willingToWait)
      throw new Error(
        "All custom spaces are occupied. Opt into the queue to wait.",
      );
    settings = validateLobbySettings(settings);
    profile = createEmpireProfile(profile.name, profile.flagCode);
    this.assertNotInMatch(guestId);
    this.leave(guestId, now);
    const room: OnlineRoom = {
      id: `room-${this.state.nextSequence++}`,
      title,
      kind: "custom",
      ownerId: guestId,
      settings,
      members: [{ guestId, profile, joinedAt: now, connected: true }],
      listing,
      createdAt: now,
      capacityWaiting: false,
    };
    this.state.rooms.push(room);
    this.updateCountdown(room, now);
    return structuredClone(room);
  }

  join(id: string, guestId: string, profile: EmpireProfile, now: number): void {
    this.assertNotInMatch(guestId);
    const room = this.room(id);
    profile = createEmpireProfile(profile.name, profile.flagCode);
    const existing = room.members.find((member) => member.guestId === guestId);
    if (existing) {
      existing.connected = true;
      delete existing.disconnectedAt;
      existing.profile = profile;
      if (room.ownerId === guestId) delete room.ownerMissingSince;
      this.updateCountdown(room, now);
      return;
    }
    if (room.members.length >= room.settings.slots)
      throw new Error("This lobby is full.");
    this.leave(guestId, now);
    room.members.push({ guestId, profile, joinedAt: now, connected: true });
    this.updateCountdown(room, now);
  }

  leave(guestId: string, now: number): void {
    for (const room of this.state.rooms) {
      room.members = room.members.filter(
        (member) => member.guestId !== guestId,
      );
      if (room.ownerId === guestId) {
        delete room.ownerId;
        delete room.ownerMissingSince;
        this.transferOwner(room);
      }
      this.updateCountdown(room, now);
    }
    this.removeEmptyCustoms();
    this.promote();
  }

  close(id: string, guestId: string): void {
    const room = this.room(id);
    if (room.kind !== "custom" || room.ownerId !== guestId)
      throw new Error("Only the room owner can close this lobby.");
    this.state.rooms = this.state.rooms.filter(
      (candidate) => candidate.id !== id,
    );
    this.promote();
  }

  voteToStart(id: string, guestId: string): void {
    const member = this.room(id).members.find(
      (candidate) => candidate.guestId === guestId && candidate.connected,
    );
    if (!member) throw new Error("Join this lobby before voting to start.");
    member.votedToStart = true;
  }

  disconnect(guestId: string, now: number): string[] {
    for (const room of this.state.rooms) {
      const member = room.members.find(
        (candidate) => candidate.guestId === guestId,
      );
      if (!member || !member.connected) continue;
      member.connected = false;
      delete member.votedToStart;
      member.disconnectedAt = now;
      if (room.ownerId === guestId) room.ownerMissingSince = now;
      this.updateCountdown(room, now);
    }
    // Match seats do not reconnect in this release. Preserve a departed faction
    // for AI takeover while anyone remains, but release an abandoned match.
    const abandoned: string[] = [];
    for (const match of this.state.reservations) {
      const member = match.members.find(
        (candidate) => candidate.guestId === guestId,
      );
      if (member) {
        member.connected = false;
        member.disconnectedAt = now;
      }
      if (!match.members.some((candidate) => candidate.connected))
        abandoned.push(match.id);
    }
    for (const id of abandoned) this.releaseMatch(id);
    return abandoned;
  }

  reconnect(guestId: string): void {
    for (const room of this.state.rooms) {
      const member = room.members.find(
        (candidate) => candidate.guestId === guestId,
      );
      if (!member) continue;
      member.connected = true;
      delete member.disconnectedAt;
      if (room.ownerId === guestId) delete room.ownerMissingSince;
    }
  }

  updateProfile(guestId: string, profile: EmpireProfile): void {
    profile = createEmpireProfile(profile.name, profile.flagCode);
    for (const room of this.state.rooms)
      for (const member of room.members)
        if (member.guestId === guestId) member.profile = profile;
  }

  /** Only this aggregate reserves match capacity; starts cannot race between rooms. */
  advance(now: number): MatchReservation[] {
    const started: MatchReservation[] = [];
    for (const room of this.state.rooms) {
      room.members = room.members.filter(
        (member) =>
          member.connected ||
          now - (member.disconnectedAt ?? now) < RECONNECT_GRACE_MS,
      );
      if (
        room.ownerMissingSince !== undefined &&
        now - room.ownerMissingSince >= RECONNECT_GRACE_MS
      ) {
        delete room.ownerId;
        delete room.ownerMissingSince;
        this.transferOwner(room);
      }
      if (room.kind === "custom" && room.ownerId === undefined)
        this.transferOwner(room);
    }
    this.removeEmptyCustoms();
    this.promote();
    for (const room of this.state.rooms) {
      this.updateCountdown(room, now);
      const connected = room.members.filter((member) => member.connected);
      const ready =
        (connected.length >= 1 &&
          connected.every((member) => member.votedToStart === true)) ||
        (connected.length >= room.settings.minimumHumans &&
          (connected.length === room.settings.slots ||
            (room.deadline !== undefined && now >= room.deadline)));
      if (room.listing === "queued" || !ready) continue;
      if (this.state.reservations.length >= this.matchCapacity) {
        room.capacityWaiting = true;
        continue;
      }
      const match: MatchReservation = {
        id: `match-${this.state.nextSequence++}`,
        roomId: room.id,
        settings: room.settings,
        members: structuredClone(connected),
        createdAt: now,
      };
      this.state.reservations.push(match);
      started.push(structuredClone(match));
      room.members = [];
      delete room.deadline;
      room.capacityWaiting = false;
    }
    this.removeEmptyCustoms();
    this.promote();
    return started;
  }

  releaseMatch(id: string): void {
    this.state.reservations = this.state.reservations.filter(
      (match) => match.id !== id,
    );
  }

  private room(id: string): OnlineRoom {
    const room = this.state.rooms.find((candidate) => candidate.id === id);
    if (!room) throw new Error("This lobby no longer exists.");
    return room;
  }
  private customListed(): number {
    return this.state.rooms.filter(
      (room) => room.kind === "custom" && room.listing === "visible",
    ).length;
  }
  private promote(): void {
    for (const room of this.state.rooms)
      if (
        room.kind === "custom" &&
        room.listing === "queued" &&
        this.customListed() < 3
      )
        room.listing = "visible";
  }
  private removeEmptyCustoms(): void {
    this.state.rooms = this.state.rooms.filter(
      (room) => room.kind === "default" || room.members.length > 0,
    );
  }
  private transferOwner(room: OnlineRoom): void {
    if (room.kind !== "custom") return;
    const next = room.members
      .filter((member) => member.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.ownerId = next?.guestId;
  }
  private assertNotInMatch(id: string): void {
    if (
      this.state.reservations.some((match) =>
        match.members.some(
          (member) => member.guestId === id && member.connected,
        ),
      )
    )
      throw new Error("Leave your active match before joining another lobby.");
  }
  private updateCountdown(room: OnlineRoom, now: number): void {
    const connected = room.members.filter((member) => member.connected).length;
    if (connected < room.settings.minimumHumans || room.listing === "queued") {
      delete room.deadline;
      room.capacityWaiting = false;
    } else room.deadline ??= now + room.settings.countdownSeconds * 1000;
  }
}
