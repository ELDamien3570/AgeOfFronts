// Pure art composition: local sprite slots and pose timing never move a game entity.
export const clipDuration = clip => clip.durations.reduce((sum, value) => sum + value, 0);

export function actorFrame(clip, timeMs, loop = clip.loop) {
  const duration = clipDuration(clip);
  let time = Math.max(0, timeMs);
  if (loop) time %= duration;
  else if (time >= duration) return clip.frameCount - 1;
  let boundary = 0;
  for (let index = 0; index < clip.durations.length; index++) {
    boundary += clip.durations[index];
    if (time < boundary) return index;
  }
  return clip.frameCount - 1;
}

const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, amount) => a + (b - a) * amount;

function layer(clips, id, time, weight = 1, frame) {
  const clip = clips.get(id);
  if (!clip) throw new Error("Missing actor clip: " + id);
  return { clipId: id, frame: frame === "last" ? clip.frameCount - 1 :
    typeof frame === "number" ? frame : actorFrame(clip, time), weight };
}

export function sampleFormation(definition, clips, id, elapsedMs) {
  const animation = definition.animations.find(item => item.id === id);
  if (!animation) throw new Error("Unknown formation animation: " + id);
  const elapsed = animation.loop ? Math.max(0, elapsedMs) % animation.durationMs :
    Math.max(0, Math.min(animation.durationMs, elapsedMs));
  const amount = animation.layoutFrom === animation.layoutTo ? 0 :
    smooth(elapsed / animation.layoutTransitionMs);
  return definition.members.map(member => {
    const from = definition.layouts[animation.layoutFrom][member.id];
    const to = definition.layouts[animation.layoutTo][member.id];
    const start = animation.memberStartMs?.[member.id] || 0;
    const local = elapsed - start;
    const source = clips.get(animation.source);
    let layers;
    if (local < 0) {
      layers = [layer(clips, animation.beforeSource || "idle", elapsed + member.phaseMs)];
    } else {
      const phase = source.loop ? member.phaseMs : 0;
      layers = [layer(clips, animation.source, local + phase)];
      if (animation.blendIn && local < animation.blendIn.durationMs) {
        const blend = smooth(local / animation.blendIn.durationMs);
        layers[0].weight = blend;
        layers.unshift(layer(clips, animation.blendIn.source,
          elapsed + member.phaseMs, 1 - blend, animation.blendIn.frame));
      }
      if (animation.blendOut && elapsed >= animation.durationMs - animation.blendOut.durationMs) {
        const blend = smooth((elapsed - (animation.durationMs - animation.blendOut.durationMs)) /
          animation.blendOut.durationMs);
        layers.forEach(item => item.weight *= 1 - blend);
        layers.push(layer(clips, animation.blendOut.source, member.phaseMs, blend));
      }
    }
    return { id: member.id, rank: member.rank, x: mix(from.x, to.x, amount),
      y: mix(from.y, to.y, amount), layers: layers.filter(item => item.weight > 0) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

// Canvas implementations are supplied by the browser or offline asset compiler.
// Blend each actor in an isolated buffer, so overlapping members never erase one another.
export function createFormationPainter(definition, clips, images, createCanvas) {
  const buffer = createCanvas(512, 512);
  const bufferContext = buffer.getContext("2d");
  bufferContext.imageSmoothingEnabled = true;
  bufferContext.imageSmoothingQuality = "high";
  return (context, id, timeMs, showSlots = false) => {
    const members = sampleFormation(definition, clips, id, timeMs);
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const member of members) {
      bufferContext.clearRect(0, 0, 512, 512);
      // Add premultiplied pose layers rather than painting a second translucent body over the first.
      bufferContext.globalCompositeOperation = "lighter";
      for (const pose of member.layers) {
        const clip = clips.get(pose.clipId), frame = clip.frames[pose.frame];
        const scale = definition.memberScale * (clip.scale || 1);
        const pivot = frame.pivot || { x: 256, y: 256 };
        bufferContext.globalAlpha = pose.weight;
        bufferContext.drawImage(images.get(pose.clipId), frame.x, frame.y, frame.width, frame.height,
          256 - pivot.x * scale, 256 - pivot.y * scale, frame.width * scale, frame.height * scale);
      }
      bufferContext.globalAlpha = 1;
      bufferContext.globalCompositeOperation = "source-over";
      context.drawImage(buffer, member.x - 256, member.y - 256);
      if (showSlots) {
        context.strokeStyle = "#efd29a"; context.lineWidth = 1;
        context.beginPath(); context.moveTo(member.x - 5, member.y); context.lineTo(member.x + 5, member.y);
        context.moveTo(member.x, member.y - 5); context.lineTo(member.x, member.y + 5); context.stroke();
      }
    }
    context.restore();
    return members;
  };
}

export function chargeReviewSteps(definition) {
  return definition.chargeSequence.phases.map(id => {
    const clip = definition.animations.find(item => item.id === id);
    return { id, label: clip.label, durationMs: clip.durationMs *
      (clip.loop ? definition.chargeSequence.reviewMaintainCycles : 1) };
  });
}

export function chargeReviewPose(definition, elapsedMs) {
  const steps = chargeReviewSteps(definition);
  let remaining = Math.max(0, elapsedMs);
  for (const [index, step] of steps.entries()) {
    if (remaining < step.durationMs) return { id: step.id, timeMs: remaining, phaseIndex: index, done: false };
    remaining -= step.durationMs;
  }
  const last = steps.at(-1);
  return { id: last.id, timeMs: last.durationMs, phaseIndex: steps.length - 1, done: true };
}
