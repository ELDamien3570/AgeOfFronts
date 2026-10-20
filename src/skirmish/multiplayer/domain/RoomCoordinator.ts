import {
  createEmpireProfile,
  type EmpireProfile,
} from "../../lobby/EmpireProfile";
import {
  defaultLobbySettings,
  migrateLobbySettings,
  validateLobbySettings,
  type LobbySettings,
} from "../../lobby/LobbyDirectory";
import { isLobbyMapId, LOBBY_MAP_IDS, type LobbyMapId } from "../../lobby/LobbyRules";

export const RECONNECT_GRACE_MS = 60_000;
/** Battlefields offered for the next public lobby while a public match runs. */
export const MAP_VOTE_CHOICES = 3;
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
  deadline?: number;
  capacityWaiting: boolean;
  createdAt: number;
}
export interface MatchReservation {
  title?: string;
  id: string;
  roomId: string;
  /** Custom-room owner at reservation, so a failed start can restore the room. */
  ownerId?: string;
  /** A custom room's match runs in its owner's browser and uses no server capacity. */
  hostId?: string;
  settings: LobbySettings;
  members: RoomMember[];
  createdAt: number;
}
/** While public capacity is full, guests choose the next public battlefield. */
export interface MapVote {
  candidates: LobbyMapId[];
  /** One choice per guest identity; a guest may change it. */
  votes: Record<string, LobbyMapId>;
}
export interface CoordinatorState {
  version: 1;
  /** Custom rooms and the single public ("default") room. */
  rooms: OnlineRoom[];
  reservations: MatchReservation[];
  nextSequence: number;
  mapVote?: MapVote;
}
export interface RoomCoordinatorOptions {
  /** Shuffles the next-battlefield candidates (tests pass a fixed source). */
  random?: () => number;
  /** Custom matches run in their owner's browser (default). False puts them
   * on server workers under the shared match capacity. */
  hostCustomRooms?: boolean;
}
const PUBLIC_MATCH_IN_PROGRESS =
  "A public match is in progress. Vote for the next battlefield instead.";

/** Room lifecycle aggregate. Wall time and capacity are supplied by application ports. */
export class RoomCoordinator {
  private state: CoordinatorState;

  constructor(
    now: number,
    private readonly matchCapacity: number,
    restored?: CoordinatorState,
    private readonly options: RoomCoordinatorOptions = {},
  ) {
    if (!Number.isInteger(matchCapacity) || matchCapacity < 0)
      throw new Error("Match capacity must be a measured nonnegative integer.");
    this.state = restored
      ? structuredClone(restored)
      : { version: 1, rooms: [], reservations: [], nextSequence: 1 };
    if (this.state.version !== 1)
      throw new Error("Unsupported coordinator state.");
    // Rooms saved before AI and tribe counts existed gain their map size's base.
    for (const room of [...this.state.rooms, ...this.state.reservations])
      room.settings = migrateLobbySettings(room.settings);
    // Rooms saved before custom rooms became unlimited carried a display listing.
    for (const room of this.state.rooms) delete (room as { listing?: unknown }).listing;
    // One public room. Older saves listed one default room per battlefield:
    // keep the one people are in (or the first), drop the rest.
    const defaults = this.state.rooms.filter(
      (room) => room.kind === "default" && isLobbyMapId(room.settings.mapId),
    );
    const kept = defaults.find((room) => room.members.length) ?? defaults[0];
    this.state.rooms = this.state.rooms.filter(
      (room) => room.kind !== "default" || room === kept,
    );
    if (!kept) this.state.rooms.unshift(this.publicRoom(LOBBY_MAP_IDS[0], now));
    if (this.state.mapVote) {
      const candidates = this.state.mapVote.candidates.filter(isLobbyMapId);
      if (candidates.length) {
        const votes: Record<string, LobbyMapId> = {};
        for (const [guest, mapId] of Object.entries(this.state.mapVote.votes))
          if (candidates.includes(mapId)) votes[guest] = mapId;
        this.state.mapVote = { candidates, votes };
      } else delete this.state.mapVote;
    }
  }

  private publicRoom(mapId: LobbyMapId, now: number): OnlineRoom {
    return {
      id: `default-${mapId}`,
      title: `${mapId} lobby`,
      kind: "default",
      settings: defaultLobbySettings(mapId),
      members: [],
      createdAt: now,
      capacityWaiting: false,
    };
  }

  /** The single public lobby. */
  get publicLobby(): OnlineRoom {
    return this.state.rooms.find((room) => room.kind === "default")!;
  }

