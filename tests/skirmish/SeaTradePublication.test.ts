import { describe, expect, it } from "vitest";
import { seaFleet } from "./SeaTradeFixture";
import { TraderEncoder, TraderDecoder } from "../../src/skirmish/TraderStream";
import { TraderDecoder as LegacyTraderDecoder } from "./fixtures/LegacyTraderDecoder";
import { SnapshotEncoder, SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
describe("sea trade publication", () => {
  it("keeps private lanes out of full and borrowed publications and preserves checkpoint purity", () => {
    const f = seaFleet(); f.step(30);
    const before = f.game.checkpoint();
    const full = new SnapshotDecoder().decode(new SnapshotEncoder().encode(f.game.replicationSource(false), f.game.tileChanges, f.game.replicationFacts()));
    const borrowed = new SnapshotDecoder().decode(new SnapshotEncoder(true, { compactTraders: true }).encode(f.game.replicationSource(true), f.game.tileChanges, f.game.replicationFacts()));
    expect(borrowed.expansion!.traders).toEqual(full.expansion!.traders);
    for (const row of full.expansion!.traders) {
      expect(Object.keys(row)).not.toContain("leg"); expect(Object.keys(row)).not.toContain("laneId");
      expect(Object.keys(row)).not.toContain("trail"); expect(Object.keys(row)).not.toContain("pending");
    }
    expect(f.game.checkpoint()).toEqual(before);
  });
  it("lets the frozen old decoder accept new wait detail while preserving cargo and motion", () => {
    const f = seaFleet(); f.step(30); const actor = f.trade.actors[0];
    f.trade.seaTrade!.setWait(actor, "market-intake");
    const encoder = new TraderEncoder(), packet = encoder.encode(f.trade.actors, true, true);
    const old = new LegacyTraderDecoder(), current = new TraderDecoder();
    expect(old.stage(packet).rows).toEqual(current.stage(packet).rows);
    expect(old.stage(packet).rows[0]).toMatchObject({ waitDetail: "market-intake", cargo: actor.cargo, x: actor.x, y: actor.y });
    old.commit(old.stage(packet)); current.commit(current.stage(packet));
    expect(encoder.encode(f.trade.actors, false, true).upserts).toEqual([]);
    const bad = structuredClone(packet); (bad.upserts[0] as any).waitDetail = "wrong";
    expect(() => current.stage(bad)).toThrow("Invalid trader stream");
  });
});
