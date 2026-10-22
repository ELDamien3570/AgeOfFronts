import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { CommandOutcome } from "../../src/skirmish/CommandApplications";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

// R2-H1: a >10-squad human order is split into a one-squad corridor lead and
// follower cohorts sharing its corridor. The lead dying while its route is
// still pending must not throw from Skirmish.step.
interface AdmissionView { id: number; corridorId?: number; phase: string; members: { id: number }[] }
const W = 160, H = 100;
function setup() {
  const terrain = new Uint8Array(W * H).fill(133);
  const game = new Skirmish(new GameMapImpl(W, H, terrain, terrain.length), {
    ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
    seed: 7, humanNames: ["H"], aiCount: 1, tribes: false, ruleset: "ages-v1", startingAge: "Napoleonic", runAi: false,
  } as ConstructorParameters<typeof Skirmish>[1]);
  const template = game.squads.find(s => s.playerId === 1 && s.kind === "infantry") ?? game.squads.find(s => s.playerId === 1)!;
  for (const s of [...game.squads]) if (s.playerId === 1) game.removeSquad(s.id);
  const ids: number[] = [];
  for (let i = 0; i < 12; i++) {
    const id = game.allocateId();
    ids.push(id);
    game.addSquad({ ...structuredClone(template), id, x: (12 + (i % 4) * 3) * 256 + 128,
      y: (40 + Math.floor(i / 4) * 3) * 256 + 128, queuedOrders: [], path: [], order: { type: "hold" } });
  }
  const command: Command = { type: "order", playerId: 1, squadIds: ids, order: { type: "move", tile: game.map.ref(140, 50) } };
  return { game, ids, command };
}
const pending = (game: Skirmish) =>
  [...(game.movementAdmission as unknown as { pending: Map<number, AdmissionView> }).pending.values()];
const lead = (game: Skirmish) => pending(game).find(a => a.corridorId === a.id && a.members.length === 1);
/** A congested planner: requests are accepted but never complete. */
function congest(game: Skirmish): () => void {
  const planner = game.routePlanner as unknown as { request: (...args: unknown[]) => boolean },
    original = planner.request;
  planner.request = () => true;
  return () => { planner.request = original; };
}

describe("corridor lead death during pending admission (R2-H1)", () => {
  it("keeps stepping after the corridor lead squad is removed while its route is pending", () => {
    const { game, command } = setup();
    congest(game);
    expect(game.commandApplications.apply("move-1", command).status).toBe("deferred");
    for (let i = 0; i < 6; i++) game.step();
    const corridorLead = lead(game);
    expect(corridorLead).toBeDefined();
    expect(pending(game).some(a => a !== corridorLead && a.corridorId === corridorLead!.id)).toBe(true);
    const removed = corridorLead!.members[0].id;
    game.removeSquad(removed);
    expect(() => { for (let i = 0; i < 10; i++) game.step(); }).not.toThrow();
    expect(game.movementAdmission.hasPending(removed)).toBe(false);
    expect(pending(game).some(a => a.members.some(m => m.id === removed))).toBe(false);
  });
  it("lets the followers of a dead lead reach a terminal receipt with the real planner", () => {
    const { game, command } = setup();
    const outcomes: CommandOutcome[] = [];
    game.commandApplications.onOutcome = outcome => outcomes.push(outcome);
    expect(game.commandApplications.apply("move-1", command).status).toBe("deferred");
    const corridorLead = lead(game);
    expect(corridorLead).toBeDefined();
    game.removeSquad(corridorLead!.members[0].id);
    expect(() => {
      for (let i = 0; i < 400 && game.commandApplications.diagnostics.pending; i++) game.step();
    }).not.toThrow();
    expect(game.commandApplications.diagnostics.pending).toBe(0);
    expect(["executed", "superseded"]).toContain(outcomes[outcomes.length - 1].status);
  });
  it("retains sibling intentions when a pending member dies", () => {
    const { game, command } = setup();
    congest(game);
    expect(game.commandApplications.apply("move-1", command).status).toBe("deferred");
    for (let i = 0; i < 6; i++) game.step();
    const members = pending(game).filter(a => a.members.length === 1);
    expect(members.length).toBeGreaterThan(1);
    const victim = members[0].members[0].id;
    const siblings = members.slice(1).map(a => a.members[0].id);
    game.removeSquad(victim);
    expect(game.movementAdmission.hasPending(victim)).toBe(false);
    for (const id of siblings) expect(game.movementAdmission.hasPending(id)).toBe(true);
    expect(() => { for (let i = 0; i < 6; i++) game.step(); }).not.toThrow();
  });
  it("does not dereference a vanished corridor lead even when nothing cancelled its admission", () => {
    const { game, command } = setup();
    congest(game);
    expect(game.commandApplications.apply("move-1", command).status).toBe("deferred");
    for (let i = 0; i < 6; i++) game.step();
    const removed = lead(game)!.members[0].id;
    // Bypass Skirmish.removeSquad's admission cancellation: the guard alone
    // must keep followers safe.
    (game as unknown as { squadEntities: { remove(id: number): boolean } }).squadEntities.remove(removed);
    expect(game.movementAdmission.hasPending(removed)).toBe(true);
    expect(() => { for (let i = 0; i < 10; i++) game.step(); }).not.toThrow();
    expect(game.movementAdmission.hasPending(removed)).toBe(false);
  });
});
