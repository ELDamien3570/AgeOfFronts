import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { COMMAND_VALIDATION_FAILURE, type CommandOutcome } from "../../src/skirmish/CommandApplications";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import {
  type AdvanceInput,
  MatchAdvanceRunner,
  MatchFaultError,
  type MatchFaultReport,
} from "../../src/skirmish/multiplayer/application/MatchAdvanceRunner";
import type { MatchCommand } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { MatchJournal, ROLLBACK_BUDGET } from "../../src/skirmish/multiplayer/application/MatchJournal";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

/** Rollback containment (roadmap Next #10, P4): a fault restores the last
 * checkpoint into a fresh simulation, replays the journaled inputs and re-runs
 * the faulting advance with changed inputs. */
const W = 160, H = 100;
const options = {
  ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
  seed: 7, humanNames: ["H"], aiCount: 1, tribes: false, ruleset: "ages-v1", startingAge: "Napoleonic", runAi: true,
} as ConstructorParameters<typeof Skirmish>[1];
const terrain = new Uint8Array(W * H).fill(133);
const map = () => new GameMapImpl(W, H, terrain, terrain.length);
type Internals = { drainRoutes(): void };

function setup(interval = 20) {
  const game = new Skirmish(map(), options);
  const logs: string[] = [], outcomes = new Map<string, CommandOutcome>(), installed: Skirmish[] = [];
  const collect = (outcome: CommandOutcome) => outcomes.set(`${outcome.playerId}:${outcome.id}`, outcome);
  const attach = (match: Skirmish) => { match.commandApplications.onOutcome = collect; };
  attach(game);
  const runner = new MatchAdvanceRunner(game, () => ({ matchId: "m", runtimeId: "r", source: "test" }), line => logs.push(line),
    { create: () => new Skirmish(map(), options), attach, installed: match => installed.push(match) }, new MatchJournal(interval));
  return { game, runner, logs, outcomes, installed, collect };
}
const squadOf = (game: Skirmish) => game.squads.find(s => s.playerId === 1)!.id;
const hold = (game: Skirmish, id: string): MatchCommand => ({ id, command: { type: "order", playerId: 1, squadIds: [squadOf(game)], order: { type: "hold" } } });
const move = (game: Skirmish, id: string, x: number, y: number): MatchCommand =>
  ({ id, command: { type: "order", playerId: 1, squadIds: [squadOf(game)], order: { type: "move", tile: game.map.ref(x, y) } } });
const faults = (logs: string[]) => logs.map(line => JSON.parse(line) as MatchFaultReport).filter(entry => entry.event === "match-simulation-fault");
/** The same inputs on a runner that never faults. */
function reference(inputs: (AdvanceInput | { control: [number, boolean] })[]) {
  const game = new Skirmish(map(), options);
  const runner = new MatchAdvanceRunner(game, () => ({ matchId: "ref", runtimeId: "r", source: "test" }), () => {});
  for (const input of inputs) {
    if ("control" in input) runner.setController(...input.control);
    else runner.advance(input, () => {});
  }
  return game;
}
const withoutReceipts = (game: Skirmish) => ({ ...game.checkpoint(), commandApplications: undefined });
afterEach(() => { vi.restoreAllMocks(); });

