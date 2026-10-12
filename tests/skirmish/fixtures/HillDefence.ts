import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";
import { UNITS } from "../../../src/skirmish/content/Units";
import {
  createFormation,
  TURN,
} from "../../../src/skirmish/domain/FormationGeometry";
import {
  HillPositioning,
  type HillMission,
} from "../../../src/skirmish/domain/HillPositioning";
import { createManpower } from "../../../src/skirmish/domain/Manpower";
export function hillMap(withHeight = true) {
  const size = 64,
    land = new Uint8Array(size * size).fill(133),
    heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x - 32) - 5),
        dy = Math.max(0, Math.abs(y - 28) - 4);
      heights[y * size + x] = Math.max(0, 40 - Math.max(dx, dy) * 10);
      // Narrow spire and a separate island plateau are deliberately unsuitable.
      if (x === 12 && y === 15) heights[y * size + x] = 100;
      if (x >= 49 && x <= 59 && y >= 8 && y <= 18) {
        land[y * size + x] = 143;
        heights[y * size + x] = 70;
      }
      if (
        x >= 47 &&
        x <= 61 &&
        y >= 6 &&
        y <= 20 &&
        (x < 49 || x > 59 || y < 8 || y > 18)
      )
        land[y * size + x] = 0;
    }
  return createSkirmishMap(
    size,
    size,
    land,
    withHeight
      ? {
          values: heights,
          minimum: 0,
          maximum: 100,
          seaLevel: 0,
          reliefScale: 0.2,
        }
      : undefined,
  );
}
export function hillDefenceScene(duel = false, withHeight = true) {
  const map = hillMap(withHeight),
    game = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
      deferredPlanning: true,
      aiEconomy: true,
      startingAge: "BronzeAge",
    });
  const e = game.expansion!,
    template = structuredClone(game.squads[0]);
  for (const s of [...game.squads]) game.removeSquad(s.id);
  const archer = UNITS.find(
      (u) =>
        u.age === "BronzeAge" && u.role === "ranged" && u.attack.perSoldier,
    )!,
    foot = UNITS.find((u) => u.id === "bronzeage-infantry")!;
  const add = (ranged: boolean, owner: number, x: number, y: number) => {
    const unit = ranged ? archer : foot;
    return game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: owner,
      definitionId: unit.id,
      kind: unit.line,
      troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit),
      formation: {
        ...createFormation(unit.id),
        facing: owner === 1 ? 0 : TURN / 2,
      },
      x: x * FIXED,
      y: y * FIXED,
      order: { type: "hold" },
      path: [],
      queuedOrders: [],
      charge: null,
      combatTargetId: null,
    });
  };
  const defenders = duel
    ? [add(true, 2, 32, 32)]
    : [
        add(false, 2, 28, 18),
        add(false, 2, 32, 18),
        add(true, 2, 28, 15),
        add(true, 2, 32, 15),
      ];
  const attackers = duel
    ? [add(true, 1, 32, 39)]
    : [add(false, 1, 30, 43), add(false, 1, 34, 43), add(true, 1, 32, 46)];
  for (const p of game.players) {
    e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id);
    e.progression.states[p.id].age = "BronzeAge";
  }
  game.owners.fill(2);
  for (let y = 39; y < 64; y++)
    for (let x = 0; x < 64; x++) game.owners[map.ref(x, y)] = 1;
  let mission: HillMission | undefined;
  const positioning = new HillPositioning(e, e.economy.routes);
  if (!duel) {
    const error = game.applyCommand({
      type: "create-army",
      playerId: 2,
      squadIds: defenders.map((s) => s.id),
    });
    if (error) throw Error(error);
    const army = e.armies.armyOf(defenders[0].id)!;
    game.applyCommand({
      type: "army-auto",
      playerId: 2,
      armyId: army.id,
      enabled: false,
    });
    const plan = {
      id: "hill-review",
      playerId: 2,
      purpose: "defense" as const,
      targetTile: map.ref(32, 35),
      target: 1,
      reason: "Choosing a screened hill",
      desiredSquads: 4,
      kind: "combat" as const,
      generation: game.aiGeneration(2),
      phase: "advance" as const,
      created: 0,
      since: 0,
      deadline: 9999,
      nextThink: 0,
      cursor: 0,
      rosterIds: defenders.map((s) => s.id),
      members: defenders.map((s) => s.id),
      armyId: army.id,
      initialTroops: defenders.reduce((n, s) => n + s.troops, 0),
    };
    mission = plan;
    e.economy.military.armyPlanner.missions.set(plan.id, plan);
    e.economy.military.armyPlanner.byPlayer.set(2, [plan.id]);
    e.economy.assets.acquire(
      defenders.map((s) => ({
        asset: `squad:${s.id}` as const,
        playerId: 2,
        generation: plan.generation,
        controller: plan.id,
        priority: "defense" as const,
        createdTick: 0,
        expiresTick: 11000,
      })),
    );
  }
  const launch = () => {
    if (duel) return;
    const army = e.armies.armyOf(defenders[0].id);
    if (!army || game.tick % 10) return;
    positioning.beginTick();
    positioning.step(
      mission!,
      game.players[1],
      army,
      defenders.filter((s) => s.troops > 0),
      "warden",
      (order) =>
        !game.applyCommand({
          type: "army-order",
          playerId: 2,
          armyId: army.id,
          order,
        }),
    );
  };
  return { game, riders: attackers, defenders, launch, mission, positioning };
}
