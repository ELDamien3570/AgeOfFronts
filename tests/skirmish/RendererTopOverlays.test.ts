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
