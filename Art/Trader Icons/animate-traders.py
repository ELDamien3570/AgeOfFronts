"""Pack transparent trader paintings and animate authored local mesh regions.

Original generated paintings remain unchanged. Cloth, limbs, suspension and
wheel tread use their painted pixels; simulation owns actual world movement.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parent
AGES=['BronzeAge','ClassicalAge','EarlyMedieval','LateMedieval','EarlyModern','Modern']
LABELS=['Bronze Age','Classical Age','Early Medieval','Late Medieval','Early Modern','Modern']
NATIVE=1254
FRAME=512
COUNT=10
TAU=math.tau


def save_json(path,data):
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def region_mask(rect,size,feather=12):
    mask=Image.new('L',size,0)
    ImageDraw.Draw(mask).rectangle(rect,fill=255)
    return np.asarray(mask.filter(ImageFilter.GaussianBlur(feather)),dtype=np.float32)/255


def pack_master(image):
    alpha=np.asarray(image.getchannel('A'))
    _,_,stats,_=cv2.connectedComponentsWithStats((alpha>16).astype(np.uint8),8)
    regions=stats[1:][stats[1:,cv2.CC_STAT_AREA]>=24]
    x0=int(regions[:,0].min())-45; y0=int(regions[:,1].min())-45
    x1=int((regions[:,0]+regions[:,2]).max())+45; y1=int((regions[:,1]+regions[:,3]).max())+45
    crop=(x0,y0,x1,y1)
    scale=1140/max(x1-x0,y1-y0)
    resized=image.crop(crop).resize((round((x1-x0)*scale),round((y1-y0)*scale)),Image.Resampling.LANCZOS)
    offset=((NATIVE-resized.width)//2,(NATIVE-resized.height)//2)
    native=Image.new('RGBA',(NATIVE,NATIVE),(0,0,0,0)); native.alpha_composite(resized,offset)
    return native,{'crop':crop,'scale':scale,'offset':offset,'generatedSize':list(image.size)}


def make_rig(age,spec,original=None):
    original=Path(original) if original is not None else ROOT/'generated'/f'Trader_{age}.png'
    source=Image.open(original).convert('RGBA')
    native,placement=pack_master(source)
    regions=[]
    for index,part in enumerate(spec['parts']):
        x0,y0,x1,y1=part['rect']
        pad=round(part.get('margin',24))
        bx0=max(0,math.floor(x0-pad)); by0=max(0,math.floor(y0-pad))
        bx1=min(source.width,math.ceil(x1+pad)); by1=min(source.height,math.ceil(y1+pad))
        rectangle=(bx0,by0,bx1,by1)
        yy,xx=np.mgrid[by0:by1,bx0:bx1].astype(np.float32)
        mask=region_mask((x0-bx0,y0-by0,x1-bx0,y1-by0),(bx1-bx0,by1-by0),part.get('feather',9))
        regions.append({**part,'name':part.get('name',f"{part['kind']}-{index+1:02d}"),'box':rectangle,'xx':xx,'yy':yy,'mask':mask})
    return {'age':age,'source':source,'native':native,'original':original,'placement':placement,'regions':regions,'spec':spec}


def animate_source(rig,motion,index):
    source=np.asarray(rig['source'],dtype=np.float32)
    h,w=source.shape[:2]
    yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    mx=xx.copy(); my=yy.copy()
    phase=TAU*index/COUNT
    travel=motion=='Travel'
    for part in rig['regions']:
        bx0,by0,bx1,by1=part['box']; px,py=part['xx'],part['yy']; mask=part['mask']
        x0,y0,x1,y1=part['rect']
        p=phase+part.get('phase',0)
        kind=part['kind']
        dx=np.zeros_like(px); dy=np.zeros_like(py)
        if kind=='limb':
            # Root stays fixed, toes take alternating forward/backward steps.
            ramp=np.clip((py-part.get('pinY',y0))/max(1,y1-part.get('pinY',y0)),0,1)
            stride=part.get('stride',14) if travel else .8
            dy=stride*math.sin(p)*ramp
            dx=(part.get('lateral',2) if travel else .3)*math.cos(p)*ramp
        elif kind=='body':
            # Restrained breathing/weight shift; harnesses stay attached.
            dy=(1.8 if travel else .75)*math.sin(p)
            dx=(.6 if travel else .3)*math.sin(p+.8)
        elif kind=='suspension':
            dy=(2.6 if travel else .35)*math.sin(2*p)
            dx=(.45 if travel else .1)*math.cos(p)
        elif kind=='cloth':
            u=np.clip((px-x0)/max(1,x1-x0),0,1)
            v=np.clip((py-y0)/max(1,y1-y0),0,1)
            dy=(3.2 if travel else 1.2)*np.sin(math.pi*u)*v*math.sin(p)
        elif kind=='flag':
            distance=np.clip((px-x0)/max(1,x1-x0),0,1)
            dy=(6 if travel else 2.4)*distance*np.sin(p-distance*4)
        elif kind=='tail':
            along=np.clip((y1-py)/max(1,y1-y0),0,1)
            dx=(4 if travel else 2.2)*along*math.sin(p)
        mx[by0:by1,bx0:bx1]-=dx*mask
        my[by0:by1,bx0:bx1]-=dy*mask
    alpha=source[...,3:4]/255
    premult=np.dstack([source[...,:3]*alpha,source[...,3]])
    warped=cv2.remap(premult,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
    wa=np.clip(warped[...,3:4]/255,0,1)
    rgb=np.divide(warped[...,:3],wa,out=np.zeros_like(warped[...,:3]),where=wa>.0001)
    if travel:
        # In overhead view wheels are edge-on: scroll their painted tread,
        # rather than rotating an upright wheel face in the ground plane.
        for part in rig['regions']:
            if part['kind']!='tread': continue
            x0,y0,x1,y1=map(int,part['rect'])
            texture=source[y0:y1,x0:x1,:3]
            th,tw=texture.shape[:2]
            ty,tx=np.mgrid[0:th,0:tw].astype(np.float32)
            rolled=cv2.remap(texture,tx,(ty+index*th/COUNT)%th,cv2.INTER_LINEAR,borderMode=cv2.BORDER_WRAP)
            # Keep rim/axle edges stable and blend only the tread interior.
            amount=.24*np.sin(math.pi*(tx+.5)/tw)*np.sin(math.pi*(ty+.5)/th)
            rgb[y0:y1,x0:x1]=rgb[y0:y1,x0:x1]*(1-amount[...,None])+rolled*amount[...,None]
    return Image.fromarray(np.dstack([np.clip(rgb,0,255),np.clip(warped[...,3],0,255)]).astype(np.uint8))


def frame_vessel(rig,motion,index):
    painted=animate_source(rig,motion,index)
    p=rig['placement']; crop=p['crop']; scale=p['scale']
    resized=painted.crop(crop).resize((round((crop[2]-crop[0])*scale),round((crop[3]-crop[1])*scale)),Image.Resampling.LANCZOS)
    native=Image.new('RGBA',(NATIVE,NATIVE),(0,0,0,0)); native.alpha_composite(resized,tuple(p['offset']))
    frame=Image.new('RGBA',(FRAME,FRAME),(0,0,0,0))
    frame.alpha_composite(native.resize((420,420),Image.Resampling.LANCZOS),(46,46))
    return frame


def write_sheet(frames,path):
    sheet=Image.new('RGBA',(2560,1024),(0,0,0,0))
    for index,frame in enumerate(frames): sheet.alpha_composite(frame,((index%5)*FRAME,(index//5)*FRAME))
    sheet.save(path,optimize=True)


def export(age,spec):
    rig=make_rig(age,spec); folder=ROOT/age; (folder/'layers').mkdir(parents=True,exist_ok=True)
    rig['native'].save(folder/'Source_Transparent.png',optimize=True)
    rig['source'].save(folder/'layers'/'Original_Painting.png',optimize=True)
    definitions=[]
    for part in rig['regions']:
        mask=Image.new('L',rig['source'].size,0)
        mask.paste(Image.fromarray((part['mask']*255).astype(np.uint8)),(part['box'][0],part['box'][1]))
        file='layers/'+part['name']+'-mask.png'; mask.save(folder/file)
        layer=rig['source'].copy(); layer.putalpha(Image.fromarray((np.asarray(rig['source'].getchannel('A'),dtype=np.float32)*np.asarray(mask)/255).astype(np.uint8)))
        layer_file='layers/'+part['name']+'.png'; layer.save(folder/layer_file,optimize=True)
        definitions.append({k:v for k,v in part.items() if k not in ['mask','xx','yy','box']}|{'maskFile':file,'paintFile':layer_file})
    save_json(folder/'rig.json',{'source':f'generated/Trader_{age}.png','sourceSha256':sha(rig['original']),'generatedSize':list(rig['source'].size),'nativeSize':[NATIVE,NATIVE],'placement':rig['placement'],'layers':definitions,'authoring':'Local mesh deformation of original painted pixels; limbs remain connected, wagon cargo stays secured, and overhead wheel treads retain their silhouette.'})
    animations={}
    for motion in ['Idle','Travel']:
        frames=[frame_vessel(rig,motion,index) for index in range(COUNT)]
        write_sheet(frames,folder/(motion+'.png'))
        animations[motion.lower()]={'file':motion+'.png','frameCount':COUNT,'suggestedFramesPerSecond':8 if motion=='Idle' else 12,'loop':True,'frames':[{'index':i,'x':i%5*FRAME,'y':i//5*FRAME,'width':FRAME,'height':FRAME} for i in range(COUNT)],'distinctPoseCount':len({hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames})}
    save_json(folder/'animations.json',{'schemaVersion':1,'unit':spec['label'],'age':age,'category':'OverlandTrader','memberCounts':spec['counts'],'camera':'vertical-overhead-orthographic','facing':'screen-down','frameSize':{'width':FRAME,'height':FRAME},'sheetSize':{'width':2560,'height':1024},'grid':{'columns':5,'rows':2},'pivot':{'x':256,'y':256},'normalizedPivot':{'x':.5,'y':.5},'frameOrder':'left-to-right-then-next-row','animations':animations,'timingNote':'Simulation owns movement, trade routes and delivery. Artwork loops provide presentation only.','integrationStatus':'artwork-only; not connected to game renderer'})
    print(f'{age}: Idle + Travel, {len(definitions)} motion regions',flush=True)


def manifest(specs):
    assets=[]
    for age,label in zip(AGES,LABELS):
        if age not in specs or not (ROOT/age/'animations.json').exists(): continue
        assets.append({'age':age,'ageLabel':label,'label':specs[age]['label'],'memberCounts':specs[age]['counts'],'metadata':f'{age}/animations.json','original':f'generated/Trader_{age}.png','sourceSha256':sha(ROOT/'generated'/f'Trader_{age}.png'),'clips':[f'{age}/Idle.png',f'{age}/Travel.png']})
    save_json(ROOT/'Trader_Animation_Manifest.json',{'schemaVersion':1,'traderCount':len(assets),'clipCount':2*len(assets),'camera':'vertical-overhead-orthographic','facing':'screen-down','frameSize':[512,512],'sheetSize':[2560,1024],'grid':[5,2],'pivot':[256,256],'assets':assets,'preview':'Trader_Animation_Preview.html','status':'artwork-only; game integration unverified'})


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--age',choices=AGES); parser.add_argument('--manifest-only',action='store_true'); args=parser.parse_args()
    specs=json.loads((ROOT/'rig-authoring.json').read_text(encoding='utf-8'))
    cv2.setNumThreads(1)
    if not args.manifest_only:
        for age in ([args.age] if args.age else AGES):
            if age in specs and (ROOT/'generated'/f'Trader_{age}.png').exists(): export(age,specs[age])
    manifest(specs)


if __name__=='__main__': main()
