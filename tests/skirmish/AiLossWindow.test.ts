import {secondsToTicks} from '../../src/skirmish/Protocol';
import { describe, expect, it } from "vitest";
import { AiLossWindow } from "../../src/skirmish/domain/AiLossWindow";
describe("recent military replacement pressure", () => {
  it("does not turn lifetime human/AI losses into perpetual recruitment", () => {
    const history = new AiLossWindow();
    expect(history.sample(1, 0, 10000)).toBe(0);
    expect(history.sample(1, secondsToTicks(3), 11000)).toBe(1000);
    expect(history.sample(1, secondsToTicks(6), 11000)).toBe(1000);
    const clone = new AiLossWindow();
    clone.restore(history.checkpoint());
    expect(clone.sample(1, secondsToTicks(123), 11000)).toBe(0);
    expect(history.sample(1, secondsToTicks(123), 11000)).toBe(0);
    history.release(1);
    expect(history.sample(1, secondsToTicks(125), 100000)).toBe(0);
  });
  it("bounds frequent samples and retains deterministic aggregate pressure", () => {
    const history = new AiLossWindow();
    history.sample(2, 0, 0);
    for (let tick = 1; tick <= secondsToTicks(10); tick++)
      expect(history.sample(2, tick, tick)).toBe(tick);
    expect(history.checkpoint()[0][1].samples.length).toBeLessThanOrEqual(48);
  });
  it("expires old losses during continuous combat without rolling them forward", () => {
    const history = new AiLossWindow();
    history.sample(2, 0, 0);
    for (let tick = 1; tick <= secondsToTicks(360); tick++) {
      const pressure = history.sample(2, tick, tick);
      if (tick >= secondsToTicks(120)) {
        expect(pressure).toBeGreaterThanOrEqual(secondsToTicks(117.55));
        expect(pressure).toBeLessThanOrEqual(secondsToTicks(120));
        expect(history.checkpoint()[0][1].samples.length).toBeLessThanOrEqual(
          48,
        );
      }
    }
    expect(history.sample(2, secondsToTicks(480), secondsToTicks(360))).toBe(0);
  });
});
