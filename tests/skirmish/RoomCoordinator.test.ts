import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { LOBBY_MAP_IDS } from "../../src/skirmish/lobby/LobbyRules";
import { MAP_VOTE_CHOICES, RoomCoordinator } from "../../src/skirmish/multiplayer/domain/RoomCoordinator";

const profile = (name: string) => ({ name, flagCode: null });
/** The single public lobby starts on the first playable battlefield. */
const PUBLIC = `default-${LOBBY_MAP_IDS[0]}`;
const rules = { ...defaultLobbySettings("africa"), countdownSeconds: 15 };

describe("online room lifecycle", () => {
  it("starts before the deadline only after all connected humans vote", () => {
    const rooms = new RoomCoordinator(0, 1);
    const id = PUBLIC;
    rooms.join(id, "a", profile("A"), 0);
    rooms.join(id, "b", profile("B"), 0);
    rooms.voteToStart(id, "a");
    expect(rooms.advance(1)).toHaveLength(0); // A second connected human has not voted.
    expect(() => rooms.voteToStart(id, "outsider")).toThrow(/Join/);
    rooms.voteToStart(id, "b");
    rooms.voteToStart(id, "b"); // Repeated votes do not create additional votes.
    expect(rooms.advance(2)).toHaveLength(1);
  });
  it("restores a room persisted at the retired 2000 size as a 1000 room (G-a)", () => {
    const saved = new RoomCoordinator(0, 1).snapshot();
    const room = saved.rooms.find(r => r.id === PUBLIC)!;
    room.settings = { ...room.settings, worldSize: 2000 as never };
    const restored = new RoomCoordinator(1, 1, saved);
    expect(restored.snapshot().rooms.find(r => r.id === PUBLIC)!.settings.worldSize).toBe(1000);
    expect(restored.snapshot().rooms.every(r => r.settings.worldSize !== (2000 as never))).toBe(true);
  });
  it("allows a lobby to start with 1 human if that human votes to start", () => {
    const rooms = new RoomCoordinator(0, 1);
    const id = PUBLIC;
    rooms.join(id, "solo", profile("Solo Player"), 0);
    expect(rooms.advance(1)).toHaveLength(0); // Does not start automatically without vote
    rooms.voteToStart(id, "solo");
    const started = rooms.advance(2);
    expect(started).toHaveLength(1);
    expect(started[0].members).toHaveLength(1);
    expect(started[0].members[0].guestId).toBe("solo");
  });
  it("clears departed votes and requires a returning player to vote again", () => {
    const rooms = new RoomCoordinator(0, 1);
    const id = PUBLIC;
    rooms.join(id, "a", profile("A"), 0);
    rooms.join(id, "b", profile("B"), 0);
    rooms.voteToStart(id, "a");
    rooms.voteToStart(id, "b");
    rooms.disconnect("b", 1);
    rooms.reconnect("b",id);
    expect(rooms.advance(2)).toHaveLength(0);
    rooms.voteToStart(id, "b");
    expect(rooms.advance(3)).toHaveLength(1);
  });
  it("unanimous votes still wait for reserved match capacity", () => {
    const rooms = new RoomCoordinator(0, 0);
    const id = PUBLIC;
    rooms.join(id, "a", profile("A"), 0);
    rooms.join(id, "b", profile("B"), 0);
    rooms.voteToStart(id, "a");
    rooms.voteToStart(id, "b");
    expect(rooms.advance(1)).toHaveLength(0);
    expect(rooms.snapshot().rooms.find((room) => room.id === id)!.capacityWaiting).toBe(true);
  });
  it("never starts empty default lobbies, even when capacity is available", () => {
    const rooms = new RoomCoordinator(0, 100);
    expect(rooms.advance(24 * 60 * 60 * 1000)).toHaveLength(0);
    expect(rooms.snapshot().reservations).toHaveLength(0);
    expect(
      rooms.snapshot().rooms.every((room) => room.deadline === undefined),
    ).toBe(true);
  });
  it("does not let AI filling start a room without a connected human", () => {
    const rooms = new RoomCoordinator(0, 1);
    const room = rooms.create(
      "a",
      profile("A"),
      "Solo",
      {
        ...rules,
        minimumHumans: 1,
      },
      0,
    );
    rooms.disconnect("a", 1000);
    expect(rooms.advance(15_000)).toHaveLength(0);
    expect(rooms.snapshot().reservations).toHaveLength(0);
    expect(
      rooms.snapshot().rooms.find((r) => r.id === room.id)?.deadline,
    ).toBeUndefined();
    rooms.advance(61_000);
    expect(rooms.snapshot().rooms.some((r) => r.id === room.id)).toBe(false);
  });
  it("reserves seats by guest identity and reconnects without creating duplicates", () => {
    const rooms = new RoomCoordinator(0, 0);
    rooms.join(PUBLIC, "a", profile("A"), 0);
    rooms.disconnect("a", 1000);
    rooms.join(PUBLIC, "a", profile("Renamed"), 2000);
    expect(
      rooms.snapshot().rooms.find((r) => r.id === PUBLIC)!.members,
    ).toEqual([
      {
        guestId: "a",
        profile: profile("Renamed"),
        joinedAt: 0,
        connected: true,
      },
    ]);
  });
  it("transfers ownership after grace to the longest-present connected guest", () => {
    const rooms = new RoomCoordinator(0, 0);
    // A long timer: hosted rooms need no capacity, so the room must not start here.
    const room = rooms.create("a", profile("A"), "Room", { ...rules, countdownSeconds: 300 }, 0);
    rooms.join(room.id, "b", profile("B"), 10);
    rooms.join(room.id, "c", profile("C"), 20);
    rooms.disconnect("a", 100);
    rooms.advance(60_099);
    expect(rooms.snapshot().rooms.find((r) => r.id === room.id)!.ownerId).toBe(
      "a",
    );
    rooms.advance(60_100);
    expect(rooms.snapshot().rooms.find((r) => r.id === room.id)!.ownerId).toBe(
      "b",
    );
    expect(() => rooms.close(room.id, "a")).toThrow("owner");
  });
  it("lists any number of custom rooms and expires empty ones", () => {
    const rooms = new RoomCoordinator(0, 0);
    const created = ["a", "b", "c", "d", "e"].map((guest) =>
      rooms.create(guest, profile(guest.toUpperCase()), guest, rules, 0));
    expect(() =>
      rooms.create("d", profile("D"), "Again", rules, 0),
    ).toThrow("already own");
    expect(rooms.snapshot().rooms.filter((r) => r.kind === "custom")).toHaveLength(5);
    rooms.disconnect("a", 1);
    expect(rooms.snapshot().rooms.some(r=>r.id===created[0].id)).toBe(false);
    rooms.advance(60_001);
    expect(rooms.snapshot().rooms.filter((r) => r.kind === "custom").map((r) => r.id))
      .toEqual(created.slice(1).map((room) => room.id));
  });
  it("resets the countdown below minimum humans and starts at the deadline", () => {
    const rooms = new RoomCoordinator(0, 1);
    const a = rooms.create("a", profile("A"), "A", rules, 0);
    rooms.join(a.id, "b", profile("B"), 0);
    rooms.disconnect("b", 10_000);
    expect(rooms.advance(15_000)).toHaveLength(0);
    rooms.join(a.id, "b", profile("B"), 20_000);
    expect(rooms.advance(34_999)).toHaveLength(0);
    const first = rooms.advance(35_000);
    expect(first).toHaveLength(1);
    expect(first[0].hostId).toBe("a");
  });
  it("waits for measured capacity only for the public lobby", () => {
    const rooms = new RoomCoordinator(0, 1);
    rooms.join(PUBLIC, "a", profile("A"), 0);
    rooms.join(PUBLIC, "b", profile("B"), 0);
    const [publicMatch] = rooms.advance(60_000);
    expect(publicMatch.hostId).toBeUndefined();
    // A hosted custom match starts even though the server is full.
    const custom = rooms.create("c", profile("C"), "C", rules, 60_000);
    rooms.join(custom.id, "d", profile("D"), 60_000);
    const [hosted] = rooms.advance(75_000);
    expect(hosted).toMatchObject({ roomId: custom.id, hostId: "c" });
    rooms.releaseMatch(publicMatch.id);
    rooms.advance(75_001);
    const next = rooms.snapshot().rooms.find((r) => r.kind === "default")!;
    rooms.join(next.id, "e", profile("E"), 75_002);
    rooms.join(next.id, "f", profile("F"), 75_002);
    expect(rooms.advance(135_002)).toHaveLength(1);
    expect(rooms.advance(135_003)).toHaveLength(0);
  });
  it("cannot impersonate an owner through a display name or close a default room", () => {
    const rooms = new RoomCoordinator(0, 0);
    const room = rooms.create("a", profile("Same"), "A", rules, 0);
    rooms.join(room.id, "b", profile("Same"), 1);
    expect(() => rooms.close(room.id, "b")).toThrow("owner");
    expect(() => rooms.close(PUBLIC, "a")).toThrow("owner");
  });
  it("retains abandoned capacity until the runtime releases it", () => {
    const rooms = new RoomCoordinator(0, 1);
    const room = rooms.create("a", profile("A"), "A", rules, 0);
    rooms.join(room.id, "b", profile("B"), 0);
    const [match] = rooms.advance(15_000);
    expect(rooms.disconnect("a", 16_000)).toEqual([]);
    expect(rooms.snapshot().reservations).toHaveLength(1);
    expect(rooms.disconnect("b", 17_000)).toEqual([]);
    expect(rooms.disconnect("b", 17_001)).toEqual([]);
    expect(rooms.snapshot().reservations).toHaveLength(1);
    rooms.releaseMatch(match.id);
    rooms.releaseMatch(match.id);
    expect(rooms.snapshot().reservations).toHaveLength(0);
    rooms.join(PUBLIC, "a", profile("A"), 18_000);
    rooms.join(PUBLIC, "b", profile("B"), 18_000);
    expect(rooms.advance(78_000)).toHaveLength(1);
  });
});

