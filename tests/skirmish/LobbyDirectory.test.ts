import { describe, expect, it } from "vitest";
import type {
  LobbyPreviewData,
  LobbyPreviewStore,
} from "../../src/skirmish/client/lobby/LobbyPreviewStore";
import { LobbyViewModel } from "../../src/skirmish/client/lobby/LobbyViewModel";
import {
  createEmpireProfile,
  DEFAULT_EMPIRE_PROFILE,
} from "../../src/skirmish/lobby/EmpireProfile";
import {
  defaultLobbySettings,
  LobbyDirectory,
  validateLobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";

const room = (id: string) => ({
  id,
  title: `Lobby ${id}`,
  owner: DEFAULT_EMPIRE_PROFILE,
  settings: defaultLobbySettings("heightmap-test1"),
});

describe("custom lobby holder and waiting queue", () => {
  it("requires opt-in when all three display spaces are occupied", () => {
    const directory = new LobbyDirectory();
    for (const id of ["one", "two", "three"]) directory.create(room(id), false);
    expect(() => directory.create(room("four"), false)).toThrow("Opt into");
    expect(directory.visible).toHaveLength(3);
    expect(directory.queue).toHaveLength(0);
    expect(directory.create(room("four"), true)).toBe("queued");
    expect(directory.queue.map((entry) => entry.id)).toEqual(["four"]);
  });

  it("promotes FIFO and preserves queue order when an entry is cancelled", () => {
    const directory = new LobbyDirectory();
    for (const id of ["one", "two", "three", "four", "five", "six"])
      directory.create(room(id), true);
    directory.remove("five");
    directory.remove("two");
    expect(directory.visible.map((entry) => entry.id)).toEqual([
      "one",
      "three",
      "four",
    ]);
    expect(directory.queue.map((entry) => entry.id)).toEqual(["six"]);
    directory.remove("one");
    expect(directory.visible.map((entry) => entry.id)).toEqual([
      "three",
      "four",
      "six",
    ]);
    expect(directory.queue).toHaveLength(0);
    expect(directory.remove("missing")).toBe(false);
  });

  it("rejects duplicate identifiers and invalid rules without occupying a space", () => {
    const directory = new LobbyDirectory();
    directory.create(room("one"), false);
    expect(() => directory.create(room("one"), true)).toThrow("already exists");
    expect(() =>
      directory.create(
        {
          ...room("two"),
          settings: { ...defaultLobbySettings("heightmap-test1"), slots: 21 },
        },
        false,
      ),
    ).toThrow("20 total");
    expect(directory.visible).toHaveLength(1);
    expect(directory.queue).toHaveLength(0);
  });

  it("enforces consistent minimum humans, timer bounds, and alliance victory", () => {
    const base = defaultLobbySettings("heightmap-test1");
    expect(() =>
      validateLobbySettings({ ...base, slots: 4, minimumHumans: 5 }),
    ).toThrow("Minimum humans");
    expect(() =>
      validateLobbySettings({ ...base, countdownSeconds: 14 }),
    ).toThrow("15 and 300");
    expect(() =>
      validateLobbySettings({ ...base, countdownSeconds: 301 }),
    ).toThrow("15 and 300");
    expect(() =>
      validateLobbySettings({ ...base, victory: "allied", alliances: false }),
    ).toThrow("requires alliances");
    expect(
      validateLobbySettings({ ...base, victory: "allied", alliances: true })
        .victory,
    ).toBe("allied");
  });

  it("validates resource density and output independently and keeps default rooms at 1×", () => {
    const base = defaultLobbySettings("heightmap-test1");
    expect(base.resourceDensity).toBe(1);
    expect(base.resourceOutput).toBe(1);
    expect(
      validateLobbySettings({ ...base, resourceDensity: 5, resourceOutput: 2 }),
    ).toMatchObject({ resourceDensity: 5, resourceOutput: 2 });
    for (const field of ["resourceDensity", "resourceOutput"] as const) {
      for (const value of [0, 4, 10, NaN, Infinity, "5", null])
        expect(() =>
          validateLobbySettings({ ...base, [field]: value }),
        ).toThrow("Resource density and deposit output");
    }
  });
});

describe("custom settings and empire identity in preview", () => {
  it("runs custom capacity/timer/minimum settings and leaves seats empty when AI is disabled", () => {
    const vm = new LobbyViewModel();
    vm.createRoom(
      "custom",
      "Friends",
      {
        ...defaultLobbySettings("africa"),
        slots: 4,
        minimumHumans: 1,
        countdownSeconds: 15,
        fillVacanciesWithAi: false,
      },
      false,
    );
    expect(vm.showCustomRoom("custom", 1000)).toBe(true);
    expect(vm.phase).toBe("countdown");
    expect(vm.countdown).toBe("0:15");
    vm.tick(16_000);
    expect(vm.phase).toBe("complete");
    expect(vm.humanCount).toBe(1);
    expect(vm.aiCount).toBe(0);
    expect(vm.seats.filter((seat) => seat.kind === "open")).toHaveLength(3);
  });

  it("allows review of a queued room while keeping it out of the custom holder", () => {
    const vm = new LobbyViewModel();
    for (const id of ["one", "two", "three", "four"])
      vm.createRoom(id, id, defaultLobbySettings("heightmap-test1"), true);
    expect(vm.directory.visible.some((room) => room.id === "four")).toBe(false);
    expect(vm.showCustomRoom("four", 0)).toBe(true);
    vm.removeRoom("one");
    expect(vm.showCustomRoom("four", 0)).toBe(true);
  });

  it("saves identity and the directory through a port and restores them after reload", () => {
    let saved: LobbyPreviewData | undefined;
    const store: LobbyPreviewStore = {
      read: () => saved,
      write: (data) => {
        saved = JSON.parse(JSON.stringify(data));
        return true;
      },
    };
    const vm = new LobbyViewModel(store);
    expect(vm.saveProfile("Golden Eagles", "us")).toBe(true);
    for (const id of ["one", "two", "three", "four"])
      vm.createRoom(
        id,
        id,
        {
          ...defaultLobbySettings("heightmap-test1"),
          resourceDensity: 3,
          resourceOutput: 5,
        },
        true,
      );
    const restored = new LobbyViewModel(store);
    expect(restored.profile.name).toBe("Golden Eagles");
    expect(restored.profile.flagCode).toBe("us");
    expect(restored.directory.visible).toHaveLength(3);
    expect(restored.directory.queue[0].id).toBe("four");
    restored.showCustomRoom("one", 0);
    expect(restored.seats[0].name).toBe("Golden Eagles");
    expect(restored.rules).toMatchObject({
      resourceDensity: 3,
      resourceOutput: 5,
    });
    restored.showCustomRoom("four", 0);
    expect(restored.rules).toMatchObject({
      resourceDensity: 3,
      resourceOutput: 5,
    });
  });

  it("restores older saved rooms at 1× without discarding identity, rules or queue order", () => {
    // Destructured only to drop the fields older saves did not have.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resourceDensity, resourceOutput, ...legacySettings } =
      defaultLobbySettings("africa");
    const legacyRoom = (id: string) => ({
      ...room(id),
      settings: { ...legacySettings, slots: 4 },
    });
    const vm = new LobbyViewModel({
      read: () => ({
        version: 1,
        profile: { name: "Eagles", flagCode: "us" },
        visible: ["one", "two", "three"].map(legacyRoom),
        queue: [legacyRoom("four")],
      }),
      write: () => true,
    });
    expect(vm.profile.name).toBe("Eagles");
    expect(vm.directory.visible.map((entry) => entry.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(vm.directory.queue[0].id).toBe("four");
    vm.showCustomRoom("four", 0);
    expect(vm.rules).toMatchObject({
      mapId: "africa",
      slots: 4,
      resourceDensity: 1,
      resourceOutput: 1,
    });
  });

  it("reports unavailable persistence and rejects invalid names or flag paths", () => {
    const vm = new LobbyViewModel({
      read: () => undefined,
      write: () => false,
    });
    expect(vm.saveProfile("My Empire", null)).toBe(true);
    expect(vm.message).toContain("lost on reload");
    expect(vm.saveProfile("", null)).toBe(false);
    expect(vm.saveProfile("x".repeat(21), null)).toBe(false);
    expect(vm.saveProfile("Valid", "../../secrets")).toBe(false);
    expect(vm.profile.name).toBe("My Empire");
    expect(createEmpireProfile("  Eagle  ", null).name).toBe("Eagle");
  });

  it("ignores corrupt persisted state instead of accepting invalid rooms or flags", () => {
    const bad = {
      version: 1,
      profile: { name: "Bad", flagCode: "unknown" },
      visible: [
        {
          ...room("bad"),
          settings: { ...defaultLobbySettings("heightmap-test1"), slots: 40 },
        },
      ],
      queue: [],
    };
    const vm = new LobbyViewModel({ read: () => bad, write: () => true });
    expect(vm.profile).toEqual(DEFAULT_EMPIRE_PROFILE);
    expect(vm.directory.visible).toHaveLength(0);
  });
});