  /** Server-simulated matches hold capacity; hosted custom matches do not. */
  private get serverReservations(): number {
    return this.state.reservations.filter((match) => match.hostId === undefined).length;
  }

  /** A public match is running and no other can start: the lobby becomes a map vote. */
  private get publicCapacityFull(): boolean {
    return this.state.reservations.some((match) => match.roomId.startsWith("default-")) &&
      this.serverReservations >= this.matchCapacity;
  }

  /** Choose the next public battlefield. Only offered maps count. */
  voteMap(guestId: string, mapId: string): void {
    const vote = this.state.mapVote;
    if (!vote) throw new Error("Map voting opens while a public match is in progress.");
    if (!isLobbyMapId(mapId) || !vote.candidates.includes(mapId))
      throw new Error("Choose one of the offered battlefields.");
    vote.votes[guestId] = mapId;
  }

  /** Open the vote when public capacity fills; when it frees, the most voted
   * battlefield becomes the public lobby (ties go to the earlier offer). */
  private rotatePublicLobby(now: number): void {
    const current = this.publicLobby;
    if (this.publicCapacityFull) {
      if (this.state.mapVote) return;
      const pool = LOBBY_MAP_IDS.filter((mapId) => mapId !== current.settings.mapId);
      for (let index = pool.length - 1; index > 0; index--) {
        const swap = Math.floor((this.options.random ?? Math.random)() * (index + 1));
        [pool[index], pool[swap]] = [pool[swap], pool[index]];
      }
      this.state.mapVote = { candidates: pool.slice(0, MAP_VOTE_CHOICES), votes: {} };
      return;
    }
    const vote = this.state.mapVote;
    if (!vote) return;
    delete this.state.mapVote;
    // A failed start returned players to the current room: keep its map.
    if (current.members.length || !vote.candidates.length) return;
    const tally = new Map<LobbyMapId, number>();
    for (const mapId of Object.values(vote.votes)) tally.set(mapId, (tally.get(mapId) ?? 0) + 1);
    let winner = vote.candidates[0];
    for (const mapId of vote.candidates)
      if ((tally.get(mapId) ?? 0) > (tally.get(winner) ?? 0)) winner = mapId;
    this.state.rooms[this.state.rooms.indexOf(current)] = this.publicRoom(winner, now);
  }

  snapshot(): CoordinatorState {
    return structuredClone(this.state);
  }

