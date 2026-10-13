import { describe, expect, it, vi } from "vitest";
import { SnapshotEncoder, SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import { DETAIL_STRIDES } from "../../src/skirmish/SnapshotDetails";
import { formationLoad } from "./fixtures/FormationLoad";

describe("packed detail decode ownership", () => {
  it("parses each nested squad row once and preserves independent detail owners", () => {
    const { game } = formationLoad("distributed", 15), encoder = new SnapshotEncoder();
    const packet = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    const rows = packet.details!.squads!.length / DETAIL_STRIDES.squad;
    const spy = vi.spyOn(JSON, "parse");
    try {
      const decoded = new SnapshotDecoder().decodeLatest(packet);
      expect(spy).toHaveBeenCalledTimes(rows);
      const formations = decoded.squads.map(s => s.formation).filter(Boolean);
      expect(new Set(formations).size).toBe(formations.length);
    } finally { spy.mockRestore(); }
  });
});
