import fs from "node:fs";
import path from "node:path";

// A successful bundle can still contain LFS pointer text in place of images.
// Validate the exact Docker build inputs before Vite embeds their URLs.
const pointer = Buffer.from("version https://git-lfs.github.com/spec/v1");
const unresolved = [];
function visit(file) {
  if (fs.statSync(file).isDirectory()) {
    for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    return;
  }
  const descriptor = fs.openSync(file, "r");
  const prefix = Buffer.alloc(pointer.length);
  try {
    if (fs.readSync(descriptor, prefix, 0, prefix.length, 0) === pointer.length && prefix.equals(pointer))
      unresolved.push(file);
  } finally {
    fs.closeSync(descriptor);
  }
}
for (const root of process.argv.slice(2)) visit(root);
if (unresolved.length) {
  console.error("Unresolved Git LFS assets:\n" + unresolved.join("\n"));
  process.exitCode = 1;
}
