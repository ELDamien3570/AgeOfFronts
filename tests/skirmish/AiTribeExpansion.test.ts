import { describe, expect, it, vi } from 'vitest';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { Skirmish } from '../../src/skirmish/Simulation';
import { FIXED, secondsToTicks, TICKS_PER_SECOND } from '../../src/skirmish/Protocol';
import { TRIBE_NATION_CAMPAIGN_MIN_AGE, TRIBE_NATION_CAMPAIGN_TICKS, tribeMayCampaignAgainstNation } from '../../src/skirmish/FactionRules';
import { UNIT } from '../../src/skirmish/content/Units';
import { personalityOf } from '../../src/skirmish/content/AiPersonalities';
import { createManpower } from '../../src/skirmish/domain/Manpower';
import { createFormation } from '../../src/skirmish/domain/FormationGeometry';
import { economicSnapshot } from '../../src/skirmish/domain/AiEconomicSnapshot';
import { militaryDemand } from '../../src/skirmish/domain/AiMilitaryDemand';
import { economicCandidates } from '../../src/skirmish/domain/AiEconomicPlanner';
import type { AiOperation } from '../../src/skirmish/domain/AiOperations';
import { researchRejection, researchTerms } from '../../src/skirmish/domain/Progression';
import { TECHNOLOGIES } from '../../src/skirmish/content/Technology';

function fixture(own = 3, enemy = 8, raids = false) {
  const terrain = new Uint8Array(96 * 64).fill(133);
  const map = new GameMapImpl(96, 64, terrain, terrain.length);
  const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false,
    ruleset: 'ages-v1', aiWarPolicy: true, aiEconomy: true, deferredPlanning: true,
    ...(raids ? { diplomacyRules: 'raids-v1' as const } : {}) });
  const tribe = game.players[0], nation = game.players[1], expansion = game.expansion!, ops = expansion.operations;
  tribe.kind = 'tribe'; tribe.base = map.ref(60, 32); tribe.land = 200;
  nation.base = map.ref(24, 32); nation.personalityId = 'balanced'; nation.land = 1000; nation.reserves = 2000;
  const template = structuredClone(game.squads[0]), unit = UNIT.get('stoneage-infantry')!;
  expansion.progression.states[nation.id].completed.push(unit.technologyId);
  game.addBuilding({ id: game.allocateId(), playerId: nation.id, type: 'barracks', tile: nation.base, age: 'StoneAge', remainingTicks: 0, health: 1200 });
  for (const s of [...game.squads]) game.removeSquad(s.id);
  function add(owner: number, count: number) {
    const player = game.players.find(p => p.id === owner)!;
    for (let i = 0; i < count; i++) game.addSquad({ ...structuredClone(template), id: game.allocateId(),
      playerId: owner, definitionId: unit.id, kind: unit.line, troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit), formation: createFormation(unit.id), order: { type: 'hold' },
      x: (map.x(player.base) + i % 4) * FIXED, y: (map.y(player.base) + Math.floor(i / 4)) * FIXED,
      charge: null, refit: null, embarkedOn: null, path: [], queuedOrders: [],
    });
  }
  add(nation.id, own); add(tribe.id, enemy);
  const frontier = vi.spyOn(game, 'hasUnclaimedFrontier').mockReturnValue(false);
  const route = vi.spyOn(expansion.economy.routes, 'request').mockReturnValue({ pending: false, path: [nation.base, tribe.base] });
  function think(seconds: number) {
    game.tick = secondsToTicks(seconds);
    ops.step(new Map(game.players.map(p => [p.id, game.squadFacts().aliveByOwner(p.id).length])));
  }
  function restoreWar() {
    const r: AiOperation = { phase: 'war', target: tribe.id, since: 0, nextThink: 0, threats: [], cursor: 0, score: 0,
      tribe: { desiredSquads: 20, bestReady: own, progressAt: 0, route: 'ready' } };
    ops.restore({ records: [[nation.id, r]], revision: 1, territorialRevision: 0 });
  }
  think(0); // Initialize the faction-staggered strategic wakeup.
  return { game, map, nation, tribe, expansion, ops, frontier, route, add, think, restoreWar };
}

