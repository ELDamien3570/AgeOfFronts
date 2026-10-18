"""Deterministic rigid vehicle layers, shared by the actor baker and artwork audit.

Generated pose sheets contain independently redrawn hulls. They cannot be made
rigid with scale compensation. Keep one source hull and animate surface textures
and effects without ever resampling its geometry between animation states.
"""
import hashlib
import json
import math
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageDraw

SIZE = 256
CLIPS = ("idle", "running", "attack", "death", "hit")
# Explicit wheel/track texture windows, normalized to the canonical body bounds.
# Keep bed rails, missile racks, turret and exposed weapons out of moving masks.
SURFACE_REGIONS = {
    "MachineGunTruck": [(0, .49, .13, .61), (.87, .49, 1, .61), (0, .76, .13, .94), (.87, .76, 1, .94)],
    "TsarTank": [(0, .14, .10, 1), (.90, .14, 1, 1)],
    "T34-85": [(0, .02, .14, .83), (.86, .02, 1, .83)],
    "T14": [(0, .02, .13, .87), (.87, .02, 1, .87)],
    "Bumerang": [(0, .06, .13, .27), (.87, .06, 1, .27), (0, .30, .13, .46), (.87, .30, 1, .46), (0, .49, .13, .66), (.87, .49, 1, .66), (0, .69, .13, .87), (.87, .69, 1, .87)],
    "Tunguska": [(0, .12, .09, .97), (.91, .12, 1, .97)],
    "WheeledSAM_Modern": [(0, .16, .14, .83), (.86, .16, 1, .83)],
}
# Sockets are authored on the canonical 256px image, not on a different clip's
# canvas. In particular Tunguska's off-center source pivots cannot be reused.
MUZZLES = {
    "MachineGunTruck": [(128, 138)], "TsarTank": [(145, 159)],
    "T34-85": [(128, 240)], "Bumerang": [(128, 208)],
    "T14": [(128, 240)], "Tunguska": [(106, 215), (147, 215)],
    "WheeledSAM_Modern": [(128, 64)],
}


def opaque_bounds(image):
    return image.getchannel("A").point(lambda a: 255 if a > 96 else 0).getbbox()


