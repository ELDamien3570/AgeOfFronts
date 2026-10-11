import {describe,it,expect} from 'vitest';
import {OpponentAttention} from '../../src/skirmish/client/OpponentAttention';
describe('indexed cosmetic attention',()=>{
  it('matches stable brute-force nearest choices and directional frontage queries',()=>{
    const points=Array.from({length:144},(_,i)=>({id:String(i),x:(i*47%139)/9,y:(i*23%131)/7}));
    const index=new OpponentAttention(points);
    for(let i=0;i<200;i++){
      const origin={x:(i*31%181)/11,y:(i*19%163)/8},angle=i*.137,direction={x:Math.cos(angle),y:Math.sin(angle)};
      for(const ahead of [undefined,direction]){
        const candidates=points.filter(p=>!ahead || (p.x-origin.x)*ahead.x+(p.y-origin.y)*ahead.y>0);
        const distance=(p:{x:number;y:number})=>(p.x-origin.x)**2+(p.y-origin.y)**2;
        const nearest=candidates.reduce<(typeof points)[number]|undefined>((best,p)=>!best || distance(p)<distance(best)?p:best,undefined);
        expect(index.nearest(origin,ahead)).toBe(nearest);
      }
    }
  });
  it('preserves original ties and excludes the exact half-plane boundary',()=>{
    const points=[{id:'first',x:1,y:0},{id:'second',x:-1,y:0}],index=new OpponentAttention(points);
    expect(index.nearest({x:0,y:0})?.id).toBe('first');
    expect(index.nearest({x:0,y:0},{x:0,y:1})).toBeUndefined();
    expect(index.point('dead')).toBeUndefined();
    expect(new OpponentAttention([]).nearest({x:0,y:0})).toBeUndefined();
  });
});
