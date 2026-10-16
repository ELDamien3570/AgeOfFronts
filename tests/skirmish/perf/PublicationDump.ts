// N4 bench input: an in-process 8-human load run that writes every publication
// (as encoded on the wire) to a dump file for PublicationClientBench.ts.
// Ported from the review's scratch load harness (inproc.mts + inject.mts).
// Not a test and not a gate. Deterministic for a seed: humans act on a seeded
// PRNG in simulated time; publications follow LiveMatch's single 5 Hz gate.
//
//   npx tsx tests/skirmish/perf/PublicationDump.ts <med|mig> <out.pubs.bin> [warm=1200] [measure=4800] [seed=1272661902]
//
// Record format (little endian): u32 tick, u32 byteLength, 64 bytes latin1
// hash, u32 reserved (0), then the encoded binary. The first record is a
// baseline captured at the warm-up boundary.
import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { SnapshotEncoder } from "../../../src/skirmish/SnapshotCodec";
import { encodeState, type EncodedState } from "../../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../../src/skirmish/multiplayer/StateLimits";
import { commandSchema } from "../../../src/skirmish/multiplayer/CommandSchema";
import { PUBLICATION_MIN_INTERVAL_MS } from "../../../src/skirmish/multiplayer/application/LiveMatch";
import { RuntimeDiagnostics } from "../../../src/skirmish/RuntimeDiagnostics";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";
import { TICK_MS } from "../../../src/skirmish/Protocol";

const [mapArg = "med", outFile = "publications.pubs.bin", warmArg = "1200", measureArg = "4800", seedArg = "1272661902"] = process.argv.slice(2);
const WARM = Number(warmArg), MEASURE = Number(measureArg), seed = Number(seedArg);
const mapId = mapArg === "mig" ? "migration" : "heightmap-test1";
const FIXED = 256, QUEUE_CAP = 100, HUMANS = 8, ARMY = Number(process.env.ARMY ?? 60);
const SHAPES = ["mass", "shield-wall", "square", "line", "wedge", "modern-loose", "column"];
const BUILD_TYPES = ["barracks", "archery", "stables", "city", "factory", "mine", "blacksmith", "depot", "tower", "port", "armory", "siege-workshop"];

