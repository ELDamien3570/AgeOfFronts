"""Inspect generated sheets without modifying image pixels."""
from pathlib import Path
from PIL import Image
import hashlib
import json

ROOT = Path(__file__).resolve().parent
metadata = json.loads((ROOT / "animations.json").read_text(encoding="utf-8"))
rows = []
failures = []
for clip in metadata["animations"]:
    path = ROOT / clip["file"]
    image = Image.open(path)
    if image.mode != "RGBA" or image.size != (1536, 1024):
        failures.append(clip["id"] + ": expected RGBA 1536x1024")
        continue
    alpha = image.getchannel("A")
    frame_rows = []
    hashes = []
    for frame in clip["frames"]:
        x, y, width, height = (frame[key] for key in ("x", "y", "width", "height"))
        box = (x, y, x + width, y + height)
        crop = image.crop(box)
        cropped_alpha = alpha.crop(box)
        visible = cropped_alpha.point(lambda value: 255 if value > 16 else 0)
        bounds = visible.getbbox()
        guard_boxes = [(0, 0, width, 8), (0, height-8, width, height),
                       (0, 0, 8, height), (width-8, 0, width, height)]
        maximum = max(cropped_alpha.crop(guard).getextrema()[1] for guard in guard_boxes)
        if maximum > 16:
            failures.append(clip["id"] + ": visible art crosses frame guard " + str(frame["index"]))
        if bounds is None:
            failures.append(clip["id"] + ": empty frame " + str(frame["index"]))
        digest = hashlib.sha256(crop.tobytes()).hexdigest()
        hashes.append(digest)
        frame_rows.append({"index": frame["index"], "visibleBounds": bounds,
                           "guardAlphaMax": maximum, "sha256": digest})
    if len(set(hashes)) < 5:
        failures.append(clip["id"] + ": fewer than five distinct pixel frames")
    if alpha.getextrema()[0] != 0:
        failures.append(clip["id"] + ": no fully transparent background")
    rows.append({"id": clip["id"], "file": clip["file"], "size": image.size,
                 "mode": image.mode, "alphaExtrema": alpha.getextrema(),
                 "uniqueFrames": len(set(hashes)), "frames": frame_rows,
                 "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
report = {"stage": "single-actor-art-prototype",
          "checks": "RGBA, dimensions, transparency, distinct frames, visible artwork within eight-pixel guards, hashes",
          "guardAlphaTolerance": 16,
          "guardNote": "Generated sheets can contain alpha 1 residue. This checks visible spill; it is not a zero-alpha atlas certification.",
          "visualApproval": "pending user review",
          "engineIntegration": "not integrated",
          "failures": failures, "sheets": rows}
(ROOT / "Validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sheets": len(rows), "failures": failures,
                  "maxGuardAlpha": max(frame["guardAlphaMax"] for row in rows for frame in row["frames"])}))
raise SystemExit(1 if failures else 0)
