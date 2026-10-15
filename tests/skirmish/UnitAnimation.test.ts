import {TICKS_PER_SECOND} from '../../src/skirmish/Protocol';
const presentationTicks=(seconds:number)=>seconds*TICKS_PER_SECOND;
import {secondsToTicks} from '../../src/skirmish/Protocol';
import { retainSquads } from "./UnitFixtures";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  animationFrame,
  meleeLungeRatio,
  PresentationClock,
  squadSpriteSize,
  UNIT_ANIMATIONS,
} from "../../src/skirmish/client/UnitAnimation";
import { UnitPresentation } from "../../src/skirmish/client/UnitPresentation";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { meleeContact } from "../../src/skirmish/SquadGeometry";

function duel(kind: "infantry" | "archer" | "cavalry") {
  const terrain = new Uint8Array(80 * 40).fill(133);
  const match = new Skirmish(new GameMapImpl(80, 40, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
  });
  const unit = match.squads[0],
    enemy = match.squads.find((s) => s.playerId === 2)!;
  retainSquads(match, [unit, enemy]);
  match.updateSquad(unit.id, { kind: kind });
  match.updateSquad(unit.id, { x: 30 * FIXED });
  match.updateSquad(unit.id, { y: 20 * FIXED });
  match.updateSquad(enemy.id, { x: (kind === "archer" ? 35 : 31) * FIXED });
  match.updateSquad(enemy.id, { y: unit.y });
  return { match, unit, enemy };
}

describe("authored sprite animation contract", () => {
  it("uses every authored frame without sampling outside any sheet", () => {
    for (const metadata of Object.values(UNIT_ANIMATIONS)) {
      expect(metadata.facing).toBe("screen-down");
      expect(metadata.normalizedPivot).toEqual({ x: 0.5, y: 0.5 });
      for (const clip of Object.values(metadata.animations)) {
        expect(clip.frames.length).toBe(clip.frameCount);
        for (const frame of clip.frames) {
          expect(frame.x).toBeGreaterThanOrEqual(0);
          expect(frame.y).toBeGreaterThanOrEqual(0);
          expect(frame.x + frame.width).toBeLessThanOrEqual(
            metadata.sheetSize.width,
          );
          expect(frame.y + frame.height).toBeLessThanOrEqual(
            metadata.sheetSize.height,
          );
        }
      }
    }
  });
  it("loops idle and running at their authored rates, while a one-shot attack clamps", () => {
    expect(animationFrame("infantry", "idle", presentationTicks(1.25))).toBe(0);
    expect(animationFrame("cavalry", "running", presentationTicks(0.25))).toBe(3);
    expect(animationFrame("archer", "attack", presentationTicks(0.9))).toBe(9);
    expect(animationFrame("archer", "attack", presentationTicks(2.5))).toBe(9);
    expect(animationFrame("infantry", "attack", presentationTicks(1.2), true)).toBe(2);
  });
  it("lets close-zoom squads grow for readability without inflating distant art", () => {
    for (const zoom of [1, 5, 12, 22, 32, 48, 96])
      for (const troops of [1, 500, 1000]) {
        expect(squadSpriteSize(zoom, troops) / zoom).toBeLessThanOrEqual(2);
        expect(squadSpriteSize(zoom, troops)).toBeLessThanOrEqual(55);
        expect(squadSpriteSize(zoom, troops)).toBeGreaterThan(0);
      }
    expect(squadSpriteSize(12, 1_000)).toBe(24);
    expect(squadSpriteSize(1, 1_000)).toBe(2);
    expect(squadSpriteSize(22, 1_000)).toBe(44);
    expect(squadSpriteSize(40, 1_000)).toBe(55);
    expect(squadSpriteSize(96, 1_000)).toBe(55);
    expect(squadSpriteSize(12, 500)).toBeCloseTo(21.6);
  });
});

describe("presentation time", () => {
  it("tracks match speed, freezes during pause, ignores repeated ticks, and bounds worker stalls", () => {
    const clock = new PresentationClock();
    clock.update(presentationTicks(1), 1000);
    expect(clock.sample(1025, 1, false)).toBe(presentationTicks(1.025));
    expect(clock.sample(1025, 4, false)).toBe(presentationTicks(1.1));
    clock.update(presentationTicks(1), 1025);
    expect(clock.sample(1040, 1, false)).toBe(presentationTicks(1.04));
    expect(clock.sample(10000, 4, false)).toBe(12);
    expect(clock.sample(10000, 4, true)).toBe(presentationTicks(1));
    clock.reset();
    clock.update(0, 11000);
    expect(clock.sample(11000, 1, true)).toBe(0);
  });
});

