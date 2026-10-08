"""Extract generated poses and register with uniform clip scale and translation only."""
from pathlib import Path
from PIL import Image
import numpy as np
import hashlib, json

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'SourceArt'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, data): p.write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
approved = sha(ROOT/'Idle-v2.png')
write(SRC/'Approved-Idle.json', {'file':'Idle-v2.png', 'sha256':approved, 'approval':'User approved the flatter overhead v2 and requested animation.'})

def star(im):
    a=np.asarray(im,dtype=float)
    r,g,b,alpha=[a[:,:,i] for i in range(4)]
    mask=(r>80)&(r>g*1.25)&(r>b*1.3)&(alpha>180)
    # Restrict to turret roof; exclude the muzzle flash below it.
    mask[:int(im.height*.30)]=False
    mask[int(im.height*.65):]=False
    yy,xx=np.where(mask)
    assert len(xx)>10, 'Missing turret star registration anchor'
    return float(xx.mean()),float(yy.mean())

def separator(alpha, column):
    strip=alpha[470:551,column*512:(column+1)*512]
    empty=np.where((strip>16).sum(axis=1)==0)[0]+470
    if len(empty): return np.full(512,int(min(empty,key=lambda y:abs(int(y)-512))))
    cost=(strip>16)*1000000+np.abs(np.arange(470,551)-512)[:,None]*.001
    dp=cost[:,0].copy(); parents=[]
    for x in range(1,512):
        choices=np.stack([np.r_[np.inf,dp[:-1]],dp,np.r_[dp[1:],np.inf]])
        best=choices.argmin(axis=0);parents.append(np.arange(81)+best-1)
        dp=choices.min(axis=0)+cost[:,x]
    row=int(dp.argmin());seam=[row+470]
    for parent in reversed(parents):row=int(parent[row]);seam.append(row+470)
    seam=np.array(seam[::-1])
    assert not (alpha[seam,np.arange(column*512,(column+1)*512)]>16).any(), 'Adjacent generated poses touch'
    return seam

specs=[('moving','Moving',True,[150]*6,.84,'Rolling track tread phases; motion stays in place.'),('moving-shooting','Moving and shooting',True,[180,100,120,150,200,250],.86,'Rolling tracks with one cannon flash, dissipating muzzle smoke, and recovery.'),('death','Explosion / death',False,[120,120,160,220,350,1200],.90,'Ignition, explosion, smoke clearing, then a charred wreck; holds the final frame.')]
clips=[];recipes=[];checks=[]
idle=Image.open(ROOT/'Idle-v2.png').convert('RGBA')
anchor=star(idle)
scale=.32
small=idle.resize((round(idle.width*scale),round(idle.height*scale)),Image.Resampling.LANCZOS)
idle_frame=Image.new('RGBA',(512,512))
idle_frame.paste(small,(round(286-anchor[0]*scale),round(240-anchor[1]*scale)))
idle_frame.save(ROOT/'idle-Registered-v1.png')
clips.append({'id':'idle','label':'Idle','file':'idle-Registered-v1.png','loop':True,'scale':1,'sheetSize':{'width':512,'height':512},'durations':[1000],'frameCount':1,'description':'Approved stationary idle. Hull, turret, gun and tracks remain still.','frames':[{'index':0,'x':0,'y':0,'width':512,'height':512,'pivot':{'x':256,'y':256}}]})

