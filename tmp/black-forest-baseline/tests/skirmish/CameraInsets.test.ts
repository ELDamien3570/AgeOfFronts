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

it("preserves tactical camera center across resize and ignores fractional layout noise",()=>{
  const camera=Object.create(Renderer.prototype) as Renderer;
  let rect={width:1280,height:720};
  const resize=()=>{};
  Object.assign(camera,{map:{width:()=>100,height:()=>50},width:1280,height:720,hudBottomInset:100,scale:24,offsetX:-500,offsetY:-200,
    canvas:{parentElement:{getBoundingClientRect:()=>rect},width:1280,height:720},ctx:{setTransform:()=>{}},
    strategic:{resize},groundLayer:{resize},aircraftLayer:{resize}});
  const oldWindow=globalThis.window;
  Object.defineProperty(globalThis,"window",{value:{devicePixelRatio:1},configurable:true,writable:true});
  try{
    const center=camera.world(640,310);
    rect={width:1280.2,height:720.2};
    (camera as unknown as {resize():void}).resize();expect(camera.world(640,310)).toEqual(center);
    rect={width:1400,height:800};
    (camera as unknown as {resize():void}).resize();expect(camera.world(700,350)).toEqual(center);
    expect(camera.screen(42,23)).toEqual({x:42*24+(700-center.x*24),y:23*24+(350-center.y*24)});
  }finally{Object.defineProperty(globalThis,"window",{value:oldWindow,configurable:true,writable:true});}
});