def prepare_vehicle(root, source, data, clips, target, calibration, atomic_image, atomic_text):
    idle = clips["idle"]
    frame = idle["frames"][0]
    path = source.parent / (frame.get("sheet") or idle.get("file"))
    original = Image.open(path).convert("RGBA").crop((frame["x"], frame["y"], frame["x"] + frame["width"], frame["y"] + frame["height"]))
    bounds = opaque_bounds(original)
    if bounds is None:
        raise ValueError(f"Missing canonical vehicle body: {source}")
    # One uniform transform for the entire vehicle. Rectangular originals must
    # never be stretched into square frames (notably Bumerang's 1024x1536 idle).
    ratio = 224 / max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    crop = original.crop(bounds)
    crop = crop.resize((round(crop.width * ratio), round(crop.height * ratio)), Image.Resampling.LANCZOS)
    body = Image.new("RGBA", (SIZE, SIZE))
    offset = ((SIZE - crop.width) // 2, (SIZE - crop.height) // 2)
    body.paste(crop, offset)
    alpha = body.getchannel("A")
    box = opaque_bounds(body)
    release_points = [{"x": x / SIZE, "y": y / SIZE} for x, y in MUZZLES[source.parent.name]]
    # Only outer wheel/track surfaces may change. The chassis, turret, weapons,
    # insignia and all alpha coverage are immutable, including on death.
    mask = Image.new("L", body.size)
    regions = SURFACE_REGIONS[source.parent.name]
    draw = ImageDraw.Draw(mask)
    for x0, y0, x1, y1 in regions:
        draw.rectangle((round(box[0] + x0 * (box[2] - box[0])), round(box[1] + y0 * (box[3] - box[1])),
                        round(box[0] + x1 * (box[2] - box[0])) - 1, round(box[1] + y1 * (box[3] - box[1])) - 1), fill=255)
    mask = ImageChops.multiply(mask, alpha)
    audit = target / "audit"
    audit.mkdir(exist_ok=True)
    atomic_image(audit / "body.png", body)
    atomic_image(audit / "surface-mask.png", mask.convert("RGBA"))
    hashes = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()}
    # Reuse the approved artillery explosion rather than generating a different
    # vehicle hull for each destruction pose. The last frame holds a rigid wreck.
    effects_root = root / "Art/Runtime/Ages"
    effect_manifest = effects_root / "manifest.json"
    effect = json.loads(effect_manifest.read_text())["impact-shell"]["clips"]["detonate"]
    effect_path = effects_root / effect["file"]
    explosion = Image.open(effect_path).convert("RGBA")
    hashes[effect_path.relative_to(root).as_posix()] = hashlib.sha256(effect_path.read_bytes()).hexdigest()
    runtime = {"actorCount": 1, "source": source.relative_to(root).as_posix(),
               "metadataHash": hashlib.sha256(source.read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
               "hashes": hashes, "rigidBody": {"version": 1, "file": "audit/body.png", "surfaceMask": "audit/surface-mask.png",
               "bounds": list(box), "pivot": {"x": 128, "y": 128}, "sourceFrame": 0,
               "sourceClip": "idle", "sourceBounds": list(bounds)}, "animations": []}
    # Frame count, attack release and durations still come from the authored clip.
    # Only visual content changes; no domain timing is authored here.
    for name in CLIPS:
        if name not in clips:
            continue
        clip = clips[name]
        count = len(clip["frames"])
        columns = min(6, count)
        atlas = Image.new("RGBA", (columns * SIZE, math.ceil(count / columns) * SIZE))
        baked = []
        effect_atlas = Image.new("RGBA", atlas.size)
        body_atlas = Image.new("RGBA", atlas.size)
        for i in range(count):
            pose = body.copy()
            fx_layer = Image.new("RGBA", body.size)
            if name == "running":
                # Scroll source tread texture through a fixed silhouette mask.
                surface = ImageChops.offset(body, 0, (i % 6) * 2)
                surface.putalpha(alpha)
                pose = Image.composite(surface, body, mask)
                pose.putalpha(alpha)
            if name == "attack":
                # Preserve the authored muzzle flash as a separate effect. Select
                # hot luminous pixels, then include their immediate glow/core;
                # never composite another independently drawn chassis.
                authored_frame = clip["frames"][i]
                authored_path = source.parent / (authored_frame.get("sheet") or clip.get("file"))
                hashes[authored_path.relative_to(root).as_posix()] = hashlib.sha256(authored_path.read_bytes()).hexdigest()
                shot = Image.open(authored_path).convert("RGBA").crop((authored_frame["x"], authored_frame["y"], authored_frame["x"] + authored_frame["width"], authored_frame["y"] + authored_frame["height"]))
                hot = Image.new("L", shot.size)
                hot.putdata([255 if a > 80 and r > 220 and 100 < g < 220 and b < 140 and r > g * 1.2 else 0 for r, g, b, a in shot.getdata()])
                flash_box = hot.getbbox()
                if flash_box:
                    hot = hot.filter(ImageFilter.MaxFilter(5))
                    hot = ImageChops.multiply(hot, shot.getchannel("A"))
                    shot.putalpha(hot)
                    flash = shot.crop(hot.getbbox())
                    flash.thumbnail((48, 48), Image.Resampling.LANCZOS)
                    # A twin-gun source flash is one paired layer; center that
                    # pair between its sockets rather than at the left socket.
                    muzzle_x = sum(p['x'] for p in release_points) / len(release_points)
                    muzzle_y = sum(p['y'] for p in release_points) / len(release_points)
                    fx_layer.alpha_composite(flash, (round(muzzle_x * SIZE - flash.width / 2), round(muzzle_y * SIZE - flash.height / 2)))
            if name == "death":
                # Burn the same hull in place, with no scale/recentering change.
                amount = i / max(1, count - 1)
                charred = ImageEnhance.Color(body).enhance(.15)
                charred = ImageEnhance.Brightness(charred).enhance(.32)
                pose = Image.blend(body, charred, min(1, amount * 2))
                if 0 < i < count - 1:
                    fx_index = min(effect["frames"] - 1, round(amount * (effect["frames"] - 1)))
                    x, y = fx_index % effect["columns"] * 128, fx_index // effect["columns"] * 128
                    fx = explosion.crop((x, y, x + 128, y + 128)).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
                    fx_layer.alpha_composite(fx)
            x, y = i % columns * SIZE, i // columns * SIZE
            body_atlas.paste(pose, (x, y))
            effect_atlas.paste(fx_layer, (x, y))
            pose.alpha_composite(fx_layer)
            atlas.paste(pose, (x, y))
            baked.append({"x": x, "y": y, "width": SIZE, "height": SIZE, "pivot": {"x": 128, "y": 128}})
        atomic_image(target / f"{name}.png", atlas)
        atomic_image(audit / f"{name}.body.png", body_atlas)
        atomic_image(audit / f"{name}.effects.png", effect_atlas)
        # Old source scaleX/Y and per-clip scale were compensations for redrawn
        # bodies. They have no meaning in this shared pixel coordinate system.
        runtime["animations"].append({k: v for k, v in {
            **clip, "id": name, "file": f"{name}.png", "frames": baked, "scale": 1,
            "description": "Shared rigid body; only wheel/track surfaces, authored muzzle effects and destruction lighting animate.",
            "releaseFrame": min(clip.get("releaseFrame", 3), count - 1),
        }.items() if k not in ("scaleX", "scaleY", "mask", "sha256", "sheetSize", "wreckFile")})
    atomic_text(target / "animations.json", json.dumps(runtime, indent=2) + "\n")
    if "widthMetres" not in calibration:
        return None  # Legacy sprites have their world size owned by EraArtwork.
    metres_to_world = .24 * 340 / 512 * (2 / .75) / .65
    width_world = calibration["widthMetres"] * metres_to_world
    length_world = calibration["lengthMetres"] * metres_to_world
    member_scale = width_world / ((2 / .75) * (box[2] - box[0]) / SIZE)
    # Release points are presentation positions in the same canonical canvas.
    return member_scale, width_world, length_world, release_points

