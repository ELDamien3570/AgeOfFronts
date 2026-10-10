import { describe, expect, it } from "vitest";
import { AiLossWindow } from "../../src/skirmish/domain/AiLossWindow";
describe("recent military replacement pressure", () => {
  it("does not turn lifetime human/AI losses into perpetual recruitment", () => {
    const history = new AiLossWindow();
    expect(history.sample(1, 0, 10000)).toBe(0);
    expect(history.sample(1, 60, 11000)).toBe(1000);
    expect(history.sample(1, 120, 11000)).toBe(1000);
    const clone = new AiLossWindow();
    clone.restore(history.checkpoint());
    expect(clone.sample(1, 2460, 11000)).toBe(0);
    expect(history.sample(1, 2460, 11000)).toBe(0);
    history.release(1);
    expect(history.sample(1, 2500, 100000)).toBe(0);
  });
  it("bounds frequent samples and retains deterministic aggregate pressure", () => {
    const history = new AiLossWindow();
    history.sample(2, 0, 0);
    for (let tick = 1; tick <= 200; tick++)
      expect(history.sample(2, tick, tick)).toBe(tick);
    expect(history.checkpoint()[0][1].samples.length).toBeLessThanOrEqual(48);
  });
  it("expires old losses during continuous combat without rolling them forward", () => {
    const history = new AiLossWindow();
    history.sample(2, 0, 0);
    for (let tick = 1; tick <= 7200; tick++) {
      const pressure = history.sample(2, tick, tick);
      if (tick >= 2400) {
        expect(pressure).toBeGreaterThanOrEqual(2351);
        expect(pressure).toBeLessThanOrEqual(2400);
        expect(history.checkpoint()[0][1].samples.length).toBeLessThanOrEqual(
          48,
        );
      }
    }
    expect(history.sample(2, 9600, 7200)).toBe(0);
  });
});
