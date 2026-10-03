import { FIXED, type Player, type Ship } from "../Protocol";
import { tilePoint } from "../SquadGeometry";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import { navalPower, navalReady, type AiFleetMission } from "./AiNavalPlanner";
import { approachCandidate } from "./AiTacticalRoutes";
import type { Expansion } from "./Expansion";
import { structureAim } from "./StructureTargeting";
export interface Bombardment {
  phase: "targets" | "position" | "sail" | "fire";
  cursor?: number | null;
  scanned: number;
  target?: number;
  candidate: number;
  start: number;
  tile?: number;
  since: number;
  initialHealth?: number;
}
/** Uses the owning fleet's existing leases. The exact router certifies approach;
 * ordinary Sail and naval-attack commands own movement and all real damage. */
export function stepBombardment(
  player: Player,
  m: AiFleetMission,
  e: Expansion,
  economy: AiEconomicDirector,
  budget: number,
): { work: number; terminal?: "complete" | "recover"; reason?: string } {
  const { world, operations, fortifications } = e,
    b = m.bombard!;
  const ships = m.members
    .map((id) => world.ship(id))
    .filter(
      (s): s is Ship =>
        !!s &&
        s.playerId === player.id &&
        s.health > 0 &&
        economy.assets.owns(`ship:${s.id}`, m.id) &&
        navalReady(s, e.vessel(s)) &&
        world.waterPaths.component[world.tileOf(s)] === m.sea,
    );
  const shooters = ships.filter((s) =>
    e.vessel(s).attack?.targets.includes("structure"),
  );
  let used = 0;
  const end = (terminal: "complete" | "recover", reason: string) => {
    economy.routes.release(m.id);
    m.bombard = undefined;
    if (terminal === "recover" && ships.length && m.anchor !== undefined)
      world.applyCommand({
        type: "sail",
        playerId: player.id,
        shipIds: ships.map((s) => s.id),
        tile: m.anchor,
      });
    return { work: Math.max(1, used), terminal, reason };
  };
  if (
    ships.length < 2 ||
    !shooters.length ||
    (m.lostPower ?? 0) > 0 ||
    world.tick - b.since >= 1000
  )
    return end("recover", "Bombardment lost its escort or commitment window");
  const target = b.target === undefined ? undefined : world.building(b.target);
  if (b.target !== undefined && (!target || (target.health ?? 1) <= 0))
    return end("complete", "Coastal bombardment objective destroyed");
  if (
    target &&
    (!world.hostile(player.id, target.playerId) ||
      (operations.enabled(player) &&
        (!operations.canTarget(player.id, target.playerId) ||
          !operations.canEnter(player.id, target.playerId, target.tile))))
  )
    return end(
      "complete",
      "Coastal target captured or operation permission changed",
    );
  while (used < budget) {
    used++;
    if (b.phase === "targets") {
      const read = economy.navalFacts.readSea("buildings", m.sea, b.cursor);
      b.cursor = read.next;
      b.scanned++;
      if (read.invalid) return end("recover", "Coastal target index changed");
      const building = read.value;
      if (
        building &&
        !building.remainingTicks &&
        (building.health ?? 1) > 0 &&
        world.hostile(player.id, building.playerId) &&
        (!operations.enabled(player) ||
          (operations.canTarget(player.id, building.playerId) &&
            operations.canEnter(
              player.id,
              building.playerId,
              building.tile,
            ))) &&
        [
          "port",
          "tower",
          "factory",
          "city",
          "siege-workshop",
          "arms-factory",
        ].includes(building.type)
      ) {
        b.target = building.id;
        b.initialHealth = building.health;
        b.phase = "position";
        b.candidate = 0;
        m.objective = "bombard-coast";
        m.reason = "Certifying a legal coastal firing position";
        continue;
      }
      if (read.next === null || b.scanned >= 64)
        return end(
          "complete",
          "No useful legal coastal target in bounded shortlist",
        );
    } else if (b.phase === "position") {
      const building = world.building(b.target!);
      if (!building) return end("complete", "Coastal structure removed");
      const range = Math.min(...shooters.map((s) => e.vessel(s).attack!.range));
      const tile = approachCandidate(
        world.map,
        building.tile,
        range,
        b.candidate,
      );
      if (
        tile === undefined ||
        world.waterPaths.component[tile] !== m.sea ||
        !structureAim(
          tilePoint(world.map, tile),
          [building.tile],
          range,
          player.id,
          world.map.width(),
          fortifications,
        )
      ) {
        b.candidate++;
      } else {
        const quote = economy.routes.request(
          m.id,
          player.id,
          b.start,
          tile,
          true,
        );
        if (quote.pending) break;
        if (quote.path) {
          b.tile = tile;
          b.phase = "sail";
          const result = world.applyCommand({
            type: "sail",
            playerId: player.id,
            shipIds: ships.map((s) => s.id),
            tile,
          });
          if (result) return end("recover", result);
          m.reason =
            "Sailing bombardment and escort to the certified firing area";
          break;
        }
        b.candidate++;
      }
      if (b.candidate >= 24) {
        economy.routes.release(m.id);
        b.phase = "targets";
        b.target = undefined;
        b.candidate = 0;
      }
    } else {
      const building = world.building(b.target!);
      if (!building) return end("complete", "Coastal structure removed");
      let enemyPower = 0,
        observed = 0;
      for (const enemy of economy.navalFacts.nearbyShips(
        m.sea,
        tilePoint(world.map, b.tile!),
        16 * FIXED,
      )) {
        if (++observed > 16) break;
        if (world.hostile(player.id, enemy.playerId))
          enemyPower += navalPower(e.vessel(enemy), enemy.health);
      }
      const ownPower = ships.reduce(
        (n, s) => n + navalPower(e.vessel(s), s.health),
        0,
      );
      if (enemyPower * 1.3 > ownPower)
        return end(
          "recover",
          "Observed interception power exceeds the supported fleet",
        );
      const ready = shooters.filter((s) =>
        structureAim(
          s,
          [building.tile],
          e.vessel(s).attack!.range,
          player.id,
          world.map.width(),
          fortifications,
        ),
      );
      if (
        ready.length === shooters.length &&
        ships.every(
          (s) =>
            world.map.euclideanDistSquared(world.tileOf(s), b.tile!) <= 6 ** 2,
        )
      ) {
        const fresh = ready.filter((s) => s.attackTargetId !== building.id);
        if (fresh.length) {
          const rejected = world.applyCommand({
            type: "naval-attack",
            playerId: player.id,
            shipIds: fresh.map((s) => s.id),
            targetId: building.id,
          });
          if (rejected) return end("recover", rejected);
        }
        b.phase = "fire";
        m.state = "execute";
        m.reason = "Supported bombardment using actual range, LOS and reload";
      } else if (b.phase === "fire") {
        economy.routes.release(m.id);
        b.phase = "position";
        b.start = world.tileOf(shooters[0]);
        b.candidate = 0;
        world.applyCommand({
          type: "stop-ships",
          playerId: player.id,
          shipIds: ships.map((s) => s.id),
        });
      }
      break;
    }
  }
  return { work: used };
}
