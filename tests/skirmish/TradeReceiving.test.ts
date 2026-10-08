import { describe, expect, it } from "vitest";
import { marketDropLimit } from "../../src/skirmish/content/Economy";
import { TradeReceiving } from "../../src/skirmish/domain/TradeReceiving";
import { tradePayout, tradeCycleQuote } from "../../src/skirmish/domain/TradeQuote";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";

describe("per-trip market limits and multi-stop trade", () => {
  it("scales drops by stack and gives sea traders twice the land allowance", () => {
    expect([1,5,10].map(s=>marketDropLimit(s,false,false,false))).toEqual([10,28,50]);
    expect(marketDropLimit(10,false,true,true)).toBe(63);
    expect(marketDropLimit(10,false,true,false)).toBe(75);
    expect(marketDropLimit(1,true,true,true)).toBe(26);
    expect(marketDropLimit(10,true,true,false)).toBe(150);
    expect([1,5,10].map(s=>marketDropLimit(s,true,false,false))).toEqual([20,56,100]);
  });
  it("does not deplete a market when many traders deliver during the same tick", () => {
    const r = new TradeReceiving(); r.configure("1:10",10,0);
    const initial = r.checkpoint();
    for (let i=0;i<1000;i++) {
      expect(r.take("1:10",0,450,false,true,false)).toBe(75);
      expect(r.take("1:10",0,450,false,false,false)).toBe(50);
      expect(r.take("1:10",0,450,true,true,false)).toBe(Math.min(450,marketDropLimit(10,true,true,false)));
    }
    expect(r.checkpoint()).toEqual(initial);
    expect(r.available("1:10",10000,false,true,false)).toBe(75);
    const cold = new TradeReceiving(); cold.restore(r.checkpoint());
    expect(cold.checkpoint()).toEqual(r.checkpoint());
  });
  it("changes per-trip limits immediately when the stack changes and ignores obsolete depleted budgets", () => {
    const r = new TradeReceiving();
    r.restore([["1:10",{stack:1,units:0,tick:0}]]);
    expect(r.available("1:10",0,false,false,false)).toBe(10);
    r.configure("1:10",10,0);
    expect(r.available("1:10",0,false,false,false)).toBe(50);
    const saved=r.checkpoint(); r.configure("1:10",10,20);
    expect(r.checkpoint()).toEqual(saved);
  });
  it("cannot increase voyage payout by sailing a detour", () => {
    const quote={naval:true,quantity:100,valuePerGood:10,foreign:true,allied:false,distance:50,mapWidth:500};
    expect(tradePayout({...quote,routeTiles:1000})).toBe(tradePayout({...quote,routeTiles:50}));
    expect(tradePayout(quote)).toBe(3000);
  });
  it("quotes partial stops by location and returns unsold cargo", () => {
    const q=tradeCycleQuote({naval:false,stock:450,capacity:450,valuePerGood:10,supplyTicks:0,returnTicks:100,observedRisk:0,
      legs:[{marketId:1,location:10,quantity:50,distance:1,foreign:false,allied:false,travelTicks:10},
        {marketId:2,location:10,quantity:50,distance:1,foreign:false,allied:false,travelTicks:10},
        {marketId:3,location:20,quantity:63,distance:20,foreign:true,allied:true,travelTicks:100}]});
    expect(q).toMatchObject({quantity:450,delivered:113,returned:337,guaranteedGold:1445,handlingTicks:80});
  });
  it("partially delivers once per tile, visits a second market, and returns leftover cargo exactly", () => {
    const data = new Uint8Array(80*64).fill(133);
    const game = new Skirmish(new GameMapImpl(80,64,data,data.length),
      {seed:42,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1",startingAge:"Modern"});
    game.owners.fill(1);
    game.expansion!.progression.states[1].completed = TECHNOLOGIES.map(t=>t.id);
    for (const s of game.squads) game.updateSquad(s.id,{x:70*FIXED,y:60*FIXED});
    const add=(type:"factory"|"city",x:number)=>game.addBuilding({id:game.allocateId(),playerId:1,type,
      tile:game.map.ref(x,10),age:"Modern",remainingTicks:0});
    for(let i=0;i<10;i++) { const b=add("factory",10); game.expansion!.supply.goods.set(b.id,1000); }
    const first=add("city",11), second=add("city",18);
    for(let i=1;i<10;i++) {add("city",11); add("city",18);}
    const trade=game.expansion!.trade;
    game.tick=20;trade.step();
    const a=trade.actors[0]; expect(a.loaded).toBe(600);
    const arrive=(b:typeof first)=>{
      a.state="outbound";a.destination=b.id;a.path=[];a.nextPathIndex=0;a.waitTicks=0;
      a.x=(game.map.x(b.tile)+.5)*FIXED;a.y=(game.map.y(b.tile)+.5)*FIXED;
      game.tick++;trade.step();
    };
    arrive(first); expect(a.delivered).toBe(50);expect(a.cargo).toBe(550);
    arrive(first); expect(a.delivered).toBe(50);
    arrive(second); expect(a.delivered).toBe(100);expect(a.cargo).toBe(500);
    const saved=game.checkpoint(),cold=new Skirmish(game.map,game.options);cold.restore(saved);
    expect(trade.receipts.get(`1:${second.tile}`)?.gold).toBe(1000);
    expect(game.snapshot().expansion?.tradeReceipts).toEqual([...trade.receipts.values()]);
    game.tick++;cold.tick++;trade.step();cold.expansion!.trade.step();
    expect(cold.expansion!.trade.checkpoint()).toEqual(trade.checkpoint());
    a.state="returning";a.destination=a.factoryId;a.path=[];a.waitTicks=0;
    game.tick++;trade.step();
    expect(a.returned).toBe(500);
    expect(a.loaded).toBe(a.delivered+a.returned+a.lost+a.cargo);
    expect(trade.cycleQuotes.get(a.id)?.guaranteedGold).toBe(2000);
    const trip = a.shipmentId;
    for(let i=0;i<100 && a.shipmentId===trip;i++){game.tick++;trade.step();}
    expect(a.shipmentId).toBeGreaterThan(trip);
    expect(a.visitedTiles).toEqual([]);
    const income=trade.deliveredGold[1];
    arrive(first);
    expect(a.delivered).toBe(50);
    expect(trade.deliveredGold[1]-income).toBe(1000);
  });
});