describe("explicit lobby presence",()=>{
  it("does not revive old rooms on an unscoped home-page authentication",()=>{
    const rooms=new RoomCoordinator(0,0);rooms.join(PUBLIC,"a",profile("A"),0);rooms.disconnect("a",1);
    rooms.reconnect("a");rooms.reconnect("a","default-europe");
    expect(rooms.snapshot().rooms.find(r=>r.id===PUBLIC)!.members[0].connected).toBe(false);
    rooms.reconnect("a",PUBLIC);
    expect(rooms.snapshot().rooms.find(r=>r.id===PUBLIC)!.members[0].connected).toBe(true);
  });
});

describe("abandoned match reservations", () => {
  const reserve = (rooms: RoomCoordinator, roomId: string, now = 1) => {
    rooms.voteToStart(roomId, "a");
    rooms.voteToStart(roomId, "b");
    const [match] = rooms.advance(now);
    expect(match).toBeDefined();
    return match;
  };
  it("returns members to their default room without their votes and releases capacity", () => {
    const rooms = new RoomCoordinator(0, 1);
    rooms.join(PUBLIC, "a", profile("A"), 0);
    rooms.join(PUBLIC, "b", profile("B"), 0);
    const match = reserve(rooms, PUBLIC);
    expect(rooms.abandonReservation(match.id, 2).sort()).toEqual(["a", "b"]);
    const state = rooms.snapshot();
    expect(state.reservations).toHaveLength(0);
    const room = state.rooms.find((candidate) => candidate.id === PUBLIC)!;
    expect(room.members.map((member) => member.guestId)).toEqual(["a", "b"]);
    expect(room.members.some((member) => member.votedToStart)).toBe(false);
    expect(rooms.advance(3)).toHaveLength(0); // A failed start never retries on stale votes.
    // The returned players kept the battlefield instead of a vote result.
    expect(rooms.snapshot().mapVote).toBeUndefined();
    rooms.voteToStart(PUBLIC, "a");
    rooms.voteToStart(PUBLIC, "b");
    expect(rooms.advance(4)).toHaveLength(1); // Capacity was released.
  });
  it("recreates a deleted custom room with its id, title, settings and owner", () => {
    const rooms = new RoomCoordinator(0, 1);
    const created = rooms.create("a", profile("A"), "Friends", rules, 0);
    rooms.join(created.id, "b", profile("B"), 0);
    const match = reserve(rooms, created.id);
    expect(rooms.snapshot().rooms.some((room) => room.id === created.id)).toBe(false);
    expect(match.ownerId).toBe("a");
    rooms.abandonReservation(match.id, 2);
    const room = rooms.snapshot().rooms.find((candidate) => candidate.id === created.id)!;
    expect(room).toMatchObject({ title: "Friends", kind: "custom", ownerId: "a", settings: created.settings });
    expect(room.members.map((member) => member.guestId)).toEqual(["a", "b"]);
    expect(() => rooms.create("a", profile("A"), "Again", rules, 3)).toThrow(/already own/);
  });
  it("uses live reservation member state, not the start-time copy", () => {
    const rooms = new RoomCoordinator(0, 1);
    const created = rooms.create("a", profile("A"), "Friends", rules, 0);
    rooms.join(created.id, "b", profile("B"), 0);
    const match = reserve(rooms, created.id);
    rooms.disconnect("a", 2);
    rooms.claimMatchSeat(match.id, "c", profile("C"), 2);
    expect(rooms.abandonReservation(match.id, 3).sort()).toEqual(["a", "b", "c"]);
    const room = rooms.snapshot().rooms.find((candidate) => candidate.id === created.id)!;
    expect(room.members.find((member) => member.guestId === "a")).toMatchObject({ connected: false, disconnectedAt: 2 });
    expect(room.members.map((member) => member.guestId)).toEqual(["a", "b", "c"]);
    // The disconnected owner keeps ownership through its normal grace.
    expect(room.ownerId).toBe("a");
    expect(room.ownerMissingSince).toBe(2);
    expect(rooms.abandonReservation(match.id, 4)).toEqual([]);
  });
});

