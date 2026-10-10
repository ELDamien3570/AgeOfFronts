import {describe,expect,it} from "vitest";
import {HealthLossTrail} from "../../src/skirmish/client/HealthLossTrail";
describe("health loss presentation",()=>{
 it("holds a loss briefly, settles in one second, and resets on replenishment",()=>{
   const trail=new HealthLossTrail();trail.update([{id:1,strength:1}],0);
   trail.update([{id:1,strength:.7}],1);expect(trail.value(1,3)).toBe(1);
   trail.update([{id:1,strength:.7}],10);expect(trail.value(1,21)).toBe(.7);
   trail.update([{id:1,strength:.9}],22);expect(trail.value(1,22)).toBe(.9);
   trail.update([],23);expect(trail.value(1,23)).toBe(0);
 });
});
