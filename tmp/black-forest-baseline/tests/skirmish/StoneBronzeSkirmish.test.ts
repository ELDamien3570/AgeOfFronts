import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { AI_PERSONALITIES } from "../../src/skirmish/content/AiPersonalities";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { Progression } from "../../src/skirmish/domain/Progression";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  STONE_BRONZE_ACTORS,
  STONE_BRONZE_ARTWORK,
  STONE_BRONZE_OPTIONS,
} from "./browser/StoneBronzeSkirmishRoster";
function fixture(startingAge: Age = "StoneAge", capped = true) {
  const cells = new Uint8Array(48 * 48).fill(133);
  return new Skirmish(new GameMapImpl(48, 48, cells, cells.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    startingAge,
    ...(capped ? STONE_BRONZE_OPTIONS : {}),
  });
}
function ready(game: Skirmish, playerId: number) {
  const player = game.players.find((p) => p.id === playerId)!;
  player.gold = 1000000;
  const state = game.expansion!.progression.states[playerId];
  state.completed = TECHNOLOGIES.filter(
    (t) => AGES.indexOf(t.age) <= AGES.indexOf(state.age),
  ).map((t) => t.id);
  return { player, state };
}
describe("isolated Stone/Bronze playable skirmish", () => {
  it("maps six real recruitment definitions to materialized single-actor art without registering demo units", () => {
    expect(STONE_BRONZE_ARTWORK.size).toBe(6);
    for (const [id, actor] of STONE_BRONZE_ARTWORK) {
      expect(UNIT.get(id)?.age).toBe(actor.age);
      expect(actor.memberScale).toBeGreaterThan(0);
      const root = `Art/Cultures/Russians/Units/${actor.age}/${actor.name}/`;
      const manifest = JSON.parse(
        readFileSync(root + "animations.json", "utf8"),
      );
      expect(manifest.actorCount).toBe(1);
      for (const id of ["idle", "running", "attack", "death"]) {
        const clip = manifest.animations.find(
          (c: { id: string }) => c.id === id,
        );
        expect(clip, `${actor.name} ${id}`).toBeTruthy();
        const fd = openSync(root + clip.file, "r"),
          header = Buffer.alloc(8);
        try {
          readSync(fd, header, 0, 8, 0);
        } finally {
          closeSync(fd);
        }
        expect(header.toString("hex")).toBe("89504e470d0a1a0a");
        expect(clip.frames).toHaveLength(clip.frameCount);
      }
    }
    expect(
      STONE_BRONZE_ACTORS.every(
        (a) => a.age === "StoneAge" || a.age === "BronzeAge",
      ),
    ).toBe(true);
  });
  it("allows Stone advancement, then refuses Classical for both human and AI without charging gold", () => {
    const game = fixture();
    for (const player of game.players) {
      const { state } = ready(game, player.id);
      expect(
        game.applyCommand({ type: "advance-age", playerId: player.id }),
      ).toBeNull();
      state.advancement!.remainingTicks = 1;
    }
    game.expansion!.progression.step(game.players);
    for (const player of game.players) {
      const { state } = ready(game, player.id),
        gold = player.gold;
      expect(state.age).toBe("BronzeAge");
      expect(
        game.applyCommand({ type: "advance-age", playerId: player.id }),
      ).toContain("final age");
      expect(player.gold).toBe(gold);
      expect(state.advancement).toBeNull();
    }
  });
  it("does not limit normal skirmishes", () => {
    const game = fixture("BronzeAge", false);
    ready(game, 1);
    expect(game.applyCommand({ type: "advance-age", playerId: 1 })).toBeNull();
    expect(game.expansion!.progression.states[1].advancement!.target).toBe(
      "ClassicalAge",
    );
    expect(game.snapshot().expansion).not.toHaveProperty("maximumAge");
  });
  it("carries the ceiling through full/delta worker snapshots and restores it with the match", () => {
    const game = fixture("BronzeAge"),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const decode = () =>
      decoder.decode(
        encoder.encode(
          game.replicationSource(),
          game.tileChanges,
          game.replicationFacts(),
        ),
      );
    expect(decode().expansion!.maximumAge).toBe("BronzeAge");
    game.step();
    const snapshot = decode();
    expect(snapshot.expansion!.maximumAge).toBe("BronzeAge");
    const vm = new EmpireViewModel(snapshot, {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
    expect(vm.advance.reason).toContain("final age");
    const restored = new Skirmish(game.map, game.options);
    restored.restore(game.checkpoint());
    ready(restored, 1);
    expect(
      restored.applyCommand({ type: "advance-age", playerId: 1 }),
    ).toContain("final age");
  });
  it("does not let AI reserve or plan forbidden advancement", () => {
    const game = fixture("BronzeAge"),
      { player, state } = ready(game, 2);
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: state.age,
      research: state.completed,
      inventory: {},
      buildings: game.buildings,
      squads: game.squads,
      ships: [],
      jobs: [],
      production: {},
      cap: 0,
      threatTroops: 0,
    });
    const args = [
      snapshot,
      state,
      AI_PERSONALITIES[0],
      { units: {}, equipment: {}, materials: {} },
      1,
      [],
    ] as const;
    expect(
      economicCandidates(...args, undefined, "BronzeAge").some(
        (c) => c.kind === "advance",
      ),
    ).toBe(false);
    expect(economicCandidates(...args).some((c) => c.kind === "advance")).toBe(
      true,
    );
  });
  it("rejects a starting age above the ceiling", () => {
    expect(() => new Progression(1, "ClassicalAge", "BronzeAge")).toThrow(
      "age ceiling",
    );
  });
});
