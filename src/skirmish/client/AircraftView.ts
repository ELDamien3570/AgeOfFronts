import type { ArtworkFrame } from "./UnitArtwork";

export class AircraftView {
  draw(
    ctx: CanvasRenderingContext2D,
    point: { x: number; y: number },
    pose: { angle: number; size: number; radius: number },
    frame: ArtworkFrame | undefined,
    color: string,
    selected: boolean,
  ): void {
    ctx.save();
    ctx.translate(point.x, point.y);
    if (selected) {
      ctx.beginPath();
      ctx.arc(0, 0, pose.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#c4ff36";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.rotate(pose.angle);
    if (frame) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        frame.source,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        -pose.size * frame.pivotX,
        -pose.size * frame.pivotY,
        pose.size,
        pose.size,
      );
    } else {
      // A plane silhouette while its artwork loads; no overlaid heading arrow.
      ctx.scale(pose.size / 28, pose.size / 28);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(2, -3);
      ctx.lineTo(12, 2);
      ctx.lineTo(12, 5);
      ctx.lineTo(2, 2);
      ctx.lineTo(2, 8);
      ctx.lineTo(5, 10);
      ctx.lineTo(5, 12);
      ctx.lineTo(0, 10);
      ctx.lineTo(-5, 12);
      ctx.lineTo(-5, 10);
      ctx.lineTo(-2, 8);
      ctx.lineTo(-2, 2);
      ctx.lineTo(-12, 5);
      ctx.lineTo(-12, 2);
      ctx.lineTo(-2, -3);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }
}
