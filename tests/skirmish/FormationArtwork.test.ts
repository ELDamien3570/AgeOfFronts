import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ARTWORK_CATALOG } from "../../src/skirmish/client/ArtworkCatalog";
import {
  squadFormationType,
  tintFormationPixels,
} from "../../src/skirmish/client/FormationArtwork";
import { shipSymbol, squadSymbol } from "../../src/skirmish/client/MapSymbols";
import { UnitPresentation } from "../../src/skirmish/client/UnitPresentation";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("formation artwork", () => {
  it("gives the field ram the siege marker and the earliest authored ram animations without changing its domain identity", () => {
    expect(
      squadFormationType({ kind: "archer", definitionId: "stoneage-siege" }),
    ).toBe("siege");
    expect(
      squadFormationType({ kind: "archer", definitionId: "bronzeage-siege" }),
    ).toBe("siege");
    expect(
      squadFormationType({ kind: "archer", definitionId: "stoneage-archer" }),
    ).toBe("archer");
    expect(squadFormationType({ kind: "infantry" })).toBe("infantry");
    const ram = ARTWORK_CATALOG["stoneage-siege"];
    expect(ram).toBe(ARTWORK_CATALOG["bronzeage-siege"]);
    expect(ram.facing).toBe("screen-up");
    for (const clip of ["idle", "movement", "attack"])
      expect(ram.clips![clip].file).toBe(`bronzeage-siege-${clip}.png`);
    const symbol = squadSymbol(1, 1000, false, "siege");
    expect(symbol.height).toBe(symbol.width);
    expect(symbol.hitRadius).toBeCloseTo(
      Math.hypot(symbol.width, symbol.height) / 2,
    );
    expect(symbol.viewRadius).toBe(symbol.hitRadius);
    expect(squadSymbol(14, 1000, true, "siege").artwork).toBe(true);
  });

  it("tints white and shaded fields while preserving black symbols and every alpha value", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, 128, 128, 128, 127, 0, 0, 0, 255, 255, 255, 255, 0,
    ]);
    tintFormationPixels(pixels, "#62d5cc");
    expect([...pixels]).toEqual([
      98, 213, 204, 255, 49, 107, 102, 127, 0, 0, 0, 255, 98, 213, 204, 0,
    ]);
  });

  it("keeps distant ship markers readable and includes their corners in selection bounds", () => {
    const far = shipSymbol(1, true);
    expect(far.formation).toBe(true);
    expect(far.height).toBe(8);
    expect(shipSymbol(8, true).height).toBe(24);
    expect(far.height).toBeGreaterThan(far.width);
    expect(far.hitRadius).toBeGreaterThan(
      Math.hypot(far.width, far.height) / 2,
    );
    expect(far.viewRadius).toBe(far.hitRadius);
    expect(shipSymbol(14, true).formation).toBe(false);
    expect(shipSymbol(1, false).formation).toBe(false);
  });

  it("faces ships along travel, retains their heading while held, and resets removed ships", () => {
    const terrain = new Uint8Array(80 * 40).fill(133);
    const match = new Skirmish(
      new GameMapImpl(80, 40, terrain, terrain.length),
      { seed: 42, aiCount: 1, runAi: false },
    );
    const snapshot = match.snapshot();
    const ship = {
      id: 500,
      playerId: 1,
      kind: "transport" as const,
      x: 20 * FIXED,
      y: 20 * FIXED,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
    };
    snapshot.ships.push(ship);
    const presentation = new UnitPresentation();
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBe(0);
    ship.x += FIXED;
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBeCloseTo(Math.PI / 2);
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBeCloseTo(Math.PI / 2);
    ship.y -= FIXED;
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBeCloseTo(0);
    snapshot.ships.length = 0;
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBe(0);
    snapshot.ships.push(ship);
    presentation.update(snapshot);
    ship.y += FIXED;
    presentation.update(snapshot);
    expect(presentation.shipAngle(ship.id)).toBeCloseTo(Math.PI);
    presentation.reset();
    expect(presentation.shipAngle(ship.id)).toBe(0);
  });
});
