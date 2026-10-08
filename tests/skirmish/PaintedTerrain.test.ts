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
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  };
}

describe("building clearance in cached terrain", () => {
  it("redraws distant forest ground and canopy across building-clearance seams", () => {
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
    expect(created).toHaveLength(7); // six cached chunks and one reused canopy bake
    const crownDraws = created[0].drawImage.mock.calls.length;
    expect(crownDraws).toBeGreaterThan(0);
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created[0].drawImage.mock.calls.length).toBe(crownDraws);
    const site = { tile, type: "city" as const };
    ground.updateBuildings([site]);
    expect(forestOf(map)!.coverAt(tile)).toBe(0);
    expect(paintedCell(map, tile, undefined, environment).color).not.toBe(
      before,
    );
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(9);
    ground.updateBuildings([site, site]);
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(9);
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

describe("decorations-only chunks under the GL ground", () => {
  it("clips enlarged distant stands away from a newly cleared building site", () => {
    const created: ReturnType<typeof context>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const ctx = context();
        created.push(ctx);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    const map = createSkirmishMap(
        64,
        64,
        new Uint8Array(64 * 64).fill(133),
        undefined,
        { cover: new Uint8Array(64 * 64).fill(255) },
      ),
      ground = new PaintedTerrain(map),
      ctx = context() as unknown as CanvasRenderingContext2D;
    ground.setDecorationsOnly(true);
    ground.draw(ctx, 0.5, 0, 0, 32, 32);
    const scratch = created[0],
      coversCentre = ([x, y, width, height]: number[]) =>
        x <= 32 && x + width > 32 && y <= 32 && y + height > 32;
    expect(scratch.rect.mock.calls.some(coversCentre)).toBe(true);
    scratch.rect.mockClear();
    ground.updateBuildings([{ tile: map.ref(32, 32), type: "city" }]);
    ground.draw(ctx, 0.5, 0, 0, 32, 32);
    expect(scratch.clip).toHaveBeenCalledTimes(2);
    expect(scratch.rect.mock.calls.length).toBeGreaterThan(0);
    expect(scratch.rect.mock.calls.some(coversCentre)).toBe(false);
  });
  it("keeps distant canopy under GL ground without painting tiles or water strokes", () => {
    const created: ReturnType<typeof context>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const ctx = context();
        created.push(ctx);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    const terrain = new Uint8Array(192 * 128).fill(133);
    for (let y = 0; y < 128; y++)
      for (let x = 100; x < 192; x++) terrain[y * 192 + x] = 0x20;
    const cover = new Uint8Array(192 * 128);
    for (let y = 0; y < 128; y++) cover.fill(255, y * 192, y * 192 + 100);
    const map = createSkirmishMap(192, 128, terrain, undefined, { cover }),
      ground = new PaintedTerrain(map),
      ctx = context() as unknown as CanvasRenderingContext2D;
    ground.setDecorationsOnly(true);
    ground.draw(ctx, 1, 0, 0, 192, 128);
    expect(created).toHaveLength(7);
    expect(created[0].drawImage).toHaveBeenCalled();
    ground.draw(ctx, 0.5, 0, 0, 96, 64);
    expect(created).toHaveLength(7); // camera changes reuse the filtered canopy
    ground.draw(ctx, 4, 0, 0, 192 * 4, 128 * 4);
    expect(created.length).toBeGreaterThan(0);
    for (const c of created) {
      expect(c.fillRect).not.toHaveBeenCalled();
      expect(c.stroke).not.toHaveBeenCalled();
    }
    const changed = ground.updateBuildings([
      { tile: map.ref(64, 20), type: "city" },
    ]);
    expect(changed.length).toBeGreaterThan(0);
  });
});
