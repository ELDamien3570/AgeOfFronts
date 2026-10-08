import {UNITS} from "../src/skirmish/content/Units";
import {damageAmount,defenceOf} from "../src/skirmish/domain/Combat";
const spear=UNITS.find(u=>u.age==="EarlyMedieval"&&u.troopClass==="antiCavalry")!;
const light=UNITS.find(u=>u.age==="EarlyMedieval"&&u.troopClass==="lightCavalry")!;
const next=UNITS.find(u=>u.age==="LateMedieval"&&u.troopClass==="lightCavalry")!;
function duel(a:any,b:any){let ah=1000,bh=1000;for(let t=0;t<20000&&ah>0&&bh>0;t++){const da=t%a.attack.reloadTicks===0?damageAmount(a.attack,defenceOf(b),ah):0;const db=t%b.attack.reloadTicks===0?damageAmount(b.attack,defenceOf(a),bh):0;ah=Math.max(0,ah-db);bh=Math.max(0,bh-da)}return [ah,bh]}
for(const bonus of [20,22,24,26,28,30]){const u={...spear,attack:{...spear.attack,bonuses:{mounted:Math.round(bonus*1000/60*1.5**3)}}};console.log(bonus,duel(u,light),duel(u,next))}
