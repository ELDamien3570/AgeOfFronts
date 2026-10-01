import type { ElevationData } from "../../Elevation";
import { createSkirmishMap } from "../../Elevation";
import type { ForestData } from "../../Forest";
import type { Command, MatchOptions } from "../../Protocol";
import type { ResourceTerrainData } from "../../ResourceTerrain";
import { Skirmish } from "../../Simulation";
import { encodeState, type EncodedState } from "../StateCodec";

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
  checkpoint: EncodedState;
  worldEconomy: WorldEconomyChange[];
  rejectedCommands: { id: string; message: string }[];
  computeMs: number;
}

/** Runs in either a browser worker or the reserved server worker. No transport or UI state. */
export class HostedRuntime {
  match: Skirmish;
  constructor(private readonly map: RuntimeMap, options: MatchOptions) {
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
  restore(checkpoint: ReturnType<Skirmish["checkpoint"]>): void {
    if (JSON.stringify(checkpoint.options) !== JSON.stringify(this.match.options))
      this.match = new HostedRuntime(this.map, checkpoint.options).match;
    this.match.restore(checkpoint);
  }
  async run(batch: HostBatch): Promise<RuntimeCommit> {
    if (batch.previousTick !== this.match.tick)
      throw new Error("Host batch has a stale tick boundary");
    const started = performance.now();
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
    const checkpoint = await encodeState(this.match.checkpoint());
    return {
      previousTick: batch.previousTick,
      tick: this.match.tick,
      checkpoint,
      worldEconomy,
      rejectedCommands,
      computeMs: performance.now() - started,
    };
  }
}
