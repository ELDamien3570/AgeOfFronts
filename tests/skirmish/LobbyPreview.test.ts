import { describe, expect, it } from "vitest";
import { MAX_HUMAN_PLAYERS } from "../../src/skirmish/FactionRules";
import { LobbyViewModel } from "../../src/skirmish/client/lobby/LobbyViewModel";

describe("local lobby preview", () => {
  it("rotates featured cards every minute without mutating custom rooms, queue or an entered roster", () => {
    const vm = new LobbyViewModel(undefined, 0);
    for (const id of ["one", "two", "three", "four"])
      vm.createRoom(id, id, vm.rules, true);
    const original = vm.featuredMaps.map((map) => map.id);
    vm.tickDirectory(59_000);
    expect(vm.rotationSeconds).toBe(1);
    expect(vm.featuredMaps.map((map) => map.id)).toEqual(original);
    vm.tickDirectory(60_000);
    expect(vm.rotationSeconds).toBe(60);
    expect(vm.featuredMaps.map((map) => map.id)).toEqual([
      "old-world",
      "new-world",
      "valles-kairulia",
    ]);
    expect(vm.directory.visible.map((room) => room.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(vm.directory.queue[0].id).toBe("four");
    vm.showLobby("africa");
    vm.addSample(60_000);
    expect(vm.tickDirectory(120_000)).toBe(false);
    expect(vm.humanCount).toBe(2);
    expect(vm.phase).toBe("countdown");
    vm.showHome();
    vm.tickDirectory(180_000);
    expect(vm.featuredMaps).toHaveLength(3);
    expect(new Set(vm.featuredMaps.map((map) => map.id)).size).toBe(3);
  });
  it("offers only the agreed maps and safely rejects unknown map links", () => {
    const vm = new LobbyViewModel();
    expect(vm.maps.map((map) => map.id)).toEqual([
      "heightmap-test1",
      "africa",
      "amazon-river",
      "old-world",
      "new-world",
      "valles-kairulia",
    ]);
    expect(vm.rules.slots).toBe(MAX_HUMAN_PLAYERS);
    // Base lobbies use the 500-cell defaults: 10 AI opponents and 25 tribes.
    expect(vm.rules.aiCount).toBe(10);
    expect(vm.rules.tribeCount).toBe(25);
    expect(vm.showLobby("<script>")).toBe(false);
    expect(vm.page).toBe("home");
    expect(vm.showLobby("heightmap-test1")).toBe(true);
    expect(vm.skirmishHref).toBe("/skirmish/index.html?map=heightmap-test1");
    for (const id of ["old-world", "new-world", "valles-kairulia"]) {
      expect(vm.showLobby(id)).toBe(true);
      expect(vm.skirmishHref).toBe(`/skirmish/index.html?map=${id}`);
    }
  });

  it("waits for two humans, then adds the map size's AI opponents when the timer ends", () => {
    const vm = new LobbyViewModel();
    vm.showLobby("heightmap-test1");
    expect(vm.tick(1_000_000)).toBe(false);
    expect(vm.phase).toBe("waiting");
    expect(vm.countdown).toBe("1:00");
    expect(vm.seats.filter((seat) => seat.kind === "open")).toHaveLength(19);
    vm.addSample(1_000);
    expect(vm.tick(60_999)).toBe(true);
    expect(vm.countdown).toBe("0:01");
    expect(vm.phase).toBe("countdown");
    vm.tick(61_000);
    expect(vm.phase).toBe("complete");
    expect(vm.humanCount).toBe(2);
    expect(vm.aiCount).toBe(10);
    expect(vm.seats.filter((seat) => seat.kind === "ai")).toHaveLength(10);
    expect(vm.addSample(62_000)).toBe(false);
    expect(vm.removeSample()).toBe(false);
  });

  it("does not extend an active countdown when more sample players join", () => {
    const vm = new LobbyViewModel();
    vm.showLobby("heightmap-test1");
    vm.addSample(0);
    vm.tick(30_000);
    vm.addSample(40_000);
    vm.tick(60_000);
    expect(vm.phase).toBe("complete");
    expect(vm.humanCount).toBe(3);
    expect(vm.aiCount).toBe(10);
  });

  it("cancels a countdown below the minimum and restarts a full minute", () => {
    const vm = new LobbyViewModel();
    vm.showLobby("heightmap-test1");
    vm.addSample(0);
    vm.tick(45_000);
    vm.removeSample();
    expect(vm.phase).toBe("waiting");
    expect(vm.countdown).toBe("1:00");
    expect(vm.tick(65_000)).toBe(false);
    vm.addSample(70_000);
    vm.tick(75_000);
    expect(vm.countdown).toBe("0:55");
  });

  it("freezes at 20 humans and still adds the base AI opponents", () => {
    const vm = new LobbyViewModel();
    vm.showLobby("africa");
    for (let i = 0; i < 30; i++) vm.addSample(0);
    expect(vm.phase).toBe("complete");
    expect(vm.seats).toHaveLength(30);
    expect(vm.humanCount).toBe(20);
    expect(vm.aiCount).toBe(10);
    expect(vm.countdown).toBe("0:00");
  });

  it("clears sample players and countdown on leaving or changing maps", () => {
    const vm = new LobbyViewModel();
    vm.showLobby("heightmap-test1");
    vm.addSample(0);
    vm.showLobby("africa");
    expect(vm.humanCount).toBe(1);
    expect(vm.phase).toBe("waiting");
    vm.addSample(0);
    vm.showHome();
    expect(vm.addSample(0)).toBe(false);
    expect(vm.tick(70_000)).toBe(false);
    expect(vm.humanCount).toBe(1);
  });
});