describe("rollback containment", () => {
  it("A: drops a command that throws after writing, continues the batch and steps", () => {
    const { game, runner, logs, outcomes, installed, collect } = setup();
    const first: AdvanceInput = { commands: [move(game, "m0", 40, 40)], ticks: 3 };
    expect(runner.advance(first, () => {}).rolledBack).toBe(false);
    const squad = game.squads.find(s => s.playerId === 1)!;
    const apply = game.applyCommand.bind(game);
    vi.spyOn(game, "applyCommand").mockImplementation((command: Command) => {
      if (command.type === "research") { game.updateSquad(squad.id, { troops: squad.troops - 1 }); throw new Error("half applied"); }
      return apply(command);
    });
    const w: MatchCommand = { id: "w", command: { type: "research", playerId: 1, technologyId: "x" } };
    const batch: AdvanceInput = { commands: [hold(game, "first"), w, move(game, "after", 60, 30)], ticks: 2 };
    const tick = game.tick;
    const result = runner.advance(batch, collect);
    expect(result.rolledBack).toBe(true);
    expect(result.rejectedCommands).toEqual([{ id: "w", playerId: 1, message: COMMAND_VALIDATION_FAILURE }]);
    expect(["first", "w", "after"].map(id => [id, outcomes.get(`1:${id}`)?.status])).toEqual([["first", "executed"], ["w", "rejected"], ["after", "executed"]]);
    expect(outcomes.get("1:w")?.reason).toBe(COMMAND_VALIDATION_FAILURE);
    expect(installed).toHaveLength(1);
    expect(runner.match).toBe(installed[0]);
    expect(runner.match.tick).toBe(tick + 2);
    expect(runner.faulted).toBeUndefined();
    expect(faults(logs)).toEqual([expect.objectContaining({ stage: "command", recovery: "rolled-back", droppedCommandIds: ["w"], replayedTicks: 3 })]);
    // The world equals a run where that command never applied.
    const ref = reference([first, { commands: [hold(game, "first"), move(game, "after", 60, 30)], ticks: 2 }]);
    expect(withoutReceipts(runner.match)).toEqual(withoutReceipts(ref));
  });
  it("B: recovers a tick throw at the same tick without the faulting advance's commands", () => {
    const { game, runner, logs, installed } = setup();
    const first: AdvanceInput = { commands: [move(game, "m0", 40, 40)], ticks: 4 };
    runner.advance(first, () => {});
    const oldStep = vi.spyOn(game, "step");
    vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementationOnce(() => { throw new Error("injected"); });
    const faulting: AdvanceInput = { commands: [move(game, "m1", 70, 20)], ticks: 2 };
    const result = runner.advance(faulting, () => {});
    expect(result.rolledBack).toBe(true);
    expect(result.rejectedCommands).toEqual([{ id: "m1", playerId: 1, message: COMMAND_VALIDATION_FAILURE }]);
    expect(oldStep).toHaveBeenCalledTimes(1);
    expect(game.tickFault).toBeDefined();
    expect(runner.match).toBe(installed[0]);
    expect(runner.match.tick).toBe(6);
    expect(faults(logs)).toEqual([expect.objectContaining({ stage: "tick", afterPhase: "ships", recovery: "rolled-back", droppedCommandIds: ["m1"], replayedTicks: 4 })]);
    const ref = reference([first, { commands: [], ticks: 2 }]);
    expect(withoutReceipts(runner.match)).toEqual(withoutReceipts(ref));
    // The old instance is never stepped again.
    runner.advance({ commands: [], ticks: 2 }, () => {});
    expect(oldStep).toHaveBeenCalledTimes(1);
  });
  it("C: ends the match when the replay faults again", () => {
    const { runner, logs, installed, game } = setup();
    runner.advance({ commands: [move(game, "m0", 40, 40)], ticks: 2 }, () => {});
    vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementation(() => { throw new Error("always"); });
    expect(() => runner.advance({ commands: [hold(game, "h")], ticks: 1 }, () => {})).toThrow(MatchFaultError);
    expect(runner.faulted).toMatchObject({ stage: "tick", recovery: "failed", droppedCommandIds: ["h"] });
    expect(faults(logs)).toHaveLength(1);
    expect(installed).toHaveLength(0);
    expect(() => runner.advance({ commands: [], ticks: 1 }, () => {})).toThrow(MatchFaultError);
  });
  it("C: never replays unchanged inputs", () => {
    const { runner, logs, installed, game } = setup();
    runner.advance({ commands: [move(game, "m0", 40, 40)], ticks: 2 }, () => {});
    const drain = vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementationOnce(() => { throw new Error("once"); });
    expect(() => runner.advance({ commands: [], ticks: 1 }, () => {})).toThrow(MatchFaultError);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(faults(logs)[0]).toMatchObject({ recovery: "failed", droppedCommandIds: [], replayedTicks: 0 });
    expect(installed).toHaveLength(0);
  });
  it("D: replays seat handovers, disconnects and AI-seat rejections in order", () => {
    const { game, runner, installed } = setup(1000);
    const inputs: (AdvanceInput | { control: [number, boolean] })[] = [
      { commands: [move(game, "m0", 40, 40)], ticks: 3 },
      { control: [1, true] },
      { commands: [move(game, "ai-seat", 20, 20)], ticks: 2 },
      { control: [1, false] },
      { commands: [move(game, "m2", 90, 60)], ticks: 3 },
      { commands: [], ticks: 2, disconnectedPlayerIds: [1] },
      { control: [1, false] },
    ];
    for (const input of inputs) {
      if ("control" in input) runner.setController(...input.control);
      else runner.advance(input, () => {});
    }
    vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementationOnce(() => { throw new Error("injected"); });
    expect(runner.advance({ commands: [move(game, "m3", 30, 80)], ticks: 2 }, () => {}).rolledBack).toBe(true);
    expect(installed).toHaveLength(1);
    const ref = reference([...inputs, { commands: [], ticks: 2 }]);
    expect(withoutReceipts(runner.match)).toEqual(withoutReceipts(ref));
  });
  it("E: ends the match once the rollback budget is spent", () => {
    const { game, runner, logs, installed } = setup();
    runner.advance({ commands: [], ticks: 1 }, () => {});
    for (let fault = 0; fault <= ROLLBACK_BUDGET; fault++) {
      vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementationOnce(() => { throw new Error(`fault ${fault}`); });
      const advance = () => runner.advance({ commands: [hold(runner.match, `h${fault}`)], ticks: 1 }, () => {});
      if (fault < ROLLBACK_BUDGET) expect(advance().rolledBack).toBe(true);
      else expect(advance).toThrow(MatchFaultError);
    }
    expect(installed).toHaveLength(ROLLBACK_BUDGET);
    expect(faults(logs).map(f => f.recovery)).toEqual([...Array(ROLLBACK_BUDGET).fill("rolled-back"), "budget"]);
    expect(game.tickFault).toBeDefined();
  });
  it("F: delivers outcomes of later commands from the recovered instance", () => {
    const { game, runner, outcomes } = setup();
    runner.advance({ commands: [], ticks: 1 }, () => {});
    vi.spyOn(Skirmish.prototype as unknown as Internals, "drainRoutes").mockImplementationOnce(() => { throw new Error("injected"); });
    expect(runner.advance({ commands: [hold(game, "dropped")], ticks: 1 }, () => {}).rolledBack).toBe(true);
    outcomes.clear();
    runner.advance({ commands: [move(runner.match, "later", 50, 50)], ticks: 1 }, () => {});
    expect(outcomes.get("1:later")?.status).toBe("executed");
    // Recent commands survive the rollback.
    expect(runner.recentCommands.map(c => c.id)).toEqual(["dropped", "later"]);
  });
});
