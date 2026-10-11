import { describe,it,expect } from 'vitest';
import { ReservePress } from '../../src/skirmish/client/ReservePress';
const slots=Array.from({length:25},(_,id)=>({id,x:(id%5-2)*.2,y:(Math.floor(id/5)-2)*.2,scale:.24,front:false}));
const front=new Set(slots.filter(p=>p.x>.39||p.y>.39).map(p=>p.id));
const offsets=new Map(slots.filter(p=>front.has(p.id)).map(p=>[p.id,{x:p.x>.39?.15:0,y:p.y>.39?.15:0}]));
const options={enabled:true,square:false,limit:.4};
describe('bounded reserve press',()=>{
  it('compresses all reserve ranks toward contact within the same envelope',()=>{
    const deep=Array.from({length:35},(_,id)=>({id,x:(id%5-2)*.2,y:(Math.floor(id/5)-3)*.2,scale:.24,front:false}));
    const edge=new Set(deep.filter(p=>p.y>.59).map(p=>p.id));
    const contact=new Map([...edge].map(id=>[id,{x:.04,y:.12}]));
    const model=new ReservePress();let result=model.sample(0,deep,[2],edge,contact,{...options,crowd:true});
    for(let i=0;i<150;i++)result=model.sample(.1,deep,[2],edge,contact,{...options,crowd:true});
    expect(result.get(2)!.y).toBeGreaterThan(.25);
    expect(result.get(27)!.y).toBeGreaterThan(.1);
    expect(result.get(27)!.x).toBeGreaterThan(0);
    for(const p of result.values())expect(Math.hypot(p.x,p.y)).toBeLessThanOrEqual(.400001);
    const before=result;
    const changed=model.sample(0,deep,[4],new Set(),new Map(),{...options,crowd:true});
    for(const p of deep)expect([changed.get(p.id)!.x,changed.get(p.id)!.y]).toEqual([before.get(p.id)!.x,before.get(p.id)!.y]);
  });
  it('supports both contacted edges with decreasing movement in deeper ranks',()=>{
    const model=new ReservePress();let result=model.sample(0,slots,[0,2],front,offsets,options);
    for(let i=0;i<80;i++)result=model.sample(.1,slots,[0,2],front,offsets,options);
    expect(result.get(13)!.x).toBeGreaterThan(result.get(12)!.x);
    expect(result.get(12)!.x).toBeGreaterThan(result.get(11)!.x);
    expect(result.get(17)!.y).toBeGreaterThan(0);
    expect(result.get(13)!.y).toBe(0);expect(result.get(17)!.x).toBe(0);
    for(const id of front)expect(Math.hypot(result.get(id)!.x,result.get(id)!.y)).toBe(0);
    for(const p of slots){
      const shift=result.get(p.id)!;expect(Math.hypot(shift.x,shift.y)).toBeLessThan(.4);
      for(const q of slots){if(p.id>=q.id)continue;const other=result.get(q.id)!;
        const a=front.has(p.id)?offsets.get(p.id)!:shift,b=front.has(q.id)?offsets.get(q.id)!:other;
        expect(Math.hypot(p.x+a.x-q.x-b.x,p.y+a.y-q.y-b.y)).toBeGreaterThan(.12);
      }
    }
  });
  it('keeps support assignments through target ordering noise and preserves casualty/retarget continuity',()=>{
    const model=new ReservePress();
    let before=model.sample(.1,slots,[0,2],front,offsets,options);
    for(let i=0;i<20;i++)before=model.sample(.1,slots,[0,2],front,offsets,options);
    const reordered=model.sample(0,slots,[2,0],front,offsets,options);
    expect(reordered).toEqual(before);
    const remaining=slots.filter(p=>p.id!==24);
    const changed=model.sample(0,remaining,[4],new Set(),new Map(),options);
    for(const p of remaining)expect([changed.get(p.id)!.x,changed.get(p.id)!.y]).toEqual([before.get(p.id)!.x,before.get(p.id)!.y]);
    expect(changed.has(24)).toBe(false);
  });
  it('limits rigid formations and returns smoothly after contact ends',()=>{
    const settle=(square:boolean,layout?:string)=>{const model=new ReservePress();let result;
      for(let i=0;i<80;i++)result=model.sample(.1,slots,[0,2],front,offsets,{...options,square,layout});
      return {model,result:result!};};
    const mass=settle(false),wall=settle(false,'shield-wall'),square=settle(true);
    expect(wall.result.get(13)!.x).toBeCloseTo(mass.result.get(13)!.x*.45);
    expect(square.result.get(13)!.x).toBeCloseTo(mass.result.get(13)!.x*.25);
    const releasing=mass.model.sample(.1,slots,[],new Set(),new Map(),{...options,enabled:false});
    expect(releasing.get(13)!.x).toBeGreaterThan(0);expect(releasing.get(13)!.x).toBeLessThan(mass.result.get(13)!.x);
    let settled=releasing;for(let i=0;i<40;i++)settled=mass.model.sample(.1,slots,[],new Set(),new Map(),{...options,enabled:false});
    expect(settled.get(13)!.x).toBeLessThan(.0001);
  });
});
