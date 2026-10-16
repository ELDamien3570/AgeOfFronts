// Bounded property test over the external command boundary (review 18, R5).
// Ported from the review's scratch fuzzer: the same generators, valid-biased
// generators, digest and invariants on a small fixed-seed all-land fixture.
//
// Asserted now: no command or tick throws (the match-ending class), and the
// tick invariants below. Recorded as counters only, because they fail on
// defects owned by other roadmap items:
// - rejected => digest unchanged (R2-M10 remainder, Armies fire-retreat, trench
//   budget: R3);
// - accepted => no foreign entity or stance/trench row changed (occupy stance
//   hole, R4);
// - checkpoint -> restore round trip (R2-M11, R2-M12).
// Measured on the development desktop: about 17-25 s for 1,500 commands
// (seed 1, two epochs). On the base commit it throws at command 499 (R2-H2).
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { CommandValidationFailure } from "../../src/skirmish/CommandApplications";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS, VESSELS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { FORMATION_SHAPES, TURN } from "../../src/skirmish/domain/FormationGeometry";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { FIXED, type Command } from "../../src/skirmish/Protocol";
import { BUILDING_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

const COMMANDS = 1500, SEED = 1, W = 160, H = 100, N = W * H;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function mulberry32(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run() {
  const rnd = mulberry32(SEED);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
  const chance = (p: number) => rnd() < p;
  const terrain = new Uint8Array(N).fill(133);
  const baseOptions = {
    ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
    seed: SEED, humanNames: ["A", "B"], aiCount: 2, tribes: true, tribeCount: 1, ruleset: "ages-v1",
    victoryMode: "solo", technologySpeed: 3, startingAge: "Napoleonic", alliances: true,
  } as ConstructorParameters<typeof Skirmish>[1];
  const makeMap = () => new GameMapImpl(W, H, terrain, terrain.length);
  let options = baseOptions, game!: Skirmish, epochs = 0;
  const humans = [1, 2];
  const exp = () => game.expansion!;
  const BT = Object.keys(BUILDING_RULES);
  const counters = {
    applyThrows: [] as Json[], stepThrows: [] as Json[], validationFailures: [] as CommandValidationFailure[],
    schemaRejected: 0, accepted: 0, rejected: 0, deferred: 0, rejectedMutated: {} as Record<string, number>,
    foreignMutated: {} as Record<string, number>, restoreFailures: [] as string[], invariantViolations: {} as Record<string, number>,
  };
  const seen = { squads: new Set<number>(), ships: new Set<number>(), buildings: new Set<number>(), aircraft: new Set<number>(), armies: new Set<number>() };
  const refresh = () => {
    for (const s of game.squads) seen.squads.add(s.id);
    for (const s of game.ships) seen.ships.add(s.id);
    for (const b of game.buildings) seen.buildings.add(b.id);
    for (const a of exp().aircraft) seen.aircraft.add(a.id);
    for (const a of exp().armies.armies) seen.armies.add(a.id);
  };
  /** A fresh seeded match; a decided match starts the next epoch. */
  const setupGame = (seed: number) => {
    epochs++;
    options = { ...baseOptions, seed };
    game = new Skirmish(makeMap(), options);
    for (const set of Object.values(seen)) set.clear();
    game.commandApplications.onValidationFailure = failure => counters.validationFailures.push(failure);

    // Warm-up: the AI plays every seat so the humans also own an economy.
    for (const id of humans) game.setAiController(id, true);
    for (let i = 0; i < 300; i++) game.step();
    for (const id of humans) game.setAiController(id, false);
    // Seeding: research the current age, stock materials, then build and
    // recruit through the ordinary command path so the fuzz state is rich.
    const items = new Set<string>(["payload:atomic"]);
    for (const r of PRODUCTION_RECIPES) for (const k of [...Object.keys(r.inputs ?? {}), ...Object.keys(r.outputs ?? {})]) items.add(k);
    for (const id of humans) {
      const st = exp().progression.states[id], ageIdx = AGES.indexOf(st.age);
      for (const t of TECHNOLOGIES) if (AGES.indexOf(t.age) <= ageIdx && !st.completed.includes(t.id)) st.completed.push(t.id);
      game.player(id)!.gold += 2_000_000;
      const inv = exp().supply.inventories[id];
      for (const k of items) inv[k] = (inv[k] ?? 0) + 2000;
    }
    for (const id of humans) {
      const own: number[] = [];
      for (let t = 0; t < N; t++) if (game.owners[t] === id) own.push(t);
      for (const type of BT)
        for (let k = 0, built = 0; k < 40 && built < 1 && own.length; k++)
          if (game.applyCommand({ type: "build", playerId: id, buildingType: type, tile: pick(own) } as Command) === null) built++;
    }
    for (let k = 0; k < 300; k++) game.step();
    for (const id of humans)
      for (const b of game.buildings.filter(b => b.playerId === id)) {
        for (const u of UNITS) if (chance(0.1)) game.applyCommand({ type: "recruit", playerId: id, buildingId: b.id, definitionId: u.id });
        for (const d of ["fighter", "bomber", "drone"]) game.applyCommand({ type: "recruit-aircraft", playerId: id, buildingId: b.id, definitionId: d } as Command);
      }
    for (let k = 0; k < 300; k++) game.step();
    for (const [a, b] of [[1, 2], [2, 1], [1, 3], [2, 4]]) game.applyCommand({ type: "alliance", playerId: a, otherId: b, action: "declare" } as Command);
    refresh();
  };
  setupGame(SEED);

  // ---------------- value generators ----------------
  const tilesOf = (pred: (t: number) => boolean, max = 64) => { const r: number[] = []; for (let k = 0; k < 2000 && r.length < max; k++) { const t = int(N); if (pred(t)) r.push(t); } return r; };
  const removedIds = (ids: Set<number>, live: Iterable<{ id: number }>) => { const l = new Set([...live].map(x => x.id)); return [...ids].filter(i => !l.has(i)); };
  const idFrom = (pools: number[][]): number => {
    if (rnd() < 0.06) return pick([0, 1, 2, 3, 255, 256, 65535, 65536, 10_000_000, 9_999_999]);
    const ps = pools.filter(p => p.length);
    return ps.length ? pick(pick(ps)) : int(2000);
  };
  const idArray = (pools: number[][], max: number): number[] => {
    const r = rnd();
    const n = Math.max(1, Math.min(max, r < 0.55 ? 1 : r < 0.85 ? 1 + int(6) : r < 0.95 ? max : 2 + int(max - 1)));
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(idFrom(pools));
    if (chance(0.08) && a.length) a.push(a[0]);
    if (chance(0.03)) return [];
    return a.slice(0, chance(0.02) ? max + 1 : max);
  };
  const ctx = (actor: number) => {
    const mine = (x: { playerId: number }) => x.playerId === actor;
    const ownSq = game.squads.filter(mine).map(s => s.id), enemySq = game.squads.filter(s => !mine(s)).map(s => s.id);
    const ownSh = game.ships.filter(mine).map(s => s.id), enemySh = game.ships.filter(s => !mine(s)).map(s => s.id);
    const ownB = game.buildings.filter(mine).map(s => s.id), enemyB = game.buildings.filter(s => !mine(s)).map(s => s.id);
    const ownA = exp().aircraft.filter(mine).map(a => a.id), enemyA = exp().aircraft.filter(a => !mine(a)).map(a => a.id);
    const ownAr = exp().armies.armies.filter(mine).map(a => a.id), enemyAr = exp().armies.armies.filter(a => !mine(a)).map(a => a.id);
    const barriers = exp().fortifications.barriers.map(b => b.id);
    const ownTiles = tilesOf(t => game.owners[t] === actor), enemyTiles = tilesOf(t => game.owners[t] !== actor && game.owners[t] !== 0, 32);
    const neutralLand = tilesOf(t => game.owners[t] === 0, 32);
    const nearOwn = ownSq.slice(0, 8).map(id => { const s = game.squad(id)!; const x = Math.floor(s.x / FIXED) + int(21) - 10, y = Math.floor(s.y / FIXED) + int(21) - 10; return game.map.isValidCoord(x, y) ? game.map.ref(x, y) : 0; });
    return { ownSq, enemySq, ownSh, enemySh, ownB, enemyB, ownA, enemyA, ownAr, enemyAr, barriers, ownTiles, enemyTiles, neutralLand, nearOwn,
      removedSq: removedIds(seen.squads, game.squads), removedSh: removedIds(seen.ships, game.ships), removedB: removedIds(seen.buildings, game.buildings),
      removedA: removedIds(seen.aircraft, exp().aircraft), removedAr: removedIds(seen.armies, exp().armies.armies) };
  };
  type C = ReturnType<typeof ctx>;
  const tile = (c: C) => {
    const r = rnd();
    if (r < 0.05) return pick([0, N - 1, N, N + 1, W, 10_000_000, 9_999_999]);
    if (r < 0.4) return pick(c.nearOwn.length ? c.nearOwn : c.ownTiles.length ? c.ownTiles : [0]);
    if (r < 0.6) return pick(c.ownTiles.length ? c.ownTiles : [0]);
    if (r < 0.8) return pick(c.enemyTiles.length ? c.enemyTiles : [0]);
    return pick(c.neutralLand.length ? c.neutralLand : [int(N)]);
  };
  const coord = (c: C, axis: "x" | "y") => {
    const lim = (axis === "x" ? W : H) * FIXED;
    if (rnd() < 0.15) return pick([-1_000_000, 1_000_000, -1, 0, lim, lim - 1, lim + 1, 999_999, -999_999]);
    const t = tile(c);
    const v = t < N ? (axis === "x" ? game.map.x(t) : game.map.y(t)) * FIXED + int(FIXED) : int(2_000_001) - 1_000_000;
    return Math.max(-1_000_000, Math.min(1_000_000, v));
  };
  const sqIds = (c: C, max = 30) => idArray(chance(0.75) ? [c.ownSq] : [c.ownSq, c.enemySq, c.removedSq, c.ownSh, c.ownB], max);
  const shIds = (c: C) => idArray(chance(0.75) ? [c.ownSh] : [c.ownSh, c.enemySh, c.removedSh, c.ownSq], 200);
  const bId = (c: C) => idFrom(chance(0.7) ? [c.ownB] : [c.ownB, c.enemyB, c.removedB, c.ownSq, c.ownSh]);
  const bIds = (c: C, max = 200) => idArray(chance(0.7) ? [c.ownB] : [c.ownB, c.enemyB, c.removedB], max);
  const acIds = (c: C) => idArray(chance(0.75) ? [c.ownA] : [c.ownA, c.enemyA, c.removedA, c.ownSq], 200);
  const armyId = (c: C) => idFrom(chance(0.7) ? [c.ownAr] : [c.ownAr, c.enemyAr, c.removedAr, c.ownSq]);
  const target = (c: C) => idFrom(chance(0.6) ? [c.enemySq] : [c.enemySq, c.ownSq, c.removedSq, c.enemySh, c.enemyB, c.barriers]);
  const unitDefs = UNITS.map(u => u.id), vesselDefs = VESSELS.map(v => v.id), techs = TECHNOLOGIES.map(t => t.id), recipes = PRODUCTION_RECIPES.map(r => r.id);
  const text = (xs: string[]) => chance(0.9) ? pick(xs) : pick(["x", "auto", "__proto__", "constructor", "toString", "hasOwnProperty", "a".repeat(100)]);
  const opt = <T,>(p: number, v: () => T): T | undefined => chance(p) ? v() : undefined;
  const clean = (o: Json) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
  const order = (c: C): Json => {
    const k = pick(["hold", "replenish", "move", "move", "attack", "attack"]);
    if (k === "move") return clean({ type: "move", tile: tile(c), x: opt(0.2, () => coord(c, "x")), y: opt(0.2, () => coord(c, "y")) });
    if (k === "attack") return clean({ type: "attack", targetId: target(c), cavalryMode: opt(0.3, () => "ranks") });
    return { type: k };
  };
  const armyOrder = (c: C): Json => {
    const k = pick(["move", "regroup", "deploy", "attack", "flank-left", "flank-right", "fire-retreat", "hold"]);
    if (k === "move" || k === "regroup") return { type: k, tile: tile(c) };
    if (k === "deploy") return clean({ type: k, tile: tile(c), facing: opt(0.5, () => pick([-Math.PI, Math.PI, 0, rnd() * 6.28 - 3.14])) });
    if (k === "hold") return { type: k };
    return { type: k, targetId: target(c) };
  };
  const ALLIANCE = ["offer", "offer-long-term", "accept", "reject", "renew", "break", "declare", "end-long-term", "offer-peace", "accept-peace", "reject-peace", "dont-embargo", "allow-embargo"];
  const other = () => idFrom([game.players.map(p => p.id)]);
  const gens: Record<string, (c: C) => Json> = {
    occupy: c => clean({ squadIds: sqIds(c), tile: tile(c), frontageTiles: opt(0.4, () => { const t0 = tile(c); const n = 1 + int(chance(0.1) ? 64 : 8); return Array.from({ length: n }, (_, i) => chance(0.9) ? t0 + i : tile(c)); }), append: opt(0.3, () => chance(0.5)) }),
    stance: c => ({ squadIds: sqIds(c), stance: pick(["default", "skirmish"]) }),
    formation: c => clean({ squadIds: idArray([c.ownSq, c.enemySq], 200), shape: pick(FORMATION_SHAPES), facing: opt(0.5, () => pick([0, TURN - 1, int(TURN)])), frontage: opt(0.4, () => pick([1, 2, 7, 128 * 256, 1 + int(4096)])), shapeLock: opt(0.3, () => chance(0.5)) }),
    "create-army": c => ({ squadIds: idArray([c.ownSq, c.enemySq, c.removedSq], 200) }),
    "army-members": c => ({ armyId: armyId(c), squadIds: idArray([c.ownSq, c.enemySq], 200), action: pick(["add", "remove"]) }),
    "disband-army": c => ({ armyId: armyId(c) }),
    "army-auto": c => ({ armyId: armyId(c), enabled: chance(0.5) }),
    "army-posture": c => ({ armyId: armyId(c), posture: pick(["line", "defend", "skirmish"]) }),
    "army-order": c => clean({ armyId: armyId(c), order: armyOrder(c), append: opt(0.3, () => chance(0.5)) }),
    "refit-ships": c => ({ shipIds: shIds(c), definitionId: text(vesselDefs) }),
    "naval-attack": c => ({ shipIds: shIds(c), targetId: idFrom([c.enemySh, c.enemyB, c.enemySq, c.ownSh, c.removedSh]) }),
    "naval-priority": c => ({ shipIds: shIds(c), priority: pick(["transports", "warships"]) }),
    research: () => ({ technologyId: text(techs) }),
    "advance-age": () => ({}),
    produce: c => ({ buildingId: bId(c), recipeId: chance(0.15) ? null : text([...recipes, "auto"]) }),
    "production-priority": () => ({ buildingType: pick(BT), recipeIds: chance(0.2) ? null : Array.from({ length: chance(0.05) ? 100 : int(5) }, () => text(recipes)) }),
    "reset-production-priorities": () => ({}),
    "trade-pause": () => ({ naval: chance(0.5), paused: chance(0.5) }),
    "trade-block": () => clean({ otherId: other(), blocked: chance(0.5), naval: opt(0.5, () => chance(0.5)) }),
    refit: c => ({ squadIds: sqIds(c, 200), definitionId: text(unitDefs) }),
    enlarge: c => ({ squadIds: sqIds(c, 200), definitionId: text(unitDefs) }),
    "cancel-enlarge": c => ({ squadIds: sqIds(c, 200) }),
    charge: c => clean({ squadIds: sqIds(c), x: coord(c, "x"), y: coord(c, "y"), targetId: opt(0.5, () => target(c)), fallbackOrder: opt(0.5, () => chance(0.5) ? { type: "move", tile: tile(c) } : { type: "attack", targetId: idFrom([c.enemySq, c.removedSq, [0, 9_999_999]]) }) }),
    "attack-structure": c => clean({ squadIds: sqIds(c), buildingId: opt(0.6, () => idFrom([c.enemyB, c.ownB, c.removedB])), barrierId: opt(0.4, () => idFrom([c.barriers])) }),
    alliance: () => ({ otherId: other(), action: pick(ALLIANCE) }),
    repair: c => clean({ buildingId: opt(0.4, () => bId(c)), buildingIds: opt(0.3, () => bIds(c, chance(0.05) ? 10_000 : 20)), barrierId: opt(0.3, () => idFrom([c.barriers])) }),
    "recruit-aircraft": c => clean({ buildingId: bId(c), buildingIds: opt(0.3, () => bIds(c, 20)), autoRecruit: opt(0.3, () => chance(0.5)), definitionId: pick(["fighter", "bomber", "drone"]) }),
    sortie: c => clean({ mission: opt(0.8, () => pick(["bombing", "patrol", "atomic", "drone"])), aircraftIds: acIds(c), x: coord(c, "x"), y: coord(c, "y") }),
    "transfer-aircraft": c => ({ aircraftIds: acIds(c), buildingId: bId(c) }),
    launch: c => clean({ launcherId: bId(c), payload: pick(["icbm", "hydrogen", "mirv"]), buildingId: opt(0.3, () => idFrom([c.enemyB])), x: coord(c, "x"), y: coord(c, "y") }),
    "upgrade-building": c => ({ buildingIds: bIds(c) }),
    "delete-building": c => ({ buildingId: bId(c) }),
    "delete-ship": c => ({ shipId: idFrom([c.ownSh, c.enemySh, c.removedSh]) }),
    "cancel-recruitment": c => clean({ category: opt(0.5, () => pick(["land", "ship", "aircraft"])), definitionId: opt(0.3, () => text(unitDefs)), kind: opt(0.2, () => text(["infantry", "cavalry", "warship"])), buildingId: opt(0.3, () => bId(c)), buildingIds: opt(0.2, () => bIds(c, 20)) }),
    recruit: c => clean({ buildingId: bId(c), buildingIds: opt(0.2, () => bIds(c, 20)), autoRecruit: opt(0.2, () => chance(0.5)), definitionId: opt(0.8, () => text(unitDefs)) }),
    build: c => clean({ buildingType: pick(BT), tile: tile(c), age: opt(0.3, () => pick(AGES)) }),
    "recruit-ship": c => clean({ buildingId: bId(c), buildingIds: opt(0.2, () => bIds(c, 20)), autoRecruit: opt(0.2, () => chance(0.5)), shipType: "warship", definitionId: opt(0.6, () => text(vesselDefs)) }),
    sail: c => clean({ shipIds: shIds(c), tile: tile(c), append: opt(0.3, () => chance(0.5)) }),
    "stop-ships": c => ({ shipIds: shIds(c) }),
    order: c => {
      const o = order(c);
      return clean({ squadIds: sqIds(c), order: o, append: opt(0.3, () => chance(0.5)),
        deploymentLine: opt(o.type === "move" ? 0.3 : 0.03, () => ({ start: { x: coord(c, "x"), y: coord(c, "y") }, end: { x: coord(c, "x"), y: coord(c, "y") } })) });
    },
  };
  // Valid-biased generators: deep coverage of acceptance paths.
  const UNIT_BY = new Map<string, Json>(UNITS.map(u => [u.id, u]));
  const smart = (type: string, actor: number): Json | undefined => {
    const own = game.squads.filter(s => s.playerId === actor && s.embarkedOn === null);
    const enemies = game.squads.filter(s => s.playerId !== actor && exp().diplomacy.hostile(actor, s.playerId));
    const ownB = game.buildings.filter(b => b.playerId === actor && !b.remainingTicks);
    const enemyB = game.buildings.filter(b => b.playerId !== actor && b.playerId !== 0);
    const some = <T,>(xs: T[], n = 1 + int(4)) => { const r: T[] = []; for (let i = 0; i < n && xs.length; i++) r.push(pick(xs)); return [...new Set(r)]; };
    const near = <T extends { x: number; y: number }>(s: { x: number; y: number }, xs: T[]) => xs.slice().sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
    const posOf = (b: { tile: number }) => ({ x: game.map.x(b.tile) * FIXED + 128, y: game.map.y(b.tile) * FIXED + 128 });
    const ac = exp().aircraft.filter(a => a.playerId === actor && a.health > 0);
    switch (type) {
      case "occupy": {
        const trenches = ownB.filter(b => b.type === "trench"); if (!trenches.length || !own.length) return;
        const t = pick(trenches), line = trenches.filter(b => game.map.y(b.tile) === game.map.y(t.tile) && Math.abs(game.map.x(b.tile) - game.map.x(t.tile)) < 4).map(b => b.tile).sort((a, b) => a - b);
        const foot = own.filter(s => s.kind !== "cavalry");
        return { squadIds: some(foot.length ? foot : own).map(s => s.id), tile: t.tile, ...(chance(0.4) && line.length ? { frontageTiles: [...new Set(line)] } : {}) };
      }
      case "transfer-aircraft": {
        const fields = ownB.filter(b => b.type === "airstrip"), ready = ac.filter(a => a.state === "ready" && a.definitionId !== "drone"); if (!fields.length || !ready.length) return;
        const a = pick(ready), dest = pick(fields.filter(f => f.id !== a.airfieldId).concat(fields));
        return { aircraftIds: some(ready.filter(r => r.airfieldId === a.airfieldId)).map(r => r.id), buildingId: dest.id };
      }
      case "sortie": {
        const ready = ac.filter(a => a.state === "ready"); if (!ready.length) return; const a = pick(ready);
        const t = enemyB.length && chance(0.7) ? posOf(pick(enemyB)) : enemies.length ? pick(enemies) : { x: a.x + 2000, y: a.y };
        const mission = a.definitionId === "fighter" ? "patrol" : a.definitionId === "drone" ? "drone" : chance(0.2) ? "atomic" : "bombing";
        return { mission, aircraftIds: ready.filter(r => r.definitionId === a.definitionId).slice(0, 1 + int(4)).map(r => r.id), x: Math.max(0, Math.min(W * FIXED - 1, Math.round(t.x))), y: Math.max(0, Math.min(H * FIXED - 1, Math.round(t.y))) };
      }
      case "launch": {
        const l = ownB.filter(b => b.type === "missile-silo" || b.type === "mirv-launcher"); if (!l.length) return; const b = pick(l);
        const payload = b.type === "mirv-launcher" ? "mirv" : pick(["icbm", "hydrogen"]);
        if (enemyB.length && chance(0.5)) return { launcherId: b.id, payload, buildingId: pick(enemyB).id, x: 0, y: 0 };
        const t = enemyB.length ? posOf(pick(enemyB)) : { x: 1000, y: 1000 }; return { launcherId: b.id, payload, x: t.x, y: t.y };
      }
      case "enlarge": case "refit": {
        if (!own.length) return; const s = pick(own), u = UNIT_BY.get(s.definitionId ?? ""); if (!u) return;
        const same = own.filter(o => o.definitionId === s.definitionId), cands = UNITS.filter(v => v.line === u.line && v.role === u.role);
        return { squadIds: some(same).map(o => o.id), definitionId: type === "enlarge" ? (chance(0.5) ? s.definitionId : pick(cands).id) : pick(cands).id };
      }
      case "charge": {
        const chargers = own.filter(s => UNIT_BY.get(s.definitionId ?? "")?.charge); if (!chargers.length || !enemies.length) return; const s = pick(chargers), t = near(s, enemies);
        return { squadIds: some(chargers.filter(o => Math.hypot(o.x - s.x, o.y - s.y) < 4000)).map(o => o.id), x: Math.round(t.x), y: Math.round(t.y), ...(chance(0.6) ? { targetId: t.id } : {}), ...(chance(0.4) ? { fallbackOrder: chance(0.5) ? { type: "attack", targetId: t.id } : { type: "move", tile: game.tileOf(t) } } : {}) };
      }
      case "formation": { if (!own.length) return; return { squadIds: some(own).map(s => s.id), shape: pick(FORMATION_SHAPES), ...(chance(0.5) ? { facing: int(TURN) } : {}) }; }
      case "order": {
        if (!own.length) return; const sel = some(own), s = sel[0];
        if (chance(0.4) && enemies.length) return { squadIds: sel.map(o => o.id), order: { type: "attack", targetId: near(s, enemies).id, ...(chance(0.2) ? { cavalryMode: "ranks" } : {}) }, ...(chance(0.2) ? { append: true } : {}) };
        const t = game.tileOf(chance(0.5) && enemies.length ? near(s, enemies) : s) + int(9) - 4;
        if (chance(0.3)) { const x = s.x + int(4000) - 2000, y = s.y + int(4000) - 2000; return { squadIds: sel.map(o => o.id), order: { type: "move", tile: Math.max(0, Math.min(N - 1, t)) }, deploymentLine: { start: { x, y }, end: { x: x + 1500, y: y + int(600) } }, ...(chance(0.3) ? { append: true } : {}) }; }
        return { squadIds: sel.map(o => o.id), order: chance(0.15) ? { type: pick(["hold", "replenish"]) } : { type: "move", tile: Math.max(0, Math.min(N - 1, t)) }, ...(chance(0.3) ? { append: true } : {}) };
      }
      case "attack-structure": {
        if (!own.length || !enemyB.length) return; const s = pick(own), b = near(s, enemyB.map(b => ({ ...b, ...posOf(b) })));
        return { squadIds: some(own.filter(o => Math.hypot(o.x - s.x, o.y - s.y) < 6000)).map(o => o.id), buildingId: b.id };
      }
      case "army-order": {
        const armies = exp().armies.armies.filter(a => a.playerId === actor); if (!armies.length) return; const a = pick(armies);
        const k = pick(["move", "regroup", "deploy", "attack", "flank-left", "flank-right", "fire-retreat", "hold"]), lead = game.squad(a.leaderId) ?? own[0]; if (!lead) return;
        if (["attack", "flank-left", "flank-right", "fire-retreat"].includes(k)) { if (!enemies.length) return; return { armyId: a.id, order: { type: k, targetId: near(lead, enemies).id } }; }
        if (k === "hold") return { armyId: a.id, order: { type: k } };
        return { armyId: a.id, order: { type: k, tile: Math.max(0, Math.min(N - 1, game.tileOf(lead) + int(2000) - 1000)) }, ...(chance(0.3) ? { append: true } : {}) };
      }
      case "create-army": { if (own.length < 2) return; return { squadIds: some(own, 2 + int(5)).map(s => s.id) }; }
      case "build": {
        const tiles: number[] = []; for (let k = 0; k < 400 && tiles.length < 20; k++) { const t = int(N); if (game.owners[t] === actor) tiles.push(t); }
        if (!tiles.length) return; return { buildingType: chance(0.4) ? "trench" : pick(BT), tile: pick(tiles) };
      }
      case "recruit": { const b = ownB.filter(b => ["barracks", "archery", "stables", "siege-workshop", "arms-factory", "city"].includes(b.type)); if (!b.length) return; return { buildingId: pick(b).id, definitionId: pick(UNITS).id }; }
      case "recruit-aircraft": { const b = ownB.filter(b => b.type === "airstrip" || b.type === "drone-facility"); if (!b.length) return; const f = pick(b); return { buildingId: f.id, definitionId: f.type === "drone-facility" ? "drone" : pick(["fighter", "bomber"]) }; }
    }
    return undefined;
  };
  // Edge generators for the boundary defects the review found (R2-H1/H2):
  // a blocked charge whose fallback lands off-map, and a large human order
  // that splits into a corridor lead and follower cohorts.
  const edge = (actor: number): Json | undefined => {
    const own = game.squads.filter(s => s.playerId === actor && s.embarkedOn === null);
    if (!own.length) return;
    if (chance(0.5)) {
      const marching = own.filter(s => s.kind !== "cavalry" && s.formation?.shape === "column");
      const selection = (marching.length ? marching : own).slice(0, 4).map(s => s.id);
      return { type: "charge", squadIds: selection, x: pick([W * FIXED, 1_000_000, 10 * FIXED]), y: pick([H * FIXED, 1_000_000, 10 * FIXED]),
        fallbackOrder: { type: "attack", targetId: 9_999_999 } };
    }
    return { type: "order", squadIds: own.slice(0, 12).map(s => s.id), order: { type: "move", tile: game.map.ref(int(W), int(H)) } };
  };
  const weights: Record<string, number> = { order: 8, charge: 4, formation: 4, build: 4, recruit: 4, occupy: 3, "army-order": 3, "attack-structure": 2, sail: 2, sortie: 2, "transfer-aircraft": 2, "recruit-aircraft": 2, alliance: 2, launch: 1, "create-army": 2 };
  const bag: string[] = [];
  for (const t of Object.keys(gens)) for (let i = 0; i < (weights[t] ?? 1); i++) bag.push(t);

  // ---------------- digests / invariants ----------------
  const digest = () => {
    const e = exp() as Json, g = game as Json;
    return {
      players: JSON.stringify(game.players), squads: JSON.stringify(game.squads), ships: JSON.stringify(game.ships), buildings: JSON.stringify(game.buildings),
      aircraft: JSON.stringify(e.aircraft), inventories: JSON.stringify(e.supply.inventories), trenches: JSON.stringify(e.trenches.checkpoint()),
      stance: JSON.stringify(e.skirmish.checkpoint()), armies: JSON.stringify(e.armies.checkpoint()), diplomacy: JSON.stringify(e.diplomacy.state),
      recruitment: JSON.stringify(g.recruitment.checkpoint()), admission: JSON.stringify(g.movementAdmission.checkpoint()),
      barriers: JSON.stringify(e.fortifications.barriers), progression: JSON.stringify(e.progression.checkpoint()),
      owners: Array.from(game.owners).join(","),
    } as Record<string, string>;
  };
  const owners = (json: string) => new Map<number, number>((JSON.parse(json) as { id: number; playerId: number }[]).map(x => [x.id, x.playerId]));
  const changedFor = (a: string, b: string, actor: number): boolean => {
    const A = new Map((JSON.parse(a) as Json[]).map(x => [x.id, x])), B = new Map((JSON.parse(b) as Json[]).map(x => [x.id, x]));
    for (const [id, x] of A) if (x.playerId !== actor && JSON.stringify(x) !== JSON.stringify(B.get(id))) return true;
    return false;
  };
  const violation = (key: string) => { counters.invariantViolations[key] = (counters.invariantViolations[key] ?? 0) + 1; };
  const asserted: string[] = [];
  const invariants = (label: string) => {
    for (const p of game.players) {
      if (!Number.isFinite(p.gold) || p.gold < 0) asserted.push(`${label}: player ${p.id} gold ${p.gold}`);
      const inv = exp().supply.inventories[p.id];
      if (inv) for (const [k, v] of Object.entries(inv)) if (!Number.isFinite(v) || v < 0) asserted.push(`${label}: player ${p.id} inventory ${k}=${v}`);
    }
    for (const s of game.squads) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.y < 0 || s.x >= W * FIXED || s.y >= H * FIXED) asserted.push(`${label}: squad ${s.id} off-map ${s.x},${s.y}`);
      if (!Number.isFinite(s.troops) || s.troops < 0) asserted.push(`${label}: squad ${s.id} troops ${s.troops}`);
      for (const o of [s.order, ...s.queuedOrders]) {
        if (o.type === "move" && (!Number.isSafeInteger(o.tile) || o.tile < 0 || o.tile >= N)) asserted.push(`${label}: squad ${s.id} move tile ${o.tile}`);
        if (o.type === "move" && o.x !== undefined && (o.x < 0 || o.x >= W * FIXED || o.y! < 0 || o.y! >= H * FIXED)) asserted.push(`${label}: squad ${s.id} move point ${o.x},${o.y}`);
      }
      if (s.charge && (s.charge.x < 0 || s.charge.y < 0 || s.charge.x >= W * FIXED || s.charge.y >= H * FIXED)) asserted.push(`${label}: squad ${s.id} charge point ${s.charge.x},${s.charge.y}`);
      if (s.queuedOrders.length > 32) violation("queued orders over 32");
    }
    for (const a of exp().aircraft) if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) violation("aircraft non-finite");
  };
  invariants("after-seeding");

  // ---------------- main loop ----------------
  let processed = 0;
  for (let i = 0; i < COMMANDS; i++, processed++) {
    if (i % 250 === 0) {
      refresh();
      try {
        const fresh = new Skirmish(makeMap(), options);
        fresh.restore(game.checkpoint());
        for (let k = 0; k < 2; k++) fresh.step();
      } catch (error) { counters.restoreFailures.push(String((error as Error).message).slice(0, 200)); }
    }
    const trusted = chance(0.05);
    const actor = trusted ? pick(game.players.filter(p => p.ai && !p.eliminated).map(p => p.id).concat([1])) : pick(humans);
    const type = pick(bag), c = ctx(actor);
    const edgeCase = chance(0.03) ? edge(actor) : undefined;
    const raw = edgeCase ?? { type, ...(chance(0.5) ? smart(type, actor) ?? gens[type](c) : gens[type](c)) };
    const parsed = commandSchema.safeParse({ ...raw, playerId: actor });
    if (!parsed.success) { counters.schemaRejected++; continue; }
    const command = parsed.data as Command;
    // A digest every fifth command keeps the oracle counters within budget.
    const sample = i % 5 === 0, before = sample ? digest() : undefined;
    let status: string;
    try {
      if (trusted) status = game.applyCommand(command) ? "rejected" : "executed";
      else if (game.player(actor)!.ai) status = "rejected";
      else status = game.commandApplications.apply(`fz${i}`, command).status;
    } catch (error) {
      counters.applyThrows.push({ type, command, tick: game.tick, message: (error as Error).message, stack: String((error as Error).stack).split("\n").slice(0, 8).join("\n") });
      break;
    }
    if (status === "rejected") counters.rejected++; else if (status === "deferred") counters.deferred++; else counters.accepted++;
    if (before) {
      const after = digest(), changed = Object.keys(before).filter(k => before[k] !== after[k]);
      if (status === "rejected" && changed.length) for (const k of changed) counters.rejectedMutated[`${type}:${k}`] = (counters.rejectedMutated[`${type}:${k}`] ?? 0) + 1;
      if (status !== "rejected" && type !== "alliance")
        for (const k of ["squads", "ships", "buildings"]) if (before[k] !== after[k] && changedFor(before[k], after[k], actor)) {
          // Squads the actor does not own that changed during its own command.
          const own = owners(before[k]);
          if ([...own.values()].some(p => p !== actor)) counters.foreignMutated[`${type}:${k}`] = (counters.foreignMutated[`${type}:${k}`] ?? 0) + 1;
        }
    }
    try { for (let k = 0, ticks = 1 + int(2); k < ticks; k++) game.step(); }
    catch (error) {
      counters.stepThrows.push({ lastType: type, tick: game.tick, message: (error as Error).message, stack: String((error as Error).stack).split("\n").slice(0, 8).join("\n") });
      break;
    }
    invariants(type);
    if (game.winner !== null || humans.every(h => game.player(h)!.eliminated)) { setupGame(SEED + 1000 * epochs); invariants("after-seeding"); }
  }
  return { counters, asserted, tick: game.tick, processed, epochs };
}

describe("command fuzzing (bounded)", () => {
  it(`survives ${COMMANDS} fuzzed commands without a match-ending throw`, () => {
    const started = performance.now();
    const { counters, asserted, tick, processed, epochs } = run();
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    // Recorded, not asserted: see the header for the owning roadmap items.
    console.info(JSON.stringify({ event: "command-fuzz", seed: SEED, commands: processed, epochs, seconds, tick,
      accepted: counters.accepted, deferred: counters.deferred, rejected: counters.rejected, schemaRejected: counters.schemaRejected,
      validationFailures: counters.validationFailures.map(f => `${f.type}: ${f.message}`),
      rejectedMutated: counters.rejectedMutated, foreignMutated: counters.foreignMutated,
      restoreFailures: counters.restoreFailures, invariantViolations: counters.invariantViolations }));
    expect(processed).toBe(COMMANDS);
    expect(counters.applyThrows).toEqual([]);
    expect(counters.stepThrows).toEqual([]);
    expect(asserted.slice(0, 10)).toEqual([]);
    expect(counters.accepted + counters.deferred).toBeGreaterThan(100);
  }, 120_000);
});
