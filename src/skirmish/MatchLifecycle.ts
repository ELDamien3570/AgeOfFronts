/** Ownership and lifecycle events of one match (review 01 R4, 14 R-0 #1).
 *
 * The simulation announces each lifecycle change once, here, and every state
 * that depends on it subscribes, instead of the announcing code calling each
 * dependant by hand. Listeners run synchronously in registration order; that
 * order is behaviour (some dependants read state that earlier ones update), so
 * register subscribers once, at construction, in a fixed order.
 *
 * The bus holds no simulation state and is not checkpointed. */
export type EntityKind = "squad" | "building" | "ship";
export interface LifecycleListeners {
  /** A tile changed owner (0 = unowned). */
  tileOwner(tile: number, old: number, owner: number): void;
  /** An entity changed owner. */
  entityOwner(kind: EntityKind, id: number, old: number, owner: number): void;
  /** An entity left the match. */
  entityRemoved(kind: EntityKind, id: number): void;
  /** A faction was eliminated; `recipient` inherited its territory (0 = none). */
  factionEliminated(playerId: number, recipient: number): void;
  /** Control of a faction moved to the AI (`ai`) or to its human. */
  controller(playerId: number, ai: boolean): void;
}
type Event = keyof LifecycleListeners;
export class MatchLifecycle {
  private readonly listeners: { [K in Event]: LifecycleListeners[K][] } = {
    tileOwner: [], entityOwner: [], entityRemoved: [], factionEliminated: [], controller: [],
  };
  on<K extends Event>(event: K, listener: LifecycleListeners[K]): void {
    this.listeners[event].push(listener);
  }
  tileOwner(tile: number, old: number, owner: number): void {
    for (const listener of this.listeners.tileOwner) listener(tile, old, owner);
  }
  entityOwner(kind: EntityKind, id: number, old: number, owner: number): void {
    for (const listener of this.listeners.entityOwner) listener(kind, id, old, owner);
  }
  entityRemoved(kind: EntityKind, id: number): void {
    for (const listener of this.listeners.entityRemoved) listener(kind, id);
  }
  factionEliminated(playerId: number, recipient: number): void {
    for (const listener of this.listeners.factionEliminated) listener(playerId, recipient);
  }
  controller(playerId: number, ai: boolean): void {
    for (const listener of this.listeners.controller) listener(playerId, ai);
  }
}
