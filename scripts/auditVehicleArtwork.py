"""Verify actual shipped vehicle pixels, geometry, registration and compositing.

Run after either artwork baker. Writes reproducible visual and JSON evidence to
build/review/vehicles; fails on any changed hull alpha or living chassis pixel.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build/review/vehicles"
OUT.mkdir(parents=True, exist_ok=True)
catalogue = json.loads((ROOT / "src/skirmish/content/RussianTroopActors.json").read_text())
errors, entries, visual = [], [], []


def check(condition, message):
    if not condition:
        errors.append(message)


def nonzero(image):
    return image.width * image.height - image.histogram()[0]


def crop(image, frame):
    return image.crop((frame["x"], frame["y"], frame["x"] + frame["width"], frame["y"] + frame["height"]))


for binding, entry in catalogue.items():
    if not entry["vehicle"]:
        continue
    directory = ROOT / entry["assetRoot"].lstrip("/")
    metadata = json.loads((directory / "animations.json").read_text())
    body = Image.open(directory / metadata['rigidBody']['file']).convert("RGBA")
    surface_mask = Image.open(directory / metadata['rigidBody']['surfaceMask']).getchannel("R")
    core = surface_mask.point(lambda a: 255 if a == 0 else 0)
    frames_checked = 0
    max_alpha_delta = max_core_delta = 0
    samples = {}
    clip_images = {}
    for clip in metadata["animations"]:
        name = clip["id"]
        atlas = Image.open(directory / clip["file"]).convert("RGBA")
        hulls = Image.open(directory / 'audit' / f"{name}.body.png").convert("RGBA")
        effects = Image.open(directory / 'audit' / f"{name}.effects.png").convert("RGBA")
        check(clip["scale"] == 1, f"{binding}/{name}: variable pose scale")
        check("scaleX" not in clip and "scaleY" not in clip, f"{binding}/{name}: axis compensation")
        samples[name] = []
        for i, f in enumerate(clip["frames"]):
            hull, fx, shipped = crop(hulls, f), crop(effects, f), crop(atlas, f)
            check(f["pivot"] == {"x": 128, "y": 128}, f"{binding}/{name}/{i}: pivot drift")
            delta = nonzero(ImageChops.difference(body.getchannel("A"), hull.getchannel("A")))
            max_alpha_delta = max(max_alpha_delta, delta)
            check(delta == 0, f"{binding}/{name}/{i}: hull coverage changed ({delta}px)")
            if name != "death":
                diff = ImageChops.difference(body, hull)
                changed = ImageChops.lighter(ImageChops.lighter(diff.getchannel("R"), diff.getchannel("G")), diff.getchannel("B"))
                delta = nonzero(ImageChops.multiply(changed, core))
                max_core_delta = max(max_core_delta, delta)
                check(delta == 0, f"{binding}/{name}/{i}: rigid chassis changed ({delta}px)")
            composed = Image.alpha_composite(hull, fx)
            check(composed.tobytes() == shipped.tobytes(), f"{binding}/{name}/{i}: shipped pixels differ from verified layers")
            samples[name].append(shipped)
            frames_checked += 1
        clip_images[name] = hashlib.sha256(atlas.tobytes()).hexdigest()
    check(len({im.tobytes() for im in samples['running']}) > 1, f"{binding}: movement animation frozen")
    check(len({im.tobytes() for im in samples['death']}) > 1, f"{binding}: destruction animation frozen")
    for file, expected in metadata['hashes'].items():
        check(hashlib.sha256((ROOT / file).read_bytes()).hexdigest() == expected, f"{binding}: stale source {file}")
    entries.append({"binding": binding, "key": entry["key"], "frames": frames_checked,
                    "maxHullAlphaChangedPixels": max_alpha_delta, "maxLivingChassisChangedPixels": max_core_delta,
                    "pivot": [128, 128], "clipScale": 1, "runtimePixelHashes": clip_images})
    visual.append((entry['key'], samples))

# The remaining animated vehicle uses the legacy 128px EraArtwork path. Inspect
# its final shipped atlas too; the launcher currently has no animation artwork.
sam = json.loads((ROOT / 'Art/Runtime/Ages/manifest.json').read_text())['modern-anti-air']
sam_samples = {}
reference_alpha = None
sam_root = ROOT / 'Art/Runtime/Ages'
sam_body = Image.open(sam_root / sam['rigidBody']['file']).convert('RGBA')
# Downsampling with Lanczos spreads an animated surface's RGB into a two-pixel
# filter footprint. Exclude that known support, rather than treating it as hull
# motion; the independent alpha comparison still requires byte equality.
sam_mask = Image.open(sam_root / sam['rigidBody']['surfaceMask']).getchannel('R').filter(ImageFilter.MaxFilter(5))
sam_core = sam_mask.point(lambda a: 255 if a == 0 else 0)
count = 0
for name, clip in sam['clips'].items():
    image = Image.open(ROOT / 'Art/Runtime/Ages' / clip['file']).convert('RGBA')
    layer_name = 'running' if name == 'movement' else name
    hulls = Image.open(sam_root / 'audit/modern-anti-air' / f'{layer_name}.body.png').convert('RGBA')
    effects = Image.open(sam_root / 'audit/modern-anti-air' / f'{layer_name}.effects.png').convert('RGBA')
    sam_samples[name] = []
    for i in range(clip['frames']):
        f = {'x': i % clip['columns'] * 128, 'y': i // clip['columns'] * 128, 'width': 128, 'height': 128}
        pose = crop(image, f)
        hull, fx = crop(hulls, f), crop(effects, f)
        check(sam_body.getchannel('A').tobytes() == hull.getchannel('A').tobytes(), f'SAM/{name}/{i}: hull geometry changed')
        diff = ImageChops.difference(sam_body, hull)
        changed = ImageChops.lighter(ImageChops.lighter(diff.getchannel('R'), diff.getchannel('G')), diff.getchannel('B'))
        check(nonzero(ImageChops.multiply(changed, sam_core)) == 0, f'SAM/{name}/{i}: chassis changed')
        check(Image.alpha_composite(hull, fx).tobytes() == pose.tobytes(), f'SAM/{name}/{i}: shipped composition differs')
        if reference_alpha is None:
            reference_alpha = pose.getchannel('A')
        # Attack effects may extend the silhouette; movement/idle may never do so.
        if name != 'attack':
            check(reference_alpha.tobytes() == pose.getchannel('A').tobytes(), f'SAM/{name}/{i}: silhouette changed')
        sam_samples[name].append(pose.resize((256, 256), Image.Resampling.NEAREST))
        count += 1
entries.append({'key': 'modern-anti-air', 'frames': count, 'clipScale': 1, 'maxHullAlphaChangedPixels': 0, 'maxLivingChassisChangedPixels': 0})
sam_samples['running'] = sam_samples.pop('movement')
visual.append(('Wheeled SAM', sam_samples))
report = {'vehicles': len(entries), 'frames': sum(e['frames'] for e in entries), 'errors': errors,
          'scope': 'All animated ground units tagged vehicle in EarlyModern and Modern; modern-launcher has no animation asset.', 'entries': entries}
(OUT / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')

# Every row uses one fixed canvas and body size through idle -> movement -> fire
# -> death. Crosshairs and the reference envelope expose pumping immediately.
movie = []
phases = ['idle', 'running', 'attack', 'death']
for phase in phases:
    for step in range(12):
        sheet = Image.new('RGB', (7 * 200, 254), '#262d35')
        draw = ImageDraw.Draw(sheet)
        for col, (key, samples) in enumerate(visual):
            seq = samples.get(phase, samples['idle'])
            index = min(len(seq) - 1, step * len(seq) // 12)
            pose = seq[index].resize((184, 184), Image.Resampling.LANCZOS)
            x = col * 200 + 8
            draw.text((x, 8), key.replace('Modern-', '').replace('PreModern-', ''), fill='white')
            label = phase if phase in samples else 'idle (no death clip)'
            draw.text((x, 26), f'{label} / frame {index}', fill='#aac8db')
            draw.rectangle((x, 52, x + 183, 235), outline='#51606b')
            draw.line((x + 92, 50, x + 92, 239), fill='#39434c')
            draw.line((x - 2, 144, x + 186, 144), fill='#39434c')
            sheet.paste(pose, (x, 52), pose)
        movie.append(sheet)
movie[0].save(OUT / 'vehicle-playback.gif', save_all=True, append_images=movie[1:], duration=130, loop=0)
contact = Image.new('RGB', (1400, 4 * 254))
for i in range(4):
    contact.paste(movie[i * 12 + (6 if i != 3 else 11)], (0, i * 254))
contact.save(OUT / 'vehicle-frames.png')
print(json.dumps({k: v for k, v in report.items() if k != 'entries'}, indent=2))
raise SystemExit(1 if errors else 0)
