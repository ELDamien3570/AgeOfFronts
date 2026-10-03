import { retainSquads } from "./UnitFixtures";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Formations, formationRingPoint } from "../../src/skirmish/Formations";
import { FormationPlanning } from "../../src/skirmish/FormationPlanning";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  distanceSquared,
  FORMATION_SPACING,
  meleeContact,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
  traversable,
} from "../../src/skirmish/SquadGeometry";

function create(narrow = false) {
  const data = new Uint8Array(80 * 50).fill(133);
  if (narrow) for (let y = 0; y < 50; y++) if (y !== 25) data[y * 80 + 40] = 0;
  const map = new GameMapImpl(80, 50, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false });
  const own = match.squads.filter((s) => s.playerId === 1);
  own.forEach((s, i) => place(match, s, 10 + (i % 2) * 2, 22 + Math.floor(i / 2) * 2));
  match.squads
    .filter((s) => s.playerId === 2)
    .forEach((s, i) => place(match, s, 72, 4 + i * 2));
  return { match, map, own };
}
function reverseStorage(scenario: ReturnType<typeof create>): void {
  const saved = scenario.match.checkpoint();
  saved.squads = [...saved.squads].reverse();
  scenario.match.restore(saved);
  scenario.own = scenario.own.map(squad => scenario.match.squad(squad.id)!);
}
it("enumerates only formation perimeter cells in the original deterministic tie order", () => {
  for (let ring=0;ring<=25;ring++) {
    const expected=[];
    for(let y=8-ring;y<=8+ring;y++)for(let x=12-ring;x<=12+ring;x++)
      if(!ring || Math.max(Math.abs(x-12),Math.abs(y-8))===ring)expected.push({x,y});
    expect(Array.from({length:ring?8*ring:1},(_,at)=>formationRingPoint(12,8,ring,at))).toEqual(expected);
  }
});
function place(world: Skirmish, s: Squad, x: number, y: number) {
  world.updateSquad(s.id, { x: (x + 0.5) * FIXED });
  world.updateSquad(s.id, { y: (y + 0.5) * FIXED });
}
function move(
  match: Skirmish,
  units: Squad[],
  x: number,
  y: number,
  append = false,
) {
  expect(
    match.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: units.map((s) => s.id),
      order: { type: "move", tile: match.map.ref(x, y) },
      append,
    }),
  ).toBeNull();
}
function separated(match: Skirmish) {
  const units = match.squads.filter((s) => s.embarkedOn === null);
  for (let i = 0; i < units.length; i++) {
    expect(standable(match.map, units[i], squadRadius(units[i].kind))).toBe(
      true,
    );
    for (let j = i + 1; j < units.length; j++)
      expect(distanceSquared(units[i], units[j])).toBeGreaterThanOrEqual(
        squadSeparation(units[i], units[j]) ** 2,
      );
  }
}
function run(match: Skirmish, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    match.step();
    separated(match);
  }
}