  create(
    guestId: string,
    profile: EmpireProfile,
    title: string,
    settings: LobbySettings,
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
    settings = validateLobbySettings(settings);
    profile = createEmpireProfile(profile.name, profile.flagCode, profile.colorIndex);
    this.assertNotInMatch(guestId);
    this.leave(guestId, now);
    const room: OnlineRoom = {
      id: `room-${this.state.nextSequence++}`,
      title,
      kind: "custom",
      ownerId: guestId,
      settings,
      members: [{ guestId, profile, joinedAt: now, connected: true }],
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
    if (room.kind === "default" && this.state.mapVote)
      throw new Error(PUBLIC_MATCH_IN_PROGRESS);
    profile = createEmpireProfile(profile.name, profile.flagCode, profile.colorIndex);
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
  }

  close(id: string, guestId: string): void {
    const room = this.room(id);
    if (room.kind !== "custom" || room.ownerId !== guestId)
      throw new Error("Only the room owner can close this lobby.");
    this.state.rooms = this.state.rooms.filter(
      (candidate) => candidate.id !== id,
    );
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
    // Runtime alone owns the bounded empty-match grace and capacity release.
    for (const match of this.state.reservations) {
      const member = match.members.find(
        (candidate) => candidate.guestId === guestId,
      );
      if (member) {
        member.connected = false;
        member.disconnectedAt = now;
      }
    }
    this.removeEmptyCustoms();
    return [];
  }

  claimMatchSeat(
    id: string,
    guestId: string,
    profile: EmpireProfile,
    now: number,
  ): void {
    const match = this.state.reservations.find(
      (candidate) => candidate.id === id,
    );
    if (!match) throw new Error("This match is no longer available");
    if (
      this.state.reservations.some(
        (other) =>
          other.id !== id &&
          other.members.some(
            (member) => member.guestId === guestId && member.connected,
          ),
      )
    )
      throw new Error("Leave your other match before joining this one");
    this.leave(guestId, now);
    const member = match.members.find(
      (candidate) => candidate.guestId === guestId,
    );
    if (member) {
      member.connected = true;
      delete member.disconnectedAt;
    } else
      match.members.push({ guestId, profile, joinedAt: now, connected: true });
  }

  reconnect(guestId: string, roomId?: string): void {
    if(!roomId)return;
    for (const room of this.state.rooms) {
      if(room.id!==roomId)continue;
      const member = room.members.find(
        (candidate) => candidate.guestId === guestId,
      );
      if (!member) continue;
      member.connected = true;
      delete member.disconnectedAt;
      if (room.ownerId === guestId) delete room.ownerMissingSince;
    }
  }

  /** Faction colors are a cosmetic preference: several players may share one. */
  updateProfile(guestId: string, profile: EmpireProfile): void {
    profile = createEmpireProfile(profile.name, profile.flagCode, profile.colorIndex);
    for (const room of this.state.rooms)
      for (const member of room.members)
        if (member.guestId === guestId) member.profile = profile;
  }

  /** Only this aggregate reserves match capacity; starts cannot race between rooms. */
  advance(now: number): MatchReservation[] {
    const started: MatchReservation[] = [];
    this.rotatePublicLobby(now);
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
    for (const room of this.state.rooms) {
      this.updateCountdown(room, now);
      const connected = room.members.filter((member) => member.connected);
      const ready =
        (connected.length >= 1 &&
          connected.every((member) => member.votedToStart === true)) ||
        (connected.length >= room.settings.minimumHumans &&
          (connected.length === room.settings.slots ||
            (room.deadline !== undefined && now >= room.deadline)));
      if (!ready) continue;
      // A custom room's owner hosts its match, so it starts only with them present.
      const hosted = room.kind === "custom" && this.options.hostCustomRooms !== false;
      const host = hosted
        ? connected.find((member) => member.guestId === room.ownerId)
        : undefined;
      if (hosted && !host) continue;
      if (!hosted && this.serverReservations >= this.matchCapacity) {
        room.capacityWaiting = true;
        continue;
      }
      const match: MatchReservation = {
        id: `match-${this.state.nextSequence++}`,
        roomId: room.id,
        title: room.title,
        ...(room.ownerId === undefined ? {} : { ownerId: room.ownerId }),
        ...(host ? { hostId: host.guestId } : {}),
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
    this.rotatePublicLobby(now);
    return started;
  }

  /**
   * A reserved match never started (its worker could not prepare). Release the
   * capacity and put the reservation's current members back into the room it
   * came from, recreating a custom room that emptied at reservation. Votes are
   * cleared so a failed start does not immediately retry. Returns the guests
   * to notify; members who already joined another room stay there.
   */
  abandonReservation(id: string, now: number): string[] {
    const match = this.state.reservations.find((candidate) => candidate.id === id);
    if (!match) return [];
    this.releaseMatch(id);
    const placed = (guestId: string) =>
      this.state.rooms.some((room) => room.members.some((member) => member.guestId === guestId));
    const returning = match.members
      .filter((member) => !placed(member.guestId))
      .map((member) => {
        const restored = structuredClone(member);
        delete restored.votedToStart;
        return restored;
      });
    // Public players return to the public lobby even if its battlefield rotated.
    let room = this.state.rooms.find((candidate) => candidate.id === match.roomId) ??
      (match.hostId === undefined && match.roomId.startsWith("default-") ? this.publicLobby : undefined);
    if (!room && returning.some((member) => member.connected)) {
      room = {
        id: match.roomId,
        title: match.title ?? `${match.settings.mapId} lobby`,
        kind: "custom",
        settings: match.settings,
        members: [],
        createdAt: now,
        capacityWaiting: false,
      };
      this.state.rooms.push(room);
    }
    if (room) {
      for (const member of returning)
        if (room.members.length < room.settings.slots) room.members.push(member);
      if (room.kind === "custom" && room.ownerId === undefined) {
        const owner = room.members.find((member) => member.guestId === match.ownerId);
        if (owner && !this.ownsCustomRoom(owner.guestId)) {
          room.ownerId = owner.guestId;
          if (!owner.connected) room.ownerMissingSince = owner.disconnectedAt ?? now;
        } else this.transferOwner(room);
      }
      this.updateCountdown(room, now);
    }
    this.removeEmptyCustoms();
    // Capacity is free again: close a vote the failed start opened.
    this.rotatePublicLobby(now);
    return match.members.map((member) => member.guestId);
  }

  private ownsCustomRoom(guestId: string): boolean {
    return this.state.rooms.some((room) => room.kind === "custom" && room.ownerId === guestId);
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
  private removeEmptyCustoms(): void {
    this.state.rooms = this.state.rooms.filter(
      (room) => room.kind === "default" || room.members.some(member=>member.connected),
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
    if (connected < room.settings.minimumHumans) {
      delete room.deadline;
      room.capacityWaiting = false;
    } else room.deadline ??= now + room.settings.countdownSeconds * 1000;
  }
}
