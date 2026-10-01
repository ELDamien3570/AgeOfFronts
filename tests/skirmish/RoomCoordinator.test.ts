import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { RoomCoordinator } from "../../src/skirmish/multiplayer/domain/RoomCoordinator";

const profile = (name: string) => ({ name, flagCode: null });
const rules = { ...defaultLobbySettings("africa"), countdownSeconds: 15 };

describe("online room lifecycle", () => {
  it("starts before the deadline only after all connected humans vote", () => {
    const rooms = new RoomCoordinator(0, 1);
    const id = "default-africa";
    rooms.join(id, "a", profile("A"), 0);
    rooms.join(id, "b", profile("B"), 0);
    rooms.voteToStart(id, "a");
    expect(rooms.advance(1)).toHaveLength(0); // A second connected human has not voted.
    expect(() => rooms.voteToStart(id, "outsider")).toThrow(/Join/);
    rooms.voteToStart(id, "b");
    rooms.voteToStart(id, "b"); // Repeated votes do not create additional votes.
    expect(rooms.advance(2)).toHaveLength(1);
  });
  it("allows a lobby to start with 1 human if that human votes to start", () => {
    const rooms = new RoomCoordinator(0, 1);
    const id = "default-africa";
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
    const id = "default-africa";
    rooms.join(id, "a", profile("A"), 0);
    rooms.join(id, "b", profile("B"), 0);
    rooms.voteToStart(id, "a");
    rooms.voteToStart(id, "b");
    rooms.disconnect("b", 1);
    rooms.reconnect("b");
    expect(rooms.advance(2)).toHaveLength(0);
    rooms.voteToStart(id, "b");
    expect(rooms.advance(3)).toHaveLength(1);
  });
  it("unanimous votes still wait for reserved match capacity", () => {
    const rooms = new RoomCoordinator(0, 0);
    const id = "default-africa";
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
        fillVacanciesWithAi: true,
      },
      false,
      0,
    );
    rooms.disconnect("a", 1000);
    expect(rooms.advance(15_000)).toHaveLength(0);
    expect(rooms.snapshot().reservations).toHaveLength(0);
    expect(
      rooms.snapshot().rooms.find((r) => r.id === room.id)!.deadline,
    ).toBeUndefined();
    rooms.advance(61_000);
    expect(rooms.snapshot().rooms.some((r) => r.id === room.id)).toBe(false);
  });
  it("reserves seats by guest identity and reconnects without creating duplicates", () => {
    const rooms = new RoomCoordinator(0, 0);
    rooms.join("default-africa", "a", profile("A"), 0);
    rooms.disconnect("a", 1000);
    rooms.join("default-africa", "a", profile("Renamed"), 2000);
    expect(
      rooms.snapshot().rooms.find((r) => r.id === "default-africa")!.members,
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
    const room = rooms.create("a", profile("A"), "Room", rules, false, 0);
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
  it("expires empty custom rooms and promotes the FIFO queue once", () => {
    const rooms = new RoomCoordinator(0, 0);
    const first = rooms.create("a", profile("A"), "A", rules, false, 0);
    rooms.create("b", profile("B"), "B", rules, false, 0);
    rooms.create("c", profile("C"), "C", rules, false, 0);
    const queued = rooms.create("d", profile("D"), "D", rules, true, 0);
    expect(queued.listing).toBe("queued");
    expect(() =>
      rooms.create("d", profile("D"), "Again", rules, true, 0),
    ).toThrow("already own");
    rooms.disconnect("a", 1);
    rooms.advance(60_001);
    const state = rooms.snapshot();
    expect(state.rooms.some((r) => r.id === first.id)).toBe(false);
    expect(state.rooms.find((r) => r.id === queued.id)!.listing).toBe(
      "visible",
    );
    expect(
      state.rooms.filter((r) => r.kind === "custom" && r.listing === "visible"),
    ).toHaveLength(3);
  });
  it("resets the countdown below minimum humans and waits for measured fallback capacity", () => {
    const rooms = new RoomCoordinator(0, 1);
    const a = rooms.create("a", profile("A"), "A", rules, false, 0);
    rooms.join(a.id, "b", profile("B"), 0);
    rooms.disconnect("b", 10_000);
    expect(rooms.advance(15_000)).toHaveLength(0);
    rooms.join(a.id, "b", profile("B"), 20_000);
    expect(rooms.advance(34_999)).toHaveLength(0);
    const first = rooms.advance(35_000);
    expect(first).toHaveLength(1);
    const c = rooms.create("c", profile("C"), "C", rules, false, 35_000);
    rooms.join(c.id, "d", profile("D"), 35_000);
    expect(rooms.advance(50_000)).toHaveLength(0);
    expect(
      rooms.snapshot().rooms.find((r) => r.id === c.id)!.capacityWaiting,
    ).toBe(true);
    rooms.releaseMatch(first[0].id);
    expect(rooms.advance(50_001)).toHaveLength(1);
    expect(rooms.advance(50_002)).toHaveLength(0);
  });
  it("cannot impersonate an owner through a display name or close a default room", () => {
    const rooms = new RoomCoordinator(0, 0);
    const room = rooms.create("a", profile("Same"), "A", rules, false, 0);
    rooms.join(room.id, "b", profile("Same"), 1);
    expect(() => rooms.close(room.id, "b")).toThrow("owner");
    expect(() => rooms.close("default-africa", "a")).toThrow("owner");
  });
  it("releases an abandoned match once the last human disconnects", () => {
    const rooms = new RoomCoordinator(0, 1);
    const room = rooms.create("a", profile("A"), "A", rules, false, 0);
    rooms.join(room.id, "b", profile("B"), 0);
    const [match] = rooms.advance(15_000);
    expect(rooms.disconnect("a", 16_000)).toEqual([]);
    expect(rooms.snapshot().reservations).toHaveLength(1);
    expect(rooms.disconnect("b", 17_000)).toEqual([match.id]);
    expect(rooms.disconnect("b", 17_001)).toEqual([]);
    expect(rooms.snapshot().reservations).toHaveLength(0);
    rooms.join("default-africa", "a", profile("A"), 18_000);
    rooms.join("default-africa", "b", profile("B"), 18_000);
    expect(rooms.advance(78_000)).toHaveLength(1);
  });
});
