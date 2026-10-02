export type AiAsset =
  | `squad:${number}`
  | `ship:${number}`
  | `aircraft:${number}`;
export type AiControlPriority =
  | "patrol"
  | "operation"
  | "defense"
  | "recovery"
  | "modernization"
  | "boarding"
  | "manual";
const priority: Record<AiControlPriority, number> = {
  patrol: 0,
  operation: 1,
  defense: 2,
  recovery: 3,
  modernization: 4,
  boarding: 5,
  manual: 6,
};
export interface AiAssetLease {
  asset: AiAsset;
  playerId: number;
  generation: number;
  controller: string;
  priority: AiControlPriority;
  createdTick: number;
  expiresTick: number;
}
/** One movement owner per asset. Repair may be a subtask of that same owner,
 * never a second independent mission competing for its movement orders.
 */
export class AiAssetLeases {
  readonly leases = new Map<AiAsset, AiAssetLease>();
  acquire(requests: readonly AiAssetLease[]): boolean {
    if (new Set(requests.map((r) => r.asset)).size !== requests.length)
      return false;
    if (
      requests.some(
        (r) =>
          !Number.isInteger(r.generation) ||
          r.generation < 0 ||
          r.expiresTick <= r.createdTick,
      )
    )
      return false;
    for (const request of requests) {
      const current = this.leases.get(request.asset);
      if (
        current &&
        (current.playerId !== request.playerId ||
          current.generation !== request.generation ||
          (current.controller !== request.controller &&
            priority[current.priority] >= priority[request.priority]))
      )
        return false;
    }
    // Atomic acquisition: a failed member never strands half an army in leases.
    for (const request of requests)
      this.leases.set(request.asset, { ...request });
    return true;
  }
  owns(asset: AiAsset, controller: string): boolean {
    return this.leases.get(asset)?.controller === controller;
  }
  held(asset: AiAsset): boolean {
    return this.leases.has(asset);
  }
  release(controller: string): void {
    for (const [asset, lease] of this.leases)
      if (lease.controller === controller) this.leases.delete(asset);
  }
  releasePlayer(playerId: number): void {
    for (const [asset, lease] of this.leases)
      if (lease.playerId === playerId) this.leases.delete(asset);
  }
  expire(
    tick: number,
    generation: (playerId: number) => number,
    exists: (asset: AiAsset) => boolean,
  ): void {
    for (const [asset, lease] of this.leases)
      if (
        lease.expiresTick <= tick ||
        generation(lease.playerId) !== lease.generation ||
        !exists(asset)
      )
        this.leases.delete(asset);
  }
  checkpoint(): AiAssetLease[] {
    return structuredClone([...this.leases.values()]);
  }
  restore(saved: AiAssetLease[]): void {
    this.leases.clear();
    for (const lease of structuredClone(saved))
      this.leases.set(lease.asset, lease);
  }
}
