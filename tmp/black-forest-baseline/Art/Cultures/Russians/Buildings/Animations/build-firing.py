"""Layered Russian emplacement firing clips; immutable painted bases and source weapon parts."""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent
CONFIG=json.loads((ROOT/'weapon-rigs.json').read_text())
CELL=CONFIG['cellPixels']; FRAME=CONFIG['framePixels']; OFFSET=CONFIG['cellOffset']; RATIO=CELL/CONFIG['sourceCoordinateSpace']
FACINGS=CONFIG['facings']; COUNT=CONFIG['frameCount']; FPS=CONFIG['framesPerSecond']
EMPTY=(0,0,0,0)
def write(path,data):path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def pad(im):
 result=Image.new('RGBA',(FRAME,FRAME));result.paste(im,(OFFSET,OFFSET));return result
def polygon(points):
 im=Image.new('L',(CELL,CELL));ImageDraw.Draw(im).polygon([tuple(np.asarray(p)*RATIO) for p in points],fill=255);return np.asarray(im).copy()
def layer(source,mask):
 a=np.asarray(source).copy();a[:,:,3]=np.rint(a[:,:,3].astype(float)*mask/255).astype(np.uint8);a[a[:,:,3]==0,:3]=0;return pad(Image.fromarray(a))
def premul(im):
 a=np.asarray(im,dtype=np.float32)/255;a[:,:,:3]*=a[:,:,3:4];return a
def rgba(a):
 alpha=a[:,:,3:4];rgb=np.divide(a[:,:,:3],alpha,out=np.zeros_like(a[:,:,:3]),where=alpha>1e-6);p=np.clip(np.rint(np.concatenate([rgb,alpha],axis=2)*255),0,255).astype(np.uint8);p[p[:,:,3]==0,:3]=0;return Image.fromarray(p)
def over(bottom,top):return top+bottom*(1-top[:,:,3:4])
def point(p,spec,angle,recoil=0):
 p=np.asarray(p)*RATIO+OFFSET;pivot=np.asarray(spec['pivot'])*RATIO+OFFSET;r=math.radians(angle);rot=np.array([[math.cos(r),-math.sin(r)],[math.sin(r),math.cos(r)]])
 return pivot+rot@(p-pivot+np.array([0,recoil]))
def transform(a,spec,angle,recoil=0):
 pivot=tuple(np.asarray(spec['pivot'])*RATIO+OFFSET);m=cv2.getRotationMatrix2D(pivot,-angle,1);r=math.radians(angle);m[0,2]-=math.sin(r)*recoil;m[1,2]+=math.cos(r)*recoil
 return np.clip(cv2.warpAffine(a,m,(FRAME,FRAME),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=EMPTY),0,1)
def prepare(spec):
 directory=(ROOT/spec['directory']).resolve();folder=directory/'Animations';layers=folder/'layers';layers.mkdir(exist_ok=True)
 source=Image.open(directory/'Icon.png').convert('RGBA').resize((CELL,CELL),Image.Resampling.LANCZOS)
 generated=Image.open(folder/'SourceArt/Plate-v1.png').convert('RGBA').resize((CELL,CELL),Image.Resampling.LANCZOS)
 barrel_masks=[polygon(x['polygon']) for x in spec['barrels']]
 bm=np.maximum.reduce([polygon(p) for p in spec['bodyPolygons']]);union=np.maximum(bm,np.maximum.reduce(barrel_masks))
 bm=np.where(np.maximum.reduce(barrel_masks)>0,0,bm).astype(np.uint8)
 repair=union.copy()
 for p in spec.get('repairPolygons',[]):repair=np.maximum(repair,polygon(p))
 hole=cv2.dilate(repair,np.ones((9,9),np.uint8));blend=cv2.GaussianBlur(hole,(5,5),.65).astype(float)/255
 # Only the small occluded region uses imagegen's repair plate.
 # Every source pixel outside this mask is copied unchanged at the working resolution.
 src=premul(source);gen=premul(generated);base=rgba(src*(1-blend[:,:,None])+gen*blend[:,:,None])
 base=pad(base);body=layer(source,bm);barrels=[layer(source,m) for m in barrel_masks]
 base.save(layers/'Base.png');body.save(layers/'Body.png');pad(source).save(layers/'Original.png')
 pad(Image.fromarray(hole).convert('RGBA')).save(layers/'Repair-Mask-Review.png')
 Image.fromarray(hole).save(layers/'Repair-Mask.png')
 for i,(im,m) in enumerate(zip(barrels,barrel_masks)):
  im.save(layers/f'Barrel-{i+1}.png');Image.fromarray(m).save(layers/f'Barrel-{i+1}-Mask.png')
 Image.fromarray(bm).save(layers/'Body-Mask.png')
 rig={**spec,'sourceSHA256':sha(directory/'Icon.png'),'plateSHA256':sha(folder/'SourceArt/Plate-v1.png'),'framePixels':FRAME,'cellPixels':CELL,'cellOffset':OFFSET,'mountPivot':list(np.asarray(spec['pivot'])*RATIO+OFFSET),'base':'layers/Base.png','body':'layers/Body.png','barrelLayers':[f'layers/Barrel-{i+1}.png' for i in range(len(barrels))],'repairPolicy':'Imagegen plate consumed only inside dilated weapon occlusion mask; original source paint retained elsewhere. Same fixed base for every direction/frame.'}
 write(folder/'rig.json',rig)
 return dict(spec=spec,directory=directory,folder=folder,base=base,body=premul(body),barrels=[premul(im) for im in barrels],source=pad(source),rig=rig)
