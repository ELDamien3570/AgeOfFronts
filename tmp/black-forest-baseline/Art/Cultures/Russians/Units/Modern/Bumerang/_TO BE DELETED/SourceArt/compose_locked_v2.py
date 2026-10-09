"""Bake master-locked living clips; preserve every v1 source and output."""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
import json, hashlib, shutil
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
meta=read(ROOT/'animations.json')
backup=SRC/'Before-Locked-v2-animations.json'
if not backup.exists(): shutil.copy2(ROOT/'animations.json',backup)
meta=read(backup)
master=Image.open(ROOT/'Idle-v1.png').convert('RGBA')
approved=sha(ROOT/'Idle-v1.png')
base=Image.new('RGBA',(512,512));base.paste(master.resize((341,512),Image.Resampling.LANCZOS),(85,0))
base.save(SRC/'Locked-Body-v2.png')
# Only inner tread surfaces move. The outer tire silhouettes and hull stay exact.
rects=[(222,160,248,363),(222,425,248,627),(222,690,248,893),(222,952,248,1153),
       (776,160,801,363),(776,425,801,627),(776,690,801,893),(776,952,801,1153)]
moving=[]
for phase in [0,4,8,12,16,20]:
    frame=master.copy()
    for rect in rects:
        patch=master.crop(rect);arr=np.asarray(patch);shifted=Image.fromarray(np.roll(arr,phase,axis=0))
        mask=Image.new('L',patch.size,0)
        mask.paste(255,(3,8,patch.width-3,patch.height-8));mask=mask.filter(ImageFilter.GaussianBlur(3))
        frame.paste(shifted,rect[:2],mask)
    cell=Image.new('RGBA',(512,512));cell.paste(frame.resize((341,512),Image.Resampling.LANCZOS),(85,0));moving.append(cell)
# Extract existing generated effects only, discarding its redrawn vehicle.
native=Image.open(SRC/'Native-Motion-attack-v1.png').convert('RGBA')
def effect(rect,kind):
    a=np.array(native.crop(rect));r,g,b=[a[:,:,j].astype(float) for j in range(3)]
    if kind=='flash': keep=((r>g*1.13)&(r>b*1.35)&(r>190))|((r>235)&(g>225)&(b>185))
    else: keep=(np.abs(r-g)<12)&(np.abs(g-b)<12)&(r>90)
    a[~keep]=0
    return Image.fromarray(a)
flash=effect((738,412,804,482),'flash').resize((29,31),Image.Resampling.LANCZOS)
smoke=effect((738,918,804,982),'smoke').resize((29,29),Image.Resampling.LANCZOS)
flash.save(SRC/'Muzzle-Flash-v2.png');smoke.save(SRC/'Muzzle-Smoke-v2.png')
attack=[]
for i in range(6):
    f=base.copy()
    if i in [1,3]: f.alpha_composite(flash,(242,397))
    if i==4: f.alpha_composite(smoke,(242,397))
    attack.append(f)
