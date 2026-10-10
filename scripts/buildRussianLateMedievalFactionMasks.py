"""Build Late Medieval red cloth/leather masks without rebuilding earlier ages.

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
OUT = CULTURE / 'FactionMasks/LateMedieval'
spec = importlib.util.spec_from_file_location('bronze_material_detector', REPO / 'scripts/buildRussianBronzeAgeLeatherMasks.py')
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

def material_alpha(image, name):
    if name == 'RusCrossbowman' or name == 'CossackRider':
        pixels = np.asarray(image).astype(np.float32) / 255
        hue, sat, value = detector.rgb_to_hsv(pixels[..., :3])
        low, high = (265, 345) if name == 'RusCrossbowman' else (195, 270)
        band = detector.smooth(low - 12, low, hue) * (1 - detector.smooth(high, high + 12, hue))
        fabric = pixels[..., 3] * band * detector.smooth(.18, .32, sat) * detector.smooth(.04, .10, value)
        opened = np.asarray(Image.fromarray(np.uint8(fabric * 255)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) / 255
        fabric = np.minimum(fabric, opened)
        # The Cossack cap and trouser piping are red; its pants are indigo/purple.
        return np.maximum(fabric, detector.leather_alpha(image)) if name == 'CossackRider' else fabric
    alpha = detector.leather_alpha(image)
    if name == 'HorseArcher':
        pixels = np.asarray(image).astype(np.float32) / 255
        hue, sat, value = detector.rgb_to_hsv(pixels[..., :3])
        hue = np.where(hue > 180, hue - 360, hue)
        skin = detector.smooth(10, 13, hue) * (1 - detector.smooth(23, 27, hue)) * detector.smooth(.60, .70, value) * (1 - detector.smooth(.60, .70, sat))
        nearby = np.asarray(Image.fromarray(np.uint8(alpha * 255)).filter(ImageFilter.MaxFilter(21))) / 255
        warm = pixels[..., 3] * (1 - detector.smooth(19, 23, hue)) * detector.smooth(-25, -5, hue)
        warm *= detector.smooth(.28, .45, sat) * detector.smooth(.08, .18, value)
        alpha = np.maximum(alpha, warm * (nearby > .5) * (1 - skin))
        opened = np.asarray(Image.fromarray(np.uint8(alpha * 255)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) / 255
        alpha = np.minimum(alpha, opened)
    return alpha


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def previous_masks():
    return {str(p): digest(p) for age in ('StoneAge', 'BronzeAge', 'ClassicalAge', 'EarlyMedieval') for p in (CULTURE / 'FactionMasks' / age).rglob('*') if p.is_file()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only-units', nargs='+', help='Build selected units while retaining other existing masks.')
    args = parser.parse_args()
    existing_path = OUT / 'manifest.json'
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {'excludedUnits': [{'name': 'Boyar', 'reason': 'User requested no faction mask: visible detail is too small.'}], 'units': []}
    before = previous_masks()
    catalogue = json.loads((CULTURE / 'Troops.json').read_text(encoding='utf-8-sig'))
    manifest = {'schemaVersion': 2, 'revision': 'latemedieval-saddle-v5', 'age': 'LateMedieval', 'status': 'awaiting-user-visual-review', 'scope': 'Red clothing and lining; purple Crossbowman fabric; red Cossack cap and purple/indigo pants; all red Heavy Cossack Archer cloth including horse-armor panels. Metal, fur, skin, weapons, shields and natural horse coats are preserved.', 'maskEncoding': 'White RGBA, with material coverage in alpha at exact source-sheet coordinates.', 'excludedUnits': [{'name': 'Boyar', 'reason': 'User requested no faction mask: visible detail is too small.'}], 'units': []}
    for item in catalogue['units']:
        if item['age'] != 'LateMedieval' or item['id'] == 'russian-latemedieval-boyar':
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
        unit = {'id': item['id'], 'name': name, 'label': item['label'], 'metadata': '../../' + item['metadata'], 'metadataHash': digest(metadata), 'materials': ['purple cloth'] if name == 'RusCrossbowman' else ['red cap detail and purple/indigo trousers'] if name == 'CossackRider' else ['red cloth and lining, including horse-armor cloth panels'] if name == 'HorseArcher' else ['red cloth and dyed leather clothing'], 'preserved': ['steel armor and fittings', 'fur', 'skin', 'shields', 'weapons', 'natural horse coat and brown tack'], 'sheets': []}
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
            unit['sheets'].append({'file': filename, 'source': '../../' + source.relative_to(CULTURE).as_posix(), 'sourceHash': source_hash, 'mask': target + '?v=latemedieval-saddle-v5', 'width': image.width, 'height': image.height, 'maskedPixels': int((alpha >= .5).sum())})
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
