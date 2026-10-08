import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {sampleFormation, chargeReviewSteps, chargeReviewPose, reviewTravelDistance, chargeReviewTravelDistance, clipDuration} from "../../Clubman/Formation/formation-composition.js";

const definition = JSON.parse(await fs.readFile(new URL("formation.json", import.meta.url), "utf8"));
const actor = JSON.parse(await fs.readFile(new URL("../animations.json", import.meta.url), "utf8"));
const clips = new Map(actor.animations.map(clip => [clip.id, clip]));
const animation = id => definition.animations.find(clip => clip.id === id);
const byMember = members => new Map(members.map(member => [member.id, member]));

test("Every animation preserves five unique horse/rider members with complete pose weights", () => {
  for (const clip of definition.animations) for (let time = 0; time <= clip.durationMs; time += 10) {
    const members = sampleFormation(definition, clips, clip.id, time);
    assert.equal(members.length, 5);
    assert.equal(new Set(members.map(member => member.id)).size, 5);
    for (const member of members) {
      assert.ok(Number.isFinite(member.x) && Number.isFinite(member.y));
      assert.ok(Math.abs(member.layers.reduce((sum, pose) => sum + pose.weight, 0) - 1) < 1e-9);
    }
  }
});

test("The approved horse gallop supplies entry and maintenance, and the walk remains distinct", () => {
  assert.equal(actor.visualApproval.status, "approved");
  assert.equal(clips.get("charge").file, "Charge-v5.png");
  assert.equal(clips.get("running").file, "Running-v2.png");
  assert.equal(animation("charge-in").source, "charge");
  assert.equal(animation("charge-maintain").source, "charge");
  assert.equal(animation("charge-maintain").durationMs, clipDuration(clips.get("charge")));
});

test("Standard rear riders become the inner pair, with clear lanes through both transitions", () => {
  const wedge = byMember(sampleFormation(definition, clips, "charge-maintain", 0));
  for (const side of ["left", "right"]) {
    const inner = wedge.get("rear-" + side), outer = wedge.get(side), tip = wedge.get("tip");
    assert.ok(outer.y < inner.y && inner.y < tip.y);
    assert.ok(Math.abs(inner.x - 256) < Math.abs(outer.x - 256));
  }
  for (const id of ["charge-in", "charge-out"]) for (let time = 0; time <= animation(id).durationMs; time += 5) {
    const members = byMember(sampleFormation(definition, clips, id, time));
    for (const side of ["left", "right"]) {
      const outer = members.get(side), inner = members.get("rear-" + side);
      if (Math.abs(outer.y - inner.y) < 45) assert.ok(Math.abs(outer.x - inner.x) >= 94);
    }
  }
});

test("Local rank changes begin after the gait blend and preserve forward motion against the review ground", () => {
  for (const id of ["charge-in", "charge-out"]) {
    const clip = animation(id);
    const first = byMember(sampleFormation(definition, clips, id, 0));
    const before = byMember(sampleFormation(definition, clips, id, clip.layoutTransitionDelayMs));
    for (const member of definition.members) {
      assert.equal(first.get(member.id).x, before.get(member.id).x);
      assert.equal(first.get(member.id).y, before.get(member.id).y);
    }
    let previous = first;
    for (let time = 10; time <= clip.durationMs; time += 10) {
      const current = byMember(sampleFormation(definition, clips, id, time));
      for (const member of definition.members) assert.ok(current.get(member.id).y + reviewTravelDistance(definition, id, time) >= previous.get(member.id).y + reviewTravelDistance(definition, id, time - 10) - 1e-9);
      previous = current;
    }
  }
});

test("Charge entry joins a repeatable wedge gallop without a slot or pose jump", () => {
  const first = sampleFormation(definition, clips, "charge-maintain", 0);
  assert.deepEqual(sampleFormation(definition, clips, "charge-in", animation("charge-in").durationMs), first);
  for (const cycles of [1, 2, 17, 200]) assert.deepEqual(sampleFormation(definition, clips, "charge-maintain", animation("charge-maintain").durationMs * cycles), first);
});

