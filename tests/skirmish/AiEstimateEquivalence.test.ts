import { describe, expect, it } from "vitest";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { GameMapImpl, type GameMap } from "../../src/core/game/GameMap";
import { HomeTerritory } from "../../src/skirmish/HomeTerritory";
import { UNITS } from "../../src/skirmish/content/Units";
import { damageAmount, defenceOf } from "../../src/skirmish/domain/Combat";
import { formationModifiers } from "../../src/skirmish/domain/FormationTactics";
import { cohortDps, type TacticalContext } from "../../src/skirmish/domain/TacticalEstimate";
import { sustainedInterval } from "../../src/skirmish/domain/WeaponTiming";
import type { Cohort } from "../../src/skirmish/domain/AiCombatPower";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";

// Verbatim pre-optimization implementations, kept as references.
function referenceFrontier(map: GameMap, playerId: number, base: number, owners: Uint8Array, anchors: number[]) {
  const visited = new Set<number>(), owned = (t: number) => owners[t] === playerId;
  const queue = [...new Set([...(owned(base) ? [base] : []), ...anchors.filter(owned)])], frontier: number[] = [], shores: number[] = [];
  for (const tile of queue) visited.add(tile);
  visited.add(base);
  for (let at = 0; at < queue.length; at++)
    for (const tile of map.neighbors(queue[at])) {
      if (visited.has(tile)) continue;
      visited.add(tile);
      if (!map.isLand(tile)) { shores.push(queue[at]); continue; }
      if (map.isImpassable(tile)) continue;
      if (owners[tile] === playerId) queue.push(tile); else frontier.push(tile);
    }
  frontier.sort((a, b) => map.euclideanDistSquared(base, a) - map.euclideanDistSquared(base, b) || a - b);
  return { tiles: frontier, shores: [...new Set(shores)] };
}
function referenceCohortDps(own: readonly Cohort[], enemy: readonly Cohort[], context: TacticalContext = {}): number {
  const health = enemy.reduce((n, b) => n + b.health, 0);
  if (!health) return 0;
  let total = 0;
  for (const a of own) for (const b of enemy) {
    const attack = a.unit.attack;
    const targetWidth = b.width / Math.max(1, b.count);
    const contributors = attack.channel === "melee" && attack.perSoldier
      ? Math.min(a.contributors, targetWidth * a.count * (a.shape === "modern-loose" ? 1 : attack.ranks ?? 2)) : a.contributors;
    const facts = formationModifiers(b.shape, b.deployed, attack.channel, context.arc ?? "front", a.unit.tags.includes("mounted"));
    total += damageAmount(attack, { ...defenceOf(b.unit, context.cover), tacticalBp: facts.bp }, attack.perSoldier ? contributors : 1000, a.xp, 1000, undefined, context.elevationBpA ?? context.elevationBp ?? 10000)
      * (attack.perSoldier ? 1 : a.strength) * (b.health / health) * TICKS_PER_SECOND / Math.max(1, sustainedInterval(attack));
  }
  return total;
}

describe("AI estimate rewrites match their originals", () => {
  it("frontier tiles, order and shores match the reference BFS and sort", () => {
    const random = new PseudoRandom(20261019);
    const width = 61, height = 47, terrain = new Uint8Array(width * height);
    for (let i = 0; i < terrain.length; i++) terrain[i] = random.nextInt(0, 12) < 9 ? 133 : 0;
    const map = new GameMapImpl(width, height, terrain, terrain.filter(t => t).length);
    let compared = 0;
    for (let trial = 0; trial < 60; trial++) {
      const playerId = random.nextInt(1, 4), base = random.nextInt(0, width * height);
      // Mostly the player's land, so its connected region and frontier are large.
      const owners = new Uint8Array(width * height).map(() => random.nextInt(0, 10) < 7 ? playerId : random.nextInt(0, 4));
      owners[base] = playerId;
      const anchors = Array.from({ length: random.nextInt(0, 4) }, () => random.nextInt(0, width * height));
      const home = new HomeTerritory(map);
      const tiles = home.frontier(playerId, base, owners, 0, anchors);
      const expected = referenceFrontier(map, playerId, base, owners, anchors);
      expect([...tiles]).toEqual(expected.tiles);
      expect([...home.shores(playerId)]).toEqual(expected.shores);
      expect(home.sortedFrom(tiles)).toBe(base);
      compared += tiles.length;
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("cohortDps equals the per-pair defence spread for every unit pairing", () => {
    const random = new PseudoRandom(7);
    const shapes = ["line", "mass", "square", "shield-wall", "wedge", "column", "modern-loose"] as const;
    const cohort = (unit: (typeof UNITS)[number]): Cohort => ({ unit, shape: shapes[random.nextInt(0, shapes.length)],
      deployed: random.nextInt(0, 2) === 1, count: random.nextInt(1, 6), width: random.nextInt(32, 900), strength: random.nextInt(1, 1000),
      xp: [0, 250, 4000][random.nextInt(0, 3)], contributors: random.nextInt(1, 144), health: random.nextInt(1, 50000) });
    let nonZero = 0;
    for (let trial = 0; trial < 400; trial++) {
      const own = Array.from({ length: random.nextInt(1, 4) }, () => cohort(UNITS[random.nextInt(0, UNITS.length)]));
      const enemy = Array.from({ length: random.nextInt(1, 4) }, () => cohort(UNITS[random.nextInt(0, UNITS.length)]));
      const context: TacticalContext = { arc: (["front", "flank", "rear"] as const)[random.nextInt(0, 3)], cover: random.nextInt(0, 3) * 1000,
        elevationBp: [10000, 11500, 8500][random.nextInt(0, 3)] };
      const value = cohortDps(own, enemy, context);
      expect(Object.is(value, referenceCohortDps(own, enemy, context))).toBe(true);
      if (value) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(200);
  });
});
