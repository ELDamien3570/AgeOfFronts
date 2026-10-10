"""Bake fixed-pivot actor clips: 128px soldiers, 256px vehicles. Never crop/refit individual animation poses.

Keeps source art untouched and records its hashes. Only complete four-clip actors
enter the runtime catalogue; unavailable troops retain their gameplay icon.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Art/Cultures/Russians/Units"
OUT = ROOT / "Art/Runtime/Russians/Troops"
OUT.mkdir(parents=True, exist_ok=True)
bindings = json.loads((ROOT / "src/skirmish/content/RussianTroopArtwork.json").read_text(encoding="utf-8"))
review = json.loads((SOURCE.parent / "Troops.json").read_text(encoding="utf-8"))
metadata = {entry["metadata"].removeprefix("Units/").split("/animations.json")[0].split("/TopDownReview")[0]: entry["metadata"].removeprefix("Units/") for entry in review["units"]}
# Preserve the audited Clubman body span and existing demo registration. New
# artwork uses a fixed class baseline until its own body-span audit is approved.
widths = {"StoneAge/Clubman": 340, "StoneAge/Javelinist": 330,
          "StoneAge/MountedSpearman": 160, "BronzeAge/BronzeAxeman": 300,
          "BronzeAge/RiverArcher": 240, "BronzeAge/LightCavalry": 164,
          "ClassicalAge/ShieldWarrior": 300, "ClassicalAge/Pikeman": 220,
          "ClassicalAge/RecurveArcher": 260, "ClassicalAge/LightCavalry": 164,
          "ClassicalAge/HorseArcher": 168}
catalogue = {}
calibrations = json.loads((ROOT / "src/skirmish/content/RussianActorCalibration.json").read_text(encoding="utf-8"))
missing = []
roster = json.loads((ROOT / "src/skirmish/content/russian-recruitment.json").read_text(encoding="utf-8"))
for troop in roster["units"]:
    binding = f"{troop['age']}:{troop['troopClass']}"
    if binding not in bindings:
        missing.append({"binding": binding, "unit": troop["name"], "reason": "No dedicated authored asset binding"})
for binding, folder in bindings.items():
    mounted = binding.split(":")[1] in ("lightCavalry", "heavyCavalry", "rangedCavalry")
    source = SOURCE / metadata.get(folder, folder + "/animations.json")
    if not source.exists():
        missing.append({"binding": binding, "source": str(source.relative_to(ROOT)), "reason": "Missing metadata"})
        continue
    data = json.loads(source.read_text(encoding="utf-8"))
    clips = {clip["id"]: clip for clip in data["animations"]}
    # These are authored in-place motions, not missing human gait animations.
    if "running" not in clips and "moving" in clips:
        clips["running"] = clips["moving"]
    if "attack" not in clips and "moving-shooting" in clips:
        clips["attack"] = clips["moving-shooting"]
    if data.get("actorCount") != 1 or not all(name in clips for name in ("idle", "running", "attack", "death")):
        missing.append({"binding": binding, "source": str(source.relative_to(ROOT)), "reason": "Missing clips: " + ", ".join(name for name in ("idle", "running", "attack", "death") if name not in clips)})
        continue
    calibration = calibrations.get(folder, {})
    frame_size = 256 if calibration.get("vehicle") else 128
    key = folder.replace("/", "-")
    target = OUT / key
    target.mkdir(exist_ok=True)
    runtime = {"actorCount": 1, "animations": [], "source": source.relative_to(ROOT).as_posix(),
               "metadataHash": hashlib.sha256(source.read_bytes()).hexdigest(), "hashes": {}}
    for name in ("idle", "running", "attack", "death"):
        clip = clips[name]
        frames = clip["frames"]
        columns = min(6, len(frames))
        atlas = Image.new("RGBA", (frame_size*columns, frame_size*((len(frames)+columns-1)//columns)))
        baked = []
        sheets = {}
        for i, frame in enumerate(frames):
            path = source.parent / frame.get("sheet", clip["file"])
            if path not in sheets:
                sheets[path] = Image.open(path).convert("RGBA")
                runtime["hashes"][path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
            image = sheets[path].crop((frame["x"], frame["y"], frame["x"]+frame["width"], frame["y"]+frame["height"]))
            image = image.resize((frame_size, frame_size), Image.Resampling.LANCZOS)
            x, y = (i % columns)*frame_size, (i // columns)*frame_size
            atlas.paste(image, (x, y))
            baked.append({"x": x, "y": y, "width": frame_size, "height": frame_size,
                          "pivot": {"x": frame["pivot"]["x"]*frame_size/frame["width"],
                                    "y": frame["pivot"]["y"]*frame_size/frame["height"]}})
        atlas.save(target / (name + ".png"), optimize=True)
        runtime["animations"].append({**clip, "id": name, "file": name + ".png", "frames": baked,
                                      "releaseFrame": min(clip.get("releaseFrame", 3), len(baked)-1)})
    (target / "animations.json").write_text(json.dumps(runtime, indent=2)+"\n", encoding="utf-8")
    calibration = calibrations.get(folder, {})
    member_scale = 0.24*340/widths.get(folder, 164 if mounted else 340)
    width_world = length_world = 0
    if calibration.get("vehicle"):
        # One fixed idle envelope per asset, never per-frame silhouette fitting.
        # Clubman's 0.425-tile shoulder span represents about 0.65m; preserve this
        # stylized metres-to-world ratio for hulls rather than shrinking six tanks.
        idle = clips["idle"]
        frame = idle["frames"][0]
        image = Image.open(source.parent / frame.get("sheet", idle["file"])).convert("RGBA")
        crop = image.crop((frame["x"], frame["y"], frame["x"]+frame["width"], frame["y"]+frame["height"]))
        bounds = crop.getchannel("A").point(lambda alpha: 255 if alpha > 96 else 0).getbbox()
        if not bounds:
            raise ValueError(f"No opaque vehicle hull: {source}")
        width_world = calibration["widthMetres"] * (0.24*340/512*(2/0.75)/0.65)
        length_world = calibration["lengthMetres"] * (0.24*340/512*(2/0.75)/0.65)
        member_scale = width_world / ((2/0.75)*(bounds[2]-bounds[0])/frame["width"])
    catalogue[binding] = {"key": key, "assetRoot": f"/Art/Runtime/Russians/Troops/{key}/",
                          "memberScale": member_scale,
                          "sizeAudited": folder in widths,
                          "projectile": calibration.get("projectile", "javelin" if folder == "StoneAge/Javelinist" else "bullet" if any(s in folder for s in ("Musk", "Gunner", "Mosin", "Rifleman", "Grenadier")) else "arrow"),
                          "vehicle": calibration.get("vehicle", False),
                          "members": calibration.get("members", 6 if mounted else 12),
                          "widthWorld": width_world, "lengthWorld": length_world,
                          "releasePoints": calibration.get("releasePoints", [{"x": .5, "y": .7}]),
                          "facingOffset": calibration.get("facingOffset", 0)}
(ROOT / "src/skirmish/content/RussianTroopActors.json").write_text(json.dumps(catalogue, indent=2)+"\n", encoding="utf-8")
print(f"Baked {len(catalogue)} complete actor sets")
# Remove only generated actor copies superseded by the explicit catalogue.
# Source art and preserved authoring/review versions are never deleted here.
import shutil
active = {entry["key"] for entry in catalogue.values()}
for folder in OUT.iterdir():
    if folder.is_dir() and folder.name not in active:
        if folder.resolve().parent != OUT.resolve():
            raise RuntimeError("Runtime cleanup escaped its output directory")
        shutil.rmtree(folder)
(OUT / "MissingAssets.json").write_text(json.dumps(missing, indent=2)+"\n", encoding="utf-8")
