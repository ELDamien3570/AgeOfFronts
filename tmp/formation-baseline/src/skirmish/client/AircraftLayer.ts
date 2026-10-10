// Aircraft have their own Canvas2D surface above both the battlefield and the
// WebGL formation surface. Draw order inside either lower canvas cannot cross
// that compositing boundary. The layer never receives pointer input.
export class AircraftLayer {
  private readonly canvas = document.createElement("canvas");
  readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(base: HTMLCanvasElement) {
    this.canvas.className = "aircraft-layer";
    this.canvas.setAttribute("aria-hidden", "true");
    this.context = this.canvas.getContext("2d")!;
    base.parentElement!.append(this.canvas);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  clear(): void {
    this.context.clearRect(0, 0, this.width, this.height);
  }
}
