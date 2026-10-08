import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import { coastalPatrol } from "../../src/skirmish/domain/CoastalPatrol";

it("follows a bend in friendly shoreline with bounded search work",()=>{
  const cells=new Uint8Array(100*70);
  for(let x=0;x<100;x++)for(let y=0;y<(x<40?20:32);y++)cells[y*100+x]=133;
  const map=new GameMapImpl(100,70,cells,2600),water=new WaterPaths(map),owners=new Uint8Array(cells.length).fill(2);
  const neighbors=vi.spyOn(map,"neighbors");
  const route=coastalPatrol(map,water,owners,2,map.ref(10,20));
  expect(route.some(t=>map.x(t)>=40 && map.y(t)>=32)).toBe(true);
  expect(route.every(t=>water.walkable(t))).toBe(true);
  expect(neighbors.mock.calls.length).toBeLessThanOrEqual(512);
  expect(coastalPatrol(map,water,owners,1,map.ref(10,20))).toEqual([]);
});
