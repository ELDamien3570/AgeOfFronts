import type {
  Point,
  TargetMarker,
  WeaponVisual,
} from "./CombatEffectsViewModel";

export class CombatEffectsView {
  projectile(
    ctx: CanvasRenderingContext2D,
    style: WeaponVisual,
    p: Point,
    angle: number,
    size = 4,
    opacity = 1,
  ): void {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.globalAlpha *= opacity;
    if (style === "stone") {
      const r = Math.max(3, Math.min(8, size));
      ctx.fillStyle = "#736954";
      ctx.strokeStyle = "#292d2d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(r * 0.3, r * 0.8);
      ctx.lineTo(-r * 0.8, r * 0.55);
      ctx.lineTo(-r, -r * 0.4);
      ctx.lineTo(r * 0.2, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#c4b895";
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.35);
      ctx.lineTo(r * 0.2, -r * 0.6);
      ctx.stroke();
    } else if (style === "shell" || style === "rocket" || style === "bomb") {
      const r = Math.max(3, Math.min(7, size));
      if (style !== "bomb") {
        const trail = ctx.createLinearGradient(-r * 7, 0, 0, 0);
        trail.addColorStop(0, "#ddd6c600");
        trail.addColorStop(1, style === "rocket" ? "#ffbc7199" : "#cbc5b577");
        ctx.fillStyle = trail;
        ctx.fillRect(-r * 7, -r * 0.45, r * 7, r * 0.9);
      }
      ctx.fillStyle = style === "bomb" ? "#373d44" : "#a7acac";
      ctx.strokeStyle = "#252f36";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 1.5, 0);
      ctx.lineTo(r * 0.4, -r * 0.6);
      ctx.lineTo(-r, -r * 0.6);
      ctx.lineTo(-r, r * 0.6);
      ctx.lineTo(r * 0.4, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#f2dfaa";
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.4);
      ctx.lineTo(r * 0.4, -r * 0.4);
      ctx.stroke();
    } else {
      ctx.lineWidth = style === "bullet" ? 1 : 1.5;
      ctx.strokeStyle =
        style === "bullet"
          ? "#fff3b499"
          : style === "arrow"
            ? "#af7743"
            : "#fff0bd";
      const length =
        style === "bullet"
          ? 13
          : style === "javelin"
            ? 12
            : style === "arrow"
              ? 10
              : 8;
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(3, 0);
      ctx.stroke();
      if (style !== "bullet") {
        ctx.strokeStyle = "#e4e4cb";
        ctx.beginPath();
        ctx.moveTo(-1, -2);
        ctx.lineTo(3, 0);
        ctx.lineTo(-1, 2);
        if (style === "arrow") {
          ctx.moveTo(-length, -2);
          ctx.lineTo(-length + 3, 0);
          ctx.lineTo(-length, 2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  muzzle(
    ctx: CanvasRenderingContext2D,
    p: Point,
    progress: number,
    angle: number,
  ): void {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.globalAlpha *= (1 - progress) * 0.75;
    ctx.fillStyle = "#f8c26b";
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.lineTo(7 * (1 - progress), 0);
    ctx.lineTo(-2, 2);
    ctx.fill();
    ctx.fillStyle = "#ccc7b244";
    ctx.beginPath();
    ctx.arc(-2, 0, 3 + progress * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  melee(
    ctx: CanvasRenderingContext2D,
    p: Point,
    attackAge: number,
    seed: number,
  ): void {
    const phase = (attackAge - 8) / 5;
    if (phase < 0 || phase >= 1) return;
    ctx.save();
    ctx.globalAlpha *= (1 - phase) * 0.75;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffe6a6";
    ctx.beginPath();
    for (let n = 0; n < 4; n++) {
      const a = (n * Math.PI) / 2 + (seed % 7),
        r = 2 + phase * 5;
      ctx.moveTo(p.x + Math.cos(a) * r * 0.35, p.y + Math.sin(a) * r * 0.35);
      ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.restore();
  }
  target(
    ctx: CanvasRenderingContext2D,
    target: TargetMarker,
    p: Point,
    tick: number,
  ): void {
    const r = 12 + Math.sin(tick / 8),
      color =
        target.kind === "missile"
          ? "#ffa787"
          : target.kind === "bombing"
            ? "#ffd783"
            : "#eec390";
    ctx.save();
    ctx.strokeStyle = "#1c252ccc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.moveTo(p.x + x * r, p.y + y * (r - 5));
      ctx.lineTo(p.x + x * r, p.y + y * r);
      ctx.lineTo(p.x + x * (r - 5), p.y + y * r);
    }
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y);
    ctx.lineTo(p.x + 4, p.y);
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x, p.y + 4);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.translate(p.x, p.y + r + 8);
    ctx.beginPath();
    if (target.kind === "missile") {
      ctx.moveTo(0, -5);
      ctx.lineTo(3, 1);
      ctx.lineTo(3, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-3, 5);
      ctx.lineTo(-3, 1);
      ctx.closePath();
    } else if (target.kind === "bombing") {
      ctx.ellipse(0, 1, 3, 4, -0.5, 0, Math.PI * 2);
      ctx.moveTo(-3, -3);
      ctx.lineTo(-5, -5);
      ctx.lineTo(0, -5);
    } else {
      ctx.arc(0, -1, 3, 0, Math.PI * 2);
      ctx.moveTo(-5, 5);
      ctx.lineTo(5, 5);
      ctx.moveTo(-4, 5);
      ctx.lineTo(0, -1);
      ctx.lineTo(4, 5);
    }
    ctx.strokeStyle = "#1c252c";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
