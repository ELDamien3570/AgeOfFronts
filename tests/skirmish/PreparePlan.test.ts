import { describe, expect, it, vi } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { RuntimeMap } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import {
  deriveRetrySeed,
  PREPARE_MAX_RETRIES,
  PREPARE_RETRY_BUDGET_MS,
  preparePlan,
  type PrepareDeps,
} from "../../src/skirmish/multiplayer/application/PreparePlan";
import { PUBLIC_SETUP_ERRORS } from "../../src/skirmish/multiplayer/application/TerminalMessages";

const land = (): RuntimeMap => ({ width: 120, height: 80, terrain: new Uint8Array(120 * 80).fill(133) });
const water = (): RuntimeMap => ({ width: 120, height: 80, terrain: new Uint8Array(120 * 80) });
const options = { seed: 1234, aiCount: 2, humanNames: ["A", "B"] };

function harness(load: PrepareDeps["load"], clock = { t: 0 }) {
  const logs: { level: string; event: Record<string, unknown> }[] = [];
  const identity = vi.fn(async (map: RuntimeMap) => `hash-${map.width}x${map.height}`);
  const deps: PrepareDeps = {
    load: vi.fn(load),
    identity,
    makeMap: (map) => createSkirmishMap(map.width, map.height, map.terrain, map.elevation, map.forest, map.resourceTerrain),
    now: () => clock.t,
    log: (level, event) => logs.push({ level, event }),
  };
  return { deps, logs, identity, clock };
}
const ok = () => ({ map: land(), territoryIncomeScale: 1 });

describe("prepare plan retries a bad generated seed (R2-L7)", () => {
  it("retries once with a derived seed and returns and logs the seed that worked", async () => {
    const settings = defaultLobbySettings("black-forest", 250);
    let calls = 0;
    const { deps, logs, identity } = harness(async () => {
      if (calls++ === 0) throw new Error("Invalid forest passage");
      return ok();
    });
    const plan = await preparePlan({ settings, options }, deps);
    const derived = deriveRetrySeed(1234);
    expect((deps.load as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual([1234, derived]);
    expect(plan.prepared.options.seed).toBe(derived);
    // The spawn plan and the options later handed to the simulation share the seed.
    expect(plan.setup.options.seed).toBe(derived);
    expect(plan.prepared.mapHash).toBe("hash-120x80");
    expect(identity).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      { level: "warn", event: { event: "map-prepare-failed", mapId: "black-forest", size: 250, seed: 1234, attempt: 0, genMs: 0, message: "Invalid forest passage" } },
      { level: "info", event: { event: "map-prepared", mapId: "black-forest", size: 250, seed: derived, mapHash: "hash-120x80", genMs: 0, attempt: 1 } },
    ]);
  });

  it("logs {mapId, size, seed, mapHash, genMs} for a first-try success", async () => {
    const clock = { t: 0 };
    const { deps, logs } = harness(async () => { clock.t += 1500; return ok(); }, clock);
    const plan = await preparePlan({ settings: defaultLobbySettings("migration", 500), options }, deps);
    expect(plan.prepared.options.seed).toBe(1234);
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toMatchObject({ event: "map-prepared", mapId: "migration", size: 500, seed: 1234, mapHash: "hash-120x80", genMs: 1500, attempt: 0 });
  });

  it("gives up after the last retry with the last error and one failure log per attempt", async () => {
    const { deps, logs, identity } = harness(async (_settings, seed) => { throw new Error(`bad ${seed}`); });
    const settings = defaultLobbySettings("continents", 250);
    const seeds = [1234];
    for (let i = 0; i < PREPARE_MAX_RETRIES; i++) seeds.push(deriveRetrySeed(seeds[i]));
    await expect(preparePlan({ settings, options }, deps)).rejects.toThrow(`bad ${seeds[3]}`);
    expect(deps.load).toHaveBeenCalledTimes(PREPARE_MAX_RETRIES + 1);
    expect(logs.map((l) => [l.event.event, l.event.seed, l.event.attempt])).toEqual(
      seeds.map((seed, attempt) => ["map-prepare-failed", seed, attempt]),
    );
    expect(identity).not.toHaveBeenCalled();
  });

  it("does not retry the setup errors that players can act on", async () => {
    for (const message of PUBLIC_SETUP_ERRORS) {
      const { deps, logs } = harness(async () => { throw new Error(message); });
      await expect(preparePlan({ settings: defaultLobbySettings("black-forest", 250), options }, deps)).rejects.toThrow(message);
      expect(deps.load).toHaveBeenCalledTimes(1);
      expect(logs).toHaveLength(1);
    }
    // The real spawn rules raise the same class of error from the map itself.
    const { deps } = harness(async () => ({ map: water(), territoryIncomeScale: 1 }));
    await expect(preparePlan({ settings: defaultLobbySettings("black-forest", 250), options }, deps)).rejects.toThrow("No viable land for starting camps");
    expect(deps.load).toHaveBeenCalledTimes(1);
  });

  it("does not retry heightmap maps or a pre-built map", async () => {
    const { deps } = harness(async () => { throw new Error("Corrupt heightmap"); });
    await expect(preparePlan({ settings: defaultLobbySettings("africa", 250), options }, deps)).rejects.toThrow("Corrupt heightmap");
    expect(deps.load).toHaveBeenCalledTimes(1);
    const prebuilt = harness(async () => { throw new Error("must not load"); });
    const plan = await preparePlan({ settings: defaultLobbySettings("black-forest", 250), options, map: land() }, prebuilt.deps);
    expect(prebuilt.deps.load).not.toHaveBeenCalled();
    expect(plan.prepared.options.seed).toBe(1234);
    const broken = harness(async () => ok());
    broken.deps.makeMap = () => { throw new Error("Invalid Elevation"); };
    await expect(preparePlan({ settings: defaultLobbySettings("black-forest", 250), options, map: land() }, broken.deps)).rejects.toThrow("Invalid Elevation");
    expect(broken.logs).toHaveLength(1);
  });

  it("stops retrying when another attempt would pass the time budget", async () => {
    const slow = { t: 0 };
    const a = harness(async () => { slow.t += 70_000; throw new Error("slow failure"); }, slow);
    await expect(preparePlan({ settings: defaultLobbySettings("black-forest", 1000), options }, a.deps)).rejects.toThrow("slow failure");
    // 70 s spent, another 70 s attempt would reach 140 s > 120 s.
    expect(a.deps.load).toHaveBeenCalledTimes(1);
    const fast = { t: 0 };
    const b = harness(async () => { fast.t += 30_000; throw new Error("fast failure"); }, fast);
    await expect(preparePlan({ settings: defaultLobbySettings("black-forest", 1000), options }, b.deps)).rejects.toThrow("fast failure");
    // 30 s, 60 s, 90 s are allowed to continue (90 + 30 = 120 is not over); the fourth is the last.
    expect(b.deps.load).toHaveBeenCalledTimes(4);
    expect(PREPARE_RETRY_BUDGET_MS).toBe(120_000);
  });
});

describe("deriveRetrySeed", () => {
  it("is deterministic, stays a valid seed, and does not cycle within three steps", () => {
    for (const seed of [0, 1, 42, 2026, 0x7fffffff, 2 ** 31 - 2, 123456789]) {
      const first = deriveRetrySeed(seed),
        second = deriveRetrySeed(first),
        third = deriveRetrySeed(second);
      expect(deriveRetrySeed(seed)).toBe(first);
      for (const value of [first, second, third]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0x7fffffff);
      }
      expect(new Set([seed, first, second, third]).size).toBe(4);
    }
  });
});
