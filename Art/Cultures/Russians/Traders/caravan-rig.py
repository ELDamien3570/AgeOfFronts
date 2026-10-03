"""Articulate approved painted caravans in a perpendicular overhead camera.

Members share a contact speed, but have independent gait phases. The wagon,
leads, harness and secured goods belong to the retained assembly. Feet are
constant-speed contacts during stance; recovery lifts and bends each leg.
This offline art rig has no authority over simulation movement.
"""
from __future__ import annotations

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
base_spec = importlib.util.spec_from_file_location('caravan_painted_motion', ROOT.parents[2] / 'Trader Icons/animate-traders.py')
painted = importlib.util.module_from_spec(base_spec)
base_spec.loader.exec_module(painted)
human_spec = importlib.util.spec_from_file_location('caravan_human_legs', ROOT / 'walking-rig.py')
human = importlib.util.module_from_spec(human_spec)
human_spec.loader.exec_module(human)
LEGS = ['hind-left', 'fore-left', 'hind-right', 'fore-right']
OFFSETS = {'hind-left': 0, 'fore-left': .25, 'hind-right': .5, 'fore-right': .75}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def atlas_cell(atlas, row, column):
    cell = atlas.crop((column*atlas.width//3, row*atlas.height//4,
                       (column+1)*atlas.width//3, (row+1)*atlas.height//4))
    count, labels, stats, _ = cv2.connectedComponentsWithStats((np.asarray(cell.getchannel('A'))>16).astype(np.uint8), 8)
    if count < 2:
        raise ValueError(f'Empty horse atlas cell: {row}, {column}')
    index = 1+int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, width, height, _ = map(int, stats[index])
    piece = cell.crop((x, y, x+width, y+height))
    # Paint flecks outside the selected component are not articulated parts.
    selected = labels[y:y+height, x:x+width] == index
    alpha = np.asarray(piece.getchannel('A')).copy()
    alpha[~selected] = 0
    piece.putalpha(Image.fromarray(alpha))
    return piece


def prepare(spec, root=ROOT):
    rig = painted.make_rig(spec['age'], spec, root / spec['age'] / spec['source'])
    for part in rig['regions']:
        bx0, by0, bx1, by1 = part['box']
        for rect in spec.get('protectedRegions', []):
            x0, y0, x1, y1 = rect['rect']
            ix0, iy0, ix1, iy1 = max(x0,bx0),max(y0,by0),min(x1,bx1),min(y1,by1)
            if ix0 < ix1 and iy0 < iy1:
                part['mask'][iy0-by0:iy1-by0, ix0-bx0:ix1-bx0] = 0
    config = spec['caravanRig']
    removal = Image.new('L', rig['source'].size, 0)
    draw = ImageDraw.Draw(removal)
    members, pieces = [], {}
    for member in config['merchants']:
        member_rig = human.prepare({'source':rig['source']}, {'walkingRig':member['rig']}, root)
        draw.polygon(member['rig']['oldLegsPolygon'], fill=255)
        members.append({**member, 'walking':member_rig['walking']})
        pieces.update({member['name']+'-'+name:piece for name,piece in member_rig['walking']['pieces'].items()})
    atlas_path = root / spec['age'] / config['horseAtlas']
    if painted.sha(atlas_path) != config['horseAtlasSha256']:
        raise ValueError('Horse atlas changed')
    atlas = Image.open(atlas_path).convert('RGBA')
    horse_pieces = {}
    for horse in config['horses']:
        for kind, row in horse['atlasRows'].items():
            for part, column in [('upper',0),('lower',1),('hoof',2)]:
                name = horse['name']+'-'+kind+'-'+part
                horse_pieces[name] = atlas_cell(atlas, row, column)
        for polygon in horse['oldLegsPolygons']:
            draw.polygon(polygon, fill=255)
    pieces.update(horse_pieces)
    rig['caravan'] = {'config':config, 'merchants':members,
                      'pieces':pieces, 'horsePieces':horse_pieces, 'removal':removal}
    return rig


def horse_target(config, leg, phase, travel):
    cycle = (phase+OFFSETS[leg]+config['phaseOffset'])%1
    kind = 'fore' if leg.startswith('fore') else 'hind'
    bias = config['contactBias'][kind]
    if not travel:
        return cycle, config['idleReach']+bias, 0, True, 0
    stance = config['stanceFraction']
    if cycle < stance:
        forward = bias+config['forwardReach']-(config['forwardReach']+config['rearReach'])*cycle/stance
        return cycle, forward, 0, True, 0
    u = (cycle-stance)/(1-stance)
    ease = u*u*(3-2*u)
    outward = config['swingOutward'][kind]*math.sin(math.pi*u)
    return cycle, bias-config['rearReach']+(config['forwardReach']+config['rearReach'])*ease, \
        config['footLift']*math.sin(math.pi*u), False, outward


def horse_pose(config, leg, phase, travel=True):
    """Solve 3D leg links, including the fore pastern, before overhead projection."""
    cycle, forward, lift, stance, outward = horse_target(config, leg, phase, travel)
    sign = -1 if leg.endswith('left') else 1
    hx, hy = config['hips'][leg]
    kind = 'fore' if leg.startswith('fore') else 'hind'
    upper = config['foreUpperLength'] if kind=='fore' else config['upperLength']
    lower = config['foreLowerLength'] if kind=='fore' else config['lowerLength']
    heights = []
    for other in LEGS:
        _, y, z, _, spread = horse_target(config, other, phase, travel)
        other_kind = 'fore' if other.startswith('fore') else 'hind'
        x = config['footOutward'][other_kind]+spread
        if other_kind=='fore':
            y -= config['pasternForward']
            z += math.sqrt(config['pasternLength']**2-config['pasternForward']**2)
            reach = config['foreUpperLength']+config['foreLowerLength']-config['kneeSlack']
        else:
            reach = config['upperLength']+config['lowerLength']-config['kneeSlack']
        heights.append(z+math.sqrt(max(1, reach*reach-x*x-y*y)))
    height = min(heights)
    if height < config['minimumHipHeight']:
        raise ValueError('Horse rig stance is too long for the configured leg lengths')
    ankle = np.array([hx+sign*(config['footOutward'][kind]+outward), hy+forward, lift], dtype=float)
    hip = np.array([hx, hy, height], dtype=float)
    end = ankle.copy()
    if kind=='fore':
        end[1] -= config['pasternForward']
        end[2] += math.sqrt(config['pasternLength']**2-config['pasternForward']**2)
    direction = end-hip
    distance = float(np.linalg.norm(direction))
    if distance >= upper+lower:
        raise ValueError('Unreachable hoof target')
    axis = direction/distance
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    bend = math.sqrt(max(0, upper*upper-along*along))
    # The proximal hind joint is the forward-folding stifle. A backward bend
    # here would project a thick upper leg behind the rump like an extra ear.
    preferred = np.array([0,1,0], dtype=float)
    perpendicular = preferred-float(np.dot(preferred,axis))*axis
    perpendicular /= np.linalg.norm(perpendicular)
    knee = hip+along*axis+bend*perpendicular
    pose = {'leg':leg, 'cycle':cycle, 'stance':stance, 'lift':lift,
            'hip':hip.tolist(), 'knee':knee.tolist(), 'ankle':ankle.tolist(),
            'footCenter':[float(ankle[0]),float(ankle[1]+config['hoofLength']*.25)],
            'footPitch':24*lift/max(1,config['footLift']),
            'footYaw':sign*(2+3*lift/max(1,config['footLift']))}
    if kind=='fore':
        pose['fetlock'] = end.tolist()
    return pose


def render_horse(rig, horse, motion, index):
    legs = Image.new('RGBA', rig['source'].size, (0,0,0,0))
    config = horse['rig']
    poses = [horse_pose(config, leg, index/painted.COUNT, motion=='Travel') for leg in LEGS]
    for pose in sorted(poses,key=lambda p:p['ankle'][1]):
        kind = 'fore' if pose['leg'].startswith('fore') else 'hind'
        prefix = horse['name']+'-'+kind+'-'
        pieces = rig['caravan']['horsePieces']
        hoof_width = config['foreHoofWidth'] if kind=='fore' else config['hoofWidth']
        hoof = pieces[prefix+'hoof'].resize((hoof_width,
            max(12,round(config['hoofLength']*math.cos(math.radians(pose['footPitch']))))),Image.Resampling.LANCZOS)
        hoof = hoof.rotate(pose['footYaw'],Image.Resampling.BICUBIC,expand=True)
        x,y = pose['footCenter']
        legs.alpha_composite(hoof,(round(x-hoof.width/2),round(y-hoof.height/2)))
        if kind=='fore':
            human.bone(legs,pieces[prefix+'lower'],pose['fetlock'],pose['ankle'],config['foreLowerWidth'],overlap=9)
            human.bone(legs,pieces[prefix+'lower'],pose['knee'],pose['fetlock'],config['foreLowerWidth'],overlap=9)
            human.bone(legs,pieces[prefix+'upper'],pose['hip'],pose['knee'],config['foreUpperWidth'],overlap=10)
        else:
            human.bone(legs,pieces[prefix+'lower'],pose['knee'],pose['ankle'],config['lowerWidth'],overlap=12)
            human.bone(legs,pieces[prefix+'upper'],pose['hip'],pose['knee'],config['upperWidth'],overlap=12)
    return legs


def animate_source(rig, motion, index):
    body = painted.animate_source(rig, motion, index)
    alpha = np.asarray(body.getchannel('A')).copy()
    alpha[np.asarray(rig['caravan']['removal'])>0] = 0
    body.putalpha(Image.fromarray(alpha))
    assembly = Image.new('RGBA', body.size, (0,0,0,0))
    empty = Image.new('RGBA', body.size, (0,0,0,0))
    for merchant in rig['caravan']['merchants']:
        assembly.alpha_composite(human.render({'walking':merchant['walking']},empty,motion,index))
    for horse in rig['caravan']['config']['horses']:
        assembly.alpha_composite(render_horse(rig,horse,motion,index))
    assembly.alpha_composite(body)
    return assembly


def frame_vessel(rig, motion, index):
    source = animate_source(rig,motion,index)
    placement = rig['placement']; crop = placement['crop']; scale = placement['scale']
    image = source.crop(crop).resize((round((crop[2]-crop[0])*scale),round((crop[3]-crop[1])*scale)),Image.Resampling.LANCZOS)
    native = Image.new('RGBA',(painted.NATIVE,painted.NATIVE),(0,0,0,0))
    native.alpha_composite(image,tuple(placement['offset']))
    frame = Image.new('RGBA',(512,512),(0,0,0,0))
    frame.alpha_composite(native.resize((420,420),Image.Resampling.LANCZOS),(46,46))
    return frame


def tracks(spec):
    config = spec['caravanRig']
    result = {}
    for member in config['merchants']:
        result[member['name']] = {side:[human.leg_pose(member['rig'],side,i/10,True) for i in range(10)]
                                  for side in ['left','right']}
    for member in config['horses']:
        result[member['name']] = {leg:[horse_pose(member['rig'],leg,i/10,True) for i in range(10)] for leg in LEGS}
    return result


def export(age='ClassicalAge', root=ROOT):
    folder = root / age
    spec = json.loads((folder/'rig-authoring.json').read_text(encoding='utf-8'))
    if spec['animationApproval']['status'] != 'approved':
        raise ValueError('Caravan animation approval required')
    original = folder/spec['source']
    if painted.sha(original) != spec['sourceSha256']:
        raise ValueError('Approved caravan master changed')
    rig = prepare(spec,root)
    layers = folder/'layers'; layers.mkdir(exist_ok=True)
    rig['native'].save(folder/'Source_Transparent.png',optimize=True)
    rig['source'].save(layers/'Original_Painting.png',optimize=True)
    body = rig['source'].copy()
    alpha = np.asarray(body.getchannel('A')).copy()
    alpha[np.asarray(rig['caravan']['removal'])>0] = 0
    body.putalpha(Image.fromarray(alpha))
    body.save(layers/'Body_Occlusion.png',optimize=True)
    rig['caravan']['removal'].save(layers/'Old_Legs_Removal_Mask.png')
    for name,piece in rig['caravan']['pieces'].items():
        piece.save(layers/(name+'.png'),optimize=True)
    write_json(folder/'rig.json',{'schemaVersion':1,'cultureId':'russian','age':age,
        'source':spec['source'],'sourceSha256':painted.sha(original),
        'generatedSize':list(rig['source'].size),'nativeSize':[1254,1254],'placement':rig['placement'],
        'caravanRig':spec['caravanRig'],'bodyOcclusion':'layers/Body_Occlusion.png',
        'articulatedLayers':['layers/'+name+'.png' for name in rig['caravan']['pieces']],
        'authoring':'Two human two-leg rigs and two equine four-leg rigs. True planted stance, lifted recovery, distinct member phases and one shared contact speed. Wagon, lead ropes, shafts, harness and panniers remain in the retained body paint.'})
    animations = {}
    for motion in ['Idle','Travel']:
        frames = [frame_vessel(rig,motion,i) for i in range(10)]
        painted.write_sheet(frames,folder/(motion+'.png'))
        fps = 8 if motion=='Idle' else 12
        animations[motion.lower()] = {'file':motion+'.png','frameCount':10,'suggestedFramesPerSecond':fps,
            'loop':True,'frames':[{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)],
            'distinctPoseCount':len({hashlib.sha256(image.tobytes()).hexdigest() for image in frames})}
        frames[0].save(folder/(motion+'.webp'),save_all=True,append_images=frames[1:],
            duration=125 if motion=='Idle' else [83,84,83,83,84,83,83,84,83,83],loop=0,lossless=True)
    config = spec['caravanRig']; shared = config['sharedStride']
    speed = (shared['forwardReach']+shared['rearReach'])/shared['stanceFraction']*12/10*rig['placement']['scale']*420/1254
    write_json(folder/'animations.json',{'schemaVersion':1,'cultureId':'russian','unit':spec['label'],
        'age':age,'category':'OverlandTrader','memberCounts':spec['counts'],
        'camera':'vertical-overhead-orthographic','facing':'screen-down',
        'frameSize':{'width':512,'height':512},'sheetSize':{'width':2560,'height':1024},
        'grid':{'columns':5,'rows':2},'pivot':{'x':256,'y':256},'normalizedPivot':{'x':.5,'y':.5},
        'frameOrder':'left-to-right-then-next-row','animations':animations,
        'source':spec['source'],'sourceSha256':painted.sha(original),'animationApproval':spec['animationApproval'],
        'animationRevision':spec['animationRevision'],'gait':'multi-member articulated stance and swing',
        'animationRevisionRequest':spec['animationRevisionRequest'],
        'walkingGroundSpeed':speed,'memberFootTracks':tracks(spec),
        'timingNote':'Simulation owns translation, routes and trade. Contact speed here is for the browser moving-ground review only.',
        'integrationStatus':'artwork-only; not connected to game renderer'})
    manifest_path = root/'Trader_Animation_Manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for asset in manifest['assets']:
        if asset['age']==age:
            asset.update({'metadata':age+'/animations.json','status':'animations-exported',
                'clips':[age+'/Idle.png',age+'/Travel.png'],'animationApproval':spec['animationApproval']})
    manifest['clipCount'] = sum(len(a.get('clips',[])) for a in manifest['assets'])
    manifest['status'] = 'animated artwork; game integration unverified'
    write_json(manifest_path,manifest)
    generation = json.loads((folder/'Generation-Manifest.json').read_text(encoding='utf-8'))
    generation['animationApproval'] = spec['animationApproval']
    generation['status'] = 'approved master; Idle and articulated Travel exported'
    generation['animationAuthoring'] = 'rig-authoring.json; ../caravan-rig.py'
    write_json(folder/'Generation-Manifest.json',generation)
    print(f'{age}: Idle + Travel; 20 frames; four articulated members; approved master intact',flush=True)
    return rig
