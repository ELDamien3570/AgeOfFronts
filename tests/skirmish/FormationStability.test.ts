import { describe, expect, it } from "vitest";
import { AttackApproaches } from "../../src/skirmish/AttackApproaches";
import {
  formationLocomotion,
  headingDifference,
} from "../../src/skirmish/FormationLocomotion";
import { FIXED } from "../../src/skirmish/Protocol";
import { FormationAngleSamples } from "../../src/skirmish/client/FormationAngleSamples";
import {
  CONTACT,
  MOTION,
  TERRAIN,
} from "../../src/skirmish/content/TacticalRules";
import { UNIT } from "../../src/skirmish/content/Units";
import { columnDecision } from "../../src/skirmish/domain/ColumnTravel";
import {
  certifyFootprint,
  formationApproach,
  formationContact,
} from "../../src/skirmish/domain/FormationContact";
import {
  createFormation,
  formationSlots,
  formationEnvelope,
  TURN,
  validateFormation,
} from "../../src/skirmish/domain/FormationGeometry";
import { transportScene } from "./fixtures/TacticalScenes";
function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}
describe("formation movement stability and shoreline policy", () => {
  it("keeps deployed battle poses stable and lets a travel column unfold once",()=>{
    const f=transportScene(72,false);
    for(const shape of ["line","column"] as const){
      const s={...f.s,fighting:true,combatTargetId:999,formation:{...f.s.formation!,shape,automatic:shape==='column',autoFrontage:shape==='line',deployedShape:"line" as const}};
      for(let tick=0;tick<300;tick++)expect(columnDecision(s,tick,true,{complete:true,winding:true})).toBe(shape==='column'?"deploy":"keep");
    }
  });
  it("preserves occupied ground while reversing a deployed formation", () => {
    const f = transportScene(72, false);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...createFormation(f.s.definitionId),
        shape: "line",
        facing: 0,
      },
      order: { type: "hold", facing: Math.PI },
    });
    const points=()=>{const angle=formationEnvelope(f.s,f.game.tick).angle;return formationSlots(f.s,f.game.tick).map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));};
    let previous=points();
    for (let i = 0; i < 30; i++) {
      f.game.step();
      const next=points();
      // The basis may reverse immediately; occupied positions may only reseat
      // locally at the authored reform speed, rather than orbit the centre.
      for(const p of previous)expect(Math.min(...next.map(q=>Math.hypot(p.x-q.x,p.y-q.y)))).toBeLessThanOrEqual(FIXED*2.5/20+2);
      previous=next;
    }
    expect(
      Math.abs(
        headingDifference(0, (f.s.formation!.facing * 2 * Math.PI) / TURN),
      ),
    ).toBeGreaterThan(0);
    expect(
      Math.abs(
        headingDifference(0, (f.s.formation!.facing * 2 * Math.PI) / TURN),
      ),
    ).toBeCloseTo(Math.PI);
  });
  it("keeps arrival facing stable while correcting a tiny overshoot", () => {
    const f = transportScene(12, false),
      s = {
        ...f.s,
        locomotion: { heading: 0, targetHeading: 0, speed: 0 },
        order: { type: "move" as const, tile: 0 },
      };
    const result = formationLocomotion(
      s,
      { squad: s, goal: { x: s.x, y: s.y - 8 }, speed: 24 },
      24,
      true,
      true,
    );
    expect(result.motion.heading).toBe(0);
    expect(
      Math.hypot(
        result.intent.preferredVelocity!.x,
        result.intent.preferredVelocity!.y,
      ),
    ).toBeLessThanOrEqual(8);
  });
  it("tolerates the intended shore margin and rejects deeper and fully submerged thin bodies", () => {
    const f = transportScene();
    const small = rect(79.5 * FIXED, 64 * FIXED, 0.9 * FIXED, 0.5 * FIXED);
    expect(
      certifyFootprint(f.map, small, () => false, false, TERRAIN.softDeploy),
    ).toBe(true);
    expect(
      certifyFootprint(
        f.map,
        rect(79.5 * FIXED, 64 * FIXED, 1.1 * FIXED, 0.5 * FIXED),
        () => false,
        false,
        TERRAIN.softDeploy,
      ),
    ).toBe(false);
    expect(
      certifyFootprint(
        f.map,
        rect(84 * FIXED, 64 * FIXED, 0.1 * FIXED, 0.1 * FIXED),
        () => false,
        false,
        TERRAIN.softHold,
      ),
    ).toBe(false);
    expect(
      certifyFootprint(f.map, small, () => true, false, TERRAIN.softHold),
    ).toBe(false);
  });
  it("distinguishes hold and deploy bands at the same shore", () => {
    const f = transportScene(),
      p = rect(79.5 * FIXED, 64 * FIXED, 1.2 * FIXED, 0.5 * FIXED);
    expect(
      certifyFootprint(f.map, p, () => false, false, TERRAIN.softDeploy),
    ).toBe(false);
    expect(
      certifyFootprint(f.map, p, () => false, false, TERRAIN.softHold),
    ).toBe(true);
  });
  it("keeps long straight travel deployed and permits winding or constrained columns", () => {
    const f = transportScene(),
      s = {
        ...f.s,
        order: { type: "move" as const, tile: 100 },
        path: Array(40).fill(100),
        nextPathIndex: 0,
      };
    expect(columnDecision(s, 100, false, { winding: false })).toBe("keep");
    expect(columnDecision(s, 100, false, { winding: true })).toBe("fold");
    expect(columnDecision(s, 100, true, { winding: false })).toBe("fold");
    expect(
      columnDecision(
        {
          ...s,
          formation: {
            ...s.formation!,
            shape: "column",
            mode: "travel",
            automatic: true,
          },
        },
        100,
        false,
        { complete: false },
      ),
    ).toBe("keep");
  });
  it("interpolates across the angle wrap and keeps duplicate publication continuity", () => {
    const f = transportScene(),
      a = new FormationAngleSamples();
    a.update(
      [{ ...f.s, formation: { ...f.s.formation!, facing: 65000 } }],
      1,
      1,
    );
    a.update([{ ...f.s, formation: { ...f.s.formation!, facing: 200 } }], 2, 1);
    const start = a.angle(f.s.id, 0)!,
      mid = a.angle(f.s.id, 0.5)!,
      end = a.angle(f.s.id, 1)!;
    expect(Math.abs(end - start)).toBeLessThan(0.1);
    expect(mid).toBeCloseTo((start + end) / 2);
    a.update(
      [{ ...f.s, formation: { ...f.s.formation!, facing: 200 } }],
      2,
      0.5,
    );
    expect(a.angle(f.s.id, 0.5)).toBe(mid);
    a.clear();
    expect(a.angle(f.s.id, 1)).toBeUndefined();
  });
  it("assigns west-side attackers to west-side approaches", () => {
    const f = transportScene(12, false),
      target = { ...f.s, id: 900, x: 60 * FIXED, y: 60 * FIXED };
    const row = [-1, 0, 1].map((offset, i) => ({
      ...f.s,
      id: 100 + i,
      x: 50 * FIXED,
      y: (60 + offset) * FIXED,
      order: { type: "attack" as const, targetId: 900 },
    }));
    const a = new AttackApproaches();
    a.rebuild(
      [target, ...row],
      () => true,
      () => true,
    );
    for (const s of row) {
      const p = a.point(s)!;
      expect(p).toBeDefined();
      const angle = Math.atan2(p.y - target.y, p.x - target.x),
        bearing = Math.atan2(s.y - target.y, s.x - target.x);
      expect(Math.abs(headingDifference(bearing, angle))).toBeLessThanOrEqual(
        Math.PI / 4 + 0.11,
      );
    }
  });
  it("uses the previous combat latch for hysteresis even after per-tick reset", () => {
    const f = transportScene(12, false),
      definition = UNIT.get(f.s.definitionId!)!,
      range = definition.attack.range;
    const enemy = f.game.addSquad({
      ...f.s,
      id: 900,
      playerId: 2,
      weaponState:{sharedReadyTick:9000},
      x: f.s.x,
      y: f.s.y + 4 * FIXED,
      formation: { ...f.s.formation!, facing: TURN / 2 },
    })!;
    const point = formationApproach(
      { ...f.s, formation: { ...f.s.formation!, facing: 0 } },
      enemy,
      0,
      range - 2,
      -Math.PI / 2,
    );
    f.game.updateSquad(f.s.id, {
      ...point,
      weaponState:{sharedReadyTick:9000},
      formation: { ...f.s.formation!, facing: 0 },
      order: { type: "hold" },
    });
    f.game.expansion!.battle.fight([]);
    expect(f.s.fighting).toBe(true);
    f.game.updateSquad(enemy.id, { y: enemy.y + CONTACT.release / 2 });
    f.game.expansion!.battle.fight([]);
    expect(f.s.fighting).toBe(true);
    expect(formationContact(f.s, enemy, f.game.tick).gap).toBeGreaterThan(
      range + CONTACT.enter,
    );
  });
  it("rejects malformed and future formation clocks", () => {
    const f = transportScene();
    expect(() =>
      validateFormation(
        { ...f.s.formation!, settledSince: -1 },
        f.s.definitionId,
      ),
    ).toThrow();
    expect(() =>
      validateFormation(
        { ...f.s.formation!, blockedSince: 2 },
        f.s.definitionId,
      ),
    ).toThrow();
    const c = f.game.checkpoint();
    const i = c.squads.findIndex((s) => s.id === f.s.id);
    const changed = {...c, squads: c.squads.map((s, at) => at === i ? {...s, formation: {...f.s.formation!, settledSince: c.tick + 1}} : s)};
    expect(() => f.game.restore(changed)).toThrow("clock");
  });
});
