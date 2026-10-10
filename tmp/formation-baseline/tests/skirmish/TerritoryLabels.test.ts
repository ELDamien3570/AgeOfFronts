import { describe, expect, it } from "vitest";
import {
  ownsCamp,
  type TerritoryLabel,
  TerritoryLabelViewModel,
} from "../../src/skirmish/client/TerritoryLabelViewModel";
import type { Player, Snapshot } from "../../src/skirmish/Protocol";

function fixture(width = 160, height = 120) {
  const player = (id: number, name: string): Player => ({
    id,
    name,
    ai: true,
    kind: id === 3 ? "tribe" : "regular",
    base: 0,
    reserves: 0,
    gold: 0,
    land: 0,
    losses: 0,
    recruited: 0,
    eliminated: false,
  });
  const snapshot: Snapshot = {
    tick: 0,
    width,
    height,
    owners: new Uint8Array(width * height),
    claims: new Uint8Array(width * height),
    progress: new Uint8Array(width * height),
    players: [
      player(1, "Green Kingdom"),
      player(2, "Blue Republic"),
      player(3, "Tribe 1"),
    ],
    buildings: [],
    squads: [],
    ships: [],
    volleys: [],
    winner: null,
    combatTicks: 0,
  };
  const paint = (owner: number, accepts: (x: number, y: number) => boolean) => {
    const changed: number[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const tile = y * width + x;
        if (accepts(x, y) && snapshot.owners[tile] !== owner) {
          snapshot.owners[tile] = owner;
          changed.push(tile);
        }
      }
    snapshot.changedTiles = new Uint32Array(changed);
  };
  return { snapshot, paint, model: new TerritoryLabelViewModel(width, height) };
}

function settle(model: TerritoryLabelViewModel, now = 0): void {
  // Geometry finishes on rendered frames, even without further publications.
  for (let frame = 0; frame < 160; frame++) model.advance(now);
}

function expectInterior(label: TerritoryLabel, snapshot: Snapshot): void {
  const c = Math.cos(label.angle),
    s = Math.sin(label.angle);
  // Validate the fitted footprint, including its edges, against actual land.
  for (let row = 0; row <= 12; row++)
    for (let col = 0; col <= 36; col++) {
      const u = (col / 36 - 0.5) * label.width * 0.99;
      const v = (row / 12 - 0.5) * label.height * 0.99;
      const x = Math.floor(label.x + u * c - v * s);
      const y = Math.floor(label.y + u * s + v * c);
      expect(snapshot.owners[y * snapshot.width + x]).toBe(label.playerId);
    }
}

