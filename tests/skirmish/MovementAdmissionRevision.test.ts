import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { MovementAdmission, type MovementAdmissionPorts } from "../../src/skirmish/MovementAdmission";

function fixture(human = false) {
  const map = new GameMapImpl(100, 70, new Uint8Array(7000).fill(133), 7000);
  const game = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false });
  const squad = game.squads[0], revision = { value: "initial" }, blocked = new Set<number>();
  let reads = 0;
  const ports: MovementAdmissionPorts = {
    squads: () => [squad], squad: id => id === squad.id ? squad : undefined,
    generation: () => 0, revision: () => revision.value, priority: () => human,
    blocked: () => tile => { reads++; return blocked.has(tile); },
    request: vi.fn(() => true), cancel: vi.fn(), queue: vi.fn(),
    clear: () => true, destinationValid: () => true, commit: vi.fn(),
  };
  const admission = new MovementAdmission(map, game.paths, ports);
  const id = admission.start(squad.playerId, [squad], map.ref(75, 50), 0);
  for (let tick = 0; tick < 100 && !vi.mocked(ports.request).mock.calls.length; tick++) admission.step(tick, 64);
  expect(ports.request).toHaveBeenCalled();
  return { map, game, squad, ports, admission, id, revision, blocked, reads: () => reads };
}

describe("movement permission revision revalidation", () => {
  it("retains an in-flight AI route across unrelated permission revisions", () => {
    const f = fixture();
    for (let tick = 1; tick <= 10; tick++) {
      f.revision.value = `revision-${tick}`;
      expect(f.admission.step(tick, 4)).toBeLessThanOrEqual(4);
      const pending = f.admission.checkpoint().pending[0][1];
      expect(pending.phase).toBe("routes");
      expect(pending.members[0].requested).toBe(true);
      expect(pending.revision).toBe(f.revision.value);
    }
    expect(f.ports.cancel).not.toHaveBeenCalled();
    expect(f.ports.request).toHaveBeenCalledTimes(1);
  });

  for (const human of [false, true]) it(`bounds completed-route validation and restores its cursor (${human ? "human" : "AI"})`, () => {
    const f = fixture(human), path = Array.from({ length: 1000 }, () => f.map.ref(10, 10));
    f.admission.completed(f.id, f.squad.id, "complete", path, 0);
    f.revision.value = "new-mask";
    expect(f.admission.step(1, 1)).toBe(1);
    expect(f.admission.step(2, 1)).toBe(1);
    const saved = f.admission.checkpoint();
    expect(saved.pending[0][1].routeCheck?.cursor).toBe(63);
    const restored = new MovementAdmission(f.map, f.game.paths, f.ports);
    restored.restore(saved);
    for (let tick = 3; tick < 20; tick++) {
      const before = f.reads();
      expect(f.admission.step(tick, 1)).toBeLessThanOrEqual(1);
      expect(f.reads() - before).toBeLessThanOrEqual(64 * 3);
      expect(restored.step(tick, 1)).toBeLessThanOrEqual(1);
      expect(restored.checkpoint()).toEqual(f.admission.checkpoint());
    }
    expect(f.admission.checkpoint().pending[0][1].revision).toBe("new-mask");
    expect(f.ports.cancel).not.toHaveBeenCalled();
  });

  it("checks diagonal corner permissions across a validation quantum boundary", () => {
    const f = fixture(), path = Array.from({ length: 63 }, () => f.map.ref(10, 10));
    path.push(f.map.ref(11, 11));
    f.admission.completed(f.id, f.squad.id, "complete", path, 0);
    f.blocked.add(f.map.ref(11, 10)); f.revision.value = "corner-blocked";
    for (let tick = 1; tick <= 3; tick++) expect(f.admission.step(tick, 1)).toBe(1);
    expect(f.admission.checkpoint().pending[0][1].members[0].path).toBeUndefined();
    expect(f.ports.commit).not.toHaveBeenCalled();
  });
});
