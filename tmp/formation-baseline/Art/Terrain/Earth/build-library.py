"""Validate original terrain atlases and publish metadata; never edit their pixels.

Run from the repository root: python -B Art/Terrain/Earth/build-library.py
Requires Pillow, already listed in scripts/heightmap-requirements.txt.
"""

import hashlib
import json
from pathlib import Path

from PIL import Image


def build():
    root = Path(__file__).resolve().parent
    prompts = json.loads((root / "generation-prompts.json").read_text(encoding="utf-8"))
    atlases = []
    issues = []
    for spec in prompts["atlases"]:
        path = root / spec["file"]
        if not path.is_file():
            issues.append(f"Missing atlas: {spec['file']}")
            continue
        with Image.open(path) as image:
            if image.mode != "RGBA":
                raise ValueError(f"Atlas has no RGBA alpha: {path}")
            width, height = image.size
            if width != height or width % 2:
                raise ValueError(f"Atlas must have an even square size: {path}")
            cell = width // 2
            alpha = image.getchannel("A")
            transparent_pixels = alpha.histogram()[0]
            if transparent_pixels < width * height * 0.2:
                raise ValueError(f"Atlas has insufficient transparent space: {path}")
            slots = []
            for item in spec["items"]:
                x, y = item["column"] * cell, item["row"] * cell
                # Cropping here reads alpha bounds only. Originals are not saved
                # through Pillow or transformed into replacement sprite files.
                slot_alpha = alpha.crop((x, y, x + cell, y + cell))
                # Some generated PNGs contain alpha=1 noise throughout empty
                # space. Measure visible content at 8/255; preserve every source
                # pixel, including that noise, in the original file and preview.
                bounds = slot_alpha.point(lambda value: 255 if value >= 8 else 0).getbbox()
                if bounds is None:
                    raise ValueError(f"Empty slot: {path} {item['id']}")
                left, top, right, bottom = bounds
                margin = min(left, top, cell - right, cell - bottom)
                if margin < cell * 0.04:
                    raise ValueError(f"Sprite reaches cell edge: {path} {item['id']}")
                occupied_width, occupied_height = right - left, bottom - top
                # Keep the intended visible footprint consistent even when a
                # generation uses different amounts of empty cell padding.
                footprint = item["widthCells"]
                scale = footprint / max(occupied_width, occupied_height)
                slots.append({
                    "id": f"{spec['id']}.{item['id']}.v001",
                    "name": item["id"].replace("-", " "),
                    "description": item["description"],
                    "role": item["role"],
                    "sourceRect": [x, y, cell, cell],
                    "alphaBounds": [left, top, occupied_width, occupied_height],
                    "pivot": [(left + right) / 2, (top + bottom) / 2],
                    "visibleFootprintCells": footprint,
                    "imageSizeCells": [cell * scale, cell * scale],
                    "rotationAllowed": False,
                    "mirroringAllowed": False,
                    "minimumMarginPixels": margin,
                })
            atlases.append({
                "id": spec["id"],
                "name": spec["name"],
                "file": spec["file"],
                "groundPreview": spec["groundPreview"],
                "pixelSize": [width, height],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "slots": slots,
            })
    if issues:
        raise ValueError("\n".join(issues))
    manifest = {
        "schemaVersion": 1,
        "purpose": "terrain-art-catalog; integrated into skirmish presentation",
        "generatedWith": "built-in image_gen; transparent background requested",
        "originalPixelsPreserved": True,
        "promptFile": "generation-prompts.json",
        "coordinateConvention": "atlas and slot-local coordinates; upper-left origin",
        "placementSizeConvention": "largest occupied alpha dimension in terrain cells",
        "alphaBoundsThreshold": 8,
        "atlases": atlases,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    report = {
        "atlasCount": len(atlases),
        "spriteCount": sum(len(atlas["slots"]) for atlas in atlases),
        "rgba": True,
        "squareEvenDimensions": True,
        "noVisibleSpriteTouchesCellEdges": True,
        "alphaBoundsThreshold": 8,
        "originalPixelsPreserved": True,
        "checks": "File hashes, alpha channels, dimensions, nonempty slots, margins. No gameplay or geographic validation.",
        "totalBytes": sum((root / atlas["file"]).stat().st_size for atlas in atlases),
        "minimumMarginPixels": min(slot["minimumMarginPixels"] for atlas in atlases for slot in atlas["slots"]),
    }
    (root / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    build()
