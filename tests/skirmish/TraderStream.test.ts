import { describe, expect, it } from "vitest";
import { TraderEncoder, TraderDecoder } from "../../src/skirmish/TraderStream";
import { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } from "../../src/skirmish/SnapshotCodec";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";
import { formationLoad } from "./fixtures/FormationLoad";

function actor(id = 100000): TradeActor {
  return { id, playerId: 1, factoryId: 2, definitionId: "stone-trader", naval: false, x: 100, y: 200,
    cargo: 5, loaded: 5, delivered: 0, lost: 0, returned: 0, valuePerGood: 2, originTile: 10,
    capacity: 20, shipmentId: 1, stops: [2, 3], visited: [2], destination: 3, state: "outbound",
    path: [10, 11], nextPathIndex: 1, waitTicks: 0, quoteAllies: [1, 2] };
}
function dto(row: TradeActor) { const { path: _path, nextPathIndex: _index, ...rest } = row; return rest; }
describe("trader publication", () => {
  it("reuses details through motion, detects in-place list edits, removes and resets actors", () => {
    const encoder = new TraderEncoder(), decoder = new TraderDecoder(), a = dto(actor()), b = dto(actor(100001));
    const initial = encoder.encode([a, b], true);
    decoder.commit(decoder.stage(structuredClone(initial)));
    a.x++; a.waitTicks++;
    let packet = encoder.encode([b, a], false);
    expect(packet.upserts).toHaveLength(0);
    let staged = decoder.stage(structuredClone(packet));
    expect(staged.rows).toEqual([b, a]); decoder.commit(staged);
    a.visited.push(3); a.quoteAllies.splice(0, 1); a.tripGold = 10;
    packet = encoder.encode([a], false);
    expect(packet.upserts).toHaveLength(1); expect([...packet.removed]).toEqual([b.id]);
    staged = decoder.stage(structuredClone(packet)); expect(staged.rows).toEqual([a]); decoder.commit(staged);
    packet = encoder.encode([b], true);
    expect(decoder.stage(packet).rows).toEqual([b]);
    expect(initial.upserts[0].visited).toEqual([2]);
  });

  it("keeps recovered and existing traders aligned when a waiting reason changes back",()=>{
    const {game}=formationLoad("distributed",15),a=actor();game.expansion!.trade.actors.push(a);
    const encoder=new SnapshotEncoder(false,{compactTraders:true}),existing=new SnapshotDecoder(),recovered=new SnapshotDecoder();
    a.waitingReason="planning";existing.decode(encoder.encode(game.replicationSource(true),game.tileChanges,game.replicationFacts()));
    a.waitingReason=undefined;
    const aligned=encoder.encodeJoinBarrier(game.replicationSource(true),game.tileChanges,game.replicationFacts());
    expect(existing.decode(aligned.shared).expansion!.traders).toEqual(recovered.decode(aligned.baseline).expansion!.traders);
    a.waitingReason="planning";
    const next=encoder.encode(game.replicationSource(true),game.tileChanges,game.replicationFacts());
    expect(next.traderChanges!.upserts[0].waitingReason).toBe("planning");
    expect(existing.decode(next).expansion!.traders).toEqual(recovered.decode(next).expansion!.traders);
  });

  it("rejects missing baselines, truncated rosters, invalid records and duplicate ids without poisoning retained details", () => {
    const encoder = new TraderEncoder(), decoder = new TraderDecoder(), a = dto(actor());
    const initial = encoder.encode([a], true);
    expect(() => decoder.stage({ ...initial, reset: false })).toThrow();
    decoder.commit(decoder.stage(initial));
    const good = encoder.encode([a], false);
    expect(() => decoder.stage({ ...good, motion: new Float64Array() })).toThrow();
    expect(() => decoder.stage({ ...good, motion: new Float64Array([...good.motion, ...good.motion]) })).toThrow();
    expect(() => decoder.stage({ ...good, upserts: [{ ...initial.upserts[0], visited: [Infinity] }] })).toThrow();
    expect(() => decoder.stage({ ...good, removed: new Int32Array([a.id]) })).toThrow();
    expect(decoder.stage(good).rows).toEqual([a]);
  });

  it("preserves complete decoded DTOs across transfer, independent snapshots, removal and legacy reset", () => {
    const { game } = formationLoad("distributed", 15), a = actor();
    game.expansion!.trade.actors.push(a);
    const compact = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true });
    const legacy = new SnapshotEncoder(), decoder = new SnapshotDecoder(), legacyDecoder = new SnapshotDecoder();
    const publish = () => {
      const source = game.replicationSource(true), facts = game.replicationFacts();
      const packet = compact.encode(source, game.tileChanges, facts);
      expect(packet.expansion?.traders).toBeUndefined();
      const delivered = structuredClone(packet, { transfer: snapshotTransfers(packet) });
      const actual = decoder.decode(delivered);
      const expected = legacyDecoder.decode(legacy.encode(game.replicationSource(), game.tileChanges, facts));
      expect(actual.expansion?.traders).toEqual(expected.expansion?.traders);
      return actual;
    };
    const original = publish();
    a.x += 2; a.waitTicks = 10; a.visited.push(4); a.supplyWaitStartedTick = 2; a.state = "loading"; publish();
    a.supplyWaitStartedTick = undefined; a.path.push(99); a.routeOriginOwner = 3; publish();
    expect(original.expansion!.traders[0].visited).toEqual([2]);
    expect(original.expansion!.traders[0].x).toBe(100);
    game.expansion!.trade.actors.length = 0; publish();
    const reset = new SnapshotEncoder().encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    expect(decoder.decode(reset).expansion!.traders).toEqual([]);
    expect(decoder.decode(new SnapshotEncoder(false, { compactTraders: true }).encode(game.replicationSource(), game.tileChanges, game.replicationFacts())).expansion!.traders).toEqual([]);
  });
});
