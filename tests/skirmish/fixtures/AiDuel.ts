// AI battle-competence duel harness (ported from the round-2 tactics review).
// Two sides of a fixed composition meet on open ground. Each side is driven
// by a policy: the real AI army planner ("ai"), an attack-nearest human
// ("naive"), or nothing ("idle"). Statistics are collected for assertions.
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { FIXED, TICKS_PER_SECOND, type Building, type Squad } from "../../../src/skirmish/Protocol";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";
import { UNIT } from "../../../src/skirmish/content/Units";
import { createFormation, TURN } from "../../../src/skirmish/domain/FormationGeometry";
import { createManpower, remainingHealth } from "../../../src/skirmish/domain/Manpower";
import { formationContact } from "../../../src/skirmish/domain/FormationContact";

export type DuelPolicy = "ai" | "naive" | "idle";
export interface DuelComp { front: string; ranged: string; cav: string; nf: number; nr: number; nc: number }
export const DUEL_COMPS: Record<string, DuelComp> = {
  BronzeAge: { front: "bronzeage-infantry", ranged: "bronzeage-archer", cav: "bronzeage-cavalry", nf: 4, nr: 3, nc: 2 },
  EarlyMedieval: { front: "earlymedieval-infantry", ranged: "earlymedieval-archer", cav: "earlymedieval-heavycavalry", nf: 4, nr: 3, nc: 2 },
  LateMedieval: { front: "latemedieval-infantry", ranged: "latemedieval-archer", cav: "latemedieval-heavycavalry", nf: 4, nr: 3, nc: 2 },
};
export interface DuelOptions {
  age: string; a: DuelPolicy; b: DuelPolicy; seconds?: number; seed?: number; jitter?: number;
  comp?: DuelComp; aPos?: [number, number]; bPos?: [number, number]; holdB?: boolean;
}
export type Duel = ReturnType<typeof buildDuel>;

export function buildDuel(o: DuelOptions) {
  const W = 128, H = 96, land = new Uint8Array(W * H).fill(133);
  const map = new GameMapImpl(W, H, land, land.length);
  const game = new Skirmish(map, { seed: o.seed ?? 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true, aiEconomy: true, startingAge: o.age } as any);
  const e = game.expansion!;
  const template = structuredClone(game.squads[0]);
  for (const s of [...game.squads]) game.removeSquad(s.id);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  for (const p of game.players) { e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id); e.progression.states[p.id].age = o.age as any; p.reserves = 0; }
  const [p1, p2] = game.players;
  p1.ai = o.a === "ai"; p2.ai = o.b === "ai";
  const comp = o.comp ?? DUEL_COMPS[o.age];
  const j = o.jitter ?? 0, aPos: [number, number] = o.aPos ?? [44, 48 + j], bPos: [number, number] = o.bPos ?? [84, 48 - j];
  const add = (owner: number, id: string, x: number, y: number) => {
    const unit = UNIT.get(id)!;
    return game.addSquad({ ...template, id: game.allocateId(), playerId: owner, definitionId: id, kind: unit.line, troops: unit.formationRecipe!.capacity, manpower: createManpower(unit),
      formation: { ...createFormation(id), facing: owner === p1.id ? 0 : TURN / 2 }, x: Math.round(x * FIXED), y: Math.round(y * FIXED), order: { type: "hold" }, path: [], queuedOrders: [], charge: null, combatTargetId: null, xp: 0 } as Squad);
  };
  const side = (owner: number, [cx, cy]: [number, number], dir: number) => {
    const out: Squad[] = [];
    for (let i = 0; i < comp.nf; i++) out.push(add(owner, comp.front, cx, cy - (comp.nf - 1) * 2.5 + i * 5));
    for (let i = 0; i < comp.nr; i++) out.push(add(owner, comp.ranged, cx - dir * 5, cy - (comp.nr - 1) * 3 + i * 6));
    for (let i = 0; i < comp.nc; i++) out.push(add(owner, comp.cav, cx - dir * 3, cy + (i % 2 ? 1 : -1) * (comp.nf * 2.5 + 4)));
    return out;
  };
  const A = side(p1.id, aPos, 1), B = side(p2.id, bPos, -1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) game.owners[map.ref(x, y)] = x < W / 2 ? p1.id : p2.id;
  const planner = e.economy.military.armyPlanner;
  const base = { game, e, map };
  const planA = o.a === "ai" ? injectAiMission(base, p1, A, bPos, aPos, p2.id, "combat", "t", true) : undefined;
  const planB = o.b === "ai" ? injectAiMission(base, p2, B, aPos, bPos, p1.id, o.holdB ? "defense" : "combat", "t", !o.holdB) : undefined;
  return { game, e, map, A, B, p1, p2, planA, planB, planner, comp, aPos, bPos, options: o };
}

