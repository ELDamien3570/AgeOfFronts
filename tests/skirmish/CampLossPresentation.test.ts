import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CampLossPresentation } from "../../src/skirmish/client/CampLossPresentation";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(80 * 40).fill(133);
  const match = new Skirmish(new GameMapImpl(80, 40, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
  });
  const snapshot = match.snapshot();
  const player = snapshot.players[0];
  const notices = new CampLossPresentation();
  notices.update(snapshot, 0);
  return { notices, snapshot, player };
}

describe("transient camp loss notices", () => {
  it("fades over the final three seconds and expires while the game is paused", () => {
    const { notices, snapshot, player } = fixture();
    expect(notices.opacity(player.id, 0)).toBe(0);
    snapshot.owners[player.base] = 2;
    notices.update(snapshot, 1_000);
    // Repeated publications, including the same simulation tick, must not
    // restart the clock. Wall time still expires with no new snapshots.
    notices.update(snapshot, 12_000);
    expect(notices.opacity(player.id, 13_000)).toBe(1);
    expect(notices.opacity(player.id, 14_500)).toBeCloseTo(0.5);
    expect(notices.opacity(player.id, 16_000)).toBe(0);
    notices.update(snapshot, 20_000);
    expect(notices.opacity(player.id, 20_000)).toBe(0);
  });

  it("clears on recapture and starts a fresh notice for a later loss", () => {
    const { notices, snapshot, player } = fixture();
    snapshot.owners[player.base] = 2;
    notices.update(snapshot, 1_000);
    snapshot.owners[player.base] = player.id;
    notices.update(snapshot, 2_000);
    expect(notices.opacity(player.id, 2_000)).toBe(0);
    snapshot.owners[player.base] = 2;
    notices.update(snapshot, 20_000);
    expect(notices.opacity(player.id, 20_000)).toBe(1);
    expect(notices.opacity(player.id, 35_000)).toBe(0);
  });

  it("clears eliminated and removed factions instead of leaving stale warnings", () => {
    const { notices, snapshot, player } = fixture();
    snapshot.owners[player.base] = 2;
    notices.update(snapshot, 1_000);
    player.eliminated = true;
    notices.update(snapshot, 2_000);
    expect(notices.opacity(player.id, 2_000)).toBe(0);
    player.eliminated = false;
    notices.update(snapshot, 3_000);
    expect(notices.opacity(player.id, 3_000)).toBe(1);
    snapshot.players = snapshot.players.filter((p) => p.id !== player.id);
    notices.update(snapshot, 4_000);
    expect(notices.opacity(player.id, 4_000)).toBe(0);
  });

  it("does not carry timers into a new match that reuses faction ids", () => {
    const { notices, snapshot, player } = fixture();
    snapshot.owners[player.base] = 2;
    notices.update(snapshot, 0);
    expect(notices.opacity(player.id, 15_000)).toBe(0);
    notices.reset();
    expect(notices.opacity(player.id, 15_000)).toBe(0);
    notices.update(snapshot, 15_000);
    expect(notices.opacity(player.id, 15_000)).toBe(1);
  });
});
