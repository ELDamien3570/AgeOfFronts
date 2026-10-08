import { buildingGroundBounds } from "../../src/skirmish/BuildingFootprint";
import type { Skirmish } from "../../src/skirmish/Simulation";
import type { BuildingType } from "../../src/skirmish/Protocol";
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

/** Construction fixtures must claim the occupied rectangle, not just its anchor. */
export function claimBuildingFootprint(world: Skirmish, tile: number, type: BuildingType, owner=1): void {
  const bounds=buildingGroundBounds(world.map,tile,type);
  for(let y=bounds.top;y<bounds.bottom;y++) for(let x=bounds.left;x<bounds.right;x++) {
    if (!world.map.isValidCoord(x,y)) throw new Error("Fixture building outside map");
    (world as unknown as {changeOwner(tile:number,owner:number):void}).changeOwner(world.map.ref(x,y),owner);
  }
}
