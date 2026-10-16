import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { ORPHAN_ARMY_GRACE_TICKS } from "../../src/skirmish/domain/AiArmyPlanner";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

/** M3: a human's armies are orphaned when the AI takes the seat over, because
 * the AI never selects army members. They are disbanded after a grace period;
 * a reconnect within it keeps them. */
function handoverMatch() {
  const terrain = new Uint8Array(128 * 96).fill(133), map = new GameMapImpl(128, 96, terrain, terrain.length);
  const options = { ...DEFAULT_AI_POLICIES, seed: 47, humanNames: ["H"], aiCount: 1, tribes: false, runAi: true, ruleset: "ages-v1" } as ConstructorParameters<typeof Skirmish>[1];
  const game = new Skirmish(map, options);
  game.expansion!.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
  const template = game.squads.find((s) => s.playerId === 1)!;
  const ids = [template.id];
  for (let i = 1; i < 3; i++)
    ids.push(game.addSquad({ ...structuredClone(template), id: game.allocateId(), x: template.x + i * 3 * FIXED, path: [], order: { type: "hold" }, queuedOrders: [] }).id);
  expect(game.applyCommand({ type: "create-army", playerId: 1, squadIds: ids })).toBeNull();
  const army = game.expansion!.armies.armies.find((a) => a.playerId === 1)!;
  expect(army).toBeDefined();
  return { game, ids, army, map, options };
}
const step = (game: Skirmish, n: number) => { for (let i = 0; i < n; i++) game.step(); };
describe("orphaned armies after a handover (M3)", () => {
  it("disbands a human's army after the grace period once the AI controls the seat", () => {
    const { game, ids, army } = handoverMatch();
    game.setAiController(1, true);
    step(game, ORPHAN_ARMY_GRACE_TICKS - 2);
    expect(game.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(true);
    step(game, 4);
    expect(game.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(false);
    for (const id of ids) if (game.squad(id)) expect(game.expansion!.armies.armyOf(id)).toBeUndefined();
  });
  it("keeps the army when the human reconnects within the grace period", () => {
    const { game, army } = handoverMatch();
    game.setAiController(1, true);
    step(game, ORPHAN_ARMY_GRACE_TICKS / 2);
    game.setAiController(1, false);
    step(game, ORPHAN_ARMY_GRACE_TICKS * 2);
    expect(game.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(true);
  });
  it("carries the grace through a checkpoint", () => {
    const { game, army, map, options } = handoverMatch();
    game.setAiController(1, true);
    step(game, 5);
    const saved = game.checkpoint();
    const fresh = new Skirmish(new GameMapImpl(map.width(), map.height(), new Uint8Array(map.width() * map.height()).fill(133), map.width() * map.height()), options);
    fresh.restore(saved);
    expect(fresh.checkpoint()).toEqual(saved);
    step(fresh, ORPHAN_ARMY_GRACE_TICKS);
    expect(fresh.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(false);
  });
  it("keeps an orphaned army in melee until the fight ends, then disbands it", () => {
    const { game, ids, army } = handoverMatch();
    const member = game.squad(ids[0])!, enemyTemplate = game.squads.find((s) => s.playerId === 2)!;
    // A sturdy enemy keeps the melee going past the grace period.
    const enemy = game.addSquad({ ...structuredClone(enemyTemplate), id: game.allocateId(), x: member.x + FIXED, y: member.y, path: [], order: { type: "hold" }, queuedOrders: [],
      troops: enemyTemplate.troops * 20 });
    game.setAiController(1, true);
    let fought = false;
    for (let i = 0; i < ORPHAN_ARMY_GRACE_TICKS + 4; i++) { game.step(); fought ||= ids.some((id) => game.squad(id)?.fighting); }
    expect(fought).toBe(true);
    // Past the grace period: an army whose members are fighting is not disbanded mid-melee.
    expect(ids.some((id) => game.squad(id)?.fighting)).toBe(true);
    expect(game.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(true);
    game.removeSquad(enemy.id);
    for (let i = 0; i < 40 && game.expansion!.armies.armies.some((a) => a.id === army.id); i++) game.step();
    expect(game.expansion!.armies.armies.some((a) => a.id === army.id)).toBe(false);
  });
});
