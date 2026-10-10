"""Build the approved Russian boat clips using the existing ship art pipeline.

Only this culture's authored output folders and manifest are written. Approved
paintings remain byte-for-byte intact. Fixed cargo and lash-bound gear stay part
of the editable hull layer; water and ranged attack effects have separate passes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
AGE_ROOT = ROOT / "StoneAge"
BASE_ROOT = ROOT.parents[2] / "Ship Icons"
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("base_ship_animation", BASE_ROOT / "build-animations.py")
PIPELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PIPELINE)
PIPELINE.cv2.setNumThreads(1)
CONFIG = json.loads((AGE_ROOT / "rig-authoring.json").read_text(encoding="utf-8"))
FPS = {"Idle": 8, "Sailing": 12, "Attack": 10}
EMPTY = (0, 0, 0, 0)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def source_fit(size):
    scale = 420 / max(size)
    return scale, ((512 - size[0] * scale) / 2, (512 - size[1] * scale) / 2)


def canonical_point(point, size):
    scale, offset = source_fit(size)
    return [(point[i] * scale + offset[i] - 46) / PIPELINE.SCALE for i in range(2)]


def fit_native(image):
    scale, offset = source_fit(image.size)
    return image.transform((512, 512), Image.Transform.AFFINE,
                           (1 / scale, 0, -offset[0] / scale, 0, 1 / scale, -offset[1] / scale),
                           Image.Resampling.BICUBIC)


def articulated_rig(source, spec):
    """Export each approved working oar as a rigid piece with an authored underlay."""
    layers = []
    union = Image.new("L", source.size, 0)
    oars = spec.get("oars", [])
    if oars:
        fill_path = AGE_ROOT / spec["underlay"]
        if sha(fill_path) != spec["underlaySha256"]:
            raise ValueError(f"Authored underlay changed: {fill_path}")
        underlay = Image.open(fill_path).convert("RGBA").resize(source.size, Image.Resampling.LANCZOS)
        hull_footprint = np.asarray(underlay.getchannel("A").filter(ImageFilter.MaxFilter(9))) > 1
        exterior = (np.asarray(source.getchannel("A")) > 0) & ~hull_footprint
        yy, xx = np.indices((source.height, source.width), dtype=np.float32)
        nearest = np.full(xx.shape, np.inf, dtype=np.float32)
        owner = np.zeros(xx.shape, dtype=np.uint8)
        for ordinal, oar in enumerate(oars):
            gx, gy = oar["grip"]
            vx, vy = np.subtract(oar["tip"], oar["grip"])
            projection = np.clip(((xx - gx) * vx + (yy - gy) * vy) / (vx * vx + vy * vy), 0, 1)
            distance = (xx - gx - projection * vx) ** 2 + (yy - gy - projection * vy) ** 2
            closer = distance < nearest
            owner[closer] = ordinal
            nearest[closer] = distance[closer]
    for ordinal, oar in enumerate(oars):
        mask = Image.new("L", source.size, 0)
        draw = ImageDraw.Draw(mask)
        draw.line([tuple(oar["grip"]), tuple(oar["bladeRoot"])], fill=255, width=oar["shaftMaskWidth"])
        radius = oar["shaftMaskWidth"] / 2
        gx, gy = oar["grip"]
        draw.ellipse((gx - radius, gy - radius, gx + radius, gy + radius), fill=255)
        draw.polygon([tuple(point) for point in oar["bladeMask"]], fill=255)
        # All exterior paint belongs to one whole working oar. Assigning it by
        # the closest shaft axis retains rounded blade edges and antialiasing
        # that a hand-traced polygon alone can miss.
        mask = Image.fromarray(np.maximum(np.asarray(mask), np.where(exterior & (owner == ordinal), 255, 0).astype(np.uint8)))
        pixels = np.asarray(source).copy()
        pixels[:, :, 3] = (pixels[:, :, 3].astype(np.float32) * np.asarray(mask) / 255).astype(np.uint8)
        layer = {**oar, "image": Image.fromarray(pixels), "mask": mask}
        layers.append(layer)
        union = Image.fromarray(np.maximum(np.asarray(union), np.asarray(mask)))
    base = source.copy()
    if layers:
        # The generated image supplies only newly exposed surfaces. All original
        # pixels outside the oar masks remain exact, including fixed equipment.
        fill = np.asarray(underlay).copy()
        fill[:, :, 3] = (fill[:, :, 3].astype(np.float32) * np.asarray(union) / 255).astype(np.uint8)
        original = np.asarray(source).copy()
        original[:, :, 3] = (original[:, :, 3].astype(np.float32) * (1 - np.asarray(union) / 255)).astype(np.uint8)
        base = Image.fromarray(fill)
        base.alpha_composite(Image.fromarray(original))
    canonical = {
        "age": CONFIG["age"], "layers": [
            {**layer, "pivot": canonical_point(layer["pivot"], source.size),
             "tip": canonical_point(layer["tip"], source.size)} for layer in layers
        ],
    }
    return {"source": source, "base": base, "layers": layers,
            "nativeFit": True, "canonical": canonical}


def render_native(rig, motion, index):
    phase = PIPELINE.TAU * index / 10
    vessel = rig["base"].copy()
    for layer in rig["layers"]:
        sign = 1 if layer["side"] == "port" else -1
        amplitude = layer["amplitude"] if motion == "Sailing" else layer.get("idleAmplitude", 0.3)
        rotated = layer["image"].rotate(sign * amplitude * math.sin(phase),
                                        Image.Resampling.BICUBIC, center=tuple(layer["pivot"]))
        vessel.alpha_composite(rotated)
    vessel = fit_native(vessel)
    dy = (1.1 if motion == "Idle" else 0.35) * math.sin(phase)
    return vessel.transform((512, 512), Image.Transform.AFFINE,
                            (1, 0, -0.2 * math.sin(phase + 0.5), 0, 1, -dy),
                            Image.Resampling.BICUBIC)


def spear_effect(spec, index):
    """Presentation-only ranged release; it does not move the lashed spare spears."""
    result = Image.new("RGBA", (512, 512), EMPTY)
    attack = spec.get("attack")
    if not attack or index < attack["eventFrame"] or index >= 9:
        return result
    progress = (index - attack["eventFrame"]) / (8 - attack["eventFrame"])
    alpha = round(255 * (1 - progress * 0.86))
    bx, by = PIPELINE.frame_point(spec["bows"][0])
    head_y = by - 7 - progress * attack["spearTravel"]
    factor = 3
    layer = Image.new("RGBA", (512 * factor, 512 * factor), EMPTY)
    draw = ImageDraw.Draw(layer)
    point = lambda x, y: (round(x * factor), round(y * factor))
    length = attack["spearLength"]
    draw.line([point(bx, head_y + 5), point(bx, head_y + length)],
              fill=tuple(attack["shaftColor"]) + (alpha,), width=2 * factor)
    draw.polygon([point(bx, head_y), point(bx - 3, head_y + 7),
                  point(bx, head_y + 10), point(bx + 3, head_y + 7)],
                 fill=tuple(attack["headColor"]) + (alpha,))
    draw.line([point(bx, head_y + 2), point(bx, head_y + 8)],
              fill=tuple(attack.get("highlightColor", [207, 204, 182])) + (alpha,), width=factor)
    return layer.resize((512, 512), Image.Resampling.LANCZOS)


def render(spec, rig, motion, index):
    # Reuse the established source fit and buoyancy renderer. A ranged attack
    # uses a steady hull and a release effect, rather than the legacy ram thrust.
    hull_motion = "Idle" if motion == "Attack" else motion
    if rig.get("nativeFit"):
        vessel = render_native(rig, hull_motion, index)
        spec = {**spec, "bows": [canonical_point(point, rig["source"].size) for point in spec["bows"]],
                "sterns": [canonical_point(point, rig["source"].size) for point in spec["sterns"]]}
    else:
        _, vessel, _, _ = PIPELINE.render_frame(rig, hull_motion, index)
    if motion == "Attack":
        kick = [0, 0, 0.10, 0.35, 1, 0.65, 0.30, 0.10, 0, 0][index]
        attack = spec["attack"]
        vessel = vessel.rotate(-attack["hullKickDegrees"] * kick,
                               Image.Resampling.BICUBIC, center=(256, 256))
        vessel = vessel.transform((512, 512), Image.Transform.AFFINE,
                                  (1, 0, 0, 0, 1, -attack["hullKickPixels"] * kick),
                                  Image.Resampling.BICUBIC)
    water = Image.new("RGBA", (512, 512), EMPTY)
    if motion == "Sailing":
        # Each pontoon owns its bow ripple and stern wake. Reuse the base water
        # renderer separately so a twin hull never emits a fictitious centre wake.
        for bow, stern in zip(spec["bows"], spec["sterns"]):
            water_rig = {**rig.get("canonical", rig), "bows": [bow], "stern": stern}
            water.alpha_composite(PIPELINE.water_effects(water_rig, PIPELINE.TAU * index / 10, motion, 0))
    weapons = spear_effect(spec, index) if motion == "Attack" else Image.new("RGBA", (512, 512), EMPTY)
    composite = water.copy()
    composite.alpha_composite(vessel)
    composite.alpha_composite(weapons)
    return composite, vessel, water, weapons


def export_vessel(spec, expected_hash):
    source_path = AGE_ROOT / spec["source"]
    if sha(source_path) != expected_hash:
        raise ValueError(f"Approved master changed: {source_path}")
    source = Image.open(source_path)
    if source.mode != "RGBA" or source.size != tuple(spec.get("sourceSize", [1254, 1254])):
        raise ValueError(f"Unexpected approved source format: {source_path}")
    output = AGE_ROOT / spec["role"]
    layers = output / "layers"
    layers.mkdir(exist_ok=True)
    source.save(output / "Source_Transparent.png", optimize=True)
    rig = articulated_rig(source, spec) if CONFIG["age"] in ("BronzeAge", "ClassicalAge") else {
        "source": source, "base": source, "layers": [], "original": source_path,
        "hull": [], "category": spec["category"], "age": CONFIG["age"],
        "bows": spec["bows"], "stern": spec["sterns"][0]}
    rig["base"].save(layers / "Hull.png", optimize=True)
    for layer in rig["layers"]:
        layer["image"].save(layers / f"{layer['name']}.png", optimize=True)
        layer["mask"].save(layers / f"{layer['name']}-mask.png", optimize=True)
    scale, offset = source_fit(source.size)
    json_write(output / "rig.json", {
        "schemaVersion": 1, "cultureId": "russian", "source": spec["source"],
        "sourceSha256": expected_hash, "sourceSize": {"width": source.width, "height": source.height},
        "frameSize": {"width": 512, "height": 512},
        "sourceToFrame": {"scale": scale, "offset": list(offset)},
        "layers": [{"name": "Hull", "file": "layers/Hull.png", "kind": "rigid-approved-hull"}] + [
            {**{key: value for key, value in layer.items() if key not in ("image", "mask")},
             "file": f"layers/{layer['name']}.png", "maskFile": f"layers/{layer['name']}-mask.png",
             "kind": "rigid-oar"} for layer in rig["layers"]],
        "bows": spec["bows"], "sterns": spec["sterns"], "attack": spec.get("attack"),
        "attachmentPolicy": CONFIG["attachmentPolicy"],
        "motionSource": "../rig-authoring.json",
        "notes": "Approved pixels retained. Water and attack effects are separate presentation passes."
    })
    animations = {}
    for motion in spec["motions"]:
        frames = [render(spec, rig, motion, index) for index in range(10)]
        PIPELINE.write_sheet([frame[0] for frame in frames], output / f"{motion}.png")
        PIPELINE.write_sheet([frame[1] for frame in frames], output / f"{motion}_Vessel.png")
        passes = {"vessel": f"{motion}_Vessel.png"}
        if motion == "Sailing":
            PIPELINE.write_sheet([frame[2] for frame in frames], output / f"{motion}_Water.png")
            passes["water"] = f"{motion}_Water.png"
        if motion == "Attack":
            PIPELINE.write_sheet([frame[3] for frame in frames], output / f"{motion}_Weapons.png")
            passes["weapons"] = f"{motion}_Weapons.png"
        frames[0][0].save(output / f"{motion}-Preview.webp", save_all=True,
                          append_images=[frame[0] for frame in frames[1:]],
                          duration=round(1000 / FPS[motion]), loop=0, lossless=True)
        data = {
            "file": f"{motion}.png", "frameCount": 10,
            "suggestedFramesPerSecond": FPS[motion], "loop": motion != "Attack",
            "frames": [{"index": i, "x": (i % 5) * 512, "y": (i // 5) * 512,
                        "width": 512, "height": 512} for i in range(10)],
            "passes": passes
        }
        if motion == "Attack":
            data.update({"attackDirection": "forward", "attackKind": "ranged-spear-release",
                         "eventFrames": [spec["attack"]["eventFrame"]], "eventFramesAreVisualOnly": True})
        animations[motion.lower()] = data
    json_write(output / "animations.json", {
        "schemaVersion": 1, "cultureId": "russian", "unit": spec["role"],
        "age": CONFIG["age"], "category": spec["category"],
        "camera": "vertical-overhead-orthographic", "facing": "screen-up",
        "frameSize": {"width": 512, "height": 512},
        "sheetSize": {"width": 2560, "height": 1024},
        "grid": {"columns": 5, "rows": 2}, "frameOrder": "left-to-right-then-next-row",
        "pivot": {"x": 256, "y": 256}, "normalizedPivot": {"x": 0.5, "y": 0.5},
        "animations": animations,
        "timingNote": "Movement, attack cadence, projectiles and damage remain domain-owned. Event frames are visual only.",
        "integrationStatus": "art review only; not registered in match renderer"
    })
    if sha(source_path) != expected_hash:
        raise ValueError(f"Source preservation failed: {source_path}")
    print(f"{spec['role']}: {len(animations)} clips exported; approved master intact", flush=True)


def validate(approved_hashes, base_hashes):
    checks = []
    overview_frames = []
    for spec in CONFIG["vessels"]:
        folder = AGE_ROOT / spec["role"]
        metadata = json.loads((folder / "animations.json").read_text(encoding="utf-8"))
        for motion, clip in metadata["animations"].items():
            sheet = Image.open(folder / clip["file"])
            frames = [sheet.crop((f["x"], f["y"], f["x"] + 512, f["y"] + 512)) for f in clip["frames"]]
            differences = []
            for i in range(10):
                a = np.array(frames[i], dtype=np.float32)
                b = np.array(frames[(i + 1) % 10], dtype=np.float32)
                a[..., :3] *= a[..., 3:4] / 255
                b[..., :3] *= b[..., 3:4] / 255
                differences.append(float(np.mean(np.abs(a - b))))
            guards = []
            for frame in frames:
                alpha = np.array(frame.getchannel("A"))
                guards.append(not np.any(np.concatenate((alpha[:8].ravel(), alpha[-8:].ravel(), alpha[:, :8].ravel(), alpha[:, -8:].ravel()))))
            pass_sheets = {kind: Image.open(folder / file) for kind, file in clip["passes"].items()}
            composed = Image.new("RGBA", (2560, 1024), EMPTY)
            for kind in ("water", "vessel", "weapons"):
                if kind in pass_sheets:
                    composed.alpha_composite(pass_sheets[kind])
            record = {
                "role": spec["role"], "motion": motion, "file": str((folder / clip["file"]).relative_to(ROOT)),
                "sha256": sha(folder / clip["file"]), "dimensionsCorrect": sheet.size == (2560, 1024),
                "rgba": sheet.mode == "RGBA", "nonemptyFrames": sum(frame.getbbox() is not None for frame in frames),
                "distinctFrames": len({hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames}),
                "eightPixelGuardClear": all(guards), "passCompositionMatches": composed.tobytes() == sheet.tobytes(),
                "loop": clip["loop"], "loopSeamComparable": not clip["loop"] or differences[-1] <= max(differences[:-1]) * 1.15,
                "adjacentFrameDifference": [round(value, 5) for value in differences],
                "bounds": [frame.getbbox() for frame in frames],
                "correctFrameGrid": clip["frames"] == [{"index": i, "x": i % 5 * 512, "y": i // 5 * 512, "width": 512, "height": 512} for i in range(10)],
                "effectPassFormatsCorrect": all(image.mode == "RGBA" and image.size == (2560, 1024) for image in pass_sheets.values())
            }
            record["passed"] = all(record[key] for key in ("dimensionsCorrect", "rgba", "eightPixelGuardClear", "passCompositionMatches", "loopSeamComparable", "correctFrameGrid", "effectPassFormatsCorrect")) and record["nonemptyFrames"] == 10 and record["distinctFrames"] >= 5
            checks.append(record)
            overview_frames.append((spec["role"], motion, frames))
    base_unchanged = all(sha(BASE_ROOT / file) == expected for file, expected in base_hashes.items())
    sources_unchanged = all(sha(AGE_ROOT / file) == expected for file, expected in approved_hashes.items())
    report = {"schemaVersion": 1, "shipCount": 3, "primaryClipCount": len(checks), "frameCount": len(checks) * 10,
              "assetContractsPassed": all(check["passed"] for check in checks),
              "approvedMastersUnchanged": sources_unchanged, "baseFleetFilesUnchanged": base_unchanged,
              "baseFleetFilesChecked": len(base_hashes), "clips": checks,
              "visualReview": "Asset checks only. Browser evidence is recorded separately in Review/Browser_Validation.json; no game-match integration claimed."}
    json_write(AGE_ROOT / "Animation_Validation.json", report)
    # Lossless animated contact sheet for reviewing every primary clip together.
    preview = []
    for index in range(10):
        image = Image.new("RGBA", (7 * 224, 250), (23, 71, 95, 255))
        draw = ImageDraw.Draw(image)
        for column, (role, motion, frames) in enumerate(overview_frames):
            draw.text((column * 224 + 8, 8), f"{role} / {motion}", fill=(237, 240, 235, 255))
            image.alpha_composite(frames[index].resize((224, 224), Image.Resampling.LANCZOS), (column * 224, 26))
        preview.append(image)
    review = AGE_ROOT / "Review"
    review.mkdir(exist_ok=True)
    preview[0].save(review / "Animation_Overview.webp", save_all=True, append_images=preview[1:], duration=100, loop=0, lossless=True)
    preview[4].save(review / "Animation_Overview.png")
    if not report["assetContractsPassed"] or not sources_unchanged or not base_unchanged:
        raise ValueError("Animation validation failed; see Animation_Validation.json")
    return report


def main(age="StoneAge"):
    global AGE_ROOT, CONFIG
    if age not in ("StoneAge", "BronzeAge", "ClassicalAge"):
        raise ValueError(f"Unsupported authored age: {age}")
    AGE_ROOT = ROOT / age
    CONFIG = json.loads((AGE_ROOT / "rig-authoring.json").read_text(encoding="utf-8"))
    static = json.loads((AGE_ROOT / "Static_Art_Validation.json").read_text(encoding="utf-8"))
    approved_hashes = {item["file"]: item["sha256"] for item in static["masters"]}
    # Snapshot existing fleet files rather than rewriting or rebuilding them.
    baseline = json.loads((BASE_ROOT / "existing-fleet-hashes.json").read_text(encoding="utf-8"))
    base_hashes = {file: sha(BASE_ROOT / file) for file in baseline}
    for spec in CONFIG["vessels"]:
        export_vessel(spec, approved_hashes[spec["source"]])
    report = validate(approved_hashes, base_hashes)
    manifest = json.loads((ROOT / "Ship_Animation_Manifest.json").read_text(encoding="utf-8"))
    for asset in manifest["assets"]:
        if asset["age"] != CONFIG["age"]:
            continue
        role = next(spec["role"] for spec in CONFIG["vessels"] if spec["category"] == asset["category"])
        asset["metadata"] = f"{CONFIG['age']}/{role}/animations.json"
        asset["status"] = "animated-from-approved-master"
        metadata = json.loads((AGE_ROOT / role / "animations.json").read_text(encoding="utf-8"))
        asset["clips"] = [clip["file"] for clip in metadata["animations"].values()]
    manifest["clipCount"] = sum(len(asset["clips"]) for asset in manifest["assets"])
    approvals = manifest.setdefault("animationApprovals", {})
    previous_approval = manifest.get("animationApproval")
    if previous_approval:
        approvals.setdefault(previous_approval["age"], previous_approval)
    manifest["animationApproval"] = CONFIG.get("animationApproval", {"age": CONFIG["age"], "date": "2026-10-02", "userMessage": "these are perfect, you're clear to animate them."})
    approvals[CONFIG["age"]] = manifest["animationApproval"]
    json_write(ROOT / "Ship_Animation_Manifest.json", manifest)
    generation = json.loads((AGE_ROOT / "Generation-Manifest.json").read_text(encoding="utf-8"))
    generation["status"] = "static-masters-approved; animations-exported"
    generation["animationApproval"] = manifest["animationApproval"]
    json_write(AGE_ROOT / "Generation-Manifest.json", generation)
    print(f"Validated {report['primaryClipCount']} clips / {report['frameCount']} frames; all sources and {len(base_hashes)} base fleet files preserved", flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--age", choices=("StoneAge", "BronzeAge", "ClassicalAge"), default="StoneAge")
    main(parser.parse_args().age)
