import { describe,it,expect } from 'vitest';
import { formationBattleReviewScene } from './fixtures/FormationBattleReview';
describe('large formation battle preview',()=>{
  it('deploys two real 30-formation armies with the requested composition',()=>{
    const {game,riders,defenders}=formationBattleReviewScene();
    expect(game.squads).toHaveLength(60);
    for(const army of [riders,defenders]){
      expect(army).toHaveLength(30);
      expect(army.filter(s=>s.kind==='infantry')).toHaveLength(24);
      expect(army.filter(s=>s.kind==='cavalry')).toHaveLength(6);
      expect(new Set(army.map(s=>`${s.x}:${s.y}`)).size).toBe(30);
    }
  });
  it('runs cavalry charges and infantry combat through the real simulation',()=>{
    const scene=formationBattleReviewScene(),starting=scene.game.squads.reduce((n,s)=>n+s.troops,0);
    let impacts=0,melee=0;
    for(let i=0;i<400;i++){
      scene.launch();scene.game.step();
      impacts+=scene.game.squads.filter(s=>s.chargeImpact?.tick===scene.game.tick).length;
      melee+=scene.game.volleys.filter(v=>v.melee).length;
    }
    expect(melee).toBeGreaterThan(0);expect(impacts).toBeGreaterThan(0);
    expect(scene.game.squads.reduce((n,s)=>n+s.troops,0)).toBeLessThan(starting);
  },20000);
});
