"""Animate the original ship paintings without regenerating hulls or equipment.

Requires Pillow, numpy and OpenCV. All masks, pivots and motion settings are
saved as editable rig JSON alongside transparent source layers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
AGES = ["StoneAge", "BronzeAge", "ClassicalAge", "EarlyMedieval", "LateMedieval", "EarlyModern", "Modern"]
LABELS = ["Stone Age", "Bronze Age", "Classical Age", "Early Medieval", "Late Medieval", "Early Modern", "Modern"]
CATEGORIES = {
    "Warships": {"unit": "Warship", "motions": ["Idle", "Sailing", "Attack"]},
    "Transport": {"unit": "Transport", "motions": ["Idle", "Sailing"]},
    "Trade": {"unit": "Trade", "motions": ["Idle", "Sailing"]},
}
SIZE = 1254
FRAME = 512
SCALE = 420 / SIZE
OFFSET = (FRAME - 420) / 2
TAU = 2 * math.pi
EMPTY = (0, 0, 0, 0)

# Polygons protect the dark interior of each hull during black-matte extraction.
# They sit INSIDE the painted hull, never across outside rigging gaps.
HULLS = {
    "Warships": {
        "StoneAge": [(626,110),(665,235),(700,380),(718,555),(710,805),(680,947),(627,1080),(575,947),(543,805),(536,555),(550,380),(590,235)],
        "BronzeAge": [(625,123),(680,212),(711,305),(723,440),(727,766),(701,890),(626,1035),(551,890),(527,766),(527,440),(543,305),(572,212)],
        "ClassicalAge": [(626,111),(680,205),(708,310),(725,580),(712,855),(697,954),(655,1030),(626,1087),(594,1030),(556,954),(540,855),(527,580),(545,310),(573,205)],
        "EarlyMedieval": [(626,146),(666,220),(697,347),(716,690),(700,883),(675,986),(626,1060),(578,986),(552,883),(536,690),(555,347),(586,220)],
        "LateMedieval": [(515,180),(730,180),(736,305),(749,444),(762,650),(751,831),(735,980),(658,1038),(594,1038),(509,980),(496,831),(482,650),(499,444),(509,305)],
        "EarlyModern": [(526,545),(724,545),(752,650),(755,850),(729,990),(726,1090),(670,1110),(626,1150),(580,1110),(526,1090),(521,990),(495,850),(499,650)],
        "Modern": [(626,44),(659,130),(688,264),(704,423),(714,674),(704,937),(679,1180),(572,1180),(548,937),(536,674),(547,423),(563,264),(591,130)],
    },
    "Transport": {
        "StoneAge": [(626,120),(690,225),(735,373),(753,860),(729,1016),(626,1124),(524,1016),(500,860),(517,373),(560,225)],
        "BronzeAge": [(626,167),(703,247),(754,405),(791,701),(755,975),(691,1039),(626,1060),(561,1039),(498,975),(461,701),(499,405),(549,247)],
        "ClassicalAge": [(627,142),(700,253),(753,413),(791,667),(773,866),(727,1023),(650,1080),(626,1108),(603,1080),(526,1023),(480,866),(462,667),(501,413),(553,253)],
        "EarlyMedieval": [(626,117),(700,225),(755,359),(783,553),(776,827),(735,1000),(626,1117),(517,1000),(476,827),(470,553),(497,359),(551,225)],
        "LateMedieval": [(626,172),(700,223),(753,376),(787,676),(767,887),(721,1015),(531,1015),(485,887),(466,676),(498,376),(551,223)],
        "EarlyModern": [(626,307),(710,383),(751,603),(759,803),(726,1003),(718,1100),(534,1100),(526,1003),(493,803),(501,603),(542,383)],
        "Modern": [(626,81),(699,180),(728,351),(744,574),(733,1010),(697,1146),(553,1146),(517,1010),(504,574),(521,351),(551,180)],
    },
}

# Sail halves stay pinned to the mast, yard and outer seams. A displaced cloth
# layer only expands downward; the original beneath never becomes exposed.
SAILS = {
    "Warships": {
        "StoneAge": [],
        "BronzeAge": [([(459,559),(611,559),(611,609),(495,597)], 8), ([(641,559),(794,559),(756,597),(641,609)], 8)],
        "ClassicalAge": [([(445,517),(614,517),(614,578),(483,563)], 9), ([(640,517),(807,517),(772,563),(640,578)], 9)],
        "EarlyMedieval": [([(432,475),(610,477),(610,678),(491,647)], 14), ([(642,477),(819,475),(761,647),(642,678)], 14)],
        "LateMedieval": [([(406,402),(607,403),(607,564),(435,564)], 12), ([(639,403),(837,402),(808,564),(639,564)], 12)],
        "EarlyModern": [
            ([(613,110),(565,164),(613,161)], 5), ([(639,110),(689,164),(639,161)], 5),
            ([(525,193),(612,192),(612,293),(512,293)], 10), ([(640,192),(724,193),(740,293),(640,293)], 10),
            ([(484,338),(611,338),(611,441),(469,440)], 12), ([(641,338),(765,338),(782,440),(641,441)], 12),
            ([(455,479),(612,480),(612,550),(530,550)], 10), ([(642,480),(796,479),(721,550),(642,550)], 10),
        ],
        "Modern": [],
    },
    "Transport": {
        "StoneAge": [([(522,232),(612,205),(612,345),(540,356)], 3), ([(640,205),(731,232),(713,356),(640,345)], 3)],
        "BronzeAge": [([(395,411),(610,410),(610,517),(420,521)], 12), ([(644,410),(858,411),(835,521),(644,517)], 12)],
        "ClassicalAge": [([(376,533),(610,532),(610,604),(417,593)], 10), ([(644,532),(881,533),(839,593),(644,604)], 10)],
        "EarlyMedieval": [([(376,478),(610,478),(610,629),(437,629)], 12), ([(644,478),(879,478),(817,629),(644,629)], 12)],
        "LateMedieval": [
            ([(415,440),(610,441),(610,596),(446,593)], 12), ([(644,441),(837,440),(806,593),(644,596)], 12),
            ([(496,756),(611,756),(611,876),(555,862)], 10), ([(644,756),(760,756),(703,862),(644,876)], 10),
        ],
        "EarlyModern": [
            ([(584,218),(613,219),(613,245),(563,245)], 4), ([(641,219),(670,218),(690,245),(641,245)], 4),
            ([(530,262),(612,262),(612,361),(511,376)], 11), ([(643,262),(725,262),(746,376),(643,361)], 11),
            ([(489,414),(612,414),(612,529),(472,535)], 12), ([(643,414),(763,414),(780,535),(643,529)], 12),
            ([(478,578),(612,578),(612,643),(544,643)], 10), ([(643,578),(774,578),(709,643),(643,643)], 10),
        ],
        "Modern": [],
    },
}

FLAGS = {
    ("Warships", "LateMedieval"): [
        {"polygon": [(629,32),(699,43),(737,66),(737,95),(759,120),(807,151),(752,143),(719,126),(706,107),(629,84)], "pin": [629,60]},
        {"polygon": [(607,1018),(638,1039),(650,1077),(650,1127),(664,1191),(666,1229),(650,1202),(630,1166),(617,1137),(607,1101)], "pin": [608,1025]},
    ],
    ("Transport", "LateMedieval"): [
        {"polygon": [(635,38),(706,61),(761,86),(784,117),(817,171),(761,145),(704,120),(635,103)], "pin": [635,63]},
        {"polygon": [(637,1039),(684,1068),(690,1112),(721,1191),(705,1242),(679,1210),(637,1180)], "pin": [637,1047]},
    ],
}
OARS = {"BronzeAge": (5, 500, 751, 22, 10), "ClassicalAge": (26, 511, 742, 15, 8), "EarlyMedieval": (9, 512, 740, 20, 12)}
GUN_Y = {"LateMedieval": [623,711,786], "EarlyModern": [580,636,690,746,803,861]}


def polygon_mask(points, size=SIZE):
    image = Image.new("L", (size,size), 0)
    ImageDraw.Draw(image).polygon(points, fill=255)
    return image


def extract_alpha(image, hull):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    brightness = rgb.max(axis=2)
    alpha = np.clip((brightness - 12) / 36, 0, 1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((brightness > 12).astype(np.uint8),8)
    retained = np.zeros(count, dtype=bool)
    retained[1:] = stats[1:,cv2.CC_STAT_AREA] >= 12
    alpha[~retained[labels]] = 0
    protected = np.asarray(polygon_mask(hull)) > 0
    alpha[protected] = 1
    recovered = np.divide(rgb, alpha[...,None], out=np.zeros_like(rgb), where=alpha[...,None]>0)
    rgba = np.concatenate([np.clip(recovered,0,255), (alpha*255)[...,None]], axis=2).astype(np.uint8)
    return Image.fromarray(rgba)


def mask_layer(source, mask):
    result = source.copy()
    result.putalpha(Image.fromarray((np.asarray(source.getchannel("A"), dtype=np.float32)*np.asarray(mask)/255).astype(np.uint8)))
    return result


def clear_mask(source, mask):
    result = source.copy()
    result.putalpha(Image.fromarray((np.asarray(source.getchannel("A"), dtype=np.float32)*(1-np.asarray(mask)/255)).astype(np.uint8)))
    return result


def discover_oars(source, age):
    expected, left_lock, right_lock, blade_band, amplitude = OARS[age]
    rgb = np.asarray(source)[...,:3]
    combined = Image.new("L", source.size, 0)
    layers = []
    yy, xx = np.mgrid[0:SIZE,0:SIZE]
    protected = np.zeros((SIZE,SIZE),np.uint8)
    for points, _ in SAILS['Warships'][age]:
        protected = np.maximum(protected,np.asarray(polygon_mask(points)))
    # Include complete cloth silhouettes, yard, mast and stays as occluders.
    keep = Image.fromarray(protected); kd=ImageDraw.Draw(keep)
    if age=='EarlyMedieval':
        kd.polygon([(421,473),(612,470),(612,686),(486,652)],fill=255)
        kd.polygon([(640,470),(828,473),(770,652),(640,686)],fill=255)
        kd.line([(407,465),(846,465)],fill=255,width=20)
        kd.line([(625,290),(451,467)],fill=255,width=7)
        kd.line([(625,290),(803,467)],fill=255,width=7)
    elif age=='BronzeAge':
        kd.polygon([(457,556),(797,556),(781,594),(702,612),(550,612),(473,593)],fill=255)
        kd.line([(429,550),(821,550)],fill=255,width=22)
    else:
        kd.polygon([(442,515),(810,515),(790,556),(752,579),(490,579),(465,559)],fill=255)
        kd.line([(429,510),(825,510)],fill=255,width=21)
        kd.line([(625,354),(450,511)],fill=255,width=6)
        kd.line([(625,354),(803,511)],fill=255,width=6)
    protected=np.asarray(keep)>0
    for side, boundary in [("port",left_lock),("starboard",right_lock)]:
        foreground = (rgb.max(2)>30).astype(np.uint8)
        if side == "port":
            foreground[:,418:] = 0
        else:
            foreground[:,:835] = 0
        count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground,8)
        components = [(index,stat) for index,stat in enumerate(stats[1:],1) if stat[4]>120 and stat[2]>30]
        components.sort(key=lambda item: item[1][1])
        if len(components) != expected:
            raise ValueError(f"{age} {side}: expected {expected} oars, found {len(components)}")
        descriptions=[]
        for number, (index, stat) in enumerate(components):
            cy,cx = np.where(labels==index)
            # The inner edge of each isolated paddle includes a short piece of
            # its shaft. Fit that segment, retaining the original paddle pixels.
            edge = cx >= 400 if side == "port" else cx <= 852
            slope, intercept = np.polyfit(cx[edge],cy[edge],1)
            descriptions.append((slope,intercept,float(np.mean(cx)),float(np.mean(cy))))
        # Assign all outside-bank pixels to their nearest shaft, rather than
        # using thin bands that can leave a second, stationary oar behind.
        distance=np.full((SIZE,SIZE),np.inf,dtype=np.float32)
        owner=np.zeros((SIZE,SIZE),np.uint8)
        for number,(slope,intercept,_,_) in enumerate(descriptions):
            current=np.abs(yy-slope*xx-intercept)/math.sqrt(1+slope*slope)
            better=current<distance
            owner[better]=number
            distance[better]=current[better]
        outside=(xx<boundary) if side=='port' else (xx>boundary)
        zone=outside & ~protected & (distance<25)
        for number,(slope,intercept,tipx,tipy) in enumerate(descriptions):
            selected=zone & (owner==number)
            mask=Image.fromarray(selected.astype(np.uint8)*255)
            combined = Image.fromarray(np.maximum(np.asarray(combined),np.asarray(mask)))
            layer = mask_layer(source,mask)
            pivot = (boundary,float(slope*boundary+intercept))
            layers.append({"name":f"oar-{side}-{number+1:02d}","image":layer,"pivot":pivot,"side":side,
                           "amplitude":amplitude,"tip":(tipx,tipy),"mask":mask})
    return layers, combined


def make_rig(category,age):
    original = ROOT/category/f"{CATEGORIES[category]['unit']}_{age}.png"
    trade = None
    if category == "Trade":
        trade = json.loads((ROOT/"trade-rigs.json").read_text(encoding="utf-8"))[age]
        hull, sails, flags = trade["hull"], trade["sails"], trade.get("flags", [])
        source = Image.open(original).convert("RGBA")
        if source.size != (SIZE,SIZE) or source.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"Trade master must be a transparent {SIZE}px square: {original}")
    else:
        hull, sails, flags = HULLS[category][age], SAILS[category][age], FLAGS.get((category,age),[])
        source = extract_alpha(Image.open(original),hull)
    base = source.copy()
    layers=[]
    if category=="Warships" and age in OARS:
        oars,mask=discover_oars(source,age)
        base=clear_mask(base,mask)
        layers.extend(oars)
    for index,(points,amplitude) in enumerate(sails):
        mask=polygon_mask(points)
        layers.append({"name":f"cloth-{index+1:02d}","image":mask_layer(source,mask),"mask":mask,
                       "polygon":points,"amplitude":amplitude,"kind":"cloth"})
    for index,flag in enumerate(flags):
        mask=Image.open(ROOT/flag["maskFile"]).convert("L") if "maskFile" in flag else polygon_mask(flag["polygon"])
        layers.append({"name":f"flag-{index+1:02d}","image":mask_layer(source,mask),"mask":mask,
                       "polygon":flag["polygon"],"pivot":flag["pin"],"kind":"flag","amplitude":10})
        if "maskFile" in flag: layers[-1]["maskFile"] = flag["maskFile"]
        base=clear_mask(base,mask)
    if category=="Warships" and age in GUN_Y:
        for side in ["port","starboard"]:
            for index,y in enumerate(GUN_Y[age]):
                if age=="LateMedieval":
                    points=[(491,y-9),(541,y-12),(554,y-7),(557,y+2),(551,y+10),(491,y+8)]
                else:
                    points=[(495,y-10),(541,y-9),(551,y-6),(550,y+8),(541,y+11),(495,y+10)]
                if side=="starboard":
                    points=[(1253-x,yv) for x,yv in points]
                mask=polygon_mask(points)
                layers.append({"name":f"gun-{side}-{index+1:02d}","image":mask_layer(source,mask),"mask":mask,
                               "kind":"gun","side":side,"muzzle":(points[0][0],y),"amplitude":7})
        # Reconstruct only the tiny deck patches hidden by cannon barrels.
        gun_mask=np.zeros((SIZE,SIZE),np.uint8)
        for layer in layers:
            if layer.get("kind")=="gun":
                gun_mask=np.maximum(gun_mask,np.asarray(layer["mask"]))
        base_rgb=cv2.inpaint(np.asarray(base)[...,:3],gun_mask,5,cv2.INPAINT_TELEA)
        base=Image.fromarray(np.dstack([base_rgb,np.asarray(base.getchannel("A"))]))
    if category=="Warships" and age=="Modern":
        points=[(622,159),(629,159),(631,231),(619,231)]
        mask=polygon_mask(points)
        layers.append({"name":"bow-gun-barrel","image":mask_layer(source,mask),"mask":mask,
                       "kind":"gun","side":"forward","muzzle":(626,160),"amplitude":8})
        rgb=cv2.inpaint(np.asarray(base)[...,:3],np.asarray(mask),4,cv2.INPAINT_TELEA)
        base=Image.fromarray(np.dstack([rgb,np.asarray(base.getchannel("A"))]))
    rig = {"category":category,"age":age,"source":source,"base":base,"layers":layers,"original":original,"hull":hull}
    if trade:
        rig.update({"bow":trade["bow"], "stern":trade["stern"]})
        if "bows" in trade: rig["bows"] = trade["bows"]
    return rig


def transform_layer(layer, angle=0, shift=(0,0)):
    bbox=layer["image"].getbbox()
    if not bbox:
        return Image.new("RGBA",(SIZE,SIZE),EMPTY)
    # Tight crop, with enough padding for rotation and barrel recoil.
    pad=90
    crop=layer["image"].crop(bbox)
    image=Image.new("RGBA",(crop.width+2*pad,crop.height+2*pad),EMPTY)
    image.alpha_composite(crop,(pad,pad))
    pivot=layer.get("pivot",((bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2))
    center=(pivot[0]-bbox[0]+pad,pivot[1]-bbox[1]+pad)
    rotated=image.rotate(angle,Image.Resampling.BICUBIC,center=center)
    output=Image.new("RGBA",(SIZE,SIZE),EMPTY)
    output.alpha_composite(rotated,(round(bbox[0]-pad+shift[0]),round(bbox[1]-pad+shift[1])))
    return output


def deform_cloth(layer,phase,strength):
    bbox=layer["image"].getbbox()
    if not bbox:
        return layer["image"]
    x0,y0,x1,y1=bbox
    pad=20
    crop=layer["image"].crop((x0-pad,y0-pad,x1+pad,y1+pad))
    rgba=np.asarray(crop,dtype=np.float32)
    alpha=rgba[...,3:4]/255
    premult=np.dstack([rgba[...,:3]*alpha,rgba[...,3]])
    h,w=rgba.shape[:2]
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    u=np.clip((xx-pad)/max(1,x1-x0-1),0,1)
    v=np.clip((yy-pad)/max(1,y1-y0-1),0,1)
    # Zero displacement at mast/side seams and at the upper yard.
    billow=(.5+.5*math.sin(phase))*layer["amplitude"]*strength
    dx=np.zeros_like(xx)
    dy=billow*np.sin(math.pi*u)*v
    warped=cv2.remap(premult,xx-dx,yy-dy,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
    # Moving soft light follows the billow; never moves mast or spars.
    light=1+(.024*strength)*np.sin(math.pi*u)*np.sin(math.pi*v)*math.sin(phase+.7)
    warped[...,:3]*=light[...,None]
    wa=np.clip(warped[...,3:4]/255,0,1)
    color=np.divide(warped[...,:3],wa,out=np.zeros_like(warped[...,:3]),where=wa>.0001)
    result=Image.fromarray(np.dstack([np.clip(color,0,255),np.clip(warped[...,3],0,255)]).astype(np.uint8))
    output=Image.new("RGBA",(SIZE,SIZE),EMPTY); output.alpha_composite(result,(x0-pad,y0-pad))
    return output


def deform_flag(layer,phase,strength):
    bbox=layer["image"].getbbox()
    x0,y0,x1,y1=bbox; pad=22
    crop=np.asarray(layer["image"].crop((x0-pad,y0-pad,x1+pad,y1+pad)),dtype=np.float32)
    alpha=crop[...,3:4]/255; pm=np.dstack([crop[...,:3]*alpha,crop[...,3]])
    yy,xx=np.mgrid[0:crop.shape[0],0:crop.shape[1]].astype(np.float32)
    # The attachment stays fixed. Free cloth waves progressively toward its tip.
    horizontal=(x1-x0)>(y1-y0)
    distance=np.clip(((xx-pad)/(x1-x0) if horizontal else (yy-pad)/(y1-y0)),0,1)
    wave=layer["amplitude"]*strength*distance*np.sin(phase-distance*4)
    mx=xx if horizontal else xx-wave
    my=yy-wave if horizontal else yy
    warped=cv2.remap(pm,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
    wa=np.clip(warped[...,3:4]/255,0,1)
    color=np.divide(warped[...,:3],wa,out=np.zeros_like(warped[...,:3]),where=wa>.0001)
    result=Image.fromarray(np.dstack([np.clip(color,0,255),np.clip(warped[...,3],0,255)]).astype(np.uint8))
    output=Image.new("RGBA",(SIZE,SIZE),EMPTY); output.alpha_composite(result,(x0-pad,y0-pad))
    return output


def frame_point(point):
    return tuple(OFFSET+v*SCALE for v in point)


def water_effects(rig,phase,motion,attack_strength):
    # Draw effects at 2x for antialiased export. They never change hull pixels.
    factor=2
    image=Image.new("RGBA",(FRAME*factor,FRAME*factor),EMPTY)
    d=ImageDraw.Draw(image)
    def line(points,color,width=1):
        d.line([(round(x*factor),round(y*factor)) for x,y in points],fill=color,width=max(1,round(width*factor)),joint="curve")
    def ellipse(box,color):
        d.ellipse(tuple(round(v*factor) for v in box),fill=color)
    if motion=="Sailing" or attack_strength>0:
        p=phase/TAU
        intensity=1 if motion=="Sailing" else attack_strength
        # Narrow tapered stern wake with drifting, fading foam strokes.
        stern=frame_point(rig.get("stern",(626,1165 if rig["age"]!="LateMedieval" else 1055)))
        sx,sy=stern
        for side in [-1,1]:
            for i in range(8):
                t=(i/8+p)%1
                alpha=int(115*math.sin(math.pi*t)*intensity)
                y=sy+3+t*48
                x=sx+side*(7+t*17)
                line([(x-side*2,y-3),(x+side*3,y+1),(x+side*5,y+3)],(203,237,246,alpha),1.15)
        # Bow pressure ripples, short enough to read as foam rather than water tiles.
        bows=rig.get("bows",[rig.get("bow",(626,100 if rig["age"]=="LateMedieval" else 90))])
        for bow in bows:
            for side in [-1,1]:
                x,y=frame_point(bow)
                line([(x+side*7,y+8),(x+side*13,y+17),(x+side*16,y+26)],(199,231,243,int(68*intensity)),1)
        # Oar-tip splashes travel with the actual blade rotation.
        for layer in rig["layers"]:
            if "oar-" not in layer["name"]:
                continue
            stroke=math.sin(phase)
            pressure=max(0,math.cos(phase))
            if pressure<.18:
                continue
            sign=1 if layer["side"]=="port" else -1
            angle=math.radians(sign*layer["amplitude"]*stroke)
            px,py=layer["pivot"]; tx,ty=layer["tip"]
            ox=px+math.cos(angle)*(tx-px)+math.sin(angle)*(ty-py)
            oy=py-math.sin(angle)*(tx-px)+math.cos(angle)*(ty-py)
            x,y=frame_point((ox,oy))
            opacity=int(95*pressure*intensity)
            ellipse((x-2,y-1,x+2,y+1),(216,242,246,opacity))
            line([(x-3,y+2),(x,y+3),(x+3,y+2)],(192,224,240,int(opacity*.7)),.7)
    return image.resize((FRAME,FRAME),Image.Resampling.LANCZOS)


def gun_effects(rig,frame,side="port"):
    image=Image.new("RGBA",(1024,1024),EMPTY)
    draw=ImageDraw.Draw(image)
    for layer in rig["layers"]:
        if layer.get("kind")!="gun" or layer["side"] not in (side,"forward"):
            continue
        ordinal=int(layer["name"].split("-")[-1]) if layer["name"].split("-")[-1].isdigit() else 1
        fired=3+(ordinal%2) # Short stagger makes the battery readable.
        age=frame-fired
        if age<0 or age>5:
            continue
        mx,my=frame_point(layer["muzzle"])
        direction=-1 if layer["side"]=="port" else 1
        if layer["side"]=="forward":
            vx,vy=0,-1
        else:
            vx,vy=direction,0
        perpendicular=(-vy,vx)
        if age==0:
            length=17 if rig["age"]=="Modern" else 13
            points=[]
            for along,across in [(0,-2),(4,-5),(5,-2),(length,-1),(9,1),(5,4),(1,2)]:
                points.append(((mx+vx*along+perpendicular[0]*across)*2,(my+vy*along+perpendicular[1]*across)*2))
            draw.polygon(points,fill=(255,161,47,245))
            core=[((mx+vx*along+perpendicular[0]*across)*2,(my+vy*along+perpendicular[1]*across)*2) for along,across in [(0,-1),(length*.7,0),(1,2)]]
            draw.polygon(core,fill=(255,242,184,255))
        # Small soft puffs expand away from the muzzle and fade completely.
        smoke=Image.new("RGBA",image.size,EMPTY); sd=ImageDraw.Draw(smoke)
        for j in range(4):
            travel=6+age*3+j*2
            px=(mx+vx*travel+perpendicular[0]*math.sin(j*2.1+age*.4)*3)*2
            py=(my+vy*travel+perpendicular[1]*math.sin(j*2.1+age*.4)*3)*2
            radius=(2+age*.9+j*.6)*2
            opacity=round(83*(1-age/6)*(1-j*.1))
            sd.ellipse((px-radius,py-radius,px+radius,py+radius),fill=(209,213,216,opacity))
        image.alpha_composite(smoke.filter(ImageFilter.GaussianBlur(1.7)))
    return image.resize((512,512),Image.Resampling.LANCZOS)


def render_frame(rig,motion,index,attack_side="port"):
    phase=TAU*index/10
    strength=.42 if motion=="Idle" else 1
    ram=motion=="Attack" and not any(layer.get("kind")=="gun" for layer in rig["layers"])
    thrust=[0,0,.15,.45,1,.8,.5,.2,0,0][index] if ram else 0
    phase=TAU*index/10 if not ram else [-.2,-.4,-.7,-1.1,.3,1,1.5,1.8,0,0][index]
    # Moving oars sit behind the hull/shields and in front of water.
    image=Image.new("RGBA",(SIZE,SIZE),EMPTY)
    for layer in rig["layers"]:
        if not layer["name"].startswith("oar-"):
            continue
        stroke=0 if motion=="Idle" else math.sin(phase)
        sign=1 if layer["side"]=="port" else -1
        image.alpha_composite(transform_layer(layer,angle=sign*layer["amplitude"]*stroke))
    image.alpha_composite(rig["base"])
    for layer in rig["layers"]:
        kind=layer.get("kind")
        if kind=="cloth":
            image.alpha_composite(deform_cloth(layer,phase,strength))
        elif kind=="flag":
            image.alpha_composite(deform_flag(layer,phase,strength))
        elif kind=="gun":
            shift=(0,0)
            if motion=="Attack" and layer["side"] in (attack_side,"forward"):
                ordinal=int(layer["name"].split("-")[-1]) if layer["name"].split("-")[-1].isdigit() else 1
                fired=3+(ordinal%2)
                recoil=[0,.95,.65,.3,.1,0][max(0,min(5,index-fired+1))] if index>=fired-1 else 0
                amount=round(recoil*layer["amplitude"])
                shift=(amount if layer["side"]=="port" else -amount,0)
                if layer["side"]=="forward": shift=(0,amount)
            image.alpha_composite(transform_layer(layer,shift=shift))
    vessel=Image.new("RGBA",(512,512),EMPTY)
    vessel.alpha_composite(image.resize((420,420),Image.Resampling.LANCZOS),(46,46))
    # Buoyancy is deliberately subpixel. Simulation movement owns actual travel.
    dy=(1.35 if motion=="Idle" else .45)*math.sin(TAU*index/10)-thrust*3
    dx=.3*math.sin(TAU*index/10+.5) if motion!="Attack" else 0
    vessel=vessel.transform((512,512),Image.Transform.AFFINE,(1,0,-dx,0,1,-dy),Image.Resampling.BICUBIC)
    water=water_effects(rig,phase if ram else TAU*index/10,motion,thrust)
    weapons=gun_effects(rig,index,attack_side) if motion=="Attack" else Image.new("RGBA",(512,512),EMPTY)
    composite=water.copy(); composite.alpha_composite(vessel); composite.alpha_composite(weapons)
    return composite,vessel,water,weapons


def write_sheet(frames,path):
    sheet=Image.new("RGBA",(2560,1024),EMPTY)
    for index,image in enumerate(frames):
        sheet.alpha_composite(image,((index%5)*512,(index//5)*512))
    sheet.save(path,optimize=True)
    return sheet


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_write(path,value):
    path.write_text(json.dumps(value,indent=2)+"\n",encoding="utf-8")


def export_rig(rig,output):
    layers_dir=output/"layers"; layers_dir.mkdir(exist_ok=True)
    rig["source"].save(output/"Source_Transparent.png",optimize=True)
    rig["base"].save(layers_dir/"Hull.png",optimize=True)
    specs=[]
    for layer in rig["layers"]:
        file=layer["name"]+".png"
        layer["image"].save(layers_dir/file,optimize=True)
        item={k:v for k,v in layer.items() if k not in ["image","mask"]}
        item["file"]="layers/"+file
        specs.append(item)
    json_write(output/"rig.json",{
        "schemaVersion":1,"sourceSize":{"width":1254,"height":1254},
        "source":str(rig["original"].relative_to(ROOT)).replace("\\","/"),
        "sourceSha256":sha(rig["original"]),"frameSize":{"width":512,"height":512},
        "sourceToFrame":{"scale":SCALE,"offset":[46,46]},"hullInterior":rig["hull"],
        "layers":specs,"notes":"Masks and original painted pixels are retained. Cloth pins, oar pivots, cannon recoil and optional effects are art presentation only."
    })


def export_ship(category,age):
    rig=make_rig(category,age)
    output=ROOT/category/age; output.mkdir(parents=True,exist_ok=True)
    export_rig(rig,output)
    animations={}
    motions=CATEGORIES[category]["motions"]
    summary=[]
    for motion in motions:
        frames=[render_frame(rig,motion,index) for index in range(10)]
        write_sheet([f[0] for f in frames],output/(motion+".png"))
        write_sheet([f[1] for f in frames],output/(motion+"_Vessel.png"))
        if motion!="Idle":
            write_sheet([f[2] for f in frames],output/(motion+"_Water.png"))
        if motion=="Attack" and any(layer.get("kind")=="gun" for layer in rig["layers"]):
            write_sheet([f[3] for f in frames],output/(motion+"_Weapons.png"))
        if motion=="Attack" and age in GUN_Y:
            starboard=[render_frame(rig,motion,index,"starboard") for index in range(10)]
            write_sheet([f[0] for f in starboard],output/"Attack_Starboard.png")
            write_sheet([f[1] for f in starboard],output/"Attack_Starboard_Vessel.png")
            write_sheet([f[3] for f in starboard],output/"Attack_Starboard_Weapons.png")
        data={
            "file":motion+".png","frameCount":10,"suggestedFramesPerSecond":{"Idle":8,"Sailing":12,"Attack":10}[motion],
            "loop":motion!="Attack",
            "frames":[{"index":i,"x":i%5*512,"y":i//5*512,"width":512,"height":512} for i in range(10)],
            "passes":{"vessel":motion+"_Vessel.png"},
            "distinctPoseCount":len({hashlib.sha256(f[0].tobytes()).hexdigest() for f in frames}),
        }
        if motion!="Idle": data["passes"]["water"]=motion+"_Water.png"
        if motion=="Attack":
            data["attackDirection"]="port" if age in GUN_Y else "forward"
            data["eventFrames"]= [3,4] if age in GUN_Y else [4]
            data["eventFramesAreVisualOnly"]=True
            if any(layer.get("kind")=="gun" for layer in rig["layers"]):
                data["passes"]["weapons"]=motion+"_Weapons.png"
            if age in GUN_Y:
                data["starboardVariant"]={"file":"Attack_Starboard.png","passes":{"vessel":"Attack_Starboard_Vessel.png","weapons":"Attack_Starboard_Weapons.png"}}
        animations[motion.lower()]=data
        summary.append({"motion":motion,"file":str((output/(motion+".png")).relative_to(ROOT)).replace("\\","/"),"sha256":sha(output/(motion+".png"))})
    json_write(output/"animations.json",{
        "schemaVersion":1,"unit":CATEGORIES[category]["unit"],"age":age,"category":category,
        "camera":"vertical-overhead-orthographic","facing":"screen-up","frameSize":{"width":512,"height":512},
        "sheetSize":{"width":2560,"height":1024},"grid":{"columns":5,"rows":2},"frameOrder":"left-to-right-then-next-row",
        "pivot":{"x":256,"y":256},"normalizedPivot":{"x":.5,"y":.5},"animations":animations,
        "timingNote":"Simulation movement, damage and attack cadence remain authoritative. Suggested frame rates and visual event frames describe artwork only.",
        "integrationStatus":"artwork-only; not connected to game renderer",
    })
    print(f"{category}/{age}: {len(motions)} clips, {len(rig['layers'])} editable layers",flush=True)
    return summary


def write_manifest(source_hashes):
    assets=[]
    for age,label in zip(AGES,LABELS):
        for category in CATEGORIES:
            meta=ROOT/category/age/"animations.json"
            data=json.loads(meta.read_text(encoding="utf-8"))
            assets.append({"age":age,"ageLabel":label,"category":category,"metadata":str(meta.relative_to(ROOT)).replace("\\","/"),
                           "original":f"{category}/{CATEGORIES[category]['unit']}_{age}.png",
                           "clips":[value["file"] for value in data["animations"].values()]})
    json_write(ROOT/"Ship_Animation_Manifest.json",{
        "schemaVersion":1,"shipCount":len(assets),"clipCount":sum(len(asset["clips"]) for asset in assets),"mode":"Deterministic layered animation of master paintings; directly authorized by user",
        "sourcesPreserved":True,"sourceSha256":source_hashes,"frameSize":{"width":512,"height":512},
        "sheetSize":{"width":2560,"height":1024},"grid":{"columns":5,"rows":2},"camera":"vertical-overhead-orthographic",
        "facing":"screen-up","assets":assets,"preview":"Ship_Animation_Preview.html",
        "authoring":"build-animations.py; Pillow, numpy, OpenCV. Original hulls, cargo, oars and weapons are preserved. Small deck patches behind recoiling barrels are reconstructed by inpainting.",
        "status":"artwork-only; game integration unverified",
    })


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--age",choices=AGES)
    parser.add_argument("--category",choices=list(CATEGORIES))
    parser.add_argument("--workers",type=int,default=2,choices=[1,2,3,4])
    parser.add_argument("--manifest-only",action="store_true",help="Refresh the catalog without regenerating any sheets")
    args=parser.parse_args()
    before={str(p.relative_to(ROOT)).replace("\\","/"):sha(p) for category in CATEGORIES for p in (ROOT/category).glob("*.png")}
    if args.manifest_only:
        write_manifest(before)
        return
    cv2.setNumThreads(1)
    jobs=[(category,age) for category in ([args.category] if args.category else CATEGORIES)
          for age in ([args.age] if args.age else AGES)]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda job: export_ship(*job),jobs))
    after={file:sha(ROOT/file) for file in before}
    if before!=after: raise RuntimeError("An original was modified")
    if not args.age and not args.category:
        write_manifest(before)


if __name__=="__main__":
    main()

