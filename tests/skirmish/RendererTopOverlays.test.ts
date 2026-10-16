// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Renderer } from "../../src/skirmish/client/Renderer";

type Recorder = Record<string, unknown> & { calls: string[] };

// A canvas 2D context that records every method call and tolerates property writes.
function recorder(): Recorder {
  const calls: string[] = [];
  return new Proxy({ calls } as Recorder, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push(key);
        if (key === "createImageData" || key === "getImageData") {
          const [w, h] = key === "createImageData" ? args : args.slice(2);
          return { width: Number(w), height: Number(h), data: new Uint8ClampedArray(Math.max(1, Number(w) * Number(h) * 4)) };
        }
        if (key === "createLinearGradient" || key === "createRadialGradient" || key === "createPattern")
          return { addColorStop() {} };
        return key === "measureText" ? { width: 0 } : args[0];
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
}

const contexts = new Map<HTMLCanvasElement, Recorder>();

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== "2d") return null;
    if (!contexts.has(this)) contexts.set(this, recorder());
    return contexts.get(this) as unknown as CanvasRenderingContext2D;
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  contexts.clear();
  document.body.replaceChildren();
});

it("paints the selection box and Paused label on the topmost aircraft canvas, not the battlefield", () => {
  const parent = document.createElement("div"),
    battlefield = document.createElement("canvas");
  parent.append(battlefield);
  document.body.append(parent);
  const renderer = new Renderer(battlefield);
  const top = parent.querySelector<HTMLCanvasElement>(".aircraft-layer")!;
  const lower = contexts.get(battlefield)!,
    upper = contexts.get(top)!;
  lower.calls.length = 0;
  upper.calls.length = 0;
  renderer.selectionBox = { x1: 10, y1: 10, x2: 60, y2: 40 };
  (
    renderer as unknown as {
      drawTopOverlays(snapshot: unknown, paused: boolean): void;
    }
  ).drawTopOverlays({ width: 8, squads: [], tick: 0 }, true);
  expect(upper.calls).toContain("strokeRect");
  expect(upper.calls).toContain("fillText");
  expect(lower.calls).not.toContain("strokeRect");
  expect(lower.calls).not.toContain("fillText");
});

it("draw() paints the top overlays on the aircraft canvas each frame", async () => {
  const { GameMapImpl } = await import("../../src/core/game/GameMap");
  const { DEFAULT_AI_POLICIES } = await import("../../src/skirmish/content/AiPolicies");
  const { Skirmish } = await import("../../src/skirmish/Simulation");
  const W = 48, H = 32, terrain = new Uint8Array(W * H).fill(133);
  const map = new GameMapImpl(W, H, terrain, terrain.length);
  const match = new Skirmish(map, {
    ...DEFAULT_AI_POLICIES, seed: 3, humanNames: ["H"], aiCount: 1, tribes: false, runAi: false,
  } as ConstructorParameters<typeof Skirmish>[1]);
  const parent = document.createElement("div"),
    battlefield = document.createElement("canvas");
  parent.append(battlefield);
  document.body.append(parent);
  vi.stubGlobal("Path2D", class { constructor(..._args: unknown[]) {} addPath() {} moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} quadraticCurveTo() {} bezierCurveTo() {} ellipse() {} });
  const renderer = new Renderer(battlefield);
  renderer.setMap(map);
  renderer.update(match.snapshot());
  const top = parent.querySelector<HTMLCanvasElement>(".aircraft-layer")!;
  const lower = contexts.get(battlefield)!,
    upper = contexts.get(top)!;
  const overlays = vi.spyOn(renderer as unknown as { drawTopOverlays(...args: unknown[]): void }, "drawTopOverlays");
  const frame = (now: number, paused: boolean) => {
    lower.calls.length = 0;
    upper.calls.length = 0;
    expect(renderer.draw(now, 1, paused)).toBe(true);
    const count = (calls: string[], name: string) => calls.filter(call => call === name).length;
    return {
      lower: { stroke: count(lower.calls, "strokeRect"), text: count(lower.calls, "fillText") },
      upper: { stroke: count(upper.calls, "strokeRect"), text: count(upper.calls, "fillText") },
    };
  };
  // Baseline frame without a selection box or pause, then the same frame with both:
  // the extra strokeRect/fillText must land on the aircraft canvas only.
  const plain = frame(10_000, false);
  renderer.selectionBox = { x1: 10, y1: 10, x2: 60, y2: 40 };
  const marked = frame(20_000, true);
  expect(overlays).toHaveBeenCalledTimes(2);
  expect(marked.upper.stroke).toBeGreaterThan(plain.upper.stroke);
  expect(marked.upper.text).toBeGreaterThan(plain.upper.text);
  expect(marked.lower.stroke).toBe(plain.lower.stroke);
  expect(marked.lower.text).toBe(plain.lower.text);
});
