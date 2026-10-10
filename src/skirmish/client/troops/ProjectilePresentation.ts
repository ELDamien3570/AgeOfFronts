/** Shared silhouettes for flying, grounded and embedded preview projectiles.
 * angle points toward the impact: tip forward, fletching behind. */
export function drawPreviewProjectile(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  angle: number,
  embedded = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const length =
    kind === "javelin"
      ? 36
      : kind === "bolt"
        ? 20
        : kind === "bow"
          ? 28
          : kind === "rocket"
            ? 22
            : 10;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#30281e";
  ctx.lineWidth = kind === "javelin" ? 3 : 2.8;
  ctx.beginPath();
  ctx.moveTo(-length, 0);
  ctx.lineTo(embedded ? -3 : -4, 0);
  ctx.stroke();
  ctx.strokeStyle =
    kind === "rocket" ? "#a0a79a" : kind === "bullet" ? "#f2d991" : "#c6a974";
  ctx.lineWidth = kind === "javelin" ? 1.8 : kind === "bolt" ? 2 : 1.4;
  ctx.beginPath();
  ctx.moveTo(-length, 0);
  ctx.lineTo(embedded ? -3 : -4, 0);
  ctx.stroke();
  if (!embedded && kind !== "bullet") {
    ctx.fillStyle = "#cbd0bf";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(kind === "javelin" ? -8 : -6, kind === "javelin" ? -2.5 : -3);
    ctx.lineTo(kind === "javelin" ? -8 : -6, kind === "javelin" ? 2.5 : 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#40483e";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  if (kind === "bow" || kind === "bolt") {
    const feather = kind === "bow" ? 6 : 3.5;
    ctx.fillStyle = kind === "bow" ? "#e2d8bc" : "#afc7bf";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-length + 1, 0);
      // Flat-cut rear edge and forward taper: never a backwards arrowhead.
      ctx.lineTo(-length + 1, side * (kind === "bow" ? 3 : 2));
      ctx.lineTo(-length + feather + 2, side);
      ctx.lineTo(-length + feather + 2, 0);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
