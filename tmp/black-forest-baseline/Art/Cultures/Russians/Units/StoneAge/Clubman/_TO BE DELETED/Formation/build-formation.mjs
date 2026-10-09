import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createFormationPainter, clipDuration, sampleFormation } from "./formation-composition.js";

// An optional target folder allows other troops to use the same asset compiler.
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.dirname(fileURLToPath(import.meta.url));
const definition = JSON.parse(await fs.readFile(path.join(root, "formation.json"), "utf8"));
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(process.env.ART_CANVAS_MODULE || "@napi-rs/canvas");
const clips = new Map(), images = new Map(), sources = [], failures = [];
const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");

function inspect(canvas, guard = 8) {
  const { width, height } = canvas;
  const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1, guardAlphaMax = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (x < guard || y < guard || x >= width - guard || y >= height - guard)
      guardAlphaMax = Math.max(guardAlphaMax, alpha);
    if (alpha > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  return { visibleBounds: right < 0 ? null : [left, top, right + 1, bottom + 1], guardAlphaMax };
}

for (const relative of definition.actorSources) {
  const metadataPath = path.resolve(root, relative);
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  for (const clip of metadata.animations) {
    const imagePath = path.resolve(path.dirname(metadataPath), clip.file);
    const bytes = await fs.readFile(imagePath), image = await loadImage(imagePath);
    if (image.width !== metadata.sheetSize.width || image.height !== metadata.sheetSize.height)
      failures.push(clip.id + ": incorrect source dimensions");
    const frames = [];
    for (const frame of clip.frames) {
      const canvas = createCanvas(frame.width, frame.height), context = canvas.getContext("2d");
      context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
      const result = inspect(canvas);
      if (!result.visibleBounds || result.guardAlphaMax > 16) failures.push(clip.id + ": unsafe source frame " + frame.index);
      frames.push({ index: frame.index, ...result });
    }
    if (clips.has(clip.id)) failures.push("Duplicate source clip: " + clip.id);
    clips.set(clip.id, clip); images.set(clip.id, image);
    sources.push({ id: clip.id, path: path.relative(root, imagePath).replaceAll("\\", "/"), sha256: sha256(bytes), frames });
  }
}
if (failures.length) throw new Error(failures.join("\n"));
if (definition.members.length !== 5) throw new Error("This formation requires exactly five members");

const painter = createFormationPainter(definition, clips, images, createCanvas);
const metadata = { schemaVersion: 1, cultureId: definition.cultureId, age: definition.age,
  unit: definition.unit, actorCount: 5, groupMemberCount: 5, stage: "formation-art-prototype",
  integrationStatus: "Art review and baked atlases only; gameplay charge events are not wired yet.",
  camera: definition.camera, facing: definition.facing, frameSize: definition.frameSize,
  pivot: definition.pivot, normalizedPivot: { x: 0.5, y: 0.5 },
  registration: "Five copies of the source actor with authored position, phase and reaction-delay tracks.",
  animations: [], chargeSequence: definition.chargeSequence };
const sheets = [];

for (const animation of definition.animations) {
  const count = Math.max(2, Math.ceil(animation.durationMs * definition.sampleFramesPerSecond / 1000));
  const columns = definition.atlasColumns, rows = Math.ceil(count / columns);
  const atlas = createCanvas(columns * 512, rows * 512), context = atlas.getContext("2d");
  const frameCanvas = createCanvas(512, 512), frameContext = frameCanvas.getContext("2d");
  const frames = [], frameChecks = [];
  for (let index = 0; index < count; index++) {
    const timeMs = animation.durationMs * index / (animation.loop ? count : count - 1);
    frameContext.clearRect(0, 0, 512, 512);
    const members = painter(frameContext, animation.id, timeMs);
    const result = inspect(frameCanvas);
    if (members.length !== 5 || !result.visibleBounds || result.guardAlphaMax > 16)
      failures.push(animation.id + ": invalid composition frame " + index);
    const x = (index % columns) * 512, y = Math.floor(index / columns) * 512;
    context.drawImage(frameCanvas, x, y);
    frames.push({ index, x, y, width: 512, height: 512, pivot: definition.pivot, timeMs });
    frameChecks.push({ index, timeMs, ...result, members: members.map(member => ({id:member.id, x:member.x, y:member.y,
      poses:member.layers.map(pose => ({clipId:pose.clipId, frame:pose.frame, weight:pose.weight}))})) });
  }
  const file = animation.file, bytes = await atlas.encode("png");
  await fs.writeFile(path.join(root, file), bytes);
  const source = clips.get(animation.source);
  const impact = animation.id === "charge-attack" && source.impactFrame !== undefined ?
    clipDuration({durations:source.durations.slice(0, source.impactFrame)}) : undefined;
  const release = source.releaseFrame === undefined ? undefined :
    clipDuration({durations:source.durations.slice(0, source.releaseFrame)});
  metadata.animations.push({ id: animation.id, label: animation.label, description: animation.description,
    file, loop: animation.loop, frameCount: count, durationMs: animation.durationMs,
    durations: Array(count).fill(animation.durationMs / count), scale: 1,
    sheetSize: {width:atlas.width,height:atlas.height}, grid:{columns,rows}, frames,
    ...(impact === undefined ? {} : {presentationStrikeMarkers:definition.members.map(member =>
      ({memberId:member.id,timeMs:(animation.memberStartMs?.[member.id]||0)+impact}))}),
    ...(release === undefined ? {} : {presentationReleaseMarkers:definition.members.map(member =>
      ({memberId:member.id,timeMs:(animation.memberStartMs?.[member.id]||0)+release}))}) });
  sheets.push({ id: animation.id, file, frameCount: count, sheetSize:{width:atlas.width,height:atlas.height},
    sha256: sha256(bytes), frames: frameChecks });
}
const deathEnd = sampleFormation(definition, clips, "death", Infinity);
const death = definition.animations.find(item => item.id === "death");
const deathSources = new Set(definition.members.map(member => death.memberSources?.[member.id] || death.source));
if (deathSources.size < (definition.minimumDeathVariants || 1))
  failures.push("Too few distinct authored death motions");
if (deathEnd.some(member => member.layers.some(pose => {
  const expected = death.memberSources?.[member.id] || death.source;
  return pose.clipId !== expected || pose.frame !== clips.get(expected).frameCount - 1;
})))
  failures.push("Death must end with all five members on their final death pose");
const report = {stage:"formation-art-prototype",compositionSource:"formation.json",memberCount:5,
  deathMotionCount:deathSources.size,deathAssignments:deathEnd.map(member=>({id:member.id,source:member.layers[0].clipId})),
  sourceActors:sources,sheets,failures,alphaGuardThreshold:16,
  visualApproval:"pending user review",engineIntegration:"not integrated"};
await fs.writeFile(path.join(root,"Validation.json"),JSON.stringify(report,null,2)+"\n");
if (failures.length) throw new Error(failures.join("\n"));
await fs.writeFile(path.join(root,"animations.json"),JSON.stringify(metadata,null,2)+"\n");
const preview = createCanvas(256, 256), previewContext = preview.getContext("2d");
previewContext.scale(0.5, 0.5);
painter(previewContext, "charge-maintain", 0);
await fs.writeFile(path.join(root, "Preview.png"), await preview.encode("png"));
console.log(JSON.stringify({sheets:sheets.length,members:5,frames:sheets.reduce((sum,item)=>sum+item.frameCount,0),failures,
  maxGuardAlpha:Math.max(...sheets.flatMap(sheet=>sheet.frames.map(frame=>frame.guardAlphaMax)))}));
