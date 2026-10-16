// Bounded property test over the external command boundary (review 18, R5).
// Ported from the review's scratch fuzzer: the same generators, valid-biased
// generators, digest and invariants on a small fixed-seed all-land fixture.
//
// Asserted: no command or tick throws (the match-ending class), the tick
// invariants below, rejected => digest unchanged (R5; roadmap Now #5), and
// accepted => no other faction's entity, stance or trench row changed.
// Asserted since Next #10: the checkpoint -> restore round trip every 250
// commands and validateFormation on every live squad after every tick
// (R2-M11, R2-M12). CommandFuzzRestore restores after every tick.
// Measured on the development desktop: about 25 s for 1,500 commands (seed 1,
// two epochs). Before Now #5 the rejected oracle fails on seed 1: a rejected
// fire-retreat army order flips posture (#148, R2-L14) and a rejected queued
// replenish suppresses stance rows (#201, R2-M10).
import { describe, expect, it } from "vitest";
import { COMMANDS, run, SEED } from "./fixtures/CommandFuzzRun";

describe("command fuzzing (bounded)", () => {
  it(`survives ${COMMANDS} fuzzed commands without a match-ending throw`, () => {
    const started = performance.now();
    const { counters, asserted, tick, processed, epochs } = run();
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    console.info(JSON.stringify({ event: "command-fuzz", seed: SEED, commands: processed, epochs, seconds, tick,
      accepted: counters.accepted, deferred: counters.deferred, rejected: counters.rejected, schemaRejected: counters.schemaRejected,
      validationFailures: counters.validationFailures.map(f => `${f.type}: ${f.message}`),
      rejectedMutated: counters.rejectedMutated, foreignMutated: counters.foreignMutated,
      restoreFailures: counters.restoreFailures, invariantViolations: counters.invariantViolations }));
    expect(counters.applyThrows.map(t => `${t.type}: ${t.message}`)).toEqual([]);
    // Every sampled world survives a checkpoint and restore (Next #10).
    expect(counters.restoreFailures).toEqual([]);
    expect(counters.formationFailures).toEqual([]);
    // A rejected command is side-effect free: every sampled digest is unchanged.
    expect(counters.rejectedSamples.slice(0, 10)).toEqual([]);
    // An accepted command leaves other factions' entities, stance and trench rows alone.
    expect(counters.foreignMutated).toEqual({});
    expect(counters.foreignRows.slice(0, 10)).toEqual([]);
    expect(counters.stepThrows.map(t => `${t.lastType}: ${t.message}`)).toEqual([]);
    expect(processed).toBe(COMMANDS);
    expect(asserted.slice(0, 10)).toEqual([]);
    expect(counters.accepted + counters.deferred).toBeGreaterThan(100);
  }, 120_000);
});
