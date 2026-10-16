import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  COMMAND_VALIDATION_FAILURE,
  CommandApplications,
  type CommandOutcome,
  type CommandValidationFailure,
} from "../../src/skirmish/CommandApplications";
import { SimulationFault } from "../../src/skirmish/SimulationFault";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

const move: Command = {
  type: "order",
  playerId: 1,
  squadIds: [5],
  order: { type: "move", tile: 12 },
};
describe("command receipts", () => {
  describe("throw containment", () => {
    const harness = (apply: (bump: () => void, receipts: CommandApplications) => string | null) => {
      let epoch = 0;
      const outcomes: CommandOutcome[] = [], failures: CommandValidationFailure[] = [];
      const receipts: CommandApplications = new CommandApplications({ tick: () => 7, mutationEpoch: () => epoch,
        apply: () => apply(() => epoch++, receipts) });
      receipts.onOutcome = outcome => outcomes.push(outcome);
      receipts.onValidationFailure = failure => failures.push(failure);
      return { receipts, outcomes, failures };
    };
    it("turns a throw before any write into a rejection and keeps accepting commands", () => {
      let calls = 0;
      const { receipts, outcomes, failures } = harness(() => { if (calls++ === 0) throw new Error("bad read"); return null; });
      expect(receipts.apply("a", move)).toMatchObject({ status: "rejected", reason: COMMAND_VALIDATION_FAILURE });
      expect(outcomes).toHaveLength(1);
      expect(failures).toEqual([expect.objectContaining({ event: "command-validation-failure", id: "a", playerId: 1, type: "order", tick: 7, message: "bad read" })]);
      expect(failures[0].stack.length).toBeLessThanOrEqual(10);
      expect(receipts.diagnostics.pending).toBe(0);
      expect(receipts.apply("b", move).status).toBe("executed");
    });
    it("faults a throw after an observed write", () => {
      const { receipts, outcomes, failures } = harness(bump => { bump(); throw new Error("half written"); });
      expect(() => receipts.apply("a", move)).toThrow(SimulationFault);
      expect(outcomes).toEqual([]);
      expect(failures).toEqual([]);
      // The application scope was released: no "nested application" error.
      expect(() => receipts.apply("b", move)).toThrow("Command application failed after a write");
    });
    it("faults a throw after a domain event or plan", () => {
      const { receipts } = harness((_bump, r) => { r.observe("land", { id: 3, playerId: 1, tick: 7, status: "superseded" }); throw new Error("after event"); });
      expect(() => receipts.apply("a", move)).toThrow(SimulationFault);
      const deferred = harness((_bump, r) => { r.observe("land", { id: 4, playerId: 1, tick: 7, status: "deferred" }); throw new Error("after plan"); });
      expect(() => deferred.receipts.apply("a", move)).toThrow(SimulationFault);
    });
    it("propagates a simulation fault and any throw without an epoch observer unchanged", () => {
      const fault = new SimulationFault("stopped");
      const { receipts } = harness(() => { throw fault; });
      expect(() => receipts.apply("a", move)).toThrow(fault);
      const original = new Error("plain");
      const bare = new CommandApplications({ tick: () => 0, apply: () => { throw original; } });
      expect(() => bare.apply("a", move)).toThrow(original);
    });
  });
  it("reports a committed lead cohort as progress while the receipt stays deferred", () => {
    const progress: number[] = [], outcomes: CommandOutcome["status"][] = [];
    const receipts: CommandApplications = new CommandApplications({ tick: () => 0, apply: () => {
      receipts.observe("land", { id: 1, playerId: 1, tick: 0, status: "deferred" });
      receipts.observe("land", { id: 2, playerId: 1, tick: 0, status: "deferred" });
      return null;
    } });
    receipts.onProgress = playerId => progress.push(playerId);
    receipts.onOutcome = outcome => outcomes.push(outcome.status);
    expect(receipts.apply("large", move).status).toBe("deferred");
    receipts.observe("land", { id: 1, playerId: 1, tick: 2, status: "executed" });
    expect(progress).toEqual([1]);
    expect(outcomes).toEqual(["deferred"]);
    receipts.observe("land", { id: 2, playerId: 1, tick: 5, status: "executed" });
    expect(progress).toEqual([1]);
    expect(outcomes).toEqual(["deferred", "executed"]);
  });
  it.each(["executed","rejected","superseded"] as const)("preserves a land planning handoff through restore until its %s result",status=>{
    const receipts:CommandApplications=new CommandApplications({tick:()=>0,apply:()=>{receipts.observe("land",{id:17,playerId:1,tick:0,status:"deferred"});return null;}});
    expect(receipts.apply("crossing",move).status).toBe("deferred");
    receipts.handoff("land",17,1,()=>{
      receipts.observe("land",{id:1,playerId:1,tick:12,status:"deferred"});
      receipts.observe("land",{id:2,playerId:1,tick:12,status:"deferred"});
    });
    receipts.observe("land",{id:17,playerId:1,tick:12,status:"executed"});
    receipts.observe("land",{id:1,playerId:1,tick:13,status:"executed"});
    expect(receipts.apply("crossing",move).status).toBe("deferred");
    const restored=new CommandApplications({tick:()=>14,apply:()=>{throw new Error("receipt replay must not reapply the command");}});
    restored.restore(receipts.checkpoint());
    restored.observe("land",{id:2,playerId:1,tick:14,status,reason:status==="rejected"?"Destination blocked":undefined});
    expect(restored.apply("crossing",move)).toMatchObject({id:"crossing",playerId:1,tick:14,status});
    expect(restored.diagnostics.pending).toBe(0);
  });
  it("continues current orders, queues Shift intent and resumes original receipts from a simulation checkpoint", () => {
    const create = () => {
      const terrain = new Uint8Array(7000).fill(133);
      return new Skirmish(new GameMapImpl(100, 70, terrain, terrain.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
        deferredPlanning: true,
      });
    };
    const first = create(),
      squads = first.squads.filter((s) => s.playerId === 1),
      ids = squads.map((s) => s.id);
    const old = squads.map((s) => structuredClone(s.order));
    const command: Command = {
      type: "order",
      playerId: 1,
      squadIds: ids,
      order: { type: "move", tile: first.map.ref(75, 50) },
    };
    expect(first.commandApplications.apply("move", command).status).toBe(
      "deferred",
    );
    expect(squads.map((s) => s.order)).toEqual(old);
    expect(
      first.commandApplications.apply("shift", {
        ...command,
        append: true,
        order: { type: "move", tile: first.map.ref(50, 50) },
      }).status,
    ).toBe("deferred");
    const restored = create();
    restored.restore(first.checkpoint());
    const outcomes: CommandOutcome[] = [];
    restored.commandApplications.onOutcome = (o) => outcomes.push(o);
    for (
      let i = 0;
      i < 400 && restored.commandApplications.diagnostics.pending;
      i++
    )
      restored.step();
    expect(outcomes.map((o) => [o.id, o.status]).sort()).toEqual([
      ["move", "executed"],
      ["shift", "executed"],
    ]);
    expect(restored.commandApplications.diagnostics.pending).toBe(0);
    expect(restored.commandApplications.apply("move", command).status).toBe(
      "executed",
    );
    const orders = restored.squads
      .filter((s) => s.playerId === 1)
      .map((s) => structuredClone(s.order));
    restored.setAiController(1, true);
    expect(
      restored.squads.filter((s) => s.playerId === 1).map((s) => s.order),
    ).toEqual(orders);
  });
  it("supersedes original inputs on manual replacement and faction control transfer", () => {
    const terrain = new Uint8Array(7000).fill(133),
      match = new Skirmish(new GameMapImpl(100, 70, terrain, terrain.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
        deferredPlanning: true,
      });
    const command: Command = {
      type: "order",
      playerId: 1,
      squadIds: match.squads.filter((s) => s.playerId === 1).map((s) => s.id),
      order: { type: "move", tile: match.map.ref(75, 50) },
    };
    const outcomes: CommandOutcome[] = [];
    match.commandApplications.onOutcome = (o) => outcomes.push(o);
    match.commandApplications.apply("old", command);
    match.commandApplications.apply("new", {
      ...command,
      order: { type: "move", tile: match.map.ref(65, 45) },
    });
    expect(outcomes).toContainEqual(
      expect.objectContaining({ id: "old", status: "superseded" }),
    );
    match.setAiController(1, true);
    expect(outcomes).toContainEqual(
      expect.objectContaining({
        id: "new",
        status: "superseded",
        reason: "Faction control changed",
      }),
    );
    expect(match.commandApplications.diagnostics.pending).toBe(0);
  });
  it("reports deferred and terminal execution against the original input, and deduplicates retries", () => {
    let calls = 0,
      tick = 5;
    const applications = new CommandApplications({
      tick: () => tick,
      apply: () => {
        calls++;
        applications.observe("land", {
          id: 17,
          playerId: 1,
          tick,
          status: "deferred",
        });
        return null;
      },
    });
    const results: CommandOutcome[] = [];
    applications.onOutcome = (o) => results.push(o);
    expect(applications.apply("input-1", move).status).toBe("deferred");
    applications.apply("input-1", move);
    expect(calls).toBe(1);
    tick = 9;
    applications.observe("land", {
      id: 17,
      playerId: 1,
      tick,
      status: "executed",
    });
    expect(results[results.length - 1]).toMatchObject({
      id: "input-1",
      tick: 9,
      status: "executed",
    });
    expect(applications.apply("input-1", move).status).toBe("executed");
    expect(calls).toBe(1);
    expect(applications.diagnostics.pending).toBe(0);
  });
  it("keeps land and water IDs distinct and resumes their receipts after a checkpoint", () => {
    let source: "land" | "water" = "land";
    const first = new CommandApplications({
      tick: () => 0,
      apply: () => {
        first.observe(source, {
          id: 1,
          playerId: 1,
          tick: 0,
          status: "deferred",
        });
        return null;
      },
    });
    first.apply("land-input", move);
    source = "water";
    first.apply("water-input", move);
    const restored = new CommandApplications({
      tick: () => 0,
      apply: () => null,
    });
    restored.restore(first.checkpoint());
    const results: CommandOutcome[] = [];
    restored.onOutcome = (o) => results.push(o);
    restored.observe("water", {
      id: 1,
      playerId: 1,
      tick: 7,
      status: "rejected",
      reason: "Lost ship",
    });
    expect(results[0]).toMatchObject({
      id: "water-input",
      reason: "Lost ship",
    });
    expect(restored.diagnostics.pending).toBe(1);
    restored.release(1, 8);
    expect(results[1]).toMatchObject({
      id: "land-input",
      tick: 8,
      status: "superseded",
    });
    restored.observe("land", {
      id: 1,
      playerId: 1,
      tick: 9,
      status: "executed",
    });
    expect(results).toHaveLength(2);
  });
  it("rejects excess planning input before mutation while preserving stop access", () => {
    let calls = 0;
    const app = new CommandApplications(
      {
        tick: () => 0,
        apply: (c) => {
          calls++;
          if (c.type === "order")
            app.observe("land", {
              id: calls,
              playerId: 1,
              tick: 0,
              status: "deferred",
            });
          return null;
        },
      },
      1,
    );
    app.apply("one", move);
    expect(app.apply("two", move).status).toBe("rejected");
    expect(calls).toBe(1);
    expect(
      app.apply("stop", { type: "stop-ships", playerId: 1, shipIds: [3] })
        .status,
    ).toBe("executed");
    expect(calls).toBe(2);
  });
});
