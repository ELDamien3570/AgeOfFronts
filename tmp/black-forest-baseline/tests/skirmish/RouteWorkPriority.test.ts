import {it,expect} from "vitest";
import {RouteWork} from "../../src/skirmish/RouteWork";
it("serves new player pursuit before an AI backlog while preserving background progress and restore",()=>{
  const seen:string[]=[],queue=new RouteWork<string>(task=>seen.push(task));
  for(let i=0;i<20;i++)queue.request(`ai:${i}`,1,`ai:${i}`);
  for(let i=0;i<6;i++)queue.request(`player:${i}`,1,`player:${i}`);
  const saved=queue.checkpoint(),restoredSeen:string[]=[],restored=new RouteWork<string>(task=>restoredSeen.push(task));restored.restore(saved);
  queue.drain(6,undefined,task=>task.startsWith("player"),0);restored.drain(6,undefined,task=>task.startsWith("player"),0);
  expect(seen).toEqual(["player:0","player:1","ai:0","player:2","player:3","ai:1"]);
  expect(restoredSeen).toEqual(seen);expect(restored.checkpoint()).toEqual(queue.checkpoint());
});
it("a large background cohort cannot block smaller player jobs or starve forever",()=>{
  const seen:string[]=[],queue=new RouteWork<string>(task=>seen.push(task));
  queue.request("large",16,"large");queue.request("player",1,"player");
  queue.drain(8,undefined,task=>task==="player",0);expect(seen).toEqual(["player"]);
  queue.drain(24,undefined,task=>task==="player",2);expect(seen).toEqual(["player","large"]);
});
