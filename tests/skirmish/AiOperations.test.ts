import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { FIXED } from "../../src/skirmish/Protocol";

function fixture(enabled = true, count = 3) {
  const cells = new Uint8Array(160 * 96).fill(133), map = new GameMapImpl(160, 96, cells, cells.length);
  const m = new Skirmish(map, { seed: 47, aiCount: count, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: enabled });
  for (const p of m.players) { p.base = map.ref(20 + (p.id % 8) * 15, 30 + Math.floor(p.id / 8) * 20); p.personalityId = "balanced"; }
  // Readiness now requires real healthy troops and logistics, rather than
  // accepting the synthetic candidate-count input as a physical roster.
  for(const player of m.players){const template=m.squads.find(s=>s.playerId===player.id)!;player.reserves=2000;for(let i=1;i<12;i++)m.addSquad({...structuredClone(template),id:m.allocateId(),x:(map.x(player.base)+(i%4))*FIXED,y:(map.y(player.base)+Math.floor(i/4))*FIXED});}
  return { m, map, ops: m.expansion!.operations, forces: new Map(m.players.map(p => [p.id, 12])) };
}
function evaluate(f: ReturnType<typeof fixture>, tick: number) { f.m.tick = tick; f.ops.step(f.forces); }

describe("optional AI strategic operations", () => {
  it("shares footprint reads only within routing and invalidates ownership and permission changes", () => {
    const f=fixture(), tile=f.map.ref(90,80), near=f.map.ref(87,80);
    const internal=f.m as unknown as {aiFootprintAllowed(id:number,tile:number):boolean;changeOwner(tile:number,id:number):void;drainRoutes():void};
    const enter=vi.spyOn(f.ops,"canEnter");
    const step=vi.spyOn(f.m.routePlanner,"step").mockImplementation(()=>{
      expect(internal.aiFootprintAllowed(2,near)).toBe(true);
      const calls=enter.mock.calls.length;
      expect(internal.aiFootprintAllowed(2,near)).toBe(true);
      expect(enter.mock.calls.length).toBe(calls);
      internal.changeOwner(tile,1);
      expect(internal.aiFootprintAllowed(2,near)).toBe(false);
      f.m.notifyHostileAction(2,1,tile);
      expect(internal.aiFootprintAllowed(2,near)).toBe(true);
      // Refreshing an existing threat changes entry permission even though it
      // deliberately does not supersede all outstanding route jobs.
      f.ops.threatened(2,1,f.map.ref(140,80));
      expect(internal.aiFootprintAllowed(2,near)).toBe(false);
      return 0;
    });
    internal.drainRoutes(); step.mockRestore();
    internal.changeOwner(tile,3);
    expect(internal.aiFootprintAllowed(2,near)).toBe(false);
    expect(internal.aiFootprintAllowed(1,near)).toBe(true);
  });
  it("prepares one geographic offensive target, declares once, and recovers after losses", () => {
    const f = fixture(); evaluate(f, 1200); evaluate(f, 1260);
    const state = f.ops.state(2)!;
    expect(state.phase).toBe("preparing"); expect(state.target).toBeDefined();
    expect(f.ops.canTarget(2, state.target!)).toBe(false);
    evaluate(f, 1659); expect(f.ops.state(2)!.phase).toBe("preparing");
    evaluate(f, 1720); expect(f.ops.state(2)!.phase).toBe("war");
    const target = f.ops.state(2)!.target!;
    expect(f.ops.canTarget(2, target)).toBe(true);
    expect(f.ops.canTarget(2, f.m.players.find(p => p.id !== 2 && p.id !== target)!.id)).toBe(false);
    expect(f.m.expansion!.events.filter(e => e.actorId === 2 && e.action === "declare")).toHaveLength(1);
    evaluate(f, 1740); f.forces.set(2, 1); evaluate(f, 1760);
    expect(f.ops.state(2)!.phase).toBe("recovery"); expect(f.ops.canTarget(2, target)).toBe(false);
    const saved = f.m.checkpoint(); f.m.restore(saved); expect(f.m.checkpoint()).toEqual(saved);
    evaluate(f, 2300); expect(f.ops.state(2)!.phase).toBe("recovery");
    evaluate(f, 2400); expect(f.ops.state(2)!.phase).toBe("peace");
  });
  it("wakes only invaded/damaged factions, supports multiple aggressors and remembers border hopping", () => {
    const f = fixture(), a = f.m.squads.find(s => s.playerId === 2)!, b = f.m.squads.find(s => s.playerId === 3)!;
    const damage = new DamageLedger(); damage.add(a.id, 1, 10); damage.add(a.id, 4, 10);
    f.m.resolveLandDamage(damage);
    expect(a.troops).toBe(980); expect(b.troops).toBe(1000);
    expect(f.ops.state(3)).toBeUndefined(); expect(f.ops.canTarget(2, 1)).toBe(true); expect(f.ops.canTarget(2, 4)).toBe(true);
    const tile = f.m.tileOf(a);
    expect(f.ops.canEnter(2, 1, tile)).toBe(true);
    expect(f.ops.canEnter(2, 1, f.map.ref(150, 80))).toBe(false);
    evaluate(f, 599); expect(f.ops.canTarget(2, 1)).toBe(true);
    f.m.notifyHostileAction(2, 1, tile); evaluate(f, 700);
    expect(f.ops.canTarget(2, 1)).toBe(true); expect(f.ops.canTarget(2, 4)).toBe(false);
    evaluate(f, 1200); expect(f.ops.canTarget(2, 1)).toBe(false);
  });
  it("detects capture-radius invasion before ownership changes and ignores allies", () => {
    const f = fixture(), s = f.m.squads.find(s => s.playerId === 1)!;
    const tile = f.map.ref(80, 80); f.m.owners.fill(0); f.m.owners[tile] = 2;
    f.m.updateSquad(s.id, { x: (f.map.x(tile) - 2) * FIXED + FIXED / 2 }); f.m.updateSquad(s.id, { y: f.map.y(tile) * FIXED + FIXED / 2 });
    (f.m as unknown as {capture(): void}).capture();
    expect(f.m.owners[tile]).toBe(2); expect(f.ops.canTarget(2, 1)).toBe(true);
    f.m.expansion!.diplomacy.state.alliances.push({id: 100,a: 2,b: 3,expiresTick: 6000,renewal:[]});
    f.m.notifyHostileAction(2, 3, tile); expect(f.ops.canTarget(2, 3)).toBe(false);
  });
  it("checks the capture footprint and route interior while leaving human move/capture legal", () => {
    const f = fixture(), tile = f.map.ref(90, 80), near = f.map.ref(87, 80);
    f.m.owners.fill(0); for (let y = 0; y < 96; y++) f.m.owners[f.map.ref(90,y)] = 1;
    const internal = f.m as unknown as { obstacleTest(id: number): (tile: number) => boolean; aiFootprintAllowed(id:number,tile:number):boolean };
    expect(internal.aiFootprintAllowed(2, near)).toBe(false);
    expect(internal.aiFootprintAllowed(1, near)).toBe(true);
    expect(f.m.paths.find(f.map.ref(85,80), f.map.ref(95,80), internal.obstacleTest(2))).toBeNull();
    expect(f.m.paths.find(f.map.ref(85,80), f.map.ref(95,80), internal.obstacleTest(1))).not.toBeNull();
    f.m.notifyHostileAction(2, 1, tile); expect(internal.aiFootprintAllowed(2, near)).toBe(true);
    f.m.setAiController(2, false); expect(f.ops.state(2)).toBeUndefined();
    expect(internal.aiFootprintAllowed(2, f.map.ref(90,20))).toBe(true);
  });
  it("keeps disabled policy inert and bounds strategic candidate work", () => {
    const off = fixture(false); evaluate(off, 5000); off.m.notifyHostileAction(2, 1, 100);
    expect(off.ops.checkpoint().records).toEqual([]); expect(off.ops.canTarget(2, 1)).toBe(true);
    const f = fixture(true, 14); evaluate(f, 1200);
    for (let tick = 1300; tick < 1400; tick++) { evaluate(f, tick); expect(f.ops.workUsed).toBeLessThanOrEqual(16); }
    expect(f.ops.checkpoint().records).toHaveLength(14);
  });
});