const settings = { ...defaultLobbySettings(mapId as never, 500), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" } as never;
const loaded = await loadServerMap(settings, join(process.cwd(), "resources"), seed);
const options = { ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed,
  humanNames: Array.from({ length: HUMANS }, (_, i) => `H${i + 1}`), aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1",
  victoryMode: "solo", technologySpeed: 1, startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1,
  infiniteGoldForPlayers: false, alliances: false, territoryIncomeScale: loaded.territoryIncomeScale } as never;
const m = loaded.map;
const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), options);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = game as any;
const map = game.map, W = m.width, H = m.height;
for (let id = 1; id <= HUMANS; id++) game.setAiController(id, true);
const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
const diagnostics = new RuntimeDiagnostics();
const encode = (packet: Parameters<typeof encodeState>[0]) => encodeState(packet, diagnostics, SNAPSHOT_STATE_LIMITS, true);
const out = openSync(outFile, "w");
const dump = (tick: number, encoded: EncodedState) => {
  const header = Buffer.alloc(76);
  header.writeUInt32LE(tick, 0); header.writeUInt32LE(encoded.binary!.byteLength, 4);
  header.write(encoded.hash, 8, 64, "latin1"); header.writeUInt32LE(0, 72);
  writeSync(out, header); writeSync(out, encoded.binary!);
};

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
interface Human { id: number; rng: () => number; apm: number; credit: number; cursor: number; followUps: { tick: number; command: unknown }[] }
const humans: Human[] = Array.from({ length: HUMANS }, (_, i) => { const rng = mulberry32(seed ^ (0x9E3779B1 * (i + 1))); return { id: i + 1, rng, apm: 40 + Math.floor(rng() * 41), credit: 0, cursor: 0, followUps: [] }; });
type Squad = Skirmish["squads"][number];
const ownLand = (pid: number) => game.squads.filter(s => s.playerId === pid && s.embarkedOn === null && !s.afloat);
const groupsOf = (pid: number) => { const own = ownLand(pid).sort((a, b) => a.id - b.id); const groups: Squad[][] = []; for (let i = 0; i < own.length; i += 30) groups.push(own.slice(i, i + 30)); return groups; };
const centroid = (squads: Squad[]) => ({ x: squads.reduce((a, s) => a + s.x, 0) / squads.length, y: squads.reduce((a, s) => a + s.y, 0) / squads.length });
const nearest = (pid: number, c: { x: number; y: number }, hostileOnly: boolean) => { let best: Squad | undefined, bd = Infinity;
  for (const s of game.squads) { if (s.playerId === pid || s.embarkedOn !== null || (hostileOnly && !g.hostile(pid, s.playerId))) continue;
    const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
const clampTile = (x: number, y: number) => map.ref(Math.max(0, Math.min(W - 1, Math.floor(x / FIXED))), Math.max(0, Math.min(H - 1, Math.floor(y / FIXED))));
const landNear = (rng: () => number, x: number, y: number, spread: number) => {
  for (let i = 0; i < 10; i++) { const t = clampTile(x + (rng() * 2 - 1) * spread * FIXED, y + (rng() * 2 - 1) * spread * FIXED); if (map.isLand(t)) return t; }
  return undefined;
};
function action(h: Human, tick: number): unknown[] {
  const r = h.rng, groups = groupsOf(h.id), player = game.player(h.id);
  if (!player || player.eliminated) return [];
  const roll = r() * 100;
  const group = () => groups.length ? groups[(h.cursor++ + Math.floor(r() * 2)) % groups.length] : undefined;
  if (roll < 3) { const s = group(); const n = s && nearest(h.id, centroid(s), false); return n && !g.hostile(h.id, n.playerId) ? [{ type: "alliance", playerId: h.id, otherId: n.playerId, action: "declare" }] : []; }
  if (roll < 40) {
    const s = group(); if (!s) return [];
    const c = centroid(s), e = nearest(h.id, c, true);
    const tile = landNear(r, e && r() < 0.6 ? c.x + (e.x - c.x) * 0.7 : c.x, e && r() < 0.6 ? c.y + (e.y - c.y) * 0.7 : c.y, 12 + r() * 25);
    if (tile === undefined) return [];
    const ids = s.map(q => q.id);
    if (r() < 0.35) { let lx = map.x(tile) * FIXED, ly = map.y(tile) * FIXED; const legs = 1 + Math.floor(r() * 3);
      for (let k = 0; k < legs; k++) { const t2 = landNear(r, lx, ly, 10 + r() * 20); if (t2 === undefined) break; lx = map.x(t2) * FIXED; ly = map.y(t2) * FIXED;
        h.followUps.push({ tick: tick + 1 + k * (1 + Math.floor(r() * 3)), command: { type: "order", playerId: h.id, squadIds: ids, order: { type: "move", tile: t2 }, append: true } }); } }
    return [{ type: "order", playerId: h.id, squadIds: ids, order: { type: "move", tile } }];
  }
  if (roll < 55) { const s = group(); const e = s && nearest(h.id, centroid(s), true); return s && e ? [{ type: "order", playerId: h.id, squadIds: s.map(q => q.id), order: { type: "attack", targetId: e.id } }] : []; }
  if (roll < 63) { const s = group(); return s ? [{ type: "formation", playerId: h.id, squadIds: s.map(q => q.id), shape: SHAPES[Math.floor(r() * SHAPES.length)] }] : []; }
  if (roll < 68) { const s = group(); if (!s) return []; const cav = s.filter(q => q.kind === "cavalry"); const use = cav.length ? cav : s.slice(0, 6);
    const e = nearest(h.id, centroid(use), true); return e ? [{ type: "charge", playerId: h.id, squadIds: use.map(q => q.id), x: Math.round(e.x), y: Math.round(e.y), targetId: e.id }] : []; }
  if (roll < 82) { const tiles: number[] = game.ownedLandNearest(h.id, player.base, 256); return tiles.length ? [{ type: "build", playerId: h.id, buildingType: BUILD_TYPES[Math.floor(r() * BUILD_TYPES.length)], tile: tiles[Math.floor(r() * tiles.length)] }] : []; }
  if (roll < 90) { const own = game.buildings.filter(b => b.playerId === h.id && ["barracks", "archery", "stables"].includes(b.type)); return own.length ? [{ type: "recruit", playerId: h.id, buildingId: own[Math.floor(r() * own.length)].id, autoRecruit: true }] : []; }
  if (roll < 96) return [{ type: "research", playerId: h.id, technologyId: TECHNOLOGIES[Math.floor(r() * TECHNOLOGIES.length)].id }];
  if (roll < 98) { const s = group(); return s ? [{ type: "stance", playerId: h.id, squadIds: s.map(q => q.id), stance: r() < 0.5 ? "skirmish" : "default" }] : []; }
  return [{ type: "advance-age", playerId: h.id }];
}
function injectArmies() {
  const counts = new Map<string, { kind: string; definitionId: string; n: number }>();
  for (const s of game.squads) {
    const p = game.player(s.playerId);
    if (!p || p.kind !== "regular" || !s.definitionId || s.embarkedOn !== null || s.afloat) continue;
    const key = `${s.kind}|${s.definitionId}`, row = counts.get(key) ?? { kind: s.kind, definitionId: s.definitionId, n: 0 };
    row.n++; counts.set(key, row);
  }
  const mix = [...counts.values()].sort((a, b) => b.n - a.n || (a.definitionId < b.definitionId ? -1 : 1)).slice(0, 6);
  const total = mix.reduce((a, r) => a + r.n, 0), plan: typeof mix = [];
  for (const r of mix) for (let i = 0; i < Math.round(ARMY * r.n / total); i++) plan.push(r);
  while (plan.length < ARMY) plan.push(mix[0]);
  plan.length = ARMY;
  for (let id = 1; id <= HUMANS; id++) {
    const player = game.player(id); if (!player || player.eliminated) continue;
    const tiles = game.ownedLandNearest(id, player.base, 2000).filter(t => map.isLand(t));
    for (let k = 0; k < plan.length && tiles.length; k++) g.spawnSquad(player, plan[k].kind, tiles[Math.min(tiles.length - 1, 4 + k * 3)], plan[k].definitionId, false);
  }
}

let nextPublicationMs = PUBLICATION_MIN_INTERVAL_MS, publications = 0, commands = 0, sequence = 0;
const started = performance.now();
for (let i = 1; i <= WARM + MEASURE; i++) {
  const measuring = i > WARM;
  if (i === WARM + 1) {
    injectArmies();
    for (let id = 1; id <= HUMANS; id++) game.setAiController(id, false);
    // Join-barrier semantics: advance the shared cursor and dump the aligned baseline.
    dump(game.tick, await encode(encoder.encodeJoinBarrier(game.replicationSource(), game.tileChanges, game.replicationFacts()).baseline));
  }
  if (measuring) {
    const queue: unknown[] = [];
    for (const h of humans) {
      const due = h.followUps.filter(f => f.tick <= game.tick);
      h.followUps = h.followUps.filter(f => f.tick > game.tick);
      const batch = due.map(f => f.command);
      h.credit += h.apm / 60 / 8 - due.length;
      while (h.credit >= 1) { h.credit -= 1; batch.push(...action(h, game.tick)); }
      for (const command of batch) if (queue.length < QUEUE_CAP) queue.push(command);
    }
    for (const command of queue) {
      const parsed = commandSchema.safeParse(command);
      if (parsed.success) { game.commandApplications.apply(`c${++sequence}`, parsed.data); commands++; }
    }
  }
  game.step();
  // LiveMatch's single gate (N6 Design B) in simulation time.
  if (game.tick * TICK_MS >= nextPublicationMs) {
    nextPublicationMs += (Math.floor((game.tick * TICK_MS - nextPublicationMs) / PUBLICATION_MIN_INTERVAL_MS) + 1) * PUBLICATION_MIN_INTERVAL_MS;
    const packet = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    if (measuring) { dump(game.tick, await encode(packet)); publications++; }
  }
  if (i % 400 === 0) console.log(JSON.stringify({ tick: game.tick, squads: game.squads.length, publications, commands, wallSec: Math.round((performance.now() - started) / 1000) }));
}
closeSync(out);
const summary = { mapId, W, H, seed, warm: WARM, measure: MEASURE, publications, publicationsPerSimSecond: +(publications / (MEASURE / 8)).toFixed(2), commands, finalSquads: game.squads.length };
writeFileSync(outFile.replace(/\.pubs\.bin$/, "") + ".summary.json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