/** Moves player 2 (the acting tribe) past the tribe-on-nation campaign gate;
 * returns the seconds offset at which the gate is open. */
function openNationCampaigns(f: ReturnType<typeof fixture>): number {
  f.expansion.progression.states[2].age = TRIBE_NATION_CAMPAIGN_MIN_AGE;
  return TRIBE_NATION_CAMPAIGN_TICKS / TICKS_PER_SECOND;
}

describe('tribal expansion preparation and commitment', () => {
  it('lets a tribe expand peacefully before pursuing a promotion campaign', () => {
    const f = fixture(6, 2, true); f.nation.kind = 'tribe'; f.frontier.mockReturnValue(true);
    f.think(30); f.nation.land += 30; f.think(50); f.nation.land += 30; f.think(70);
    expect(f.ops.state(2)!.phase).toBe('peace');
    expect(f.ops.promotionPressure(2)).toBe(false);
    f.think(100); f.think(104); f.think(116);
    expect(f.ops.state(2)).toMatchObject({ phase: 'war', target: 1 });
    expect(f.ops.invasionReserve(2, 6)).toBe(1);
  });
  it.each(['tribe', 'regular'] as const)('lets a boxed-in tribe invade a vulnerable nearby %s', kind => {
    const f = fixture(6, 2, true); f.nation.kind = 'tribe'; f.tribe.kind = kind;
    // A campaign against a nation waits for minute 8 and Bronze Age (OD-9).
    const t0 = kind === 'regular' ? openNationCampaigns(f) : 0;
    f.think(t0 + 30); f.think(t0 + 34); f.think(t0 + 50);
    expect(f.ops.state(2)).toMatchObject({ phase: 'war', target: 1 });
    expect(f.expansion.diplomacy.declaredWar(2, 1)).toBe(true);
    expect(f.ops.canEnter(2, 1, f.tribe.base)).toBe(true);
    expect(f.game.squadFacts().aliveByOwner(2)).toHaveLength(6);
  });
  it('does not send a tribe into a nation it cannot fight even at its population cap', () => {
    const f = fixture(4, 50, true); f.nation.kind = 'tribe'; f.tribe.kind = 'regular';
    f.think(30); f.think(34); f.think(60);
    expect(f.ops.state(2)!.phase).toBe('peace');
  });
  it('allows a nation to prepare against a vulnerable tribe while peaceful expansion remains useful', () => {
    const f = fixture(8, 2, true); f.frontier.mockReturnValue(true);
    f.think(60); f.think(64); f.think(80);
    expect(f.ops.state(2)).toMatchObject({ phase: 'war', target: 1 });
  });
  it('keeps a Stone Age tribe from campaigning against a nation before minute 8 (OD-9)', () => {
    const f = fixture(6, 2, true); f.nation.kind = 'tribe'; f.tribe.kind = 'regular';
    f.think(30); f.think(34); f.think(50); f.think(120);
    expect(f.ops.state(2)!.phase).toBe('peace');
    // Minute 8 alone is not enough while the tribe is still in the Stone Age.
    const t0 = TRIBE_NATION_CAMPAIGN_TICKS / TICKS_PER_SECOND;
    f.think(t0 + 30); f.think(t0 + 34); f.think(t0 + 50);
    expect(f.ops.state(2)!.phase).toBe('peace');
    expect(tribeMayCampaignAgainstNation(TRIBE_NATION_CAMPAIGN_TICKS - 1, 'BronzeAge')).toBe(false);
    expect(tribeMayCampaignAgainstNation(TRIBE_NATION_CAMPAIGN_TICKS, 'StoneAge')).toBe(false);
    expect(tribeMayCampaignAgainstNation(TRIBE_NATION_CAMPAIGN_TICKS, 'BronzeAge')).toBe(true);
  });
  it('does not cancel a tribal campaign pursuit just because the target is beyond the home patrol radius', () => {
    const f = fixture(6, 2, true); f.nation.kind = 'tribe'; f.tribe.kind = 'regular';
    const t0 = openNationCampaigns(f);
    f.think(t0 + 30); f.think(t0 + 34); f.think(t0 + 50);
    const source = f.game.squadFacts().aliveByOwner(2)[0], enemy = f.game.squadFacts().aliveByOwner(1)[0];
    f.game.updateSquad(source.id, { order: { type: 'attack', targetId: enemy.id } });
    for (let i = 0; i < 16; i++) {
      f.game.tick++;
      (f.game as unknown as { thinkAi(): void }).thinkAi();
    }
    expect(f.game.squad(source.id)!.order).toEqual({ type: 'attack', targetId: enemy.id });
  });
  it('protects gold for a producible recruit while a boxed-in tribe is building its force', () => {
    const f = fixture(3, 5, true); f.nation.kind = 'tribe';
    f.think(30); f.think(34);
    const state = f.expansion.progression.states[2];
    const technology = TECHNOLOGIES.filter(t => !researchRejection(state, Number.MAX_SAFE_INTEGER, t.id, 1))
      .sort((a, b) => a.gold - b.gold)[0];
    expect(technology).toBeDefined();
    const recruitGold = UNIT.get('stoneage-infantry')!.cost.gold!;
    f.nation.gold = researchTerms(technology, 1).gold + recruitGold - 1;
    (f.expansion as unknown as { thinkTribeDevelopment(p: typeof f.nation): void }).thinkTribeDevelopment(f.nation);
    expect(f.nation.gold).toBeGreaterThanOrEqual(recruitGold);
  });
  it('prioritizes eligible military research once a tribe runs out of useful expansion', () => {
    const f = fixture(6, 2, true); f.nation.kind = 'tribe'; f.think(30);
    const state = f.expansion.progression.states[2];
    f.nation.gold = 100000;
    const eligible = TECHNOLOGIES.filter(t => !t.optional && t.tree === 'warfare' && !researchRejection(state, f.nation.gold, t.id, 1));
    expect(eligible.length).toBeGreaterThan(0);
    const commands = vi.spyOn(f.game, 'applyCommand');
    (f.expansion as unknown as { thinkTribeDevelopment(p: typeof f.nation): void }).thinkTribeDevelopment(f.nation);
    const command = commands.mock.calls.map(c => c[0]).find(c => c.type === 'research');
    expect(command).toBeDefined();
    expect(eligible.some(t => t.id === (command as { technologyId: string }).technologyId)).toBe(true);
  });
  it('keeps a full tribal roster under the shared strategic candidate budget', () => {
    const terrain = new Uint8Array(240 * 160).fill(133);
    const game = new Skirmish(new GameMapImpl(240, 160, terrain, terrain.length), {
      seed: 47, aiCount: 5, tribes: true, tribeCount: 30, runAi: false, ruleset: 'ages-v1',
      aiWarPolicy: true, deferredPlanning: true,
    });
    const forces = new Map(game.players.map(p => [p.id, game.squadFacts().aliveByOwner(p.id).length]));
    for (let seconds = 0; seconds < 110; seconds++) {
      game.tick = secondsToTicks(seconds); game.expansion!.operations.step(forces);
      expect(game.expansion!.operations.workUsed).toBeLessThanOrEqual(16);
    }
    expect(game.players.filter(p => p.kind === 'tribe' && game.expansion!.operations.state(p.id))).toHaveLength(30);
  });
  it('plans against a stronger tribe before it can invade and requests a paid force', () => {
    const f = fixture(); f.think(60); f.think(64);
    expect(f.ops.state(f.nation.id)).toMatchObject({ phase: 'preparing', target: f.tribe.id, tribe: { route: 'ready' } });
    expect(f.ops.recruitmentObjective(f.nation.id)!.squads).toBeGreaterThan(8);
    expect(f.ops.canTarget(f.nation.id, f.tribe.id)).toBe(false);
    expect(f.game.squadFacts().aliveByOwner(f.nation.id)).toHaveLength(3);
    f.add(f.nation.id, 13); f.think(80);
    expect(f.ops.state(f.nation.id)).toMatchObject({ phase: 'war', target: f.tribe.id });
    expect(f.ops.invasionReserve(f.nation.id, 16)).toBe(4);
  });
  it('does not let a leftover neutral frontier veto invasion preparation indefinitely', () => {
    const f = fixture(); f.frontier.mockReturnValue(true);
    f.think(60); expect(f.ops.state(f.nation.id)!.phase).toBe('peace');
    f.think(90); expect(f.ops.state(f.nation.id)!.phase).toBe('preparing');
    expect(f.ops.state(f.nation.id)!.target).toBe(f.tribe.id);
  });
  it('keeps useful ongoing peaceful expansion ahead of a costly tribal invasion', () => {
    const f = fixture(); f.frontier.mockReturnValue(true);
    f.think(60);
    for (const t of [75, 90, 105]) { f.nation.land += 50; f.think(t); }
    expect(f.ops.state(f.nation.id)!.phase).toBe('peace');
    f.think(135); expect(f.ops.state(f.nation.id)!.phase).toBe('preparing');
  });
  it('keeps pending routes distinct from unreachable targets and backs off failed routes', () => {
    const f = fixture(); f.route.mockReturnValue({ pending: true });
    f.think(60); f.think(64);
    expect(f.ops.state(f.nation.id)!.reason).toBe('Certifying invasion route');
    expect(f.ops.recruitmentObjective(f.nation.id)).toBeUndefined();
    f.route.mockReturnValue({ pending: false, reason: 'Exact route unreachable' }); f.think(68);
    expect(f.ops.state(f.nation.id)).toMatchObject({ phase: 'recovery', reason: 'Exact route unreachable' });
    expect(f.ops.recruitmentObjective(f.nation.id)).toBeUndefined();
    f.think(100); f.think(104);
    expect(f.ops.state(f.nation.id)!.phase).toBe('peace');
  });
  it('respects alliances rather than turning tribal expansion into an attack exemption', () => {
    const f = fixture();
    f.expansion.diplomacy.state.alliances.push({ id: 1, a: f.nation.id, b: f.tribe.id, expiresTick: secondsToTicks(1000), renewal: [] });
    f.think(60); f.think(100);
    expect(f.ops.state(f.nation.id)!.phase).toBe('peace');
  });
  it('certifies the real deferred route without a synchronous pathfinding fallback', () => {
    const f = fixture(); f.route.mockRestore();
    const find = vi.spyOn(f.game.paths, 'find');
    f.think(60); f.think(64);
    for (let i = 0; i < 200 && !f.ops.recruitmentObjective(f.nation.id); i++) {
      f.game.routePlanner.step(++f.game.tick);
      f.ops.step(new Map([[f.nation.id, 3], [f.tribe.id, 8]]));
    }
    expect(f.ops.state(f.nation.id)!.tribe?.route, JSON.stringify(f.ops.state(f.nation.id))).toBe('ready');
    expect(find).not.toHaveBeenCalled();
  });
  it('establishes an ordinary invasion war in the current diplomacy rules, and respects peace protection', () => {
    const f = fixture(16, 8, true);
    f.think(60); f.think(64); f.think(80);
    expect(f.ops.state(f.nation.id)!.phase).toBe('war');
    expect(f.expansion.diplomacy.declaredWar(f.nation.id, f.tribe.id)).toBe(true);
    expect(f.expansion.diplomacy.state.wars).toMatchObject([{ initiator: f.nation.id, cause: 'invasion' }]);
    const protectedTribe = fixture(16, 8, true);
    protectedTribe.expansion.diplomacy.state.peaceProtection!.push({ a: 1, b: 2, untilTick: secondsToTicks(200) });
    protectedTribe.think(60); protectedTribe.think(100);
    expect(protectedTribe.ops.state(2)!.phase).toBe('peace');
    expect(protectedTribe.expansion.diplomacy.declaredWar(1, 2)).toBe(false);
  });
  it('abandons a preparation that cannot build its force, but allows improving preparations beyond 60 seconds', () => {
    const f = fixture(); f.think(60); f.think(64);
    f.add(f.nation.id, 1); f.think(125);
    expect(f.ops.state(f.nation.id)!.phase).toBe('preparing');
    f.think(216); expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
  });
  it('sustains campaigns beyond two minutes on net progress, then withdraws when progress stops', () => {
    const f = fixture(16, 8); f.restoreWar(); f.think(1);
    f.tribe.land -= 10; f.think(80);
    f.tribe.land -= 10; f.think(150);
    expect(f.ops.state(f.nation.id)!.phase).toBe('war');
    expect(f.ops.sustaining(f.nation.id, f.tribe.id)).toBe(true);
    // Keep more defenders than the ordinary finishing-conquest threshold.
    f.think(241); expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
  });
  it('does not treat repeated loss/recapture oscillation as net campaign progress', () => {
    const f = fixture(16, 12); f.restoreWar(); f.think(1);
    f.tribe.land -= 10; f.think(40);
    f.tribe.land += 10; f.think(80);
    f.tribe.land -= 10; f.think(120);
    f.think(131); expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
  });
  it('persists a preparation and its progress through checkpoint continuation', () => {
    const f = fixture(); f.think(60); f.think(64);
    const saved = f.ops.checkpoint(); f.think(125); const expected = f.ops.checkpoint();
    f.ops.restore(saved); f.think(125);
    expect(f.ops.checkpoint()).toEqual(expected);
  });
  it('restores active campaign progress in the complete game checkpoint', () => {
    const f = fixture(16, 12); f.restoreWar(); f.think(1);
    f.tribe.land -= 10; f.think(60);
    const checkpoint = f.game.checkpoint(), expected = f.ops.checkpoint();
    f.think(151); expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
    f.game.restore(checkpoint);
    expect(f.ops.checkpoint()).toEqual(expected);
    f.think(151); expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
  });
  it('continues when a city is being damaged, but does not renew progress for healing and repeated chip damage', () => {
    const f = fixture(16, 12);
    const city = f.game.addBuilding({ id: f.game.allocateId(), playerId: f.tribe.id, type: 'city', tile: f.tribe.base, health: 1200, remainingTicks: 0 });
    f.restoreWar(); f.think(1);
    f.game.updateBuilding(city.id, { health: 1000 }); f.think(80);
    f.game.updateBuilding(city.id, { health: 900 }); f.think(150);
    expect(f.ops.state(f.nation.id)!.phase).toBe('war');
    f.game.updateBuilding(city.id, { health: 1200 }); f.think(200);
    f.game.updateBuilding(city.id, { health: 1000 }); f.think(241);
    expect(f.ops.state(f.nation.id)!.phase).toBe('recovery');
  });
  it('feeds invasion force requirements into ordinary recruitment and equipment demand', () => {
    const f = fixture(); f.think(60); f.think(64);
    const snapshot = economicSnapshot({ player: f.nation, tick: f.game.tick, generation: 0, age: 'StoneAge',
      research: f.expansion.progression.states[f.nation.id].completed, inventory: {},
      buildings: f.game.buildingFacts().byOwner(f.nation.id), squads: f.game.squads,
      ships: [], jobs: [], production: {}, cap: 60, threatTroops: 0 });
    snapshot.invasion = f.ops.recruitmentObjective(f.nation.id);
    const demand = militaryDemand(snapshot, personalityOf(f.nation), new Set());
    expect(Object.values(demand.units).reduce((sum, n) => sum + n!, 0)).toBeGreaterThanOrEqual(snapshot.invasion!.squads);
    const candidates = economicCandidates(snapshot, f.expansion.progression.states[f.nation.id], personalityOf(f.nation), demand, 1, []);
    expect(candidates.some(c => c.kind === 'recruit' && c.priority === 'committed' && c.reason.startsWith('invasion-force:'))).toBe(true);
  });
});
