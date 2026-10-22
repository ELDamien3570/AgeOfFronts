import { describe, expect, it } from "vitest";
import { seaFleet } from "./SeaTradeFixture";
import { Skirmish } from "../../src/skirmish/Simulation";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { diffState, applyDelta } from "../../src/skirmish/multiplayer/StateDelta";
import { restoreAiMinimum } from "../../src/skirmish/domain/AiCheckpointMinimum";

describe("lossless AI checkpoint minimum migration", () => {
  it("preserves finite values and represents only unbounded positive minima as missing", () => {
    for (const value of [0, -0, 0.5, -12, Number.MAX_VALUE]) expect(Object.is(restoreAiMinimum(value), value)).toBe(true);
    expect(restoreAiMinimum(Infinity)).toBeUndefined(); expect(restoreAiMinimum(undefined)).toBeUndefined();
    expect(() => restoreAiMinimum(NaN)).toThrow("checkpoint minimum");
    expect(() => restoreAiMinimum(-Infinity)).toThrow("checkpoint minimum");
  });
  it("migrates old operation/naval sentinels through whole-state portable transport and deltas", async () => {
    const f = seaFleet();
    f.expansion.operations.restore({ records: [[1, { phase: "peace", since: 0, nextThink: 0, threats: [], cursor: 0, score: Infinity }]], revision: 0, territorialRevision: 0 });
    f.expansion.economy.naval.restore({ missions: [[1, {
      id: "naval:1", playerId: 1, generation: 1, objective: "raid-trade", sea: 1,
      state: "stage", reason: "checkpoint regression", createdTick: 0, deadline: 100,
      nextAssessment: 0, members: [], purchases: 0,
      assessment: { phase: "buildings", portDistance: Infinity, targetDistance: Infinity, members: [], enemyPower: 0, futurePower: 0 },
    }]], funding: [], theaters: [], history: [], cursor: 0, serial: 1 });
    expect(f.expansion.operations.state(1)!.score).toBeUndefined();
    const before = f.game.checkpoint();
    expect(before.expansion!.economy.naval.missions[0][1].assessment).toMatchObject({ portDistance: undefined, targetDistance: undefined });
    const portable = await decodeState<ReturnType<Skirmish["checkpoint"]>>(await encodeState(before));
    const cold = new Skirmish(f.map(), f.options); cold.restore(portable);
    expect(cold.checkpoint()).toEqual(before);
    f.step(8); for (let i = 0; i < 8; i++) cold.step();
    const after = f.game.checkpoint(); expect(cold.checkpoint()).toEqual(after);
    const delta = await decodeState<ReturnType<typeof diffState>>(await encodeState(diffState(before, after)));
    expect(applyDelta(before, delta)).toEqual(after);
    const old = structuredClone(before); old.expansion!.operations.records[0][1].score = Infinity;
    old.expansion!.economy.naval.missions[0][1].assessment!.targetDistance = Infinity;
    old.expansion!.economy.naval.missions[0][1].assessment!.portDistance = Infinity;
    cold.restore(old); expect(cold.checkpoint()).toEqual(before);
  });
});