/** Creates an AI army from `own` and registers a planner mission for it, as the planner would after selection. */
export function injectAiMission(ctx: { game: Skirmish; e: any; map: any }, player: any, own: Squad[], enemyPos: [number, number], ownPos: [number, number], enemyId: number, purpose: "combat" | "defense", suffix: string, advance: boolean) {
  const { game, e, map } = ctx, planner = e.economy.military.armyPlanner;
  const err = game.applyCommand({ type: "create-army", playerId: player.id, squadIds: own.map((s) => s.id) }); if (err) throw Error(err);
  const army = e.armies.armyOf(own[0].id)!;
  game.applyCommand({ type: "army-auto", playerId: player.id, armyId: army.id, enabled: false });
  const plan: any = { id: "land-army:" + player.id + ":" + suffix, theatreId: "offense:" + enemyId + ":" + suffix, playerId: player.id, generation: game.aiGeneration(player.id), phase: "advance", created: 0, since: 0, deadline: 1e9, nextThink: 0, cursor: 0,
    rosterIds: own.map((s) => s.id), members: own.map((s) => s.id), armyId: army.id, target: enemyId, targetTile: map.ref(enemyPos[0], enemyPos[1]), home: map.ref(ownPos[0], ownPos[1]), purpose, kind: "combat",
    initialTroops: own.reduce((n, s) => n + s.troops, 0), reason: "test", desiredSquads: own.length };
  planner.missions.set(plan.id, plan); planner.byPlayer.set(player.id, [...(planner.byPlayer.get(player.id) ?? []), plan.id]);
  e.economy.assets.acquire(own.map((s) => ({ asset: `squad:${s.id}` as const, playerId: player.id, generation: plan.generation, controller: plan.id, priority: (purpose === "defense" ? "defense" : "operation") as any, createdTick: 0, expiresTick: 1e9 })));
  if (advance) { const r = game.applyCommand({ type: "army-order", playerId: player.id, armyId: army.id, order: { type: "move", tile: plan.targetTile } }); if (r) throw Error("move " + r); }
  return plan;
}

export const squadHp = (s: Squad | undefined) => (s && s.troops > 0 ? remainingHealth(s) / 1000 : 0);

export interface DuelResult {
  decided: number; winner: "A" | "B" | "A(lead)" | "B(lead)" | "draw"; remain: [number, number]; t: number;
  aiCharges: [number, number]; aiBonus: [number, number]; rangedMeleeTicks: [number, number]; firstContact: number;
  phases: [string, number, string][][];
}

export function runDuel(o: DuelOptions, ctxIn?: Duel, every?: (ctx: Duel) => void): DuelResult {
  const ctx = ctxIn ?? buildDuel(o), { game, e, A, B, p1, p2, planner } = ctx;
  const ids = [A.map((s) => s.id), B.map((s) => s.id)];
  const init = [A.reduce((n, s) => n + squadHp(s), 0), B.reduce((n, s) => n + squadHp(s), 0)];
  const stats = { aiCharges: [0, 0] as [number, number], aiBonus: [0, 0] as [number, number], rangedMeleeTicks: [0, 0] as [number, number], firstContact: -1, phases: [[], []] as [string, number, string][][] };
  const prevCharge = new Map<number, boolean>(), prevBonus = new Map<number, number>();
  const policies = [o.a, o.b], players = [p1, p2], plans = [ctx.planA, ctx.planB];
  const naive = (k: number) => {
    const me = players[k].id, mine = ids[k].map((id) => game.squad(id)).filter((s): s is Squad => !!s && s.troops > 0);
    const foes = ids[1 - k].map((id) => game.squad(id)).filter((s): s is Squad => !!s && s.troops > 0);
    if (!foes.length) return;
    const d2 = (a: Squad, b: Squad) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    for (const s of mine) if (s.order.type === "hold" && !s.charge) {
      const t = foes.slice().sort((a, b) => d2(s, a) - d2(s, b) || a.id - b.id)[0];
      game.applyCommand({ type: "order", playerId: me, squadIds: [s.id], order: { type: "attack", targetId: t.id } });
    }
  };
  const seconds = o.seconds ?? 150; let decided = -1, winner = -1;
  for (let t = 0; t < seconds * TICKS_PER_SECOND; t++) {
    for (let k = 0; k < 2; k++) {
      if (policies[k] === "ai") {
        const plan = plans[k];
        if (planner.missions.has(plan.id) && game.tick >= plan.nextThink) { (planner as any).diagnostics.work = 0; (planner as any).stepMission(players[k], plan, 8); }
        const ph = planner.missions.get(plan.id)?.phase ?? "gone", arr = stats.phases[k];
        if (arr[arr.length - 1]?.[0] !== ph) arr.push([ph, +(game.tick / TICKS_PER_SECOND).toFixed(1), plan.reason]);
      } else if (policies[k] === "naive" && game.tick % 4 === k) naive(k);
    }
    every?.(ctx);
    game.step();
    for (let k = 0; k < 2; k++) {
      const mine = ids[k].map((id) => game.squad(id)).filter((s): s is Squad => !!s && s.troops > 0), foes = ids[1 - k].map((id) => game.squad(id)).filter((s): s is Squad => !!s && s.troops > 0);
      for (const s of mine) {
        const c = !!s.charge; if (c && !prevCharge.get(s.id) && policies[k] === "ai") stats.aiCharges[k]++; prevCharge.set(s.id, c);
        const b = s.cavalryEngagement?.assault?.bonusStartTick ?? -1; if (b !== (prevBonus.get(s.id) ?? -1) && b >= 0 && policies[k] === "ai") stats.aiBonus[k]++; prevBonus.set(s.id, b);
        if (e.unit(s).role === "ranged" && foes.some((f) => e.unit(f).attack.channel === "melee" && f.fighting && formationContact(f, s, game.tick).gap < FIXED / 2)) stats.rangedMeleeTicks[k]++;
      }
    }
    if (stats.firstContact < 0 && [...A, ...B].some((s) => game.squad(s.id)?.fighting)) stats.firstContact = +(game.tick / TICKS_PER_SECOND).toFixed(1);
    const now = [ids[0].reduce((n, id) => n + squadHp(game.squad(id)), 0), ids[1].reduce((n, id) => n + squadHp(game.squad(id)), 0)];
    if (decided < 0 && init[1] > 0 && (now[0] < init[0] * 0.15 || now[1] < init[1] * 0.15)) { decided = +(game.tick / TICKS_PER_SECOND).toFixed(1); winner = now[0] > now[1] ? 0 : 1; break; }
  }
  const now = [ids[0].reduce((n, id) => n + squadHp(game.squad(id)), 0), ids[1].reduce((n, id) => n + squadHp(game.squad(id)), 0)];
  return { decided, winner: decided < 0 ? (now[0] > now[1] * 1.2 ? "A(lead)" : now[1] > now[0] * 1.2 ? "B(lead)" : "draw") : winner ? "B" : "A",
    remain: [+(now[0] / init[0]).toFixed(2), +(now[1] / init[1]).toFixed(2)], t: +(game.tick / TICKS_PER_SECOND).toFixed(1), ...stats };
}