test("Spear charge strikes progress from tip to inner pair to trailing pair", () => {
  for (const [time, started] of [[100, ["tip"]], [280, ["tip", "rear-left", "rear-right"]], [460, ["tip", "left", "right", "rear-left", "rear-right"]]]) {
    for (const member of sampleFormation(definition, clips, "charge-attack", time)) assert.equal(member.layers.some(pose => pose.clipId === "charge-attack"), started.includes(member.id));
  }
});

test("Death and charge impact hit the front rank before either rear rider reacts", () => {
  for (const id of ["death", "charged"]) {
    const members = byMember(sampleFormation(definition, clips, id, 200));
    for (const front of ["tip", "left", "right"]) assert.equal(members.get(front).layers[0].clipId, animation(id).memberSources?.[front] || id);
    for (const rear of ["rear-left", "rear-right"]) assert.equal(members.get(rear).layers[0].clipId, "idle");
  }
});

test("Both ranks mix together-fall and thrown-rider deaths; every member holds its complete final pose", () => {
  const death = animation("death");
  for (const rank of [["tip", "left", "right"], ["rear-left", "rear-right"]]) assert.equal(new Set(rank.map(id => death.memberSources[id])).size, 2);
  assert.equal(Object.values(death.memberSources).filter(id => id === "death-thrown").length, 2);
  for (const member of sampleFormation(definition, clips, "death", Infinity)) {
    const source = death.memberSources[member.id];
    assert.deepEqual(member.layers, [{clipId:source, frame:clips.get(source).frameCount - 1, weight:1}]);
    assert.ok((death.memberStartMs[member.id] || 0) + clipDuration(clips.get(source)) <= death.durationMs);
  }
});

test("Attack recovery joins exit, and exit restores the exact original ranks and idle poses", () => {
  assert.deepEqual(sampleFormation(definition, clips, "charge-attack", animation("charge-attack").durationMs), sampleFormation(definition, clips, "charge-out", 0));
  assert.deepEqual(sampleFormation(definition, clips, "charge-out", animation("charge-out").durationMs), sampleFormation(definition, clips, "idle", 0));
});

test("The full review visits four charge phases and continues forward travel across gallop loops", () => {
  const steps = chargeReviewSteps(definition);
  assert.deepEqual(steps.map(step => step.id), ["charge-in", "charge-maintain", "charge-attack", "charge-out"]);
  let boundary = 0;
  for (const step of steps) {
    assert.equal(chargeReviewPose(definition, boundary + 1).id, step.id);
    assert.ok(Math.abs(chargeReviewTravelDistance(definition, boundary + 0.001) - chargeReviewTravelDistance(definition, boundary)) < 0.001);
    boundary += step.durationMs;
  }
  assert.equal(chargeReviewPose(definition, boundary + 100).done, true);
  assert.equal(reviewTravelDistance(definition, "charge-maintain", 1080), reviewTravelDistance(definition, "charge-maintain", 540) * 2);
});

test("Baked charge markers retain all five ordered spear-impact times without projectile release markers", async () => {
  const baked = JSON.parse(await fs.readFile(new URL("animations.json", import.meta.url), "utf8"));
  const thrust = baked.animations.find(clip => clip.id === "charge-attack");
  const source = clips.get("charge-attack"), lead = source.durations.slice(0, source.impactFrame).reduce((sum, value) => sum + value, 0);
  assert.equal(thrust.presentationStrikeMarkers.length, 5);
  for (const marker of thrust.presentationStrikeMarkers) assert.equal(marker.timeMs, lead + (animation("charge-attack").memberStartMs[marker.memberId] || 0));
  assert.equal(thrust.presentationReleaseMarkers, undefined);
});
