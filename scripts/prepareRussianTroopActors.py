"""Bake fixed-pivot, 128px actor clips. Never crop/refit individual animation poses.

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
review = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
metadata = {entry["metadata"].split("/animations.json")[0].split("/TopDownReview")[0]: entry["metadata"] for entry in review["units"]}
# Preserve the audited Clubman body span and existing demo registration. New
# artwork uses a fixed class baseline until its own body-span audit is approved.
widths = {"StoneAge/Clubman": 340, "StoneAge/Javelinist": 330,
          "StoneAge/MountedSpearman": 160, "BronzeAge/BronzeAxeman": 300,
          "BronzeAge/RiverArcher": 240, "BronzeAge/LightCavalry": 164,
          "ClassicalAge/ShieldWarrior": 300, "ClassicalAge/Pikeman": 220,
          "ClassicalAge/RecurveArcher": 260, "ClassicalAge/LightCavalry": 164,
          "ClassicalAge/HorseArcher": 168}
catalogue = {}
for binding, folder in bindings.items():
    mounted = binding.split(":")[1].endswith("Cavalry")
    source = SOURCE / metadata.get(folder, folder + "/animations.json")
    if not source.exists():
        continue
    data = json.loads(source.read_text(encoding="utf-8"))
    clips = {clip["id"]: clip for clip in data["animations"]}
    if data.get("actorCount") != 1 or not all(name in clips for name in ("idle", "running", "attack", "death")):
        continue
    key = folder.replace("/", "-")
    target = OUT / key
    target.mkdir(exist_ok=True)
    runtime = {"actorCount": 1, "animations": [], "source": source.relative_to(ROOT).as_posix(),
               "metadataHash": hashlib.sha256(source.read_bytes()).hexdigest(), "hashes": {}}
    for name in ("idle", "running", "attack", "death"):
        clip = clips[name]
        frames = clip["frames"]
        columns = min(6, len(frames))
        atlas = Image.new("RGBA", (128*columns, 128*((len(frames)+columns-1)//columns)))
        baked = []
        sheets = {}
        for i, frame in enumerate(frames):
            path = source.parent / frame.get("sheet", clip["file"])
            if path not in sheets:
                sheets[path] = Image.open(path).convert("RGBA")
                runtime["hashes"][path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
            image = sheets[path].crop((frame["x"], frame["y"], frame["x"]+frame["width"], frame["y"]+frame["height"]))
            image = image.resize((128, 128), Image.Resampling.LANCZOS)
            x, y = (i % columns)*128, (i // columns)*128
            atlas.paste(image, (x, y))
            baked.append({"x": x, "y": y, "width": 128, "height": 128,
                          "pivot": {"x": frame["pivot"]["x"]*128/frame["width"],
                                    "y": frame["pivot"]["y"]*128/frame["height"]}})
        atlas.save(target / (name + ".png"), optimize=True)
        runtime["animations"].append({**clip, "file": name + ".png", "frames": baked})
    (target / "animations.json").write_text(json.dumps(runtime, indent=2)+"\n", encoding="utf-8")
    catalogue[binding] = {"key": key, "assetRoot": f"/Art/Runtime/Russians/Troops/{key}/",
                          "memberScale": 0.24*340/widths.get(folder, 164 if mounted else 340),
                          "sizeAudited": folder in widths,
                          "projectile": "javelin" if folder == "StoneAge/Javelinist" else "bullet" if "Musk" in folder or "Gunner" in folder else "arrow"}
(ROOT / "src/skirmish/content/RussianTroopActors.json").write_text(json.dumps(catalogue, indent=2)+"\n", encoding="utf-8")
print(f"Baked {len(catalogue)} complete actor sets")
