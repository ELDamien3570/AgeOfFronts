import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  ARTWORK_CATALOG,
  buildingArtworkId,
} from "../../src/skirmish/client/ArtworkCatalog";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(port = false, deferredPlanning = false) {
  const terrain = new Uint8Array(80 * 50).fill(133);
  if (port)
    for (let y = 20; y < 30; y++)
      for (let x = 0; x < 80; x++) terrain[y * 80 + x] = 0;
  const m = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    deferredPlanning, aiWarPolicy: deferredPlanning, aiEconomy: deferredPlanning,
  });
  for (const s of m.squads) {
    m.updateSquad(s.id, { x: 70 * FIXED });
    m.updateSquad(s.id, { y: 40 * FIXED });
  }
  const factory = m.addBuilding({
    id: m.allocateId(),
    type: "factory" as const,
    tile: m.map.ref(10, 15),
    playerId: 1,
    remainingTicks: 0,
    age: "StoneAge" as const,
  });

  if (port) {
    m.addBuilding({ ...factory, id: m.allocateId(), type: "port", tile: m.map.ref(10, 19) });
    m.addBuilding({ ...factory, id: m.allocateId(), type: "port", tile: m.map.ref(30, 19), playerId: 2 });
  }
  m.expansion!.supply.goods.set(factory.id, 100);
  const dispatch = () => {
    m.tick += 20;
    m.expansion!.trade.step();
  };
  return {
    m,
    dispatch,
    research: m.expansion!.progression.states[1].completed,
  };
}

describe("independent trade unlocks", () => {
  it("physically dispatches a naval trader despite unrelated military-policy revisions", () => {
    const {m,research}=fixture(true,true);research.push("stoneage-cargo-canoes","stoneage-craft-workshops");
    let origin: {id:number;x:number;y:number}|undefined, travelled=false;
    const operations=m.expansion!.operations;
    for(let i=0;i<1200 && !travelled;i++){
      // An unrelated war policy generation must not restart civilian trade routes.
      operations.revision++;
      m.step();
      const actor=m.expansion!.trade.actors.find(a=>a.naval);
      if(actor){origin??={id:actor.id,x:actor.x,y:actor.y};travelled=Math.hypot(actor.x-origin.x,actor.y-origin.y)>2*FIXED;}
    }
    expect(origin).toBeDefined();expect(travelled).toBe(true);
  });
  it("keeps workshop production separate from land dispatch, then unlocks a visible trader with Goods Handling", () => {
    const { m, dispatch, research } = fixture();
    research.push("stoneage-craft-workshops");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
    research.push("stoneage-goods-handling");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(1);
    expect(m.expansion!.trade.actors[0]).toMatchObject({
      naval: false,
      definitionId: "stoneage-trader",
    });
    expect(ARTWORK_CATALOG["stoneage-trader"].clips?.travel).toBeDefined();
  });
  it("unlocks a water trader with Cargo Canoes without Goods Handling", () => {
    const { m, dispatch, research } = fixture(true);
    research.splice(research.indexOf("stoneage-cargo-canoes"), 1);
    research.push("stoneage-craft-workshops");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
    research.push("stoneage-cargo-canoes");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(1);
    expect(m.expansion!.trade.actors[0]).toMatchObject({
      naval: true,
      definitionId: "stoneage-trade",
    });
  });
  it("does not substitute land traders for water research when there is no reachable port", () => {
    const { m, dispatch, research } = fixture();
    research.push("stoneage-cargo-canoes");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
  });
  it("waits for a foreign water market and uses independently unlocked overland trade meanwhile", () => {
    const {m,dispatch,research} = fixture(true);
    for (const port of m.buildings.filter(b=>b.type === "port")) m.updateBuilding((port).id, { playerId: 1 });
    expect(m.expansion!.trade.hasForeignMarket(1,m.map.ref(10,20))).toBe(false);
    expect(research).not.toContain("stoneage-goods-handling");
    research.push("stoneage-cargo-canoes"); dispatch();
    expect(m.expansion!.trade.actors.map(a=>({playerId:a.playerId,naval:a.naval,port:a.originPortId}))).toEqual([]);
    research.push("stoneage-goods-handling"); dispatch();
    const actor = m.expansion!.trade.actors[0];
    expect(actor.naval).toBe(false);
    expect(actor.cargo).toBeGreaterThan(0);
    const ports=m.buildings.filter(b=>b.type === "port");m.updateBuilding((ports[ports.length-1]).id, { playerId: 2 });
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(1);
    expect(actor.naval).toBe(false);
    for(let i=0;i<3000 && !actor.naval;i++){m.tick++;m.expansion!.trade.step();}
    expect(actor.naval).toBe(true);
  });
  it("uses the approved supplied workshop art for the actual Stone Age building", () => {
    const id = buildingArtworkId("siege-workshop", "StoneAge")!;
    expect(ARTWORK_CATALOG[id].file).toBe(
      "building-bronzeage-siege-workshop.png",
    );
  });
});