def flash(im,muzzle,angle,elevated,variant):
 draw=ImageDraw.Draw(im);p=np.asarray(muzzle);r=math.radians(angle);forward=np.array([math.sin(r),-math.cos(r)]);side=np.array([math.cos(r),math.sin(r)])
 if elevated:
  # Skyward muzzle bloom is centered on each upward-facing bore.
  radius=7+(variant%2);points=[]
  for i in range(12):
   rad=radius if i%2==0 else radius*.38;t=i*math.pi/6;points.append(tuple(p+[math.cos(t)*rad,math.sin(t)*rad*.75]))
 else:
  points=[tuple(p+forward*f+side*l) for f,l in [(-1,0),(2,-4),(5,-2),(16,-1),(20,0),(15,2),(5,3),(2,4)]]
 draw.polygon(points,fill=(255,158,36,215));draw.ellipse((p[0]-2,p[1]-2,p[0]+2,p[1]+2),fill=(255,249,205,255))
def effects(im,muzzle,angle,phase,cycle,elevated,variant):
 p=np.asarray(muzzle);r=math.radians(angle);forward=np.array([math.sin(r),-math.cos(r)]);side=np.array([math.cos(r),math.sin(r)])
 draw=ImageDraw.Draw(im)
 if phase<=1:flash(im,p,angle,elevated,variant)
 if 1<=phase<=5:
  t=(phase-1)/5;center=p+forward*(4+10*t)+side*(variant%3-1)*3*t;radius=3+7*t
  draw.ellipse((center[0]-radius,center[1]-radius*.8,center[0]+radius,center[1]+radius*.8),fill=(190,186,169,round(72*(1-t))))
def pose(rig,facing,index):
 s=rig['spec'];angle=FACINGS.index(facing)*90;weapon=transform(rig['body'],s,angle);fx=Image.new('RGBA',(FRAME,FRAME));poses=[];events=[]
 for b,paint in zip(s['barrels'],rig['barrels']):
  phase=(index-b['phase'])%s['cycleFrames'];curve=[0,.85,1,.6,.25,0];recoil=s['recoil']*RATIO*(curve[phase] if phase<len(curve) else 0)
  weapon=over(weapon,transform(paint,s,angle,recoil));muzzle=point(b['muzzle'],s,angle,recoil)
  effects(fx,muzzle,angle,phase,s['cycleFrames'],s['elevated'],index)
  poses.append({'phase':phase,'recoilPixels':round(recoil,6),'muzzle':list(np.round(muzzle,6))})
  if phase==0:events.append({'barrel':len(poses),'muzzle':list(np.round(muzzle,6))})
 weapon_image=Image.alpha_composite(rgba(weapon),fx)
 return Image.alpha_composite(rig['base'],weapon_image),weapon_image,dict(index=index,angleDegrees=angle,barrels=poses,shots=events)
def pack(frames):
 columns=6;sheet=Image.new('RGBA',(columns*FRAME,math.ceil(len(frames)/columns)*FRAME));rects=[]
 for i,im in enumerate(frames):
  x=i%columns*FRAME;y=i//columns*FRAME;sheet.paste(im,(x,y));rects.append(dict(index=i,x=x,y=y,width=FRAME,height=FRAME))
 return sheet,rects
