import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AircraftPresentation } from "../../src/skirmish/client/AircraftPresentation";
import { AircraftView } from "../../src/skirmish/client/AircraftView";
import { Renderer } from "../../src/skirmish/client/Renderer";
import type { ArtworkFrame } from "../../src/skirmish/client/UnitArtwork";
import { visibleInViewport } from "../../src/skirmish/client/UnitPresentation";
import type { Aircraft } from "../../src/skirmish/domain/Definitions";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(80 * 50).fill(133);
  const match = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const snapshot = match.snapshot();
  const base = {
    id: 500,
    playerId: 1,
    type: "airstrip" as const,
    tile: 20 * snapshot.width + 20,
    remainingTicks: 0,
  };
  snapshot.buildings.push(base);
  const aircraft: Aircraft = {
    id: 501,
    playerId: 1,
    definitionId: "fighter",
    airfieldId: base.id,
    x: 20.5 * FIXED,
    y: 20.5 * FIXED,
    health: 1000,
    state: "ready",
    target: null,
    reloadTick: 0,
    fuelTicks: 1200,
  };
  snapshot.expansion!.aircraft.push(aircraft);
  const presentation = new AircraftPresentation();
  const update = () => {
    snapshot.tick++;
    presentation.update(snapshot);
  };
  update();
  return { aircraft, snapshot, presentation, update, match };
}

