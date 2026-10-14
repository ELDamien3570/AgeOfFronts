import { describe, expect, it } from "vitest";
import { FormationSlotEncoder, FormationSlotDecoder, resolveFormationSlots } from "../../src/skirmish/FormationSlotStream";
import { createFormation, validateFormation, type FormationState } from "../../src/skirmish/domain/FormationGeometry";
import { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } from "../../src/skirmish/SnapshotCodec";
import { formationLoad } from "./fixtures/FormationLoad";
import { LocalSnapshotStream } from "../../src/skirmish/client/LocalSnapshotStream";

const formation = (): FormationState => ({ ...createFormation("napoleonic-infantry"),
  occupationSlots: [{ x: 0, y: 0, row: 0 }, { x: 256, y: 0, row: 0 }] });

describe("local formation slot stream", () => {
  it("joins and recovers with shared dictionary IDs without consuming pending changes", () => {
    const { game } = formationLoad("distributed", 15), encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
    const existing = new SnapshotDecoder(), joining = new SnapshotDecoder(), recovering = new SnapshotDecoder();
    const squad = game.squads[0];
    const publish = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    game.updateSquad(squad.id, { formation: formation() }); existing.decodeLatest(publish());
    for (let i = 0; i < 4; i++) { game.updateSquad(squad.id, { formation: formation() }); existing.decodeLatest(publish()); }
    const aligned = encoder.encodeJoinBarrier(game.replicationSource(), game.tileChanges, game.replicationFacts());
    existing.decodeLatest(aligned.shared); joining.decodeLatest(aligned.baseline);
    game.updateSquad(squad.id, { formation: formation() });
    const baseline = encoder.encodeBaseline(game.replicationSource(), game.tileChanges, game.replicationFacts());
    recovering.decodeLatest(structuredClone(baseline, { transfer: snapshotTransfers(baseline) }));
    const delta = publish();
    const a = existing.decodeLatest(structuredClone(delta));
    const b = joining.decodeLatest(structuredClone(delta));
    const c = recovering.decodeLatest(structuredClone(delta));
    expect(a.squads).toEqual(b.squads); expect(a.squads).toEqual(c.squads);
    game.removeSquad(squad.id); const removed = publish();
    expect(existing.decodeLatest(structuredClone(removed)).squads).toEqual(joining.decodeLatest(structuredClone(removed)).squads);
    expect(existing.decodeLatest(encoder.encodeBaseline(game.replicationSource(), game.tileChanges, game.replicationFacts())).squads).toEqual(recovering.decodeLatest(structuredClone(removed)).squads);
  });
  it("recovers a rejected dictionary delta only through a fresh complete baseline", () => {
    const { game } = formationLoad("distributed", 15), encoder = new SnapshotEncoder(false, { compactFormationSlots: true });
    let requests = 0;
    const stream = new LocalSnapshotStream(() => requests++), squad = game.squads[0];
    const publish = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    game.updateSquad(squad.id, { formation: formation() });
    expect(stream.decode(publish())).toBeDefined();
    game.updateSquad(squad.id, { formation: formation() });
    const rejected = publish(); rejected.details!.formationSlots!.upserts = [];
    expect(stream.decode(rejected)).toBeUndefined(); expect(requests).toBe(1);
    game.updateSquad(squad.id, { formation: { ...squad.formation!, revision: 2 } });
    expect(stream.decode(publish())).toBeUndefined(); expect(requests).toBe(1);
    const baseline = new SnapshotEncoder(false, { compactFormationSlots: true }).encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    expect(stream.decode(baseline)?.squads.find(s => s.id === squad.id)?.formation).toEqual(squad.formation);
  });
  it("reuses frozen arrays while keeping formation records separately owned", () => {
    const encoder = new FormationSlotEncoder(), decoder = new FormationSlotDecoder(), f = formation();
    const a = encoder.encode(1, f) as FormationState, b = encoder.encode(2, { ...f }) as FormationState;
    const changes = encoder.drain(), read = decoder.stage(changes);
    expect(changes.upserts).toHaveLength(1);
    resolveFormationSlots(a, read); resolveFormationSlots(b, read); decoder.commit(read);
    expect(a).not.toBe(b); expect(a.occupationSlots).toBe(b.occupationSlots);
    expect(Object.isFrozen(a.occupationSlots)).toBe(true);
    expect(Object.isFrozen(a.occupationSlots![0])).toBe(true);
    validateFormation(a, "napoleonic-infantry", undefined, read.validated);
    encoder.encode(1, { ...f, revision: f.revision + 1 });
    expect(encoder.drain().upserts).toHaveLength(0);
    encoder.forget(1); expect(encoder.drain().removed).toHaveLength(0);
    encoder.forget(2); const removed = encoder.drain(); expect(removed.removed).toHaveLength(1);
    decoder.commit(decoder.stage(removed)); expect(decoder.retainedEntries).toBe(0);
    expect(a.occupationSlots).toHaveLength(2);
  });

  it("bounds retention by current owners across replacements and resets", () => {
    const encoder = new FormationSlotEncoder(), decoder = new FormationSlotDecoder();
    for (let i = 0; i < 300; i++) {
      encoder.encode(1, formation()); const read = decoder.stage(encoder.drain()); decoder.commit(read);
      expect(encoder.retainedEntries).toBe(1); expect(decoder.retainedEntries).toBe(1);
    }
    encoder.clear(); encoder.encode(1, formation());
    const baseline = encoder.drain(); expect(baseline.reset).toBe(true);
    decoder.commit(decoder.stage(baseline)); expect(decoder.retainedEntries).toBe(1);
  });

  it("rejects missing baselines, invalid coordinates, kinds and references without committing", () => {
    const encoder = new FormationSlotEncoder(), decoder = new FormationSlotDecoder();
    const wire = encoder.encode(1, formation()) as FormationState, baseline = encoder.drain();
    expect(() => decoder.stage({ ...baseline, reset: false })).toThrow(/baseline/);
    expect(() => decoder.stage({ ...baseline, upserts: [{ ...baseline.upserts[0], coordinates: new Float64Array([0.5, 0, 0]) }] })).toThrow();
    const staged = decoder.stage(baseline);
    expect(decoder.retainedEntries).toBe(0);
    expect(() => resolveFormationSlots({ ...wire, occupationSlots: { $formationSlots: 999 } as any }, staged)).toThrow(/baseline/);
    decoder.commit(staged); expect(decoder.retainedEntries).toBe(1);
    expect(() => decoder.stage({ reset: false, removed: new Int32Array(), upserts: [{ ...baseline.upserts[0], kind: "trail", coordinates: new Float64Array([0, 256, 0, 0]) }] })).toThrow(/identity changed/);
  });

  it("keeps extension fields inline and normalizes negative zero as JSON did", () => {
    const encoder = new FormationSlotEncoder();
    const f = formation(); (f.occupationSlots![0] as any).extra = "preserved";
    expect((encoder.encode(1, f) as FormationState).occupationSlots).toBe(f.occupationSlots);
    expect(encoder.drain().upserts).toHaveLength(0);
    const standard = formation(); standard.occupationSlots![0].x = -0;
    encoder.encode(1, standard); expect(Object.is(encoder.drain().upserts[0].coordinates[0], -0)).toBe(false);
  });

  it("matches the legacy snapshot projection through movement, removal and recovery", () => {
    const { game } = formationLoad("distributed", 15);
    let legacy = new SnapshotEncoder(), compact = new SnapshotEncoder(false, { compactFormationSlots: true });
    const oldDecoder = new SnapshotDecoder(), decoder = new SnapshotDecoder();
    const selected = game.squads[0]; game.updateSquad(selected.id, { formation: formation() });
    for (let i = 0; i < 8; i++) {
      if (i === 2) game.updateSquad(selected.id, { formation: { ...formation(), revision: 5 } });
      if (i === 4) game.removeSquad(selected.id);
      if (i === 6) { legacy = new SnapshotEncoder(); compact = new SnapshotEncoder(false, { compactFormationSlots: true }); }
      const source = game.replicationSource(), facts = game.replicationFacts();
      const expected = oldDecoder.decodeLatest(legacy.encode(source, game.tileChanges, facts));
      const packet = compact.encode(source, game.tileChanges, facts);
      const delivered = structuredClone(packet, { transfer: snapshotTransfers(packet) });
      expect(delivered.details!.version).toBe(5);
      expect(JSON.stringify(decoder.decodeLatest(delivered))).toBe(JSON.stringify(expected));
      game.step();
    }
  }, 15000);
});
