"""Bake four registered solo vehicle clips, preserving native sources and approved idle."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for filename in ['animations.json','Actor_Review.html','Generation.json','Validation.json','Browser-Review.json']:
    backup=SRC/('Before-Animation-'+filename)
    if not backup.exists(): shutil.copy2(ROOT/filename,backup)
approved=sha(ROOT/'Idle-v1.png')
write(SRC/'Approved-Idle.json',{'file':'Idle-v1.png','sha256':approved,'approval':'User approved idle-v1 and requested four vehicle animations.'})
specs=[('moving','Moving',True,[200]*6),('attack','Twin cannon volley',False,[160,120,180,120,180,300]),('death','Explosion / death',False,[120,140,180,250,400,1000])]
clips=[];checks=[];recipes=[];records=[];target=None
def hood_anchor(cell):
    arr=np.asarray(cell,dtype=np.float32);r,g,b=[arr[:,:,i] for i in range(3)]
    mask=(r>80)&(r<225)&(b>45)&(r>g*1.25)&(r>b*1.3)&(arr[:,:,3]>200)
    mask[:250]=False;mask[320:]=False;mask[:,:235]=False;mask[:,280:]=False
    yy,xx=np.where(mask)
    assert len(xx)>15,('turret red star anchor missing',len(xx))
    return [float(xx.mean()),float(yy.mean())]
def separator(alpha,column):
    strip=alpha[400:631,column*512:(column+1)*512]
    empty=np.where((strip>16).sum(axis=1)==0)[0]+400
    if len(empty): return np.full(512,int(min(empty,key=lambda y:abs(int(y)-512))))
    cost=(strip>16)*1000000+np.abs(np.arange(400,631)-512)[:,None]*.001
    dp=cost[:,0].copy();parents=[]
    for sx in range(1,512):
        options=np.stack([np.r_[np.inf,dp[:-1]],dp,np.r_[dp[1:],np.inf]])
        choice=options.argmin(axis=0);parents.append(np.arange(231)+choice-1)
        dp=options.min(axis=0)+cost[:,sx]
    row=int(dp.argmin());seam=[row+400]
    for parent in reversed(parents): row=int(parent[row]);seam.append(row+400)
    seam=np.array(seam[::-1])
    assert not (alpha[seam,np.arange(column*512,(column+1)*512)]>16).any(),'Adjacent poses touch'
    return seam
for ident,label,loop,durations in specs:
    rec=read(SRC/('Generation-motion-'+ident+'-v1.json'))
    native=SRC/('Native-Motion-'+rec['file'])
    if not native.exists(): shutil.copy2(rec['generatedSource'],native)
    im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024)
    alpha=np.asarray(im.getchannel('A'));seams=[separator(alpha,c) for c in range(3)]
    out=Image.new('RGBA',(1536,1024));tracks=[];frames=[];rects=[]
    for i in range(6):
        x,y=i%3*512,i//3*512;seam=seams[i%3]
        top,bottom=(0,int(seam.max())) if i<3 else (int(seam.min()),1024)
        rect=[x,top,x+512,bottom];rects.append(rect)
        crop=np.array(im.crop(tuple(rect)));rows=np.arange(top,bottom)[:,None]
        keep=rows<seam[None,:] if i<3 else rows>=seam[None,:];crop[~keep]=0
        expanded=Image.new('RGBA',(512,640));expanded.paste(Image.fromarray(crop),(0,64+top-y))
        cell=Image.new('RGBA',(512,512));cell.paste(expanded.resize((333,416),Image.Resampling.LANCZOS),(90,48))
        dx=dy=0;anchor=None
        if ident!='death':
            anchor=hood_anchor(cell)
            if target is None: target=[256,anchor[1]]
            dx,dy=[round(target[j]-anchor[j]) for j in range(2)]
        frame=Image.new('RGBA',(512,512));frame.paste(cell,(dx,dy))
        assert np.asarray(frame.getchannel('A'),dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum(),'Registration clips pixels'
        bounds=frame.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox()
        assert bounds and min(bounds)>0 and max(bounds)<512
        assert all(0<=256+(v-256)*400/333<=512 for v in bounds),'Review display clips frame'
        frames.append({'index':i,'visibleBounds':bounds,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
        tracks.append({'index':i,'hoodStarAnchorBefore':anchor,'translation':[dx,dy]})
        out.paste(frame,(x,y))
    assert len({f['sha256'] for f in frames})==6,'Duplicate poses'
    name=ident+'-Registered-v1.png';out.save(ROOT/name)
    clips.append({'id':ident,'file':name,'sha256':sha(ROOT/name),'label':label,'loop':loop,'scale':512/333,'durations':durations,'frameCount':6,'sourceFrameOrder':list(range(6)),'description':rec['prompt'].split('Motion: ')[-1],'frames':[{'index':i,'sourceIndex':i,'x':i%3*512,'y':i//3*512,'width':512,'height':512,'pivot':{'x':256,'y':256}} for i in range(6)]})
    checks.append({'id':ident,'file':name,'distinctFrames':6,'frames':frames})
    recipes.append({'id':ident,'nativeSource':str(native.relative_to(ROOT)),'sourceSha256':sha(native),'output':name,'outputSha256':sha(ROOT/name),'sourceRects':rects,'transparentSeamsByColumn':[s.tolist() for s in seams],'uniformScale':333/512,'expandedCell':[512,640],'padding':[90,48],'displayScale':512/333,'tracks':tracks})
    records.append({**rec,'nativeCopy':str(native.relative_to(ROOT))})
meta=read(SRC/'Before-Animation-animations.json')
idle=meta['animations'][0]
idle['sheetSize']=meta['sheetSize'].copy()
clips.insert(0,idle)
checks.insert(0,{'id':'idle','file':'Idle-v1.png','distinctFrames':1,'sha256':approved})
meta.update(stage='single-vehicle-animation-review',integrationStatus='Four local animation clips pending visual review; runtime integration is separate.',artRevision='animations-v1',sheetSize={'width':1536,'height':1024},grid={'columns':3,'rows':2},animations=clips,registration='Constant scale, fixed root pivot; living clips translated to a shared turret-star anchor. No per-frame scaling.',motionContract='In-place art. Runtime owns vehicle translation, facing, formation placement and combat effects.')
write(ROOT/'animations.json',meta)
html=(SRC/'Before-Animation-Actor_Review.html').read_text(encoding='utf-8-sig').replace('One Tsar Tank. One idle frame.','One Tsar Tank. Three animations.').replace('Loading Tsar Tank idle','Loading Tsar Tank animations')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
generation=read(ROOT/'Generation.json');generation.update(userApproval='Idle-v1 approved; animations pending review.',animationMode='built-in-imagegen')
generation['records']=list({r['file']:r for r in generation['records']+records}.values());write(ROOT/'Generation.json',generation)
assert sha(ROOT/'Idle-v1.png')==approved
write(SRC/'Composition.json',{'method':'Whole generated poses, transparent extraction, uniform scale, padding and translation only.','approvedIdleSha256':approved,'clips':recipes})
write(ROOT/'Validation.json',{'clipCount':4,'frameCount':19,'clips':checks,'approvedIdlePreserved':True,'runtimeIntegration':False,'userApproval':'Animations pending review'})
served=[]
for name in ['Actor_Review.html','animations.json']+[c['file'] for c in clips]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/TsarTank/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes()
        served.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'httpChecks':served,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'runtimeIntegration':False,'userApproval':'Animations pending review'})
print('Approved idle and three Tsar Tank animations: 19 frames and six served review assets verified.')


