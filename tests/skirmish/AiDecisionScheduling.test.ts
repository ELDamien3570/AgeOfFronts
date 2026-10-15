import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { formationLoad } from "./fixtures/FormationLoad";

describe("bounded local AI scheduling",()=>{
  it("continues identically across restore with 30-tick decisions and whole-attempt deadlines",()=>{
    const {game}=formationLoad("distributed",15),saved=game.checkpoint();
    saved.options={...saved.options,runAi:true,autonomousDecisionInterval:12,autonomousRouteDeadlineTicks:16};
    const load=()=>{
      const terrain=new Uint8Array(500*250).fill(133);
      const match=new Skirmish(new GameMapImpl(500,250,terrain,terrain.length),saved.options);
      match.restore(saved);return match;
    };
    const control=load(),resumed=load();
    for(let tick=0;tick<90;tick++) {
      control.step();resumed.step();
      if(tick===44)resumed.restore(resumed.checkpoint());
      if(tick%15===14)expect(resumed.checkpoint()).toEqual(control.checkpoint());
      const autonomous=control.routePlanner.diagnosticCohorts(control.tick).filter(c=>c.playerId!==1);
      expect(autonomous.every(c=>(c.oldestActiveAge??0)<40)).toBe(true);
    }
  },30000);
});
