import { describe, expect, it } from "vitest";
import { MatchAuthority } from "../../src/skirmish/multiplayer/domain/MatchAuthority";
const candidate = (guestId: string, tickP95Ms = 5) => ({ guestId, tickP95Ms, roundTripMs: 20, eligible: true });
describe("match executor authority", () => {
  it("chooses a capable client and fences the old host after disconnection", () => {
    const authority = new MatchAuthority(10, "checkpoint-10");
    const selected = authority.elect([candidate("slow", 30), candidate("good", 10), candidate("best")], 0, true);
    expect(selected.executor).toBe("best");
    authority.ready("best", selected.epoch, 10, "checkpoint-10", 1);
    authority.commit("best", selected.epoch, 10, 11, "checkpoint-11", 2);
    authority.disconnect("best");
    expect(authority.snapshot().phase).toBe("paused");
    expect(() => authority.commit("best", selected.epoch, 11, 12, "checkpoint-12", 3)).toThrow("lease");
    const replacement = authority.elect([candidate("good")], 3, true);
    expect(() => authority.ready("good", replacement.epoch, 10, "checkpoint-10", 4)).toThrow("checkpoint");
    authority.ready("good", replacement.epoch, 11, "checkpoint-11", 4);
    expect(authority.snapshot().phase).toBe("running");
  });
  it("uses reserved server capacity when no client qualifies, and never invents capacity", () => {
    const authority = new MatchAuthority(0, "initial");
    expect(authority.elect([candidate("weak", 80)], 0, false).executor).toBeNull();
    const fallback = authority.elect([], 1, true);
    expect(fallback.executor).toBe("server");
    authority.ready("server", fallback.epoch, 0, "initial", 2);
    expect(authority.expire(5001)).toBe(false);
    expect(authority.expire(5002)).toBe(true);
  });
  it("invalidates all old leases after a coordinator restart", () => {
    const first = new MatchAuthority(0, "initial");
    const selected = first.elect([candidate("host")], 0, true);
    first.ready("host", selected.epoch, 0, "initial", 1);
    const restarted = new MatchAuthority(0, "initial", first.snapshot());
    expect(restarted.snapshot().phase).toBe("paused");
    expect(() => restarted.renew("host", selected.epoch, 2)).toThrow("lease");
  });
});
