/** Screen layout shared by the GPU, Canvas fallback and review page.
 * The field is never enlarged for readability; only its contents are fitted. */
export function formationMarkerLayout(
  width: number,
  height: number,
  symbol?: { width: number; height: number },
) {
  const shortSide = Math.min(width, height);
  const border = Math.min(0.75, shortSide * 0.06);
  const inset = Math.min(1.25, shortSide * 0.1);
  const facingHeight = Math.min(2.5, height * 0.12);
  const fit = symbol
    ? Math.max(
        0,
        Math.min(
          (width - inset * 2) / symbol.width,
          (height - inset * 2 - facingHeight) / symbol.height,
          24 / Math.max(symbol.width, symbol.height),
        ),
      )
    : 0;
  return {
    symbolWidth: symbol ? symbol.width * fit : 0,
    symbolHeight: symbol ? symbol.height * fit : 0,
    border,
    facingWidth: Math.min(5, width * 0.2),
    facingHeight,
    symbolOffsetY: facingHeight / 2,
  };
}

const contrastCache = new Map<number, boolean>();
/** Pick the greater contrast against the solid faction field. Cache by RGB so
 * a palette reassignment cannot leave stale ink and squads share the calculation. */
export function formationSymbolLight(rgb: readonly number[]): boolean {
  const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  const cached = contrastCache.get(key);
  if (cached !== undefined) return cached;
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const light = 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05;
  if (contrastCache.size >= 256) contrastCache.clear();
  contrastCache.set(key, light);
  return light;
}

export type FormationMarkerLayout = ReturnType<typeof formationMarkerLayout>;

/** All decoration stays inside the actual oriented footprint. */
export function drawFormationMarker(
  ctx: CanvasRenderingContext2D,
  box: { width: number; height: number; angle: number },
  center: { x: number; y: number },
  color: string,
  ink: string,
  layout: FormationMarkerLayout,
  symbol?: {
    source: HTMLCanvasElement;
    x: number;
    y: number;
    width: number;
    height: number;
  },
  opacity = 1,
  selection?: string,
) {
  ctx.save();
  ctx.translate(center.x, center.y);
  // Authored symbols face up; formation forward is local positive Y.
  ctx.rotate(box.angle + Math.PI);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
  if (symbol && layout.symbolWidth > 0 && layout.symbolHeight > 0) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      symbol.source,
      symbol.x,
      symbol.y,
      symbol.width,
      symbol.height,
      -layout.symbolWidth / 2,
      -layout.symbolHeight / 2 + layout.symbolOffsetY,
      layout.symbolWidth,
      layout.symbolHeight,
    );
  }
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(0, -box.height / 2 + layout.border);
  ctx.lineTo(
    -layout.facingWidth / 2,
    -box.height / 2 + layout.border + layout.facingHeight,
  );
  ctx.lineTo(
    layout.facingWidth / 2,
    -box.height / 2 + layout.border + layout.facingHeight,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = selection ?? ink;
  const stroke = selection
    ? Math.min(1.5, Math.min(box.width, box.height) * 0.15)
    : layout.border;
  ctx.lineWidth = stroke;
  ctx.strokeRect(
    -box.width / 2 + stroke / 2,
    -box.height / 2 + stroke / 2,
    box.width - stroke,
    box.height - stroke,
  );
  ctx.restore();
}
