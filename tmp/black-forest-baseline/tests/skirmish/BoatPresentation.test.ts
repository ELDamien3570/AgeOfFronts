import { describe, expect, it } from "vitest";
import { BoatPresentation } from "../../src/skirmish/client/BoatPresentation";
import { FIXED, type Snapshot } from "../../src/skirmish/Protocol";

function fixture() {
  const ship = { id: 1, x: 0, y: 0 };
  const trader = { id: 1, x: 0, y: 0, naval: true };
  const snapshot = {
    tick: 0,
    ships: [ship],
    expansion: { traders: [trader] },
  } as unknown as Snapshot;
  const presentation = new BoatPresentation();
  presentation.update(snapshot, 0);
  const update = (tick: number, now: number, x: number, y = 0) => {
    snapshot.tick = tick;
    ship.x = trader.x = x;
    ship.y = trader.y = y;
    presentation.update(snapshot, now);
  };
  const pose = (now: number, speed = 1, paused = false) => {
    presentation.frame(now, speed, paused);
    return { ...presentation.shipPose(1)! };
  };
  return { presentation, snapshot, ship, trader, update, pose };
}

describe("boat-only presentation", () => {
  it.each([50, 200])(
    "interpolates local/online %i ms samples without overshoot",
    (interval) => {
      const f = fixture();
      f.update(interval / 50, interval, 100);
      expect(f.pose(interval).x).toBe(0);
      expect(f.pose(interval * 1.5).x).toBeCloseTo(50);
      expect(f.pose(interval * 2).x).toBe(100);
      expect(f.pose(interval * 20).x).toBe(100);
    },
  );

  it.each([30, 60, 120])(
    "has continuous movement at %i presentation samples/sec",
    (hz) => {
      const f = fixture();
      let last = 0;
      for (let frame = 1; frame <= hz * 3; frame++) {
        const now = (frame * 1000) / hz;
        if (Math.floor((now + 0.001) / 200) > f.snapshot.tick / 4)
          f.update(
            Math.floor((now + 0.001) / 200) * 4,
            now,
            Math.floor((now + 0.001) / 200) * 100,
          );
        const x = f.pose(now).x;
        expect(x).toBeGreaterThanOrEqual(last);
        if (now > 600) expect(x - last).toBeCloseTo(500 / hz, 4);
        last = x;
      }
    },
  );

  it("does not rewind or restart on duplicate packets", () => {
    const f = fixture();
    f.update(4, 200, 100);
    expect(f.pose(300).x).toBe(50);
    f.update(4, 300, 100);
    expect(f.pose(300).x).toBe(50);
    expect(f.pose(400).x).toBe(100);
    f.update(8, 400, 200);
    expect(f.pose(500).x).toBeCloseTo(150);
  });

  it("retargets early packets from the displayed pose without a jump", () => {
    const f = fixture();
    f.update(4, 200, 100);
    const before = f.pose(350);
    f.update(8, 350, 200);
    expect(f.pose(350)).toEqual(before);
    expect(f.pose(400).x).toBeGreaterThan(before.x);
    expect(f.pose(600).x).toBe(200);
  });

  it("takes the short arc across the angle wrap and retains stopped heading", () => {
    const f = fixture();
    f.update(4, 200, -100, 1);
    const first = f.pose(400).angle;
    f.update(8, 400, -200, -1);
    const second = f.pose(600).angle;
    expect(Math.abs(second - first)).toBeLessThan(0.04);
    f.update(12, 600, -200, -1);
    expect(f.pose(800).angle).toBeCloseTo(second);
    expect(f.pose(800).moving).toBe(false);
  });

  it("settles on pause without rewinding on a quick resume", () => {
    const f = fixture();
    f.update(4, 200, 100);
    expect(f.pose(250).x).toBe(25);
    expect(f.pose(260, 1, true).x).toBe(100);
    expect(f.pose(270).x).toBe(100);
    f.update(8, 400, 200);
    expect(f.pose(500).x).toBeCloseTo(150);
  });

  it("snaps discontinuities and same-tick position corrections", () => {
    const f = fixture();
    f.update(4, 200, 100);
    f.update(8, 400, 20 * FIXED);
    expect(f.pose(400).x).toBe(20 * FIXED);
    f.update(8, 410, 21 * FIXED);
    expect(f.pose(410).x).toBe(21 * FIXED);
    f.update(40, 5000, 22 * FIXED);
    expect(f.pose(5000).x).toBe(22 * FIXED);
  });

  it("cleans up deaths, spawns, reused IDs and backwards-tick/new-game resets", () => {
    const f = fixture();
    f.update(4, 200, 100);
    f.snapshot.ships = [];
    f.snapshot.expansion!.traders = [];
    f.presentation.update(f.snapshot, 250);
    expect(f.presentation.shipPose(1)).toBeUndefined();
    expect(f.presentation.traderPose(1)).toBeUndefined();
    f.snapshot.ships = [f.ship as Snapshot["ships"][number]];
    f.presentation.update(f.snapshot, 260);
    expect(f.pose(260)).toMatchObject({ x: 100, angle: 0 });
    f.update(0, 270, 0);
    expect(f.pose(270)).toMatchObject({ x: 0, angle: 0 });
    f.presentation.reset();
    expect(f.presentation.shipPose(1)).toBeUndefined();
  });

  it("keeps ship/trader IDs separate and ignores land traders", () => {
    const f = fixture();
    f.trader.x = 500;
    f.snapshot.tick = 4;
    f.presentation.update(f.snapshot, 200);
    f.presentation.frame(400, 1, false);
    expect(f.presentation.shipPose(1)?.x).toBe(0);
    expect(f.presentation.traderPose(1)?.x).toBe(500);
    f.trader.naval = false;
    f.presentation.update(f.snapshot, 401);
    expect(f.presentation.traderPose(1)).toBeUndefined();
  });

  it.each([1, 2, 4])(
    "advances cosmetic loops across 200 ms packets at %ix without the old 50 ms freeze",
    (speed) => {
      const f = fixture();
      f.presentation.frame(0, speed, false);
      expect(f.presentation.frame(150, speed, false)).toBeCloseTo(3 * speed);
      f.update(4 * speed, 200, 100 * speed);
      expect(f.presentation.frame(350, speed, false)).toBeCloseTo(7 * speed);
    },
  );

  it("stops loops on stall, pause and suspended-tab return", () => {
    const f = fixture();
    expect(f.presentation.frame(300, 1, false)).toBe(6);
    expect(f.presentation.frame(5000, 1, false)).toBe(6);
    f.update(100, 10000, 100);
    expect(f.presentation.frame(10000, 1, false)).toBe(6);
    expect(f.presentation.frame(10050, 1, false)).toBe(7);
    expect(f.presentation.frame(10100, 1, true)).toBe(7);
    expect(f.presentation.frame(10150, 1, true)).toBe(7);
    f.presentation.frame(10200, 1, false);
    expect(f.presentation.frame(10250, 1, false)).toBe(8);
  });

  it("does not mutate snapshots and reuses pose objects", () => {
    const f = fixture();
    f.snapshot.tick = 4;
    f.ship.x = 100;
    const before = JSON.stringify(f.snapshot);
    f.presentation.update(f.snapshot, 200);
    const pose = f.presentation.shipPose(1);
    f.pose(300);
    expect(f.presentation.shipPose(1)).toBe(pose);
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });
});
