import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { certifyFootprint, convexHull, polygonsOverlap, type Point } from "../../src/skirmish/domain/FormationContact";
import { passableCell } from "../../src/skirmish/SquadGeometry";
import { withinShoreline } from "../../src/skirmish/domain/ShorelineTolerance";

describe("prepared terrain-cell geometry",()=>{
  it("matches the original SAT certification at boundaries, obstacles, shores and fractional rotations",()=>{
    const data=Uint8Array.from({length:48*48},(_,i)=>i%31===0?159:i%7===0?0:133);
    const map=new GameMapImpl(48,48,data,data.filter(n=>n&128).length),walls=new Set([37,300,1000]);
    const blocked=(tile:number)=>walls.has(tile);
    const reference=(polygon:readonly Point[],amphibious:boolean,soft:number)=>{
      if(!polygon.length)return false;
      const x0=Math.floor(Math.min(...polygon.map(p=>p.x))/FIXED),x1=Math.floor(Math.max(...polygon.map(p=>p.x))/FIXED),
        y0=Math.floor(Math.min(...polygon.map(p=>p.y))/FIXED),y1=Math.floor(Math.max(...polygon.map(p=>p.y))/FIXED);
      if((x1-x0+1)*(y1-y0+1)>4096)return false;
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
        const valid=map.isValidCoord(x,y),ref=valid?map.ref(x,y):0;
        if(valid && passableCell(map,ref,amphibious) && !blocked(ref))continue;
        const tile=[{x:x*FIXED,y:y*FIXED},{x:(x+1)*FIXED,y:y*FIXED},
          {x:(x+1)*FIXED,y:(y+1)*FIXED},{x:x*FIXED,y:(y+1)*FIXED}];
        if(!polygonsOverlap(polygon,tile,0.01))continue;
        if(valid && !map.isLand(ref) && !map.isImpassable(ref) && !blocked(ref) && withinShoreline(map,polygon,x,y,soft))continue;
        return false;
      }
      return true;
    };
    let seed=47;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    const cases:Point[][]=[[],[{x:0,y:0},{x:FIXED,y:0},{x:FIXED,y:FIXED},{x:0,y:FIXED}]];
    for(let i=0;i<300;i++) {
      const x=(random()*50-1)*FIXED,y=(random()*50-1)*FIXED;
      cases.push(convexHull(Array.from({length:4+i%13},()=>({x:x+(random()-.5)*8*FIXED,y:y+(random()-.5)*8*FIXED}))));
    }
    for(const polygon of cases)for(const amphibious of [false,true])for(const soft of [0,2])
      expect(certifyFootprint(map,polygon,blocked,amphibious,soft)).toBe(reference(polygon,amphibious,soft));
  });
});
