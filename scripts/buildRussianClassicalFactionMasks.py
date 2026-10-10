"""Build Classical Age red cloth/leather masks without rebuilding earlier ages.

Reuses the revised Bronze Age material detector. Optional green/red correction
layers under ClassicalAge/Corrections add/remove coverage at exact source pixels.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
CULTURE = REPO / 'Art/Cultures/Russians'
OUT = CULTURE / 'FactionMasks/ClassicalAge'
spec = importlib.util.spec_from_file_location('bronze_material_detector', REPO / 'scripts/buildRussianBronzeAgeLeatherMasks.py')
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def previous_masks():
    return {str(p): digest(p) for age in ('StoneAge', 'BronzeAge') for p in (CULTURE / 'FactionMasks' / age).rglob('*') if p.is_file()}

def main():
    before = previous_masks()
    catalogue = json.loads((CULTURE / 'Troops.json').read_text(encoding='utf-8-sig'))
    manifest = {'schemaVersion': 2, 'revision': 'classical-red-v1', 'age': 'ClassicalAge', 'status': 'awaiting-user-visual-review', 'scope': 'Red cloth and dyed leather clothing. Steel, fur, skin, weapons, shields and horses are preserved.', 'maskEncoding': 'White RGBA, with material coverage in alpha at exact source-sheet coordinates.', 'units': []}
    for item in catalogue['units']:
        if item['age'] != 'ClassicalAge':
            continue
        metadata = CULTURE / item['metadata']
        data = json.loads(metadata.read_text(encoding='utf-8-sig'))
        name = metadata.parent.parent.name if metadata.parent.name == 'TopDownReview' else metadata.parent.name
        unit = {'id': item['id'], 'name': name, 'label': item['label'], 'metadata': '../../' + item['metadata'], 'metadataHash': digest(metadata), 'materials': ['red cloth and dyed leather clothing'], 'preserved': ['steel armor and fittings', 'fur', 'skin', 'shields', 'weapons', 'horse and tack'], 'sheets': []}
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
            auto = np.minimum(detector.leather_alpha(image), source_alpha)
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
            unit['sheets'].append({'file': filename, 'source': '../../' + source.relative_to(CULTURE).as_posix(), 'sourceHash': source_hash, 'mask': target + '?v=classical-red-v1', 'width': image.width, 'height': image.height, 'maskedPixels': int((alpha >= .5).sum())})
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
