// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { AircraftLayer } from "../../src/skirmish/client/AircraftLayer";

const styles = readFileSync(
  "src/skirmish/client/style.css",
  "utf8",
);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it.each([true, false])(
  "keeps aircraft above world canvases without intercepting selection, with WebGL=%s",
  (webgl) => {
    const ctx = { setTransform: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    const style = document.createElement("style");
    style.textContent = styles;
    const parent = document.createElement("div");
    const battlefield = document.createElement("canvas");
    battlefield.id = "battlefield";
    parent.append(battlefield);
    let formations: HTMLCanvasElement | undefined;
    if (webgl) {
      formations = document.createElement("canvas");
      formations.className = "strategic-sprites";
      parent.append(formations);
    }
    document.body.append(style, parent);
    const layer = new AircraftLayer(battlefield);
    const canvas = parent.querySelector<HTMLCanvasElement>(".aircraft-layer")!;
    const appearance = getComputedStyle(canvas);
    expect(appearance.pointerEvents).toBe("none");
    expect(appearance.position).toBe("absolute");
    expect(Number(appearance.zIndex)).toBeGreaterThan(
      Number(getComputedStyle(formations ?? battlefield).zIndex) || 0,
    );
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    layer.resize(320, 180, 2);
    expect([canvas.width, canvas.height]).toEqual([640, 360]);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    layer.clear();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 320, 180);
  },
);