describe("public lobby and next-battlefield vote", () => {
  /** A deterministic shuffle: always swap with the first candidate. */
  const fixed = () => 0;
  const startPublic = (rooms: RoomCoordinator, now: number) => {
    const lobby = rooms.snapshot().rooms.find((room) => room.kind === "default")!;
    rooms.join(lobby.id, "a", profile("A"), now);
    rooms.join(lobby.id, "b", profile("B"), now);
    rooms.voteToStart(lobby.id, "a");
    rooms.voteToStart(lobby.id, "b");
    const [match] = rooms.advance(now + 1);
    expect(match).toBeDefined();
    return match;
  };
  it("keeps one public lobby and drops the retired per-map default rooms on restore", () => {
    const rooms = new RoomCoordinator(0, 1);
    expect(rooms.snapshot().rooms.filter((room) => room.kind === "default").map((room) => room.id)).toEqual([PUBLIC]);
    const saved = rooms.snapshot();
    saved.rooms.push({ ...saved.rooms[0], id: "default-africa", settings: defaultLobbySettings("africa"),
      members: [{ guestId: "x", profile: profile("X"), joinedAt: 0, connected: true }] });
    (saved.rooms[0] as unknown as { listing: string }).listing = "visible";
    const restored = new RoomCoordinator(1, 1, saved).snapshot();
    // The room people were in survives; every retired listing field is gone.
    expect(restored.rooms.filter((room) => room.kind === "default").map((room) => room.id)).toEqual(["default-africa"]);
    expect(restored.rooms.some((room) => "listing" in room)).toBe(false);
  });
  it("turns the lobby into a three-map vote while a public match runs, then opens the winner", () => {
    const rooms = new RoomCoordinator(0, 1, undefined, { random: fixed });
    const match = startPublic(rooms, 0);
    const vote = rooms.snapshot().mapVote!;
    expect(vote.candidates).toHaveLength(MAP_VOTE_CHOICES);
    expect(new Set(vote.candidates).size).toBe(MAP_VOTE_CHOICES);
    expect(vote.candidates).not.toContain(LOBBY_MAP_IDS[0]);
    // The lobby that could not start is not joinable.
    expect(() => rooms.join(PUBLIC, "c", profile("C"), 2)).toThrow(/public match is in progress/);
    expect(() => rooms.voteMap("c", LOBBY_MAP_IDS[0])).toThrow(/offered/);
    rooms.voteMap("c", vote.candidates[0]);
    rooms.voteMap("c", vote.candidates[1]); // A guest may change their vote.
    rooms.voteMap("d", vote.candidates[1]);
    rooms.voteMap("e", vote.candidates[2]);
    expect(rooms.snapshot().mapVote!.votes).toEqual({ c: vote.candidates[1], d: vote.candidates[1], e: vote.candidates[2] });
    rooms.advance(3);
    expect(rooms.snapshot().mapVote).toBeDefined(); // Still running.
    rooms.releaseMatch(match.id);
    rooms.advance(4);
    const state = rooms.snapshot();
    expect(state.mapVote).toBeUndefined();
    expect(state.rooms.filter((room) => room.kind === "default").map((room) => room.id))
      .toEqual([`default-${vote.candidates[1]}`]);
    expect(() => rooms.voteMap("c", vote.candidates[0])).toThrow(/opens while/);
    rooms.join(`default-${vote.candidates[1]}`, "c", profile("C"), 5);
  });
  it("breaks ties and an empty vote in favour of the earlier offer", () => {
    const rooms = new RoomCoordinator(0, 1, undefined, { random: fixed });
    const tied = startPublic(rooms, 0);
    const first = rooms.snapshot().mapVote!.candidates;
    rooms.voteMap("c", first[2]);
    rooms.voteMap("d", first[1]);
    rooms.releaseMatch(tied.id);
    rooms.advance(2);
    expect(rooms.snapshot().rooms.find((room) => room.kind === "default")!.settings.mapId).toBe(first[1]);
    const empty = startPublic(rooms, 3);
    const second = rooms.snapshot().mapVote!.candidates;
    rooms.releaseMatch(empty.id);
    rooms.advance(5);
    expect(rooms.snapshot().rooms.find((room) => room.kind === "default")!.settings.mapId).toBe(second[0]);
  });
  it("starts hosted custom matches without opening the public vote", () => {
    const rooms = new RoomCoordinator(0, 0);
    const room = rooms.create("a", profile("A"), "Friends", rules, 0);
    rooms.join(room.id, "b", profile("B"), 0);
    rooms.voteToStart(room.id, "a");
    rooms.voteToStart(room.id, "b");
    const [match] = rooms.advance(1);
    expect(match).toMatchObject({ roomId: room.id, hostId: "a", ownerId: "a" });
    expect(rooms.snapshot().mapVote).toBeUndefined();
    // The started custom match is no longer a listed room.
    expect(rooms.snapshot().rooms.some((candidate) => candidate.id === room.id)).toBe(false);
  });
  it("starts a custom room only while its host is connected", () => {
    const rooms = new RoomCoordinator(0, 0);
    const room = rooms.create("a", profile("A"), "Friends", rules, 0);
    rooms.join(room.id, "b", profile("B"), 0);
    rooms.disconnect("a", 1);
    rooms.voteToStart(room.id, "b");
    expect(rooms.advance(2)).toHaveLength(0);
    // After the owner's grace, ownership (and hosting) passes to b.
    const [match] = rooms.advance(60_002);
    expect(match).toMatchObject({ hostId: "b", ownerId: "b" });
  });
});
