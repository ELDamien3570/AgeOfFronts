import { expect, it } from "vitest";
import { Renderer } from "../../src/skirmish/client/Renderer";

it("keeps the current camera when HUD space changes, and fits only on explicit home", () => {
  // Exercise camera geometry without creating a GPU, canvas or asset loaders.
  const camera = Object.create(Renderer.prototype) as Renderer;
  Object.assign(camera, {
    map: { width: () => 100, height: () => 50 },
    width: 1280,
    height: 720,
    hudBottomInset: 0,
    scale: 24,
    offsetX: -500,
    offsetY: -200,
  });
  const position = camera.screen(42, 23),
    anchor = camera.world(600, 300);
  camera.setHudBottomInset(200);
  expect(camera.screen(42, 23)).toEqual(position);
  expect(camera.world(600, 300)).toEqual(anchor);
  camera.zoom(1.1, 600, 300);
  expect(camera.world(600, 300)).toEqual(anchor);
  camera.home();
  expect(camera.screen(0, 0)).toEqual({ x: 172, y: 26 });
  expect(camera.screen(100, 50)).toEqual({ x: 1108, y: 494 });
});
