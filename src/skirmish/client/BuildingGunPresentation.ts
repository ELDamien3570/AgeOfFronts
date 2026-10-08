import type { ArcherVolley, Building } from "../Protocol";

/** Cosmetic state driven exclusively by authoritative firing events. */
export class BuildingGunPresentation {
  private readonly shots = new Map<number, { tick: number; facing: string }>();

  reset(): void {
    this.shots.clear();
  }

  update(
    buildings: readonly Building[],
    volleys: readonly ArcherVolley[],
    tick: number,
  ): void {
    const guns = new Set(
      buildings
        .filter(
          (b) =>
            b.type === "gun-nest" && !b.remainingTicks && (b.health ?? 1) > 0,
        )
        .map((b) => b.id),
    );
    for (const id of this.shots.keys())
      if (!guns.has(id)) this.shots.delete(id);
    for (const volley of volleys) {
      if (
        !guns.has(volley.squadId) ||
        volley.tick > tick ||
        tick - volley.tick >= 15
      )
        continue;
      const previous = this.shots.get(volley.squadId);
      if (previous && previous.tick >= volley.tick) continue;
      const dx = volley.toX - volley.fromX,
        dy = volley.toY - volley.fromY;
      const facing =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
      this.shots.set(volley.squadId, { tick: volley.tick, facing });
    }
  }

  idleFacing(buildingId: number): string | undefined {
    return this.shots.get(buildingId)?.facing;
  }

  firing(
    buildingId: number,
    visualTick: number,
  ): { facing: string; elapsed: number } | undefined {
    const shot = this.shots.get(buildingId);
    if (!shot || visualTick < shot.tick || visualTick - shot.tick >= 14.4)
      return;
    return { facing: shot.facing, elapsed: visualTick - shot.tick };
  }
}