/** Both seatings of policy x against y; counts from x's perspective. */
export function duelMatrix(age: string, x: DuelPolicy, y: DuelPolicy, seconds: number, reps: number) {
  let wins = 0, losses = 0, draws = 0, mineRanged = 0, foeRanged = 0, bonus = 0, charges = 0;
  const results: DuelResult[] = [];
  for (let r = 0; r < reps; r++) for (const mirror of [false, true]) {
    const res = runDuel({ age, a: mirror ? y : x, b: mirror ? x : y, seconds, seed: 40 + r, jitter: (r - 1) * 3 });
    results.push(res);
    const me = mirror ? 1 : 0, w = res.winner;
    const meWon = w === "A" || w === "A(lead)" ? me === 0 : w === "B" || w === "B(lead)" ? me === 1 : null;
    if (meWon === true) wins++; else if (meWon === false) losses++; else draws++;
    mineRanged += res.rangedMeleeTicks[me]; foeRanged += res.rangedMeleeTicks[1 - me]; bonus += res.aiBonus[me]; charges += res.aiCharges[me];
  }
  return { wins, losses, draws, mineRanged, foeRanged, bonus, charges, results };
}

/** Ring-walled city held by p2 with no defenders; p1's AI army has siege. */
export function walledCityDuel(seconds = 90) {
  const comp: DuelComp = { front: "bronzeage-infantry", ranged: "bronzeage-archer", cav: "bronzeage-siege", nf: 4, nr: 2, nc: 2 };
  const o: DuelOptions = { age: "BronzeAge", a: "ai", b: "idle", seconds, comp, aPos: [44, 48], bPos: [100, 48] };
  const ctx = buildDuel(o), { game, e, p2, map } = ctx;
  for (const s of ctx.B) game.removeSquad(s.id);
  (ctx as any).B = [];
  const add = (type: Building["type"], x: number, y: number): Building => game.addBuilding({ id: game.allocateId(), playerId: p2.id, type, tile: map.ref(x, y), remainingTicks: 0, age: "BronzeAge", health: 1200, maxHealth: 1200 } as Building);
  const city = add("city", 90, 48);
  const forts = e.fortifications, towers: Building[] = [], ring: [number, number][] = [];
  for (let x = 82; x <= 98; x += 4) ring.push([x, 40]);
  for (let y = 44; y <= 56; y += 4) ring.push([98, y]);
  for (let x = 94; x >= 82; x -= 4) ring.push([x, 56]);
  for (let y = 52; y >= 44; y -= 4) ring.push([82, y]);
  for (const [x, y] of ring) { const t = add("tower", x, y); const plan = forts.towerPlan(t.tile, p2.id, "BronzeAge", [...towers, t]); forts.addTower(t, plan); towers.push(t); }
  for (const w of forts.barriers) forts.updateBarrier(w.id, { remainingTicks: 0 });
  const inner = map.ref(90, 51); ctx.planA.targetTile = inner;
  game.applyCommand({ type: "army-order", playerId: ctx.p1.id, armyId: e.armies.armyOf(ctx.A[0].id)!.id, order: { type: "move", tile: inner } });
  return { ctx, o, city, forts };
}