describe("compact formations and local avoidance", () => {
  it("resumes formation clearance and fallback with the same slots as synchronous planning", () => {
    for (const narrow of [false, true]) {
      const { match, map, own } = create(narrow), paths = new LandPaths(map, false),
        members = own.map(squad => ({ squad, origin: { x: squad.x, y: squad.y } })),
        center = map.ref(narrow ? 40 : 65, 25),
        expected = new Formations(map, paths).plan(center, members, match.squads),
        job = new FormationPlanning(map, paths, center, members, () => match.squads);
      let restored: FormationPlanning | undefined;
      for (let slices = 0; job.state.phase !== "done" && job.state.phase !== "failed"; slices++) {
        expect(slices).toBeLessThan(10000);
        const used = job.step(7);
        expect(used).toBeLessThanOrEqual(7);
        if (restored) expect(restored.step(7)).toBe(used);
        else if (slices === 9) restored = new FormationPlanning(map, paths, center, [], () => match.squads, Infinity, undefined, job.checkpoint());
      }
      expect(job.state.phase === "failed" ? null : job.state.result).toEqual(expected);
      expect(restored?.state).toEqual(job.state);
    }
  });
  it("passes through compact friendly rows while the same enemy rows block passage", () => {
    const scenario = (friendly: boolean) => {
      const data = new Uint8Array(80 * 50);
      for (let y = 20; y <= 22; y++) data.fill(133, y * 80, (y + 1) * 80);
      const match = new Skirmish(new GameMapImpl(80, 50, data, 80 * 3), {
        seed: 42,
        aiCount: 0,
        humanNames: ["You", "Opponent"],
        humanSpawns: [{ playerId: 1, tile: 21 * 80 + 8 }, { playerId: 2, tile: 21 * 80 + 70 }],
        runAi: false,
      });
      const [mover, a, b] = match.squads;
      retainSquads(match, [mover, a, b]);
      match.updateSquad(mover.id, { playerId: 1 });
      for (const unit of [mover, a, b]) match.updateSquad(unit.id, { kind: "infantry" });
      match.updateSquad(mover.id, { x: 10.5 * FIXED });
      match.updateSquad(mover.id, { y: 21.5 * FIXED });
      match.updateSquad(a.id, { x: 30.5 * FIXED });
      match.updateSquad(b.id, { x: 30.5 * FIXED });
      match.updateSquad(a.id, { y: 20.75 * FIXED });
      match.updateSquad(b.id, { y: 22.25 * FIXED });
      match.updateSquad(a.id, { playerId: friendly ? 1 : 2 });
      match.updateSquad(b.id, { playerId: friendly ? 1 : 2 });
      const held = [a.x, a.y, b.x, b.y];
      move(match, [mover], 50, 21);
      for (let tick = 0; tick < 200; tick++) {
        for (const unit of match.squads) match.updateSquad(unit.id, { troops: 1000 });
        match.step();
        separated(match);
      }
      expect([a.x, a.y, b.x, b.y]).toEqual(held);
      return { mover, a, b };
    };
    expect(FORMATION_SPACING / FIXED).toBe(1.5);
    const friendly = scenario(true),
      enemy = scenario(false);
    expect(friendly.mover.order.type).toBe("hold");
    expect(friendly.mover.x).toBe(50.5 * FIXED);
    expect(enemy.mover.x).toBeLessThan(enemy.a.x);
    expect(squadSeparation(friendly.mover, friendly.a)).toBeLessThan(
      squadSeparation(enemy.mover, enemy.a),
    );
    expect(squadSeparation(enemy.a, enemy.mover)).toBe(
      squadSeparation(enemy.mover, enemy.a),
    );
    expect(meleeContact("infantry", "infantry")).toBeLessThan(
      FORMATION_SPACING,
    );
    expect(meleeContact("infantry", "infantry")).toBeGreaterThan(
      squadSeparation(enemy.mover, enemy.a),
    );
  });
  it("moves the full current sixteen-squad army through a narrow opening", () => {
    const { match, own } = create(true);
    match.players[0].reserves = 20000;
    for (let i = 0; i < 12; i++)
      expect(
        match.applyCommand({
          type: "recruit",
          playerId: 1,
          buildingId: match.buildings[0].id,
        }),
      ).toBeNull();
    const army = match.squads.filter((s) => s.playerId === 1);
    army.forEach((s, i) =>
      place(match, s, 14 + (i % 4) * 2, 21 + Math.floor(i / 4) * 2),
    );
    match.updateSquad(own[1].id, { kind: "archer" });
    match.updateSquad(own[2].id, { kind: "cavalry" });
    move(match, army, 60, 25);
    run(match, 900);
    expect(army.every((s) => s.order.type === "hold")).toBe(true);
  });
  it("rejects a swept corner crossing even when both endpoints fit on land", () => {
    const data = new Uint8Array(5 * 5).fill(133);
    data[2 * 5 + 2] = 0;
    const map = new GameMapImpl(5, 5, data, 24),
      radius = squadRadius("infantry");
    const a = { x: 1.5 * FIXED, y: 2.5 * FIXED },
      b = { x: 2.5 * FIXED, y: 1.5 * FIXED };
    expect(standable(map, a, radius)).toBe(true);
    expect(standable(map, b, radius)).toBe(true);
    expect(traversable(map, a, b, radius)).toBe(false);
  });
  it("selects the nearest enemy with a stable ID tie across grid buckets", () => {
    const a = create(),
      b = create();
    for (const scenario of [a, b]) {
      const shooter = scenario.own[0],
        enemies = scenario.match.squads.filter((s) => s.playerId === 2);
      place(scenario.match, shooter, 40, 20);
      scenario.match.updateSquad(shooter.id, { kind: "archer" });
      place(scenario.match, enemies[0], 35, 20);
      place(scenario.match, enemies[1], 45, 20);
    }
    reverseStorage(b);
    a.match.step();
    b.match.step();
    const expected = Math.min(
      ...a.match.squads
        .filter((s) => s.playerId === 2)
        .slice(0, 2)
        .map((s) => s.id),
    );
    expect(a.own[0].combatTargetId).toBe(expected);
    expect(b.own[0].combatTargetId).toBe(expected);
  });
  it("allocates compact distinct slots independently of selection order", () => {
    const { match, map, own } = create();
    const planner = new Formations(map, match.paths);
    const members = own.map((squad) => ({ squad, origin: squad }));
    const a = planner.plan(map.ref(60, 25), members, match.squads)!;
    const b = planner.plan(
      map.ref(60, 25),
      [...members].reverse(),
      match.squads,
    )!;
    expect([...a]).toEqual([...b]);
    expect(new Set([...a.values()].map((p) => `${p.x},${p.y}`)).size).toBe(4);
    expect(
      Math.max(
        ...[...a.values()].map((p) =>
          Math.sqrt(distanceSquared(p, tilePoint(map, map.ref(60, 25)))),
        ),
      ),
    ).toBeLessThan(2 * FIXED);
  });
  it("reaches every formation slot without overlaps, including queued destinations", () => {
    const { match, own } = create();
    move(match, own, 40, 25);
    move(match, own, 60, 30, true);
    const ends = own.map((s) => ({ ...s.queuedOrders[0] }));
    run(match, 500);
    for (let i = 0; i < own.length; i++) {
      expect(own[i].order.type).toBe("hold");
      const end = ends[i];
      if (end.type !== "move") throw new Error("missing move");
      expect([own[i].x, own[i].y]).toEqual([
        end.x ?? tilePoint(match.map, end.tile).x,
        end.y ?? tilePoint(match.map, end.tile).y,
      ]);
    }
  });
  it("passes around a held friendly squad without moving it", () => {
    const { match, own } = create();
    const mover = own[0],
      blocker = own[1];
    place(match, mover, 10, 20);
    place(match, blocker, 20, 20);
    const fixed = [blocker.x, blocker.y];
    move(match, [mover], 30, 20);
    run(match, 250);
    expect(mover.order.type).toBe("hold");
    expect([blocker.x, blocker.y]).toEqual(fixed);
    expect([mover.x, mover.y]).toEqual([30.5 * FIXED, 20.5 * FIXED]);
  });
  it("lets friendly opposing traffic pass rather than stack", () => {
    const { match, own } = create();
    place(match, own[0], 15, 15);
    place(match, own[1], 35, 15);
    move(match, [own[0]], 35, 15);
    move(match, [own[1]], 15, 15);
    run(match, 300);
    expect(own.slice(0, 2).map((s) => s.order.type)).toEqual(["hold", "hold"]);
    expect(own[0].x).toBeGreaterThan(own[1].x);
  });
  it("files through a one-cell opening and reforms on the other side", () => {
    const { match, own } = create(true);
    move(match, own, 60, 25);
    run(match, 650);
    expect(own.map((s) => s.order.type)).toEqual([
      "hold",
      "hold",
      "hold",
      "hold",
    ]);
    expect(own.every((s) => s.x > 58 * FIXED)).toBe(true);
  });
  it("advances melee attack orders to physical contact while archers keep their range", () => {
    const { match, own } = create();
    const attacker = own[0],
      enemy = match.squads.find((s) => s.playerId === 2)!;
    place(match, attacker, 30, 20);
    place(match, enemy, 35, 20);
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [attacker.id],
        order: { type: "attack", targetId: enemy.id },
      }),
    ).toBeNull();
    run(match, 25);
    expect(Math.sqrt(distanceSquared(attacker, enemy))).toBeLessThanOrEqual(
      meleeContact(attacker.kind, enemy.kind) + 1,
    );
    expect(attacker.combatTargetId).toBe(enemy.id);
  });
  it("does not cut a blocked diagonal corner", () => {
    const data = new Uint8Array(5 * 5).fill(133);
    data[1] = 0;
    data[5] = 0;
    const map = new GameMapImpl(5, 5, data, 23),
      paths = new LandPaths(map);
    expect(paths.find(map.ref(0, 0), map.ref(1, 1))).toBeNull();
  });
  it("replays identically even when storage and selection arrays are reversed", () => {
    const a = create(),
      b = create();
    reverseStorage(b);
    b.own.reverse();
    move(a.match, a.own, 40, 25);
    move(b.match, b.own, 40, 25);
    for (let i = 0; i < 200; i++) {
      a.match.step();
      b.match.step();
    }
    const positions = (m: Skirmish) =>
      [...m.squads]
        .sort((x, y) => x.id - y.id)
        .map((s) => [s.id, s.x, s.y, s.order]);
    expect(positions(a.match)).toEqual(positions(b.match));
  });
});
