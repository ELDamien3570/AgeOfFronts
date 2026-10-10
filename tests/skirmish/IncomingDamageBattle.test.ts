import { describe, expect, it } from "vitest";
import audit from "./browser/FormationScaleAudit.json";
import {
  IncomingDamageBattle,
  type BattleHooks,
  type BattleUnit,
} from "./browser/IncomingDamageBattle";

function run(mounted = false) {
  const unit = (id: string) => audit.rows.find((r) => r.id === id)!;
  const rows: [BattleUnit, BattleUnit, BattleUnit] = [
    unit(mounted ? "earlymedieval-heavycavalry" : "stoneage-infantry"),
    unit(mounted ? "latemedieval-heavycavalry" : "stoneage-infantry"),
    unit("stoneage-archer"),
  ];
  let bodies = 0,
    melee = 0,
    shafts = 0;
  const poses: string[] = [];
  const deadMembers = new Set<number>();
  let liveRendered = false,
    corpseAttachments = 0;
  let observedTime = 0;
  const firstVolleyTargets = new Set<number>();
  const hooks: BattleHooks = {
    clip: () => ({ duration: 1050, release: 550 }),
    draw(_row, _member, _angle, pose, _age, scale) {
      poses.push(pose);
      if (pose !== "death") liveRendered = true;
      if (pose === "death") {
        if (scale !== 1) throw Error("Corpse body scale changed");
        deadMembers.add((_member as { id: number }).id);
        bodies++;
      }
    },
    muzzle: (_row, member) => {
      if (
        !mounted &&
        observedTime < 2000 &&
        member.id >= 36 &&
        member.id < 48 &&
        member.target !== undefined
      )
        firstVolleyTargets.add(member.target);
      return { ...member };
    },
    blood: () => {},
    impact(kind, _point, _from, _age, _index, memberId, corpse, underlay) {
      if (deadMembers.has(memberId) !== !!corpse)
        throw Error("Attachment is in the wrong body pass");
      if (underlay && liveRendered)
        throw Error("Lodged shaft rendered above living troops");
      if (corpse) {
        if (liveRendered)
          throw Error("Corpse attachment rendered above living troops");
        corpseAttachments++;
      }
      if (kind === "melee") melee++;
      else shafts++;
    },
    projectile: () => {},
    inspect: () => {},
    groundProjectile: () => {},
  };
  const battle = new IncomingDamageBattle(hooks);
  let status = battle.render(0, rows, true);
  for (let t = 50; t <= 60000; t += 50) {
    observedTime = t;
    poses.length = 0;
    deadMembers.clear();
    liveRendered = false;
    status = battle.render(t, rows, true);
    const lastBody = poses.lastIndexOf("death"),
      firstLiving = poses.findIndex((p) => p !== "death");
    if (lastBody >= 0 && firstLiving >= 0)
      if (lastBody >= firstLiving)
        throw Error("Corpse rendered above living troops");
  }
  const render = (time: number) => {
    poses.length = 0;
    deadMembers.clear();
    liveRendered = false;
    return battle.render(time, rows, true);
  };
  return {
    firstVolleyTargets,
    battle,
    rows,
    status,
    bodies,
    melee,
    shafts,
    corpseAttachments,
    render,
  };
}
describe("incoming damage visual encounter", () => {
  it.each([false, true])(
    "produces casualties, melee impacts and retargets (mounted=%s)",
    (mounted) => {
      const result = run(mounted);
      expect(result.status.deaths).toBeGreaterThan(20);
      expect(result.status.retargets).toBeGreaterThan(0);
      expect(result.bodies).toBeGreaterThan(0);
      expect(result.melee).toBeGreaterThan(0);
      expect(result.shafts).toBeGreaterThan(0);
      expect(result.corpseAttachments).toBeGreaterThan(0);
      if (!mounted) expect(result.firstVolleyTargets.size).toBeGreaterThan(6);
      // Rendering a paused clock cannot inflict additional damage.
      expect(result.render(60000)).toEqual(result.status);
      expect(result.render(0).deaths).toBe(0);
    },
  );
  it("replays deterministically", () =>
    expect(run().status).toEqual(run().status));
});

describe("preview soldier layering parity",()=>{
  function drawn(groundElevationAt?: BattleHooks["groundElevationAt"]) {
    const members:{id:number;x:number;y:number}[]=[];
    const row=audit.rows.find(r=>r.id==="stoneage-infantry")!;
    const battle=new IncomingDamageBattle({
      clip:()=>({duration:1000,release:500}),groundElevationAt,
      draw:(_row,m,_angle,pose)=>{if(pose!=="death")members.push({...m});},
      muzzle:(_row,m)=>({...m}),blood(){},impact(){},projectile(){},groundProjectile(){},inspect(){},
    });
    battle.render(0,[row,row,row],true);return members;
  }
  it("interleaves individual members across flat-ground formations",()=>{
    const members=drawn(),groups=members.map(m=>Math.floor(m.id/12));
    expect(new Set(members.map(m=>m.id)).size).toBe(120);
    expect(groups.slice(1).filter((g,i)=>g!==groups[i]).length).toBeGreaterThan(6);
    expect(drawn().map(m=>m.id)).toEqual(members.map(m=>m.id));
  });
  it("uses sampled terrain before individual ties",()=>{
    const members=drawn(p=>p.x);
    expect(members.map(m=>m.x)).toEqual(members.map(m=>m.x).sort((a,b)=>a-b));
  });
});
