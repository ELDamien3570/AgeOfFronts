// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {PeaceOfferView} from '../../src/skirmish/client/PeaceOfferView';
import {EmpireViewModel} from '../../src/skirmish/client/EmpireViewModel';
import {secondsToTicks} from '../../src/skirmish/Protocol';

function fixture(){
  const cells=new Uint8Array(48*48).fill(133);
  const game=new Skirmish(new GameMapImpl(48,48,cells,cells.length),{seed:42,aiCount:2,tribes:false,runAi:false,ruleset:'ages-v1',diplomacyRules:'raids-v1'});
  const root=document.createElement('main'),command=vi.fn(c=>game.applyCommand(c));
  document.body.replaceChildren(root);
  const view=new PeaceOfferView(root,command);
  const update=()=>view.update(new EmpireViewModel(game.snapshot(),{selected:new Set(),selectedShips:new Set(),selectedBuilding:null}));
  const offer=(id:number)=>{
    game.expansion!.diplomacy.recordTheft(id,1,game.tick);
    expect(game.applyCommand({type:'alliance',playerId:id,otherId:1,action:'offer-peace'})).toBeNull();
    update();
  };
  return {game,root,command,view,update,offer};
}
it('mutes current and future peace popups without deciding offers, and resets next match',()=>{
  const f=fixture();f.offer(2);
  const aside=f.root.querySelector('aside')!;
  expect(aside.hidden).toBe(false);
  const checkbox=f.root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.click();
  expect(aside.hidden).toBe(true);
  expect(f.root.querySelectorAll('section')).toHaveLength(0);
  expect(f.command).not.toHaveBeenCalled();
  f.game.tick+=secondsToTicks(30);f.offer(3);f.update();
  expect(aside.hidden).toBe(true);
  expect(f.game.expansion!.diplomacy.state.offers.filter(o=>o.kind==='peace'&&o.expiresTick>f.game.tick)).toHaveLength(1);
  f.view.reset();f.update();
  expect(checkbox.checked).toBe(false);
  expect(aside.hidden).toBe(false);
  expect(f.root.querySelectorAll('section')).toHaveLength(1);
});
it('keeps accept and reject authoritative and removes expired offers',()=>{
  const f=fixture();f.offer(2);
  f.root.querySelector<HTMLButtonElement>('[data-peace="accept"]')!.click();f.update();
  expect(f.command).toHaveBeenLastCalledWith({type:'alliance',playerId:1,otherId:2,action:'accept-peace'});
  expect(f.root.querySelectorAll('section')).toHaveLength(0);
  f.game.tick+=secondsToTicks(30);f.offer(3);
  expect(f.root.querySelectorAll('section')).toHaveLength(1);
  f.game.tick=Math.max(...f.game.expansion!.diplomacy.state.offers.map(o=>o.expiresTick));f.update();
  expect(f.root.querySelector('aside')!.hidden).toBe(true);
  expect(f.root.querySelectorAll('section')).toHaveLength(0);
});

it('submits explicit rejection and keeps later offers available',()=>{
  const f=fixture();f.offer(2);
  f.root.querySelector<HTMLButtonElement>('[data-peace="reject"]')!.click();f.update();
  expect(f.command).toHaveBeenLastCalledWith({type:'alliance',playerId:1,otherId:2,action:'reject-peace'});
  expect(f.root.querySelectorAll('section')).toHaveLength(0);
  f.game.tick+=secondsToTicks(30);f.offer(3);
  expect(f.root.querySelector('section strong')!.textContent).toContain(f.game.players[2].name);
  expect(f.game.expansion!.diplomacy.state.offers.some(o=>o.proposer===2&&o.kind==='peace')).toBe(false);
});
