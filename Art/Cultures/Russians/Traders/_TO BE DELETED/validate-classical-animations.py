"""Validate Classical caravan gait, sheets, attachments and preservation."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
FOLDER = ROOT/'ClassicalAge'
module = importlib.util.spec_from_file_location('classical_caravan_validation', ROOT/'caravan-rig.py')
caravan = importlib.util.module_from_spec(module)
module.loader.exec_module(caravan)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def frame(sheet,index):
    return sheet.crop((index%5*512,index//5*512,index%5*512+512,index//5*512+512))


def gait_audit(spec, metadata):
    checks = []
    members = spec['caravanRig']['merchants']+spec['caravanRig']['horses']
    for member in members:
        config = member['rig']; tracks = metadata['memberFootTracks'][member['name']]
        stroke = config['forwardReach']+config['rearReach']
        valid_lengths, planted, contact_pairs = True,True,0
        for leg,poses in tracks.items():
            if leg.startswith('fore'):
                lengths = [('hip','knee',config['foreUpperLength']),
                           ('knee','fetlock',config['foreLowerLength']),
                           ('fetlock','ankle',config['pasternLength'])]
            else:
                lengths = [('hip','knee',config.get('thighLength',config.get('upperLength'))),
                           ('knee','ankle',config.get('shinLength',config.get('lowerLength')))]
            for pose in poses:
                for first,second,expected in lengths:
                    actual = math.dist(pose[first],pose[second])
                    valid_lengths &= abs(actual-expected)<1
            for first,second in zip(poses,poses[1:]):
                if not (first['stance'] and second['stance'] and second['cycle']>first['cycle']):
                    continue
                ground_delta = stroke/config['stanceFraction']*(second['cycle']-first['cycle'])
                planted &= (abs(second['ankle'][1]-first['ankle'][1]+ground_delta)<.001
                    and abs(second['ankle'][0]-first['ankle'][0])<.001
                    and first['lift']==second['lift']==0)
                contact_pairs += 1
        entry = {'age':'ClassicalAge','member':member['name'],'legCount':len(tracks),
            'boneLengthsValid':bool(valid_lengths),
            'plantedStanceMatchesGroundMotion':bool(planted and contact_pairs>=len(tracks)*3),
            'fullStrideExcursionEveryLeg':all(max(p['ankle'][1] for p in poses)-min(p['ankle'][1] for p in poses)>stroke*.85 for poses in tracks.values()),
            'liftedRecoveryEveryLeg':all(max(p['lift'] for p in poses)>config['footLift']*.90 for poses in tracks.values()),
            'stanceSamplesPerLeg':{leg:sum(p['stance'] for p in poses) for leg,poses in tracks.items()},
            'sharedContactVelocity':abs(stroke/config['stanceFraction']-
                (spec['caravanRig']['sharedStride']['forwardReach']+spec['caravanRig']['sharedStride']['rearReach'])/
                spec['caravanRig']['sharedStride']['stanceFraction'])<.001,
            'groundSpeedPixelsPerSecond':metadata['walkingGroundSpeed']}
        if member['name'].startswith('merchant'):
            leads = [tracks['left'][i]['ankle'][1]-tracks['right'][i]['ankle'][1] for i in range(10)]
            entry['bothFeetTakeLead'] = max(leads)>stroke*.45 and min(leads)<-stroke*.45
        else:
            entry['fourDistinctContactPhases'] = len({round(poses[0]['cycle'],5) for poses in tracks.values()})==4
            entry['hipsToFeetContinuous'] = all(p['knee'][1]>config['hips'][leg][1]-15 for leg,poses in tracks.items() for p in poses)
        entry['passed'] = all(entry[key] for key in ['boneLengthsValid','plantedStanceMatchesGroundMotion',
            'fullStrideExcursionEveryLeg','liftedRecoveryEveryLeg','sharedContactVelocity'])
        entry['passed'] &= entry.get('bothFeetTakeLead',True) and entry.get('fourDistinctContactPhases',True) and entry.get('hipsToFeetContinuous',True)
        checks.append(entry)
    return checks


def sheet_audit(folder, metadata):
    checks = []
    for name,clip in metadata['animations'].items():
        sheet = Image.open(folder/clip['file']); frames = [frame(sheet,i) for i in range(10)]
        differences,guards = [],[]
        for i,image in enumerate(frames):
            alpha = np.asarray(image.getchannel('A'))
            guards.append(not np.any(np.concatenate([alpha[:8].ravel(),alpha[-8:].ravel(),alpha[:,:8].ravel(),alpha[:,-8:].ravel()])))
            a = np.asarray(image,dtype=np.float32); b = np.asarray(frames[(i+1)%10],dtype=np.float32)
            a[...,:3] *= a[...,3:4]/255; b[...,:3] *= b[...,3:4]/255
            differences.append(float(np.mean(np.abs(a-b))))
        result = {'file':clip['file'],'rgba':sheet.mode=='RGBA','dimensionsCorrect':sheet.size==(2560,1024),
            'frameCount':10,'nonemptyFrames':sum(bool(f.getbbox()) for f in frames),
            'distinctFrames':len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}),
            'eightPixelGuardClear':all(guards),
            'correctFrameGrid':clip['frames']==[{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)],
            'correctTiming':clip['suggestedFramesPerSecond']==(8 if name=='idle' else 12),
            'loopSeamComparable':differences[-1]<=max(differences[:-1])*1.2,
            'adjacentFrameDifferences':[round(x,6) for x in differences],'bounds':[f.getbbox() for f in frames]}
        result['passed'] = all(result[k] for k in ['rgba','dimensionsCorrect','eightPixelGuardClear','correctFrameGrid','correctTiming','loopSeamComparable']) and result['nonemptyFrames']==result['distinctFrames']==10
        checks.append(result)
    return checks


def physical_audit(spec,rig):
    reference = np.asarray(caravan.animate_source(rig,'Idle',0))
    source = np.asarray(rig['source'])
    protected = np.zeros(reference.shape[:2],dtype=bool)
    for part in spec['protectedRegions']:
        x0,y0,x1,y1 = part['rect']; protected[y0:y1,x0:x1] = True
    protected &= source[...,3]==255
    tread = np.zeros_like(protected)
    for part in spec['parts']:
        if part['kind']=='tread':
            x0,y0,x1,y1=part['rect'];tread[y0:y1,x0:x1]=True
    fixed = protected & ~tread
    unchanged,stable_alpha,rolling = True,True,False
    for motion in ['Idle','Travel']:
        for i in range(10):
            image = np.asarray(caravan.animate_source(rig,motion,i))
            unchanged &= bool(np.array_equal(image[fixed],reference[fixed]))
            stable_alpha &= bool(np.array_equal(image[...,3][protected],reference[...,3][protected]))
            if motion=='Travel':
                rolling |= bool(np.any(image[...,:3][tread]!=reference[...,:3][tread]))
    return {'retainedWagonCargoDrawbarsHubsAndPanniersUnchanged':unchanged,
            'protectedSilhouettesUnchanged':stable_alpha,'treadTextureRolls':rolling,
            'articulatedMemberCount':4,'articulatedLegCount':12,
            'separatePaintedLimbLayers':len(rig['caravan']['pieces']),
            'note':'Opaque protected source-space paint audited across all twenty poses; wheel RGB rolls inside the retained silhouette.'}


def audit():
    spec = read(FOLDER/'rig-authoring.json'); metadata=read(FOLDER/'animations.json')
    rig = caravan.prepare(spec)
    gaits = gait_audit(spec,metadata); clips=sheet_audit(FOLDER,metadata); physical=physical_audit(spec,rig)
    generation = read(FOLDER/'Generation-Manifest.json')
    master = FOLDER/spec['source']
    sources_unchanged = caravan.painted.sha(master)==generation['sourceSha256']==metadata['sourceSha256']
    old = read(ROOT.parent/'Ships/ClassicalAge/Review/Animation_Preservation_Baseline.json')
    art = ROOT.parents[2]
    changes = [rel for rel,expected in old.items() if not (art/rel).exists() or caravan.painted.sha(art/rel)!=expected]
    ship_report = read(ROOT.parent/'Ships/ClassicalAge/Animation_Validation.json')
    report = {'schemaVersion':1,'age':'ClassicalAge','cultureId':'russian','primaryClipCount':2,'frameCount':20,
        'assetContractsPassed':all(c['passed'] for c in clips),'sourcesPreserved':sources_unchanged,
        'previousArtworkFileCount':len(old),'previousArtworkUnchanged':not changes,'previousArtworkChanges':changes,
        'gaits':gaits,'physicalInvariants':physical,'clips':clips,
        'classicalBoatPrimaryClips':ship_report['primaryClipCount'],
        'classicalBoatContractsPassed':ship_report['assetContractsPassed'] and ship_report['approvedMastersUnchanged'],
        'validationLimit':'Native sheet, gait and preservation checks; browser evidence separate. No game-match integration certification.'}
    report['passed'] = (report['assetContractsPassed'] and report['sourcesPreserved'] and report['previousArtworkUnchanged']
        and report['classicalBoatContractsPassed'] and all(g['passed'] for g in gaits)
        and all(physical[k] for k in ['retainedWagonCargoDrawbarsHubsAndPanniersUnchanged','protectedSilhouettesUnchanged','treadTextureRolls']))
    return report


def reviews():
    sheets = {m:Image.open(FOLDER/(m+'.png')) for m in ['Idle','Travel']}
    metadata = read(FOLDER/'animations.json')
    size=384; speed=metadata['walkingGroundSpeed']*size/512; period=speed*10/12
    images=[]
    for i in range(60):
        canvas=Image.new('RGBA',(size*2,size+32),(34,52,38,255));draw=ImageDraw.Draw(canvas)
        for column,motion in enumerate(['Idle','Travel']):
            x=column*size; pose=(i*(8 if motion=='Idle' else 12)//24)%10
            if motion=='Travel':
                draw.rectangle((x+72,32,x+312,size+32),fill=(45,62,43,255))
                offset=speed*i/24
                for tile in range(-1,15):
                    y=32+tile*period-offset
                    for px,py,width in [(90,.2,7),(196,.6,11),(288,.8,5)]:
                        row=y+py*period
                        if 32<=row<=size+29:
                            draw.rectangle((x+px,row,x+px+width,row+2),fill=(61,78,48,255))
            canvas.alpha_composite(frame(sheets[motion],pose).resize((size,size),Image.Resampling.LANCZOS),(x,32))
            draw.text((x+12,9),'Russian Classical Age / '+motion,fill='white')
        images.append(canvas)
    images[0].save(FOLDER/'Review/Walking_Review.webp',save_all=True,append_images=images[1:],duration=[42,42,41]*20,loop=0,lossless=True)
    images[4].save(FOLDER/'Review/Walking_Review.png')
    grid=Image.new('RGBA',(5*384,2*412),(34,52,38,255));draw=ImageDraw.Draw(grid)
    for i in range(10):
        x=i%5*384;y=i//5*412
        grid.alpha_composite(frame(sheets['Travel'],i).resize((384,384),Image.Resampling.LANCZOS),(x,y+28))
        draw.text((x+12,y+9),f'Travel frame {i+1}',fill='white')
    grid.save(FOLDER/'Review/All_Travel_Poses.png')
    detail=Image.new('RGBA',(2*750,2*290),(34,52,38,255));draw=ImageDraw.Draw(detail)
    for col,i in enumerate([0,2,5,7]):
        x=col%2*750;y=col//2*290
        detail.alpha_composite(frame(sheets['Travel'],i).crop((64,310,440,450)).resize((750,280),Image.Resampling.NEAREST),(x,y+10))
        draw.text((x+8,y+2),f'Foot contact frame {i+1}',fill='white')
    detail.save(FOLDER/'Review/Feet_And_Joins_Audit.png')


def main():
    caravan.cv2.setNumThreads(1)
    report=audit()
    caravan.write_json(FOLDER/'Animation_Validation.json',report)
    reviews()
    print(json.dumps({k:report[k] for k in ['passed','primaryClipCount','frameCount','assetContractsPassed','sourcesPreserved','previousArtworkUnchanged']}|{'gaits':report['gaits'],'physicalInvariants':report['physicalInvariants']},indent=2))
    if not report['passed']:
        raise SystemExit(1)


if __name__=='__main__':
    main()
