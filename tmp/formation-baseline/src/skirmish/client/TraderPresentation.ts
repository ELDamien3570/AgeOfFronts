import type { Snapshot } from "../Protocol";
import { buildingSymbol } from "./MapSymbols";

/** Shipment state decides visibility; lack of movement may mean route planning
 * or unloading, and must not be mistaken for an unused pooled courier. */
export function traderActivity(actor: NonNullable<Snapshot["expansion"]>["traders"][number]): "hidden" | "loading" | "active" {
  return actor.state === "loading" ? actor.waitingForCargo ? "loading" : "hidden" : "active";
}

interface TraderState {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  angle: number;
  moving: boolean;
  startedAt: number;
  tick: number;
}

// Observe movement only. Shipment state can remain outbound during a stop;
// animation and facing must never change trade routes or delivery timing.
export class TraderPresentation {
  private readonly traders = new Map<number, TraderState>();
  private readonly loadingStock = new Map<string, number>();

  reset(): void {
    this.traders.clear();
    this.loadingStock.clear();
  }

  update(snapshot: Snapshot): void {
    this.loadingStock.clear();
    for (const site of snapshot.expansion?.tradeSites ?? [])
      if (site.kind !== "city" && site.shipmentCapacity > 0)
        this.loadingStock.set(`${site.playerId}:${site.naval}:${site.tile}`,
          Math.max(0, Math.min(1, site.cargo / site.shipmentCapacity)));
    const live = new Set<number>();
    for (const actor of snapshot.expansion?.traders ?? []) {
      live.add(actor.id);
      const old = this.traders.get(actor.id);
      // Commands can publish a duplicate tick. Preserve its motion and phase.
      if (old?.tick === snapshot.tick && old.x === actor.x && old.y === actor.y)
        continue;
      const moving = !!old && (actor.x !== old.x || actor.y !== old.y);
      this.traders.set(actor.id, {
        x: actor.x,
        y: actor.y,
        previousX: old?.x ?? actor.x,
        previousY: old?.y ?? actor.y,
        // Use the land-art down-facing convention. The renderer applies any
        // up-facing ship asset's authored orientation separately.
        angle:
          old && moving
            ? Math.atan2(actor.y - old.y, actor.x - old.x) - Math.PI / 2
            : (old?.angle ?? 0),
        moving,
        startedAt: old && old.moving === moving ? old.startedAt : snapshot.tick,
        tick: snapshot.tick,
      });
    }
    for (const id of this.traders.keys())
      if (!live.has(id)) this.traders.delete(id);
  }

  loadingProgress(actor: NonNullable<Snapshot["expansion"]>["traders"][number], scale: number): number | undefined {
    if (traderActivity(actor) !== "loading" ||
      !buildingSymbol(scale, true, actor.naval ? "port" : "factory").artwork) return undefined;
    return this.loadingStock.get(`${actor.playerId}:${actor.naval}:${actor.originTile}`);
  }

  pose(id: number, tick: number, blend = 1) {
    const state = this.traders.get(id);
    if (!state) return undefined;
    const fraction = Math.max(0, Math.min(1, blend));
    return {
      x: state.previousX + (state.x - state.previousX) * fraction,
      y: state.previousY + (state.y - state.previousY) * fraction,
      angle: state.angle,
      clip: state.moving ? "running" : "idle",
      elapsedTicks: Math.max(0, tick - state.startedAt),
    };
  }
}