clips=[];checks=[]
def publish(ident,label,frames,loop,durations,description):
    size=frames[0].width
    sheet=Image.new('RGBA',(size*3,size*2))
    for i,f in enumerate(frames):
        bounds=f.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox()
        assert bounds and min(bounds)>0 and max(bounds)<size,'Visible content reaches cell edge'
        sheet.paste(f,(i%3*size,i//3*size))
    name=ident+'-Locked-v2.png';sheet.save(ROOT/name)
    clip={'id':ident,'file':name,'sha256':sha(ROOT/name),'label':label,'loop':loop,'scale':size/512,'durations':durations,'frameCount':len(frames),'description':description,'sheetSize':{'width':size*3,'height':size*2},'frames':[{'index':i,'sourceIndex':i,'x':i%3*size,'y':i//3*size,'width':size,'height':size,'pivot':{'x':size/2,'y':size/2}} for i in range(len(frames))]}
    clips.append(clip)
    checks.append({'id':ident,'frames':len(frames),'file':name,'sha256':sha(ROOT/name)})
publish('moving','Moving',moving,True,[120]*6,'Approved vehicle body held fixed; tire tread surfaces cycle in place.')
publish('attack','Autocannon burst',attack,False,[180,80,130,80,200,400],'Approved vehicle body and barrel stay fixed; two brief muzzle flashes followed by dissipating smoke.')
# Structural destruction comes from a new narrow-hull source.
rec=read(SRC/'Generation-death-v2.json');nativeDeath=SRC/'Native-death-v2.png'
if not nativeDeath.exists(): shutil.copy2(rec['generatedSource'],nativeDeath)
deathAtlas=Image.open(nativeDeath).convert('RGBA');assert deathAtlas.size==(1536,1024)
death=[]
deathOffsets=[(-12,-18),(13,-18),(18,-18),(-6,7),(18,7),(16,7)]
for i in range(6):
    cell=deathAtlas.crop((i%3*512,i//3*512,(i%3+1)*512,(i//3+1)*512))
    registered=Image.new('RGBA',(640,640));registered.paste(cell.resize((502,502),Image.Resampling.LANCZOS),(69+deathOffsets[i][0],69+deathOffsets[i][1]))
    death.append(registered)
# The death starts with the same exact idle sprite, never a redesigned intact tank.
deathBase=Image.new('RGBA',(640,640));deathBase.paste(base,(64,64))
death[0]=deathBase.copy()
# Keep the approved hull through ignition; extract only warm fire and grey smoke.
blast=np.array(death[1]);r,g,b=[blast[:,:,j].astype(float) for j in range(3)]
yy,xx=np.indices(r.shape)
fire=(r>140)&(r>g*1.3)&(r>b*1.8)
smokeMask=(np.abs(r-g)<14)&(np.abs(g-b)<14)&(r>65)&(yy<344)&(yy>124)
keep=(fire|smokeMask)&(yy>124)&(yy<364)&(xx>244)&(xx<394)
blast[~keep]=0
death[1]=deathBase.copy();death[1].alpha_composite(Image.fromarray(blast))
publish('death','Explosion / death',death,False,[120,140,180,250,400,1000],'Approved idle starts the destruction; turret and wheels detach, leaving a permanent burnt wreck.')
idle=meta['animations'][0]
meta.update(animations=[idle]+clips,artRevision='locked-body-v2',registration='Living clips share the exact approved body, scale and root. Only tread textures and muzzle effects animate.',integrationStatus='Corrected local clips pending visual review; runtime integration is separate.')
write(ROOT/'animations.json',meta)
assert sha(ROOT/'Idle-v1.png')==approved
# Evidence checks compare against the exact master outside authored moving regions.
a=np.array(base)
assert all(np.array_equal(np.array(f)[80:390,175:337],a[80:390,175:337]) for f in moving),'Hull changed in movement'
assert all(np.array_equal(np.array(f)[:397],a[:397]) for f in attack),'Body changed in firing'
assert all(f.getchannel('A').getbbox()==base.getchannel('A').getbbox() for f in moving),'Movement silhouette changed'
assert np.array_equal(np.array(attack[0]),np.array(death[0].crop((64,64,576,576)))),'Death starting vehicle differs'
write(SRC/'Composition-Locked-v2.json',{'master':'Idle-v1.png','masterSha256':approved,'bodyTransform':{'resize':[341,512],'translation':[85,0]},'treadRects':rects,'treadPhases':[0,4,8,12,16,20],'effectSource':'SourceArt/Native-Motion-attack-v1.png','deathSource':'SourceArt/Native-death-v2.png','deathRegistration':{'uniformSize':[502,502],'offsets':deathOffsets,'firstTwoFrames':'Approved body with ignition effects only'},'reason':'User rejected v1 identity drift and hull width changes. V1 assets retained for provenance.'})
write(ROOT/'Validation.json',{'clips':checks,'approvedIdlePreserved':True,'livingHullPixelsFixed':True,'movementSilhouetteFixed':True,'deathStartsWithApprovedBody':True,'runtimeIntegration':False,'userApproval':'Pending visual review'})
generation=read(ROOT/'Generation.json');generation['records']=list({r['file']:r for r in generation['records']+[rec]}.values());generation['animationMode']='Approved master composition plus ImageGen destruction and muzzle effects';write(ROOT/'Generation.json',generation)
served=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']+[c['file'] for c in clips]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/Bumerang/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes();served.append(name)
write(ROOT/'Browser-Review.json',{'servedFiles':served,'browserPlaybackVerified':False,'runtimeIntegration':False})
print('Exact master hull, fixed firing body, moving silhouette and served assets verified.')
