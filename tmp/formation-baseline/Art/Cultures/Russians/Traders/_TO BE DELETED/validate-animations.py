"""Check Russian trader sheets and physical invariants; render local reviews."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
module = importlib.util.spec_from_file_location('russian_trader_builder', ROOT / 'build-animations.py')
builder = importlib.util.module_from_spec(module)
module.loader.exec_module(builder)
BASE = ROOT.parents[2] / 'Trader Icons'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def frame(sheet, i):
    return sheet.crop((i%5*512, i//5*512, i%5*512+512, i//5*512+512))


def walking_review():
    size = 384
    images = []
    sheets = {age:Image.open(ROOT/age/'Travel.png') for age in ['BronzeAge','StoneAge']}
    for index in range(10):
        canvas = Image.new('RGBA',(size*2,size+32),(40,57,42,255))
        draw = ImageDraw.Draw(canvas)
        for column,age in enumerate(['BronzeAge','StoneAge']):
            x = column*size
            speed = read(ROOT/age/'animations.json')['walkingGroundSpeed']*size/512
            period = speed*10/12
            offset = speed*index/12
            draw.rectangle((x+158*size/512,32,x+354*size/512,size+32),fill=(52,69,45,255))
            for tile in range(-1,8):
                y = 32+tile*period-offset
                for px,py,length in [(185,.2,7),(277,.55,11),(226,.8,5)]:
                    mark_y = y+py*period
                    if 32 <= mark_y <= size+30:
                        draw.rectangle((x+px*size/512,mark_y,x+(px+length)*size/512,mark_y+2),fill=(66,83,51,255))
            canvas.alpha_composite(frame(sheets[age],index).resize((size,size),Image.Resampling.LANCZOS),(x,32))
            draw.text((x+12,10),'Russian '+('Bronze Age' if age=='BronzeAge' else 'Stone Age')+' / Walking',fill='white')
        images.append(canvas)
    images[0].save(ROOT/'Review/Walking_Review.webp',save_all=True,append_images=images[1:],
                   duration=[83,84,83,83,84,83,83,84,83,83],loop=0,lossless=True)
    images[0].save(ROOT/'Review/Walking_Review.png')


def main():
    cv2.setNumThreads(1)
    manifest = read(ROOT / 'Trader_Animation_Manifest.json')
    generation = read(ROOT / 'Generation-Manifest.json')
    checks = []
    for asset in manifest['assets']:
        if not asset.get('metadata'):
            continue
        folder = ROOT / asset['age']
        metadata = read(ROOT / asset['metadata'])
        for name, clip in metadata['animations'].items():
            sheet = Image.open(folder / clip['file'])
            frames = [frame(sheet, i) for i in range(10)]
            guards, differences = [], []
            for i, image in enumerate(frames):
                alpha = np.asarray(image.getchannel('A'))
                guards.append(not np.any(np.concatenate([alpha[:8].ravel(),alpha[-8:].ravel(),
                                                          alpha[:,:8].ravel(),alpha[:,-8:].ravel()])))
                current = np.asarray(image, dtype=np.float32)
                following = np.asarray(frames[(i+1)%10], dtype=np.float32)
                current[...,:3] *= current[...,3:4]/255
                following[...,:3] *= following[...,3:4]/255
                differences.append(round(float(np.mean(np.abs(current-following))),6))
            contract = {
                'file':asset['age']+'/'+clip['file'], 'dimensionsCorrect':sheet.size==(2560,1024),
                'transparentRGBA':sheet.mode=='RGBA' and sheet.getchannel('A').getextrema()[0]==0,
                'frameCount':10, 'nonemptyFrames':sum(bool(f.getbbox()) for f in frames),
                'distinctFrames':len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}),
                'eightPixelGuardClear':all(guards),
                'metadataCorrect':clip['frameCount']==10 and clip['frames']==[
                    {'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)]
                    and metadata['pivot']=={'x':256,'y':256}
                    and clip['suggestedFramesPerSecond']==(8 if name=='idle' else 12),
                'loopSeamComparable':differences[-1]<=max(differences[:-1])*1.2,
                'adjacentFrameDifferences':differences, 'frameBounds':[f.getbbox() for f in frames],
            }
            contract['passed'] = (contract['dimensionsCorrect'] and contract['transparentRGBA']
                and contract['nonemptyFrames']==10 and contract['distinctFrames']==10
                and contract['eightPixelGuardClear'] and contract['metadataCorrect']
                and contract['loopSeamComparable'])
            checks.append(contract)

    spec = read(ROOT / 'BronzeAge/rig-authoring.json')
    rig = builder.make_rig('BronzeAge', spec)
    reference = np.asarray(builder.animate_source(rig, 'Idle', 0))
    solid = np.zeros(reference.shape[:2], dtype=bool)
    for region in spec['protectedRegions']:
        x0,y0,x1,y1 = region['rect']; solid[y0:y1,x0:x1] = True
    tread = np.zeros_like(solid)
    for part in spec['parts']:
        if part['kind']=='tread':
            x0,y0,x1,y1 = part['rect']; tread[y0:y1,x0:x1] = True
    fixed = solid & ~tread
    rigid, alpha_fixed, treadmill_changed = True, True, False
    for motion in ['Idle','Travel']:
        for i in range(10):
            pose = np.asarray(builder.animate_source(rig, motion, i))
            rigid &= bool(np.array_equal(pose[fixed], reference[fixed]))
            alpha_fixed &= bool(np.array_equal(pose[...,3][solid], reference[...,3][solid]))
            if motion=='Travel':
                treadmill_changed |= bool(np.any(pose[...,:3][tread]!=reference[...,:3][tread]))
    physical = {
        'cartCargoShaftsAndHubsUnchanged':rigid, 'wheelAndCartAlphaUnchanged':alpha_fixed,
        'treadTextureAnimates':treadmill_changed, 'noSuspensionRegions':all(p['kind']!='suspension' for p in spec['parts']),
        'smoothTreadMaster':'SourceArt/Trader_Russian_BronzeAge_v2.png',
        'note':'Exact source-space checks across all 20 Bronze Age poses; wheel outlines, hubs, shafts and secured cargo remain fixed.',
    }
    gait_checks = []
    for age in ['StoneAge','BronzeAge']:
        metadata = read(ROOT / age / 'animations.json')
        config = read(ROOT / age / 'rig-authoring.json')['walkingRig']
        tracks = metadata['footTracks']
        leads = [tracks['left'][i]['ankle'][1]-tracks['right'][i]['ankle'][1] for i in range(10)]
        stroke = config['forwardReach']+config['rearReach']
        lengths_valid,plants_valid = True,True
        contact_pairs = 0
        for side in ['left','right']:
            for pose in tracks[side]:
                for first,second,expected in [('hip','knee',config['thighLength']),('knee','ankle',config['shinLength'])]:
                    length = math.sqrt(sum((pose[first][axis]-pose[second][axis])**2 for axis in range(3)))
                    lengths_valid &= abs(length-expected)<1
            for first,second in zip(tracks[side],tracks[side][1:]):
                if not (first['stance'] and second['stance'] and second['cycle']>first['cycle']):
                    continue
                ground_delta = stroke/config['stanceFraction']*(second['cycle']-first['cycle'])
                plants_valid &= (abs(second['ankle'][1]-first['ankle'][1]+ground_delta)<.001
                                 and abs(second['ankle'][0]-first['ankle'][0])<.001
                                 and first['lift']==second['lift']==0)
                contact_pairs += 1
        entry = {
            'age':age,'leftFootLeads':max(leads)>stroke*.5,'rightFootLeads':min(leads)<-stroke*.5,
            'fullStrideExcursion':all(max(p['ankle'][1] for p in tracks[side])-min(p['ankle'][1] for p in tracks[side])>stroke*.85
                                      for side in ['left','right']),
            'liftedRecoveryBothFeet':all(max(p['lift'] for p in tracks[side])>=config['footLift']*.95 for side in ['left','right']),
            'plantedStanceMatchesGroundMotion':plants_valid and contact_pairs>=8,
            'boneLengthsValid':lengths_valid,'stanceSamplesPerFoot':{s:sum(p['stance'] for p in tracks[s]) for s in tracks},
            'frontRearSeparation':leads,'groundSpeedPixelsPerSecond':metadata['walkingGroundSpeed'],
            'separatePaintedLegLayers':len(read(ROOT/age/'rig.json')['articulatedLayers'])==6,
        }
        entry['passed'] = all(entry[k] for k in ['leftFootLeads','rightFootLeads','fullStrideExcursion',
            'liftedRecoveryBothFeet','plantedStanceMatchesGroundMotion','boneLengthsValid','separatePaintedLegLayers'])
        gait_checks.append(entry)
    sources = [{'age':age, 'file':file, 'sha256':sha(ROOT/file),
                'unchanged':sha(ROOT/file)==generation['sourceHashes'][age]}
               for age,file in generation['selected'].items()]
    baseline = read(ROOT / 'Review/Base_Art_Baseline.json')
    changed = [file for file, expected in baseline.items() if sha(BASE/file)!=expected]
    boats_root = ROOT.parent / 'Ships'
    boats = read(ROOT/'Review/Approved_Boats_Baseline.json')
    # A new age legitimately extends the catalog. Audit the earlier published
    # entries against their preserved source and metadata files separately.
    catalog_changes = [file for file,expected in boats.items()
                       if file=='Ship_Animation_Manifest.json' and sha(boats_root/file)!=expected]
    changed_boats = [file for file,expected in boats.items()
                     if file!='Ship_Animation_Manifest.json' and sha(boats_root/file)!=expected]
    boat_catalog = read(boats_root/'Ship_Animation_Manifest.json')
    earlier_boats = [a for a in boat_catalog['assets'] if a['age'] in ['StoneAge','BronzeAge']]
    earlier_catalog_valid = len(earlier_boats)==6
    for asset in earlier_boats:
        metadata_file = asset.get('metadata')
        poster_file = asset.get('poster')
        earlier_catalog_valid &= (metadata_file in boats and poster_file in boats
            and sha(boats_root/metadata_file)==boats[metadata_file]
            and sha(boats_root/poster_file)==boats[poster_file])
        if metadata_file:
            expected_clips = [clip['file'] for clip in read(boats_root/metadata_file)['animations'].values()]
            earlier_catalog_valid &= asset.get('clips')==expected_clips
    classical_report = None
    if any(a['age']=='ClassicalAge' and a.get('metadata') for a in manifest['assets']):
        classical_module = importlib.util.spec_from_file_location('classical_trader_validation', ROOT/'validate-classical-animations.py')
        classical = importlib.util.module_from_spec(classical_module)
        classical_module.loader.exec_module(classical)
        classical_report = classical.audit()
        gait_checks.extend(classical_report['gaits'])
        classical_generation = read(ROOT/'ClassicalAge/Generation-Manifest.json')
        classical_source = ROOT/'ClassicalAge'/classical_generation['selected']
        sources.append({'age':'ClassicalAge','file':'ClassicalAge/'+classical_generation['selected'],
            'sha256':sha(classical_source),'unchanged':sha(classical_source)==classical_generation['sourceSha256']})
    report = {
        'schemaVersion':1, 'cultureId':'russian', 'primaryClipCount':len(checks),
        'frameCount':sum(c['frameCount'] for c in checks),
        'assetContractsPassed':len(checks)==sum(len(a.get('clips',[])) for a in manifest['assets'] if a.get('metadata')) and all(c['passed'] for c in checks),
        'sourcesPreserved':all(s['unchanged'] for s in sources), 'sources':sources,
        'walkingAtlasPreserved':sha(ROOT/generation['sharedWalkingAtlas']['file'])==generation['sharedWalkingAtlas']['sha256'],
        'baseArtworkFileCount':len(baseline), 'baseArtworkUnchanged':not changed, 'baseArtworkChanges':changed,
        'bothAgesAnimated':all(a.get('metadata') and len(a['clips'])==2 for a in manifest['assets'] if a['age'] in ['StoneAge','BronzeAge']),
        'allAuthoredAgesAnimated':all(a.get('metadata') and len(a['clips'])==2 for a in manifest['assets']),
        'approvedBoatArtFileCount':len(boats)-1,'approvedBoatsUnchanged':not changed_boats and earlier_catalog_valid,'approvedBoatChanges':changed_boats,
        'approvedBoatCatalogChanges':catalog_changes,'earlierBoatCatalogEntriesValid':bool(earlier_catalog_valid),
        'classicalCaravanAudit':classical_report,
        'physicalInvariants':physical, 'gaits':gait_checks, 'clips':checks,
        'validationLimit':'Sheet contracts and browser artwork review only; no engine integration or live match certification.',
    }
    report['passed'] = (report['assetContractsPassed'] and report['sourcesPreserved']
        and report['walkingAtlasPreserved'] and report['baseArtworkUnchanged'] and report['bothAgesAnimated'] and report['approvedBoatsUnchanged']
        and all(c['passed'] for c in gait_checks) and rigid and alpha_fixed and treadmill_changed and physical['noSuspensionRegions']
        and (classical_report is None or classical_report['passed']))
    builder.save_json(ROOT / 'Trader_Animation_Validation.json', report)
    for age in ['StoneAge','BronzeAge']:
        local = dict(report)
        local['age'] = age
        local['primaryClipCount'] = 2; local['frameCount'] = 20
        local['clips'] = [c for c in checks if c['file'].startswith(age+'/')]
        local['gaits'] = [c for c in gait_checks if c['age']==age]
        builder.save_json(ROOT / age / 'Animation_Validation.json',local)

    sheets = [Image.open(ROOT / 'BronzeAge' / f'{motion}.png') for motion in ['Idle','Travel']]
    review_frames = []
    for i in range(60):
        canvas = Image.new('RGBA',(704,388),(40,57,42,255)); draw=ImageDraw.Draw(canvas)
        for column, (motion,sheet) in enumerate(zip(['Idle','Travel'],sheets)):
            pose = (i*(8 if motion=='Idle' else 12)//24)%10
            canvas.alpha_composite(frame(sheet,pose).resize((352,352),Image.Resampling.LANCZOS),(column*352,30))
            draw.text((column*352+16,10),'Russian Bronze Age / '+motion,fill=(235,239,225,255))
        review_frames.append(canvas)
    review_frames[0].save(ROOT / 'Review/BronzeAge_Animations.webp', save_all=True,
                          append_images=review_frames[1:], duration=[42,42,41]*20, loop=0, lossless=True)
    # Static pose strip exposes gait extremes, smooth wheel outlines and fixed shafts.
    strip = Image.new('RGBA',(5*288,322),(40,57,42,255)); draw=ImageDraw.Draw(strip)
    for column,i in enumerate([0,2,4,7,9]):
        strip.alpha_composite(frame(sheets[1],i).resize((288,288),Image.Resampling.LANCZOS),(column*288,28))
        draw.text((column*288+12,8),f'Travel frame {i+1}',fill=(235,239,225,255))
    strip.save(ROOT / 'Review/BronzeAge_Gait_Extremes.png')
    walking_review()
    print(json.dumps({k:report[k] for k in ['passed','primaryClipCount','frameCount','assetContractsPassed',
                                          'sourcesPreserved','baseArtworkUnchanged','bothAgesAnimated','approvedBoatsUnchanged']} |
                     {'physicalInvariants':physical,'gaits':gait_checks},indent=2))
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--age', choices=['ClassicalAge'], help='Validate only the Classical caravan without rewriting earlier reports.')
    args = parser.parse_args()
    if args.age == 'ClassicalAge':
        spec = importlib.util.spec_from_file_location('focused_classical_trader_validation', ROOT/'validate-classical-animations.py')
        classical = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(classical)
        classical.main()
    else:
        main()
