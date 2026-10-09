import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createFormationPainter } from "../../Clubman/Formation/formation-composition.js";

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(process.env.ART_CANVAS_MODULE || "@napi-rs/canvas");
const definition = JSON.parse(await fs.readFile(path.join(root, "formation.json"), "utf8"));
const clips = new Map(), images = new Map();
for (const relative of definition.actorSources) {
  const metadataPath = path.resolve(root, relative);
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  for (const clip of metadata.animations) {
    clips.set(clip.id, clip);
    images.set(clip.id, await loadImage(path.resolve(path.dirname(metadataPath), clip.file)));
  }
}
const painter = createFormationPainter(definition, clips, images, createCanvas);
const canvas = createCanvas(512, 512), context = canvas.getContext("2d");
context.fillStyle = "#304933";
context.fillRect(0, 0, 512, 512);
painter(context, "death", Infinity);
await fs.writeFile(path.join(root, "Death-Preview.png"), await canvas.encode("png"));
