import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "../../src/skirmish/multiplayer/Protocol";

describe("thin-client multiplayer protocol", () => {
  it("accepts readiness without host benchmarking", () => {
    expect(
      clientMessageSchema.parse({
        type: "match-ready",
        requestId: "ready",
        matchId: "match",
        runtimeId: "version",
      }),
    ).toMatchObject({ type: "match-ready" });
  });
  it("never accepts browser host authority or simulation proposals", () => {
    for (const type of [
      "host-ready",
      "host-commit",
      "host-restore",
      "host-batch",
    ])
      expect(
        clientMessageSchema.safeParse({
          type,
          requestId: "request",
          matchId: "match",
          epoch: 1,
          tick: 0,
          hash: "0".repeat(64),
          proposal: {},
        }).success,
      ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "match-ready",
        requestId: "ready",
        matchId: "match",
        runtimeId: "version",
        tickP95Ms: 1,
      }).success,
    ).toBe(false);
  });
});
