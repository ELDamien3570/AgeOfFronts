import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TroopChoreography } from "../../src/skirmish/client/troops/TroopChoreography";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { UNIT } from "../../src/skirmish/content/Units";
import { CONTACT } from '../../src/skirmish/content/TacticalRules';
import {
  certifyFootprint,
  convexHull,
  contactParticipants,
  formationApproach,
  formationContact,
  formationFootprint,
} from "../../src/skirmish/domain/FormationContact";
import {
  createFormation,
  facingOf,
  formationEnvelope,
  formationDoctrine,
  formationSlots,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import {
  createManpower,
  remainingHealth,
} from "../../src/skirmish/domain/Manpower";
import { polygonSweepEntry } from "../../src/skirmish/domain/ProjectileCollision";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function match(id = "bronzeage-infantry") {
  const terrain = new Uint8Array(64 * 64).fill(133),
    map = new GameMapImpl(64, 64, terrain, terrain.length);
  const options = {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1" as const,
  };
  const game = new Skirmish(map, options),
    a = game.squads.find((s) => s.playerId === 1)!,
    b = game.squads.find((s) => s.playerId === 2)!;
  for (const s of [...game.squads])
    if (s.id !== a.id && s.id !== b.id) game.removeSquad(s.id);
  const u = UNIT.get(id)!;
  for (const [s, y, facing] of [
    [a, 24, 0],
    [b, 28, TURN / 2],
  ] as const)
    game.updateSquad(s.id, {
      definitionId: id,
      kind: u.line,
      troops: u.formationRecipe!.capacity,
      manpower: createManpower(u),
      formation: {
        ...createFormation(id),
        facing,
        layoutTroops: u.formationRecipe!.capacity,
      },
      order: { type: "hold" },
      x: 24 * FIXED,
      y: y * FIXED,
    });
  return {
    game,
    a: game.squad(a.id)!,
    b: game.squad(b.id)!,
    terrain,
    map,
    options,
    u,
  };
}
describe("formation boundary engagement", () => {
  it("retains the exact soldier-corner hull for singleton, partial and full bodies", () => {
    const { a } = match("earlymedieval-heavycavalry");
    for (const troops of [1, 2, 11, 40, 144]) {
      for (const shape of ["mass", "wedge", "line", "square"] as const) {
        const body = { ...a, troops, formation: { ...a.formation!, shape, facing: TURN / 8 } };
        const doctrine = formationDoctrine(body.definitionId);
        const local = convexHull(formationSlots(body, 0).flatMap(p =>
          [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: p.x + x * doctrine.bodyWidth / 2, y: p.y + y * doctrine.bodyDepth / 2 })))))
        const angle = formationEnvelope(body, 0).angle, c = Math.cos(angle), sin = Math.sin(angle);
        const reference = local.map(p => ({ x: body.x + p.x * c - p.y * sin, y: body.y + p.x * sin + p.y * c }));
        expect(formationFootprint(body, 0)).toEqual(reference);
      }
    }
  });
  it("stops wide, rotated, column and wedge bodies at weapon reach rather than centre reach", () => {
    const f = match("earlymedieval-heavycavalry");
    for (const shape of ["mass", "column", "wedge"] as const)
      for (const facing of [0, TURN / 8, TURN / 4]) {
        const a = {
          ...f.a,
          formation: {
            ...f.a.formation!,
            shape,
            mode:
              shape === "column" ? ("travel" as const) : ("deployed" as const),
            facing,
          },
        };
        const p = formationApproach(a, f.b, 0, FIXED / 4);
        const contact = formationContact({ ...a, ...p }, f.b, 0);
        expect(contact.gap).toBeLessThanOrEqual(FIXED / 4 + 2);
        expect(contact.gap).toBeGreaterThan(FIXED / 4 - 4);
        expect(Math.hypot(p.x - f.b.x, p.y - f.b.y)).toBeGreaterThan(FIXED / 4);
      }
  });
  it("does not turn a wedge's empty bounding-box corners into contact", () => {
    const f = match("earlymedieval-heavycavalry"),
      a = {
        ...f.a,
        charge: null,
        formation: { ...f.a.formation!, shape: "wedge" as const },
      },
      e = formationEnvelope(a, 0);
    const point = {
      ...f.b,
      troops: 1,
      x: a.x + e.width / 2 + 8,
      y: a.y + e.depth / 2 + 8,
    };
    expect(formationContact(a, point, 0).gap).toBeGreaterThan(8);
  });
  it("uses the current interpolated body, not destination frontage or empty endpoint union", () => {
    const f = match(),
      a = {
        ...f.a,
        formation: {
          ...f.a.formation!,
          shape: "shield-wall" as const,
          transition: {
            from: "mass" as const,
            fromFacing: 0,
            startTick: 0,
            duration: 40,
            fromSlots: formationSlots(f.a, 0),
          },
        },
      };
    const start = formationEnvelope(a, 0),
      mid = formationEnvelope(a, 20),
      end = formationEnvelope(a, 40);
    expect(mid.width).toBeGreaterThan(start.width);
    expect(mid.width).toBeLessThan(end.width);
    const point = {
      ...f.b,
      troops: 1,
      x: a.x + end.width / 2 + FIXED / 2,
      y: a.y,
    };
    expect(formationContact(a, point, 0).gap).toBeGreaterThan(
      formationContact(a, point, 40).gap,
    );
  });
  it("fires melee at credible boundaries outside centre reach and records actual paired anchors", () => {
    const f = match(),
      reach = f.u.attack.range,
      p = formationApproach(f.b, f.a, 0, reach);
    f.game.updateSquad(f.b.id, p);
    expect(Math.hypot(f.a.x - f.b.x, f.a.y - f.b.y)).toBeGreaterThan(reach);
    const before = remainingHealth(f.b),
      contact = formationContact(f.a, f.b, 0);
    f.game.expansion!.battle.fight([]);
    expect(remainingHealth(f.b)).toBeLessThan(before);
    const hit = f.game.volleys.find((v) => v.squadId === f.a.id && v.melee)!;
    expect(hit.targetId).toBe(f.b.id);
    expect(hit.fromX).toBe(Math.round(contact.source.x));
    expect(hit.toY).toBe(Math.round(contact.target.y));
  });
  it("refuses attacks across a wall even when boundary reach would allow them", () => {
    const f = match();
    f.game.updateSquad(f.b.id, { y: f.a.y + 2 * FIXED });
    const forts = f.game.expansion!.fortifications;
    forts.addBarrier({
      id: 900,
      playerId: 2,
      age: "BronzeAge",
      a: 800,
      b: 801,
      tiles: Array.from({ length: 10 }, (_, i) => f.map.ref(20 + i, 25)),
      health: 2000,
      maxHealth: 2000,
      remainingTicks: 0,
    });
    const before = remainingHealth(f.b);
    f.game.expansion!.battle.fight([]);
    expect(remainingHealth(f.b)).toBe(before);
    expect(f.game.volleys).toHaveLength(0);
  });
  it("frontage follows actual shape and facing without independent soldier attacks", () => {
    const f = match(),
      front = { ...f.b, y: f.a.y + FIXED };
    expect(contactParticipants(f.a, front, 0, 2)).toBeGreaterThan(0);
    expect(
      contactParticipants(
        { ...f.a, formation: { ...f.a.formation!, facing: TURN / 2 } },
        front,
        0,
        2,
      ),
    ).toBe(0);
    expect(
      contactParticipants(
        {
          ...f.a,
          formation: { ...f.a.formation!, shape: "column", mode: "travel" },
        },
        front,
        0,
        2,
      ),
    ).toBeLessThanOrEqual(8);
  });
  it("resolves a charge only at the current body's legal contact and keeps recovery state", () => {
    const f = match("earlymedieval-heavycavalry"),
      charge = {
        phase: "committed" as const,
        x: f.b.x,
        y: f.b.y,
        startTick: 0,
        committedTick: 0,
        targetId: f.b.id,
      };
    f.game.updateSquad(f.a.id, { charge });
    f.game.updateSquad(
      f.b.id,
      formationApproach(f.b, f.a, 0, f.u.meleeAttack!.range),
    );
    const before = remainingHealth(f.b);
    // Cavalry now need close contact, rather than the old weapon-reach gap.
    f.game.expansion!.battle.fight([]);
    expect(remainingHealth(f.b)).toBe(before);
    expect(f.a.charge!.phase).toBe('committed');
    f.game.updateSquad(f.b.id,formationApproach(f.b,f.a,0,CONTACT.enter));
    f.game.expansion!.battle.fight([]);
    expect(remainingHealth(f.b)).toBeLessThan(before);
    expect(f.a.charge!.phase).toBe("recovery");
    expect(
      f.game.volleys.some(
        (v) => v.squadId === f.a.id && v.targetId === f.b.id && v.melee,
      ),
    ).toBe(true);
  });
  it("does not grant an instant wedge or recovery footprint when charge state changes", () => {
    const f = match("earlymedieval-heavycavalry"),
      before = formationFootprint(f.a, 0);
    f.game.updateSquad(f.a.id, {
      charge: {
        phase: "approach",
        x: f.b.x,
        y: f.b.y,
        startTick: 0,
        committedTick: 0,
        targetId: f.b.id,
      },
    });
    expect(formationFootprint(f.a, 0)).toEqual(before);
    const duration = f.a.formation!.transition!.duration;
    const wedge = formationFootprint(f.a, duration);
    expect(wedge).not.toEqual(before);
    f.game.tick = duration;
    f.game.updateSquad(f.a.id, {
      charge: { ...f.a.charge!, phase: "recovery" },
    });
    expect(formationFootprint(f.a, duration)).toEqual(wedge);
  });
  it("sweeps projectiles into a wide body's edge while missing its empty wedge corner", () => {
    const f = match(),
      poly = formationFootprint(f.a, 0);
    const from = { x: f.a.x - 8 * FIXED, y: f.a.y },
      to = { x: f.a.x + 8 * FIXED, y: f.a.y };
    const t = polygonSweepEntry(from, to, poly)!;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.5);
    expect(
      polygonSweepEntry(
        { x: f.a.x, y: f.a.y - 8 * FIXED },
        { x: f.a.x + 8 * FIXED, y: f.a.y - 8 * FIXED },
        poly,
      ),
    ).toBeNull();
  });
});
describe("legal reform and casualty geometry", () => {
  it.each([TURN/4,TURN/2])("approaches from sideways/backward headings and fights through contacted edges (%i)",facing=>{
    const f=match();
    f.game.updateSquad(f.a.id,{formation:{...f.a.formation!,facing},weaponState:{sharedReadyTick:9000}});
    f.game.updateSquad(f.b.id,{formation:{...f.b.formation!,facing:0},weaponState:{sharedReadyTick:9000}});
    expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[f.a.id],order:{type:"attack",targetId:f.b.id}})).toBeNull();
    for(let tick=0;tick<180;tick++)f.game.step();
    expect(contactParticipants(f.a,f.b,f.game.tick,2,formationContact(f.a,f.b,f.game.tick),true)).toBeGreaterThan(0);
    expect(contactParticipants(f.b,f.a,f.game.tick,2,formationContact(f.b,f.a,f.game.tick),true)).toBeGreaterThan(0);
    expect(f.a.combatTargetId).toBe(f.b.id);
    expect(f.b.combatTargetId).toBe(f.a.id);
    expect(formationContact(f.a,f.b,f.game.tick).gap).toBeLessThan(FIXED*.1);
  });
  it("sustains melee contact through casualties without repeated reforms or distant damage",()=>{
    const f=match();
    expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[f.a.id],order:{type:"attack",targetId:f.b.id}})).toBeNull();
    expect(f.game.applyCommand({type:"order",playerId:2,squadIds:[f.b.id],order:{type:"attack",targetId:f.a.id}})).toBeNull();
    let contacts=0,losses=0,damageSteps=0,apartTicks=0,longestApart=0;
    const resolve=f.game.resolveLandDamage.bind(f.game);
    f.game.resolveLandDamage=ledger=>{
      if(ledger.damage(f.a.id)>0 || ledger.damage(f.b.id)>0){
        damageSteps++;
        expect(formationContact(f.a,f.b,f.game.tick).gap).toBeLessThanOrEqual(f.u.attack.range+32+2);
      }
      resolve(ledger);
    };
    for(let tick=0;tick<1000 && f.game.squad(f.a.id) && f.game.squad(f.b.id);tick++){
      const before=f.a.troops+f.b.troops;
      f.game.step();
      if(f.a.fighting || f.b.fighting){
        contacts++;
        apartTicks=formationContact(f.a,f.b,f.game.tick).gap>FIXED*.1?apartTicks+1:0;
        longestApart=Math.max(longestApart,apartTicks);
      }else apartTicks=0;
      losses+=before-f.a.troops-f.b.troops;
      expect(f.a.formation!.transition).toBeUndefined();
      expect(f.b.formation!.transition).toBeUndefined();
    }
    expect(contacts).toBeGreaterThan(100);
    expect(losses).toBeGreaterThan(2);
    expect(damageSteps).toBeGreaterThan(2);
    expect(longestApart).toBeLessThan(25);
  },20000);
  it("bounds geometry work by purchased capacity even in oversized combat fixtures", () => {
    const f = match();
    expect(formationSlots({ ...f.a, troops: 100000 }, 0)).toHaveLength(
      f.a.manpower!.capacity,
    );
  });
  it("certifies every occupied terrain cell, including interior blockers", () => {
    const f = match(),
      poly = formationFootprint(f.a, 0),
      blocked = f.map.ref(24, 24);
    expect(certifyFootprint(f.map, poly, () => false)).toBe(true);
    expect(certifyFootprint(f.map, poly, (t) => t === blocked)).toBe(false);
    expect(
      certifyFootprint(
        f.map,
        poly.map((p) => ({ x: p.x - 24 * FIXED, y: p.y })),
        () => false,
      ),
    ).toBe(false);
  });
  it("resizes casualties without tactical reform, preserves weapons and restores geometry", () => {
    const f = match();
    f.game.updateSquad(f.a.id, {
      weaponState: {
        sharedReadyTick: 100,
        ranged: {
          nextTick: 120,
          shots: 2,
          remainder: 17,
          reloadStartedTick: 1,
        },
      },
    });
    const sourceWidth = formationEnvelope(f.a, 0).width,
      ledger = new DamageLedger();
    ledger.add(f.a.id, 2, remainingHealth(f.a) / 1000 / 2);
    f.game.resolveLandDamage(ledger);
    expect(f.a.troops).toBe(12);
    expect(f.a.formation!.transition).toBeUndefined();
    expect(formationSlots(f.a, 0)).toHaveLength(12);
    const end = 20;
    expect(formationEnvelope(f.a, end).width).toBeLessThan(sourceWidth);
    const restored = new Skirmish(
      new GameMapImpl(64, 64, f.terrain, f.terrain.length),
      f.options,
    );
    restored.restore(f.game.checkpoint());
    expect(() =>
      restored.restore({ ...f.game.checkpoint(), version: 4 } as any),
    ).toThrow();
    const malformed = structuredClone(f.game.checkpoint());
    const invalid = malformed.squads.find((s) => s.id === f.a.id)!;
    const rejected = {
      ...malformed,
      squads: malformed.squads.map((s) =>
        s.id === invalid.id
          ? {
              ...s,
              formation: {
                ...s.formation!,
                transition: {
                  from:s.formation!.shape,fromFacing:s.formation!.facing,startTick:0,duration:20,
                  fromSlots: Array.from({ length: 145 }, () => ({
                    x: 0,
                    y: 0,
                    row: 0,
                  })),
                },
              },
            }
          : s,
      ),
    };
    expect(() => restored.restore(rejected)).toThrow(
      "Invalid formation transition slots",
    );
    const decoded = new SnapshotDecoder()
      .decode(new SnapshotEncoder().encode(f.game.snapshot()))
      .squads.find((s) => s.id === f.a.id)!;
    for (const tick of [0, 10, end]) {
      expect(formationFootprint(restored.squad(f.a.id)!, tick)).toEqual(
        formationFootprint(f.a, tick),
      );
      expect(formationSlots(decoded, tick)).toEqual(formationSlots(f.a, tick));
    }
    expect(f.a.weaponState!.ranged!.nextTick).toBe(120);
  });
  it("keeps the incomplete rank at the rear of grid formations", () => {
    const f = match();
    for (const troops of [7, 11, 13]) {
      const slots = formationSlots(
        { ...f.a, troops, formation: { ...f.a.formation!, shape: "line" } },
        0,
      );
      const rows = new Map<number, number>();
      for (const p of slots) rows.set(p.y, (rows.get(p.y) ?? 0) + 1);
      const ys = [...rows.keys()].sort((a, b) => a - b);
      expect(rows.get(ys[ys.length - 1])).toBeGreaterThanOrEqual(rows.get(ys[0])!);
    }
  });
  it("makes displayed count match casualties, losing the front and keeping survivors seated", () => {
    const f = match(),
      slots = formationSlots(f.a, 0).map((p) => ({ ...p, scale: 1 })),
      motion = new TroopChoreography(slots, 0, 0);
    const ids = new Set(motion.formationSoldiers(0).map((p) => p.id));
    const frontY = Math.max(...slots.map((s) => s.y));
    motion.advanceAuthoritative(100, 12);
    const survivors = motion.formationSoldiers(100);
    expect(survivors).toHaveLength(12);
    expect(survivors.every((p) => ids.has(p.id))).toBe(true);
    expect(motion.dead(100)).toHaveLength(slots.length - 12);
    expect(motion.dead(100).some((c) => c.y === frontY)).toBe(true);
    motion.advanceAuthoritative(200, 15);
    expect(motion.formationSoldiers(200)).toHaveLength(15);
  });
});
