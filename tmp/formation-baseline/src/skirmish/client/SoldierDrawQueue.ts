/** Reusable client-only sprite queue. All soldiers share one layer with permanent identity ordering. */
export interface SoldierSpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
}
export interface SoldierDrawEntry {
  squadId: number;
  soldierId: number;
  screenX: number;
  screenY: number;
  angle: number;
  size: number;
  image: CanvasImageSource;
  frame: SoldierSpriteFrame;
  selectionRadius: number;
  selectionColor: string;
}
export class SoldierDrawQueue {
  private readonly pool: SoldierDrawEntry[] = [];
  private readonly entries: SoldierDrawEntry[] = [];
  clear(): void {
    this.entries.length = 0;
  }
  add(
    squadId: number,
    soldierId: number,
    screenX: number,
    screenY: number,
    angle: number,
    size: number,
    image: CanvasImageSource,
    frame: SoldierSpriteFrame,
    selectionRadius = 0,
    selectionColor = "",
  ): void {
    const index = this.entries.length;
    let entry = this.pool[index];
    if (!entry) {
      entry = {
        squadId,
        soldierId,
        screenX,
        screenY,
        angle,
        size,
        image,
        frame,
        selectionRadius,
        selectionColor,
      };
      this.pool.push(entry);
    } else {
      entry.squadId = squadId;
      entry.soldierId = soldierId;
      entry.screenX = screenX;
      entry.screenY = screenY;
      entry.angle = angle;
      entry.size = size;
      entry.image = image;
      entry.frame = frame;
      entry.selectionRadius = selectionRadius;
      entry.selectionColor = selectionColor;
    }
    this.entries.push(entry);
  }
  sort(): readonly SoldierDrawEntry[] {
    return this.entries.sort(
      (a, b) => a.squadId - b.squadId || a.soldierId - b.soldierId,
    );
  }
}
