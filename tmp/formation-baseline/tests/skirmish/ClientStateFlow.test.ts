import { describe, expect, it } from "vitest";
import { ClientStateFlow } from "../../src/skirmish/multiplayer/application/ClientStateFlow";

describe("client publication credit epochs", () => {
  it("replaces an in-flight recovery with a join baseline and rejects the old credit", () => {
    const flow = new ClientStateFlow(1);
    expect(flow.offer(10)).toBe(true);
    expect(flow.offer(11)).toBe(false);
    expect(flow.applied(10, flow.epoch)).toBe("baseline");
    expect(flow.beginBaseline()).toBe(true);
    const captureEpoch = flow.epoch;
    expect(flow.beginBaseline()).toBe(false);
    expect(flow.beginBaseline(true)).toBe(true);
    flow.baseline(20, false);
    expect(flow.epoch).not.toBe(captureEpoch);
    expect(flow.applied(20, captureEpoch)).toBe("ignored");
    expect(flow.pending).toBe(20);
    expect(flow.applied(20, flow.epoch)).toBe("credit");
    expect(flow.offer(21)).toBe(true);
  });
  it("requires another baseline when the simulation advances during capture", () => {
    const flow = new ClientStateFlow();
    flow.beginBaseline();
    flow.baseline(5, true);
    expect(flow.applied(5, flow.epoch)).toBe("baseline");
  });
  it("absorbs four frames but never resumes deltas after skipping the fifth", () => {
    const flow = new ClientStateFlow();
    for (let sequence = 1; sequence <= 4; sequence++)
      expect(flow.offer(sequence)).toBe(true);
    expect(flow.offer(5)).toBe(false);
    expect(flow.applied(2, flow.epoch)).toBe("credit");
    expect(flow.offer(6)).toBe(false);
    expect(flow.applied(4, flow.epoch)).toBe("baseline");
    expect(flow.beginBaseline()).toBe(true);
    flow.baseline(7, false);
    expect(flow.applied(7, flow.epoch)).toBe("credit");
    expect(flow.offer(8)).toBe(true);
  });
  it("rejects unsent and duplicate credits and retains missed publications during capture", () => {
    const flow = new ClientStateFlow();
    flow.offer(1);
    flow.offer(2);
    expect(flow.applied(3, flow.epoch)).toBe("ignored");
    expect(flow.applied(1, flow.epoch)).toBe("credit");
    expect(flow.applied(1, flow.epoch)).toBe("ignored");
    flow.beginBaseline();
    expect(flow.offer(3)).toBe(false);
    flow.baseline(4, false);
    expect(flow.applied(4, flow.epoch)).toBe("baseline");
  });
});
