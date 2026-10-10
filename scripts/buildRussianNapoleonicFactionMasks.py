"""Build Napoleonic per-unit fabric masks without rebuilding earlier ages.

Reuses the revised Bronze Age material detector. Optional green/red correction
layers under LateMedieval/Corrections add/remove coverage at exact source pixels.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parents[1]
CULTURE = REPO / 'Art/Cultures/Russians'
OUT = CULTURE / 'FactionMasks/Napoleonic'
spec = importlib.util.spec_from_file_location('bronze_material_detector', REPO / 'scripts/buildRussianBronzeAgeLeatherMasks.py')
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

def material_alpha(image, name):
    pixels = np.asarray(image).astype(np.float32) / 255
    hue, sat, value = detector.rgb_to_hsv(pixels[..., :3])
    if name == 'CossackLancer':
        fabric = pixels[..., 3] * detector.smooth(183, 195, hue) * (1 - detector.smooth(270, 282, hue))
        fabric *= detector.smooth(.18, .32, sat) * detector.smooth(.04, .10, value)
        opened = np.asarray(Image.fromarray(np.uint8(fabric * 255)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) / 255
        return np.maximum(np.minimum(fabric, opened), detector.leather_alpha(image))
    if name == 'RusGrenadier':
        fabric = pixels[..., 3] * detector.smooth(65, 80, hue) * (1 - detector.smooth(165, 180, hue))
        fabric *= detector.smooth(.18, .35, sat) * detector.smooth(.04, .12, value)
        opened = np.asarray(Image.fromarray(np.uint8(fabric * 255)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) / 255
        return np.minimum(fabric, opened)
    if name == 'Cuirassier':
        # White uniform and gloves: broad pale shapes, with thin metallic reflections removed.
        # The blanket roll is excluded using pose-specific correction layers.
        fabric = pixels[..., 3] * (1 - detector.smooth(.20, .34, sat)) * detector.smooth(.40, .66, value)
        opened = np.asarray(Image.fromarray(np.uint8(fabric * 255)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))) / 255
        return np.minimum(fabric, opened)
    return detector.leather_alpha(image)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def previous_masks():
    return {str(p): digest(p) for age in ('StoneAge', 'BronzeAge', 'ClassicalAge', 'EarlyMedieval', 'LateMedieval') for p in (CULTURE / 'FactionMasks' / age).rglob('*') if p.is_file()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only-units', nargs='+', help='Build selected units while retaining other existing masks.')
    args = parser.parse_args()
    existing_path = OUT / 'manifest.json'
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {'excludedUnits': [{'name': 'RenaissancePikeman', 'reason': 'Not part of the user-specified material targets for this age.'}], 'units': []}
    before = previous_masks()
    catalogue = json.loads((CULTURE / 'Troops.json').read_text(encoding='utf-8-sig'))
    manifest = {'schemaVersion': 2, 'revision': 'napoleonic-fabric-v2', 'age': 'Napoleonic', 'status': 'awaiting-user-visual-review', 'scope': 'Green Grenadier cloth; white Cuirassier uniform; red and blue Cossack Lancer cloth; red Streltsy and Rus Musketeer clothing. Natural horse coats, blanket rolls, skin, fur, weapons and metal fittings are preserved', 'maskEncoding': 'White RGBA, with material coverage in alpha at exact source-sheet coordinates.', 'excludedUnits': [{'name': 'RenaissancePikeman', 'reason': 'Not part of the user-specified material targets for this age.'}], 'units': []}
    for item in catalogue['units']:
        if item['age'] != 'EarlyModern' or item['id'] == 'russian-earlymodern-renaissance-pikeman':
            continue
        metadata = CULTURE / item['metadata']
        data = json.loads(metadata.read_text(encoding='utf-8-sig'))
        name = metadata.parent.parent.name if metadata.parent.name == 'TopDownReview' else metadata.parent.name
        if args.only_units and name not in args.only_units:
            retained = next(u for u in existing['units'] if u['id'] == item['id'])
            if retained['metadataHash'] != digest(metadata):
                raise ValueError('Retained metadata changed: ' + name)
            for sheet in retained['sheets']:
                if sheet['sourceHash'] != digest((OUT / sheet['source']).resolve()):
                    raise ValueError('Retained source changed: ' + name)
            manifest['units'].append(retained)
            continue
        unit = {'id': item['id'], 'name': name, 'label': item['label'], 'metadata': '../../' + item['metadata'], 'metadataHash': digest(metadata), 'materials': ['green coat cloth'] if name == 'RusGrenadier' else ['white uniform cloth'] if name == 'Cuirassier' else ['red cap detail and blue/indigo trousers'] if name == 'CossackLancer' else ['red clothing and cap detail'], 'preserved': ['steel armor and fittings', 'fur', 'skin', 'shields', 'weapons', 'natural horse coat and brown tack'], 'sheets': []}
        files = []
        for animation in data['animations']:
            files += [animation['file']]
            if animation.get('corpseFile'):
                files.append(animation['corpseFile'])
            files += [frame['sheet'] for frame in animation['frames'] if frame.get('sheet')]
        for filename in dict.fromkeys(files):
            source = metadata.parent / filename
            source_hash = digest(source)
            image = Image.open(source).convert('RGBA')
            source_alpha = np.asarray(image)[..., 3].astype(np.float32) / 255
            auto = np.minimum(material_alpha(image, name), source_alpha)
            target = name + '/' + Path(filename).stem + '.faction-mask.png'
            correction = OUT / 'Corrections' / target.replace('.faction-mask.png', '.correction.png')
            alpha = auto.copy()
            if correction.exists():
                layer = np.asarray(Image.open(correction).convert('RGBA'))
                if layer.shape[:2] != alpha.shape:
                    raise ValueError('Correction dimensions differ: ' + str(correction))
                on = layer[..., 3] > 127
                add = on & (layer[..., 1] > 127) & (layer[..., 0] < 128)
                remove = on & (layer[..., 0] > 127) & (layer[..., 1] < 128)
                alpha = np.where(add, source_alpha, alpha)
                alpha = np.where(remove, 0, alpha)
            for folder, coverage in ((OUT / 'AutoDetected', auto), (OUT, alpha)):
                destination = folder / target
                destination.parent.mkdir(parents=True, exist_ok=True)
                pixels = np.dstack([np.full(coverage.shape, 255, np.uint8)] * 3 + [np.rint(coverage * 255).astype(np.uint8)])
                Image.fromarray(pixels).save(destination)
            if digest(source) != source_hash:
                raise RuntimeError('Source changed while building: ' + str(source))
            unit['sheets'].append({'file': filename, 'source': '../../' + source.relative_to(CULTURE).as_posix(), 'sourceHash': source_hash, 'mask': target + '?v=napoleonic-fabric-v2', 'width': image.width, 'height': image.height, 'maskedPixels': int((alpha >= .5).sum())})
        manifest['units'].append(unit)
        print(name, len(unit['sheets']), 'masks')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    after = previous_masks()
    if before != after:
        raise RuntimeError('Previous age masks changed')
    (OUT / 'Preservation.json').write_text(json.dumps({'previousAgeFilesVerifiedUnchanged': len(before), 'sourceSheetsVerifiedUnchanged': sum(len(u['sheets']) for u in manifest['units'])}, indent=2) + '\n')

if __name__ == '__main__':
    main()
