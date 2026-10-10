import {describe,expect,it} from "vitest";
import {createSkirmishMap} from "../../src/skirmish/Elevation";
import {soldierTerrainElevation} from "../../src/skirmish/client/SoldierTerrainElevation";
describe("soldier ground elevation",()=>{
 it("samples authored metres at ground anchors and interpolates across cell edges",()=>{
   const map=createSkirmishMap(2,2,new Uint8Array(4).fill(133),{values:new Float32Array([0,100,200,300]),minimum:0,maximum:300,seaLevel:0});
   const sample=soldierTerrainElevation(map);
   expect(sample(.5,.5)).toBe(0);expect(sample(1.5,.5)).toBe(100);
   expect(sample(1,1)).toBe(150);
   expect(sample(.99,1)).toBeCloseTo(149);expect(sample(1.01,1)).toBeCloseTo(151);
   expect(sample(-2,-2)).toBe(0);expect(sample(10,10)).toBe(300);
 });
 it("returns exactly equal height across an authored flat plateau",()=>{
   const sample=soldierTerrainElevation(createSkirmishMap(2,2,new Uint8Array(4).fill(133),{values:new Float32Array(4).fill(100),minimum:0,maximum:200,seaLevel:0}));
   for(let i=0;i<100;i++)expect(sample(i/71,i/91)).toBe(100);
 });
 it("keeps maps without elevation data flat",()=>{
   const sample=soldierTerrainElevation(createSkirmishMap(2,2,new Uint8Array([133,159,191,133])));
   expect(sample(.5,.5)).toBe(0);expect(sample(1.5,1.5)).toBe(0);
 });
});
