"""Build bounded Russian runtime art without modifying approved source assets.

The manifest keeps the author's eight-age identities; runtime migration decides
which definitions use each asset. Run this after approved source artwork changes.
"""
from pathlib import Path
from PIL import Image
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Art/Cultures/Russians"
OUT = ROOT / "Art/Runtime/Russians"
SIZE = 128
manifest = {}
OUT.mkdir(parents=True, exist_ok=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def static(key, path, frame=None):
    image = Image.open(path).convert("RGBA")
    if frame:
        image = image.crop((frame["x"], frame["y"], frame["x"]+frame["width"], frame["y"]+frame["height"]))
    bounds = image.getbbox()
    if bounds:
        image = image.crop(bounds)
    image.thumbnail((116, 116), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE))
    canvas.paste(image, ((SIZE-image.width)//2, (SIZE-image.height)//2))
    filename = f"{key}.png"
    canvas.save(OUT / filename, optimize=True)
    manifest[key] = {"file": filename, "source": path.relative_to(ROOT).as_posix(), "hash": digest(path)}


def animated(key, path, aliases=None):
    data = json.loads(path.read_text(encoding="utf-8"))
    animations = data["animations"]
    if isinstance(animations, list):
        animations = {clip["id"]: clip for clip in animations}
    clips = {}
    hashes = {}
    for name, clip in animations.items():
        frames = clip.get("frames", [])
        if not frames:
            continue
        columns = min(6, len(frames))
        atlas = Image.new("RGBA", (columns*SIZE, ((len(frames)+columns-1)//columns)*SIZE))
        opened = {}
        union = None
        for i, frame in enumerate(frames):
            source = path.parent / (frame.get("sheet") or clip["file"])
            if source not in opened:
                opened[source] = Image.open(source).convert("RGBA")
                hashes[source.relative_to(ROOT).as_posix()] = digest(source)
            x, y = frame.get("x", 0), frame.get("y", 0)
            image = opened[source].crop((x, y, x+frame["width"], y+frame["height"]))
            image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            atlas.paste(image, ((i%columns)*SIZE, (i//columns)*SIZE))
            bounds = image.getbbox()
            if bounds:
                union = bounds if union is None else (min(union[0], bounds[0]), min(union[1], bounds[1]), max(union[2], bounds[2]), max(union[3], bounds[3]))
        filename = f"{key}-{name}.png"
        atlas.save(OUT / filename, optimize=True)
        clips[name] = {"file": filename, "frames": len(frames), "columns": columns, "fps": clip.get("suggestedFramesPerSecond", 8), "loop": clip.get("loop", True)}
        # Fixed bounds for the entire clip keep animated buildings from pumping.
        if union:
            clips[name]["bounds"] = {"x": union[0], "y": union[1], "width": union[2]-union[0], "height": union[3]-union[1]}
        if name in ("idle", "parked", "firing"):
            poster = f"{key}-portrait.png"
            atlas.crop((0, 0, SIZE, SIZE)).save(OUT / poster, optimize=True)
    for alias, original in (aliases or {}).items():
        if original in clips:
            clips[alias] = clips[original]
    manifest[key] = {"clips": clips, "facing": data.get("facing", "screen-down"), "source": path.relative_to(ROOT).as_posix(), "metadataHash": digest(path), "hashes": hashes}
    if 'poster' in locals():
        manifest[key]["poster"] = poster


for asset in json.loads((SOURCE / "Buildings/manifest.json").read_text(encoding="utf-8"))["assets"]:
    static(f"building-{asset['age'].lower()}-{asset['id']}", SOURCE / "Buildings" / asset["file"])
for asset in json.loads((SOURCE / "Ships/Ship_Animation_Manifest.json").read_text())["assets"]:
    kind = {"Warships": "warship", "Transport": "transport", "Trade": "trade", "Submarine": "submarine", "Submarines": "submarine"}.get(asset["category"])
    if kind:
        animated(f"{asset['age'].lower()}-{kind}", SOURCE / "Ships" / asset["metadata"], {"running": "sailing"})
for asset in json.loads((SOURCE / "Traders/Trader_Animation_Manifest.json").read_text())["assets"]:
    animated(f"{asset['age'].lower()}-trader", SOURCE / "Traders" / asset["metadata"], {"running": "travel"})
for age in ("EarlyModern", "Modern"):
    for kind in ("Fighter", "Bomber"):
        animated(f"{age.lower()}-{kind.lower()}", SOURCE / "Aircraft" / age / kind / "Animations/animations.json", {"idle": "parked", "running": "flight"})
for asset in json.loads((SOURCE / "Buildings/Animations/manifest.json").read_text())["assets"]:
    kind = "gun-nest" if asset["folder"] == "Gun Nest" else "anti-aircraft"
    base = Image.open(SOURCE / "Buildings" / asset["basePlate"]).convert("RGBA")
    box = base.getbbox()
    anchor = {"x": box[0]*SIZE/base.width, "y": box[1]*SIZE/base.height, "width": (box[2]-box[0])*SIZE/base.width, "height": (box[3]-box[1])*SIZE/base.height}
    for facing, metadata in asset["facings"].items():
        key = f"building-{asset['age'].lower()}-{kind}-firing-{facing.lower()}"
        animated(key, SOURCE / "Buildings" / metadata)
        for clip in manifest[key]["clips"].values():
            clip["groundBounds"] = anchor
        manifest[key]["groundBounds"] = anchor
        if facing == "N":
            # Idle and firing use the exact same ground plate coordinate frame.
            manifest[f"building-{asset['age'].lower()}-{kind}"] = {"file": manifest[key]["poster"], "groundBounds": anchor, "source": asset["facings"][facing]}
# Recruitment portraits use the same explicit age/class bindings as the planner.
# These are single actors for cards, never silently substituted for world formations.
unit_art = json.loads((ROOT / "src/skirmish/content/RussianTroopArtwork.json").read_text())
roster = json.loads((ROOT / "src/skirmish/content/russian-recruitment.json").read_text())
actor_catalogue = json.loads((ROOT / "src/skirmish/content/RussianTroopActors.json").read_text(encoding="utf-8"))
for troop in roster["units"]:
    folder = unit_art.get(f"{troop['age']}:{troop['troopClass']}")
    if not folder:
        continue
    actor = actor_catalogue.get(f"{troop['age']}:{troop['troopClass']}")
    runtime_metadata = ROOT / "Art/Runtime/Russians/Troops" / actor["key"] / "animations.json" if actor else None
    metadata = ROOT / json.loads(runtime_metadata.read_text(encoding="utf-8"))["source"] if runtime_metadata else SOURCE / "Units" / folder / "animations.json"
    data = json.loads(metadata.read_text(encoding="utf-8"))
    idle = next((clip for clip in data["animations"] if clip["id"] == "idle"), None)
    if not idle or not idle.get("frames"):
        raise ValueError(f"No recruitment portrait: {metadata}")
    frame = idle["frames"][0]
    source = metadata.parent / (frame.get("sheet") or idle["file"])
    cls = troop["troopClass"]
    line = "infantry" if cls == "frontline" else "archer" if cls == "rangedInfantry" else "cavalry"
    runtime_id = f"{troop['age'].lower()}-{line}" if cls in ("frontline", "rangedInfantry", "lightCavalry") else troop["id"]
    static(f"unit-portrait-{runtime_id}", source, frame)
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
referenced = set()
def collect_files(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("file", "poster") and isinstance(item, str):
                referenced.add(item)
            else:
                collect_files(item)
    elif isinstance(value, list):
        for item in value:
            collect_files(item)
collect_files(manifest)
removed = json.loads((OUT / "RuntimeCleanup.json").read_text(encoding="utf-8")).get("removedGeneratedFiles", []) if (OUT / "RuntimeCleanup.json").exists() else []
for path in OUT.glob("*.png"):
    if path.name not in referenced:
        if path.resolve().parent != OUT.resolve():
            raise RuntimeError("Runtime cleanup escaped its output directory")
        removed.append(path.name)
        path.unlink()
(OUT / "RuntimeCleanup.json").write_text(json.dumps({"removedGeneratedFiles": removed,
    "policy": "Only unreferenced generated runtime PNGs; authored source/review versions preserved."}, indent=2)+"\n", encoding="utf-8")
print(f"Prepared {len(manifest)} Russian assets, {sum(p.stat().st_size for p in OUT.glob('*.png')) / 1048576:.1f} MiB")
