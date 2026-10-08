import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import {
  squadRadius,
  standable,
  tilePoint,
} from "../../src/skirmish/SquadGeometry";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import { Fortifications } from "../../src/skirmish/domain/Fortifications";
import { StructureAttackPreparation } from "../../src/skirmish/domain/StructureAttackPreparation";
import { structureAim } from "../../src/skirmish/domain/StructureTargeting";

describe("resumable structure allocator reference", () => {
  it("matches the original complete filter/sort allocator with tiny slices and restores", () => {
    const terrain = new Uint8Array(28 * 20).fill(133),
      map = new GameMapImpl(28, 20, terrain, terrain.length),
      paths = new LandPaths(map);
    for (let fixture = 0; fixture < 32; fixture++) {
      const forts = new Fortifications(map, new Diplomacy());
      const target =
        fixture % 2
          ? [map.ref(13, 10)]
          : [9, 10, 11, 12, 13].map((x) => map.ref(x, 10));
      forts.addBarrier({
        id: 1,
        a: 1,
        b: 2,
        age: "StoneAge",
        playerId: 2,
        tiles: target,
        health: 100,
        maxHealth: 100,
        remainingTicks: 0,
      });
      if (fixture % 3 === 0)
        forts.addBarrier({
          id: 2,
          a: 3,
          b: 4,
          age: "StoneAge",
          playerId: 2,
          tiles: [7, 8, 9, 10, 11, 12].map((y) => map.ref(11, y)),
          health: 100,
          maxHealth: 100,
          remainingTicks: 0,
        });
      const members = Array.from({ length: 6 }, (_, id) => ({
        id,
        kind: (["infantry", "archer", "cavalry"] as Squad["kind"][])[id % 3],
        range: (1 + (id % 3)) * FIXED,
        origin: tilePoint(
          map,
          map.ref(((fixture + id * 3) % 26) + 1, ((fixture * 2 + id) % 18) + 1),
        ),
      }));
      const expected = new Map<number, { x: number; y: number }>(),
        sides = [0, 0, 0, 0],
        centre = tilePoint(map, target[Math.floor(target.length / 2)]);
      const side = (p: { x: number; y: number }) =>
        Math.min(
          3,
          Math.floor(
            ((Math.atan2(p.y - centre.y, p.x - centre.x) + Math.PI) * 2) /
              Math.PI,
          ),
        );
      for (const member of members) {
        if (
          structureAim(
            member.origin,
            target,
            member.range,
            1,
            map.width(),
            forts,
          )
        ) {
          expected.set(member.id, member.origin);
          sides[side(member.origin)]++;
          continue;
        }
        const candidates = new Set<number>(),
          extent = Math.ceil(member.range / FIXED);
        for (const t of target)
          for (
            let y = Math.max(0, map.y(t) - extent);
            y <= Math.min(map.height() - 1, map.y(t) + extent);
            y++
          )
            for (
              let x = Math.max(0, map.x(t) - extent);
              x <= Math.min(map.width() - 1, map.x(t) + extent);
              x++
            ) {
              const tile = map.ref(x, y),
                point = tilePoint(map, tile);
              if (
                paths.walkable(tile) &&
                !forts.blocked(tile, 1) &&
                standable(map, point, squadRadius(member.kind)) &&
                structureAim(point, target, member.range, 1, map.width(), forts)
              )
                candidates.add(tile);
            }
        const origin = map.ref(
          Math.floor(member.origin.x / FIXED),
          Math.floor(member.origin.y / FIXED),
        );
        const choices = [...candidates]
          .filter((tile) => paths.connected(origin, tile))
          .sort(
            (a, b) =>
              sides[side(tilePoint(map, a))] - sides[side(tilePoint(map, b))] ||
              map.euclideanDistSquared(a, origin) -
                map.euclideanDistSquared(b, origin) ||
              a - b,
          );
        if (!choices.length) break;
        const point = tilePoint(map, choices[0]);
        expected.set(member.id, point);
        sides[side(point)]++;
      }
      let state = StructureAttackPreparation.create(1, members, {
        barrierId: 1,
      });
      const before = structuredClone(state);
      expect(
        new StructureAttackPreparation(map, paths, forts, target, state).step(
          0,
        ),
      ).toBe(0);
      expect(state).toEqual(before);
      for (
        let slice = 0;
        slice < 100000 && state.stage !== "done" && state.stage !== "failed";
        slice++
      ) {
        const budget = [1, 7, 16][slice % 3],
          oldWork = state.consumed;
        const work = new StructureAttackPreparation(
          map,
          paths,
          forts,
          target,
          state,
        ).step(budget);
        expect(work).toBeLessThanOrEqual(budget);
        expect(state.consumed - oldWork).toBe(work);
        if (slice % 23 === 0) state = structuredClone(state);
      }
      expect(state.stage).toBe(
        expected.size === members.length ? "done" : "failed",
      );
      expect(state.points).toEqual(expected);
    }
  });
});
