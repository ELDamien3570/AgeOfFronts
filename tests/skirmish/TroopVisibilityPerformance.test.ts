import {describe,it,expect,vi} from 'vitest';
import {TroopActors} from '../../src/skirmish/client/troops/TroopActors';
import {formationLoad} from './fixtures/FormationLoad';
describe('cosmetic detail visibility',()=>{
  it('keeps aggregate opponent centers while sampling only detail drawn this frame',()=>{
    const {game}=formationLoad('crowded',15),[visible,hidden]=game.squads;
    game.updateSquad(visible.id,{fighting:true,combatTargetId:hidden.id});
    const actors=new TroopActors(()=>0,{troops:[],byDefinitionId:new Map()});
    // Fake existing motion histories: camera culling must stop sampling them,
    // while every canonical squad remains available as a target center.
    const sampleVisible=vi.fn(()=>[{id:1}]),sampleHidden=vi.fn(()=>[{id:2}]);
    const internals=actors as unknown as {motions:Map<number,unknown>;detailedInFrame:Set<number>;
      contacts:Map<number,{opponents:{center:{x:number;y:number};soldiers:unknown[]}[]}>};
    internals.motions.set(visible.id,{motion:{soldiers:sampleVisible},walkers:{position:()=>({x:1,y:2})}});
    internals.motions.set(hidden.id,{motion:{soldiers:sampleHidden},walkers:{position:()=>({x:3,y:4})}});
    const context={save:()=>{},restore:()=>{}} as unknown as CanvasRenderingContext2D;
    internals.detailedInFrame.add(visible.id);actors.flush(context);actors.prune(game.snapshot());
    expect(sampleVisible).toHaveBeenCalledOnce();expect(sampleHidden).not.toHaveBeenCalled();
    expect(internals.contacts.get(visible.id)!.opponents[0].soldiers).toHaveLength(0);
    expect(internals.contacts.get(visible.id)!.opponents[0].center).toEqual({x:hidden.x/256,y:hidden.y/256});
    actors.beginFrame();actors.prune(game.snapshot());
    expect(sampleVisible).toHaveBeenCalledTimes(2);expect(sampleHidden).not.toHaveBeenCalled();
    // Only an actually completed draw with no visible actors publishes culling.
    actors.flush(context);actors.prune(game.snapshot());
    expect(sampleVisible).toHaveBeenCalledTimes(2);expect(sampleHidden).not.toHaveBeenCalled();
  });
});