describe("territory name presentation", () => {
  it("does not leave a defeated tribe's name or camp marker on captured land", () => {
    const { model, snapshot, paint } = fixture();
    paint(3, (x, y) => x > 10 && x < 65 && y > 15 && y < 65);
    const tribe = snapshot.players[2];
    tribe.base = 30 * snapshot.width + 30;
    model.update(snapshot);
    settle(model);
    expect(model.labels.map((l) => l.name)).toEqual(["Tribe 1"]);
    expect(ownsCamp(snapshot, tribe)).toBe(true);
    paint(1, (_, y) => y > 15 && y < 65);
    tribe.eliminated = true;
    model.update(snapshot);
    expect(model.labels).toEqual([]);
    expect(ownsCamp(snapshot, tribe)).toBe(false);
    settle(model, 2000);
    expect(model.labels.map((l) => l.name)).toEqual(["Green Kingdom"]);
  });

  it("removes a captured camp marker while a surviving faction keeps its land label", () => {
    const { model, snapshot, paint } = fixture();
    paint(2, (x, y) => x > 20 && x < 110 && y > 20 && y < 80);
    const player = snapshot.players[1];
    player.base = 21 * snapshot.width + 21;
    model.update(snapshot);
    settle(model);
    expect(ownsCamp(snapshot, player)).toBe(true);
    paint(1, (x, y) => x === 21 && y === 21);
    model.update(snapshot);
    expect(ownsCamp(snapshot, player)).toBe(false);
    expect(model.labels.some((l) => l.playerId === 2)).toBe(true);
  });

  it("uses the largest connected region rather than an island or the old camp", () => {
    const { model, snapshot, paint } = fixture();
    paint(
      1,
      (x, y) =>
        (x > 15 && x < 105 && y > 20 && y < 85) ||
        (x > 130 && x < 145 && y > 95 && y < 110),
    );
    snapshot.players[0].base = 100 * snapshot.width + 135;
    model.update(snapshot);
    settle(model);
    const label = model.labels[0];
    expect(label.x).toBeLessThan(105);
    expect(label.y).toBeLessThan(85);
    expect(label.width).toBeGreaterThan(65);
    expectInterior(label, snapshot);
  });

  it("angles elongated countries to their shape and fits inside their borders", () => {
    const { model, snapshot, paint } = fixture();
    const angle = 0.45,
      c = Math.cos(angle),
      s = Math.sin(angle);
    paint(
      1,
      (x, y) =>
        Math.abs((x - 80) * c + (y - 60) * s) < 62 &&
        Math.abs(-(x - 80) * s + (y - 60) * c) < 18,
    );
    model.update(snapshot);
    settle(model);
    const label = model.labels[0];
    expect(label.angle).toBeCloseTo(angle, 1);
    expect(label.width).toBeGreaterThan(90);
    expectInterior(label, snapshot);
  });

  it("keeps lettering out of bays, enclaves, and holes in concave territory", () => {
    const { model, snapshot, paint } = fixture();
    paint(
      1,
      (x, y) =>
        x > 10 && x < 145 && y > 10 && y < 105 && !(x > 65 && y > 35 && y < 75),
    );
    model.update(snapshot);
    settle(model);
    expectInterior(model.labels[0], snapshot);
  });

  it("grows with newly acquired territory and ignores claim-only deltas", () => {
    const { model, snapshot, paint } = fixture();
    paint(1, (x, y) => x > 20 && x < 70 && y > 20 && y < 65);
    model.update(snapshot);
    settle(model);
    const before = model.labels[0];
    snapshot.changedTiles = new Uint32Array([0]);
    snapshot.claims[0] = 1;
    snapshot.progress[0] = 50;
    model.update(snapshot);
    settle(model, 2000);
    expect(model.labels[0]).toEqual(before);
    paint(1, (x, y) => x > 20 && x < 140 && y > 20 && y < 95);
    model.update(snapshot);
    settle(model, 2000);
    expect(model.labels[0].width).toBeGreaterThan(before.width * 2);
    expectInterior(model.labels[0], snapshot);
  });

  it("hides a cached name immediately when its anchor is captured, then relocates it", () => {
    const { model, snapshot, paint } = fixture();
    paint(1, (x, y) => x > 15 && x < 145 && y > 15 && y < 105);
    model.update(snapshot);
    settle(model);
    const anchor = model.labels[0];
    paint(
      2,
      (x, y) => Math.abs(x - anchor.x) < 12 && Math.abs(y - anchor.y) < 12,
    );
    model.update(snapshot);
    expect(model.labels.some((l) => l.playerId === 1)).toBe(false);
    settle(model, 2000);
    expectInterior(model.labels.find((l) => l.playerId === 1)!, snapshot);
  });

  it("filters eliminated or removed factions even before ownership changes arrive", () => {
    const { model, snapshot, paint } = fixture();
    paint(3, (x, y) => x < 80 && y < 80);
    model.update(snapshot);
    settle(model);
    snapshot.players[2].eliminated = true;
    model.update(snapshot);
    expect(model.labels).toEqual([]);
    snapshot.players = snapshot.players.slice(0, 2);
    model.update(snapshot);
    settle(model, 2000);
    expect(model.labels).toEqual([]);
  });

  it("finishes a large layout safely when ownership changes during its incremental work", () => {
    const { model, snapshot, paint } = fixture(1000, 500);
    paint(1, () => true);
    model.update(snapshot);
    model.advance(0);
    paint(2, (x) => x >= 500);
    model.update(snapshot);
    for (let frame = 0; frame < 500; frame++) model.advance(2000 + frame * 17);
    expect(model.labels).toHaveLength(2);
    for (const label of model.labels) {
      expect(label.width).toBeLessThan(500);
      expectInterior(label, snapshot);
    }
  });
});
