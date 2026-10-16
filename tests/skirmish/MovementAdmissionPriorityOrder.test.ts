import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { MovementAdmission } from "../../src/skirmish/MovementAdmission";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { retainSquads } from "./UnitFixtures";

/** Deterministic test PRNG (independent of the simulation's). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % n;
  };
}

function world() {
  const width = 100, height = 70, data = new Uint8Array(width * height).fill(133);
  const map = new GameMapImpl(width, height, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
  const template = match.squads.find(s => s.playerId === 1)!;
  const squads = retainSquads(match, Array.from({ length: 160 }, (_, i) => ({
    ...template, id: match.allocateId(), playerId: 1 + (i % 4),
    x: Math.round((5.5 + (i % 16) * 2) * FIXED), y: Math.round((5.5 + Math.floor(i / 16) * 2) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  })));
  return { map, match, squads };
}

/** The pre-R2-P6 selection, kept verbatim as the oracle: the first priority
 * entry of the live pending map. */
function legacySelection(admission: MovementAdmission, priority: (playerId: number) => boolean): number | undefined {
  const pending = (admission as unknown as { pending: Map<number, { playerId: number }> }).pending;
  return [...pending].find(([, a]) => priority(a.playerId))?.[0];
}

interface Run { visits: string[]; requests: string[]; refusals: number }

function churn(seed: number, refuse: (tick: number, r: (n: number) => number) => boolean): Run {
  const { map, match, squads } = world(), random = lcg(seed);
  const priority = (playerId: number) => playerId % 2 === 1;
  const requested: { id: number; squadId: number; start: number; goal: number }[] = [];
  const run: Run = { visits: [], requests: [], refusals: 0 };
  let tick = 0;
  const admission = new MovementAdmission(map, match.paths, {
    squads: () => match.squads, priority, squad: id => match.squad(id),
    generation: () => 0, revision: () => "0", blocked: () => undefined,
    request: (id, _player, squadId, start, goal) => {
      if (refuse(tick, random)) { run.refusals++; run.requests.push(`${tick}:${id}:${squadId}:refused`); return false; }
      requested.push({ id, squadId, start, goal });
      run.requests.push(`${tick}:${id}:${squadId}`);
      return true;
    },
    cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true, commit: () => {},
  });
  admission.onVisit = (id, isPriority) => {
    if (isPriority) expect(id).toBe(legacySelection(admission, priority));
    run.visits.push(`${tick}:${isPriority ? "p" : "b"}:${id}`);
  };
  const byPlayer = (playerId: number) => squads.filter(s => s.playerId === playerId);
  const straight = (from: number, to: number) => {
    const path = [from];
    while (path[path.length - 1] !== to) {
      const at = path[path.length - 1], x = map.x(at), y = map.y(at);
      path.push(map.ref(x + Math.sign(map.x(to) - x), y + Math.sign(map.y(to) - y)));
    }
    return path;
  };
  for (; tick < 160; tick++) {
    // New orders, including replacements that supersede pending admissions.
    for (let n = random(4); n > 0; n--) {
      const playerId = 1 + random(4), own = byPlayer(playerId), first = random(own.length);
      const chosen: Squad[] = own.slice(first, first + 1 + random(14));
      admission.start(playerId, chosen, map.ref(40 + random(50), 10 + random(50)), tick);
    }
    // Finish a deterministic subset of the outstanding searches.
    for (const r of requested.splice(0)) {
      if (random(3) === 0) { requested.push(r); continue; }
      admission.completed(r.id, r.squadId, random(10) === 0 ? "limited" : "complete", straight(r.start, r.goal), tick);
    }
    admission.stepInteractive(tick, 8 + random(40));
    admission.step(tick, 8 + random(24));
    admission.stepInteractive(tick, random(16));
  }
  expect(run.visits.filter(v => v.includes(":p:")).length).toBeGreaterThan(500);
  return run;
}

describe("movement admission priority order (R2-P6)", () => {
  it("visits exactly the admission the legacy O(P^2) scan would pick", () => {
    for (const seed of [1, 7, 1272661902]) {
      const a = churn(seed, () => false), b = churn(seed, () => false);
      expect(a.visits).toEqual(b.visits);
      expect(a.requests.length).toBeGreaterThan(50);
    }
  });

  it("keeps the legacy order under planner refusals too", () => {
    churn(99, (_tick, r) => r(2) === 0);
  });
});
