import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { sampleFormation, chargeReviewPose, chargeReviewSteps, reviewTravelDistance, chargeReviewTravelDistance } from "./formation-composition.js";
const definition=JSON.parse(await fs.readFile(new URL("formation.json",import.meta.url),"utf8"));
const clips=new Map();
for(const path of definition.actorSources) {
  const metadata=JSON.parse(await fs.readFile(new URL(path,import.meta.url),"utf8"));
  for(const clip of metadata.animations)clips.set(clip.id,clip);
}
const byMember=members=>new Map(members.map(member=>[member.id,member]));

test("Every phase preserves five unique members and normalized pose weights",()=>{
  for(const animation of definition.animations)for(let sample=0;sample<=40;sample++) {
    const members=sampleFormation(definition,clips,animation.id,animation.durationMs*sample/40);
    assert.equal(members.length,5);assert.equal(new Set(members.map(member=>member.id)).size,5);
    for(const member of members){assert.ok(Number.isFinite(member.x)&&Number.isFinite(member.y));assert.ok(Math.abs(member.layers.reduce((sum,layer)=>sum+layer.weight,0)-1)<1e-9);}
  }
});
test("Death and charge impact reach the front before either rear soldier reacts",()=>{
  for(const id of ["death","charged"]) {
    const members=byMember(sampleFormation(definition,clips,id,200));
    for(const front of ["tip","left","right"])assert.equal(members.get(front).layers[0].clipId,id);
    for(const rear of ["rear-left","rear-right"])assert.equal(members.get(rear).layers[0].clipId,"idle");
  }
});
test("All five end death on the last fallen pose",()=>{
  for(const member of sampleFormation(definition,clips,"death",100000)) {
    assert.deepEqual(member.layers,[{clipId:"death",frame:clips.get("death").frameCount-1,weight:1}]);
  }
});
test("Charge entry joins Maintain charge without a slot or pose jump",()=>{
  assert.deepEqual(sampleFormation(definition,clips,"charge-in",1080),sampleFormation(definition,clips,"charge-maintain",0));
});
test("Maintain charge keeps the wedge and repeats without an automatic strike",()=>{
  const first=sampleFormation(definition,clips,"charge-maintain",0);
  for(const cycles of [1,2,17,200])assert.deepEqual(sampleFormation(definition,clips,"charge-maintain",540*cycles),first);
  assert.equal(definition.chargeSequence.gameplayContract.eventTransitions["charge-maintain"].contact,"charge-attack");
});
test("Charge strike starts at the tip, then the inner pair, then the rear pair",()=>{
  for(const [time,started] of [[100,["tip"]],[280,["tip","rear-left","rear-right"]],[460,["tip","left","right","rear-left","rear-right"]]]) {
    for(const member of sampleFormation(definition,clips,"charge-attack",time))
      assert.equal(member.layers.some(layer=>layer.clipId==="charge-attack"),started.includes(member.id));
  }
});
test("The standard rear pair catches up inside; the front flanks become the wedge rear pair",()=>{
  const standard=byMember(sampleFormation(definition,clips,"idle",0));
  const wedge=byMember(sampleFormation(definition,clips,"charge-maintain",0));
  for(const side of ["left","right"]) {
    const inner=wedge.get("rear-"+side),outer=wedge.get(side),tip=wedge.get("tip");
    assert.ok(inner.y>outer.y && inner.y<tip.y);
    assert.ok(Math.abs(inner.x-256)<Math.abs(outer.x-256));
    for(const id of [side,"rear-"+side])assert.ok(Math.abs(wedge.get(id).x-standard.get(id).x)<=18);
  }
  assert.deepEqual(definition.chargeSequence.wedgeRoles.innerPair,["rear-left","rear-right"]);
  assert.deepEqual(definition.chargeSequence.wedgeRoles.rearPair,["left","right"]);
});
test("Slot changes wait for the gait, and all five advance relative to the review ground",()=>{
  for(const id of ["charge-in","charge-out"]) {
    const animation=definition.animations.find(item=>item.id===id);
    const first=byMember(sampleFormation(definition,clips,id,0));
    const before=byMember(sampleFormation(definition,clips,id,animation.layoutTransitionDelayMs));
    for(const member of definition.members){assert.equal(first.get(member.id).x,before.get(member.id).x);assert.equal(first.get(member.id).y,before.get(member.id).y);}
    let previous=first;
    for(let time=10;time<=animation.durationMs;time+=10) {
      const current=byMember(sampleFormation(definition,clips,id,time));
      for(const member of definition.members)assert.ok(current.get(member.id).y+reviewTravelDistance(definition,id,time)>=previous.get(member.id).y+reviewTravelDistance(definition,id,time-10)-1e-9);
      previous=current;
    }
  }
});
test("Outer flanks open clear lanes while the rear soldiers pass them",()=>{
  for(const id of ["charge-in","charge-out"]) {
    const animation=definition.animations.find(item=>item.id===id);
    for(let time=0;time<=animation.durationMs;time+=5) {
      const members=byMember(sampleFormation(definition,clips,id,time));
      for(const side of ["left","right"]) {
        const outer=members.get(side),inner=members.get("rear-"+side);
        if(Math.abs(outer.y-inner.y)<45)assert.ok(Math.abs(outer.x-inner.x)>=94);
        assert.ok(Math.abs(outer.x-definition.layouts.standard[side].x)<=40);
      }
    }
  }
});
test("Review ground continues across loops and holds during the strike",()=>{
  const cycle=reviewTravelDistance(definition,"charge-maintain",540);
  assert.equal(reviewTravelDistance(definition,"charge-maintain",1080),cycle*2);
  let boundary=0;
  for(const step of chargeReviewSteps(definition)) {
    assert.ok(Math.abs(chargeReviewTravelDistance(definition,boundary+0.001)-chargeReviewTravelDistance(definition,boundary))<0.001);
    if(step.id==="charge-attack")assert.equal(chargeReviewTravelDistance(definition,boundary),chargeReviewTravelDistance(definition,boundary+step.durationMs));
    boundary+=step.durationMs;
  }
});
test("Charge attack recovery joins exit, and exit restores the exact original formation",()=>{
  assert.deepEqual(sampleFormation(definition,clips,"charge-attack",1300),sampleFormation(definition,clips,"charge-out",0));
  assert.deepEqual(sampleFormation(definition,clips,"charge-out",1080),sampleFormation(definition,clips,"idle",0));
});
test("Full review visits all four charge phases and ends in standard recovery",()=>{
  const steps=chargeReviewSteps(definition);assert.deepEqual(steps.map(step=>step.id),["charge-in","charge-maintain","charge-attack","charge-out"]);
  let boundary=0;for(const step of steps){assert.equal(chargeReviewPose(definition,boundary+1).id,step.id);boundary+=step.durationMs;}
  const last=chargeReviewPose(definition,boundary+100);assert.equal(last.id,"charge-out");assert.equal(last.done,true);
});
