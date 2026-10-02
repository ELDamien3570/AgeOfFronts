import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_TICKS, type Snapshot } from "../../src/skirmish/Protocol";
import { roundedBorderEdge } from "../../src/skirmish/client/RoundedTerritoryBorders";
import { TerritoryBorders } from "../../src/skirmish/client/TerritoryBorders";
import { TerritoryLayer } from "../../src/skirmish/client/TerritoryLayer";
import {
  TERRITORY_ALPHA,
  TERRITORY_BORDER_LIGHT,
  territoryStyle,
} from "../../src/skirmish/client/TerritoryStyle";

type Segment = [number, number, number, number];
class MockPath {
  segments: Segment[] = [];
  curves: number[][] = [];
  private x = 0;
  private y = 0;
  constructor(path?: MockPath) {
    if (path) this.addPath(path);
  }
  addPath(path: MockPath) {
    this.segments.push(...path.segments);
    this.curves.push(...path.curves);
  }
  moveTo(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  lineTo(x: number, y: number) {
    this.segments.push([this.x, this.y, x, y]);
    this.x = x;
    this.y = y;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.curves.push([this.x, this.y, cx, cy, x, y]);
    this.x = x;
    this.y = y;
  }
}

const COLORS = [
  [0, 0, 0],
  [98, 213, 204],
  [238, 119, 107],
  [237, 187, 98],
];
afterEach(() => vi.unstubAllGlobals());

function context() {
  const state = () => ({
    globalAlpha: ctx.globalAlpha,
    strokeStyle: ctx.strokeStyle,
    lineWidth: ctx.lineWidth,
    imageSmoothingEnabled: ctx.imageSmoothingEnabled,
    x: ctx.x,
    y: ctx.y,
  });
  const stack: ReturnType<typeof state>[] = [];
  const strokes: {
    path: MockPath;
    color: string;
    width: number;
    alpha: number;
    x: number;
    y: number;
  }[] = [];
  const fills: number[] = [];
  const ctx = {
    globalAlpha: 1,
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: true,
    x: 0,
    y: 0,
    save() {
      stack.push(state());
    },
    restore() {
      Object.assign(ctx, stack.pop());
    },
    translate(x: number, y: number) {
      ctx.x += x;
      ctx.y += y;
    },
    scale: vi.fn(),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: vi.fn(),
    drawImage: vi.fn(() => fills.push(ctx.globalAlpha)),
    stroke(path: MockPath) {
      strokes.push({
        path,
        color: ctx.strokeStyle,
        width: ctx.lineWidth,
        alpha: ctx.globalAlpha,
        x: ctx.x,
        y: ctx.y,
      });
    },
  };
  return { ctx, strokes, fills };
}

function setup(width: number, height: number, owners?: number[]) {
  const canvases: {
    width: number;
    height: number;
    ctx: ReturnType<typeof context>["ctx"];
  }[] = [];
  vi.stubGlobal("Path2D", MockPath);
  vi.stubGlobal("document", {
    createElement: () => {
      const { ctx } = context(),
        canvas = { width: 0, height: 0, ctx, getContext: () => ctx };
      canvases.push(canvas);
      return canvas;
    },
  });
  const snapshot = {
    owners: owners ? Uint8Array.from(owners) : new Uint8Array(width * height),
    claims: new Uint8Array(width * height),
    progress: new Uint8Array(width * height),
  } as Snapshot;
  const layer = new TerritoryLayer(width, height, COLORS);
  const render = (
    scale = 14,
    x = 0,
    y = 0,
    w = width * scale,
    h = height * scale,
  ) => {
    const result = context();
    layer.draw(
      result.ctx as unknown as CanvasRenderingContext2D,
      scale,
      x,
      y,
      w,
      h,
    );
    return result;
  };
  const boundaries = (draw: ReturnType<typeof render>) =>
    draw.strokes.filter(
      (s) =>
        s.color === TERRITORY_BORDER_LIGHT ||
        (s.color === "#ff302d" && s.alpha > 0.5),
    );
  const segments = (draw: ReturnType<typeof render>) =>
    boundaries(draw)
      .flatMap((s) => s.path.segments)
      .map((s) => s.join(","))
      .sort();
  const referencePaths = () => {
    const borders = new TerritoryBorders(width, height);
    for (let t = 0; t < snapshot.owners.length; t++)
      borders.updateTile(snapshot.owners, t);
    return [...borders.segments].map((e) => {
      const path = new MockPath();
      roundedBorderEdge(path, e, (x, y) =>
        x < 0 || y < 0 || x >= width || y >= height
          ? 0
          : snapshot.owners[y * width + x],
      );
      return path;
    });
  };
  const reference = () =>
    referencePaths()
      .flatMap((p) => p.segments.map((s) => s.join(",")))
      .sort();
  const referenceCurves = () =>
    referencePaths()
      .flatMap((p) => p.curves.map((s) => s.join(",")))
      .sort();
  const curves = (draw: ReturnType<typeof render>) =>
    boundaries(draw)
      .flatMap((s) => s.path.curves.map((c) => c.join(",")))
      .sort();
  return {
    layer,
    snapshot,
    render,
    boundaries,
    segments,
    reference,
    curves,
    referenceCurves,
    canvases,
  };
}

describe("territory zoom styling", () => {
  it("keeps the strategic wash and smoothly fades to five percent at tactical scale", () => {
    expect(territoryStyle(0.1).fillAlpha).toBe(TERRITORY_ALPHA);
    expect(territoryStyle(2).fillAlpha).toBe(TERRITORY_ALPHA);
    expect(territoryStyle(14).fillAlpha).toBeCloseTo(0.05);
    expect(territoryStyle(96).fillAlpha).toBeCloseTo(0.05);
    let previous = 1;
    for (let scale = 0.25; scale <= 96; scale += 0.25) {
      const style = territoryStyle(scale);
      expect(style.fillAlpha).toBeLessThanOrEqual(previous);
      expect(style.accentWidth).toBeLessThanOrEqual(3);
      expect(style.accentInset + style.accentWidth / 2).toBeLessThanOrEqual(
        scale * 0.36 + 1e-10,
      );
      previous = style.fillAlpha;
    }
  });

  it("changes compositing without rebuilding images or paths and restores canvas state", () => {
    const f = setup(2, 1, [1, 2]);
    f.layer.update(f.snapshot);
    const far = f.render(1),
      near = f.render(14),
      closer = f.render(96);
    expect(far.fills).toEqual([1]);
    expect(near.fills[0] * TERRITORY_ALPHA).toBeCloseTo(0.05);
    expect(f.boundaries(far)[0].path).toBe(f.boundaries(near)[0].path);
    expect(f.boundaries(near)[0].path).toBe(f.boundaries(closer)[0].path);
    expect(f.boundaries(near)[0].width * 14).toBe(0.8);
    expect(f.boundaries(closer)[0].width * 96).toBeCloseTo(0.8);
    expect(f.boundaries(near)[0].alpha).toBe(f.boundaries(far)[0].alpha);
    expect(f.canvases).toHaveLength(1);
    expect(f.canvases[0].ctx.putImageData).toHaveBeenCalledTimes(1);
    expect(near.ctx.globalAlpha).toBe(1);
    expect(near.ctx.imageSmoothingEnabled).toBe(true);
  });
});

describe("cached styled territory boundaries", () => {
  it("outlines all four sides of a claimed single-cell map", () => {
    const f = setup(1, 1, [1]);
    f.layer.update(f.snapshot);
    const draw = f.render();
    expect(f.segments(draw)).toEqual(f.reference());
    expect(f.segments(draw)).toHaveLength(4);
    expect(draw.strokes.filter((s) => s.color.startsWith("rgb"))).toHaveLength(
      4,
    );
    f.snapshot.owners[0] = 0;
    f.snapshot.changedTiles = Uint32Array.of(0);
    f.layer.update(f.snapshot);
    expect(f.segments(f.render())).toEqual([]);
    expect(f.render().strokes.filter((s) => s.color.startsWith("rgb"))).toEqual(
      [],
    );
  });

  it.each([
    [1, 1],
    [130, 70],
  ])(
    "handles map edges, partial chunks and first partial deltas (%i × %i)",
    (width, height) => {
      const f = setup(width, height);
      for (let t = 0; t < f.snapshot.owners.length; t++)
        f.snapshot.owners[t] = (t * 7 + Math.floor(t / width)) % 4;
      f.snapshot.changedTiles = new Uint32Array();
      f.layer.update(f.snapshot);
      expect(f.segments(f.render())).toEqual(f.reference());
      const paths = f.boundaries(f.render()).map((s) => s.path);
      f.layer.update(f.snapshot);
      expect(f.boundaries(f.render()).map((s) => s.path)).toEqual(paths);
      for (const c of f.canvases)
        expect(c.ctx.putImageData).toHaveBeenCalledTimes(1);
    },
  );

  it("updates both directions of a chunk seam and removes captured borders", () => {
    const f = setup(130, 70);
    f.snapshot.owners.fill(1);
    f.layer.update(f.snapshot);
    f.render();
    for (const tile of [
      63 + 63 * 130,
      64 + 63 * 130,
      63 + 64 * 130,
      64 + 64 * 130,
    ]) {
      for (const owner of [2, 3, 0, 1]) {
        f.snapshot.owners[tile] = owner;
        f.snapshot.changedTiles = Uint32Array.of(tile);
        f.layer.update(f.snapshot);
        expect(f.segments(f.render())).toEqual(f.reference());
        expect(f.curves(f.render())).toEqual(f.referenceCurves());
      }
    }
  });

  it("paints country accents on opposite inboard sides and neutral gets none", () => {
    const f = setup(2, 1, [1, 2]);
    f.layer.update(f.snapshot);
    const render = f.render(),
      shared = render.strokes.filter(
        (s) =>
          s.path.segments.some((e) => e[0] === 1 && e[2] === 1) &&
          s.color.startsWith("rgb"),
      );
    expect(shared).toHaveLength(2);
    expect(shared.map((s) => Math.sign(s.x)).sort()).toEqual([-1, 1]);
    expect(new Set(shared.map((s) => s.color)).size).toBe(2);
    const firstLight = render.strokes.findIndex(
      (s) => s.color === TERRITORY_BORDER_LIGHT,
    );
    expect(
      render.strokes
        .slice(firstLight)
        .every(
          (s) => s.color === TERRITORY_BORDER_LIGHT || s.color === "#ff302d",
        ),
    ).toBe(true);
    f.snapshot.owners[1] = 0;
    f.layer.update(f.snapshot);
    const neutral = f
      .render()
      .strokes.filter(
        (s) =>
          s.path.segments.some((e) => e[0] === 1 && e[2] === 1) &&
          s.color.startsWith("rgb"),
      );
    expect(neutral).toHaveLength(1);
    expect(neutral[0].x).toBeLessThan(0);
  });

  it("keeps claim interpolation while claim-only updates preserve geometry", () => {
    const f = setup(2, 1, [1, 0]);
    f.layer.update(f.snapshot);
    const path = f.boundaries(f.render())[0].path;
    for (const progress of [0, CAPTURE_TICKS / 2, CAPTURE_TICKS]) {
      f.snapshot.claims.fill(2);
      f.snapshot.progress.fill(progress);
      f.snapshot.changedTiles = Uint32Array.of(0, 1);
      f.layer.update(f.snapshot);
      const image = f.canvases[0].ctx.putImageData.mock
        .lastCall![0] as ImageData;
      expect(image.data[3]).toBe(Math.round(TERRITORY_ALPHA * 255));
      expect(image.data[7]).toBe(
        Math.round(((TERRITORY_ALPHA * progress) / CAPTURE_TICKS) * 255),
      );
      expect(f.boundaries(f.render())[0].path).toBe(path);
    }
    f.snapshot.claims.fill(0);
    f.snapshot.progress.fill(0);
    f.layer.update(f.snapshot);
    const image = f.canvases[0].ctx.putImageData.mock.lastCall![0] as ImageData;
    expect([...image.data.slice(0, 3)]).toEqual(COLORS[1]);
    expect(image.data[7]).toBe(0);
  });

  it("glows only along hostile shared borders and updates treaties without rebuilding geometry", () => {
    const f = setup(3, 1, [1, 2, 3]);
    f.layer.update(f.snapshot);
    const initial = f.render();
    const geometry = vi.spyOn(
      f.layer as unknown as { border: (chunk: unknown) => void },
      "border",
    );
    const glow = (draw: ReturnType<typeof f.render>) =>
      draw.strokes.filter((s) => s.color === "#ff302d");
    expect(glow(initial)).toHaveLength(2); // two strokes per visible chunk
    const originalFronts = glow(initial)[0].path.segments;
    f.snapshot.expansion = {
      diplomacy: { alliances: [{ id: 1, a: 1, b: 2, expiresTick: 1000 }] },
    } as Snapshot["expansion"];
    f.snapshot.changedTiles = new Uint32Array();
    f.layer.update(f.snapshot);
    const allied = f.render();
    expect(glow(allied)).toHaveLength(2);
    expect(glow(allied)[0].path.segments.length).toBeLessThan(
      originalFronts.length,
    );
    expect(geometry).not.toHaveBeenCalled();
    f.snapshot.expansion!.diplomacy.alliances = [];
    f.layer.update(f.snapshot);
    expect(glow(f.render())[0].path.segments).toEqual(originalFronts);
    f.snapshot.owners[1] = 0;
    f.snapshot.changedTiles = Uint32Array.of(1);
    f.layer.update(f.snapshot);
    expect(glow(f.render())).toHaveLength(0);
  });

  it("keeps the border fringe from offscreen chunks and rebuilds stale offscreen paths on return", () => {
    const f = setup(130, 70);
    f.snapshot.owners.fill(1);
    f.layer.update(f.snapshot);
    const edge = f.render(14, -64 * 14 - 1, 0, 100, 100);
    expect(edge.fills).toHaveLength(2);
    f.snapshot.owners[0] = 2;
    f.snapshot.changedTiles = Uint32Array.of(0);
    f.layer.update(f.snapshot);
    f.render(14, -1000, -500, 100, 100);
    expect(f.segments(f.render())).toEqual(f.reference());
  });
});
