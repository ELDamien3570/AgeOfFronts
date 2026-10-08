"""Read-only image checks; writes only the validation report."""
import hashlib, json, sys
from pathlib import Path
from PIL import Image
import numpy as np

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'Weapon-Manifest.json').read_text())
expected = {'Mangonel':('ClassicalAge','Field Artillery'), 'Ballista':('EarlyMedieval','Field Artillery'), 'OrganGun':('LateMedieval','Field Artillery'), 'NapoleonicCannon':('EarlyModern','Field Artillery'), 'BrowningMachineGunner':('Modern','Field Artillery'), 'BatteringRam':('BronzeAge','Siege Weapons'), 'SiegeTower':('BronzeAge','Siege Weapons'), 'Onager':('ClassicalAge','Siege Weapons'), 'Trebuchet':('EarlyMedieval','Siege Weapons'), 'Bombard':('LateMedieval','Siege Weapons'), 'EarlyHowitzer':('EarlyModern','Siege Weapons'), 'ModernHowitzer':('Modern','Siege Weapons')}
errors, audits = [], []
def check(condition, message):
    if not condition: errors.append(message)
check(len(manifest['units']) == 12, 'Expected twelve units')
check({u['key'] for u in manifest['units']} == set(expected), 'Unit roster mismatch')
for unit in manifest['units']:
    key, folder = unit['key'], root / unit['directory']
    try:
        meta = json.loads((folder / 'animations.json').read_text())
        prompts = json.loads((folder / 'generation-prompts.json').read_text())
        check((meta['age'],meta['category']) == expected[key], key + ' age or category mismatch')
        check(meta['frameSize'] == {'width':627,'height':627}, key + ' dimensions')
        check(meta['facing']=='screen-up' and meta['directionCount']==1 and meta['camera']=='vertical-overhead-orthographic', key + ' facing contract')
        check(meta['pivot']=={'x':313.5,'y':313.5}, key + ' pivot contract')
        check(set(meta['animations'])=={'idle','movement','attack'}, key + ' clips')
        check({j['clip'] for j in prompts['jobs']} == {'Idle','Movement','Attack'}, key + ' prompts')
        icon = Image.open(folder / 'Icon.png')
        check(icon.size==(627,627) and icon.mode=='RGBA', key + ' icon format')
        clip_audits = {}
        for name, clip in meta['animations'].items():
            label = key + ' ' + name
            sheet = Image.open(folder / clip['file']).convert('RGBA')
            check(sheet.size == (clip['sheetSize']['width'],clip['sheetSize']['height']), label + ' sheet size')
            check(max(sheet.size)<=4096, label + ' sheet exceeds texture limit')
            check(len(clip['frames'])==clip['frameCount'], label + ' frame count')
            check(sum(f['durationMs'] for f in clip['frames'])==clip['durationMs'], label + ' timing')
            check(clip['loop']==(name!='attack'), label + ' loop semantics')
            hashes = set()
            for frame in clip['frames']:
                file = folder / frame['file']
                check(hashlib.sha256(file.read_bytes()).hexdigest()==frame['sha256'], label + ' checksum ' + str(frame['index']))
                image = Image.open(file)
                check(image.size==(627,627) and image.mode=='RGBA', label + ' RGBA dimensions')
                rgba = np.asarray(image)
                a = rgba[:,:,3]
                check(max(int(a[0,:].max()),int(a[-1,:].max()),int(a[:,0].max()),int(a[:,-1].max()))==0, label + ' output edge clipped')
                check(int(a.max())==255 and np.count_nonzero(a>8)>1000, label + ' visibility')
                crop = np.asarray(sheet.crop((frame['x'],frame['y'],frame['x']+627,frame['y']+627)))
                check(np.array_equal(crop,rgba), label + ' sheet/frame pixel mismatch')
                hashes.add(frame['sha256'])
            check(len(hashes)>=2, label + ' has no distinct painted poses')
            preview = Image.open(folder / clip['preview'])
            check(preview.size==(627,627) and preview.is_animated, label + ' animated preview')
            check(preview.info.get('loop')==0, label + ' preview loop')
            preview_duration = 0
            for i in range(preview.n_frames):
                preview.seek(i); preview.load(); preview_duration += preview.info.get('duration',0)
            check(preview_duration==clip['durationMs']+(700 if name=='attack' else 0), label + ' preview duration')
            if name=='attack':
                once = Image.open(folder / 'Attack-OneShot.webp')
                check(once.size==(627,627) and once.info.get('loop')==1, label + ' one-shot preview')
                total = 0
                for i in range(once.n_frames):
                    once.seek(i); once.load(); total += once.info.get('duration',0)
                check(total==clip['durationMs'], label + ' one-shot duration')
            source = folder / meta['sourceAudit'][name.capitalize()]['sourceAtlas']
            check(source.is_file(), label + ' missing editable atlas')
            check(all(f['edgeAlpha']<=8 for f in meta['sourceAudit'][name.capitalize()]['frames']), label + ' source clipping')
            clip_audits[name] = {'frames':clip['frameCount'],'paintedPoses':len(hashes),'durationMs':clip['durationMs'],'previewDurationMs':preview_duration,'sheetSize':list(sheet.size),'passed':True}
        audits.append({'key':key,'directory':unit['directory'],'clips':clip_audits})
    except Exception as exc:
        errors.append(key + ': ' + str(exc))
report = {'passed':not errors,'scope':'file contracts, alpha, frame hashes, sheet pixels, preview timing, roster; camera and action direction reviewed visually','unitCount':len(manifest['units']),'clipCount':sum(len(u['clips']) for u in audits),'frameCount':sum(c['frames'] for u in audits for c in u['clips'].values()),'errors':errors,'units':audits}
(root / 'Weapons-Validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['passed','unitCount','clipCount','frameCount','errors']}))
sys.exit(0 if report['passed'] else 1)
