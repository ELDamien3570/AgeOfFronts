import type { ElevationData } from "../../Elevation";
import { createSkirmishMap } from "../../Elevation";
import type { ForestData } from "../../Forest";
import type { Command, MatchOptions } from "../../Protocol";
import type { ResourceTerrainData } from "../../ResourceTerrain";
import { Skirmish } from "../../Simulation";
import { encodeState, type EncodedState } from "../StateCodec";
import { diffState } from "../StateDelta";

type Checkpoint = ReturnType<Skirmish["checkpoint"]>;

/** Identity of a committed state: chained from its base and the delta's hash. */
export async function chainStateId(
  baseId: string,
  deltaHash: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${baseId}:${deltaHash}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const COMMIT_TICKS = 4;
export interface RuntimeMap {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation?: ElevationData;
  forest?: ForestData;
  resourceTerrain?: ResourceTerrainData;
}
export interface OrderedCommand {
  id: string;
  sequence: number;
  command: Command;
}
export interface HostBatch {
  previousTick: number;
  commands: OrderedCommand[];
  disconnectedPlayerIds: number[];
}
export interface WorldEconomyChange {
  playerId: number;
  gold: number;
  reserves: number;
}
export interface RuntimeCommit {
  previousTick: number;
  tick: number;
  /** State the delta applies to; must equal the server's committed state id. */
  baseId: string;
  /** Id of the resulting state, `chainStateId(baseId, delta.hash)`. */
  stateId: string;
  /** Structural delta from the base checkpoint to the new one. */
  delta: EncodedState;
  worldEconomy: WorldEconomyChange[];
  rejectedCommands: { id: string; message: string }[];
  computeMs: number;
}

/** Runs in either a browser worker or the reserved server worker. No transport or UI state. */
export class HostedRuntime {
  readonly match: Skirmish;
  // The last committed (or restored) checkpoint and its id. Commits are deltas
  // against it; it is never mutated.
  private base?: { state: Checkpoint; id: string };
  constructor(map: RuntimeMap, options: MatchOptions) {
    this.match = new Skirmish(
      createSkirmishMap(
        map.width,
        map.height,
        map.terrain,
        map.elevation,
        map.forest,
        map.resourceTerrain,
      ),
      options,
    );
  }
  /**
   * Restores `checkpoint`. With `stateId` it also becomes the delta base;
   * without one (local experiments) the base is derived on the next run.
   */
  restore(checkpoint: Checkpoint, stateId?: string): void {
    this.match.restore(checkpoint);
    this.base = stateId ? { state: checkpoint, id: stateId } : undefined;
  }
  async run(batch: HostBatch): Promise<RuntimeCommit> {
    if (batch.previousTick !== this.match.tick)
      throw new Error("Host batch has a stale tick boundary");
    const started = performance.now();
    if (!this.base) {
      // Same id the server gives an initial or restored checkpoint.
      const state = this.match.checkpoint();
      this.base = { state, id: (await encodeState(state)).hash };
    }
    const base = this.base;
    for (const id of batch.disconnectedPlayerIds) {
      const player = this.match.player(id);
      if (player) player.ai = true;
    }
    const rejectedCommands: RuntimeCommit["rejectedCommands"] = [];
    for (const item of batch.commands) {
      const error = this.match.applyCommand(item.command);
      if (error) rejectedCommands.push({ id: item.id, message: error });
    }
    const before = new Map(
      this.match.players.map((player) => [
        player.id,
        { gold: player.gold, reserves: player.reserves },
      ]),
    );
    for (let i = 0; i < COMMIT_TICKS; i++) this.match.step();
    const worldEconomy = this.match.players.map((player) => ({
      playerId: player.id,
      gold: player.gold - before.get(player.id)!.gold,
      reserves: player.reserves - before.get(player.id)!.reserves,
    }));
    const next = this.match.checkpoint();
    const delta = await encodeState(diffState(base.state, next));
    const stateId = await chainStateId(base.id, delta.hash);
    this.base = { state: next, id: stateId };
    return {
      previousTick: batch.previousTick,
      tick: this.match.tick,
      baseId: base.id,
      stateId,
      delta,
      worldEconomy,
      rejectedCommands,
      computeMs: performance.now() - started,
    };
  }
}
