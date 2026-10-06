import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { BuildingFacts } from "../../src/skirmish/client/BuildingFacts";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { encodeSnapshotFrame, decodeSnapshotFrame, textSnapshotPacket } from "../../src/skirmish/multiplayer/SnapshotWireCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { boxSweepEntry } from "../../src/skirmish/domain/ProjectileCollision";
import { EntityCollection } from "../../src/skirmish/EntityCollection";
import { technologyAt } from "../../src/skirmish/content/Technology";
import { unitEffects } from "../../src/skirmish/domain/ResearchEffects";
import { UNIT } from "../../src/skirmish/content/Units";

function match() {
  return new Skirmish(new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072),
    { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
}
describe("architecture optimization compatibility", () => {
  it("invalidates unit definitions for research, owner, refit and restored progression", () => {
    const game=match(),battle=game.expansion!.battle,squad=game.squads.find(s=>s.playerId===1)!,saved=game.checkpoint(),base=battle.definition(squad);
    expect(battle.definition(squad)).toBe(base);
    const research=game.expansion!.progression.states[1].completed;
    research.push(technologyAt(base.age,"warfare",4).id);
    const upgraded=battle.definition(squad);expect(upgraded).toEqual(unitEffects(base,research));expect(upgraded.attack.damage).toBeGreaterThan(base.attack.damage);
    expect(battle.definition({...squad,playerId:2})).toEqual(base);
    const alternate=[...UNIT.values()].find(u=>u.id!==base.id)!;
    expect(battle.definition({...squad,definitionId:alternate.id})).toEqual(unitEffects(alternate,research));
    game.restore(saved);expect(battle.definition(game.squad(squad.id)!)).toEqual(base);
  });
  it("journals owned scalar writes exactly once, ignores no-ops and protects external container aliases", () => {
    let writes=0;const entities=new EntityCollection<{readonly id:number;x:number;path:number[]}>({added:()=>{},changed:()=>writes++,removed:()=>{},restored:()=>{}});
    entities.add({id:1,x:0,path:[]}); const view=entities.values;
    entities.setOwned(1,"x",2); entities.setOwned(1,"x",2); entities.setOwned(99,"x",2);
    expect(writes).toBe(1);expect(entities.values).toBe(view);expect(view[0].x).toBe(2);
    const path=[1,2];entities.update(1,{path});path.push(3);expect(entities.get(1)!.path).toEqual([1,2]);
    expect(()=>entities.setOwned(1,"id" as "x",3)).toThrow("identity");
    expect(()=>entities.update(1,JSON.parse('{"__proto__":{"x":4}}'))).toThrow("identity");
  });
  it("keeps all unacknowledged dirt, geometry, entity removal and changed-back tiles through dropped packed views", () => {
    const game = match(), encoder = new SnapshotEncoder(true), stream = new CanonicalStateStream(3072), decoder = new SnapshotDecoder();
    stream.apply(encoder.encode(game.snapshot()));
    const baseline = stream.presentationPacket(); decoder.decode(baseline.viewPacket); stream.acknowledge(baseline.canonicalSequence);
    const first = structuredClone(game.snapshot()); first.tick++;
    const original = first.owners[100]; first.owners[100] = original === 2 ? 1 : 2;
    first.expansion!.roads = new Uint32Array([100, 101]); first.expansion!.roadRevision++;
    first.expansion!.deposits[0].owner = 2;
    stream.apply(encoder.encode(first)); stream.presentationPacket(); // discarded, no ACK
    const latest = structuredClone(first); latest.tick++; latest.owners[100] = original;
    latest.squads.splice(0, 1); latest.buildings.splice(0, 1);
    stream.apply(encoder.encode(latest));
    const view = stream.presentationPacket(), decoded = decoder.decode(view.viewPacket);
    expect([...view.viewPacket.tiles]).toContain(100);
    expect(decoded.owners).toEqual(latest.owners);
    expect(decoded.squads).toEqual(latest.squads);
    expect(decoded.buildings).toEqual(latest.buildings);
    expect(decoded.expansion!.roads).toEqual(latest.expansion!.roads);
    expect(decoded.expansion!.deposits).toEqual(latest.expansion!.deposits);
    stream.acknowledge(view.canonicalSequence);
    latest.tick++; stream.apply(encoder.encode(latest));
    const clean = stream.presentationPacket();
    expect(clean.viewPacket.tiles.length).toBe(0);
    expect(clean.viewPacket.expansion!.roads).toBeUndefined();
    expect(clean.viewPacket.expansion!.deposits).toBeUndefined();
    expect(decoder.decode(clean.viewPacket).expansion!.roads).toEqual(latest.expansion!.roads);
    stream.apply(new SnapshotEncoder(true).encode(latest));
    expect(stream.presentationPacket().viewPacket.reset).toBe(true);
  });
  it("resets a packed view on dirty overflow, including previously neutral pixels", () => {
    const game = match(), encoder = new SnapshotEncoder(true), stream = new CanonicalStateStream(3072, 1), decoder = new SnapshotDecoder();
    stream.apply(encoder.encode(game.snapshot()));
    const baseline = stream.presentationPacket(); decoder.decode(baseline.viewPacket); stream.acknowledge(baseline.canonicalSequence);
    const source = game.snapshot(); source.tick++; source.owners[100] = 2; source.owners[101] = 2;
    stream.apply(encoder.encode(source));
    const view = stream.presentationPacket(); expect(view.viewPacket.reset).toBe(true);
    expect(decoder.decode(view.viewPacket).owners).toEqual(source.owners);
  });
  it("matches the original collecting swept-wall predicate for deterministic corner, radius and owner cases", () => {
    const game = match(), forts = game.expansion!.fortifications;
    const tower = (x: number, y: number): Building => game.addBuilding({id:game.allocateId(), playerId:1, type:"tower",tile:game.map.ref(x,y),remainingTicks:0,health:2000,maxHealth:2000});
    const a = tower(10, 5), b = tower(12, 5);
    forts.addBarrier({ id:game.allocateId(), a:a.id, b:b.id, age:"StoneAge",playerId:1,
      tiles:[game.map.ref(10,5),game.map.ref(11,5),game.map.ref(12,5)],health:2000,maxHealth:2000,remainingTicks:0 });
    forts.step(game.tick, game.buildings);
    let seed = 42;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 4294967296; };
    for (let at = 0; at < 600; at++) {
      const from={x:(8+random()*7)*FIXED,y:(3+random()*5)*FIXED}, to={x:(8+random()*7)*FIXED,y:(3+random()*5)*FIXED};
      const radius=[0,0.45*FIXED,FIXED,2*FIXED][at%4], owner=at%2+1;
      const expected = forts.blockingTilesOnSweep(from,to,owner,radius).every(tile =>
        boxSweepEntry(from,to,{x:game.map.x(tile)*FIXED,y:game.map.y(tile)*FIXED},FIXED,radius)===null);
      expect(forts.clearMovement(from,to,owner,radius)).toBe(expected);
    }
  });
  it("does not mistake decoder mutation, construction, damage or order changes for unchanged building facts", () => {
    const facts=new BuildingFacts(), building:Building={id:1,playerId:1,type:"tower",tile:10,remainingTicks:0,health:2000};
    const rows=[building]; expect(facts.changed(rows)).toBe(true); expect(facts.changed([{...building}])).toBe(false);
    Object.assign(building,{health:1900}); expect(facts.changed(rows)).toBe(true);
    expect(facts.changed([{...building,remainingTicks:1}])).toBe(true);
    expect(facts.changed([])).toBe(true); facts.reset(); expect(facts.changed(rows)).toBe(true);
  });
  it("round trips binary snapshots and legacy text with identical hashes and all flow/recovery metadata", async () => {
    const packet = new SnapshotEncoder(true).encode(match().snapshot());
    const binary = await encodeState(packet, undefined, SNAPSHOT_STATE_LIMITS, true), text=await encodeState(packet,undefined,SNAPSHOT_STATE_LIMITS);
    expect(binary.hash).toBe(text.hash); expect(textSnapshotPacket(binary)).toEqual(text);
    const message={type:"match-state" as const,matchId:"match",packet:binary,tick:packet.tick,paused:false,disconnectedPlayerIds:[2],executor:"server" as const,
      publicationSequence:2,flowEpoch:3,rebase:true,syncId:"restore"};
    const frame=encodeSnapshotFrame(message), received=decodeSnapshotFrame(frame.buffer);
    expect(await decodeState(received.packet,SNAPSHOT_STATE_LIMITS)).toEqual(packet);
    expect({...received,packet:undefined}).toEqual({...message,packet:undefined});
    await expect(decodeState(binary,{maxPayloadChars:4})).rejects.toThrow("Invalid encoded");
    await expect(decodeState({...binary,hash:"0".repeat(64)})).rejects.toThrow("hash mismatch");
    const malformed=frame.slice(); new DataView(malformed.buffer).setUint32(4,16385,true);
    expect(()=>decodeSnapshotFrame(malformed.buffer)).toThrow();
    expect(()=>decodeSnapshotFrame(new ArrayBuffer(7))).toThrow();
    expect(()=>decodeSnapshotFrame(new Uint8Array(8).buffer)).toThrow();
  });
});
