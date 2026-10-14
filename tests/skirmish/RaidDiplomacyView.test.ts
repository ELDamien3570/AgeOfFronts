// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {EmpireView,empireMarkup} from '../../src/skirmish/client/EmpireView';
import {EmpireViewModel} from '../../src/skirmish/client/EmpireViewModel';
import {hudMarkup} from '../../src/skirmish/client/HudView';
it('presents raid permissions, exemption control and an authoritative neutral-peace popup',()=>{
 const cells=new Uint8Array(48*48).fill(133),game=new Skirmish(new GameMapImpl(48,48,cells,cells.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',diplomacyRules:'raids-v1'});
 const root=document.createElement('main');root.innerHTML=`${empireMarkup()}<section class="battlefield">${hudMarkup()}</section>`;document.body.append(root);
 const command=vi.fn(c=>game.applyCommand(c)),view=new EmpireView(root,{refresh(){},command,build(){},notify(){},focusedRef:()=>null,target(){}});
 let now=0;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
 const update=()=>{now+=600;view.update(new EmpireViewModel(game.snapshot(),{selected:new Set(),selectedShips:new Set(),selectedBuilding:null}));};
 update();view.inspectPlayer(2);update();expect(root.textContent).toContain('Neutral');
 root.querySelector<HTMLButtonElement>('[data-diplomacy="dont-embargo"]')!.click();update();expect(game.expansion!.diplomacy.state.dontEmbargo).toEqual([{playerId:1,otherId:2}]);
 game.expansion!.diplomacy.recordTheft(2,1,game.tick);update();expect(root.textContent).toContain('Raid · military combat permitted');
 expect(game.applyCommand({type:'alliance',playerId:2,otherId:1,action:'offer-peace'})).toBeNull();update();
 const popup=root.querySelector('[aria-label="Peace offers"]')!;expect(popup.textContent).toContain('offers peace');
 popup.querySelector<HTMLButtonElement>('[data-peace="accept"]')!.click();update();
 expect(game.expansion!.diplomacy.protected(1,2)).toBe(true);expect(game.expansion!.diplomacy.allied(1,2)).toBe(false);expect(root.textContent).toContain('Protected peace');
 clock.mockRestore();root.remove();
});
