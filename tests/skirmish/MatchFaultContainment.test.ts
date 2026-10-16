import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { COMMAND_VALIDATION_FAILURE, type CommandOutcome } from "../../src/skirmish/CommandApplications";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import {
  MatchAdvanceRunner,
  MatchFaultError,
  RECENT_COMMAND_LIMIT,
  type MatchFaultReport,
} from "../../src/skirmish/multiplayer/application/MatchAdvanceRunner";
import { MATCH_FAULT_CODE, type MatchCommand } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SimulationFault } from "../../src/skirmish/SimulationFault";

const W = 160, H = 100;
function setup() {
  const terrain = new Uint8Array(W * H).fill(133);
  const game = new Skirmish(new GameMapImpl(W, H, terrain, terrain.length), {
    ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
    seed: 7, humanNames: ["H"], aiCount: 1, tribes: false, ruleset: "ages-v1", startingAge: "Napoleonic", runAi: false,
  } as ConstructorParameters<typeof Skirmish>[1]);
  const logs: string[] = [], outcomes: CommandOutcome[] = [];
  game.commandApplications.onOutcome = outcome => outcomes.push(outcome);
  game.commandApplications.onValidationFailure = failure => logs.push(JSON.stringify(failure));
  const runner = new MatchAdvanceRunner(game, () => ({ matchId: "m-1", runtimeId: "r-1", source: "test" }), line => logs.push(line));
  const squad = game.squads.find(s => s.playerId === 1)!;
  const hold = (id: string): MatchCommand => ({ id, command: { type: "order", playerId: 1, squadIds: [squad.id], order: { type: "hold" } } });
  return { game, runner, logs, outcomes, hold };
}
const report = (logs: string[]) => logs.map(line => JSON.parse(line) as MatchFaultReport).filter(entry => entry.event === "match-simulation-fault");

describe("match fault containment", () => {
  it("never steps a half-ticked world again after a mid-tick throw", () => {
    const { game, runner, logs, hold } = setup();
    runner.applyCommands(Array.from({ length: 70 }, (_, i) => hold(`h${i}`)), () => {});
    runner.step(2);
    const before = game.tick;
    const drain = vi.spyOn(game as unknown as { drainRoutes(): void }, "drainRoutes")
      .mockImplementationOnce(() => { throw new Error("injected secret detail"); });
    const step = vi.spyOn(game, "step");
    let thrown: unknown;
    try { runner.step(3); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(MatchFaultError);
    // The tick counter advances at tick start, so the fault reports the
    // half-run tick; it stays frozen afterwards.
    const faultTick = game.tick;
    expect(faultTick).toBe(before + 1);
    expect((thrown as Error).message).toBe(MATCH_FAULT_CODE);
    expect((thrown as Error).message).not.toContain("injected");
    expect(step).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(game.tickFault).toMatchObject({ tick: faultTick, afterPhase: "ships", message: "injected secret detail" });
    const faults = report(logs);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ matchId: "m-1", runtimeId: "r-1", source: "test", tick: faultTick, stage: "tick", afterPhase: "ships", message: "injected secret detail" });
    expect(faults[0].recentCommands).toHaveLength(RECENT_COMMAND_LIMIT);
    expect(faults[0].recentCommands[RECENT_COMMAND_LIMIT - 1].id).toBe("h69");
    expect(faults[0].stack.length).toBeGreaterThan(0);
    expect(faults[0].stack.length).toBeLessThanOrEqual(10);
    // No later advance, command or direct step runs the faulted world.
    expect(() => runner.step(1)).toThrow(MatchFaultError);
    expect(() => runner.applyCommands([hold("late")], () => {})).toThrow(MatchFaultError);
    expect(step).toHaveBeenCalledTimes(1);
    expect(() => game.step()).toThrow(SimulationFault);
    expect(() => game.commandApplications.apply("direct", hold("direct").command)).toThrow(SimulationFault);
    expect(game.tick).toBe(faultTick);
    expect(runner.faulted?.tick).toBe(faultTick);
  });
  it("rejects a command whose validation throws and keeps the batch and tick running", () => {
    const { game, runner, logs, outcomes, hold } = setup();
    const apply = game.applyCommand.bind(game);
    vi.spyOn(game, "applyCommand").mockImplementation((command: Command) => {
      if (command.type === "research" && command.technologyId === "explode") throw new Error("validation bug");
      return apply(command);
    });
    const bad: MatchCommand = { id: "bad", command: { type: "research", playerId: 1, technologyId: "explode" } };
    const rejected = runner.applyCommands([hold("first"), bad, hold("third")], () => {});
    expect(rejected).toEqual([{ id: "bad", playerId: 1, message: COMMAND_VALIDATION_FAILURE }]);
    expect(outcomes.map(o => [o.id, o.status])).toEqual([["first", "executed"], ["bad", "rejected"], ["third", "executed"]]);
    expect(logs.map(line => JSON.parse(line).event)).toEqual(["command-validation-failure"]);
    const tick = game.tick;
    runner.step(2);
    expect(game.tick).toBe(tick + 2);
    expect(runner.faulted).toBeUndefined();
  });
  it("faults a command that throws after writing and stops the batch before stepping", () => {
    const { game, runner, logs, hold } = setup();
    const squad = game.squads.find(s => s.playerId === 1)!;
    const apply = game.applyCommand.bind(game);
    vi.spyOn(game, "applyCommand").mockImplementation((command: Command) => {
      if (command.type === "research") { game.updateSquad(squad.id, { troops: squad.troops - 1 }); throw new Error("half applied"); }
      return apply(command);
    });
    const step = vi.spyOn(game, "step");
    expect(() => runner.applyCommands([{ id: "w", command: { type: "research", playerId: 1, technologyId: "x" } }, hold("after")], () => {}))
      .toThrow(MatchFaultError);
    expect(report(logs)).toEqual([expect.objectContaining({ stage: "command", afterPhase: "commands", message: "half applied" })]);
    expect(report(logs)[0].recentCommands.map(c => c.id)).toEqual(["w"]);
    expect(() => runner.step(1)).toThrow(MatchFaultError);
    expect(step).not.toHaveBeenCalled();
  });
});
