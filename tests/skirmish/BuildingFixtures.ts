import type { Building, Snapshot } from "../../src/skirmish/Protocol";
import { EntityCollection } from "../../src/skirmish/EntityCollection";

/** Detached fixtures own their records without a live simulation. Index tests
 * can attach their real lifecycle hooks to the same ownership contract. */
export function buildingOwner(
  records: readonly Building[],
  hooks: Partial<
    ConstructorParameters<typeof EntityCollection<Building>>[0]
  > = {},
): EntityCollection<Building> {
  const owner = new EntityCollection<Building>({
    added() {},
    changed() {},
    removed() {},
    restored() {},
    ...hooks,
  });
  owner.restore(records);
  return owner;
}

/** A presentation snapshot owns replaceable values, independently of simulation. */
export function updateSnapshotBuilding(
  snapshot: Snapshot,
  id: number,
  changes: Partial<Omit<Building, "id">>,
): Building {
  const index = snapshot.buildings.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Missing snapshot fixture building");
  return (snapshot.buildings[index] = {
    ...snapshot.buildings[index],
    ...structuredClone(changes),
  });
}
