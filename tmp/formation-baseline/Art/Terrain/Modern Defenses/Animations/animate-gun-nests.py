"""Animate source-painted weapons over an immutable pit, never re-generate frames."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
CONFIG=json.loads((ROOT/'weapon-rigs.json').read_text())
CELL=CONFIG['sourceCellPixels']; FRAME=CONFIG['framePixels']; OFFSET=CONFIG['sourceOffset']; SCALE=CONFIG['workingScale']; WORK=FRAME*SCALE
FACINGS=CONFIG['facings']; EMPTY=(0,0,0,0)


def write_json(path,data): path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(image):
    data=np.asarray(image).copy(); data[data[...,3]==0,:3]=0; return Image.fromarray(data)


def padded(image):
    result=Image.new('RGBA',(FRAME,FRAME)); result.paste(image,(OFFSET,OFFSET)); return result


def polygon(points):
    mask=Image.new('L',(CELL,CELL)); ImageDraw.Draw(mask).polygon([tuple(point) for point in points],fill=255); return np.asarray(mask).copy()


def layer(source,mask):
    data=np.asarray(source).copy(); data[...,3]=np.rint(data[...,3].astype(float)*mask/255).astype(np.uint8); data[data[...,3]==0,:3]=0
    return padded(Image.fromarray(data))


def float_layer(image):
    data=np.asarray(image.resize((WORK,WORK),Image.Resampling.LANCZOS),dtype=np.float32)/255
    data[...,:3]*=data[...,3:4]; return data


def transformed(data,angle,pivot,recoil=0):
    matrix=cv2.getRotationMatrix2D(tuple(float(value) for value in (np.asarray(pivot)+OFFSET)*SCALE),-angle,1)
    radians=math.radians(angle); matrix[0,2]+=-math.sin(radians)*recoil*SCALE; matrix[1,2]+=math.cos(radians)*recoil*SCALE
    return np.clip(cv2.warpAffine(data,matrix,(WORK,WORK),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=EMPTY),0,1)


def over(bottom,top): return top+bottom*(1-top[...,3:4])


def image_from_premultiplied(data):
    # Resize premultiplied channels before un-premultiplying; this keeps
    # transparent cutout edges free of dark fringes during subpixel motion.
    data=cv2.resize(data,(FRAME,FRAME),interpolation=cv2.INTER_AREA); alpha=data[...,3:4]
    rgb=np.divide(data[...,:3],alpha,out=np.zeros_like(data[...,:3]),where=alpha>1e-5)
    pixels=np.clip(np.rint(np.concatenate([rgb,alpha],axis=-1)*255),0,255).astype(np.uint8); pixels[pixels[...,3]==0,:3]=0
    return Image.fromarray(pixels)


def rotated_point(point,pivot,angle,recoil=0):
    angle=math.radians(angle); dx,dy=np.asarray(point)-np.asarray(pivot); x,y=pivot
    return (x+OFFSET+math.cos(angle)*dx-math.sin(angle)*(dy+recoil),y+OFFSET+math.sin(angle)*dx+math.cos(angle)*(dy+recoil))


def muzzle_flash(point,angle,variant):
    canvas=Image.new('RGBA',(WORK,WORK)); draw=ImageDraw.Draw(canvas)
    radians=math.radians(angle); axis=np.array([math.sin(radians),-math.cos(radians)]); side=np.array([math.cos(radians),math.sin(radians)]); p=np.asarray(point)
    def at(forward,lateral=0): return tuple(np.rint((p+axis*forward+side*lateral)*SCALE).astype(int))
    length=8.3+(variant%3)*.8
    draw.polygon([at(-.8),at(2.3,-3),at(3.8,-1.3),at(length,-.8),at(length+1.2),at(length,.9),at(3.6,1.7),at(2.2,3)],fill=(255,170,49,195))
    draw.polygon([at(0),at(2,-1.5),at(length*.68),at(2,1.5)],fill=(255,244,176,255))
    center=p*SCALE; draw.ellipse((round(center[0]-SCALE),round(center[1]-SCALE),round(center[0]+SCALE),round(center[1]+SCALE)),fill=(255,255,221,255))
    return float_layer(canvas.resize((FRAME,FRAME),Image.Resampling.LANCZOS))


def repair_plate(source,spec,hole):
    pixels=np.asarray(source).copy(); rgb=pixels[...,:3].copy(); alpha=pixels[...,3].copy(); yy,xx=np.mgrid[:CELL,:CELL]
    earth=np.asarray(Image.open(ROOT.parent/'materials'/'EarthMaterial.png').convert('RGB'),dtype=float)
    if spec['id']=='AntiInfantry':
        target=pixels[92:108,97:113,:3].mean(axis=(0,1)); soil=earth/np.maximum(earth.mean(axis=(0,1)),1)*target
        rgb[hole>0]=np.clip(soil,0,255).astype(np.uint8)[hole>0]
        boards=Image.open(ROOT.parent/'materials'/'DuckboardMaterial.png').convert('RGB').crop((0,0,256,96)).transpose(Image.Transpose.ROTATE_90).resize((18,54),Image.Resampling.LANCZOS)
        boards=np.asarray(boards,dtype=float); target=pixels[148:161,84:96,:3].mean(axis=(0,1)); boards*=target/np.maximum(boards.mean(axis=(0,1)),1)
        patch=np.clip(boards,0,255).astype(np.uint8); region=rgb[110:164,82:100]; mask=hole[110:164,82:100]>0; region[mask]=patch[mask]
        center=(128,154); radius=16; tint=np.array([100,98,74]); parapet=(52,88,105,119)
    else:
        # Source-painted concrete for the pad, then a restrained circular
        # bearing surface inside its existing stationary mounting ring.
        patch=pixels[88:105,83:97,:3]; concrete=patch[yy%patch.shape[0],xx%patch.shape[1]]
        rgb[hole>0]=concrete[hole>0]; center=(128,132); radius=39; tint=np.array([103,106,95]); parapet=(43,78,84,99)
    distance=np.hypot(xx-center[0],yy-center[1]); grain=(earth.mean(axis=2)-earth.mean())*.14
    surface=tint+grain[...,None]-(xx-center[0])[...,None]*.08-(yy-center[1])[...,None]*.08
    rim=(distance>radius-2)&(distance<radius); surface[rim]+=14
    bearing=(distance<=radius)&(hole>0); rgb[bearing]=np.clip(surface,0,255).astype(np.uint8)[bearing]
    # Restore the hidden north-facing sandbag strip from adjacent original
    # paint at the same height. This avoids blurred remnants of the old guns.
    top,bottom,left,right=parapet
    for y in range(top,bottom):
        for x in np.flatnonzero(hole[y]>0): rgb[y,x]=pixels[y,left+(x-left)%(right-left),:3]
    for y in range(top+5):
        alpha[y,hole[y]>0]=max(int(pixels[y,left,3]),int(pixels[y,right-1,3]))
    return Image.fromarray(np.dstack([rgb,alpha]))


def prepare(spec):
    source_path=(ROOT/spec['source']).resolve(); source=Image.open(source_path).convert('RGBA'); pixels=np.asarray(source).copy()
    barrel_masks=[polygon(barrel['polygon']) for barrel in spec['barrels']]
    barrel_union=np.maximum.reduce(barrel_masks); body_mask=polygon(spec['bodyPolygon']); body_mask=np.where(barrel_union>0,0,body_mask).astype(np.uint8)
    union=np.maximum(body_mask,barrel_union); hole=cv2.dilate(union,np.ones((7,7),np.uint8),iterations=1)
    plate=clean(padded(repair_plate(source,spec,hole)))
    body=layer(source,body_mask); barrels=[layer(source,mask) for mask in barrel_masks]
    folder=ROOT/spec['id']; layers=folder/'layers'; layers.mkdir(parents=True,exist_ok=True)
    plate.save(layers/'Pit_Base.png',optimize=True); body.save(layers/'Gun_Body.png',optimize=True); padded(source).save(layers/'Original_Padded.png',optimize=True)
    padded(Image.fromarray(np.dstack([np.zeros((CELL,CELL,3),dtype=np.uint8),hole]))).getchannel('A').save(layers/'Reconstruction_Mask.png')
    for index,(image,mask) in enumerate(zip(barrels,barrel_masks)):
        image.save(layers/f'Barrel_{index+1}.png',optimize=True); Image.fromarray(mask).save(layers/f'Barrel_{index+1}_Mask.png')
    Image.fromarray(body_mask).save(layers/'Gun_Body_Mask.png')
    rig={**spec,'sourceSHA256':sha(source_path),'sourceFrameSize':CELL,'frameSize':FRAME,'sourceOffset':OFFSET,'cellRect':{'x':OFFSET,'y':OFFSET,'width':CELL,'height':CELL},'spritePivot':{'x':FRAME/2,'y':FRAME/2},'mountPivotInFrame':{'x':spec['pivot'][0]+OFFSET,'y':spec['pivot'][1]+OFFSET},'basePlate':'layers/Pit_Base.png','body':'layers/Gun_Body.png','barrelLayers':[f'layers/Barrel_{i+1}.png' for i in range(len(barrels))],'backgroundReconstruction':'Masked occlusion patches are rebuilt from shared painted earth/boards, adjacent source-painted sandbags and a reconstructed bearing surface. The same resulting pit/base image is reused by every clip and heading.'}
    write_json(folder/'rig.json',rig)
    return {'spec':spec,'folder':folder,'plate':plate,'body':float_layer(body),'barrels':[float_layer(image) for image in barrels],'source':padded(source)}


def pose(rig,motion,facing,index):
    spec=rig['spec']; settings=CONFIG[motion.lower()]; base_angle=FACINGS.index(facing)*90
    angle=base_angle+(spec['trackingDegrees']*math.sin(2*math.pi*index/settings['frameCount']) if motion=='Tracking' else 0)
    weapon=np.zeros_like(rig['body']); events=[]; recoils=[]; flashes=[]
    for barrel_index,(barrel,data) in enumerate(zip(spec['barrels'],rig['barrels'])):
        phase=(index+barrel['phaseOffsetFrames'])%CONFIG['firing']['cycleFrames'] if motion=='Firing' else None
        recoil=spec['recoilPixels']*CONFIG['firing']['recoilCurve'][phase] if motion=='Firing' else 0; recoils.append(recoil)
        weapon=over(weapon,transformed(data,angle,spec['pivot'],recoil))
        if motion=='Firing' and phase<CONFIG['firing']['flashFrames']:
            muzzle=rotated_point(barrel['muzzle'],spec['pivot'],angle,recoil); flashes.append(muzzle_flash(muzzle,angle,index+barrel_index))
            events.append({'barrel':barrel_index+1,'muzzle':{'x':round(muzzle[0],3),'y':round(muzzle[1],3)}})
    weapon=over(weapon,transformed(rig['body'],angle,spec['pivot']))
    for flash in flashes: weapon=over(weapon,flash)
    weapon_image=image_from_premultiplied(weapon); complete=Image.alpha_composite(rig['plate'],weapon_image)
    return complete,weapon_image,{'index':index,'angleDegrees':round(angle,6),'barrelRecoilPixels':recoils,'shots':events}


def pack(frames,columns):
    rows=math.ceil(len(frames)/columns); sheet=Image.new('RGBA',(columns*FRAME,rows*FRAME)); definitions=[]
    for index,frame in enumerate(frames):
        x,y=index%columns*FRAME,index//columns*FRAME; sheet.paste(frame,(x,y)); definitions.append({'index':index,'x':x,'y':y,'width':FRAME,'height':FRAME})
    return sheet,definitions


def main():
    rigs=[prepare(spec) for spec in CONFIG['types']]; assets=[]
    protected_paths=list((ROOT.parent/'Gun Nests').glob('*_[NESW].png'))+list((ROOT.parent/'Trenches'/'tiles').glob('*.png'))+[ROOT.parent/'generated'/'AntiInfantryNest.png',ROOT.parent/'generated'/'AntiAirNest.png']
    sources=[{'file':str(path.relative_to(ROOT.parent)).replace('\\','/'),'sha256':sha(path)} for path in protected_paths]
    for rig in rigs:
        spec=rig['spec']; clips={}
        for facing in FACINGS:
            facing_folder=rig['folder']/facing; facing_folder.mkdir(exist_ok=True); animations={}
            for motion in ['Firing','Tracking']:
                settings=CONFIG[motion.lower()]; results=[pose(rig,motion,facing,i) for i in range(settings['frameCount'])]
                frames=[result[0] for result in results]; weapon_frames=[result[1] for result in results]; kinematics=[result[2] for result in results]
                columns=6 if motion=='Firing' else 8; sheet,rectangles=pack(frames,columns); weapons,_=pack(weapon_frames,columns)
                sheet.save(facing_folder/f'{motion}.png',optimize=True); weapons.save(facing_folder/f'{motion}_Weapon.png',optimize=True)
                animations[motion.lower()]={'file':f'{motion}.png','weaponFile':f'{motion}_Weapon.png','frameCount':len(frames),'suggestedFramesPerSecond':settings['framesPerSecond'],'frameDurationMilliseconds':1000/settings['framesPerSecond'],'durationSeconds':len(frames)/settings['framesPerSecond'],'loop':True,'sheetSize':{'width':sheet.width,'height':sheet.height},'grid':{'columns':columns,'rows':sheet.height//FRAME},'frames':rectangles,'kinematics':kinematics,'distinctPoseCount':len({hashlib.sha256(image.tobytes()).hexdigest() for image in frames}),'cyclicRoundsPerMinutePerBarrel':round(settings['framesPerSecond']/CONFIG['firing']['cycleFrames']*60,3) if motion=='Firing' else None,'trackingAmplitudeDegrees':spec['trackingDegrees'] if motion=='Tracking' else 0}
            metadata={'schemaVersion':1,'type':spec['id'],'label':spec['label'],'facing':facing,'frameSize':{'width':FRAME,'height':FRAME},'sourceCellSize':CELL,'cellRect':{'x':OFFSET,'y':OFFSET,'width':CELL,'height':CELL},'pivot':{'x':FRAME/2,'y':FRAME/2},'normalizedPivot':{'x':.5,'y':.5},'renderScaleInCells':FRAME/CELL,'basePlate':'../layers/Pit_Base.png','pitBaseInvariantAcrossFacings':True,'mountPivot':{'x':spec['pivot'][0]+OFFSET,'y':spec['pivot'][1]+OFFSET},'frameOrder':'left-to-right-then-next-row','animations':animations,'sourceSHA256':sha(ROOT/spec['source']),'authoring':'Original painted pit and weapon cutouts; local barrel recoil and upper-assembly traverse. No AI-generated animation frames.'}
            write_json(facing_folder/'animations.json',metadata); clips[facing]=f"{spec['id']}/{facing}/animations.json"
        assets.append({'id':spec['id'],'label':spec['label'],'barrelCount':len(spec['barrels']),'basePlate':f"{spec['id']}/layers/Pit_Base.png",'rig':f"{spec['id']}/rig.json",'facings':clips})
        print(f"{spec['id']}: firing and tracking in N/E/S/W, fixed pit and mount",flush=True)
    manifest={'schemaVersion':1,'age':'Modern','typeCount':2,'clipCount':16,'frameSize':FRAME,'sourceCellSize':CELL,'sourceOffset':OFFSET,'pivot':{'x':FRAME/2,'y':FRAME/2},'renderScaleInCells':FRAME/CELL,'motionTypes':['Firing','Tracking'],'assets':assets,'sources':sources,'preview':'Gun_Animation_Preview.html','referenceGuide':'mechanical-references.json','authoring':'animate-gun-nests.py and weapon-rigs.json; source-painted native layers, Pillow/NumPy/OpenCV','status':'Art animations only; game timing, targeting and combat integration unverified.'}
    write_json(ROOT/'Gun_Animation_Manifest.json',manifest)
    review=Image.new('RGB',(FRAME*3,FRAME*2+56),'#253127'); draw=ImageDraw.Draw(review); font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',16)
    for row,rig in enumerate(rigs):
        for column,(name,image) in enumerate([('Original',rig['source']),('Fixed pit / mounting plate',rig['plate']),('Extracted upper gun',image_from_premultiplied(over(rig['body'],np.maximum.reduce(rig['barrels']))))]):
            x=column*FRAME; y=28+row*(FRAME+28); draw.text((x+8,y-24),rig['spec']['id']+' · '+name,font=font,fill='#e8e1cc'); backdrop=Image.new('RGBA',(FRAME,FRAME),'#879762'); backdrop.alpha_composite(image); review.paste(backdrop.convert('RGB'),(x,y))
    review.save(ROOT/'Layer_Preparation_Review.png')


if __name__=='__main__': main()
