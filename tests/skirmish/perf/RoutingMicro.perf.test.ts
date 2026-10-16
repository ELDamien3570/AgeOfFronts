/**
 * Opt-in routing micro-benchmarks for roadmap Next #1 (R2-P6, R2-P2, D5).
 * Timing gates are meaningless on a contended host, so the whole file is
 * skipped unless SKIRMISH_PERF=1:
 *
 *   SKIRMISH_PERF=1 npx vitest run --config vite.skirmish.config.ts tests/skirmish/perf/RoutingMicro.perf.test.ts
 */
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { MovementAdmission } from "../../../src/skirmish/MovementAdmission";
import { FIXED, TICKS_PER_SECOND } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { retainSquads } from "../UnitFixtures";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";

const enabled = process.env.SKIRMISH_PERF === "1";

/** The load harness's Med/Mig 500 live configuration with one human seat. */
async function liveMatch(mapId: "heightmap-test1" | "migration", seed = 1272661902, size: 500 | 1000 = 500) {
  const settings = { ...defaultLobbySettings(mapId, size), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" } as never;
  const loaded = await loadServerMap(settings, "resources", seed), m = loaded.map;
  const options = { ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed,
    humanNames: ["H1"], aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1", victoryMode: "solo", technologySpeed: 1,
    startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1, infiniteGoldForPlayers: false, alliances: false,
    territoryIncomeScale: loaded.territoryIncomeScale } as ConstructorParameters<typeof Skirmish>[1];
  return new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), options);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe.runIf(enabled)("routing micro-benchmarks (opt-in)", () => {
  it("B1: one priority admission pass over P=500 pending, humans waiting on the planner, under 1 ms", () => {
    const width = 160, height = 120, data = new Uint8Array(width * height).fill(133);
    const map = new GameMapImpl(width, height, data, data.length);
    const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
    const template = match.squads.find(s => s.playerId === 1)!;
    const P = 500;
    // One human admission in ten, as in the reviewer's spread benchmark.
    const squads = retainSquads(match, Array.from({ length: P }, (_, i) => ({
      ...template, id: match.allocateId(), playerId: i % 10 === 0 ? 1 : 2,
      x: Math.round((4.5 + (i % 25) * 2) * FIXED), y: Math.round((4.5 + Math.floor(i / 25) * 2) * FIXED),
      order: { type: "hold" as const }, path: [], queuedOrders: [],
    })));
    const admission = new MovementAdmission(map, match.paths, {
      squads: () => match.squads, priority: playerId => playerId === 1, squad: id => match.squad(id),
      generation: () => 0, revision: () => "0", blocked: () => undefined,
      // Every search is accepted and never completes: admissions wait on the planner.
      request: () => true,
      cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true, commit: () => {},
    });
    for (const squad of squads) admission.start(squad.playerId, [squad], map.ref(100 + (squad.id % 50), 10 + (squad.id % 100)), 0);
    expect(admission.pendingCount).toBe(P);
    // Finish formation planning and issue every leader's request.
    for (let tick = 0; tick < 400; tick++) admission.step(tick, 4096);
    const phases = admission.checkpoint().pending.map(([, a]) => a.phase);
    expect(phases.every(p => p === "routes")).toBe(true);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      admission.stepInteractive(400 + i, 320);
      samples.push(performance.now() - t0);
    }
    console.log(`B1 stepInteractive P=${P}: median ${median(samples).toFixed(3)} ms, max ${Math.max(...samples).toFixed(3)} ms`);
    expect(median(samples)).toBeLessThan(1);
  });

  it("B2: a mixed army/non-army move on Med 500 returns within 20 ms", async () => {
    const game = await liveMatch("heightmap-test1"), player = game.player(1)!;
    game.expansion!.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
    const tiles = game.ownedLandNearest(1, player.base, 400).filter(t => game.map.isLand(t));
    // Private recruitment spawn path, reached deliberately for the fixture.
    const spawn = (game as unknown as { spawnSquad(p: unknown, kind: string, tile: number, definition?: string, staged?: boolean): unknown }).spawnSquad.bind(game);
    const template = game.squads.find(s => s.playerId === 1 && s.definitionId)!;
    for (let i = 0; game.squads.filter(s => s.playerId === 1).length < 12 && i < tiles.length; i += 3)
      spawn(player, template.kind, tiles[i], template.definitionId, false);
    const own = game.squads.filter(s => s.playerId === 1 && s.embarkedOn === null).slice(0, 12).map(s => s.id);
    expect(own.length).toBe(12);
    expect(game.applyCommand({ type: "create-army", playerId: 1, squadIds: own.slice(0, 6) })).toBeNull();
    // Far land on the other side of the map.
    const home = player.base;
    let goal = -1;
    for (let x = game.map.width() - 10; x > 0 && goal < 0; x -= 7)
      for (let y = 10; y < game.map.height() - 10 && goal < 0; y += 7) {
        const tile = game.map.ref(x, y);
        if (game.map.isLand(tile) && game.paths.connected(home, tile)) goal = tile;
      }
    expect(goal).toBeGreaterThanOrEqual(0);
    const t0 = performance.now();
    const reason = game.applyCommand({ type: "order", playerId: 1, squadIds: own, order: { type: "move", tile: goal } });
    const ms = performance.now() - t0;
    console.log(`B2 mixed move applyCommand: ${ms.toFixed(2)} ms (${reason ?? "accepted"}), tree bytes ${game.paths.residency.hierarchy.treeBytes}`);
    expect(ms).toBeLessThanOrEqual(20);
  }, 120_000);

  it("B3: the Mig 1000 water corridor gate opens within about 3 minutes of simulated time", async () => {
    const t0 = performance.now(), game = await liveMatch("migration", 1272661902, 1000);
    const gates = (game as unknown as { corridorTicks: { land: number; water: number } }).corridorTicks;
    const minutes = (ticks: number) => ticks / TICKS_PER_SECOND / 60;
    console.log(`B3 Mig 1000: land gate ${gates.land} ticks (${minutes(gates.land).toFixed(2)} min), water gate ${gates.water} ticks ` +
      `(${minutes(gates.water).toFixed(2)} min), portals land ${game.paths.hierarchyPortals} water ${game.waterPaths.hierarchyPortals}, ` +
      `setup ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    // About 10.7 min at 4 trees a tick; about 2.9 min at PATH_WARM_TREES = 15.
    expect(minutes(gates.water)).toBeLessThan(3.5);
  }, 600_000);
});
