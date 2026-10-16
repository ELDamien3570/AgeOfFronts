import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TERRAIN } from "../../src/skirmish/content/TacticalRules";
import {
  certifyFootprint,
  formationFootprints,
} from "../../src/skirmish/domain/FormationContact";
import { transportHandoff } from "../../src/skirmish/domain/TransportHandoff";
import { createFormation, type FormationShape } from "../../src/skirmish/domain/FormationGeometry";
import { UNIT } from "../../src/skirmish/content/Units";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { transportScene } from "./fixtures/TacticalScenes";
function move(f: ReturnType<typeof transportScene>) {
  return f.game.applyCommand({
    type: "order",
    playerId: 1,
    squadIds: [f.s.id],
    order: { type: "move", tile: f.map.ref(128, 64) },
  });
}
describe("atomic researched transport handoff", () => {
  it("lands several enlarged squads on the same small island without requiring body-sized beaches",()=>{
    const f=transportScene(144,true,true),targets=[[96,63],[98,63],[96,65],[98,65]];
    const squads=targets.map((_,index)=>index===0?f.s:f.game.addSquad({...f.s,id:f.game.allocateId(),y:(61.5+index*3)*FIXED,formation:{...f.s.formation!},manpower:structuredClone(f.s.manpower)}));
    squads.forEach((s,index)=>expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[s.id],order:{type:"move",tile:f.map.ref(...targets[index] as [number,number])}})).toBeNull());
    for(let tick=0;tick<1600;tick++){f.game.step();if(squads.every((s,index)=>!s.afloat&&s.order.type==='hold'&&f.game.tileOf(s)===f.map.ref(...targets[index] as [number,number])))break;}
    squads.forEach((s,index)=>{expect(s.afloat).toBeFalsy();expect(f.game.tileOf(s)).toBe(f.map.ref(...targets[index] as [number,number]));expect(s.formation?.shape).not.toBe('column');});
  },30000);
  it.each([12,72,144])("lands %i troops on a three-cell island with substantial water overlap and moves back into water",count=>{
    const f=transportScene(count,true,true);
    expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[f.s.id],order:{type:"move",tile:f.map.ref(97,64)}})).toBeNull();
    let boarded=false;
    for(let tick=0;tick<1000;tick++){f.game.step();boarded ||= !!f.s.afloat;if(boarded&&!f.s.afloat&&f.s.order.type==='hold')break;}
    expect(boarded).toBe(true);expect(f.s.afloat).toBeFalsy();expect(f.game.tileOf(f.s)).toBe(f.map.ref(97,64));expect(f.s.formation?.shape).not.toBe('column');
    expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[f.s.id],order:{type:"move",tile:f.map.ref(103,64)}})).toBeNull();
    for(let tick=0;tick<400&&!f.s.afloat;tick++)f.game.step();
    expect(f.s.afloat).toBeTruthy();
  });
  it.each([
    ["napoleonic-infantry", 144, "mass"],
    ["napoleonic-infantry", 144, "line"],
    ["napoleonic-infantry", 72, "wedge"],
    ["latemedieval-infantry", 96, "shield-wall"],
    ["latemedieval-anticavalry", 48, "square"],
    ["modern-infantry", 8, "modern-loose"],
    ["latemedieval-cavalry", 24, "line"],
  ] as const)("boards directly from %s %i %s when ordered into water", (id, count, shape) => {
    const f=transportScene(count),u=UNIT.get(id)!;
    f.game.updateSquad(f.s.id,{definitionId:id,kind:u.line,troops:count,manpower:createManpower(u,count>u.formationRecipe!.capacity?"enlarged":"base"),formation:{...createFormation(id),shape:shape as FormationShape,layoutTroops:count,shapeLock:true,facing:f.s.formation!.facing}});
    expect(f.game.applyCommand({type:"order",playerId:1,squadIds:[f.s.id],order:{type:"move",tile:f.map.ref(88,64)}})).toBeNull();
    for(let tick=0;tick<700 && !f.s.afloat;tick++){
      f.game.step();
      expect(f.s.formation!.shape,`tick ${f.game.tick}`).toBe(shape);
      expect(f.s.formation!.transition).toBeUndefined();
    }
    expect(f.s.afloat).toBeTruthy();
    expect(f.s.formation!.shapeLock).toBe(true);
  });
  it("relaxes shore water without relaxing walls or map bounds",()=>{
    const f=transportScene(144);
    expect(move(f)).toBeNull();
    for(let tick=0;tick<20 && !f.s.path.length;tick++)f.game.step();
    expect(f.s.path.length).toBeGreaterThan(0);
    const point={x:79*FIXED,y:f.s.y};
    expect(f.game.formationFits(f.s,point)).toBe(true);
    const forts=f.game.expansion!.fortifications;
    const tiles=Array.from({length:f.map.height()},(_,y)=>f.map.ref(80,y));
    const wall=forts.addBarrier({id:f.game.allocateId(),playerId:1,age:"StoneAge",a:tiles[0],b:tiles[tiles.length-1],
      tiles,health:1000,maxHealth:1000,remainingTicks:0});
    expect(f.game.formationFits(f.s,point)).toBe(false);
    forts.updateBarrier(wall.id,{health:0});
    expect(f.game.formationFits(f.s,point)).toBe(true);
    expect(f.game.formationFits(f.s,{x:79*FIXED,y:0})).toBe(false);
  });
  it.each([12, 72, 96, 144])(
    "crosses and lands %i troops without resetting wounds or weapons",
    (count) => {
      const f = transportScene(count);
      const weaponState = {
        sharedReadyTick: 9000,
        ranged: {
          nextTick: 9000,
          shots: 1,
          remainder: 0,
          reloadStartedTick: 1,
        },
      };
      f.game.updateSquad(f.s.id, {
        manpower: { ...f.s.manpower!, wounds: 120 },
        weaponState,
      });
      const manpower = structuredClone(f.s.manpower);
      expect(move(f)).toBeNull();
      let boarded = false,
        landed = false;
      for (let tick = 0; tick < 1800; tick++) {
        const before = { x: f.s.x, y: f.s.y };
        f.game.step();
        expect(
          Math.hypot(f.s.x - before.x, f.s.y - before.y),
        ).toBeLessThanOrEqual(FIXED);
        boarded ||= !!f.s.afloat;
        landed ||= boarded && !f.s.afloat;
        // A committed researched crossing allows the body to overlap water at
        // shore. Ground roots outside that handoff still obey normal tolerance.
        if (!f.s.afloat)
          expect(
            formationFootprints(f.s, f.game.tick).every((poly) =>
              certifyFootprint(
                f.map,
                poly,
                () => false,
                true,
                TERRAIN.softHold,
              ),
            ),
            `tick ${f.game.tick} root ${f.s.x / FIXED} shape ${f.s.formation?.shape} transition ${!!f.s.formation?.transition} facing ${f.s.formation?.facing}`,
          ).toBe(true);
        if (f.s.order.type === "hold" && landed) break;
      }
      expect(boarded).toBe(true);
      expect(landed).toBe(true);
      expect(f.s.x / FIXED).toBeGreaterThan(127);
      expect(f.s.troops).toBe(count);
      expect(f.s.manpower).toEqual(manpower);
      expect(f.s.weaponState).toEqual(weaponState);
    },
    20000,
  );
  it("requires research and never mutates speculative candidates", () => {
    const f = transportScene(72, false);
    expect(move(f)).not.toBeNull();
    const before = structuredClone(f.s);
    expect(
      transportHandoff(
        f.s,
        { x: 81 * FIXED, y: f.s.y },
        true,
        undefined,
        () => true,
      ),
    ).toBeUndefined();
    expect(f.s).toEqual(before);
  });
  it("uses a fresh legal column on landing and retains intended shape/facing", () => {
    const f = transportScene();
    const afloat = { hull: 100, maxHull: 200, vesselId: "test" };
    const source = {
      ...f.s,
      x: 95.9 * FIXED,
      afloat,
      formation: {
        ...f.s.formation!,
        shape: "line" as const,
        deployedShape: "line" as const,
        trail: undefined,
      },
    };
    let calls = 0;
    const proposal = transportHandoff(
      source,
      { x: 96.1 * FIXED, y: f.s.y },
      false,
      undefined,
      (c) => {
        calls++;
        return c.formation?.shape === "column";
      },
    );
    expect(calls).toBe(2);
    expect(proposal?.changes?.formation?.shape).toBe("column");
    expect(proposal?.changes?.formation?.deployedShape).toBe("line");
    expect(proposal?.changes?.formation?.trail).toBeUndefined();
    expect(source.afloat.hull).toBe(100);
  });
  it("keeps damaged hull and root when landing has no legal footprint", () => {
    const f = transportScene();
    const source = {
      ...f.s,
      afloat: { hull: 73, maxHull: 200, vesselId: "test" },
    };
    const before = structuredClone(source);
    expect(
      transportHandoff(
        source,
        { x: 97 * FIXED, y: f.s.y },
        false,
        undefined,
        () => false,
      ),
    ).toBeUndefined();
    expect(source).toEqual(before);
  });
  it("retains voyage hull through reorders and research; restores at the shore", async () => {
    const f = transportScene();
    expect(move(f)).toBeNull();
    for (let i = 0; i < 1000 && !f.s.afloat; i++) f.game.step();
    expect(f.s.afloat).toBeTruthy();
    f.game.updateSquad(f.s.id, { afloat: { ...f.s.afloat!, hull: 73 } });
    f.game.expansion!.progression.states[1].completed.push(
      "rus-bronzeage-armies",
    );
    const checkpoint = await decodeState<ReturnType<Skirmish["checkpoint"]>>(
      await encodeState(f.game.checkpoint()),
    );
    const restored = new Skirmish(
      new GameMapImpl(
        f.size,
        f.size,
        f.terrain,
        f.terrain.filter((v) => v & 128).length,
      ),
      f.options,
    );
    restored.restore(checkpoint);
    for (let i = 0; i < 200; i++) {
      f.game.step();
      restored.step();
      expect(restored.squads).toEqual(f.game.squads);
      if (f.s.afloat) expect(f.s.afloat.hull).toBe(73);
    }
    expect(restored.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("keeps explicit ship passengers separate", () => {
    const f = transportScene();
    expect(
      transportHandoff(
        { ...f.s, embarkedOn: 999 },
        { x: 90 * FIXED, y: f.s.y },
        true,
        { id: "boat", health: 200 },
        () => true,
      ),
    ).toBeUndefined();
  });
});
