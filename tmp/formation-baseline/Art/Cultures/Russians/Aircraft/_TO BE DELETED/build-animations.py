"""Bake approved aircraft with rigid airframes and separately registered engines.

Review-only: no combat, route, altitude or runtime sprite selection is modified.
"""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SIZE, COUNT = 512, 20


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    catalog = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    rigs = json.loads((ROOT / 'animation-rigs.json').read_text(encoding='utf-8'))
    baseline = {str(p): sha(p) for p in ROOT.rglob('*.png')
                if '/Animations/' not in p.as_posix() and p.parent.name != 'Review'}
    reports = []
    for asset in catalog['assets']:
        source = ROOT / asset['source']
        image = Image.open(source).convert('RGBA').resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        rig = rigs[asset['id']]
        body = image.copy()
        blades = []
        # Split only the slender blade strips; spinner and nacelle stay in the body.
        # Coordinate masks are editable, fixed registration, never per-frame fitting.
        for prop in rig.get('propellers', []):
            cx, cy, radius, hub = [round(v * SIZE) for v in prop]
            for left, right in [(cx-radius, cx-hub), (cx+hub, cx+radius)]:
                box = (left, cy-2, right, cy+3)
                blades.append((body.crop(box), box, cx, cy))
                body.paste((0, 0, 0, 0), box)
        folder = ROOT / asset['age'] / asset['category'] / 'Animations'
        folder.mkdir(parents=True, exist_ok=True)
        clips = {}
        for state in ['parked', 'flight']:
            frames = []
            for index in range(COUNT):
                phase = 2 * math.pi * index / COUNT
                frame = image.copy() if state == 'parked' else body.copy()
                if state == 'flight':
                    for blade, box, cx, cy in blades:
                        # A propeller rotates around the longitudinal engine shaft.
                        # Its disk projects to a thin horizontal band from above.
                        extent = 0.18 + 0.82 * abs(math.cos(phase * 3 + cx * 0.04))
                        width = max(1, round(blade.width * extent))
                        spinning = blade.resize((width, blade.height), Image.Resampling.BICUBIC)
                        x = cx-width if box[0] < cx else cx
                        frame.alpha_composite(spinning, (x, box[1]))
                    effects = Image.new('RGBA', frame.size)
                    draw = ImageDraw.Draw(effects)
                    for cx, cy, radius, hub in rig.get('propellers', []):
                        x, y, r = cx*SIZE, cy*SIZE, radius*SIZE
                        draw.ellipse((x-r, y-1.5, x+r, y+1.5), fill=(160, 174, 182, 55))
                    glow = Image.new('RGBA', frame.size)
                    glow_draw = ImageDraw.Draw(glow)
                    for n, (cx, cy) in enumerate(rig.get('exhausts', [])):
                        x, y = cx*SIZE, cy*SIZE
                        pulse = math.sin(phase*2+n*0.7)
                        length = rig.get('exhaustLength', 16) * (1 + 0.13*pulse)
                        radius = rig.get('exhaustRadius', 3)
                        glow_draw.ellipse((x-radius*2, y-2, x+radius*2, y+length),
                                          fill=(76, 151, 255, 100+round(15*pulse)))
                        draw.polygon([(x-radius, y), (x+radius, y),
                                      (x+radius*0.55, y+length*0.6), (x, y+length),
                                      (x-radius*0.55, y+length*0.6)], fill=(86, 161, 255, 175))
                        draw.polygon([(x-radius*0.5, y), (x+radius*0.5, y),
                                      (x, y+length*0.65)], fill=(206, 230, 255, 235))
                        draw.ellipse((x-radius*0.65, y-1, x+radius*0.65, y+2),
                                     fill=(255, 204, 135, 210))
                    frame = Image.alpha_composite(frame, glow.filter(ImageFilter.GaussianBlur(2)))
                    frame = Image.alpha_composite(frame, effects)
                    frame = frame.rotate(rig.get('yawDegrees', 0.55)*math.sin(phase), Image.Resampling.BICUBIC,
                                         center=(SIZE/2, SIZE/2))
                frames.append(frame)
            sheet = Image.new('RGBA', (SIZE*5, SIZE*4))
            for index, frame in enumerate(frames):
                sheet.alpha_composite(frame, ((index%5)*SIZE, (index//5)*SIZE))
                alpha = frame.getchannel('A')
                assert max(alpha.crop(box).getextrema()[1] for box in
                           [(0,0,SIZE,8), (0,SIZE-8,SIZE,SIZE), (0,0,8,SIZE), (SIZE-8,0,SIZE,SIZE)]) <= 1
            filename = state.title()+'.png'
            sheet.save(folder / filename, optimize=True)
            clips[state] = {'file': filename, 'frameCount': COUNT,
                            'suggestedFramesPerSecond': 20, 'loop': True,
                            'frames': [{'index': i, 'x': i%5*SIZE, 'y': i//5*SIZE,
                                        'width': SIZE, 'height': SIZE} for i in range(COUNT)]}
            if state == 'flight':
                assert len({hashlib.sha256(f.tobytes()).digest() for f in frames}) >= 10
            reports.append({'id': asset['id'], 'state': state, 'frameCount': COUNT,
                            'sheet': str((folder/filename).relative_to(ROOT)).replace('\\', '/'),
                            'eightPixelGuardClear': True})
        metadata = {'schemaVersion': 1, 'cultureId': 'russians', 'id': asset['id'],
                    'age': asset['age'], 'camera': asset['camera'], 'facing': asset['facing'],
                    'frameSize': {'width': SIZE, 'height': SIZE},
                    'sheetSize': {'width': SIZE*5, 'height': SIZE*4},
                    'grid': {'columns': 5, 'rows': 4}, 'pivot': {'x': SIZE/2, 'y': SIZE/2},
                    'source': asset['source'], 'sourceSha256': sha(source),
                    'animations': clips, 'rig': rig}
        write(folder/'animations.json', metadata)
        asset['metadata'] = str((folder/'animations.json').relative_to(ROOT)).replace('\\', '/')
        asset['status'] = 'animated draft'
    assert all(sha(Path(p)) == digest for p, digest in baseline.items())
    catalog['status'] = 'Animated artwork for review; not connected to match renderer'
    write(ROOT/'manifest.json', catalog)
    write(ROOT/'Review/Animation-Validation.json', {
        'passed': True, 'clips': reports, 'preservedPngFiles': len(baseline),
        'scope': 'Sprite contract, frame variation, transparent guard and approved source preservation. Browser and match-runtime acceptance are separate.'})
    print(json.dumps({'passed': True, 'aircraft': len(catalog['assets']),
                      'clips': len(reports), 'frames': len(reports)*COUNT,
                      'preservedPngFiles': len(baseline)}))


if __name__ == '__main__':
    main()
