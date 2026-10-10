import type { Projectile } from "../domain/Definitions";
import { ARTWORK_CATALOG } from "./ArtworkCatalog";
export interface ImpactVisual {
  id: number;
  x: number;
  y: number;
  radius: number;
  start: number;
  end: number;
  artworkId: string;
  clip: "separation" | "detonate";
  angle: number;
}
function impactArtwork(p: Projectile): string {
  if (p.kind === "mirv") return "mirv";
  if (p.kind === "warhead") return "impact-mirv";
  if (p.kind === "icbm")
    return p.definitionId === "hydrogen" ? "impact-hydrogen" : "impact-icbm";
  if (p.kind === "bomb") return p.definitionId === "atomic" ? "impact-hydrogen" : "impact-bomb";
  return p.sourceKind === "ship" ? "impact-naval" : "impact-shell";
}
/** Cosmetic persistence survives removal of the already-resolved domain event. */
export class ImpactPresentation {
  private readonly active = new Map<number, ImpactVisual>();
  private readonly seen = new Set<number>();
  private terminal: { tick: number; now: number } | null = null;
  reset(): void {
    this.active.clear();
    this.seen.clear();
    this.terminal = null;
  }
  // Completed matches stop the domain clock. Committed cosmetic effects may
  // finish, while an ordinary pause still uses the frozen presentation tick.
  clock(tick: number, now: number, ended: boolean): number {
    if (!ended) {
      this.terminal = null;
      return tick;
    }
    this.terminal ??= { tick, now };
    return this.terminal.tick + Math.max(0, now - this.terminal.now) / 50;
  }
  update(projectiles: readonly Projectile[], tick: number): void {
    for (const p of projectiles) {
      const separation = p.kind === "mirv";
      if (
        !p.impacted ||
        p.damage <= 0 ||
        (separation ? p.warheads <= 0 : p.blastRadius <= 0) ||
        this.seen.has(p.id)
      )
        continue;
      const artworkId = impactArtwork(p),
        clipName = separation ? "separation" : "detonate",
        clip = ARTWORK_CATALOG[artworkId]?.clips?.[clipName];
      if (!clip) continue;
      const start = p.impactAt ?? tick,
        end = start + Math.ceil((clip.frames * 20) / clip.fps);
      if (tick < end)
        this.active.set(p.id, {
          id: p.id,
          x: p.x,
          y: p.y,
          radius: separation ? p.diameter : p.blastRadius,
          start,
          end,
          artworkId,
          clip: clipName,
          angle: Math.atan2(p.toY - p.fromY, p.toX - p.fromX) - Math.PI / 2,
        });
      this.seen.add(p.id);
    }
    this.frames(tick);
    const retained = new Set(projectiles.map((p) => p.id));
    for (const id of this.seen)
      if (!retained.has(id) && !this.active.has(id)) this.seen.delete(id);
    if (this.active.size > 128)
      for (const event of [...this.active.values()]
        .sort((a, b) => a.start - b.start || a.id - b.id)
        .slice(0, this.active.size - 128))
        this.active.delete(event.id);
  }
  frames(tick: number): ImpactVisual[] {
    for (const [id, event] of this.active)
      if (tick >= event.end) this.active.delete(id);
    return [...this.active.values()];
  }
}
