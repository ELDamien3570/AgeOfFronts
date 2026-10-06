import { describe, expect, it } from "vitest";
import {
  AiAssetLeases,
  type AiAssetLease,
} from "../../src/skirmish/domain/AiAssetLeases";
const lease = (
  asset: AiAssetLease["asset"],
  controller: string,
  rank: AiAssetLease["priority"] = "operation",
): AiAssetLease => ({
  asset,
  controller,
  priority: rank,
  playerId: 1,
  generation: 3,
  createdTick: 20,
  expiresTick: 200,
});
describe("AI movement ownership", () => {
  it("drops displaced roster members without touching another controller", () => {
    const leases = new AiAssetLeases();
    leases.acquire([
      lease("ship:1", "navy"),
      lease("ship:2", "navy"),
      lease("ship:3", "repair", "recovery"),
    ]);
    leases.retain("navy", new Set(["ship:2"]));
    expect(leases.held("ship:1")).toBe(false);
    expect(leases.owns("ship:2", "navy")).toBe(true);
    expect(leases.owns("ship:3", "repair")).toBe(true);
  });
  it("atomically leases formations and preserves higher-priority recovery and manual control", () => {
    const leases = new AiAssetLeases();
    expect(leases.acquire([lease("squad:1", "repair", "recovery")])).toBe(true);
    expect(
      leases.acquire([lease("squad:2", "push"), lease("squad:1", "push")]),
    ).toBe(false);
    expect(leases.held("squad:2")).toBe(false);
    expect(leases.acquire([lease("squad:1", "upgrade", "modernization")])).toBe(
      true,
    );
    expect(leases.acquire([lease("squad:1", "human", "manual")])).toBe(true);
    expect(leases.acquire([lease("squad:1", "upgrade", "modernization")])).toBe(
      false,
    );
  });
  it("restores lease ownership, expires generation/death/deadline and clears takeover", () => {
    const original = new AiAssetLeases();
    original.acquire([lease("ship:1", "navy"), lease("squad:2", "push")]);
    const clone = new AiAssetLeases();
    clone.restore(original.checkpoint());
    expect(clone.checkpoint()).toEqual(original.checkpoint());
    clone.expire(
      30,
      () => 3,
      (asset) => asset !== "ship:1",
    );
    expect(clone.held("ship:1")).toBe(false);
    clone.expire(
      30,
      () => 4,
      () => true,
    );
    expect(clone.leases.size).toBe(0);
    clone.restore(original.checkpoint());
    clone.expire(
      200,
      () => 3,
      () => true,
    );
    expect(clone.leases.size).toBe(0);
    clone.restore(original.checkpoint());
    clone.releasePlayer(1);
    expect(clone.leases.size).toBe(0);
  });
});
