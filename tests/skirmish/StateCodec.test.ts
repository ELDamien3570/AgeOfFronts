import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { Skirmish } from "../../src/skirmish/Simulation";
describe("portable recovery transport", () => {
  it("preserves maps, sets, typed arrays and optional fields", async () => {
    const state = { map: new Map([[1, new Set([2,3])]]), bytes: new Uint8Array([1,2,255]), signed: new Int32Array([-1,300]), clearing: new Uint16Array([4,600]), optional: undefined };
    expect(await decodeState(await encodeState(state))).toEqual(state);
  });
  it("rejects tampered checkpoint contents", async () => {
    const encoded = await encodeState({ tick: 10 });
    encoded.hash = "0".repeat(64);
    await expect(decodeState(encoded)).rejects.toThrow("hash mismatch");
  });
  it("restores a forest-aware match after encoding and continues identically", async () => {
    const terrain = new Uint8Array(100 * 64).fill(133);
    const forest = { cover: new Uint8Array(terrain.length).fill(200) };
    const map = () => createSkirmishMap(100,64,terrain,undefined,forest);
    const options = { seed: 55, aiCount: 3, ruleset: "ages-v1" as const };
    const first = new Skirmish(map(), options);
    for (let i=0;i<85;i++) first.step();
    const saved = await decodeState<ReturnType<Skirmish["checkpoint"]>>(await encodeState(first.checkpoint()));
    const second = new Skirmish(map(), options);
    second.restore(saved);
    expect(second.checkpoint()).toEqual(first.checkpoint());
    for (let i=0;i<80;i++) {first.step();second.step();}
    expect(second.checkpoint()).toEqual(first.checkpoint());
  }, 15_000);
});