for ident,label,loop,durations,scale,description in specs:
    native=SRC/f'Native-{ident}-v1.png'
    im=Image.open(native).convert('RGBA')
    assert im.size==(1536,1024)
    alpha=np.asarray(im.getchannel('A'))
    seams=[separator(alpha,c) for c in range(3)]
    if ident=='moving-shooting':
        # Use the clear gap after the top row's muzzle effects, before the next hull.
        assert not (alpha[524]>16).any()
        seams=[np.full(512,524) for _ in range(3)]
    out=Image.new('RGBA',(1536,1024)); frames=[];reg=[];hashes=[]
    for i in range(6):
        col,row=i%3,i//3; seam=seams[col]
        top,bottom=(0,int(seam.max())) if row==0 else (int(seam.min()),1024)
        crop=np.array(im.crop((col*512,top,(col+1)*512,bottom)))
        yy=np.arange(top,bottom)[:,None]
        keep=yy<seam[None,:] if row==0 else yy>=seam[None,:]
        crop[~keep]=0
        expanded=Image.new('RGBA',(512,640))
        expanded.paste(Image.fromarray(crop),(0,64+top-row*512))
        if ident!='death':
            ax,ay=star(expanded)
        else:
            # Track/hull centers in each native cell remain measurable even under the blast.
            ax=[303,282,275,303,282,275][i];ay=249+64
        resized=expanded.resize((round(512*scale),round(640*scale)),Image.Resampling.LANCZOS)
        offset=(round(286-ax*scale),round(240-ay*scale))
        frame=Image.new('RGBA',(512,512));frame.paste(resized,offset)
        assert np.asarray(frame.getchannel('A'),dtype=np.uint64).sum()==np.asarray(resized.getchannel('A'),dtype=np.uint64).sum(), (ident,i,'registration clips pixels')
        bounds=frame.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox()
        assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<512 and bounds[3]<512,(ident,i,bounds)
        h=hashlib.sha256(frame.tobytes()).hexdigest();hashes.append(h)
        out.paste(frame,(col*512,row*512))
        frames.append({'index':i,'sourceIndex':i,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':256,'y':256}})
        reg.append({'index':i,'sourceAnchor':[ax,ay],'uniformScale':scale,'translation':offset,'visibleBounds':bounds,'frameSha256':h})
    assert len(set(hashes))==6
    name=f'{ident}-Registered-v1.png';out.save(ROOT/name)
    clips.append({'id':ident,'label':label,'file':name,'loop':loop,'scale':1,'durations':durations,'frameCount':6,'description':description,'frames':frames})
    recipes.append({'id':ident,'nativeSource':str(native.relative_to(ROOT)),'sha256':sha(native),'scale':scale,'frames':reg})
    checks.append({'id':ident,'distinctFrames':6,'fullyContained':True})
for c in clips:c['sha256']=sha(ROOT/c['file'])
for c in clips:
    if c['frameCount']==1:continue
    sheet=Image.open(ROOT/c['file'])
    sequence=[sheet.crop((f['x'],f['y'],f['x']+512,f['y']+512)) for f in c['frames']]
    sequence[0].save(ROOT/(c['id']+'-Preview-v1.webp'),save_all=True,append_images=sequence[1:],duration=c['durations'],loop=0 if c['loop'] else 1,lossless=True)
meta={'schemaVersion':1,'cultureId':'russians','requestedAge':'Modern','unit':'T-14 Armata','actorCount':1,'stage':'single-vehicle-animation-review','camera':'vertical-overhead-orthographic','facing':'screen-down','reviewFootprint':460,'sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'animations':clips,'registration':'Living clips register the offset turret star at x286 y240, keeping tank centerline near pivot x256. Uniform scale per clip, translation only; destruction uses measured hull centers.','motionContract':'In-place artwork. Runtime owns translation, facing and combat.','integrationStatus':'Local art review; runtime integration not performed.','artRevision':'animations-v1'}
write(ROOT/'animations.json',meta)
write(SRC/'Composition.json',{'method':'Native frame extraction, uniform resampling and translation only; no pose painting or warping.','approvedIdleSha256':approved,'clips':recipes})
assert sha(ROOT/'Idle-v2.png')==approved
write(ROOT/'Validation.json',{'clipCount':4,'frameCount':19,'approvedIdlePreserved':True,'sourceAtlasesPreserved':True,'clips':checks,'runtimeIntegration':False,'visualApproval':'Pending','limitations':'Generated poses may retain small texture or silhouette variations; user visual review required.'})
template=Path('Art/Cultures/Russians/Units/Modern/MachineGunTruck/Actor_Review.html').read_text(encoding='utf-8-sig')
html=template.replace('One machine gun truck. Four animations.','One T-34/85. Four animations.').replace('Modern Age · World War II','Pre-Modern Age · T-34/85').replace('Olive-drab Soviet-style cargo truck with an open wooden bed, one pedestal-mounted heavy machine gun and a khaki-clad gunner.','Approved olive-drab T-34/85. Stationary idle, rolling tracks, cannon firing while moving, and destruction.').replace('machine gun truck','T-34/85 tank').replace('truck animations','tank animations').replace('../../StoneAge/Clubman/actor-review.js','./actor-review.js').replace('<a href="../SovietMachineGunner/Actor_Review.html">Soviet machine gunner review ↗</a>','').replace('Artwork prototype · game integration follows visual review','Artwork prototype · animation approval and runtime integration pending')
html=html.replace('Pre-Modern Age','Modern Age').replace('T-34/85','T-14 Armata')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
js=Path('Art/Cultures/Russians/Units/StoneAge/Clubman/actor-review.js').read_text(encoding='utf-8-sig').replace('one soldier','one tank')
(ROOT/'actor-review.js').write_text(js,encoding='utf-8')
gen=json.loads((ROOT/'Generation.json').read_text(encoding='utf-8'))
gen['stage']='single-vehicle-animation-review';gen['idleApproval']='User approved Idle-v2 and requested animation.';gen['approvedIdle']='Idle-v2.png'
gen['animationRecords']=json.loads((SRC/'Generation-animations-v1.json').read_text())['records']
write(ROOT/'Generation.json',gen)
print('Four clips, 19 frames, sources preserved, fixed pivots, no output clipping.')
rigid = SRC/'compose_rigid_firing.cjs'
if rigid.exists():
    import subprocess
    subprocess.run([str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'),str(rigid)],check=True)
    corrected=json.loads((ROOT/'animations.json').read_text(encoding='utf-8'))
    clip=next(c for c in corrected['animations'] if c['id']=='moving-shooting')
    atlas=Image.open(ROOT/clip['file'])
    sequence=[atlas.crop((f['x'],f['y'],f['x']+512,f['y']+512)) for f in clip['frames']]
    sequence[0].save(ROOT/'moving-shooting-Preview-v2.webp',save_all=True,append_images=sequence[1:],duration=clip['durations'],loop=0,lossless=True)

