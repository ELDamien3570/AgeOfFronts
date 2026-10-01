// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
// Does ONE human tower slow the whole sim in a natural game? (independent of the report's synthetic fixture)
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadMap } from "../../../src/skirmish/Terrain";
import { buildingTechnology } from "../../../src/skirmish/content/Buildings";
import { Skirmish } from "../../../src/skirmish/Simulation";
(globalThis as any).fetch = async (url: string) => {
  const buf = fs.readFileSync(process.cwd() + "/resources" + url);
  return { ok: true, json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const towers = Number(process.argv[2] ?? 0);
const loaded = await loadMap("world", 500);
const match: any = new Skirmish(loaded.map, { seed: 42, aiCount: 19, tribes: false, ruleset: "ages-v1",
  territoryIncomeScale: loaded.territoryIncomeScale });
// Same start-tree cache as before, to isolate the tower effect from trade noise.
{ const h: any = (match.paths as any).hierarchy; const orig = h.localTree.bind(h);
  const cache = new Map<number, any>(); const rev = new Map<number, number>();
  h.topology.onCostsChanged((tiles: readonly number[]) => { for (const c of new Set(tiles.map((t) => h.cluster(t)))) rev.set(c, (rev.get(c) ?? 0) + 1); });
  h.localTree = (s: number, c: number) => { const r = rev.get(c) ?? 0; const hit = cache.get(s); if (hit && hit.rev === r) return hit.tree;
    const tree = orig(s, c); cache.set(s, { tree, rev: r }); if (cache.size > 512) cache.delete(cache.keys().next().value); return tree; }; }
const times: number[] = []; let placed = 0, replies: string[] = [];
for (let i = 1; i <= 6 * 1200; i++) {
  if (i === 3000 && towers) {
    const p = [...match.players].filter((q: any) => !q.eliminated && q.kind !== "tribe").sort((a: any, b: any) => b.land - a.land)[0]; const pid = p.id;
    p.gold = 1e9; { const st = match.expansion.progression.states[pid]; const tech = buildingTechnology("tower", st.age); if (tech && !st.completed.includes(tech)) st.completed.push(tech); console.log("granted", tech, "age", st.age); }
    const owned: number[] = Array.from(match.ownedLand(pid));
    for (const t of owned.slice(0, 400)) {
      if (placed >= towers) break;
      const r = match.applyCommand({ type: "build", playerId: pid, buildingType: "tower", tile: t });
      if (r === null) placed++; else if (replies.length < 3 && !replies.includes(r)) replies.push(r);
    }
    console.log("tower build results: placed", placed, "rejections", JSON.stringify(replies));
  }
  const t = performance.now(); match.step(); times.push(performance.now() - t);
}
const mean = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const before = times.slice(1800, 3000), after = times.slice(3300, 7200);
console.log(JSON.stringify({ towers, completedTowers: match.buildings.filter((b: any) => b.type === "tower" && !b.remainingTicks).length,
  meanBefore: mean(before), meanAfter: mean(after), squads: match.squads.length }));
