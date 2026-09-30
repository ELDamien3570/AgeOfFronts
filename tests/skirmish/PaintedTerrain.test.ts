import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";
import {
  PaintedTerrain,
  paintedCell,
} from "../../src/skirmish/client/PaintedTerrain";
import { TerrainDecorations } from "../../src/skirmish/client/TerrainDecorations";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";

vi.mock("../../src/skirmish/client/TerrainArtwork", () => ({
  TerrainArtwork: class {
    get() {
      return { terrainImage: true };
    }
  },
}));
afterEach(() => vi.unstubAllGlobals());
function context() {
  return {
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  };
}

describe("building clearance in cached terrain", () => {
  it("redraws shared forest ground across seams even when distant zoom hides all sprites", () => {
    const created: ReturnType<typeof context>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const ctx = context();
        created.push(ctx);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    const map = createSkirmishMap(
        192,
        128,
        new Uint8Array(192 * 128).fill(133),
        undefined,
        { cover: new Uint8Array(192 * 128).fill(255) },
      ),
      ground = new PaintedTerrain(map),
      tile = map.ref(64, 20),
      environment = new TerrainEnvironment(map),
      before = paintedCell(map, tile, undefined, environment).color,
      ctx = context() as unknown as CanvasRenderingContext2D;
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(6);
    const site = { tile, type: "city" as const };
    ground.updateBuildings([site]);
    expect(forestOf(map)!.coverAt(tile)).toBe(0);
    expect(paintedCell(map, tile, undefined, environment).color).not.toBe(
      before,
    );
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(8);
    ground.updateBuildings([site, site]);
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(8);
  });
  it("invalidates both sides of a chunk seam and every cached zoom level, leaving distant chunks cached", () => {
    const created: ReturnType<typeof context>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const ctx = context();
        created.push(ctx);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    const map = new GameMapImpl(
        192,
        128,
        new Uint8Array(192 * 128).fill(128),
        192 * 128,
      ),
      field = new TerrainDecorations(map, new TerrainEnvironment(map)),
      placed = Array.from(
        field.visible({ left: 0, top: 0, right: 192, bottom: 128 }),
      ).find(
        (accent) =>
          accent.imageBounds.left < 64 &&
          accent.imageBounds.right > 64 &&
          accent.y > 5 &&
          accent.y < 50,
      )!;
    expect(placed).toBeDefined();
    const ground = new PaintedTerrain(map),
      ctx = context() as unknown as CanvasRenderingContext2D;
    const draw = (scale: number) =>
      ground.draw(ctx, scale, 0, 0, 192 * scale, 128 * scale);
    draw(2);
    draw(5);
    draw(14);
    expect(created).toHaveLength(18);
    draw(2);
    draw(5);
    draw(14);
    expect(created).toHaveLength(18);
    const building = {
      tile: map.ref(Math.floor(placed.x), Math.floor(placed.y)),
      type: "city" as const,
    };
    ground.updateBuildings([building]);
    draw(2);
    draw(5);
    draw(14);
    expect(created).toHaveLength(24); // two adjacent chunks, three LODs
    ground.updateBuildings([building, building]);
    draw(2);
    draw(5);
    draw(14);
    expect(created).toHaveLength(24);
  });
});
