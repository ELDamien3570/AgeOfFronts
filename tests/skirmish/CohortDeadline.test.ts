import { describe, expect, it, vi } from "vitest";
import { CohortAdmission, type CohortPorts } from "../../src/skirmish/domain/CohortAdmission";
import { ROUTE_CAPACITY_REASON } from "../../src/skirmish/RouteRetryPolicy";
import { formationLoad } from "./fixtures/FormationLoad";

describe("logical cohort deadlines", () => {
  for(const owner of ["army","strategy"] as const)it(`${owner} preparation expires at its original deadline after restore with no work allowance`,()=>{
    const {game}=formationLoad("distributed",15),squad=game.squads[0];let tick=0;
    const ports:CohortPorts={map:game.map,paths:game.paths,squads:()=>game.squads,squad:id=>game.squad(id),
      routes:{...game.domainRoutes!,deadlineTicks:()=>40,tick:()=>tick,cancel:vi.fn()},
      blocked:()=>()=>false,valid:()=>true,commit:vi.fn(),finished:vi.fn()};
    const admission=new CohortAdmission(owner,ports);
    const id=admission.start(squad.playerId,[squad],game.map.ref(100,30));expect(id).toBeDefined();
    tick=39;admission.step(0);expect(admission.plan(id!)?.deadline).toBe(40);
    const restored=new CohortAdmission(owner,ports);restored.restore(admission.checkpoint());
    tick=40;
    for(const instance of [admission,restored]) { instance.step(0);expect(instance.pendingCount).toBe(0); }
    expect(ports.commit).not.toHaveBeenCalled();
    expect(ports.finished).toHaveBeenCalledWith(expect.anything(),"rejected",ROUTE_CAPACITY_REASON);
    expect(restored.checkpoint()).toEqual(admission.checkpoint());
  });
});
