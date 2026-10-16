// Checkpoint -> restore after every tick on the command-fuzz fixture (roadmap
// Next #10, P4b). Rollback makes restore a live path: every world the fuzz
// reaches must restore into a fresh instance and continue from it. The fuzz
// continues on the restored instance; every 25th restore is also compared
// with its checkpoint. One construction per tick: the timing is the
// integration lead's, not a gate here.
import { describe, expect, it } from "vitest";
import { run } from "./fixtures/CommandFuzzRun";

const COMMANDS = 300;
describe("command fuzzing with a restore after every tick", () => {
  it(`restores every tick across ${COMMANDS} fuzzed commands`, () => {
    const { counters, asserted, processed } = run({ commands: COMMANDS, restoreEveryTick: true, compareEvery: 25 });
    expect(counters.restoreFailures).toEqual([]);
    expect(counters.formationFailures).toEqual([]);
    expect(counters.applyThrows.map(t => `${t.type}: ${t.message}`)).toEqual([]);
    expect(counters.stepThrows.map(t => `${t.lastType}: ${t.message}`)).toEqual([]);
    expect(asserted.slice(0, 10)).toEqual([]);
    expect(processed).toBe(COMMANDS);
    expect(counters.restores).toBeGreaterThan(COMMANDS);
  }, 600_000);
});
