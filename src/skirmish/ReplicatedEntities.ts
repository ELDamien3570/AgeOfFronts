import type { EntityChangeJournal } from "./EntityChangeJournal";
import type { Building, Ship, Squad } from "./Protocol";
import type { Deposit } from "./domain/Definitions";
export interface ReplicatedEntities {
  squads: { journal: EntityChangeJournal; byId(id: number): Squad | undefined };
  ships: { journal: EntityChangeJournal; byId(id: number): Ship | undefined };
  buildings: {
    journal: EntityChangeJournal;
    byId(id: number): Building | undefined;
  };
  resources?: {
    readonly geometryRevision: number;
    readonly ownershipRevision: number;
    journal: EntityChangeJournal;
    byId(id: number): Readonly<Deposit> | undefined;
  };
}