describe("aircraft flight presentation", () => {
  it("smoothly grows to 1.5 times parked size and shrinks through the final landing step", () => {
    const { aircraft, presentation, update } = fixture();
    expect(presentation.pose(aircraft.id)!.size).toBeCloseTo(28 * 0.8);
    aircraft.state = "outbound";
    aircraft.target = { x: aircraft.x + 30 * FIXED, y: aircraft.y };
    const sizes: number[] = [];
    for (let i = 0; i < 12; i++) {
      aircraft.x += FIXED;
      update();
      sizes.push(presentation.pose(aircraft.id)!.size);
    }
    expect(sizes.every((size, i) => !i || size > sizes[i - 1])).toBe(true);
    expect(sizes[5]).toBeCloseTo(35 * 0.8);
    expect(sizes[11]).toBeCloseTo(42 * 0.8);
    aircraft.x += FIXED;
    update();
    expect(presentation.pose(aircraft.id)!.size).toBeCloseTo(42 * 0.8);
    aircraft.state = "returning";
    for (let i = 0; i < 12; i++) {
      aircraft.x -= FIXED;
      update();
    }
    const beforeLanding = presentation.pose(aircraft.id)!.size;
    aircraft.x -= FIXED;
    aircraft.state = "ready";
    aircraft.target = null;
    update();
    expect(presentation.pose(aircraft.id, 0)!.size).toBe(beforeLanding);
    expect(presentation.pose(aircraft.id, 0.5)!.size).toBeGreaterThan(28 * 0.8);
    expect(presentation.pose(aircraft.id)!.size).toBeCloseTo(28 * 0.8);
  });

  it.each([
    [1, 0, Math.PI / 2],
    [0, 1, Math.PI],
    [-1, 0, (3 * Math.PI) / 2],
    [0, -1, 0],
  ])(
    "faces actual travel by (%s, %s), including return flights",
    (dx, dy, angle) => {
      const { aircraft, presentation, update } = fixture();
      aircraft.state = "outbound";
      aircraft.target = { x: aircraft.x + 30 * FIXED, y: aircraft.y };
      aircraft.x += dx * FIXED;
      aircraft.y += dy * FIXED;
      update();
      expect(presentation.pose(aircraft.id)!.angle).toBeCloseTo(angle);
      aircraft.state = "returning";
      aircraft.x -= dx * FIXED;
      aircraft.y -= dy * FIXED;
      update();
      const returnAngle = Math.atan2(-dy || 0, -dx || 0) + Math.PI / 2;
      expect(presentation.pose(aircraft.id)!.angle).toBeCloseTo(returnAngle);
      aircraft.state = "ready";
      aircraft.target = null;
      update();
      expect(presentation.pose(aircraft.id)!.angle).toBeCloseTo(returnAngle);
    },
  );

  it("faces the airfield when joining a return flight with a stale sortie target", () => {
    const { aircraft, snapshot, presentation } = fixture();
    aircraft.x += 20 * FIXED;
    aircraft.state = "returning";
    aircraft.target = { x: aircraft.x + 10 * FIXED, y: aircraft.y };
    presentation.reset();
    presentation.update(snapshot);
    expect(presentation.pose(aircraft.id)!.angle).toBeCloseTo(
      (3 * Math.PI) / 2,
    );
  });

  it("interpolates position and size together, preserves duplicate-tick motion, and prunes or resets aircraft", () => {
    const { aircraft, snapshot, presentation, update } = fixture();
    aircraft.state = "outbound";
    aircraft.target = { x: aircraft.x + 30 * FIXED, y: aircraft.y };
    aircraft.x += 12 * FIXED;
    update();
    const halfway = presentation.pose(aircraft.id, 0.5)!;
    expect(halfway.x).toBe(26.5 * FIXED);
    expect(halfway.size).toBeCloseTo(35 * 0.8);
    presentation.update(snapshot);
    expect(presentation.pose(aircraft.id, 0.5)).toEqual(halfway);
    expect(presentation.pose(aircraft.id, -1)!.size).toBeCloseTo(28 * 0.8);
    expect(presentation.pose(aircraft.id, 2)!.size).toBeCloseTo(42 * 0.8);
    snapshot.expansion!.aircraft.length = 0;
    update();
    expect(presentation.pose(aircraft.id)).toBeUndefined();
    snapshot.expansion!.aircraft.push(aircraft);
    update();
    presentation.reset();
    expect(presentation.pose(aircraft.id)).toBeUndefined();
  });

  it("selects the enlarged sprite at its displayed position and includes its rotated edges in culling", () => {
    const { aircraft, snapshot, presentation, update } = fixture();
    aircraft.state = "outbound";
    aircraft.target = { x: aircraft.x + 30 * FIXED, y: aircraft.y };
    aircraft.x += 12 * FIXED;
    update();
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      snapshot,
      aircraftPresentation: presentation,
      aircraftBlend: 1,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }) as Renderer;
    expect(renderer.aircraftAt(32.5 + 25, 20.5)).toBe(aircraft.id);
    const pose = presentation.pose(aircraft.id)!;
    expect(renderer.aircraftAt(32.5 + pose.radius + 1, 20.5)).toBeNull();
    expect(visibleInViewport({ x: -25, y: 50 }, pose.radius, 100, 100)).toBe(
      true,
    );
    aircraft.playerId = 2;
    expect(renderer.aircraftAt(32.5, 20.5)).toBeNull();
  });

  it("follows a real simulation sortie through cruise, return and landing without changing aircraft state", () => {
    const { aircraft, snapshot, presentation, match } = fixture();
    aircraft.definitionId = "bomber";
    match.addBuilding(
      snapshot.buildings.find((b) => b.id === aircraft.airfieldId)!,
    );
    const departure = { x: aircraft.x, y: aircraft.y };
    expect(
      match.applyCommand({
        type: "sortie",
        playerId: 1,
        aircraftIds: [aircraft.id],
        x: aircraft.x + 30 * FIXED,
        y: aircraft.y,
      }),
    ).toBeNull();
    const sizes: number[] = [];
    const states = new Set<string>();
    for (let tick = 0; tick < 100; tick++) {
      match.step();
      const before = structuredClone(aircraft);
      presentation.update(match.snapshot());
      const pose = presentation.pose(aircraft.id)!;
      sizes.push(pose.size);
      states.add(aircraft.state);
      expect(aircraft).toEqual(before);
      if (aircraft.state === "ready") break;
    }
    expect([...states]).toEqual(["outbound", "returning", "ready"]);
    expect(Math.max(...sizes)).toBe(42);
    expect(sizes[sizes.length - 1]).toBe(28);
    expect({ x: aircraft.x, y: aircraft.y }).toEqual(departure);
    expect(presentation.pose(aircraft.id)!.angle).toBeCloseTo(
      (3 * Math.PI) / 2,
    );
  });
});

describe("aircraft drawing", () => {
  it("draws loaded artwork without an arrow stroke and uses a separate ring only when selected", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const frame: ArtworkFrame = {
      source: {} as CanvasImageSource,
      x: 0,
      y: 0,
      width: 128,
      height: 128,
      pivotX: 0.5,
      pivotY: 0.5,
      extent: 1,
    };
    const view = new AircraftView();
    const pose = { angle: Math.PI / 2, size: 56, radius: 42 };
    view.draw(ctx, { x: 100, y: 100 }, pose, frame, "#fff", false);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      frame.source,
      0,
      0,
      128,
      128,
      -28,
      -28,
      56,
      56,
    );
    expect(ctx.stroke).not.toHaveBeenCalled();
    view.draw(ctx, { x: 100, y: 100 }, pose, frame, "#fff", true);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 42, 0, Math.PI * 2);
  });
});
