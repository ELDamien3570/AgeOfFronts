import { describe, expect, it } from "vitest";
import { CombatPresentationTimeline } from "../../src/skirmish/client/CombatPresentationTimeline";
import {
  BattleLabModel,
  type BattleEntry,
} from "../../src/skirmish/client/lab/BattleLabModel";
import { TICK_MS, type Snapshot } from "../../src/skirmish/Protocol";
import {
  SnapshotDecoder,
  SnapshotEncoder,
  snapshotTransfers,
} from "../../src/skirmish/SnapshotCodec";
import {
  packSnapshotDetails,
  validateSnapshotDetails,
} from "../../src/skirmish/SnapshotDetails";

function firstLoss() {
  const entries: BattleEntry[] = [
    {
      side: 1,
      definitionId: "bronzeage-infantry",
      formations: 1,
      soldiers: 24,
      variant: "base",
      shape: "mass",
      tuning: { melee: { damage: 1, rangeTiles: 0.05 } },
    },
    {
      side: 2,
      definitionId: "stoneage-infantry",
      formations: 1,
      soldiers: 12,
      variant: "base",
      shape: "mass",
      tuning: { melee: { damage: 1, rangeTiles: 0.05 } },
    },
  ];
  const model = new BattleLabModel(entries, 8);
  model.start();
  for (let i = 0; i < 100; i++) {
    const before = model.game.snapshot();
    model.step();
    const after = model.game.snapshot();
    if (after.squads.reduce((n, s) => n + s.troops, 0) < 36)
      return { before, after };
  }
  throw Error("Expected the real battle to reach contact");
}
describe("shared combat presentation timeline", () => {
  it('bounds sparse-publication catch-up without applying the endpoint casualties early',()=>{
    const {before,after}=firstLoss(),timeline=new CombatPresentationTimeline();
    timeline.update(before);timeline.sample(0,1,false);
    timeline.update({...after,tick:before.tick+16});
    const frame=timeline.sample(1,1,false)!;
    expect(frame.tick).toBeGreaterThanOrEqual(before.tick+16-600/TICK_MS);
    expect(frame.snapshot.squads.map(s=>s.troops)).toEqual(before.squads.map(s=>s.troops));
  });
  it("preserves exact terminal movement roots through full/delta transferable snapshots", () => {
    const { before, after } = firstLoss(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(before));
    const packet = encoder.encode(after);
    const decoded = decoder.decode(
      structuredClone(packet, { transfer: snapshotTransfers(packet) }),
    );
    expect(decoded.volleys).toEqual(after.volleys);
    expect(decoded.volleys.some((v) => v.combatRoots)).toBe(true);
    const details = packSnapshotDetails(
      after.squads,
      after.buildings,
      after.ships,
      after.volleys,
    );
    expect(() =>
      validateSnapshotDetails({
        ...details,
        volleyRoots: new Float64Array([999999, 0, 0, 0, 0]),
      }),
    ).toThrow("roots");
    const malformed = details.volleyRoots!.slice();
    malformed[1] = NaN;
    expect(() =>
      validateSnapshotDetails({ ...details, volleyRoots: malformed }),
    ).toThrow("roots");
  });
  it("moves a completely destroyed unit to its recorded death position before retiring it", () => {
    const { before } = firstLoss(),
      victim = before.squads[0],
      attacker = before.squads[1];
    const roots = {
      sourceX: attacker.x,
      sourceY: attacker.y,
      targetX: victim.x + 100,
      targetY: victim.y,
    };
    const after = {
      ...before,
      tick: before.tick + 1,
      squads: before.squads.slice(1),
      volleys: [
        {
          id: 999,
          tick: before.tick + 1,
          squadId: attacker.id,
          playerId: attacker.playerId,
          targetId: victim.id,
          fromX: attacker.x,
          fromY: attacker.y,
          toX: victim.x + 100,
          toY: victim.y,
          melee: true,
          damage: 10000,
          combatRoots: roots,
        },
      ],
    };
    const timeline = new CombatPresentationTimeline();
    timeline.update(before);
    timeline.sample(0, 1, false);
    timeline.update(after);
    const half = timeline.sample(TICK_MS / 2, 1, false)!;
    expect(half.snapshot.squads[0].x).toBe(victim.x + 50);
    expect(half.snapshot.squads[0].troops).toBe(victim.troops);
    expect(
      timeline
        .sample(TICK_MS, 1, false)!
        .snapshot.squads.some((s) => s.id === victim.id),
    ).toBe(false);
  });
  it("retains living ranks and old strikes until movement reaches the damaging endpoint", () => {
    const { before, after } = firstLoss(),
      timeline = new CombatPresentationTimeline();
    timeline.update(before);
    timeline.sample(0, 1, true);
    timeline.sample(0, 1, false);
    timeline.update(after);
    const half = timeline.sample(TICK_MS / 2, 1, false)!;
    expect(half.snapshot.squads.map((s) => s.troops)).toEqual(
      before.squads.map((s) => s.troops),
    );
    for (const [i, squad] of half.snapshot.squads.entries()) {
      expect(squad.x).toBeCloseTo((before.squads[i].x + after.squads[i].x) / 2);
      expect(squad.meleeStrike).toEqual(before.squads[i].meleeStrike);
    }
    const impact = timeline.sample(TICK_MS, 1, false)!;
    expect(impact.snapshot).toBe(after);
    expect(impact.tick).toBe(after.tick);
    expect(impact.snapshot.squads.reduce((n, s) => n + s.troops, 0)).toBeLessThan(
      half.snapshot.squads.reduce((n, s) => n + s.troops, 0),
    );
  });
  it("keeps a destroyed squad on its approach until its terminal state is reached", () => {
    const { before } = firstLoss(),
      timeline = new CombatPresentationTimeline();
    const gone = {
      ...before,
      tick: before.tick + 1,
      squads: before.squads.slice(1),
    };
    timeline.update(before);
    timeline.sample(0, 1, false);
    timeline.update(gone);
    expect(
      timeline.sample(TICK_MS - 1, 1, false)!.snapshot.squads,
    ).toHaveLength(2);
    expect(timeline.sample(TICK_MS, 1, false)!.snapshot.squads).toHaveLength(1);
  });
  it("uses the same cached frame for the actors and renderer, with speed and pause sharing the endpoint", () => {
    const { before, after } = firstLoss(),
      timeline = new CombatPresentationTimeline();
    timeline.update(before);
    timeline.sample(0, 1, false);
    timeline.update(after);
    const a = timeline.sample(TICK_MS / 4, 2, false)!;
    expect(timeline.sample(TICK_MS / 4, 2, false)).toBe(a);
    expect(a.tick).toBe(before.tick + 0.5);
    const paused = timeline.sample(TICK_MS / 4, 2, true)!;
    expect(paused.snapshot).toBe(after);
    expect(timeline.sample(10000, 1, false)!.tick).toBe(after.tick);
  });
  it("accepts same-tick order publications, bounds history and clears a new match", () => {
    const { before } = firstLoss(),
      timeline = new CombatPresentationTimeline();
    timeline.update(before);
    const replaced = { ...before, localPlayerId: 2 };
    timeline.update(replaced);
    expect(timeline.sample(0, 1, true)!.source).toBe(replaced);
    for (let i = 1; i <= 50; i++)
      timeline.update({ ...before, tick: before.tick + i });
    expect(timeline.sample(0, 1, false)!.tick).toBeGreaterThanOrEqual(
      before.tick + 47,
    );
    timeline.clear();
    expect(timeline.sample(0, 1, false)).toBeUndefined();
    timeline.update({ ...before, tick: 0 } as Snapshot);
    expect(timeline.sample(0, 1, false)!.tick).toBe(0);
  });
});
