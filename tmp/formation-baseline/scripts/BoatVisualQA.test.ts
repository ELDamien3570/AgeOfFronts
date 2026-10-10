import { createCanvas, Image, ImageData, Path2D } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../src/core/game/GameMap";
import { Renderer } from "../src/skirmish/client/Renderer";
import { Renderer as BaselineRenderer } from "../src/skirmish/client/RendererBoatBaseline";
import { FIXED } from "../src/skirmish/Protocol";
import { Skirmish } from "../src/skirmish/Simulation";

it("renders actual before/after Canvas2D paths and checks interpolated hit testing", async () => {
  const outputDir = resolve("../boat-presentation-results");
  mkdirSync(outputDir, { recursive: true });
  const pending: Promise<unknown>[] = [];
  class LocalImage extends Image {
    set src(url: string) {
      const loaded = new Promise<void>((r, j) => {
        const ready = this.onload;
        this.onload = () => {
          ready?.();
          r();
        };
        this.onerror = j;
      });
      pending.push(loaded);
      super.src = url.startsWith("data:")
        ? url
        : readFileSync(
            url.startsWith("file:")
              ? fileURLToPath(url)
              : resolve(decodeURIComponent(url.replace(/^\//, ""))),
          );
    }
  }
  let dpr = 1;
  const canvas = () => {
    const c: any = createCanvas(1, 1);
    const ctx = c.getContext.bind(c);
    c.getContext = (kind: string, ...args: unknown[]) =>
      kind === "2d" ? ctx(kind, ...args) : null;
    c.parentElement = {
      append: () => {},
      getBoundingClientRect: () => ({ width: 640, height: 440 }),
    };
    c.style = {};
    c.setAttribute = () => {};
    c.after = () => {};
    c.addEventListener = () => {};
    return c;
  };
  vi.stubGlobal("ImageData", ImageData);
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("Image", LocalImage);
  vi.stubGlobal("Path2D", Path2D);
  vi.stubGlobal("window", {
    get devicePixelRatio() {
      return dpr;
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const width = 40,
    height = 28,
    terrain = new Uint8Array(width * height).fill(133);
  const snapshot = new Skirmish(
    new GameMapImpl(width, height, terrain, terrain.length),
    { seed: 42, aiCount: 1, runAi: false, tribes: false, ruleset: "ages-v1" },
  ).snapshot();
  const water = new Uint8Array(width * height),
    map = new GameMapImpl(width, height, water, 0);
  snapshot.players = [];
  snapshot.expansion!.deposits = [];
  snapshot.squads = [];
  snapshot.buildings = [];
  snapshot.owners.fill(0);
  snapshot.ships = ["transport", "warship"].map((kind, i) => ({
    id: 500 + i,
    playerId: 1,
    kind: kind as "transport" | "warship",
    x: 6 * FIXED,
    y: (7 + i * 8) * FIXED,
    health: 600,
    destination: 500,
    waypoints: [],
    fighting: false,
    boarding: null,
    definitionId: `bronzeage-${kind}`,
  }));
  snapshot.expansion!.traders = [
    {
      id: 500,
      playerId: 1,
      definitionId: "bronzeage-trade",
      naval: true,
      x: 6 * FIXED,
      y: 23 * FIXED,
    } as never,
  ];
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const canvases = [canvas(), canvas()];
  const renderers = [
    new BaselineRenderer(canvases[0]),
    new Renderer(canvases[1]),
  ];
  for (const r of renderers) {
    r.setGroundStyle("classic");
    r.setMap(map);
    r.zoom(1.2, 320, 220);
    r.update(structuredClone(snapshot));
    r.draw(now, 1, false);
  }
  await Promise.all(pending);
  await new Promise((r) => setTimeout(r, 0));
  const out = createCanvas(1344, 572),
    ctx = out.getContext("2d");
  let aligned = 0;
  for (let frame = 0; frame <= 150; frame++) {
    now = (frame * 1000) / 30;
    if (frame % 6 === 0) {
      snapshot.tick = (frame / 6) * 4;
      const t = now / 1000;
      for (let i = 0; i < 2; i++) {
        snapshot.ships[i].x = (8 + 4 * t) * FIXED;
        snapshot.ships[i].y = (7 + i * 8 + Math.sin(t * 1.2)) * FIXED;
      }
      snapshot.expansion!.traders[0].x = (8 + 4 * t) * FIXED;
      for (const r of renderers) r.update(structuredClone(snapshot));
    }
    for (const r of renderers) r.draw(now + 0.001, 1, false);
    await Promise.all(pending);
    const p = renderers[1].shipScreenPosition(snapshot.ships[0]);
    expect(renderers[1].shipAt(p.x, p.y)).toBe(500);
    aligned++;
    ctx.fillStyle = "#101b26";
    ctx.fillRect(0, 0, 1344, 572);
    ctx.fillStyle = "#eef3f8";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("Same boat art. Same 5 Hz snapshots.", 22, 34);
    ctx.font = "16px sans-serif";
    ctx.fillText("CURRENT MAIN · snapshot steps", 22, 67);
    ctx.fillText("PROTOTYPE · smooth motion + heading + loops", 682, 67);
    ctx.drawImage(canvases[0], 22, 82, 640, 440);
    ctx.drawImage(canvases[1], 682, 82, 640, 440);
    ctx.fillStyle = "#afc2d5";
    ctx.font = "13px sans-serif";
    ctx.fillText(
      "Actual game Canvas2D renderer · synthetic repeatable fleet · native raster capture (not browser/GPU validation)",
      22,
      551,
    );
    if (frame === 75)
      writeFileSync(
        `${outputDir}/boat-comparison.png`,
        out.toBuffer("image/png"),
      );
    if (frame >= 30)
      writeFileSync(
        `${outputDir}/motion-${String(frame - 30).padStart(3, "0")}.png`,
        out.toBuffer("image/png"),
      );
  }
  // Same interpolated click target remains correct at 2x backing resolution.
  dpr = 2;
  const highCanvas = canvas(),
    high = new Renderer(highCanvas);
  high.setGroundStyle("classic");
  high.setMap(map);
  high.update(structuredClone(snapshot));
  high.draw(now + 100, 1, false);
  await Promise.all(pending);
  high.draw(now + 150, 1, false);
  const p = high.shipScreenPosition(snapshot.ships[0]);
  expect(high.shipAt(p.x, p.y)).toBe(500);
  writeFileSync(`${outputDir}/boat-dpr2.png`, highCanvas.toBuffer("image/png"));
  writeFileSync(
    `${outputDir}/native-renderer-check.json`,
    JSON.stringify(
      {
        frames: 151,
        alignedHitTests: aligned,
        dpr: [1, 2],
        description:
          "Real Renderer and ce5a316 baseline, native Canvas2D raster; WebGL disabled. Not browser FPS evidence.",
      },
      null,
      2,
    ),
  );
  await Promise.all(pending);
  await new Promise((r) => setTimeout(r, 0));
  clock.mockRestore();
  vi.unstubAllGlobals();
}, 120000);
