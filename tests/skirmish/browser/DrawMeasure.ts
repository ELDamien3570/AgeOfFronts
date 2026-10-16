/** Browser draw measure for the U4/U5 Chrome gates (Next #4); ported from the
 * client-unread review harness. See DrawMeasure.html for the run recipe. */
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { installTroopPresentation } from "../../../src/skirmish/client/troops/TroopPresentation";
const out = document.getElementById("out")!;
const log = (s: string) => { out.textContent += "\n" + s; };
const stat = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2);
  return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(2), p50: q(.5), p95: q(.95), p99: q(.99), max: q(1) }; };
const yieldOnce = () => new Promise<void>(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms: number) => { const end = performance.now() + ms; do { await yieldOnce(); } while (performance.now() < end); };
async function run() {
  if (new URLSearchParams(location.search).has("nodraw")) { const proto = CanvasRenderingContext2D.prototype as any; proto.drawImage = function () {}; }
  const params = new URLSearchParams(location.search), perFaction = Number(params.get("squads") ?? 40);
  const W = 500, H = 250, data = new Uint8Array(W * H).fill(133); data.fill(0, 200 * W, H * W);
  const game = new Skirmish(new GameMapImpl(W, H, data, data.length), { seed: 91, humanNames: Array.from({ length: 8 }, (_, i) => `Human ${i + 1}`),
    aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1", startingAge: "Napoleonic", alliances: true, ...DEFAULT_AI_POLICIES } as never);
  const regular = game.players.filter((p: any) => p.kind !== "tribe");
  for (const [at, p] of regular.entries()) {
    const template = structuredClone(game.squadFacts().byOwner(p.id)[0]);
    const pair = Math.floor(at / 2), side = at % 2, cx = 25 + pair * 42, cy = side ? 106 : 92;
    for (let i = 0; i < perFaction; i++)
      game.addSquad({ ...template, id: game.allocateId(), x: (cx + (i % 10) * 2 + .5) * FIXED, y: (cy + (side ? 1 : -1) * Math.floor(i / 10) * 2 + .5) * FIXED, order: { type: "hold" }, path: [], queuedOrders: [] } as never);
    for (let i = 0; i < 14; i++)
      game.addShip({ id: game.allocateId(), playerId: p.id, kind: "warship", definitionId: "modern-warship", x: (8 + (at * 14 + i) % 480 + .5) * FIXED, y: (205 + (at % 8) * 5 + .5) * FIXED,
        health: game.expansion!.vessel({ playerId: p.id, definitionId: "modern-warship", kind: "warship" } as never).health, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false } as never);
    if (side) game.applyCommand({ type: "alliance", playerId: regular[at - 1].id, otherId: p.id, action: "declare" } as never);
  }
  log("built; stepping");
  for (let i = 0; i < 40; i++) game.step();
  const human = regular.find((p: any) => !p.ai)!.id;
  const canvas = document.getElementById("battlefield") as HTMLCanvasElement;
  const renderer = new Renderer(canvas); renderer.setMap(game.map);
  const presentation = installTroopPresentation(renderer, () => {});
  const acc: Record<string, number> = {}; for (const hook of ["squadArtworkOverride", "squadArtworkFlush", "squadRemainsArtwork", "squadVolleyArtwork", "squadProjectileArtwork"]) { const original = (renderer as any)[hook]; if (!original) continue; (renderer as any)[hook] = (...args: unknown[]) => { const t = performance.now(); try { return original(...args); } finally { acc[hook] = (acc[hook] ?? 0) + performance.now() - t; } }; }
  const own = game.squads.filter((s: any) => s.playerId === human).slice(0, 30); for (const s of own) renderer.selected.add(s.id);
  const results: Record<string, any> = {};
  for (const mode of (new URLSearchParams(location.search).get("modes") ?? "soldier16,soldier12,strategic").split(",")) {
    const R: Record<string, number[]> = {}; const rec = (k: string, v: number) => (R[k] ??= []).push(v);
    let now = performance.now();
    const snaps = 20;
    for (let n = 0; n < snaps; n++) {
      game.step(); if (n % 3 !== 2) game.step();
      const snapshot = game.snapshot(); snapshot.localPlayerId = human;
      const entities: Partial<typeof snapshot> = { ...snapshot }; delete entities.owners; delete entities.claims; delete entities.progress;
      let t = performance.now(); structuredClone(entities); rec("clone(ser+deser)", performance.now() - t);
      t = performance.now(); renderer.update(snapshot); rec("renderer.update", performance.now() - t);
      presentation.update(snapshot);
      if (n === 0) {
        if (mode === "strategic") renderer.home();
        else { const scale = Number(mode.slice(7)); (renderer as any).scale = scale; const fighters = game.squads.filter((s: any) => s.fighting); const dense = (q: any) => game.squads.filter((o: any) => Math.abs(o.x - q.x) < 25 * FIXED && Math.abs(o.y - q.y) < 15 * FIXED).length; const c = (fighters.length ? fighters : own).reduce((a: any, b: any) => dense(b) > dense(a) ? b : a); (renderer as any).offsetX = 800 - c.x / FIXED * scale; (renderer as any).offsetY = 450 - c.y / FIXED * scale; (renderer as any).nextFrame = 0; }
        // let sprite sheets load before sampling
        for (let k = 0; k < 400; k++) { if (k > 40 && (mode === "strategic" || game.squads.filter((q: any) => (renderer as any).formationPoses?.has(q.id)).every((q: any) => !q.definitionId || renderer.squadArtworkDetailed?.(q as never, renderer.pixelsPerCell) !== false))) break; now = Math.max(now + 1000 / 60, performance.now()); presentation.beginFrame(now, 1, false); renderer.draw(now, 1, false); presentation.endFrame(now, 0); await wait(50); }
      }
      for (let f = 0; f < 12; f++) {
        now = Math.max(now + 1000 / 60, performance.now());
        const t0 = performance.now(); presentation.beginFrame(now, 1, false); const t1 = performance.now();
        for (const k in acc) acc[k] = 0; renderer.draw(now, 1, false); const t2 = performance.now(); presentation.endFrame(now, 0); for (const k in acc) rec("hook." + k, acc[k]);
        rec("beginFrame", t1 - t0); rec("draw", t2 - t1); rec("frame(begin+draw)", t2 - t0);
        await wait(0);
      }
    }
    const visible = (renderer as any).formationPoses?.size;
    results[mode] = { scale: renderer.pixelsPerCell, posesThisFrame: visible, squads: game.squads.length, fighting: game.squads.filter((s: any) => s.fighting).length,
      heapMB: +((performance as any).memory.usedJSHeapSize / 1048576).toFixed(1), ...Object.fromEntries(Object.entries(R).map(([k, v]) => [k, stat(v.slice(3))])) };
    results[mode].loadedDetail = game.squads.filter((q: any) => (renderer as any).formationPoses?.has(q.id) && renderer.squadArtworkDetailed?.(q as never, renderer.pixelsPerCell) === true).length; log(mode + " " + JSON.stringify(results[mode]));
  }
  (window as any).__result = results; log("DONE");
}
run().catch(e => { log("ERROR " + (e?.stack ?? e)); (window as any).__result = { error: String(e?.stack ?? e) }; });
