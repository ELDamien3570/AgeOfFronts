import { describe, expect, it } from "vitest";
import { LocalTickSchedule } from "../../src/skirmish/LocalTickSchedule";

describe("local fixed tick pacing", () => {
  it("recovers a slow tick without adding its duration to every later deadline", () => {
    const clock = new LocalTickSchedule(50);
    clock.reset(0, 1);
    clock.advanced(125);
    expect(clock.delay(125)).toBe(0);
    clock.advanced(145);
    expect(clock.delay(145)).toBe(5);
    clock.advanced(170);
    expect(clock.delay(170)).toBe(30);
  });
  it("paces accelerated ticks individually and resets the anchor on resume", () => {
    const clock = new LocalTickSchedule(50);
    clock.reset(0, 4);
    expect(clock.delay(0)).toBe(12.5);
    clock.advanced(20);
    expect(clock.delay(20)).toBe(5);
    clock.reset(10000, 1);
    expect(clock.delay(10000)).toBe(50);
  });
  it("bounds suspended-tab debt to four ticks", () => {
    const clock = new LocalTickSchedule(50);
    clock.reset(0, 1);
    for (let i = 0; i < 5; i++) { clock.advanced(10000); expect(clock.delay(10000)).toBe(0); }
    clock.advanced(10000);
    expect(clock.delay(10000)).toBe(50);
  });
});
