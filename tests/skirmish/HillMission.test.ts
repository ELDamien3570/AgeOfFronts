import { describe, expect, it } from "vitest";
import {
  HillPositioning,
  validateHillState,
} from "../../src/skirmish/domain/HillPositioning";
import { Skirmish } from "../../src/skirmish/Simulation";
import { hillDefenceScene } from "./fixtures/HillDefence";
const step = (scene: ReturnType<typeof hillDefenceScene>, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    scene.launch();
    scene.game.step();
    expect(scene.positioning.work).toBeLessThanOrEqual(12);
  }
};
describe("screened hill missions", () => {
  it("runs through the normal army mission planner and respects both work budgets", () => {
    const scene = hillDefenceScene(),
      planner = scene.game.expansion!.economy.military.armyPlanner;
    for (let i = 0; i < 350; i++) {
      expect(planner.step()).toBeLessThanOrEqual(24);
      expect(planner.hillPositions.work).toBeLessThanOrEqual(12);
      scene.game.step();
    }
    const mission = planner.missions.get("hill-review")!;
    expect(mission.kind).toBe("hold-position");
    expect(mission.hill!.phase).toBe("hold");
  });
  it("takes the usable hill, deploys two screens and holds at least thirty seconds", () => {
    const scene = hillDefenceScene();
    step(scene, 300);
    const { game, mission } = scene,
      e = game.expansion!,
      army = e.armies.armyOf(scene.defenders[0].id)!;
    expect(mission!.hill!.phase).toBe("hold");
    expect(mission!.kind).toBe("hold-position");
    const feature = e.features.hills.find(
      (f) => f.id === mission!.hill!.featureId,
    )!;
    expect(feature.component).toBe(game.paths.component[game.map.ref(32, 35)]);
    expect(feature.tile).not.toBe(game.map.ref(12, 15));
    expect(army.posture).toBe("defend");
    expect(army.slots!.filter((s) => s.role === "frontline")).toHaveLength(2);
    const ranged = army.slots!.filter((s) => s.role === "ranged");
    expect(ranged.reduce((n, s) => n + s.depth, 0)).toBe(0);
    const committed = mission!.hill!.committed!,
      selected = mission!.hill!.featureId;
    step(scene, committed + 599 - game.tick);
    expect(mission!.hill!.featureId).toBe(selected);
    expect(mission!.hill!.committed).toBe(committed);
  });
  it("requires screens and releases a held hill when rear access is lost", () => {
    const scene = hillDefenceScene(),
      e = scene.game.expansion!;
    step(scene, 300);
    const feature = e.features.hills.find(
      (f) => f.id === scene.mission!.hill!.featureId,
    )!;
    scene.game.owners[feature.rearTile] = 1;
    step(scene, 11);
    expect(scene.mission!.hill).toBeUndefined();
    expect(scene.mission!.reason).toMatch(/rear access/);
    const other = hillDefenceScene();
    for (const s of other.defenders.filter(
      (s) => other.game.expansion!.unit(s).role === "frontline",
    ))
      other.game.removeSquad(s.id);
    const army = other.game.expansion!.armies.armyOf(other.defenders[2].id)!;
    other.game.expansion!.features.step(64);
    other.positioning.step(
      other.mission!,
      other.game.players[1],
      army,
      other.defenders.filter((s) => s.troops > 0 && other.game.squad(s.id)),
      "warden",
      () => true,
    );
    expect(other.mission!.hill).toBeUndefined();
    expect(other.mission!.screenNeeded).toBe(2);
  });
  it.each([2, 60, 300])(
    "restores the index, route continuations and mission at tick %i",
    (ticks) => {
      const scene = hillDefenceScene();
      step(scene, ticks);
      const { game } = scene,
        saved = game.checkpoint(),
        copy = new Skirmish(game.map, { ...game.options });
      copy.restore(saved);
      expect(copy.expansion!.features.checkpoint()).toEqual(
        game.expansion!.features.checkpoint(),
      );
      const planner = copy.expansion!.economy.military.armyPlanner,
        mission = planner.missions.get("hill-review")!;
      expect(mission.hill).toEqual(scene.mission!.hill);
      const restored = new HillPositioning(
        copy.expansion!,
        copy.expansion!.economy.routes,
      );
      for (let i = 0; i < 50; i++) {
        scene.launch();
        if (copy.tick % 10 === 0) {
          const army = copy.expansion!.armies.armyOf(mission.members[0])!;
          restored.beginTick();
          restored.step(
            mission,
            copy.players[1],
            army,
            mission.members
              .map((id) => copy.squad(id)!)
              .filter((s) => s && s.troops > 0),
            "warden",
            (order) =>
              !copy.applyCommand({
                type: "army-order",
                playerId: 2,
                armyId: army.id,
                order,
              }),
          );
        }
        game.step();
        copy.step();
      }
      expect(copy.checkpoint()).toEqual(game.checkpoint());
    },
  );
  it("rejects malformed hill continuations", () => {
    expect(() => validateHillState(undefined, "hold-position")).toThrow();
    const scene = hillDefenceScene();
    step(scene, 300);
    const state = structuredClone(scene.mission!.hill!);
    state.cursor = 7;
    expect(() => validateHillState(state, "hold-position")).toThrow();
  });
});
