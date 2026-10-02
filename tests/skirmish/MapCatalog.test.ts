import { describe, expect, it } from "vitest";
import {
  LOBBY_MAPS,
  lobbyMapDimensions,
} from "../../src/skirmish/client/lobby/MapCatalog";
import { HEIGHTMAP_MAPS } from "../../src/skirmish/content/Maps";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { clientMessageSchema } from "../../src/skirmish/multiplayer/Protocol";
import { RoomCoordinator } from "../../src/skirmish/multiplayer/domain/RoomCoordinator";

describe("heightmap registration", () => {
  it("presents Old World with matching preview and 4:3 map sizes", () => {
    const map = LOBBY_MAPS.find((entry) => entry.id === "old-world")!;
    expect(map).toMatchObject({
      name: "Old World",
      image: "/maps/old-world/lobby-preview.png",
      sourceWidth: 8192,
      sourceHeight: 6144,
    });
    for (const [size, height] of [
      [250, 188],
      [500, 375],
      [1000, 750],
    ]) {
      expect(lobbyMapDimensions(map, size)).toEqual({ width: size, height });
    }
  });

  it("presents New World with matching preview and 3:4 portrait map sizes", () => {
    const map = LOBBY_MAPS.find((entry) => entry.id === "new-world")!;
    expect(map).toMatchObject({
      name: "New World",
      image: "/maps/new-world/lobby-preview.png",
      sourceWidth: 6144,
      sourceHeight: 8192,
    });
    for (const [size, width] of [
      [250, 188],
      [500, 375],
      [1000, 750],
    ]) {
      expect(lobbyMapDimensions(map, size)).toEqual({ width, height: size });
    }
  });

  it("presents Valles Kairulia with square source proportions and a matching preview", () => {
    const map = LOBBY_MAPS.find((entry) => entry.id === "valles-kairulia")!;
    expect(map).toMatchObject({
      name: "Valles Kairulia",
      image: "/maps/valles-kairulia/lobby-preview.png",
      sourceWidth: 4096,
      sourceHeight: 4096,
    });
    for (const size of [250, 500, 1000]) {
      expect(lobbyMapDimensions(map, size)).toEqual({
        width: size,
        height: size,
      });
    }
    expect(
      new RoomCoordinator(0, 1)
        .snapshot()
        .rooms.find((room) => room.id === "default-valles-kairulia"),
    ).toMatchObject({
      kind: "default",
      settings: defaultLobbySettings("valles-kairulia"),
    });
  });

  it("accepts every registered map in multiplayer creation messages", () => {
    for (const map of HEIGHTMAP_MAPS) {
      for (const worldSize of [250, 500, 1000]) {
        const message = {
          type: "create",
          requestId: "map-registration",
          title: map.name,
          settings: { ...defaultLobbySettings(map.id), worldSize },
          willingToWait: false,
        };
        expect(clientMessageSchema.safeParse(message).success).toBe(true);
        expect(
          clientMessageSchema.safeParse({
            ...message,
            settings: { ...message.settings, mapId: "unsupported" },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("creates default rooms for Old World and New World alongside all other maps", () => {
    const rooms = new RoomCoordinator(0, 1).snapshot().rooms;
    expect(rooms.map((room) => room.settings.mapId)).toEqual(
      HEIGHTMAP_MAPS.map((map) => map.id),
    );
    expect(rooms.find((room) => room.id === "default-new-world")).toMatchObject(
      {
        kind: "default",
        settings: defaultLobbySettings("new-world"),
      },
    );
    expect(rooms.find((room) => room.id === "default-old-world")).toMatchObject(
      {
        kind: "default",
        settings: defaultLobbySettings("old-world"),
      },
    );
  });
});
