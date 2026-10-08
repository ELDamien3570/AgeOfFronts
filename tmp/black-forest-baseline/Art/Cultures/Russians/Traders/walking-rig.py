"""Painted, articulated legs with a stance/swing cycle in overhead projection.

The sagittal IK is solved in height/forward coordinates, then projected onto
the ground plane. Bone textures rotate/foreshorten; they are not toe warps.
"""
from __future__ import annotations
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def prepare(rig, spec, root):
    config = spec['walkingRig']
    atlas = Image.open(Path(root) / config['atlas']).convert('RGBA')
    pieces = {}
    for side, row in [('left',0),('right',1)]:
        for kind, column in [('thigh',0),('shin',1),('foot',2)]:
            cell = atlas.crop((column*atlas.width//3,row*atlas.height//2,
                               (column+1)*atlas.width//3,(row+1)*atlas.height//2))
            alpha = np.asarray(cell.getchannel('A'))
            count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha>16).astype(np.uint8),8)
            if count < 2:
                raise ValueError(f'Empty walking atlas cell: {side} {kind}')
            largest = 1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
            x,y,w,h,_ = map(int,stats[largest])
            # The generated shin includes an end cap; use the wrapped calf
            # above it. The independent boot covers the ankle overlap.
            if kind=='shin':
                h = round(h*config.get('shinCrop',.80))
            piece = cell.crop((x,y,x+w,y+h))
            pieces[side+'-'+kind] = piece
    # Cut the old posed legs from the animation body layer. The approved
    # master stays byte-identical; the retained tunic occludes the hip joints.
    removal = Image.new('L',rig['source'].size,0)
    ImageDraw.Draw(removal).polygon(config['oldLegsPolygon'],fill=255)
    rig['walking'] = {'config':config,'pieces':pieces,'removal':removal}
    return rig


def foot_target(config, side, phase, travel):
    offset = 0 if side=='left' else .5
    cycle = (phase+offset+config.get('phaseOffset',.5))%1
    stance = config.get('stanceFraction',.6)
    front, rear = config['forwardReach'],config['rearReach']
    if not travel:
        forward, lift, swing = config['idleReach'],0,False
        outward = 0
    elif cycle < stance:
        # Contact foot moves backwards relative to the advancing body at a
        # constant rate. With world translation added it stays planted.
        forward = front-(front+rear)*cycle/stance
        lift, swing, outward = 0,False,0
    else:
        u = (cycle-stance)/(1-stance)
        eased = u*u*(3-2*u)
        forward = -rear+(front+rear)*eased
        lift = config['footLift']*math.sin(math.pi*u)
        outward = config.get('swingOutward',8)*math.sin(math.pi*u)
        swing = True
    return cycle,forward,lift,swing,outward


def leg_pose(config, side, phase, travel=True):
    origin = config['hips'][side]
    sway = round(config.get('assemblySway',0)*math.sin(math.tau*phase)) if travel else 0
    hip = [origin[0]+sway,origin[1]]
    cycle,forward,lift,swing,outward = foot_target(config,side,phase,travel)
    sign = -1 if side=='left' else 1
    ankle_x = origin[0]+sign*(config.get('footOutward',6)+outward)
    ankle_y = hip[1]+forward
    upper,lower = config['thighLength'],config['shinLength']
    # Rise over the support leg at midstance. A permanently low hip would
    # leave both knees deeply bent and hide the shoes behind the thighs.
    reach = upper+lower-config.get('kneeSlack',9)
    limits = []
    for other in ['left','right']:
        _,distance_forward,z,_,_ = foot_target(config,other,phase,travel)
        limits.append(z+math.sqrt(max(1,reach*reach-distance_forward*distance_forward)))
    height = max(config['hipHeight'],min(limits))
    dy,dz = forward,lift-height
    distance = math.hypot(dy,dz)
    if distance >= upper+lower:
        raise ValueError('Unreachable ankle target; gait rig requires valid leg lengths')
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    bend = math.sqrt(max(0,upper*upper-along*along))
    knee_y = hip[1]+along*dy/distance+bend*(-dz)/distance
    knee_z = height+along*dz/distance+bend*dy/distance
    knee_x = hip[0]+sign*(config.get('kneeOutward',4)+outward*.5)
    return {
        'side':side,'cycle':cycle,'stance':not swing,'lift':lift,
        'hip':[float(hip[0]),float(hip[1]),float(height)],
        'knee':[knee_x,knee_y,knee_z],'ankle':[ankle_x,ankle_y,lift],
        'footCenter':[ankle_x,ankle_y+config['footLength']*.35],
        'footPitch':24*lift/max(1,config['footLift']),
        'footYaw':sign*(3+(5 if swing else 0)*lift/max(1,config['footLift'])),
    }


def bone(canvas, piece, start, end, width, overlap=10):
    dx,dy = end[0]-start[0],end[1]-start[1]
    distance = math.hypot(dx,dy)
    height = max(12,round(distance+overlap*2))
    texture = piece.resize((round(width),height),Image.Resampling.LANCZOS)
    texture = texture.rotate(math.degrees(math.atan2(dx,dy)),Image.Resampling.BICUBIC,expand=True)
    center = ((start[0]+end[0])*.5,(start[1]+end[1])*.5)
    canvas.alpha_composite(texture,(round(center[0]-texture.width*.5),round(center[1]-texture.height*.5)))


def render(rig, body, motion, index, count=10):
    data = rig['walking']; config=data['config']; phase=index/count
    body = body.copy()
    alpha = np.asarray(body.getchannel('A'),dtype=np.uint8).copy()
    alpha[np.asarray(data['removal'])>0] = 0
    body.putalpha(Image.fromarray(alpha))
    # Shift the upper assembly around the planted feet, rather than sliding
    # the whole sprite sideways. Hip anchors follow the same weight transfer.
    if motion=='Travel' and config.get('assemblySway',0):
        x=round(config['assemblySway']*math.sin(math.tau*phase))
        shifted=Image.new('RGBA',body.size,(0,0,0,0)); shifted.alpha_composite(body,(x,0)); body=shifted
    legs = Image.new('RGBA',body.size,(0,0,0,0))
    poses = [leg_pose(config,side,phase,motion=='Travel') for side in ['left','right']]
    for pose in sorted(poses,key=lambda p:p['ankle'][1]):
        side=pose['side']; hip=pose['hip']; knee=pose['knee']; ankle=pose['ankle']
        length = config['footLength']*math.cos(math.radians(pose['footPitch']))
        boot = data['pieces'][side+'-foot'].resize((config['footWidth'],round(length)),Image.Resampling.LANCZOS)
        boot = boot.rotate(pose['footYaw'],Image.Resampling.BICUBIC,expand=True)
        x,y=pose['footCenter']
        legs.alpha_composite(boot,(round(x-boot.width*.5),round(y-boot.height*.5)))
        # The calf enters the boot collar: draw it over the shoe opening.
        # Joint overlap hides the construction caps in the source atlas.
        bone(legs,data['pieces'][side+'-shin'],knee,ankle,config['shinWidth'],overlap=16)
        bone(legs,data['pieces'][side+'-thigh'],hip,knee,config['thighWidth'],overlap=12)
    legs.alpha_composite(body)
    return legs
