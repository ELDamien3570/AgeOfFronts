import { EntityCollection } from "../../src/skirmish/EntityCollection";
import type { Squad } from "../../src/skirmish/Protocol";
import type { Skirmish } from "../../src/skirmish/Simulation";

/** Standalone domain/DTO fixture owner, without derived production indexes. */
export function unitOwner<T extends { readonly id: number }>(
  records: readonly T[],
) {
  const owner = new EntityCollection<T>({
    added() {},
    changed() {},
    removed() {},
    restored() {},
  });
  owner.restore(records);
  return owner;
}

/** Select fixture membership through domain lifecycle methods, retaining the
 * stable identity and canonical relative order of already owned records. */
export function retainSquads(
  world: Skirmish,
  inputs: readonly Squad[],
): readonly Squad[] {
  const wanted = new Set(inputs.map((squad) => squad.id));
  for (const squad of world.squads)
    if (!wanted.has(squad.id)) world.removeSquad(squad.id);
  return inputs.map((input) => {
    const owned = world.squad(input.id);
    if (!owned) return world.addSquad(input);
    if (owned !== input) {
      const { id, ...changes } = input;
      return world.updateSquad(id, changes)!;
    }
    return owned;
  });
}
