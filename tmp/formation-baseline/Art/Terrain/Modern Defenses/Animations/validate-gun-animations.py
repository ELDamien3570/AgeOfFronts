"""Check timing, cyclic motion, fixed bases, layered exports and atlas bounds."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
failures=[]
counts={'clips':0,'frames':0,'layerCompositions':0,'fixedPitFrames':0,'unclippedFrames':0,'correctMuzzleEvents':0,'sourceFilesPreserved':0,'loopMotionChecks':0}


def check(condition,message):
    if not condition: failures.append(message)


def rgba(path):
    with Image.open(path) as image:
        check(image.mode=='RGBA',f'Expected RGBA: {path.relative_to(ROOT)}')
        return np.asarray(image.convert('RGBA')).copy()


def point_from_rig(muzzle,pivot,angle,recoil,offset):
    radians=np.deg2rad(angle); rotation=np.array([[np.cos(radians),-np.sin(radians)],[np.sin(radians),np.cos(radians)]])
    return np.asarray(pivot)+offset+rotation@(np.asarray(muzzle)-np.asarray(pivot)+[0,recoil])


def main():
    manifest=json.loads((ROOT/'Gun_Animation_Manifest.json').read_text()); config=json.loads((ROOT/'weapon-rigs.json').read_text()); size=manifest['frameSize']
    offset=manifest['sourceOffset']; check(size==336 and manifest['sourceCellSize']==256 and offset==40,'Padded-canvas / cell-size contract')
    check(manifest['renderScaleInCells']==size/256 and manifest['pivot']=={'x':size/2,'y':size/2},'World-scale / center-pivot contract')
    for asset in manifest['assets']:
        rig=json.loads((ROOT/asset['rig']).read_text()); plate=rgba(ROOT/asset['basePlate']); plate_image=Image.fromarray(plate)
        spec=next(value for value in config['types'] if value['id']==asset['id'])
        check(plate.shape==(size,size,4),f"{asset['id']}: base dimensions")
        # Wide corner strips of the sandbagged pit are never swept by the gun.
        # Their pixels should remain stationary across headings and clips.
        floor_guard=np.zeros((size,size),dtype=bool); floor_guard[90:245,68:84]=True; floor_guard[90:245,238:252]=True
        for facing,metadata_path in asset['facings'].items():
            metadata=json.loads((ROOT/metadata_path).read_text()); folder=(ROOT/metadata_path).parent
            check((folder/metadata['basePlate']).resolve()==(ROOT/asset['basePlate']).resolve(),f"{asset['id']} {facing}: base rotated or swapped")
            check(metadata['cellRect']=={'x':offset,'y':offset,'width':256,'height':256},f"{asset['id']} {facing}: pit scale changed")
            for motion,animation in metadata['animations'].items():
                counts['clips']+=1; label=f"{asset['id']} {facing} {motion}"; full=rgba(folder/animation['file']); weapon=rgba(folder/animation['weaponFile'])
                check(full.shape==weapon.shape==(animation['sheetSize']['height'],animation['sheetSize']['width'],4),f'{label}: sheet dimensions')
                check(len(animation['frames'])==len(animation['kinematics'])==animation['frameCount'],f'{label}: frame/pose counts')
                check(animation['loop'] is True and animation['distinctPoseCount']>=6,f'{label}: no meaningful animation')
                alpha_union=np.zeros((size,size),dtype=bool)
                for rect,kinematics in zip(animation['frames'],animation['kinematics']):
                    counts['frames']+=1; x,y=rect['x'],rect['y']; frame=full[y:y+size,x:x+size]; overlay=weapon[y:y+size,x:x+size]
                    check(frame.shape==(size,size,4),f'{label}: frame crop dimensions')
                    expected=np.asarray(Image.alpha_composite(plate_image,Image.fromarray(overlay)))
                    check(np.array_equal(frame,expected),f"{label} frame {rect['index']}: separate-layer composition differs"); counts['layerCompositions']+=1
                    static=overlay[...,3]==0; check(np.array_equal(frame[static],plate[static]),f'{label}: pit moved between frames'); counts['fixedPitFrames']+=1
                    alpha_union|=overlay[...,3]>0
                    border=np.concatenate([frame[:4,:,3].ravel(),frame[-4:,:,3].ravel(),frame[:,:4,3].ravel(),frame[:,-4:,3].ravel()])
                    check(border.max()==0,f"{label} frame {rect['index']}: clipped barrel or flash"); counts['unclippedFrames']+=1
                    check(frame[...,3].min()==0 and frame[...,3].max()==255,f'{label}: missing transparent margins')
                    for event in kinematics['shots']:
                        barrel_index=event['barrel']-1; barrel=spec['barrels'][barrel_index]
                        muzzle=point_from_rig(barrel['muzzle'],spec['pivot'],kinematics['angleDegrees'],kinematics['barrelRecoilPixels'][barrel_index],offset)
                        check(np.linalg.norm(muzzle-[event['muzzle']['x'],event['muzzle']['y']])<.005,f'{label}: flash detached from muzzle')
                        px,py=np.rint(muzzle).astype(int); patch=overlay[max(0,py-2):py+3,max(0,px-2):px+3]
                        check(patch[...,0].max()>=220 and patch[...,3].max()>=220,f'{label}: missing flash at scheduled muzzle'); counts['correctMuzzleEvents']+=1
                stable_guard=floor_guard & ~alpha_union
                check(stable_guard.sum()>=1000,f'{label}: insufficient stationary sandbag guard region')
                if motion=='firing':
                    check(animation['suggestedFramesPerSecond']==50 and animation['cyclicRoundsPerMinutePerBarrel']==500,f'{label}: wrong shot cadence')
                    for index in range(asset['barrelCount']):
                        shots=[pose['index'] for pose in animation['kinematics'] if any(event['barrel']==index+1 for event in pose['shots'])]
                        check(len(shots)==6 and np.all(np.diff(shots)==6),f'{label}: shot intervals drift')
                        phases=[pose['barrelRecoilPixels'][index] for pose in animation['kinematics']]
                        check(min(phases)==0 and max(phases)==2,f'{label}: recoil does not return to battery')
                    check(len({pose['angleDegrees'] for pose in animation['kinematics']})==1,f'{label}: unwanted aim wobble while firing')
                else:
                    check(animation['suggestedFramesPerSecond']==24 and all(not pose['shots'] for pose in animation['kinematics']),f'{label}: unexpected fire during tracking')
                    angles=np.array([pose['angleDegrees'] for pose in animation['kinematics']]); heading=['N','E','S','W'].index(facing)*90
                    check(abs(angles[0]-heading)<.001 and abs(angles.min()-(heading-spec['trackingDegrees']))<.001 and abs(angles.max()-(heading+spec['trackingDegrees']))<.001,f'{label}: incorrect mount traverse')
                    steps=np.abs(np.diff(np.r_[angles,angles[0]])); check(steps.max()<3.2,f'{label}: tracking loop snaps at wrap')
                counts['loopMotionChecks']+=1
    for source in manifest['sources']:
        path=ROOT.parent/source['file']; check(hashlib.sha256(path.read_bytes()).hexdigest()==source['sha256'],f"Source changed: {source['file']}"); counts['sourceFilesPreserved']+=1
    check(counts['clips']==16 and counts['frames']==672 and counts['correctMuzzleEvents']==120,'Incomplete animation audit coverage')
    report={'passed':not failures,'checks':counts,'failures':failures,'scope':'Animation asset and timing contracts; no weapon-model certification or game combat/runtime integration.'}
    (ROOT/'Gun_Animation_Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8'); print(json.dumps(report,indent=2))
    if failures: raise SystemExit(1)


if __name__=='__main__': main()
