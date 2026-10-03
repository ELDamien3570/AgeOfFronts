"""Build approved Russian trader loops using the existing trader sprite contract.

Writes only this culture's trader folder. Original paintings and unapproved
ages remain untouched. Simulation owns translation and trading behavior.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
BASE = ROOT.parents[2] / 'Trader Icons' / 'animate-traders.py'
module = importlib.util.spec_from_file_location('trader_painted_motion', BASE)
painted = importlib.util.module_from_spec(module)
module.loader.exec_module(painted)
walking_module = importlib.util.spec_from_file_location('trader_walking_rig', ROOT / 'walking-rig.py')
walking = importlib.util.module_from_spec(walking_module)
walking_module.loader.exec_module(walking)


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def make_rig(age, spec):
    rig = painted.make_rig(age, spec, ROOT / age / spec['source'])
    # Drawbars and grips must stay connected: exclude their painted area from
    # local body/cloth fields. Tread scrolling affects RGB only, never alpha.
    for part in rig['regions']:
        bx0,by0,bx1,by1 = part['box']
        for region in spec.get('protectedRegions', []):
            x0,y0,x1,y1 = region['rect']
            ix0,iy0,ix1,iy1 = max(x0,bx0),max(y0,by0),min(x1,bx1),min(y1,by1)
            if ix0 < ix1 and iy0 < iy1:
                part['mask'][iy0-by0:iy1-by0,ix0-bx0:ix1-bx0] = 0
    return walking.prepare(rig, spec, ROOT)


def animate_source(rig, motion, index):
    body = painted.animate_source(rig, motion, index)
    return walking.render(rig, body, motion, index, painted.COUNT)


def frame_vessel(rig, motion, index):
    source = animate_source(rig, motion, index)
    placement = rig['placement']; crop = placement['crop']; scale = placement['scale']
    resized = source.crop(crop).resize((round((crop[2]-crop[0])*scale),round((crop[3]-crop[1])*scale)),Image.Resampling.LANCZOS)
    native = Image.new('RGBA',(painted.NATIVE,painted.NATIVE),(0,0,0,0))
    native.alpha_composite(resized,tuple(placement['offset']))
    frame = Image.new('RGBA',(512,512),(0,0,0,0))
    frame.alpha_composite(native.resize((420,420),Image.Resampling.LANCZOS),(46,46))
    return frame


def build(age):
    if age == 'ClassicalAge':
        caravan_module = importlib.util.spec_from_file_location('trader_caravan_rig', ROOT / 'caravan-rig.py')
        caravan = importlib.util.module_from_spec(caravan_module)
        caravan_module.loader.exec_module(caravan)
        return caravan.export(age, ROOT)
    spec = json.loads((ROOT / age / 'rig-authoring.json').read_text(encoding='utf-8'))
    if spec.get('animationApproval', {}).get('status') != 'approved':
        raise ValueError(f'{age}: animation approval is required')
    original = ROOT / age / spec['source']
    rig = make_rig(age, spec)
    folder = ROOT / age
    (folder / 'layers').mkdir(parents=True, exist_ok=True)
    rig['native'].save(folder / 'Source_Transparent.png', optimize=True)
    rig['source'].save(folder / 'layers' / 'Original_Painting.png', optimize=True)
    body = rig['source'].copy()
    alpha = np.asarray(body.getchannel('A')).copy()
    alpha[np.asarray(rig['walking']['removal'])>0] = 0
    body.putalpha(Image.fromarray(alpha)); body.save(folder / 'layers/Body_Occlusion.png', optimize=True)
    rig['walking']['removal'].save(folder / 'layers/Old_Legs_Removal_Mask.png')
    for name,piece in rig['walking']['pieces'].items():
        piece.save(folder / 'layers' / (name+'.png'),optimize=True)
    definitions = []
    for part in rig['regions']:
        mask = Image.new('L', rig['source'].size, 0)
        mask.paste(Image.fromarray((part['mask']*255).astype(np.uint8)), part['box'][:2])
        mask_file = 'layers/'+part['name']+'-mask.png'
        paint_file = 'layers/'+part['name']+'.png'
        mask.save(folder / mask_file)
        layer = rig['source'].copy()
        alpha = np.asarray(rig['source'].getchannel('A'), dtype=np.float32)*np.asarray(mask)/255
        layer.putalpha(Image.fromarray(alpha.astype(np.uint8)))
        layer.save(folder / paint_file, optimize=True)
        definitions.append({k:v for k,v in part.items() if k not in ['mask','xx','yy','box']} |
                           {'maskFile':mask_file, 'paintFile':paint_file})
    save_json(folder / 'rig.json', {
        'cultureId':'russian', 'age':age, 'source':spec['source'],
        'sourceSha256':painted.sha(original), 'generatedSize':list(rig['source'].size),
        'nativeSize':[painted.NATIVE,painted.NATIVE], 'placement':rig['placement'],
        'layers':definitions,
        'walkingRig':spec['walkingRig'], 'bodyOcclusion':'layers/Body_Occlusion.png',
        'articulatedLayers':['layers/'+name+'.png' for name in rig['walking']['pieces']],
        'authoring':'Separate painted thighs, shins and feet; height/forward IK projected overhead. '
                    'Alternating planted stance and lifted recovery. Original tunic occludes hip joints. '
                    'Bronze cart, cargo, shafts, axle hubs and wheel silhouettes remain fixed.',
    })
    animations = {}
    for motion in ['Idle','Travel']:
        frames = [frame_vessel(rig, motion, i) for i in range(painted.COUNT)]
        painted.write_sheet(frames, folder / (motion+'.png'))
        animations[motion.lower()] = {
            'file':motion+'.png', 'frameCount':painted.COUNT,
            'suggestedFramesPerSecond':8 if motion=='Idle' else 12, 'loop':True,
            'frames':[{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512}
                      for i in range(painted.COUNT)],
            'distinctPoseCount':len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}),
        }
        frames[0].save(folder / (motion+'.webp'), save_all=True, append_images=frames[1:],
                       duration=125 if motion=='Idle' else 83, loop=0, lossless=True)
    save_json(folder / 'animations.json', {
        'schemaVersion':1, 'cultureId':'russian', 'unit':spec['label'], 'age':age,
        'category':'OverlandTrader', 'memberCounts':spec['counts'],
        'camera':'vertical-overhead-orthographic', 'facing':'screen-down',
        'frameSize':{'width':512,'height':512}, 'sheetSize':{'width':2560,'height':1024},
        'grid':{'columns':5,'rows':2}, 'pivot':{'x':256,'y':256},
        'normalizedPivot':{'x':.5,'y':.5}, 'frameOrder':'left-to-right-then-next-row',
        'animations':animations, 'source':spec['source'], 'sourceSha256':painted.sha(original),
        'animationApproval':spec['animationApproval'],
        'animationRevision':2, 'gait':'articulated stance and swing',
        'walkingGroundSpeed':(spec['walkingRig']['forwardReach']+spec['walkingRig']['rearReach'])
            /spec['walkingRig']['stanceFraction']*12/painted.COUNT*rig['placement']['scale']*420/painted.NATIVE,
        'footTracks':{side:[walking.leg_pose(spec['walkingRig'],side,i/painted.COUNT,True)
                            for i in range(painted.COUNT)] for side in ['left','right']},
        'timingNote':'Simulation owns world movement, trade routes and delivery. These are presentation loops.',
        'integrationStatus':'artwork-only; not connected to game renderer',
    })
    # Update only the approved age; a static/unapproved age retains its poster.
    manifest_path = ROOT / 'Trader_Animation_Manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for asset in manifest['assets']:
        if asset['age'] != age:
            continue
        asset.update({
            'poster':age+'/'+spec['source'], 'original':age+'/'+spec['source'],
            'sourceSha256':painted.sha(original), 'metadata':age+'/animations.json',
            'status':'animations-exported', 'clips':[age+'/Idle.png',age+'/Travel.png'],
            'animationApproval':spec['animationApproval'],
        })
    manifest['clipCount'] = sum(len(asset.get('clips',[])) for asset in manifest['assets'])
    manifest['status'] = ('animated artwork; game integration unverified' if all(a.get('metadata') for a in manifest['assets'])
                          else 'mixed animated and static artwork; game integration unverified')
    save_json(manifest_path, manifest)
    print(f'{age}: Idle + Travel, {painted.COUNT*2} frames, {len(definitions)} motion regions', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--age', choices=['StoneAge','BronzeAge','ClassicalAge'])
    args = parser.parse_args()
    cv2.setNumThreads(1)
    for age in ([args.age] if args.age else ['StoneAge','BronzeAge']):
        build(age)


if __name__ == '__main__':
    main()
