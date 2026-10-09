"""Export Soviet aircraft drafts without altering their generated source masters."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ART = ROOT.parents[2]
ROLES = [
    ('Fighter', 'Yakovlev Yak-3', 'Yak3_Russian_WWII', 'sovietYak',
     'exec-1ac8e19d-1bd3-4170-a5fd-e86c72cafc92.png', 'Air superiority'),
    ('Bomber', 'Petlyakov Pe-8', 'Pe8_Russian_WWII', 'sovietPe8',
     'exec-e8c22248-1607-4001-8c0a-a459f646cda9.png', 'Heavy bombardment'),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def edge(alpha):
    return np.concatenate([alpha[:8].ravel(), alpha[-8:].ravel(), alpha[:, :8].ravel(), alpha[:, -8:].ravel()])


def main():
    prompts = {item['name']: item['prompt'] for item in json.loads((ROOT/'Generation-Prompts.json').read_text(encoding='utf-8'))['prompts']}
    assets, generations, validations, icons = [], [], [], []
    for category, label, stem, key, generated, role in ROLES:
        folder = ROOT/'EarlyModern'/category
        master = folder/'SourceArt'/(stem+'_v2.png')
        native = Image.open(master)
        before = sha(master)
        assert native.mode == 'RGBA' and native.size == (1254, 1254)
        alpha = np.asarray(native.getchannel('A'))
        bounds = native.getchannel('A').point(lambda x: 255 if x > 16 else 0).getbbox()
        # Preserve the original native alpha, including six alpha=1 edge specks
        # in the bomber. None are visible airframe pixels or clipped geometry.
        native_guard = int(edge(alpha).max())
        assert native_guard <= 1, (category, 'visible art touches source edge')
        icon = native.resize((627, 627), Image.Resampling.LANCZOS)
        icon.save(folder/'Icon.png', optimize=True)
        icon_guard = int(edge(np.asarray(icon.getchannel('A'))).max())
        assert icon_guard == 0, (category, 'export edge is not transparent')
        assert sha(master) == before
        path = f'EarlyModern/{category}/Icon.png'
        assets.append({'id': category.lower()+'-wwii', 'label': label, 'age': 'EarlyModern', 'era': 'WWII',
            'category': category, 'role': role, 'file': path,
            'source': str(master.relative_to(ROOT)).replace('\\', '/'), 'status': 'static draft',
            'frameSize': {'width': 627, 'height': 627}, 'camera': 'vertical-overhead-orthographic', 'facing': 'screen-up'})
        generations.append({'category': category, 'label': label, 'generator': 'built-in image_gen',
            'prompt': prompts[key+'Prompt'], 'correctionPrompt': prompts[key+'FixPrompt'],
            'generatedFile': generated, 'generatedDirectory': 'C:/Users/Damien/.codex/generated_images/01a0fea7-45e8-7a11-8804-5420a62f53c3',
            'selectedMaster': assets[-1]['source'], 'sourceSha256': before, 'export': path,
            'exportSha256': sha(folder/'Icon.png'), 'nativeDimensions': list(native.size), 'exportDimensions': [627, 627],
            'resampling': 'Uniform full-canvas LANCZOS resize; native source and alpha unchanged',
            'supersededDraft': f'EarlyModern/{category}/SourceArt/{stem}_v1.png',
            'supersededReason': 'Propeller projection and framing' if category == 'Fighter' else 'Wing clipping and bomber planform proportions',
            'animationApproval': 'Static user review pending'})
        validations.append({'category': category, 'sourceRgba': True, 'sourceDimensions': list(native.size),
            'sourceSha256': before, 'visibleBoundsAlphaAbove16': list(bounds),
            'nativeEdgeMaximumAlpha': native_guard, 'visibleAirframeGuardClear': native_guard <= 1,
            'exportRgba': True, 'exportDimensions': [627, 627], 'exportEightPixelGuardClear': icon_guard == 0,
            'sourcePreservedDuringExport': sha(master) == before, 'passed': True})
        icons.append((label, icon))
    existing = json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    for asset in assets:
        previous = next((old for old in existing['assets'] if old['id'] == asset['id']), None)
        if previous and previous.get('metadata'):
            asset['metadata'] = previous['metadata']
            asset['status'] = previous['status']
    rebuilt_ids = {asset['id'] for asset in assets}
    assets += [asset for asset in existing['assets'] if asset['id'] not in rebuilt_ids]
    write(ROOT/'manifest.json', {'schemaVersion': 1, 'cultureId': 'russians', 'label': 'Russian / Soviet aircraft',
        'status': existing['status'], 'assets': assets})
    write(ROOT/'Generation-Manifest.json', {'schemaVersion': 1, 'date': '2026-10-07',
        'userSelection': 'Pe-8 and one fighter, selected Yak-3', 'generator': 'built-in image_gen', 'assets': generations,
        'references': [
            {'label': 'Yak-3 original aircraft, Musee de l Air et de l Espace', 'url': 'https://www.museeairespace.fr/aller-plus-haut/collections/yakovlev-yak-3/'},
            {'label': 'Pe-8, Krasnoyarsk Regional Museum publication', 'url': 'https://www.kkkm.ru/application/files/9516/4377/1583/d294aa0afa518ac725cab02224ed23ee.pdf',
             'accessNote': 'Search excerpt verified four-engine bomber; full PDF fetch unavailable.'}],
        'historicalScope': 'Model-inspired game sprites, not exact museum restorations. Upper-wing stars prioritize culture readability and are not a specific squadron reproduction.'})
    baseline = json.loads((ROOT/'Review/Preservation-Baseline.json').read_text(encoding='utf-8'))
    changed = [name for name, digest in baseline.items() if sha(ART.parent/name) != digest]
    assert not changed, changed
    write(ROOT/'Review/Source_Validation.json', {'schemaVersion': 1, 'passed': True, 'assets': validations,
        'preservedFilesChecked': len(baseline), 'preservedFilesChanged': changed,
        'scope': 'Static PNG contracts, original source alpha and existing aircraft/ship/trader preservation; no animation or match-runtime certification'})
    canvas = Image.new('RGBA', (1024, 620), (31, 42, 45, 255)); draw = ImageDraw.Draw(canvas)
    for column, (label, icon) in enumerate(icons):
        x = column*512
        draw.text((x+20, 16), label+' / Soviet WWII', fill='white')
        canvas.alpha_composite(icon.resize((480, 480), Image.Resampling.LANCZOS), (x+16, 40))
        for index, size in enumerate([28, 42, 64]):
            px = x+70+index*140
            draw.text((px, 534), f'{size} px', fill='white')
            canvas.alpha_composite(icon.resize((size, size), Image.Resampling.LANCZOS), (px, 552))
    canvas.save(ROOT/'Review/Soviet_Aircraft_Static_Review.png')
    print(json.dumps({'passed': True, 'aircraftDrafts': 2, 'preservedFilesChecked': len(baseline), 'nativeAlphaKept': True}, indent=2))


if __name__ == '__main__':
    main()
