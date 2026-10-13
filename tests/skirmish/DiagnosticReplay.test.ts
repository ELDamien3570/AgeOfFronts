import { describe, expect, it } from "vitest";
import { readDiagnosticReplay } from "../../src/skirmish/DiagnosticReplay";

describe("local playable replay envelope", () => {
  const replay = () => ({ version: 1, mapId: "migration", playerId: 3, checkpoint: { version: 11, tick: 36000, width: 1000, height: 1000, players: [{id:3,ai:false,eliminated:false}] } });
  it("restores typed buffers, maps, sets and nonfinite diagnostic values", () => {
    const value = { ...replay(), data: { bytes: {$benchmark:"array",type:"Uint8Array",bytes:"AQID"}, map: {$benchmark:"map",entries:[[3,4]]}, set: {$benchmark:"set",entries:[2]}, score: {$benchmark:"number",value:"-Infinity"} } };
    const restored = readDiagnosticReplay(JSON.stringify(value)) as any;
    expect(restored.data.bytes).toEqual(new Uint8Array([1,2,3]));
    expect(restored.data.map).toEqual(new Map([[3,4]]));
    expect(restored.data.set).toEqual(new Set([2]));
    expect(restored.data.score).toBe(-Infinity);
  });
  it("rejects a fixture without a live human controller or supported map", () => {
    for (const patch of [{playerId:1},{mapId:"mediterranean"},{version:2}]) expect(()=>readDiagnosticReplay(JSON.stringify({...replay(),...patch}))).toThrow();
    const dead=replay();dead.checkpoint.players[0].eliminated=true;
    expect(()=>readDiagnosticReplay(JSON.stringify(dead))).toThrow();
  });
});