def review(rigs):
 canvas=Image.new('RGB',(FRAME*3,FRAME*len(rigs)+len(rigs)*35),'#24322b');draw=ImageDraw.Draw(canvas)
 for row,rig in enumerate(rigs):
  for col,(title,im) in enumerate([('Source',rig['source']),('Fixed base',rig['base']),('Extracted assembly',rgba(over(rig['body'],np.maximum.reduce(rig['barrels']))))]):
   y=row*(FRAME+35);draw.text((col*FRAME+10,y+8),rig['spec']['age']+' '+rig['spec']['folder']+' / '+title,fill='#e5e1d2')
   bg=Image.new('RGBA',(FRAME,FRAME),'#b8b29f');bg.alpha_composite(im);canvas.paste(bg.convert('RGB'),(col*FRAME,y+35))
 canvas.save(ROOT/'Layer-Review.png')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--prepare-only',action='store_true');parser.add_argument('--asset');args=parser.parse_args()
 specs=[s for s in CONFIG['assets'] if not args.asset or s['id']==args.asset];rigs=[prepare(s) for s in specs];review(rigs)
 if args.prepare_only:return
 assets=[]
 for rig in rigs:
  s=rig['spec'];clips={}
  for facing in FACINGS:
   folder=rig['folder']/facing;folder.mkdir(exist_ok=True);results=[pose(rig,facing,i) for i in range(COUNT)]
   frames=[r[0] for r in results];weapons=[r[1] for r in results];sheet,rects=pack(frames);overlay,_=pack(weapons)
   sheet.save(folder/'Firing.png',optimize=True);overlay.save(folder/'Firing-Weapon.png',optimize=True)
   meta={'schemaVersion':1,'cultureId':'russians','age':s['age'],'weapon':s['id'],'facing':facing,'frameSize':{'width':FRAME,'height':FRAME},'cellRect':{'x':OFFSET,'y':OFFSET,'width':CELL,'height':CELL},'pivot':{'x':FRAME/2,'y':FRAME/2},'mountPivot':rig['rig']['mountPivot'],'basePlate':'../layers/Base.png','animations':{'firing':{'file':'Firing.png','weaponFile':'Firing-Weapon.png','frameCount':COUNT,'suggestedFramesPerSecond':FPS,'frameDurationMilliseconds':1000/FPS,'durationSeconds':COUNT/FPS,'loop':True,'grid':{'columns':6,'rows':math.ceil(COUNT/6)},'sheetSize':{'width':sheet.width,'height':sheet.height},'frames':rects,'kinematics':[r[2] for r in results],'distinctPoseCount':len({hashlib.sha256(im.tobytes()).hexdigest() for im in frames})}},'sourceSHA256':rig['rig']['sourceSHA256'],'status':'draft art animation; visual approval and gameplay integration pending'}
   write(folder/'animations.json',meta);clips[facing]=str((folder/'animations.json').relative_to(ROOT.parent)).replace('\\','/')
   # GIF is an inspection convenience; PNG sheets + metadata are the integration assets.
   previews=[]
   for im in frames:
    small=im.resize((256,256),Image.Resampling.LANCZOS);bg=Image.new('RGBA',small.size,'#79806c');bg.alpha_composite(small);previews.append(bg.convert('RGB'))
   previews[0].save(folder/'Firing-Review.gif',save_all=True,append_images=previews[1:],duration=1000/FPS,loop=0,disposal=2)
  assets.append({'id':s['id'],'label':s['label'],'age':s['age'],'folder':s['folder'],'barrelCount':len(s['barrels']),'facings':clips,'basePlate':str((rig['folder']/'layers/Base.png').relative_to(ROOT.parent)).replace('\\','/'),'rig':str((rig['folder']/'rig.json').relative_to(ROOT.parent)).replace('\\','/')})
  print(s['id']+': four firing clips complete',flush=True)
 if not args.asset:
  write(ROOT/'manifest.json',dict(schemaVersion=1,cultureId='russians',assets=assets,clipCount=len(assets)*len(FACINGS),frameCount=len(assets)*len(FACINGS)*COUNT,framesPerClip=COUNT,framePixels=FRAME,cellPixels=CELL,cellOffset=OFFSET,framesPerSecond=FPS,authoring='Source-painted cutouts and deterministic barrel/effect animation; built-in imagegen repairs masked occlusions only',status='draft-art-review-only',scope='No gameplay, firing cadence, targeting or runtime integration changed'))
if __name__=='__main__':main()
