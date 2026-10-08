import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import {
  DEMO_FACTIONS,
  DEMO_SQUADS_PER_FACTION,
  DEMO_TROOPS,
  demoTroopId,
  registerDemoTroops,
} from "./DemoTroops";
import { stoneAgeDemoMap } from "./StoneAgeDemoMap";

/** Fixture setup only; ordinary commands and authoritative combat follow. */
export function stoneAgeDemo(): Skirmish {
  registerDemoTroops();
  const map = stoneAgeDemoMap();
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 3,
    tribes: false,
    runAi: false,
    formationLocomotion: true,
    ruleset: "ages-v1",
    startingAge: "ClassicalAge",
  });
  const template = game.squads[0];
  for (const squad of game.squads.slice()) game.removeSquad(squad.id);
  for (const building of game.buildings.slice())
    game.removeBuilding(building.id);
  for (const [faction, playerId] of DEMO_FACTIONS.entries()) {
    const east = faction % 2 === 1,
      south = faction >= 2;
    const baseX = east ? 113 : 14,
      baseY = south ? 113 : 14;
    for (const [type, dx] of [
      ["city", 0],
      ["barracks", east ? -3 : 3],
    ] as const)
      game.addBuilding({
        id: game.allocateId(),
        playerId,
        type,
        tile: map.ref(baseX + dx, baseY),
        age: "ClassicalAge",
        remainingTicks: 0,
      });
    for (let i = 0; i < DEMO_SQUADS_PER_FACTION; i++) {
      const row = Math.floor(i / 10),
        column = i % 10;
      const troop = DEMO_TROOPS[(i + faction * 4) % DEMO_TROOPS.length];
      const x = (east ? 78.5 : 22.5) + column * 3;
      const y = (south ? 78.5 : 22.5) + row * 3;
      const squad = game.addSquad({
        ...template,
        id: game.allocateId(),
        playerId,
        x: Math.round(x * FIXED),
        y: Math.round(y * FIXED),
        troops: 1000,
        kind: troop.kind,
        definitionId: demoTroopId(troop),
        order: { type: "hold" },
        path: [],
        queuedOrders: [],
        charge: null,
        combatTargetId: null,
        fighting: false,
        moved: false,
      });
      const heading = Math.atan2(64 - y, 64 - x) - Math.PI / 2;
      game.updateSquad(squad.id, {
        locomotion: { heading, targetHeading: heading, speed: 0 },
      });
    }
  }
  return game;
}

export function engageDemoArmies(game: Skirmish): void {
  for (const squad of game.squads) {
    let target: typeof squad | undefined,
      distance = Infinity;
    for (const other of game.squads) {
      if (other.playerId === squad.playerId) continue;
      const d = (other.x - squad.x) ** 2 + (other.y - squad.y) ** 2;
      if (d < distance) {
        target = other;
        distance = d;
      }
    }
    if (target)
      game.applyCommand({
        type: "order",
        playerId: squad.playerId,
        squadIds: [squad.id],
        order: { type: "attack", targetId: target.id },
      });
  }
}
