/** One cached ground overlay; no per-frame terrain or contamination scan. */
export class NuclearWastelandView {
  private source?: Uint32Array;
  private canvas?: HTMLCanvasElement;
  draw(
    ctx: CanvasRenderingContext2D,
    tiles: Uint32Array | undefined,
    mapWidth: number,
    mapHeight: number,
    scale: number,
    x: number,
    y: number,
  ): void {
    if (tiles !== this.source) {
      this.source = tiles;
      if (!tiles?.length) this.canvas = undefined;
      else {
        const canvas = this.canvas ?? document.createElement("canvas");
        canvas.width = mapWidth;
        canvas.height = mapHeight;
        const ground = canvas.getContext("2d")!;
        for (const tile of tiles) {
          ground.fillStyle =
            ((tile * 2654435761) >>> 0) % 3 === 0 ? "#595c32b8" : "#292820b8";
          ground.fillRect(tile % mapWidth, Math.floor(tile / mapWidth), 1, 1);
        }
        this.canvas = canvas;
      }
    }
    if (this.canvas) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.canvas, x, y, mapWidth * scale, mapHeight * scale);
      ctx.restore();
    }
  }
}
