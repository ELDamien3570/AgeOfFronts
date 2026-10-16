// Shared deterministic art-preview renderer, also used to export the PNG sheets.
// Positions are visual authoring coordinates, with no gameplay authority.
export const FRAME_COUNT = 20;
export const FPS = 20;
export const CLIPS = { carrier: ['Idle', 'Sailing'], drone: ['Idle', 'Hover', 'Flight'] };

function imageFit(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
}

export function renderClip(ctx, images, kind, clip, frame, size = 512) {
  ctx.save();
  ctx.scale(size / 512, size / 512);
  const phase = (frame % FRAME_COUNT) / FRAME_COUNT * Math.PI * 2;
  if (kind === 'carrier') {
    if (clip === 'Sailing') {
      // Water is separate from the hull so it can be replaced by the game's sea effects.
      for (let j = 0; j < 9; j++) {
        const t = (j / 9 + frame / FRAME_COUNT) % 1;
        ctx.strokeStyle = `rgba(206,235,231,${0.28 * (1 - t)})`;
        ctx.lineWidth = 1 + 2 * (1 - t);
        ctx.beginPath();
        ctx.ellipse(256, 445 + t * 53, 27 + t * 42, 3 + t * 8, 0, 0, Math.PI);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(208,235,231,.24)';
      ctx.lineWidth = 1.5;
      for (const sign of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(256 + sign * 26, 54);
        ctx.quadraticCurveTo(256 + sign * 68, 220, 256 + sign * 76, 425);
        ctx.stroke();
      }
    }
    imageFit(ctx, images.carrier, 256, 247 + Math.sin(phase) * .45, 310, 450);
  } else {
    const moving = clip !== 'Idle';
    const bob = moving ? Math.sin(phase) * 1.4 : 0;
    ctx.translate(256, 256 + bob);
    if (clip === 'Flight') ctx.rotate(Math.sin(phase) * .012);
    ctx.translate(-256, -256);
    const box = 400, left = 56;
    imageFit(ctx, moving ? images.droneBody : images.drone, 256, 256, box, box);
    if (moving) {
      const hubs = [[.193,.226], [.806,.226], [.193,.743], [.806,.743]];
      for (const [i, hub] of hubs.entries()) {
        const x = left + box * hub[0], y = left + box * hub[1];
        const radius = 76;
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = 'rgba(118,126,121,.12)';
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        // Opposite rotor pairs spin in opposite directions; three faint shutter poses.
        for (let k = 2; k >= 0; k--) {
          ctx.save();
          ctx.rotate(phase * 3 * (i % 2 ? -1 : 1) + i * .8 - k * .3);
          ctx.globalAlpha = k === 0 ? .72 : .14;
          ctx.fillStyle = '#464b48'; ctx.strokeStyle = '#79817b'; ctx.lineWidth = .7;
          for (const sign of [-1, 1]) {
            ctx.beginPath(); ctx.ellipse(sign * 38, 0, 37, 7, 0, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
          }
          ctx.restore();
        }
        ctx.fillStyle = '#91958c'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}
