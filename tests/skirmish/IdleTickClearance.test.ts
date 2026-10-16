import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CombatGeometry } from "../../src/skirmish/domain/CombatGeometry";
import { createFormation, formationEnvelope } from "../../src/skirmish/domain/FormationGeometry";
import { transportHandoff } from "../../src/skirmish/domain/TransportHandoff";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { checkpointDigest, idleTickFixture, IDLE_TICK_FIXTURE_TICKS, IDLE_TICK_GOLDEN, squadDigest } from "./fixtures/IdleTickFixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Roadmap Next #2, I-2: cheaper clearance for moving squads, hash-identical.
const shoreGame = () => {
  // Water on the left third, land elsewhere (133 = land, 0 = water).
  const w = 48, h = 32, cells = new Uint8Array(w * h).fill(133);
  for (let y = 0; y < h; y++) for (let x = 0; x < 16; x++) cells[y * w + x] = 0;
  return new Skirmish(new GameMapImpl(w, h, cells, 0), { seed: 5, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
};

describe("I-2 (a): land-only transport fast path", () => {
  it("equals transportHandoff's ground result for land bodies stepping onto land", () => {
    const g = shoreGame(), sim = g as any, random = new PseudoRandom(91);
    const squads = g.squads.filter(s => s.embarkedOn === null && !s.afloat);
    expect(squads.length).toBeGreaterThan(0);
    let ground = 0, other = 0;
    for (let i = 0; i < 400; i++) {
      const s = squads[random.nextInt(0, squads.length)];
      const end = { x: random.nextInt(0, 48 * FIXED), y: random.nextInt(0, 32 * FIXED) };
      const tile = g.map.ref(Math.floor(end.x / FIXED), Math.floor(end.y / FIXED));
      const before = sim.idleTickWork.groundProposals;
      const fast = sim.transportProposal(s, end);
      if (g.map.isLand(tile)) {
        ground++;
        expect(sim.idleTickWork.groundProposals).toBe(before + 1);
        // The slow path, evaluated directly: identical result.
        expect(fast).toEqual(transportHandoff(s, end, false, g.transportVessel(s.playerId), () => true));
        expect(fast).toEqual({ kind: "ground" });
      } else {
        other++;
        expect(sim.idleTickWork.groundProposals).toBe(before);
      }
    }
    expect(ground).toBeGreaterThan(50);
    expect(other).toBeGreaterThan(50);
  });
});

describe("I-2 (b): envelope reads that previously always missed", () => {
  const troop = (s: Squad, formation = createFormation(s.definitionId)): Squad => ({ ...s, formation });
  it("alternating tick and tick+1 reads of a transitioning squad equal fresh reads", () => {
    const g = shoreGame(), base = g.squads.find(s => s.embarkedOn === null)!;
    const formation = createFormation(base.definitionId);
    const s = troop(base, { ...formation, transition: { from: "line", fromFacing: 90, startTick: 10, duration: 8 } });
    const geometry = new CombatGeometry();
    for (let tick = 10; tick < 18; tick++)
      for (const time of [tick, tick + 1, tick, tick + 1]) {
        expect(geometry.envelope(s, time)).toEqual(formationEnvelope(s, time));
        expect(new CombatGeometry().envelope(s, time)).toEqual(geometry.envelope(s, time));
      }
    expect(geometry.telemetry.alternateReuses).toBeGreaterThan(0);
    // A moved root invalidates a positional (fromSlots) alternate.
    const slots = { ...s, formation: { ...s.formation!, transition: { ...s.formation!.transition!, fromSlots: [{ x: 0, y: 0, row: 0 }] } } } as Squad;
    const p = new CombatGeometry();
    p.envelope(slots, 10); p.envelope(slots, 11);
    const moved = { ...slots, x: slots.x + 3 * FIXED };
    expect(p.envelope(moved, 10)).toEqual(new CombatGeometry().envelope(moved, 10));
  });
  it("settledEnvelope equals the envelope of the spread completed pose", () => {
    const g = shoreGame(), base = g.squads.find(s => s.embarkedOn === null)!;
    const formation = { ...createFormation(base.definitionId), transition: { from: "line" as const, fromFacing: 0, startTick: 3, duration: 5 } };
    let s = troop(base, formation);
    const geometry = new CombatGeometry(), fresh = () => new CombatGeometry().envelope({ ...s, formation: { ...s.formation!, transition: undefined } }, 7);
    expect(geometry.settledEnvelope(s, 7)).toEqual(fresh());
    expect(geometry.settledEnvelope(s, 7)).toEqual(fresh());
    expect(geometry.telemetry.settledReuses).toBe(1);
    s = { ...s, troops: Math.max(1, s.troops - 3) };
    expect(geometry.settledEnvelope(s, 7)).toEqual(fresh());
    s = { ...s, formation: { ...s.formation!, facing: 45, revision: s.formation!.revision + 1 } };
    expect(geometry.settledEnvelope(s, 7)).toEqual(fresh());
    expect(geometry.telemetry.settledReuses).toBe(1);
    const plain = troop(base);
    expect(geometry.settledEnvelope(plain, 7)).toEqual(new CombatGeometry().envelope(plain, 7));
  });
  it("reduces envelope recomputation on the idle-tick fixture without changing the squad hash", () => {
    const g = idleTickFixture(), geometry = (g as any).facingGeometry as CombatGeometry;
    for (let i = 0; i < IDLE_TICK_FIXTURE_TICKS; i++) g.step();
    expect(squadDigest(g.squads)).toBe(IDLE_TICK_GOLDEN.squads);
    expect(checkpointDigest(g)).toBe(IDLE_TICK_GOLDEN.checkpoint);
    const t = geometry.telemetry;
    // Baseline (aof/next-1 bc7c7882): 11,219 builds + 16,719 projected reuses
    // = 27,938 recomputations out of 116,491 reads.
    expect(t.envelopeReads).toBe(116491);
    expect(t.alternateReuses).toBeGreaterThan(0);
    expect(t.settledReuses).toBeGreaterThan(1000);
    expect(t.envelopeBuilds + t.projectedReuses).toBeLessThan(26000);
  }, 120_000);
});
