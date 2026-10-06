// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder, SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import { HudView, hudMarkup } from "../../src/skirmish/client/HudView";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { TradeReceiving } from "../../src/skirmish/domain/TradeReceiving";

it("replicates live stack cargo and port receiving bars without changing simulation state", () => {
  const terrain=new Uint8Array(80*50).fill(133);
  for(let y=20;y<30;y++)terrain.fill(0,y*80,(y+1)*80);
  const game=new Skirmish(new GameMapImpl(80,50,terrain,terrain.length),
    {seed:42,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
  const e=game.expansion!;
  e.progression.states[1].completed=[];
  const add=(type:"factory"|"port",x:number,y:number)=>game.addBuilding({id:game.allocateId(),
    playerId:1,type,tile:game.map.ref(x,y),age:"StoneAge",remainingTicks:0});
  const factories=[add("factory",10,15),add("factory",10,15)];
  const port=add("port",10,19);
  factories.forEach((b,i)=>e.supply.goods.set(b.id,100+i*50));
  e.supply.goods.set(port.id,80);
  e.trade.step();
  const before=game.checkpoint();
  const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
  let snapshot=decoder.decode(encoder.encode(game.snapshot()));
  expect(game.checkpoint()).toEqual(before);
  const root=document.createElement("div");root.innerHTML=hudMarkup();document.body.replaceChildren(root);
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  try {
    const view=new HudView(root,()=>{},()=>{});
    const show=(ids:number[])=>view.update(new HudViewModel(new SkirmishViewModel(snapshot,
      {selected:new Set(),selectedShips:new Set(),selectedBuilding:ids[0],selectedBuildings:new Set(ids)})));
    show(factories.map(b=>b.id));
    const bars=()=>root.querySelectorAll<HTMLElement>("#selection-trade-meters [role=progressbar]");
    expect(bars()).toHaveLength(1);
    expect(bars()[0].getAttribute("aria-valuenow")).toBe("250");
    expect(bars()[0].getAttribute("aria-valuemax")).toBe("2000");
    show([port.id]);
    expect(bars()).toHaveLength(2);
    expect(bars()[0].getAttribute("aria-valuenow")).toBe("80");
    expect(bars()[1].getAttribute("aria-valuenow")).toBe("20");
    expect(root.querySelector("#selection-stats")!.textContent).toContain("Unlimited");
    e.supply.goods.set(port.id,12);
    e.trade.receiving.take(TradeReceiving.key(1,port.tile),game.tick,10,false,false,false);
    snapshot=decoder.decode(encoder.encode(game.snapshot()));
    show([port.id]);
    expect(bars()[0].getAttribute("aria-valuenow")).toBe("12");
    expect(bars()[1].getAttribute("aria-valuenow")).toBe("10");
    expect(root.querySelector("#selection-trade-meters")!.textContent).toContain("12 / 1,000");
  } finally {vi.unstubAllGlobals();}
});
