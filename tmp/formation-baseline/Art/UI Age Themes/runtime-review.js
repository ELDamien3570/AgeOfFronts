import '/src/skirmish/client/style.css';
import '/src/skirmish/client/age-theme.css';
import { GameMapImpl } from '/src/core/game/GameMap.ts';
import { Skirmish } from '/src/skirmish/Simulation.ts';
import { TECHNOLOGIES } from '/src/skirmish/content/Technology.ts';
import { AGE_NAMES, AGES } from '/src/skirmish/domain/Definitions.ts';
import { BUILDING_RULES } from '/src/skirmish/Rules.ts';
import { EmpireView, empireMarkup } from '/src/skirmish/client/EmpireView.ts';
import { EmpireViewModel } from '/src/skirmish/client/EmpireViewModel.ts';
import { hudMarkup, HudView } from '/src/skirmish/client/HudView.ts';
import { HudViewModel } from '/src/skirmish/client/HudViewModel.ts';
import { SkirmishViewModel } from '/src/skirmish/client/SkirmishViewModel.ts';
import { ArmyView } from '/src/skirmish/client/ArmyView.ts';
import { ArmyViewModel } from '/src/skirmish/client/ArmyViewModel.ts';
import { BuildingMarkers } from '/src/skirmish/client/BuildingMarkers.ts';
import { ownerUiAge } from '/src/skirmish/client/AgeUiTheme.ts';

const root=document.querySelector('#app');
const formationButton=document.createElement('button');formationButton.id='review-formations';formationButton.textContent='Select formations';document.querySelector('#review-toolbar').insertBefore(formationButton,document.querySelector('#review-status'));
root.innerHTML=`<header class="topbar"><div class="brand"><span class="brand-mark">AF</span><div><h1>Age of Fronts</h1><p>Production HUD components</p></div></div><label>Battlefield <select><option>Material review</option></select></label><div class="time-controls"><span id="clock">Fixture</span><button>Pause <kbd>Space</kbd></button><button>Fit map <kbd>Home</kbd></button></div></header>${empireMarkup()}<main class="battlefield"><canvas id="battlefield" aria-label="Owner age building marker samples"></canvas><div class="map-badge">Shared live marker renderer · 18px</div><div class="review-world-note">HUD uses your earned age. Rival markers keep their own age.</div>${hudMarkup()}<div id="toast" class="toast" role="status" hidden></div></main><footer><span>Isolated fixture world · live production views and domain progression</span></footer>`;
const data=new Uint8Array(96*64).fill(133);
const world=new Skirmish(new GameMapImpl(96,64,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
const types=Object.keys(BUILDING_RULES);
for(const [i,type] of types.entries())world.buildings.push({id:world.allocateId(),type,tile:world.players[0].base+i,playerId:1,remainingTicks:0,age:'StoneAge',health:2000,maxHealth:2000});
const selection={selected:new Set(),selectedShips:new Set(),selectedBuilding:world.buildings.find(b=>b.type==='barracks').id};
const status=document.querySelector('#review-status');
function command(value){const reason=world.applyCommand(value);status.textContent=reason||'Command accepted';refresh()}
const empire=new EmpireView(root,{refresh,command,build(){status.textContent='Placement is reviewed in the live game'},notify:text=>{status.textContent=text},focusedRef:()=>`building:${selection.selectedBuilding}`,target(){}});
const hud=new HudView(root);
const armies=new ArmyView(root,{command,select(ids){selection.selected=new Set(ids);refresh()},target(){}});
const markers=new BuildingMarkers();
for(const id of ['review-age','review-rival'])for(const [i,age] of AGES.entries()){const option=document.createElement('option');option.value=age;option.textContent=AGE_NAMES[i];document.querySelector('#'+id).append(option)}
function fixtures(age){const state=world.expansion.progression.states[1];state.age=age;state.completed=TECHNOLOGIES.filter(t=>AGES.indexOf(t.age)<=AGES.indexOf(age)).map(t=>t.id);state.research={};state.advancement=null;for(const player of world.players){player.gold=10000000;player.reserves=100000}for(const building of world.buildings)building.age=age;for(const inventory of Object.values(world.expansion.supply.inventories))for(const key of ['horses','stone','copper','tin','ironOre','carbon','sulphur','nitrate','bronze','iron','steel','gunpowder','oil'])inventory[key]=5000;}
function refresh(){const snapshot=world.snapshot();empire.update(new EmpireViewModel(snapshot,selection));hud.update(new HudViewModel(new SkirmishViewModel(snapshot,selection)));armies.update(new ArmyViewModel(snapshot,selection.selected));root.querySelector('#gold').textContent=world.players[0].gold.toLocaleString();root.querySelector('#reserves').textContent=world.players[0].reserves.toLocaleString();root.querySelector('#troop-total').textContent='3,000';root.querySelector('#squad-count').textContent='3 / 200';root.querySelector('#land').textContent='112';root.querySelector('#losses').textContent='0';document.querySelector('#review-age').value=snapshot.expansion.progression[1].age;document.querySelector('#review-advance').disabled=snapshot.expansion.progression[1].age==='Modern';drawMarkers(snapshot);}
function drawMarkers(snapshot){const canvas=root.querySelector('#battlefield'),box=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;canvas.width=Math.ceil(box.width*ratio);canvas.height=Math.ceil(box.height*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);for(const [row,owner] of [1,2].entries())for(const [i,type] of types.entries()){const x=330+(i%7)*50,y=95+row*115+Math.floor(i/7)*31;const tile=markers.get(type,owner===1?'#7dccb4':'#da8981',18,ratio,ownerUiAge(snapshot,owner));if(tile)ctx.drawImage(tile.source,tile.x,tile.y,tile.width,tile.height,x,y,18,18)}ctx.fillStyle='#f1eee0';ctx.font='11px Segoe UI';ctx.fillText('Your buildings · '+AGE_NAMES[AGES.indexOf(ownerUiAge(snapshot,1))],330,82);ctx.fillText('Rival buildings · '+AGE_NAMES[AGES.indexOf(ownerUiAge(snapshot,2))],330,197);}
document.querySelector('#review-age').addEventListener('change',event=>{empire.reset();fixtures(event.target.value);refresh();empire.toggle('technology')});
document.querySelector('#review-rival').addEventListener('change',event=>{world.expansion.progression.states[2].age=event.target.value;refresh()});
formationButton.addEventListener('click',()=>{selection.selected=new Set(world.squads.filter(s=>s.playerId===1).map(s=>s.id));selection.selectedBuilding=null;refresh();status.textContent='Use Create army to review the native army panel'});
document.querySelector('#review-advance').addEventListener('click',()=>{const before=world.expansion.progression.states[1].age;const reason=world.applyCommand({type:'advance-age',playerId:1});if(reason){status.textContent=reason;return}refresh();while(world.expansion.progression.states[1].advancement)world.expansion.progression.step(world.players);refresh();status.textContent=`Domain advancement completed: ${before} → ${world.expansion.progression.states[1].age}`;});
window.addEventListener('resize',()=>drawMarkers(world.snapshot()));
fixtures('StoneAge');world.expansion.progression.states[2].age='BronzeAge';document.querySelector('#review-rival').value='BronzeAge';await markers.ready;refresh();empire.toggle('technology');