describe("simulation-driven unit animation", () => {
  it("peaks at the authored melee strike, returns smoothly, and gives cavalry a smaller lunge", () => {
    for (const kind of ["infantry", "cavalry"] as const) {
      expect(meleeLungeRatio(kind, -1)).toBe(0);
      expect(meleeLungeRatio(kind, presentationTicks(0.3))).toBe(0);
      const peak = meleeLungeRatio(kind, presentationTicks(0.5));
      expect(animationFrame(kind, "attack", presentationTicks(0.5), true)).toBe(5);
      expect(peak).toBeGreaterThan(0);
      expect(meleeLungeRatio(kind, presentationTicks(0.4))).toBeCloseTo(peak / 2);
      expect(meleeLungeRatio(kind, presentationTicks(0.65))).toBeCloseTo(peak / 2);
      expect(meleeLungeRatio(kind, presentationTicks(0.8))).toBe(0);
      expect(meleeLungeRatio(kind, presentationTicks(1))).toBe(0);
      expect(meleeLungeRatio(kind, presentationTicks(1.5))).toBeCloseTo(peak);
      expect(meleeLungeRatio(kind, presentationTicks(0.49995))).toBeCloseTo(peak);
      expect(meleeLungeRatio(kind, presentationTicks(0.50005))).toBeCloseTo(peak);
    }
    expect(meleeLungeRatio("cavalry", presentationTicks(0.5))).toBeLessThan(
      meleeLungeRatio("infantry", presentationTicks(0.5)),
    );
    expect(meleeLungeRatio("archer", presentationTicks(0.5))).toBe(0);
  });

  it("lunges toward the target with bounded clearance without mutating the simulation snapshot", () => {
    const { match, unit, enemy } = duel("infantry");
    match.updateSquad(enemy.id, { x: unit.x + meleeContact(unit.kind, enemy.kind) });
    match.step();
    const snapshot = match.snapshot(),
      before = JSON.stringify(snapshot);
    const presentation = new UnitPresentation();
    presentation.update(snapshot);
    const tick = match.tick;
    expect(presentation.meleeLunge(unit.id, tick, 20, 40)).toEqual({
      x: 0,
      y: 0,
    });
    const strike = presentation.meleeLunge(unit.id, tick + presentationTicks(.5), 20, 40);
    expect(strike.x).toBeCloseTo(2.5);
    expect(strike.y).toBeCloseTo(0);
    expect(presentation.meleeLunge(unit.id, tick + presentationTicks(.4), 20, 40).x).toBeCloseTo(
      1.25,
    );
    expect(presentation.meleeLunge(unit.id, tick + presentationTicks(.8), 20, 40).x).toBe(0);
    expect(presentation.meleeLunge(unit.id, tick + presentationTicks(.5), 1, 2).x).toBeCloseTo(
      0.125,
    );
    expect(JSON.stringify(snapshot)).toBe(before);
    expect([unit.x, unit.y, enemy.x, enemy.y]).toEqual([
      30 * FIXED,
      20 * FIXED,
      30 * FIXED + meleeContact(unit.kind, enemy.kind),
      20 * FIXED,
    ]);
  });

  it("restarts the wind-up on retargeting and cancels the lunge on movement, boarding, or target removal", () => {
    const { match, unit, enemy } = duel("infantry");
    match.updateSquad(enemy.id, { x: unit.x + meleeContact(unit.kind, enemy.kind) });
    match.step();
    const presentation = new UnitPresentation();
    presentation.update(match.snapshot());
    const next = match.addSquad({
      ...enemy,
      id: 999,
      x: unit.x,
      y: unit.y + meleeContact(unit.kind, enemy.kind),
    });

    match.updateSquad(unit.id, { combatTargetId: next.id });
    match.tick = presentationTicks(0.6);
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(0.6)).frame).toBe(0);
    const strike = presentation.meleeLunge(unit.id, presentationTicks(1.1), 20, 40);
    expect(strike.x).toBeCloseTo(0);
    expect(strike.y).toBeGreaterThan(0);
    match.updateSquad(unit.id, { moved: true });
    presentation.update(match.snapshot());
    expect(presentation.meleeLunge(unit.id, presentationTicks(1.1), 20, 40)).toEqual({
      x: 0,
      y: 0,
    });
    match.updateSquad(unit.id, { moved: false });
    match.updateSquad(next.id, { embarkedOn: 100 });
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(1.1)).clip).toBe("idle");
    expect(presentation.meleeLunge(unit.id, presentationTicks(1.1), 20, 40)).toEqual({
      x: 0,
      y: 0,
    });
    match.updateSquad(next.id, { embarkedOn: null });
    match.updateSquad(unit.id, { embarkedOn: 100 });
    presentation.update(match.snapshot());
    expect(presentation.meleeLunge(unit.id, presentationTicks(1.1), 20, 40)).toEqual({
      x: 0,
      y: 0,
    });
    for (const record of match.squads) match.removeSquad(record.id);
    presentation.update(match.snapshot());
    expect(presentation.meleeLunge(unit.id, presentationTicks(1.1), 20, 40)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("switches between idle, running, and attack; taking ranged damage alone does not trigger melee swings", () => {
    const { match, unit, enemy } = duel("infantry");
    const presentation = new UnitPresentation();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, 0).clip).toBe("idle");
    match.updateSquad(unit.id, { moved: true });
    match.updateSquad(unit.id, { x: unit.x + (FIXED / 2) });
    match.tick = presentationTicks(.05);
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(0.3))).toEqual({
      clip: "running",
      frame: 3,
    });
    match.updateSquad(unit.id, { moved: false });
    match.step();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, match.tick).clip).toBe("attack");
    expect(presentation.angle(unit.id)).toBeCloseTo(-Math.PI / 2);
    match.updateSquad(enemy.id, { kind: "archer" });
    match.updateSquad(enemy.id, { x: unit.x + 5 * FIXED });
    for (let i = 0; i < presentationTicks(1); i++) match.step();
    expect(unit.fighting).toBe(true);
    expect(unit.combatTargetId).toBeNull();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, match.tick).clip).toBe("idle");
    presentation.reset();
    expect(presentation.animation(unit.id, presentationTicks(49.95))).toEqual({
      clip: "idle",
      frame: 0,
    });
  });
  it("winds up ranged attacks from charge, releases on the actual volley, and does not restart retained events", () => {
    const { match, unit } = duel("archer");
    const presentation = new UnitPresentation();
    for (let tick = 0; tick < Math.floor(presentationTicks(0.45)); tick++) match.step();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(0.45)).clip).toBe("idle");
    match.step();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(0.5))).toEqual({
      clip: "attack",
      frame: 0,
    });
    for (let tick = 0; tick < presentationTicks(0.5); tick++) match.step();
    presentation.update(match.snapshot());
    expect(match.volleys[0].squadId).toBe(unit.id);
    expect(presentation.animation(unit.id, presentationTicks(1))).toEqual({
      clip: "attack",
      frame: 5,
    });
    match.step();
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(1.1))).toEqual({
      clip: "attack",
      frame: 6,
    });
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(1.4))).toEqual({
      clip: "attack",
      frame: 9,
    });
    match.updateSquad(unit.id, { embarkedOn: 9 });
    match.updateSquad(unit.id, { firingCharge: 0 });
    match.updateSquad(unit.id, { combatTargetId: null });
    presentation.update(match.snapshot());
    match.updateSquad(unit.id, { embarkedOn: null });
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(1.1)).clip).toBe("idle");
  });
  it("keeps moving ranged squads running during the long cooldown and discards stale playback across embarkation and removal", () => {
    const { match, unit } = duel("archer");
    const presentation = new UnitPresentation();
    match.tick = presentationTicks(3);
    match.updateSquad(unit.id, { moved: true });
    match.updateSquad(unit.id, { firingCharge: 60 });
    match.updateSquad(unit.id, { combatTargetId: match.squads[1].id });
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(3)).clip).toBe("running");
    match.updateSquad(unit.id, { firingCharge: 95 });
    match.tick = presentationTicks(4.75);
    presentation.update(match.snapshot());
    expect(presentation.animation(unit.id, presentationTicks(4.75))).toEqual({
      clip: "attack",
      frame: 2,
    });
    match.updateSquad(unit.id, { embarkedOn: 9 });
    presentation.update(match.snapshot());
    for (const record of match.squads.slice(0, (0) + (1))) match.removeSquad(record.id);
    presentation.update(match.snapshot());
    expect(presentation.angle(unit.id)).toBe(0);
    expect(presentation.animation(unit.id, presentationTicks(5))).toEqual({
      clip: "idle",
      frame: 0,
    });
  });
});
