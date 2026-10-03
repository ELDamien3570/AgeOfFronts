import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EntityChangeJournal } from "../../src/skirmish/EntityChangeJournal";
import { RecoveryBaselineCache } from "../../src/skirmish/multiplayer/application/RecoveryBaselineCache";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fixture() {
  return new Skirmish(
    new GameMapImpl(96, 64, new Uint8Array(6144).fill(133), 6144),
    { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
  );
}
function canonical(snapshot: ReturnType<SnapshotDecoder["decode"]>) {
  const { changedTiles: _changes, expansion, ...rest } = snapshot;
  void _changes;
  if (!expansion) return rest;
  const {
    depositGeometryRevision: _geometry,
    depositOwnershipRevision: _owners,
    ...domain
  } = expansion;
  void _geometry; void _owners;
  return { ...rest, expansion: { ...domain, depositOwners: undefined } };
}
describe("independent bounded entity replication", () => {
  it("matches full extraction through lifecycle changes, reverts, removed/re-added IDs and recovery", () => {
    const game = fixture(),
      encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const reference = new SnapshotDecoder();
    const compare = () => {
      const actual = decoder.decode(
        encoder.encode(
          game.replicationSource(),
          game.tileChanges,
          game.replicationFacts(),
        ),
      );
      const expected = reference.decode(
        new SnapshotEncoder(true).encode(game.snapshot()),
      );
      expect(canonical(actual)).toEqual(canonical(expected));
    };
    compare();
    let seed = 47;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const template = structuredClone(game.squads[0]);
    for (let i = 0; i < 100; i++) {
      if (i % 7 === 0)
        game.addSquad({ ...template, id: 20000 + i, playerId: (i % 2) + 1 });
      const squad = game.squads[random() % game.squads.length];
      game.updateSquad(squad.id, { x: random() % 20000, xp: random() % 100 });
      if (i % 9 === 0) {
        const input = structuredClone(squad);
        game.removeSquad(squad.id);
        game.addSquad(input);
      }
      if (i % 5 === 0) {
        const original = squad.troops;
        game.updateSquad(squad.id, { troops: original - 1 });
        game.updateSquad(squad.id, { troops: original });
      }
      if (i % 13 === 0) game.restore(game.checkpoint());
      if (game.expansion!.supply.deposits.length)
        game.expansion!.supply.updateDeposit(
          game.expansion!.supply.deposits[0].id,
          { owner: i % 3 },
        );
      compare();
    }
    const checkpoint = game.checkpoint();
    encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    expect(game.checkpoint()).toEqual(checkpoint);
    const quiet = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    expect(quiet.squads.length).toBe(0);
    expect(quiet.ships.length).toBe(0);
    expect(quiet.buildingDetails?.length).toBe(0);
    expect(encoder.diagnostics).toMatchObject({
      squadReads: 0,
      shipReads: 0,
      buildingReads: 0,
      resourceReads: 0,
      resourceSignatureRows: 0,
    });
    expect(decoder.decode(quiet).squads).toHaveLength(game.squads.length);
  });
  it("keeps baseline and live cursors independent, and falls back exactly on overflow", () => {
    const game = fixture(),
      live = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const facts = game.replicationFacts();
    facts.squads.journal = new EntityChangeJournal(2);
    decoder.decode(
      live.encode(game.replicationSource(), game.tileChanges, facts),
    );
    const squad = game.squads[0];
    game.updateSquad(squad.id, { troops: 321 });
    facts.squads.journal.record(squad.id, "change");
    new SnapshotEncoder(true).encode(
      game.replicationSource(),
      game.tileChanges,
      facts,
    );
    const next = live.encode(game.replicationSource(), game.tileChanges, facts);
    expect(next.entityMode).toBe("delta");
    expect(
      decoder.decode(next).squads.find((s) => s.id === squad.id)?.troops,
    ).toBe(321);
    for (let id = 300; id < 305; id++)
      facts.squads.journal.record(id, "remove");
    const overflow = live.encode(
      game.replicationSource(),
      game.tileChanges,
      facts,
    );
    expect(overflow.entityMode).toBe("full");
    expect(facts.squads.journal.retainedIds).toBe(2);
    expect(canonical(decoder.decode(overflow))).toEqual(
      canonical(
        new SnapshotDecoder().decode(
          new SnapshotEncoder(true).encode(game.snapshot()),
        ),
      ),
    );
    const previous = decoder.decode(
      live.encode(game.replicationSource(), game.tileChanges, facts),
    );
    // DTO readers cannot write back into retained canonical units.
    (previous.squads[0] as { troops: number }).troops = -100;
    expect(
      decoder.decode(
        live.encode(game.replicationSource(), game.tileChanges, facts),
      ).squads[0].troops,
    ).toBe(321);
  });
  it("retains remove history across re-add and invalidates old cursors", () => {
    const journal = new EntityChangeJournal(2);
    journal.record(7, "add");
    const cursor = journal.revision;
    journal.record(7, "remove");
    journal.record(7, "add");
    journal.record(7, "change");
    expect(journal.since(cursor)).toMatchObject([{ id: 7, removed: true }]);
    journal.invalidate();
    expect(journal.since(cursor)).toBeUndefined();
  });
});
describe("exact recovery baseline reuse", () => {
  it("shares immutable work at one version and releases superseded/closed captures", async () => {
    const cache = new RecoveryBaselineCache();
    let captures = 0,
      complete!: (value: { hash: string; payload: string }) => void;
    const capture = () => {
      captures++;
      return new Promise<{ hash: string; payload: string }>((resolve) => {
        complete = resolve;
      });
    };
    const first = cache.get(1, capture),
      second = cache.get(1, capture);
    await Promise.resolve();
    expect(captures).toBe(1);
    expect(first).toBe(second);
    cache.invalidate();
    const fresh = await cache.get(2, async () => ({
      hash: "new",
      payload: "current",
    }));
    const retained = cache.retainedBytes;
    complete({ hash: "old", payload: "old" });
    expect((await first).hash).toBe("old");
    expect(cache.retainedBytes).toBe(retained);
    expect(await cache.get(2, capture)).toBe(fresh);
    expect(Object.isFrozen(fresh)).toBe(true);
    cache.close();
    expect(cache.retainedBytes).toBe(0);
    await expect(cache.get(2, capture)).rejects.toThrow("closed");
  });
});
